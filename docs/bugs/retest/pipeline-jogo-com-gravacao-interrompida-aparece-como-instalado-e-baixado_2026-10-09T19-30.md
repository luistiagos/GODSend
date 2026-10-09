# Bug: jogo com gravação interrompida aparece em "Jogos Instalados" e na "Biblioteca Local" como se estivesse pronto

- **Detectado em:** 2026-10-09, relato do dono com dois prints
- **Origem:** `src/electron-app/services/localGameScannerService.ts::parseGameFolder` + `src/server/services/pipeline/local_resilient.go::copyTreeLocal`
- **Errors (serviço):** N/A (local)
- **Classe:** ux / fail
- **Versões:** observado na 2.12.110 em desenvolvimento (não publicada); corrigido na mesma 2.12.110
- **Reincidência:** consequência do mesmo job de
  `pipeline-gravacao-local-fragmenta-pasta-fat32-ate-o-limite-de-65536-entradas-e-o-rename-falha_2026-10-09T12-00.md`
  (a falha de gravação em si é daquele doc; este trata só da exibição do jogo incompleto)

## Sintoma

Relato do dono: "Xboxcompanion, jogo EA FC 26 Legacy Edition, foi tentado baixar, mas não baixou completamente,
deu erro. Mesmo com o erro ele se encontra em Biblioteca Local e em jogos instalados. Atenção o jogo só deve
aparecer em jogos instalados ou em biblioteca local quando ele estiver pronto para jogar no xbox 360, pois se não o
usuario vai ter problemas achando que o jogo está funcional quando não está."

## Evidência

1. **Print 1 — Jogos Instalados**, `E:\ [BADAVATAR] (14.44 GB)`, FAT32, "6 jogos": card **EA FC 26 Legacy Edition**,
   selo `GOD`, 3.81 GB, `454109F4 E: (BADAVATAR)`. Contadores do topo: `XEX: 0`, `GOD: 6`.
2. **Print 2 — Baixar Jogos > Biblioteca Local**, "8 títulos": card **EA FC 26 Legacy Edition** com selo
   **"✓ Baixado"**, `E: (BADAVATAR)`.
3. Item da fila `pending_queue/0b51dd86eaf970cde0c9ce9a.json` (ver doc irmão): `state=Error`, destino `E:\`;
   pasta parcial `E:\Games\EA FC 26 Legacy Edition - 454109F4\` existe com parte dos arquivos (12.571 de 13.147
   só em `data/sceneassets/faces`; zip tem 13,15 GB descompactados, pasta mostrada com 3.81 GB).
4. Raiz da pasta parcial no pendrive (`Get-ChildItem -Force "E:\Games\EA FC 26 Legacy Edition - 454109F4"`):
   `audiodata/`, `data/`, `CardsDLLzf.xex.dll`, `accomplishments.ini` ... `ctlconfig.xml` — **sem `default.xex`**,
   sem subpasta de TitleID, sem pasta de tipo de conteúdo (`00007000` etc.), sem `godsend.ini`.

## Causa raiz

As duas telas leem a **mesma** varredura de pastas do Electron, e nem ela nem a gravação têm noção de
"instalação em andamento".

1. **Fonte das duas telas.** "Jogos Instalados" (`UsbGamesPage.tsx:243`) e "Biblioteca Local"
   (`BrowsePage.tsx:1360`) chamam `browseGetInstalledGames` -> IPC `browse:get-installed-games`
   (`ipc/browseHandlers.ts:33`) -> `services/localGameScannerService.ts::scanUsbAndLocalGames`. O selo
   "Baixado" e a lista da biblioteca local vêm dessa varredura. O outro lado da biblioteca local,
   `GET /browse?platform=local` (`interfaces/http/handlers.go:74`), só lista `Transfer/` do PC
   (`ScanTransferFolder`) — não contém o EA FC.
2. **O scanner aceita a pasta só pelo nome.** `localGameScannerService.ts::parseGameFolder`: o nome
   `"EA FC 26 Legacy Edition - 454109F4"` casa `NAME_TITLE_ID_REGEX` e preenche `titleId`; a "validação estrita"
   (`if (!ini && !isDefaultXex && !isGodSub && !titleId) return null`) passa porque `titleId` existe, e o formato
   cai em `god` (`else if (isGodSub || titleId) format = "god"`) — por isso o card mostra **GOD** num jogo XEX
   sem `default.xex`. Um TitleID tirado do nome da pasta não prova que existe jogo nela.
3. **A gravação escreve direto na pasta final, sem marca.** `services/pipeline/local_install.go::InstallXEXLocal`
   / `InstallGameLocal` / `InstallContentLocal` chamam `local_resilient.go::copyTreeLocal(src, base, ...)` com
   `base` = `Games/<nome> - <TitleID>` (ou `Content/0000000000000000/<TID>/<tipo>`). `copyTreeLocal` grava arquivo
   por arquivo em `base` (o temporário fica em `.xbox-downloader/copy-staging`, mas cada arquivo pronto já vai para
   o lugar final) e, em erro, só retorna (`return fmt.Errorf(...)`) — nada no destino diz que ficou pela metade.
   A fila sabe (`pending_queue/*.json`, `state=Error`), o pendrive não.
4. **Ordem de gravação expõe o jogo ao console também.** `buildLocalCopyManifest` usa `filepath.Walk` (ordem
   lexical): `data/` vem antes de `default.xex`, e no GOD o cabeçalho `<hash>` vem antes de `<hash>.data/`. Num
   XEX interrompido depois do `default.xex`, ou num GOD interrompido no `.data`, o Aurora listaria um jogo que não
   inicia. (No caso relatado o `default.xex` ainda não tinha sido gravado.)
5. **Cache do scanner.** `cachedGameInfo` guarda um jogo válido por 10 min (`GAME_INFO_TTL_MS`); qualquer checagem
   de "em andamento" tem de rodar a cada varredura, fora desse cache, senão uma reinstalação sobre pasta já
   conhecida continua aparecendo.

## Hipóteses descartadas

- **Backend lista o jogo pela pasta `Ready\EA FC 26 Legacy Edition` (download preservado):** não —
  `/browse?platform=local` só varre `Transfer/` (`handlers.go:74`, `ScanTransferFolder`).
- **Marca dentro da pasta seria apagada pela reorganização FAT32:** não — `rebuildSaturatedFATFolder` só apaga
  arquivos regulares do manifesto e sobras `.xbox-companion-part`; o resto é mantido e contado.
- **Mostrar o jogo como "incompleto" em vez de esconder:** recusado pelo pedido do dono ("só deve aparecer quando
  estiver pronto para jogar").

## Correção planejada

- **Backend (`local_resilient.go::copyTreeLocal`)**: antes do primeiro arquivo, gravar
  `<base>/.xbox-companion-installing` (texto com jogo e hora); apagar só depois do `FlushVolumeBuffers` final com
  sucesso; em qualquer erro/cancelamento, a marca fica. Ordenar o manifesto para gravar por último os pontos de
  entrada que o Aurora usa: `default.xex` na raiz de `base` e o cabeçalho GOD (arquivo com irmão `<nome>.data/`).
- **Electron (`localGameScannerService.ts`)**: (a) `scanGamesDirectory` pula pasta com a marca, checando a cada
  varredura antes do cache; `parseContentTitleFolder`/`scanContentDirectory` pula `<TID>` cuja pasta de tipo tenha
  a marca; (b) `parseGameFolder` deixa de aceitar pasta só pelo TitleID do nome: exige `default.xex`,
  `godsend.ini`, subpasta de tipo de conteúdo, subpasta de TitleID ou pacote STFS. (b) também esconde a pasta
  parcial que já está no pendrive do dono, gravada por versão antiga sem marca.

Fora do escopo (registrar à parte se preciso): FTP direto no console não passa por `copyTreeLocal`; pasta parcial
de job cancelado fica oculta e ocupa espaço até nova tentativa ou remoção manual.

## Tasks
| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | scanner: pular pasta com marca de instalação e não aceitar pasta só pelo TitleID do nome (teste em `tests/unit/localGameScannerService.test.cjs`) | -- | -- | -- | -- |
| T2 | copyTreeLocal: marca `.xbox-companion-installing` durante a gravação + pontos de entrada por último (teste Go em `local_resilient_test.go`) | -- | -- | -- | -- |

## Correção aplicada

Seguiu a correção planejada, sem desvio.

- **T1** (`d27d796`, `localGameScannerService.ts`): `installInProgress()` pula a pasta com
  `.xbox-companion-installing` em `scanGamesDirectory` e nas pastas da raiz do drive, e apaga a entrada dela do
  cache; `scanContentDirectory` pula `<TID>` cuja pasta de tipo tem a marca. `parseGameFolder` só aceita pasta sem
  estrutura (`godsend.ini`, `default.xex`, pasta de tipo, subpasta de TitleID) se houver pacote STFS de jogo **na
  raiz** — sondado só ali (`probeStfsTitleId(fullPath, 4)`), porque resultado negativo não é cacheado e a árvore
  parcial do EA FC tem 145 mil arquivos. A antiga "validação estrita" ficou redundante e saiu.
- **T2** (`431ffe3`, `local_resilient.go`): `writeInstallInProgressMarker` antes do primeiro arquivo (depois das
  checagens de espaço e limites), `os.Remove` da marca depois do `FlushVolumeBuffers` final; falha ao remover vira
  `ErrLocalDelivery`. `orderEntryPointsLast` move `default.xex` da raiz e cada cabeçalho GOD (arquivo com irmão
  `<nome>.data/`) para o fim, em ordenação estável.

## Testes executados

- `node --test tests/unit/localGameScannerService.test.cjs`: 20/20. Com o `.ts` do commit anterior compilado, os
  3 novos falham (17 pass / 3 fail) — controle negativo. Suíte unitária inteira: 291/291.
- `go test ./services/pipeline/ -run "Marker|CopyTreeLocal"`: ok. Controle negativo (chamadas de
  `orderEntryPointsLast` e `writeInstallInProgressMarker` desligadas via `sed` numa cópia): os 2 testes novos
  falham (marca ausente; ordem `[00007000/ABCDEF ... default.xex zzz.ini]`). `go test ./...` e `go vet`: verdes.
- **Dados reais** (pendrive do dono, `E:` FAT32): `scanGamesDirectory("E:\Games")` + `scanContentDirectory` com o
  JS compilado — código antigo: `Street Fighter II' HF` **e** `EA FC 26 Legacy Edition (god 454109F4)`; código
  novo: só `Street Fighter II' HF`.

Falta: ver as telas "Jogos Instalados" e "Biblioteca Local" com o app reiniciado (o Electron em execução é
compartilhado e não foi reiniciado por esta sessão), e o backend `dist\godsend-windows-x64.exe` ainda é o antigo
(em uso, PID 26108) — a marca só passa a ser gravada depois do próximo build do backend.
