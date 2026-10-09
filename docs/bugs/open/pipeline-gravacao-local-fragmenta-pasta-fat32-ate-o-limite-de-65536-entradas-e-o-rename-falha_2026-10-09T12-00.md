# Bug: gravação no pendrive FAT32 esgota as 65.536 entradas da pasta `faces` e o rename do `.xbox-companion-part` falha

- **Detectado em:** 2026-10-09, relato do dono com print (fila "EA FC 26 Legacy Edition", estado Erro)
- **Origem:** gravação local em modo pendrive — `src/server/services/pipeline/local_resilient.go::copyLocalEntry`
- **Estado:** passada 2 — causa raiz provada (reprodução no pendrive e simulação do alocador do FAT). Correção
  planejada, **não implementada**

## Sintoma

Relato do dono: "No xboxcompanion verifique este erro". Print da fila:

> **EA FC 26 Legacy Edition** — Erro
> Falha no dispositivo local. O download concluido foi preservado para nova tentativa: Gravação local: falha no
> dispositivo local: gravar face_40110_0_0_0_0_0_0_0_0_textures.rx3: rename E:\Games\EA FC 26 Legacy Edition -
> 454109F4\data\sceneassets\faces\face_40110_0_0_0_0_0_0_0_0_textures.rx3.xbox-companion-part E:\Games\EA FC 26
> Legacy Edition - 454109F4\data\sceneassets\faces\face_40110_0_0_0_0_0_0_0_0_textures.rx3: The directory or file
> cannot be created.

## Evidência

1. **Item da fila** `pending_queue/0b51dd86eaf970cde0c9ce9a.json`: `state=Error`, `updated_at=2026-10-09T11:21:46-03:00`,
   `connection.mode=local`, `connection.local_root=E:\`, origem
   `https://huggingface.co/datasets/luisluis123/xboxrghgames/resolve/main/EA%20FC%2026%20Legacy%20Edition.zip`,
   scratch `Ready\EA FC 26 Legacy Edition\.source_hf.zip` (11.794.619.508 bytes, preservado).
2. **Destino** (`Get-Volume`): `E:` rótulo `BADAVATAR`, **FAT32**, Removable, 14,44 GB, 9,83 GB livres, cluster 8192.
3. **Pasta que falhou**: `E:\Games\EA FC 26 Legacy Edition - 454109F4\data\sceneassets\faces` tem **12.571** arquivos,
   nenhum `.xbox-companion-part`. O último em ordem lexical é `face_40109_0_0_0_0_0_0_0_0_textures.rx3`; o que
   falhou, `face_40110_…`, é o seguinte. Os mais recentes têm `LastWriteTime` 11:21:40–11:21:42.
4. **O texto do erro é `ERROR_CANNOT_MAKE` (82)**: o Go formata `syscall.Errno` em inglês, e
   `ctypes.FormatError(82)` devolve "Não é possível criar a pasta ou arquivo." — o mesmo código em pt-BR.
5. **O zip** (Python `zipfile`, só o diretório central): 145.510 entradas, 13.153.228.594 bytes descompactados.
   A pasta `data/sceneassets/faces` tem **13.147** arquivos, nomes de 11 a 40 caracteres.
6. Não há linha do pipeline (`LOCAL …`) em `%APPDATA%\Xbox 360 Companion\logs\` — só `APP_USB`/`APP_RUNTIME`. O
   backend em execução é `dist\godsend-windows-x64.exe` (PID 26108, iniciado 2026-10-09 02:31), lançado pelo
   Electron do repositório.

## Causa raiz

### 1. O FAT32 do Windows não deixa uma pasta passar de 65.536 entradas de 32 bytes (2 MiB)

Fonte do driver (`microsoft/Windows-driver-samples`, `filesys/fastfat`), baixada e lida nesta investigação:

- `dirsup.c::FatCreateNewDirent` aloca as N entradas de um nome nesta ordem: (1) espaço **nunca usado** dentro da
  alocação atual da pasta (`UnusedDirentVbo`); (2) senão, a primeira sequência **contígua** de N entradas livres a
  partir de `DeletedDirentHint` (`RtlFindClearBits`); (3) senão, cresce a pasta um cluster — **exceto** se a pasta
  já tem `64 * 1024 * sizeof(DIRENT)` bytes, quando levanta `STATUS_CANNOT_MAKE` (linha 375–387). É o **único**
  `STATUS_CANNOT_MAKE` em `dirsup.c`, `fileinfo.c`, `create.c`, `namesup.c`, `allocsup.c`, `write.c`, `strucsup.c`
  (`grep -n STATUS_CANNOT_MAKE *.c *.h` → só `dirsup.c:387`).
- `fileinfo.c::FatSetRenameInfo`: rename na mesma pasta com **o mesmo** número de entradas reescreve no lugar;
  com número **diferente**, chama `FatCreateNewDirent` para o nome novo **antes** de apagar as entradas do nome
  antigo (linhas 3400–3418, e o `FatDeleteDirent` só na fase 2, linha 3513).
- Um nome longo ocupa `1 + ceil(len/13)` entradas (LFN + 8.3). Um nome 8.3 com base e extensão cada uma toda
  maiúscula ou toda minúscula ocupa 1.

### 2. O temporário `.xbox-companion-part` fragmenta a pasta até esse teto

`local_resilient.go::copyLocalEntry` grava cada arquivo como `<nome>.xbox-companion-part` **na mesma pasta** do
destino e depois faz `os.Rename(partial, dst)`. O sufixo tem 20 caracteres: o temporário de
`face_40110_0_0_0_0_0_0_0_0_textures.rx3` (39 caracteres, **4** entradas) tem 59 caracteres, **6** entradas.

Para cada arquivo: o temporário pega 6 entradas; o rename pede 4 ou 5 **novas** (contagem diferente) enquanto o
temporário ainda as segura; depois libera as 6. Como o FAT prefere espaço nunca usado a buracos, cada arquivo deixa
um buraco de 6 para trás enquanto a alocação tem espaço. Quando ela acaba, os nomes finais (4–5) caem nesses
buracos de 6 e sobram pedaços de 1–2 entradas que nenhum nome desta pasta consegue usar. A pasta chega a 65.536
entradas com milhares delas desperdiçadas.

Cadeia de chamada (call-sites lidos): `huggingface.go` (modo local) → `local_install.go::InstallXEXLocal` (linha 139)
→ `local_resilient.go::copyTreeLocal` (laço sequencial, linha 538; um arquivo por vez, sem paralelismo) →
`copyLocalEntry` (linha 555) → laço de rename (linhas 453–463: 5 tentativas, depois `os.Remove(partial)` e devolve o
erro) → `copyTreeLocal` repete 3 vezes e embrulha em `ErrLocalDelivery` (linha 592) → `huggingface.go:164`
acrescenta "Gravação local:" → `fallback.go:100` (`haltOnLocalStorageFailure`) monta a mensagem do print.

### Provas

**a) Contagem.** Os 12.571 nomes vivos em `faces` ocupam **56.191** entradas (com `.` e `..`): 1 nome de 1
entrada, 6.662 de 4, 5.908 de 5. Faltam 9.345 para 65.536. Os 13.147 nomes do zip, todos já como nome final,
precisam de **58.495**, que cabem. **O jogo cabe no FAT32; quem estoura o teto é o desperdício do temporário.**

**b) Reprodução no pendrive, sem o app** (script de prova; tudo o que criou foi apagado na hora, conferido com
`ls … | grep -c probe` → 0):

- Sozinhos, nomes de 1 a 6 entradas são criados em `faces` — o temporário que falhou foi apagado
  (`os.Remove(partial)`, linha 462) e deixou um buraco de 6.
- **Com** um arquivo de 6 entradas presente (o papel do `.xbox-companion-part`): nomes de 1 e 2 entradas são
  criados; de **3, 4, 5 e 6 falham**; e o **rename desse arquivo para um nome de 4 entradas falha com
  `winerror=82`** — exatamente o erro do print.
- Controle: na pasta-mãe `data\sceneassets` os seis tamanhos são criados normalmente.

**c) Simulação do alocador** (`scripts/fat32-dirent-sim.py`, que reproduz as regras de `FatCreateNewDirent`,
`FatDeleteDirent` e `FatSetRenameInfo` acima), sobre os 13.147 nomes reais em ordem lexical (a do
`filepath.Walk`):

```
python -I scripts/fat32-dirent-sim.py "Ready/EA FC 26 Legacy Edition/.source_hf.zip" "EA FC 26 Legacy Edition/data/sceneassets/faces" 8192
13147 files, need 58495 dirents as final names (cap 65536)
part-suffix          FAILS at file #12572 (12571 committed) face_40110_0_0_0_0_0_0_0_0_textures.rx3: allocation 65536, used 56197
short-temp-same-dir  FAILS at file #12016 (12015 committed) face_269136_0_0_0_0_0_0_0_0_textures.rx3: allocation 65536, used 53565
staging-dir          completes: allocation 58624 dirents, used 58495
```

O esquema atual (`part-suffix`) falha **no mesmo arquivo, com o mesmo número de arquivos gravados (12.571)**
do pendrive; `used 56197` = 56.191 vivas + as 6 do temporário. Com cluster de 4 KiB falha no #12.640, com 32 KiB
no #12.524. **Não depende do pendrive: todo cliente que instalar EA FC 26 Legacy Edition (XEX) em FAT32 cai aqui.**

As outras pastas grandes do jogo completam com o esquema atual (`hair` 41.493 entradas, `ui/imgAssets/heads`
36.025, `sceneassets/heads` 34.573): só `faces` passa do teto.

**d) Nova tentativa não resolve.** O temporário refeito ocupa de novo o único buraco de 6, o rename pede 4 e não há
sequência livre: falha no mesmo arquivo, sempre. "O download concluido foi preservado para nova tentativa" promete
algo que não acontece.

## Hipóteses descartadas

- **Disco cheio.** `E:` tem 9,83 GB livres; seria `ERROR_DISK_FULL` (112), "There is not enough space on the disk".
- **Caminho longo demais.** O destino tem 117 caracteres; seria 206 ou 3, não 82.
- **Nome inválido no FAT.** 12.571 nomes do mesmo padrão estão na mesma pasta; seria 123.
- **Arquivo preso por outro processo ou outra instância** (como no bug fechado
  `electron-main-multiplas-instancias-sem-single-instance-lock_2026-09-15T14-44.md`, que também tinha um rename de
  `.xbox-companion-part`). Seria 32 ou 5. A prova (b) reproduz o 82 sem nenhum outro processo envolvido.
- **Raiz FAT12/16 com tamanho fixo.** O volume é FAT32 e a pasta não é a raiz.
- **Esgotamento dos nomes curtos 8.3** (`FACE_4~1.RX3`…). O único `STATUS_CANNOT_MAKE` do driver é o do teto de
  2 MiB, e na prova (b) a falha depende do **tamanho** do nome (1–2 entradas passam, 3+ falham), não do nome.
- **O jogo não cabe no FAT32.** Como nomes finais, `faces` precisa de 58.495 de 65.536.
- **Correção alternativa: temporário com nome curto 8.3 (1 entrada) na mesma pasta.** Simulado (linha
  `short-temp-same-dir`): falha **antes** (#12.016). O FAT prefere espaço nunca usado a buracos, então cada arquivo
  deixa um buraco de 1 que os nomes finais de 4–5 não aproveitam.
- **Correção alternativa: gravar direto no nome final, sem temporário.** Não desperdiça entradas, mas abandona o
  commit atômico que `docs/RESILIENT-LOCAL-INSTALL.md` estabelece (arquivo com nome final é sempre arquivo
  completo e verificado). Fica de fora.

## Correção planejada

### T1 — o temporário sai da pasta do jogo

Em `local_resilient.go::copyLocalEntry`, o temporário vai para uma pasta de staging **no mesmo dispositivo**:
`<root>/.xbox-downloader/staging/<CRC32 do caminho de dst relativo a root, %08X>.TMP`. Esse nome é 8.3 maiúsculo,
então ocupa 1 entrada, e só dentro da staging. O `os.Rename` para `dst` atravessa pastas no mesmo volume
(`MoveFileEx`, só metadados). Em `FatSetRenameInfo`, `TargetDcb != Fcb->ParentDcb` → `FatCreateNewDirent` só no
destino: **a pasta do jogo recebe apenas nomes finais**, e a simulação (`staging-dir`) fecha `faces` com 58.495 de
65.536.

- Assinatura ganha `root`. Chamadores: `copyTreeLocal` (linha 555) e `copyFileLocal` (linha 634); os dois já têm `root`.
- Retomada mantida: staging com tamanho e SHA-256 iguais aos da entrada é promovido com rename. Colisão de CRC32
  só custa uma recópia, porque a conferência vem antes do commit.
- Sobra antiga `<dst>.xbox-companion-part` de versões anteriores: apagar antes de gravar (libera as entradas dela
  na pasta do jogo). A limpeza de `copyTreeLocal` linha 549 continua.
- **Não mexer** em `iso2god.go` (linhas 1037 e 1502) nem em `stage_checkpoint.go` (114, 215): gravam e conferem
  no staging do PC (`s.App.TempDir`, NTFS), onde não existe esse teto.
- Antes de escolher `.xbox-downloader/`, conferir que nada no Electron apaga arquivos desconhecidos ali
  (`localDeviceIdentityFile = ".xbox-downloader/xbox-companion-device-id"` já mora nela).

### T2 — recuperar a pasta que já ficou fragmentada

Só T1 não destrava o pendrive do dono nem o de clientes que já pegaram o erro: `faces` está no teto, com buracos
de 1–2. Em `copyTreeLocal`, quando o commit falha com `ERROR_CANNOT_MAKE` (`errors.Is(err, syscall.Errno(82))`,
helper com build tag Windows) em volume FAT, e a pasta **cabe** como nomes finais (contagem de T3):

1. apagar os arquivos regulares diretamente nessa pasta;
2. recomeçar o laço na primeira entrada dessa pasta (no `filepath.Walk` os arquivos de uma pasta-folha são
   contíguos). O que já está certo em outras pastas é reconferido por hash, e só essa pasta é regravada (~1 GB
   em `faces`);
3. no máximo uma vez por pasta e por chamada. Se repetir, devolve o erro de T3.

Depois de apagar, todas as entradas da pasta ficam livres, e o primeiro encaixe a partir de `DeletedDirentHint`
regrava a pasta compactada. Apagar e regravar é seguro contra queda por construção, porque a retomada por hash
já trata arquivo ausente. Mover os arquivos para uma pasta nova e trocar os nomes seria mais rápido, mas criaria
um estado intermediário (arquivos em duas pastas) que a retomada não conhece.

### T3 — verificação prévia e mensagem clara

Em `copyTreeLocal`, junto da checagem de 4 GB (`isFAT`, linha 500), contar as entradas por pasta de destino
(arquivos + subpastas + 2) com as regras acima. Acima de 65.536, devolver um sentinel novo
(`ErrFAT32DirectoryLimit`) com mensagem em português que nomeie a pasta e a contagem, **antes** de gravar qualquer
byte. Avaliar tratá-lo como `ErrFAT32FileSizeLimit` em `huggingface.go` (linha 157), que já troca de provedor para
ISO/GOD; no formato GOD o jogo vai num contêiner e não cria pastas enormes. Se um 82 ainda aparecer, traduzi-lo
para o usuário em vez de mostrar o texto do Windows em inglês.

### Notas da sessão de implementação (antes da primeira edição, 2026-10-09)

- **`.xbox-downloader/` no Electron** (`grep -rn xbox-downloader src/electron-app`, sem `node_modules`): ninguém
  varre a pasta inteira. `simulatedTransactionalWriter.ts:207` usa `.xbox-downloader/staging/<transactionId>` e só
  apaga **a própria** subpasta (`rm(paths.stagingRoot, {recursive})`, linhas 256/291/429);
  `localGameScannerService.ts:56` ignora a pasta na varredura de jogos; `cleanDeviceImage.ts:220` só proíbe
  componentes de escreverem nela. **Desvio do plano:** para não dividir a pasta `staging/` com o writer
  transacional do Electron (um `rm` futuro de `staging/` inteira apagaria o temporário no meio da cópia), o
  temporário do backend vai para `.xbox-downloader/copy-staging/%08X.TMP`.
- **Todos os chamadores põem `dst` sob `root`** (`local_install.go`: `InstallGameLocal`, `InstallContentLocal`,
  `InstallXEXLocal`, `InstallContentFileLocal`, `InstallROMLocal` montam `base` com `filepath.Join(root, …)` ou
  `joinSub(root, …)`, que só junta partes), então staging e destino estão sempre no mesmo volume.
- **Nomes do teste em FAT real.** Os 13.147 nomes de `faces` são `desktop.ini` + 13.146 no padrão
  `face_N_N_N_N_N_N_N_N_N_textures.rxN` (perfil por regex no diretório central do zip). Para o teste não depender
  do zip, nomes sintéticos com a mesma distribuição: 7.238 `face_<5 dígitos>_0_…_textures.rx3` (4 entradas) +
  5.908 `face_<6 dígitos>_…` (5 entradas) = 58.494 entradas com `.`/`..`. No simulador (`exec` das funções de
  `scripts/fat32-dirent-sim.py` sobre essa lista): `part-suffix` falha em #12.641 (4 KiB), **#12.569 (8 KiB)**,
  #12.524 (32 KiB); `staging-dir` completa nos três. Os sintéticos reproduzem o defeito.
- `E:` (BADAVATAR, FAT32, 10,5 GB livres) está montado: o teste em FAT real roda numa pasta própria em `E:\`,
  apagada no fim.

### Regras de commit do projeto

Cada commit de código leva o bump de versão nos 4 lugares, uma entrada no `CHANGELOG.md` em `[Unreleased]` e o
doc-sync no mesmo commit: `docs/RESILIENT-LOCAL-INSTALL.md` (linhas 14, 53 e 74 descrevem o
`<nome>.xbox-companion-part` ao lado do destino). Build: `npm run build:server`. Testes: `go test ./...` em
`src/server`.

## Tasks

| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | `copyLocalEntry` grava o temporário em `<root>/.xbox-downloader/staging/%08X.TMP` e promove por rename entre pastas; apaga sobra `<dst>.xbox-companion-part` antiga; teste unitário (nada além de `dst` aparece na pasta do destino; staging válido é promovido na retomada) + teste em FAT32 real atrás de `GODSEND_FAT32_TEST_DIR` (13.147 nomes de `faces`, arquivos vazios: completa; controle com o esquema antigo falha com errno 82 perto do #12.572) | -- | -- | -- | -- |
| T2 | `copyTreeLocal` recupera pasta saturada (82 em FAT, cabe como nomes finais): apaga os arquivos da pasta e recomeça o laço na primeira entrada dela, uma vez por pasta; teste unitário com erro 82 injetado | -- | -- | -- | -- |
| T3 | verificação prévia de entradas por pasta em FAT (`ErrFAT32DirectoryLimit`, mensagem em pt-BR), avaliar troca para ISO/GOD como no limite de 4 GB; traduzir o 82 restante; testes do contador (nomes de 1/2/4/5 entradas, regra de caixa do 8.3) | -- | -- | -- | -- |

**Prova ponta a ponta:** no app buildado, clicar em tentar de novo no item "EA FC 26 Legacy Edition" com o pendrive
`E:` do dono. T2 reorganiza `faces` e a gravação conclui. **Risco:** o jogo tem 13,15 GB, mais a folga de cluster
de 145 mil arquivos (~0,6 GB a 8 KiB), num pendrive de 14,44 GB; se `ensureFreeSpace` recusar, a prova vai para
um pendrive maior. **Controle:** antes de T1, o teste em FAT32 real com o esquema atual falha em ~#12.572.

**Pendente, fora do código:** procurar na telemetria `The directory or file cannot be created` (e "Não é possível
criar a pasta ou arquivo") para medir quantos clientes já caíram nisso. EA FC/FIFA com patch de faces é o caso
típico.
