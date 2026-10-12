# Bug: gravação no pendrive FAT32 esgota as 65.536 entradas da pasta `faces` e o rename do `.xbox-companion-part` falha

## Status

- **Corrigido e testado:** fix de producao na 2.12.110 (2026-10-09, ja no fluxo principal antes desta execucao);
  teste em FAT32 real do caminho de recuperacao e prova pela UI no pendrive de teste em 2026-10-12 (pipeline
  20261012-0329, teste rodada 1 aprovado).
- **Commits:** fix `2037158`, `e712105`, `1ce5e27` (2.12.110); teste novo `f6efd7f` (rebaseado sobre `origin/main` @
  `2f4716e`; o SHA publicado pode mudar no rebase do `publish`).
- **Onde:** `src/server/services/pipeline/local_resilient.go::copyLocalEntry` (temporario na staging do dispositivo,
  `localStagingPath`), `::copyTreeLocal` + `::rebuildSaturatedFATFolder` (regrava uma vez a pasta saturada),
  `fat_directory.go::checkFATDirectoryLimits`/`isFATDirectoryFull`; teste novo
  `src/server/services/pipeline/local_resilient_fat32_test.go::TestFAT32CopyTreeLocalRecoversFragmentedDirectory`.
- **Evidencia:** `C:\projects\.bugfix-xbox360\evidencia\20261012-0341-pipeline-gravacao-local-fragmenta-pasta-fat32-ate-o-limite-de-65536-entradas-e-o-rename-falha_2026-10-09T12-00\`
  (`LEIAME.md`). Pendrive de teste serial `247700023090` (`E:`, FAT32), com lock entre projetos.
  - **Offline:** `go vet ./services/pipeline/` limpo; sem `GODSEND_FAT32_TEST_DIR` os 4 `TestFAT32*` dao SKIP;
    `go test ./services/pipeline/ -count=1` ok.
  - **Controle positivo:** `TestFAT32LegacyPartSuffixExhaustsDirectory` PASS — o esquema antigo falha no #12.569 com
    `rename ...xbox-companion-part ...: The directory or file cannot be created.` (o texto do print do cliente); a fase
    "2.12.109" do teste novo reproduz o mesmo estado (#12.569) antes da recuperacao (`t2a-go-test.log`,
    `t2a-r1b-recovers.log`).
  - **T2-a (FAT32 real):** `TestFAT32CopyTreeLocalFitsLargeDirectory` PASS (934 s);
    `TestFAT32CopyTreeLocalRecoversFragmentedDirectory` PASS (1542 s): 1 `ERROR_CANNOT_MAKE` em `face_16661` visto pelo
    seam, log `pasta FAT32 ... esgotou as entradas com espacos fragmentados; regravando a pasta a partir do arquivo
    1/13146`, 13.146 arquivos gravados, marcador removido, staging vazia. A 1a tentativa foi morta pelo Claude Code por
    memoria do sistema (ambiente); a retomada rodou so o teste novo, com o mesmo branch e base.
  - **T2-b (UI, app da lane):** Catalogo -> Digimon All Star Rumble (XEX, 89 arquivos, 0,41 GB) -> pendrive `E:\` ->
    Fila `Gravado no dispositivo!`; 118 amostras durante `Gravando e verificando`: nenhum `*.xbox-companion-part` na
    pasta do jogo e `E:\.xbox-downloader\copy-staging` presente, vazia no fim; sem `.xbox-companion-installing`. Backend
    com Path na lane (`wt-1\dist\godsend-windows-x64.exe`) e banner na Home. Jogos Instalados lista o jogo (com o app
    reaberto; logo apos o fim o cache de 15 s do scanner ainda mostrava 0).
  - **T3:** `go test -count=1 ./...` em `src/server`: 9 pacotes `ok`, rc 0; `test:safety`: 327 pass / 0 fail.
  - **T4:** `t2b-log-janela.txt`: banner v2.12.110, `LOCAL XEX: 89 arquivos (0.41 GB) -> E:\Games\...`, nenhum erro do
    backend; so o console error de CSP das fontes do Google, pre-existente.
  - Ambiente: `simpleMode=false`/`errorReporting=false` no `config.json` dev durante o teste, original devolvido; os 2
    jobs antigos de `pending_queue/` da lane (destino `E:\`) ficaram fora e foram devolvidos. Sobra no pendrive
    `E:\godsend-fat32-test-1791788917662313200` (da tentativa morta; remocao bloqueada pela protecao do ambiente; so
    arquivos vazios, descartavel).
- **Falta para `closed/`:** versao publicada com o fix (subida de versao + `build-and-upload.ps1`, do dono); instalar o
  EA FC 26 Legacy Edition inteiro num pendrive FAT32 pela UI ate concluir (10-16 h; depende do bug irmao
  `pipeline-jogo-xex-com-145-mil-arquivos-...`) e o jogo abrir no console; confirmacao do cliente.

- **Detectado em:** 2026-10-09, relato do dono com print (fila "EA FC 26 Legacy Edition", estado Erro)
- **Origem:** gravação local em modo pendrive — `src/server/services/pipeline/local_resilient.go::copyLocalEntry`
- **Estado:** passada 3 — T1–T3 implementadas e testadas (2.12.110, não publicada). Falta a prova ponta a ponta
  com o jogo real no pendrive do dono

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

## Correção aplicada (2.12.110)

- **T1** — `local_resilient.go::copyLocalEntry(entry, root, dst, onProgress)`: temporário em
  `localStagingPath(root, dst)` = `<root>/.xbox-downloader/copy-staging/%08X.TMP` (CRC32 IEEE do caminho de `dst`
  relativo a `root`, com `/`). Apaga `<dst>.xbox-companion-part` (`legacyLocalPartSuffix`) antes de gravar. As
  limpezas de `copyTreeLocal` e `copyFileLocal` (arquivo já íntegro) apagam a sobra antiga **e** o temporário da
  staging. **Desvio:** pasta `copy-staging/` em vez de `staging/`, pelo motivo nas notas acima.
- **T2** — `copyTreeLocal`: com volume FAT e `isFATDirectoryFull(copyErr)` (errno 82, só no Windows),
  `rebuildSaturatedFATFolder(folder, manifestChildren[folder])` apaga os arquivos regulares do manifesto (e sobras
  `.xbox-companion-part`) **daquela pasta**, mantendo e contando o resto; o laço (agora `entryLoop` com índice
  explícito) recomeça no primeiro arquivo do manifesto naquela pasta, e `doneBytes` volta à soma das entradas
  anteriores. Uma vez por pasta (`rebuiltFolders`); um segundo 82 encerra com `ErrLocalDelivery`. **Desvio:** o
  plano dizia "apagar os arquivos regulares diretamente nessa pasta"; apagar só os do manifesto evita apagar DLC ou
  arquivo do usuário numa pasta compartilhada (`Content/…/00000002`). Se, contando os que ficam, a pasta não cabe,
  devolve `ErrFAT32DirectoryLimit` sem apagar nada. Também: arquivos de uma pasta **não** são contíguos no
  `filepath.Walk` quando há subpasta no meio; recomeçar no primeiro arquivo dela e reconferir por hash o que vem
  depois cobre esse caso.
- **T3** — `fat_directory.go`: `fatDirentCount` (regra do simulador), `localManifestChildren` (nome real por pasta,
  porque a caixa muda a contagem: `Data0000` ocupa 2, `data0000` 1), `checkFATDirectoryLimits` chamado em
  `copyTreeLocal` logo após a checagem de 4 GB, antes de qualquer gravação. `ErrFAT32DirectoryLimit` entrou em
  `fallback.go::isFAT32LimitError`: troca de provedor (ISO/GOD) em vez de interromper a cadeia. Não foi preciso
  mexer em `huggingface.go`: o erro sobe de `InstallXEXLocal` embrulhado com `%w` ("Gravação local: %w").
  `localWriteErrorText` troca o texto do errno 82 por português nas mensagens finais de `copyTreeLocal` e
  `copyFileLocal`; o erro original vai para o log.

## Testes executados

- `go vet ./...` e `go test ./... -count=1` em `src/server`: verdes após cada task. `npm run build:server`: ok
  (x64 e ia32) após cada task.
- Novos: `TestCopyLocalEntryKeepsTemporaryOutOfDestinationFolder` (lista a pasta durante a escrita: só o nome final;
  sobra antiga apagada), `TestCopyLocalEntryPromotesValidStagedFileOnResume`, `TestFATDirentCount`,
  `TestLocalManifestChildrenListsFilesAndSubfolders`, `TestCopyTreeLocalRebuildsSaturatedFATFolderOnce` (82
  injetado em `faces/c.bin`: `faces/a.bin`, já certo, é regravado; `aaa/first.bin` não; `alheio.txt` fica),
  `TestCopyTreeLocalGivesUpWhenRebuiltFATFolderStillFull`, `TestCheckFATDirectoryLimits` (os 13.146 nomes
  sintéticos contam **58.494**, o mesmo número do simulador; +1.600 nomes → recusa nomeando a pasta),
  `TestCopyTreeLocalRejectsOversizedFATFolderBeforeWriting` (nada criado no destino),
  `TestLocalWriteErrorTextTranslatesCannotMake`.
- **Teste em FAT32 real** (`GODSEND_FAT32_TEST_DIR='E:\' go test ./services/pipeline/ -run TestFAT32 -v`), pasta
  `E:\godsend-fat32-test-<n>` apagada no fim (conferido: `ls E:/ | grep godsend` → nada), `ok … 1869.957s`:
  - **controle** `TestFAT32LegacyPartSuffixExhaustsDirectory`: o esquema antigo falhou no arquivo **#12.569**
    (12.568 gravados), `face_16660_…`, com `rename …xbox-companion-part …: The directory or file cannot be created.`
    — o texto do print e **o mesmo número que o simulador previu** para esses nomes a 8 KiB (794 s);
  - **correção** `TestFAT32CopyTreeLocalFitsLargeDirectory`: `copyTreeLocal` gravou os **13.146** arquivos na mesma
    pasta, staging vazia no fim (12m59s de gravação, com `Sync` e SHA-256 por arquivo).
- **Instabilidade pré-existente, não regressão:** com `-count=10..40`, testes que gravam em `t.TempDir()` falham às
  vezes na **limpeza** (`TempDir RemoveAll cleanup: … The directory is not empty`), nunca numa asserção. O código
  de antes da T1 (`git archive a53aa46 src/server`) falha igual em `TestOptimizedStreamingLocalCopyAndManifest`
  (2 de 40). Provável antivírus/indexador segurando arquivo recém-criado.

## Pendente

- **Prova ponta a ponta** (abaixo) com o app e o pendrive do dono: não executada nesta sessão — escreve GBs no
  dispositivo do dono e leva horas; fica para o dono decidir quando.

**Pendente, fora do código:** procurar na telemetria `The directory or file cannot be created` (e "Não é possível
criar a pasta ou arquivo") para medir quantos clientes já caíram nisso. EA FC/FIFA com patch de faces é o caso
típico.

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** bloqueado — o codigo ja esta corrigido e testado (T1-T3, 2.12.110); falta so a prova com o jogo
real num pendrive FAT32, e o pipeline nao pode gravar em disco real (manual, secao Teste: "Disco real: NENHUM esta
liberado").
**Complexidade:** alta — pipeline de gravacao local (`src/server/services/pipeline/`), criterio do `docs/bugs/open/README.md`.
**Severidade:** medio — impede instalar em XEX num pendrive FAT32 so os jogos com pasta de ~13 mil arquivos (EA FC 26
Legacy Edition e parecidos); com o fix, a verificacao previa ainda troca para ISO/GOD quando a pasta nao cabe.
**Arquivos a alterar (reserva da onda):** nenhum — o codigo nao muda nesta execucao.

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

A causa raiz e a das secoes acima, e a correcao ja esta na arvore (`origin/main` desta execucao, `d7bd9ad`). Lidos
nesta sessao:

- `src/server/services/pipeline/local_resilient.go::localStagingPath` — o temporario fica em
  `<root>/.xbox-downloader/copy-staging/%08X.TMP` (CRC32 do caminho relativo, nome 8.3 de 1 entrada), fora da pasta do jogo.
- `local_resilient.go::copyLocalEntry` — apaga a sobra `<dst>.xbox-companion-part`; promove o staging valido (tamanho
  + SHA-256) na retomada; grava, faz `Sync`, confere o tamanho e faz `os.Rename(partial, dst)` com 5 tentativas; em
  qualquer erro apaga o temporario e devolve o erro cru.
- `local_resilient.go::copyTreeLocal` — em FAT chama `localManifestChildren` + `checkFATDirectoryLimits` antes de gravar
  qualquer byte (devolve `ErrFAT32DirectoryLimit`); no laco `entryLoop`, um erro com `isFATDirectoryFull` (errno 82, so
  Windows) chama `rebuildSaturatedFATFolder` uma vez por pasta e recomeca no primeiro arquivo do manifesto daquela
  pasta; um segundo 82 na mesma pasta devolve `ErrLocalDelivery` com `localWriteErrorText` (texto em portugues).
- `local_resilient.go::rebuildSaturatedFATFolder` — apaga so os arquivos do manifesto e sobras `.xbox-companion-part`
  da pasta; se, contando o que fica, a pasta nao cabe, devolve `false` sem apagar nada (vira `ErrFAT32DirectoryLimit`).
- `src/server/services/pipeline/fat_directory.go` — `fatDirentCount`, `fatFitsShortName`, `isFATDirectoryFull`,
  `localWriteErrorText`, `checkFATDirectoryLimits`, `localManifestChildren`, `fatFolderEntriesNeeded`: as regras do
  simulador, sem desvio encontrado na leitura.
- `fallback.go:20` — `isFAT32LimitError` inclui `ErrFAT32DirectoryLimit` (troca para provedor ISO/GOD).

Nenhum defeito encontrado na leitura do fix. Nada a corrigir nesta execucao.

### Provas (comando literal -> resultado)

- `git log --oneline --all -- src/server/services/pipeline/fat_directory.go` -> `1ce5e27` (T3); `git log --all --grep=fat32-ate`
  -> `2037158` (T1), `e712105` (T2), `1ce5e27` (T3), `a2d3987` (docs da correcao aplicada). Todos ja no fluxo principal.
- `grep -n "copy-staging\|ErrFAT32DirectoryLimit\|rebuildSaturatedFATFolder\|legacyLocalPartSuffix" -r src/server` ->
  presentes em `local_resilient.go` (388, 392, 409, 519, 645, 674, 680, 808), `fat_directory.go:94`, `fallback.go:20` e nos testes.
- `grep -n 2.12.110 package.json CHANGELOG.md` -> `"version": "2.12.110"` e `## [2.12.110] - 2026-10-09` com a entrada do fix.
- A prova do fix em FAT32 real ja foi feita na sessao de implementacao (secao "Testes executados": controle antigo
  falha no #12.569 com o texto do print; `copyTreeLocal` novo grava os 13.146 nomes).

### Hipoteses descartadas (e por que)

- **Veredito `corrigir` para o pipeline levar o doc a `retest/`.** Nao ha arquivo para o dev mudar; uma onda sem
  codigo so repetiria o `go test` que ja passou. O T2 numa pasta LOCAL (NTFS) nao exercita o FAT e nao prova nada
  deste bug.
- **Outras gravacoes com temporario ao lado do destino no pendrive.** `grep` em `src/server` (`.part"`, `.tmp"`,
  `.partial"`, fora de teste) -> so `app/config.go:415` (probe de escrita, 1 arquivo). No Electron, os escritores com
  temporario (`secureComponentStaging.ts`, `simulatedTransactionalWriter.ts`...) gravam componentes do BadAvatar,
  pastas pequenas; nao atingem o teto. Fora do escopo.

### Tarefas

- [x] T1-T3 — ja implementadas e commitadas (`2037158`, `e712105`, `1ce5e27`), testes na secao "Testes executados".
- [ ] Dono: prova ponta a ponta com o pendrive (abaixo), publicar a versao 2.12.110 (`build-and-upload.ps1`) e mover o
  doc para `retest/` (com `## Status`) e depois `closed/` com a confirmacao.

### Plano de teste

- **Offline (sem slot):** `go test ./services/pipeline/ -count=1` em `src/server` (ja verde); com um volume FAT32,
  `GODSEND_FAT32_TEST_DIR='<volume>' go test ./services/pipeline/ -run TestFAT32 -v` (~31 min, ja verde em `E:`).
- **T2 reproducao como o usuario (precisa do pendrive, so o dono):** app 2.12.110 aberto, Fila com o item "EA FC 26
  Legacy Edition" em Erro (scratch `Ready/EA FC 26 Legacy Edition/.source_hf.zip` preservado), pendrive `E:` FAT32 com
  a pasta `faces` saturada da tentativa antiga -> clicar em tentar de novo. SINAL do fix: linha `LOCAL [...]: pasta
  FAT32 ... esgotou as entradas ... regravando a pasta` no console do backend, o item termina Concluido e
  `faces` tem 13.147 arquivos; nenhum texto "The directory or file cannot be created". Risco ja anotado: espaco livre
  do pendrive de 14,44 GB.
- **Controle positivo:** ja feito em FAT32 real (`TestFAT32LegacyPartSuffixExhaustsDirectory`, falha no #12.569 com o
  errno 82); no pendrive do dono, o proprio item em Erro e o controle.
- **T3 regressao direcionada:** gravacao local de outro jogo XEX e de um GOD num destino local (`go test` cobre
  retomada por hash, staging promovido, limite de 4 GB) e `npm --prefix src/electron-app run test:safety` (o
  scanner ignora `.xbox-downloader/`).

### Sessoes seguintes

- dev: nenhuma (veredito bloqueado; codigo pronto).
- teste: nenhuma no pipeline; a prova e do dono com o pendrive real.

**O que destrava:** o dono rodar a T2 acima com o pendrive `E:` (ou outro FAT32 com >= 15 GB livres) e publicar a
2.12.110; com isso o doc vai para `retest/` e, com a confirmacao do cliente, `closed/`.

## Desbloqueio (2026-10-12)

O motivo do veredito `bloqueado` acima ("nenhum disco real liberado") **caiu**: o dono liberou o pendrive de
teste `USB DISK 2.0`, serial `247700023090` (14,5 GB, MBR, hoje FAT32 com rotulo `PS2`), com conteudo
descartavel — pode formatar e gravar. Regra, identificacao pelo serial e lock entre projetos: manual do pipeline
(`.claude/skills/pipeline-correcao-bugs/projeto.md`, secao Teste). A proxima execucao do pipeline deve replanejar
este bug, nao exclui-lo pelo veredito antigo.

- **O estado de partida da T2 nao existe mais:** o pendrive foi usado pelo PS2Companion depois (10,8 GB de outro
  conteudo em 2026-10-12); a pasta `faces` saturada da tentativa antiga sumiu. O teste precisa recriar o estado
  (formatar FAT32 e gravar com o codigo anterior a `2037158` ate o errno 82 — o controle positivo) antes de provar
  a correcao.
- **Espaco continua sendo o risco:** jogo de 13,15 GB + folga de cluster (~0,6 GB) num volume de ~14,4 GB vazio;
  se `ensureFreeSpace` recusar, e ambiente (pendrive maior), nao reprovacao.

## Planejamento (pipeline 20261012-0329, 2026-10-12)

**Veredito:** corrigir — o fix de producao (T1-T3, 2.12.110) ja esta no fluxo principal; falta o teste repetivel em
FAT32 real do caminho que destrava o pendrive ja fragmentado (T2, `rebuildSaturatedFATFolder`), hoje provado so com
errno 82 injetado e por uma linha no log do dono, e a prova no pendrive de teste liberado em 2026-10-12.
**Complexidade:** alta — pacote `src/server/services/pipeline/` (criterio do `docs/bugs/open/README.md`); a mudanca
desta execucao e so de teste, sem codigo de producao.
**Severidade:** medio — atinge so o subconjunto de jogos XEX com uma pasta de ~13 mil arquivos (EA FC 26 Legacy
Edition) em pendrive FAT32; com o fix publicado a gravacao passa da pasta, e a verificacao previa troca para ISO/GOD
quando a pasta nao cabe.
**Arquivos a alterar (reserva da onda):**
- `src/server/services/pipeline/local_resilient_fat32_test.go` — teste novo em FAT32 real: pasta fragmentada pelo
  esquema antigo ate o errno 82 e, na mesma pasta, `copyTreeLocal` recupera e grava os 13.146 nomes.
- `docs/RESILIENT-LOCAL-INSTALL.md` — linha 78 (lista dos testes em FAT32 real) cita o teste novo (doc-sync).

Sem `CHANGELOG.md` novo: a entrada da 2.12.110 (linhas 85-90) ja descreve o fix; teste nao muda nada para o usuario.

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

A causa raiz e a das secoes "Causa raiz" e "Correcao aplicada" acima; reconferida na fonte da lane (`c4874fa`):

- `src/server/services/pipeline/local_resilient.go::copyLocalEntry` (408) — apaga `<dst>.xbox-companion-part`; promove
  o temporario da staging se tamanho e SHA-256 conferem; senao grava em `localStagingPath(root, dst)` =
  `<root>/.xbox-downloader/copy-staging/%08X.TMP` (`localStagingDir`, linha 388) e faz `Rename` para `dst`. Em erro
  apaga o temporario e devolve o erro cru.
- `local_resilient.go::copyTreeLocal` (554-748) — em FAT: `localManifestChildren` + `checkFATDirectoryLimits` antes de
  gravar (devolve `ErrFAT32DirectoryLimit`); `ensureFreeSpace` so do que falta; marcador `.xbox-companion-installing`;
  laco `entryLoop`: arquivo existente com tamanho certo e reconferido por hash (`localFileMatches`) e pulado; senao
  `copyLocalEntryFunc` (seam, linha 509). Erro com `isFAT && isFATDirectoryFull(copyErr)` (682): na 1a vez por pasta
  (`rebuiltFolders`) chama `rebuildSaturatedFATFolder`, loga `LOCAL [<jogo>]: pasta FAT32 <pasta> esgotou as entradas
  com espacos fragmentados; regravando a pasta a partir do arquivo N/M` (710) e recomeca no primeiro arquivo do
  manifesto naquela pasta; na 2a devolve `ErrLocalDelivery` com `localWriteErrorText`. No fim remove o marcador.
- `local_resilient.go::rebuildSaturatedFATFolder` (522) — apaga os arquivos regulares do manifesto e sobras
  `.xbox-companion-part` da pasta; se o que sobra + nomes finais passa de `fatMaxDirectoryEntries` (65.536) devolve
  `false` sem apagar nada; erro de `Remove` devolve `(true, err)`.
- `fat_directory.go` — `fatErrorCannotMake = syscall.Errno(82)` (25), `isFATDirectoryFull` (68, so Windows).
- `local_resilient_fat32_test.go` (build tag `windows`) — `fat32FacesNames` (13.146 nomes, 58.494 entradas),
  `fat32TestRoot` (pula sem `GODSEND_FAT32_TEST_DIR`, falha se o volume nao e FAT, cria e apaga
  `godsend-fat32-test-<n>`), `TestFAT32LegacyPartSuffixExhaustsDirectory` (controle: o esquema antigo falha com
  `ERROR_CANNOT_MAKE` depois do #12.000) e `TestFAT32CopyTreeLocalFitsLargeDirectory` (pasta nova: grava tudo,
  staging vazia). **Nao ha teste em FAT32 real que parta da pasta ja fragmentada** — o caso de quem pegou o erro
  com a 2.12.109 e clica em "Tentar novamente" com a 2.12.110.
- Chamada no caminho do usuario: `interfaces/http/handlers.go::handleQueueRetry` (1137) -> `queue_resume.go::relaunchGame`
  (36; sem ISO local, `ProcessGameWithFallback` com `huggingface, ia, minerva`) -> `fallback.go` (124-138:
  `FindHuggingFaceEntry` no catalogo) -> `huggingface.go::ProcessHuggingFaceGameWithErr` (28; modo local:
  `InstallXEXLocal`, linha 163) -> `copyTreeLocal`.

### Provas (comando literal -> resultado)

- **O caminho de recuperacao ja rodou no app do dono, com o pendrive real fragmentado.**
  `grep -h "EA FC 26" "$APPDATA/xbox-360-companion-electron/logs/godsend-server-2026-10-09.log" | grep -i "LOCAL\|esgotou"`:
  - `14:21:41Z pid=56588` e `18:31:54Z` (backend 2.12.109): `erro transitorio ao gravar face_40110_... (tentativa
    1/3..3/3): rename ...xbox-companion-part ...: The directory or file cannot be created.` — o sintoma do print;
  - `pid=62020` com banner `[INFO] Xbox 360 Companion Backend Server v2.12.110` (19:56:23Z), `20:40:31Z LOCAL XEX:
    144851 arquivos` e `21:01:44Z ... pasta FAT32 E:\Games\EA FC 26 Legacy Edition - 454109F4\data\sceneassets\faces
    esgotou as entradas com espacos fragmentados; regravando a pasta a partir do arquivo 7841/144851`;
  - depois disso **nenhum** `cannot be created`/`esgotou` em `godsend-server-2026-10-09..12.log`, e o doc irmao conta
    38.009 arquivos no destino as 21:09 (horario local) — alem do ultimo de `faces` (~#20.988 na ordem do Walk).
  A copia nunca concluiu (nenhum `LogLocalComplete`; reinicios do app e o bug irmao de 10+ h), entao "pasta passou"
  e prova parcial, nao "jogo instalado".
- `git log -1 --format='%h %ci' 2037158 e712105 1ce5e27` -> 2026-10-09 13:25/13:31/13:37 -0300, antes do `pid=62020`.
- `grep -n "^func " src/server/services/pipeline/local_resilient_fat32_test.go` -> so `fat32FacesNames`,
  `fat32TestRoot`, `TestFAT32LegacyPartSuffixExhaustsDirectory`, `TestFAT32CopyTreeLocalFitsLargeDirectory`.
- `Get-Disk` (2026-10-12 ~03:40) -> disco 2 `USB DISK 2.0`, serial `247700023090`, 15.525.216.256 bytes, MBR;
  `Get-Volume` -> `E:` rotulo `PS2`, FAT32, Removable, 3,82 GB livres de 15,5 GB. Os testes FAT32 gravam so
  arquivos vazios (entradas de diretorio), cabem sem formatar.

### Hipoteses descartadas (e por que)

- **`bloqueado` de novo / `sem-codigo`.** O motivo do bloqueio (sem disco) caiu, e o pipeline so leva um bug ao teste
  com commit de codigo (`enqueue-test`: "nenhum commit de codigo no branch"). O que falta no codigo e real: o caminho
  T2 (pendrive ja fragmentado) nunca foi exercitado num FAT32 de verdade de forma repetivel.
- **T2 pela UI com o EA FC 26 inteiro no pendrive de teste.** Gravar 144.851 arquivos nesse pendrive leva 10-16 h
  (bug irmao `pipeline-jogo-xex-com-145-mil-arquivos-...`, medido 36-150 arquivos/min); o controle (2.12.109) so
  falha no ~#20.400 (2-9 h); 13,15 GB + folga num volume de 14,4 GB; e o slot E2E ficaria preso o dia todo. A parte
  da UI vira um jogo XEX pequeno (T2-b abaixo) e o jogo real vai para "falta para close".
- **Jogo sintetico pela UI** (pasta de 13 mil arquivos servida como se fosse do catalogo). A UI so instala o que o
  catalogo HF/IA/Minerva resolve (`FindHuggingFaceEntry` casa por pontuacao de titulo: um nome inventado cai num
  jogo real) ou uma ISO em `Transfer/`; XDVDFS nao representa pasta com mais de 262.140 bytes de tabela (doc irmao),
  entao uma ISO nao carrega `faces`. Montar catalogo falso seria testar outra coisa.
- **Controle positivo com build anterior a `2037158`.** O projeto nao tem `deploy --at-base`, a base ja tem o fix, e
  a sessao nao builda fora do helper. O teste novo recria o esquema antigo dentro dele (como o controle existente) —
  e o controle fica no mesmo volume e na mesma execucao.
- **Dependencia do bug irmao** (gravacao lenta; pode mudar `copyLocalEntry`). Nao ha arquivo em comum (o irmao
  reserva `local_resilient.go`/`local_resilient_test.go`); o teste novo exercita `copyTreeLocal` como estiver, entao
  rodar depois do irmao so o torna regressao dele. Sem `depende_de`.
- **Banner `Server v2.12.109` em `main.go:78` divergente do `v2.12.110` da linha 25** (visto no log): ja registrado em
  `pipeline-report-de-telemetria-do-backend-nao-carrega-versao-do-app_2026-10-10T23-30.md` e
  `release-backend-go-sem-identidade-...`. Nao e bug novo.

### Tarefas

- [ ] `src/server/services/pipeline/local_resilient_fat32_test.go::TestFAT32CopyTreeLocalRecoversFragmentedDirectory`
  (novo, mesma build tag e helpers):
  1. `root := fat32TestRoot(t)`; origem em `t.TempDir()/faces` com os `fat32FacesNames()` vazios; destino
     `root/Games/EA FC 26/faces` (mesmo layout do `...FitsLargeDirectory`).
  2. Fase "2.12.109": no destino, para cada nome em ordem, `os.WriteFile(dst+legacyLocalPartSuffix, nil)` + `os.Rename`;
     no primeiro erro, exigir `errors.Is(err, fatErrorCannotMake)` e indice >= 12.000 (senao `Fatalf`, como o controle
     existente), apagar o `.xbox-companion-part` como a 2.12.109 fazia e parar. Gravou tudo -> `Fatalf("premissa
     mudou")`. `t.Logf` com o indice.
  3. Fase "2.12.110": `PrepareLocalDevice(root)`, `app.NewApp()` com a conexao local (como `...FitsLargeDirectory`);
     envolver `copyLocalEntryFunc` (restaurar no `t.Cleanup`) contando os erros com `isFATDirectoryFull`; chamar
     `service.copyTreeLocal(source, destination, root, "FAT32", "XEX")` -> tem que devolver `nil`.
  4. Assercoes: exatamente 1 erro 82 visto pelo seam (prova que a recuperacao rodou, e nao que a pasta "coube por
     acaso"); `os.ReadDir(destination)` = 13.146 nomes, todos do manifesto, nenhum `.xbox-companion-part` e nenhum
     `.xbox-companion-installing`; staging `localStagingDir` vazia; `t.Logf` com o tempo de cada fase.
  Prova offline (dev): `go vet ./services/pipeline/` e `go test ./services/pipeline/ -run TestFAT32 -count=1 -v` sem a
  variavel -> os tres `SKIP` (compila); `go test ./services/pipeline/ -count=1` verde. **O dev nao roda no pendrive**
  (ambiente do slot); quem roda e o teste.
- [ ] `docs/RESILIENT-LOCAL-INSTALL.md:78` — acrescentar: "e uma pasta ja fragmentada pelo esquema antigo ate o
  `ERROR_CANNOT_MAKE` e recuperada por `copyTreeLocal`, que a regrava uma vez e grava os 13.146 nomes".
- Commit: `fix(pipeline): teste em FAT32 real da recuperacao de pasta ja fragmentada (bug: <slug>)`.

### Plano de teste

- **Offline (sem slot):** `cd src/server; go vet ./services/pipeline/; go test ./services/pipeline/ -count=1` verde;
  `go test ./services/pipeline/ -run TestFAT32 -v` sem `GODSEND_FAT32_TEST_DIR` -> 3 testes `SKIP` (+ o bench do irmao).
  Conferir na diff que so mudou o `_test.go` e o doc.
- **Pendrive (vale para T2-a e T2-b):** lock `C:\projects\.pendrive-teste-247700023090.lock` (manual; outro com < 3 h
  = ambiente); `Get-Disk | Where-Object SerialNumber -eq '247700023090'` -> numero do disco ->
  `Get-Partition -DiskNumber <n> | Get-Volume` -> letra `<L>` e `FileSystem` = FAT32. Nunca outra letra. Nao precisa
  formatar (3,82 GB livres hoje); se o volume nao for FAT32, formatar FAT32 so esse disco, pelo serial.
- **T2-a reproducao do estado do cliente em FAT32 real (o nucleo do bug; ~55 min, em BACKGROUND):**
  `cd src/server; $env:GODSEND_FAT32_TEST_DIR='<L>:\'; go test ./services/pipeline/ -run 'TestFAT32(LegacyPartSuffix|CopyTreeLocal)' -count=1 -v -timeout 3h`
  (a saida vai para a evidencia). Esperado: `TestFAT32LegacyPartSuffixExhaustsDirectory` PASS com o log `esquema
  antigo falhou no arquivo #~12.5xx ... The directory or file cannot be created.` (o texto do print);
  `TestFAT32CopyTreeLocalFitsLargeDirectory` PASS; `TestFAT32CopyTreeLocalRecoversFragmentedDirectory` PASS com 1
  erro 82 recuperado e 13.146 arquivos. No fim, `ls <L>:\ | findstr godsend-fat32-test` vazio.
  Por que nao pela UI: o caminho do cliente com o jogo real leva 10-16 h e nao cabe com folga (Hipoteses
  descartadas); a UI desse caminho ja foi exercitada no app do dono (Provas, `pid=62020`), mas sem concluir.
- **T2-b o mesmo fluxo de gravacao pela UI, num jogo pequeno (app da lane, `npm start`, no slot):** estado de
  partida: config copiada para a evidencia; destino local = o pendrive de teste `<L>:\`. Acao: Catalogo -> um jogo
  XEX do HuggingFace com menos de ~2 GB -> instalar no pendrive -> acompanhar na Fila/Home. SINAL: durante o
  `Gravando e verificando... N% (i/M)`, `Get-ChildItem -Recurse -Force '<L>:\Games\<jogo> - <TitleID>' -Filter
  *.xbox-companion-part` vazio e `<L>:\.xbox-downloader\copy-staging` existe; no fim o item termina concluido, a
  staging esta vazia, nao ha `.xbox-companion-installing` na pasta do jogo, e o console do backend tem `LOCAL XEX: M
  arquivos (...) -> <L>:\Games\...` sem `cannot be created`. Isso prova que o binario da lane grava pelo esquema
  novo no caminho do usuario; o teto de 65.536 e provado pela T2-a.
- **Controle positivo:** o proprio `TestFAT32LegacyPartSuffixExhaustsDirectory` e a fase "2.12.109" do teste novo
  reproduzem o esquema antigo no mesmo pendrive e TEM que falhar com `ERROR_CANNOT_MAKE` depois do #12.000; se
  gravarem tudo, o teste nao detecta o bug (reprovar com "controle nao reproduz"). Historico do sintoma pela UI: log
  do dono 2026-10-09 `14:21:41Z`/`18:31:54Z` (2.12.109). Sem build anterior ao fix (Hipoteses descartadas).
- **T3 regressao direcionada:** `go test -count=1 ./...` em `src/server` e `npm --prefix src/electron-app run
  test:safety` (linha de base no manual; a falha de limpeza `TempDir RemoveAll cleanup` e conhecida, nao conta).
  Na T2-b, a Biblioteca/scan do pendrive lista o jogo pequeno como instalado (o scanner ignora `.xbox-downloader/`).
- **Falta para close (vai no `## Status`):** publicar a versao com o fix (`build-and-upload.ps1`, dono); instalar o
  EA FC 26 Legacy Edition inteiro num pendrive FAT32 pela UI ate concluir (10-16 h; depende do bug irmao) e o jogo
  abrir no console; confirmacao do cliente.

### Sessoes seguintes

- dev: effort medium, ultrathink nao — um teste novo copiando o padrao de dois testes vizinhos e do seam
  `copyLocalEntryFunc`; nao roda no pendrive, entao tem de acertar pela leitura.
- teste: effort medium, ultrathink nao — execucao mecanica (lock e serial do pendrive, `go test` longo em
  background, um jogo pequeno pela UI); o julgamento sutil e so o do controle positivo, ja descrito acima.

## Correcao (pipeline 20261012-0329, rodada 1)

So teste e doc; nenhum codigo de producao mudou (o fix T1-T3 da 2.12.110 ja esta no fluxo principal).

- `src/server/services/pipeline/local_resilient_fat32_test.go::TestFAT32CopyTreeLocalRecoversFragmentedDirectory`
  (novo, build tag `windows`, atras de `GODSEND_FAT32_TEST_DIR` como os vizinhos):
  1. origem `t.TempDir()/faces` com os 13.146 `fat32FacesNames()` vazios;
  2. fase "2.12.109": em `root/Games/EA FC 26/faces`, `WriteFile(<nome>.xbox-companion-part)` + `Rename` ate o
     primeiro erro; exige `ERROR_CANNOT_MAKE` depois do #12.000 (senao `Fatalf`, como o controle existente), apaga
     o temporario que falhou (o `os.Remove(partial)` da versao antiga); gravou tudo -> `Fatalf("premissa mudou")`;
  3. fase "2.12.110": `copyLocalEntryFunc` embrulhado (restaurado no `Cleanup`) conta os erros com
     `isFATDirectoryFull`; `copyTreeLocal(source, root/Games/EA FC 26, root, ...)` tem que devolver `nil`;
  4. assercoes: exatamente **1** errno 82 visto pelo seam (a recuperacao rodou; nao "coube por acaso"); `faces` com
     13.146 nomes, todos do manifesto (logo nenhum `.xbox-companion-part`); `.xbox-companion-installing` removido;
     staging `localStagingDir` vazia; `t.Logf` com o indice da falha e o tempo de cada fase.
- **Desvio do plano (layout):** o plano pedia `destination = root/Games/EA FC 26/faces` (como `...FitsLargeDirectory`).
  Usei `dstDir = root/Games/EA FC 26` com `faces` como subpasta da origem e do destino. Motivo, lido em
  `copyTreeLocal`: `writeInstallInProgressMarkerFunc(dstDir, ...)` cria o marcador `.xbox-companion-installing`
  (3 entradas) em `dstDir` ANTES do laco; com `dstDir` = a pasta saturada, ele so caberia por sorte no buraco de 6
  que o temporario apagado deixou, e consumiria esse buraco. No caso real o marcador fica na pasta do jogo e `faces`
  e `data/sceneassets/faces` — o layout novo e o do cliente.
- **Sequencia esperada no FAT32 real** (leitura do `copyTreeLocal`, nao executada aqui): os ~12.568 arquivos ja
  gravados sao reaproveitados por hash (`localFileMatches`, vazios = origem vazia); o arquivo que falhou na fase 1
  entra no buraco de 6 (rename da staging pede 4-5); o seguinte falha com 82 -> `rebuildSaturatedFATFolder` apaga os
  arquivos do manifesto em `faces`, log `LOCAL [FAT32]: pasta FAT32 ... esgotou as entradas ...; regravando a pasta a
  partir do arquivo 1/13146` e regrava tudo compactado (58.494 de 65.536).
- `docs/RESILIENT-LOCAL-INSTALL.md` (lista dos testes em FAT32 real) cita o teste novo.
- Sem entrada nova no `CHANGELOG.md` (planejamento: so teste, nada muda para o usuario).

**Build (helper):** `pipeline.py build` -> rc 0 (server + tsc + renderer:typecheck).

**Provas offline (dev):** `cd src/server; go vet ./services/pipeline/` -> sem saida;
`go test ./services/pipeline/ -run TestFAT32 -count=1 -v` sem a variavel -> `SKIP` em
`TestFAT32LocalCopyBench`, `...LegacyPartSuffixExhaustsDirectory`, `...FitsLargeDirectory`,
`...RecoversFragmentedDirectory`, `PASS`; `go test ./services/pipeline/ -count=1` -> `ok 7.094s`. O dev nao rodou no
pendrive (ambiente do slot de teste).

**Ajuste ao Plano de teste (T2-a):** o filtro `-run 'TestFAT32(LegacyPartSuffix|CopyTreeLocal)'` ja pega o teste novo.
Esperado no log dele: `fase 2.12.109: esquema antigo falhou no arquivo #~12.5xx`, uma linha `ERROR_CANNOT_MAKE em
faces\face_...` e `fase 2.12.110: 13146 arquivos gravados em ...`. Tempo estimado: fase 1 ~13 min + fase 2 ~13 min de
gravacao + o hash dos ~12.5 mil reaproveitados — `-timeout 3h` cobre os tres testes.
