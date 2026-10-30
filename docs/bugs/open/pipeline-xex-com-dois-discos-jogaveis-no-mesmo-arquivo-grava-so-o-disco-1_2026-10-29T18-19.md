# Bug: rip XEX com dois discos jogáveis no mesmo arquivo grava só o Disco 1 e o console pede o Disco 2

- **Detectado em:** 2026-10-29 (chamado de suporte por WhatsApp, cliente +55 34 8874-5759, print relatado pelo dono)
- **Origem:** `xbox-360-companion/pipeline`: `infrastructure/helpers/helpers.go::FindXEXFolder` (L247), chamado por
  `services/pipeline/huggingface.go` (L68), `minerva.go` (L73, L217), `digital.go` (L194) e `pipeline.go` (L223)
- **Errors (serviço):** nenhum (o job termina "pronto", sem erro)
- **Classe:** fail (jogo entregue incompleto, reportado como pronto)
- **Severidade:** P1 - Alto. O jogo não passa da troca de disco; nenhum aviso antes nem depois da instalação.
- **Complexidade:** alta (pipeline multidisco, 5 call-sites)
- **Versões:** 2.12.118 (código lido em `42b5739`)
- **Reincidência:** não. Caso vizinho do GTA V ([pipeline-gta5-multidisco-termina-pronto-e-nao-inicia-no-console-reincidencia_2026-10-15T15-40](pipeline-gta5-multidisco-termina-pronto-e-nao-inicia-no-console-reincidencia_2026-10-15T15-40.md)),
  mas lá o segundo disco é de **instalação** (vira `Content/`); aqui os dois discos são **jogáveis**.

## Sintoma

Cliente instalou "Mass Effect 2 + PT-BR + DLC" (HD interno, método XEX). No console o jogo pede o Disco 2. No app, o único
"Disco 2" que ele acha é `Mass Effect 2 (Canada) (Disque 2)`, de outra release, e pergunta qual opção usar.

## Evidência

Entrada do catálogo (`src/server/cache/hf_xbox360.json`, `game_entries`):

```
hf_xbox360\x00mass effect 2 + pt-br + dlc  ->  {'collection_id': '14282.78MB',
  'filename': 'https://huggingface.co/datasets/luistiagos/xbx/resolve/main/Mass%20Effect%202%20%2B%20PT-BR%20%2B%20DLC.rar'}
```

`curl -sIL <url>` -> `content-length: 14976576949`, `accept-ranges: bytes`. RAR5 (`Rar!\x1a\x07\x01\x00`).

Conteúdo listado só pelos cabeçalhos RAR5 por HTTP Range, sem baixar o arquivo (script
`rar5list.py` no scratchpad da sessão: anda bloco a bloco por `header size + data size`, imprime o nome do tipo 2).
Trecho (a saída foi filtrada por extensão e cortada em 80 linhas):

```
Mass Effect 2 + PT-BR + DLC/Content/0000000000000000/454108CE/00000002/...   (21 pacotes, DLC)
Mass Effect 2 + PT-BR + DLC/Content/0000000000000000/454108CE/00009000/...   (16 pacotes)
Mass Effect 2 + PT-BR + DLC/MASS EFFECT 2/DISCO 1/default.xex   7849984
Mass Effect 2 + PT-BR + DLC/MASS EFFECT 2/DISCO 1/Unreap.xex    1204224
Mass Effect 2 + PT-BR + DLC/MASS EFFECT 2/DISCO 2/default.xex   7849984
Mass Effect 2 + PT-BR + DLC/MASS EFFECT 2/DISCO 2/Unreap.xex    1204224
```

Ou seja: o arquivo traz **a release inteira** — os dois discos jogáveis, lado a lado, mais a DLC.

## Causa raiz

1. `helpers.FindXEXFolder(extDir)` anda o extraído, junta toda pasta com `default.xex` e devolve **uma**: a primeira que
   `isInstallDiscFolder` não marca como disco de instalação. A ordem do `filepath.Walk` é léxica, então sai `DISCO 1`.
   `DISCO 2` nunca é devolvida.
2. Os ramos XEX dos 5 call-sites gravam só essa pasta (`FTP.TransferXEX` / `InstallXEXLocal` / `CreateZipFromDir`).
3. O que mais é aproveitado do arquivo é só o que `installCompanionDiscContent` -> `helpers.FindCompanionContentPayloads`
   acha: árvores `Content/<0..0>/<TitleID>/<tipo>`. Por isso a DLC (`00000002`) chega e o Disco 2 não — ele não tem árvore
   `Content`, é uma pasta de jogo.
4. `utils.CompanionDiscFolders(gameDir)` só procura disco irmão **abaixo** da pasta do jogo (caso ZTM do GTA V, Disco 1
   aninhado). `DISCO 2` é irmã de `DISCO 1`, não filha: não é vista.
5. O enfileiramento de disco companheiro (`interfaces/http/handlers.go::enqueueCompanions` ->
   `models.FindCompanionDiscs`) não ajuda: o nome "Mass Effect 2 + PT-BR + DLC" não tem marcador de disco,
   `ExtractDiscInfo(...).IsMultiDisc == false`, então não há companheiro nem aviso de release incompleta
   (`recordReleaseCompleteness` retorna cedo).
6. O cleanup do scratch (`cleanupStageAfterRun`) apaga `DISCO 2` junto com o resto.

O ramo ISO do mesmo arquivo (`huggingface.go` L122, `helpers.FindFileByExt(extDir, ".iso")`) tem o mesmo formato de defeito
(uma ISO só). Não comprovado com uma entrada real; fica como observação, não como task.

## Hipóteses descartadas

- **Entrada do catálogo com só o Disco 1.** Descartada pela listagem: `DISCO 2/default.xex` está no RAR.
- **Disco 2 aninhado (formato ZTM, já tratado).** Descartada: `DISCO 1` e `DISCO 2` são irmãs sob `MASS EFFECT 2/`.
- **Falha do enfileiramento de companheiro do catálogo.** Não se aplica: o nome não é multidisco; a release vem num
  arquivo só.

## Achado fora do escopo (registro separado, não trabalho deste bug)

`Mass Effect 2 (Canada) (Disque 1)` / `(Disque 2)` (cache IA/Minerva) não são agrupados como multidisco:
`models/compat.go` L67 `discTagPattern` reconhece só `disco|disc|disk|dvd|cd`, não `disque` (francês). O par aparece como
dois jogos soltos e o Disco 2 não é enfileirado junto. Abrir bug próprio.

## O que fazer

- **T1 — achar os discos irmãos.** Em `src/server/infrastructure/helpers/` (ao lado de `FindXEXFolder`), função que, dada a
  pasta escolhida e `extDir`, devolve as outras pastas com `default.xex` do **mesmo TitleID e DiscNumber diferente**
  (via `utils.FolderXEXExecInfo`), em qualquer lugar do extraído (irmã ou aninhada), excluindo disco de instalação
  (`isInstallDiscFolder`, que já vira `Content`). Teste: árvore sintética `X/DISCO 1/default.xex` (disco 1/2) e
  `X/DISCO 2/default.xex` (disco 2/2) -> devolve `DISCO 2`; TitleID diferente -> não devolve; pasta aninhada estilo ZTM
  continua sendo excluída da cópia do jogo como hoje.
  *Antes de escrever:* conferir que o cabeçalho de `DISCO 2/default.xex` deste rip traz DiscNumber 2. Os dois têm o mesmo
  tamanho (7849984); se forem bit a bit iguais (disco 1/1), o critério tem de ser outro (nome da pasta `DISCO N`).
  Ler os primeiros 64 KiB do `default.xex` por Range só funciona se o membro estiver armazenado sem compressão.
- **T2 — gravar cada disco irmão como pasta própria** nos 5 ramos XEX (`huggingface.go`, `minerva.go` x2, `digital.go`,
  `pipeline.go`), pelo mesmo caminho de gravação do disco principal (FTP/local/zip), com nome de destino distinto por disco
  (ex.: `<release> - Disco 2`, passando por `helpers.XEXFolderName`). Gravar antes de reportar pronto; falha num disco
  falha o job. Teste: pipeline HF com o extraído sintético grava duas pastas no destino local.
- **T3 — tamanho/espaço.** Confirmar que a conferência de espaço e o limite FAT32 (`findFileExceedingFAT32Limit`) cobrem
  também as pastas irmãs.
- **T4 — reverificar a entrada real** do Mass Effect 2 PT-BR num destino local de teste: duas pastas de jogo + DLC.

## Registro da T1 (2026-10-29)

**Pré-condição conferida no rip real.** Script `rar5xex.py` (scratchpad da sessão): anda os cabeçalhos RAR5 por HTTP Range
numa conexão keep-alive e, para cada `default.xex`, imprime CRC32, método de compressão e, se armazenado, a execution info
lida dos primeiros 64 KiB do membro. Uma requisição por cabeçalho, ~3/s no CDN xet do HF: ~35 min para os 15 GB.

```
DISCO 1/default.xex usize=7849984 packed=7849984 crc=9984da4e method=0 data@9385815035 TitleID=454108CE disc=1/2
DISCO 2/default.xex usize=7849984 packed=7849984 crc=276796d9 method=0 data@14964008244 TitleID=454108CE disc=2/2
```

Mesmo tamanho, conteúdo diferente (CRC e media ID diferentes), cabeçalhos 1/2 e 2/2: o critério TitleID + DiscNumber vale,
não é preciso cair para o nome da pasta `DISCO N`.

**Símbolos abertos:**
- `helpers.go::FindXEXFolder` — junta as pastas com `default.xex` em ordem léxica e devolve a primeira que não é disco de
  instalação (ou a primeira de todas, se todas forem). Não devolve erro: `""` se não houver nenhuma.
- `helpers.go::isInstallDiscFolder` — `utils.FolderXEXExecInfo`; em erro devolve `false`. Disco de instalação =
  `models.RequiresMandatoryInstallDisc` com o mesmo disco, ou `models.DiscCompat(...).InstallType == "content"`.
- `models.DiscCompat` — sem linha na tabela devolve `InstallType: "god"`. `454108CE` não está no `DiscCompatTable`, então
  nenhum dos discos do ME2 conta como disco de instalação.
- `utils.FolderXEXExecInfo` / `utils.ReadXEXExecInfo` — lê 64 KiB do `default.xex` e procura o header `0x40006`; em erro
  devolve `(nil, err)`.
- `utils.CompanionDiscFolders(gameDir)` — só desce de `gameDir` (mesmo TitleID, disco diferente). É ela que tira o disco
  aninhado da cópia do jogo (`ftp/client.go` L495, `huggingface.go` L264, `local_resilient.go` L377) e o devolve à busca de
  `Content` (`multi_disc.go::FindCompanionContentPayloads`). A T1 não mexe nela.

**Decisões da T1:**
- Nova `helpers.SiblingDiscFolders(extDir, gameDir) []string` em `helpers.go`, abaixo de `isInstallDiscFolder`. Anda
  `extDir` inteiro (irmã ou aninhada), mesmo TitleID de `gameDir`, DiscNumber diferente, fora `isInstallDiscFolder`.
- **Uma pasta por DiscNumber** (a primeira em ordem léxica): a T2 dá nome de destino por disco (`<release> - Disco N`),
  e duas pastas do mesmo disco iriam para o mesmo destino.
- Sem chamador ainda: é a T2 que liga nos 5 ramos XEX. Sem versão/CHANGELOG nesta task (não muda comportamento).

**Testes** (`nested_disc_test.go`, reaproveita `writeDiscXEX`/`writeZTMStyleGTAV`): `X/DISCO 1` (1/2) + `X/DISCO 2` (2/2)
-> `[DISCO 2]`; disco de outro TitleID e pasta do mesmo disco -> nada; ZTM do GTA V -> nada, e
`utils.CompanionDiscFolders(game)` continua devolvendo o disco aninhado (segue fora da cópia do jogo).

**Feito (não commitado):** `helpers.go::SiblingDiscFolders` + 3 testes em `nested_disc_test.go`
(`TestSiblingDiscFolders{FindsTheOtherPlayableDisc,IgnoresWhatIsNotAnotherDisc,LeavesTheNestedInstallDiscToContent}`).
`go vet ./infrastructure/helpers/` limpo; `go test ./infrastructure/helpers/ ./utils/ ./services/pipeline/` -> ok nos três.

**Próximo passo (T2):** nos 5 ramos XEX, logo depois de `xexFolder := helpers.FindXEXFolder(extDir)`
(`huggingface.go` L68, `minerva.go` L73 e L217, `digital.go` L194, `pipeline.go` L223), chamar
`helpers.SiblingDiscFolders(extDir, xexFolder)` e gravar cada pasta pelo mesmo caminho do disco principal, com destino
`helpers.XEXFolderName(sibling, <release> + " - Disco N")` (N de `utils.FolderXEXExecInfo(sibling).DiscNumber`), antes de
reportar pronto. Versão + CHANGELOG entram na T2, que é a que muda comportamento.

## Registro da T2 (2026-10-29)

**Símbolos abertos:**
- Os 5 ramos XEX têm a mesma forma: `FindXEXFolder` -> `folderName` (`xexDestinationName`) ->
  `installCompanionDiscContent` -> `switch` FTP (`FTP.TransferXEX`, em erro agenda `PendingFTPJob`) / local
  (`InstallXEXLocal`) / sem destino (`CreateZipFromDir` + `updateGameINI_XEX`). Em `minerva.go` L73, `digital.go` e
  `pipeline.go` o `xexFolder` pode vir da ISO (`*_xex`, fora de `extDir`); aí `extDir` não tem `default.xex` e
  `SiblingDiscFolders` devolve nada. O ramo "XEX from ISO" do `huggingface.go` (L122) fica de fora (não há irmã).
- `companion_content.go::installCompanionDiscContent` — grava os payloads **antes** do disco jogável para que a falha
  pare o job enquanto o fallback de provedor ainda pode agir; FTP sem `PendingFTPJob` porque o scratch some no fim do
  job. É o precedente seguido.
- `workspace.go::cleanupStageAfterRun` — fora do modo local apaga `extDir` sempre: um `PendingFTPJob` para a irmã
  apontaria para pasta apagada.
- `local_resilient.go::copyTreeLocal` (via `InstallXEXLocal`) — já recusa arquivo >= 4 GB em FAT
  (`ErrFAT32FileSizeLimit`) e confere espaço livre **por árvore**. O erro embrulhado com `%w` preserva o sentinel.
- `helpers.go::XEXFolderName` — nome maior que 42 (FATX) é cortado no **fim** antes de `" - <TitleID>"`.
  `"Mass Effect 2 + PT-BR + DLC - Disco 2"` (37) viraria `"...DLC - D - 454108CE"`; com nome de release longo o
  `" - Disco N"` sumiria inteiro e o Disco 2 cairia na mesma pasta do Disco 1 (sobrescrita).
- `aurora-scripts/services.lua` L367-: o manifesto XEX do pacote manual tem um `foldername` e um `dataurl`; o Lua
  extrai um 7z numa pasta. Pacote manual não comporta um segundo disco sem mudar Lua + manifesto.
- `app.go::LogStatus` — anexa `IncompleteRelease[game]` à mensagem de "Ready".

**Decisões:**
- Novo `s.installSiblingDiscs(gameName, extDir, xexFolder, xboxConn) error` em `companion_content.go`, chamado logo
  depois de `installCompanionDiscContent` nos 5 ramos (antes do disco principal, pelo mesmo motivo).
- Nome: `helpers.XEXDiscFolderName(sibling, base, disc)` encurta `base` para caber `" - Disco N - <TitleID>"` em 42 e
  passa por `XEXFolderName`. `base` = o nome que `xexDestinationName` daria à irmã (pasta da irmã, ou o título da
  release se a pasta for genérica como `DISCO 2`): extraído para `xexReleaseName`. ME2 ->
  `"Mass Effect 2 + PT-BR - Disco 2 - 454108CE"`.
- FTP: `TransferXEX`; erro falha o job (sem pendente). Local: `InstallXEXLocal`; erro falha o job.
- Sem destino (pacote manual): não grava; deixa aviso em `IncompleteRelease` (aparece no "Ready").

**Fica para a T3:** espaço livre somado (hoje por árvore) e ordem — a irmã é gravada antes; se o disco principal
depois falhar no FAT32, a irmã fica no dispositivo.

**Achado fora do escopo:** pacote manual (sem destino) não entrega o Disco 2; exige manifesto + Lua com mais de uma
pasta. Registro próprio.

**Teste:** `sibling_discs_test.go` — extraído sintético `MASS EFFECT 2/DISCO 1` + `DISCO 2`, destino local:
`installSiblingDiscs` grava `Games/<...> - Disco 2 - 454108CE/default.xex` e não regrava o Disco 1; sem destino deixa
o aviso; `XEXDiscFolderName` com release longa mantém `" - Disco 2"` e cabe em 42.

**Feito:** `companion_content.go::installSiblingDiscs` + `xexReleaseName` (extraído de `xexDestinationName`, sem mudar
o resultado); `helpers.go::XEXDiscFolderName`; chamada nos 5 ramos. Testes
`TestInstallSiblingDiscs{WritesTheSecondPlayableDiscToItsOwnFolder,WarnsWhenTheManualPackageCannotCarryTheSecondDisc,DoesNothingForASingleDiscRip}`
e `TestXEXDiscFolderNameKeepsTheDiscNumberWhenTheNameIsLong`. `go build ./...`, `go vet` e `go test ./...` (servidor
inteiro) verdes. Versão 2.12.119, CHANGELOG, `docs/features.md` e `AGENTS.md` no mesmo commit da T1+T2.

**Próximo passo (T3):** espaço livre somado das pastas irmãs + disco principal antes de gravar a primeira
(`local_resilient.go::copyTreeLocal` confere por árvore) e a ordem FAT32 (conferir `findFileExceedingFAT32Limit` de
todas antes de gravar qualquer uma, em `huggingface.go`). Depois T4 no rip real.

## Registro da T3 (2026-10-29)

**Símbolos abertos:**
- `local_resilient.go::copyTreeLocal` — por árvore: `buildLocalCopyManifest` (pula disco aninhado), recusa arquivo
  `>= 4294967295` se `localIsFATVolume(root)` (`ErrFAT32FileSizeLimit`), confere limite de entradas FAT, depois
  `ensureFreeSpace(root, restante)`, onde `restante` desconta arquivo já no destino com o mesmo tamanho (retomada).
  Espaço insuficiente volta embrulhado em `ErrLocalDelivery`.
- `local_install.go::ensureFreeSpace` — chama `helpers.FreeSpaceBytes` direto (sem costura de teste); falha ao medir
  libera a gravação. `InstallXEXLocal` monta o destino `<root>/<Games|CustomXexPath|detectado>/<folderName>`.
- `fallback.go` — `isFAT32LimitError` troca de provedor (ISO/GOD); `isLocalStorageHalt` (`ErrLocalDelivery`) para a
  cadeia. `installSiblingDiscs` embrulha com `%w`, então o erro da própria irmã já classifica certo.
- `huggingface.go` L99 — `findFileExceedingFAT32Limit(xexFolder)` só do disco principal, **depois** das irmãs. Os outros
  4 ramos não têm conferência prévia: dependem do `copyTreeLocal` de cada árvore.
- `ftp/client.go::TransferXEX` — não confere espaço nem tamanho nem para o disco principal. Irmã tem o mesmo tratamento
  do principal; nada a cobrir no FTP.

**O defeito que sobra:** a conferência é por árvore e a irmã é gravada antes. (a) Principal com arquivo >= 4 GB em FAT:
o Disco 2 fica no pendrive e a cadeia troca para ISO/GOD, deixando uma pasta XEX órfã. (b) Cabe um disco e não os
dois: o Disco 2 é gravado, o principal falha por espaço e a cadeia para com meia release no dispositivo.

**Hipótese descartada:** "o erro da irmã perde o sentinel" — não perde (`%w`, já visto na T2).

**Comando que provou algo:** arquivo de 4 GiB por `os.Truncate` no NTFS consome 4096 MB reais de disco (medido com
`GetDiskFreeSpaceExW` antes/depois, `go run` no scratchpad) — o teste do FAT32 usa costura de limite, não arquivo grande.

**Decisões:**
- `installSiblingDiscs` recebe o `folderName` do disco principal e, em modo local e com irmã, chama
  `ensureXEXDiscsFitLocal` antes de gravar a primeira: FAT32 de todas as árvores e espaço **somado** do que falta gravar
  (descontando a retomada, como o `copyTreeLocal`). Pula a conferência se o dispositivo esperado não está montado
  (`localDeviceMatches`): o `copyTreeLocal` espera por ele e confere por árvore.
- Extraídos sem mudar comportamento: `localXEXDir` (de `InstallXEXLocal`), `localPendingBytes` e `fat32SizeError` (de
  `copyTreeLocal`). Costuras novas: `destinationFreeSpaceBytes` (em `ensureFreeSpace`) e `fat32FileSizeLimit`.
- Rip de um disco: nada muda (sem irmã não há conferência nova). O check do `huggingface.go` L99 fica.
- Fora do escopo: o conteúdo de instalação/DLC (`installCompanionDiscContent`) continua gravado antes e fora da soma,
  como já era.

**Testes** (`sibling_discs_test.go`): cabe um disco e não os dois -> `ErrLocalDelivery` e nada em `Games`; Disco 2 já no
destino (retomada) -> cabe; principal acima do limite FAT -> `ErrFAT32FileSizeLimit` e o Disco 2 não é gravado.

**Feito:** `companion_content.go::ensureXEXDiscsFitLocal`, chamada por `installSiblingDiscs` (que agora recebe o
`folderName` do principal; os 5 call-sites passam o mesmo nome que vai para `InstallXEXLocal`/`TransferXEX`). Extraídos
`local_resilient.go::fat32SizeError`/`localPendingBytes` e `local_install.go::localXEXDir`; costuras
`destinationFreeSpaceBytes` e `fat32FileSizeLimit`. Os 3 testes passam. Com a chamada desligada, os dois de defeito
(espaço, FAT32) falham; o de retomada passa nos dois casos, porque ele protege o desconto da retomada na soma. `go vet ./...`
e `go test ./...` do servidor verdes. Versão 2.12.120, CHANGELOG, `AGENTS.md` e `docs/features.md` no mesmo commit.

**Próximo passo (T4):** build da 2.12.120 e instalar "Mass Effect 2 + PT-BR + DLC" (HuggingFace) num destino local de
teste. Conferir em `Games/` as duas pastas (`Mass Effect 2 + PT-BR + DLC - 454108CE` para o Disco 1 e
`Mass Effect 2 + PT-BR - Disco 2 - 454108CE`), cada uma com o próprio `default.xex` (CRC `9984da4e` / `276796d9`), e a
DLC em `Content/0000000000000000/454108CE/00000002`. São 15 GB de download e o mesmo tanto em disco. Depois, o cliente ou
o dono troca para o Disco 2 no console.

## Registro da T4 (2026-10-29)

**Como rodou:** servidor headless da 2.12.120 (`go build -C src/server` em `9e734ee`, árvore de `src/server` limpa) isolado
em `C:\godsend-t4` (`GODSEND_HOME=C:\godsend-t4\home`, cache do catálogo copiado de `src/server/cache`, porta 18080,
`GODSEND_ERROR_REPORTING=0`, bind 127.0.0.1). Nenhuma outra instância do app rodando e sem `godsend-temp` em C:/D:
antes (o startup limpa scratch velho nesses volumes). Destino local `C:\godsend-t4\dest` (pasta comum do NTFS: o
`/register` com `mode=local` só carimba a identidade do dispositivo, não exige pendrive).

```
/register?game=Mass Effect 2 + PT-BR + DLC&mode=local&local_root=C:\godsend-t4\dest&install_type=xex
/trigger?game=Mass Effect 2 + PT-BR + DLC&platform=xbox360&source=huggingface&install_type=xex
```

**Linha do tempo (log do servidor):** download 14282.8 MB 21:54:57 → 22:06:58 (~16 MB/s), verificação 1m34s, extração
até 22:36, gravação 22:36:12 → 22:39:06, `/status` = `Ready` / "Gravado no dispositivo!". Ordem gravada: Content
(`00000002` 23 arquivos 5.13 GB, `00009000` 16 arquivos), depois `MULTI-DISC ...: Disco 2 jogável no mesmo arquivo:
...\MASS EFFECT 2\DISCO 2 -> Mass Effect 2 + PT-BR - Disco 2 - 454108CE`, depois o Disco 1. `pending_queue/` vazio no fim;
`Temp/` só com `torrent-dl` (extraído e RAR apagados).

**Destino conferido** (`find | wc -l`, `du -sb`, CRC32 por `zlib.crc32`):

```
Games/Mass Effect 2 + PT-BR + DLC - 454108CE/   1879 arquivos  6836563785 bytes  default.xex 7849984 crc 9984da4e
Games/Mass Effect 2 + PT-BR - Disco 2 - 454108CE/  2176 arquivos  6349066561 bytes  default.xex 7849984 crc 276796d9
Content/0000000000000000/454108CE/00000002  e  .../00009000
```

Os dois CRCs são os do RAR medidos na T1 (disco 1/2 e 2/2). Os nomes de pasta são os previstos na T3.

**Não conferido aqui:** contagem de arquivos de cada disco contra a listagem completa do RAR (a do registro inicial foi
filtrada por extensão; refazer custa ~35 min de Range). O teste no console continua sendo o critério que falta.

**Artefato deixado:** `C:\godsend-t4` (18 GB: binário, home, `dest/` com as duas pastas + Content). Copiar `dest/Games` e
`dest/Content` para a raiz de um HD/pendrive do console serve para o teste do Disco 2. Apagar depois.

**Próximo passo:** publicar a 2.12.120 (`build-and-upload.ps1`, decisão do dono) e o cliente (ou o dono no console, com
o `dest/` acima) trocar para o Disco 2 e o jogo seguir. Com isso, marcar o último critério e mover o doc para `closed/`.

## Critérios para fechar

- [x] Reprodução confirmada e compreendida (listagem do RAR + leitura do código)
- [x] Causa raiz corrigida (T1, T2 em `5e4b242`; T3 conferência de espaço/FAT32)
- [x] Teste automatizado com árvore sintética de dois discos irmãos (`sibling_discs_test.go`)
- [x] Rip real em destino local de teste grava as duas pastas de jogo + DLC (T4, 2.12.120)
- [ ] Cliente (ou o dono no console) troca para o Disco 2 do rip PT-BR e o jogo segue
