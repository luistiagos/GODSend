# Bug: "Verificando os discos deste jogo…" fica girando em todos os jogos e o cliente não consegue adicionar à fila; a falha não chega à telemetria

- **Detectado em:** 2026-10-21 17:49 (análise da sessão de WhatsApp `32822140117221@lid`, telefone `5513974048946`)
- **Origem:** `xbox-360-companion/electron-renderer` + `electron-main` —
  `src/electron-app/renderer/components/BrowsePage.tsx::loadDiscMembership` → IPC `browse:get-release-groups`
  (`src/electron-app/ipc/browseHandlers.ts`) → `GET /browse/releases` (`src/server/interfaces/http/handlers.go::handleBrowseReleases`)
- **Errors (serviço):** nenhum (ver Evidência: a falha desse IPC só vai para o log local)
- **Classe:** ux / fail
- **Severidade:** **P2 — Médio** (provisória): bloqueia o botão "Adicionar à fila" de todos os jogos enquanto dura; não
  se sabe ainda se para sozinho em 120 s ou se o cliente ficou preso.
- **Complexidade:** média (handler Go + IPC + estado da tela)
- **Versões:** cliente provavelmente na 2.12.110 (versão não aparece na conversa); o código atual tem o mesmo fluxo.
- **Reincidência:** primeira vez registrado.

## Sintoma

Horários em UTC. O cliente tinha acabado de preparar um HD novo (Seagate, *"D: — BADAVATAR · 880.4 GB livres"*) — ver
[[badavatar-hd-preparado-em-modo-bloqueado-acusado-como-rgh-depois-de-usado-no-console_2026-10-21T17-49]].

1. **21/10 19:46:11** ([150485]): *"Não aparece mais o arquivo pra baixar"* + print do jogo "0-D Beat Drop", destino
   "Pendrive (USB)", e o botão azul *"Verificando os discos deste jogo..."*.
2. **21/10 19:48:18** ([150489]): *"Não vai"* + print de outro jogo ("007 Blood Stone") com a mesma mensagem.
3. O cliente não voltou a escrever depois disso (última mensagem é do agente, [150490], 19:48:37).

## Evidência

- Conversa lida inteira pela skill `sessao-whatsapp`; ids acima são de `Wpp_proccess`.
- **O que o código faz hoje** (observado, não é causa provada):
  - `BrowsePage.tsx:679` mostra o texto enquanto `discInfoState === "loading"`; o botão fica desabilitado
    (`disabled={… || discInfoState !== "ready" …}`, linha 673).
  - O estado é **um só para o catálogo inteiro**: `loadDiscMembership` roda uma vez por carga do catálogo
    (`loadGames`, linha 1328, sem `await`), não por jogo. Por isso todo jogo aberto mostra o mesmo spinner.
  - O IPC `browse:get-release-groups` usa `backendGet`, com timeout de 120 s (`infrastructure/backendHttp.ts:55`). Ao
    estourar ou falhar, devolve `{ ok: false }` e a tela vai para "Discos não verificados" com botão de tentar de novo.
  - Na falha, o handler só chama `appendAppEvent("BROWSE", …)` (`browseHandlers.ts:100-103`) — **sem `reportError`**,
    ao contrário do `browse:get-games` logo acima, que reporta. Por isso não há linha na telemetria para medir.
- Consulta à telemetria no período (`errors` com `project LIKE '%xbox%'`, 20/10 20:00 → 21/10 20:30): 33 linhas, nenhuma
  de `browse:get-release-groups` — esperado, dado o item acima.

## Causa raiz

Passada 2, em 2026-10-22. **O mecanismo está provado. Que foi ele na máquina do cliente não está:** não temos o log local
do cliente. O tempo de `/browse/releases` cresce com o número de pastas de TitleID nas unidades conectadas, uma chamada
de rede por pasta, em série e sem cache. Um HD recém-preparado e já usado no console tem essas pastas.

Cadeia, aberta símbolo a símbolo:

- `interfaces/http/handlers.go::handleBrowseReleases` agrupa `d.companionCatalog(platform)`. Não há `context` nem
  prazo. Pânico vai para `RecoverMiddleware` (`middleware.go`), que reporta e devolve 500. Não é o caso aqui.
- `handlers.go::companionCatalog`: para `xbox360`/`xbox`/`local`, chama `d.Local.ScanTransferFolder()` a cada pedido.
  Os locks dos caches (`IAGameCacheMu`/`MinervaGameCacheMu`) só são escritos por atribuição curta
  (`cache/ia.go::replaceMemoryCache`, `cache/minerva.go:85,293`), então não seguram nada.
- `services/local/scanner.go::ScanTransferFolder`: de `D:` a `Z:`, para cada `Content/0000000000000000/<TitleID>`
  (e para cada pasta de TitleID puro em `Games/`, via `scanGamesSubdir`), chama `services.LookupTitleName` **em série**.
- `services/title_lookup.go::LookupTitleName`: XboxUnity (`http.Client{Timeout: 10s}`). Se não acha ou acha nome
  truncado, tenta XboxDB (`Timeout: 10s`) e depois a lista embutida. **Sem cache.** Em erro, cada fonte loga e
  devolve `""` (não propaga). O custo é de até **20 s por TitleID**, pago de novo a cada carga do catálogo.
- Electron: `ipc/browseHandlers.ts` → `backendGet`, com `req.setTimeout(120000)` (`infrastructure/backendHttp.ts:55`).
  Como o handler Go não escreve nada até terminar, é um prazo total de 120 s. Seis TitleIDs com o XboxUnity pendurado
  já dão 6 × 20 s = 120 s.
- Tela: `BrowsePage.tsx::loadDiscMembership` sai de `loading` para `failed` quando o IPC responde `{ ok: false }`.
  Então **a tela sai do spinner em ≤ 120 s** (`waitForBackendListening` não conta: o catálogo já tinha carregado, logo o
  backend escutava). Só que `failed` **também** desabilita o botão (`disabled={… discInfoState !== "ready" …}`). E
  "Tentar novamente" refaz as mesmas consultas sem cache, então falha de novo pelo mesmo motivo.
- Telemetria: o `catch` de `browse:get-release-groups` só chama `appendAppEvent` (sem `reportError`, confirmado em
  `browseHandlers.ts:100-103`).

Provas:

1. Log local real do dono, `%APPDATA%/xbox-360-companion-electron/logs/godsend-server-2026-10-16.log`, com o pendrive
   `E:` conectado. Comando: `grep -h "BROWSE: platform=xbox360\|BROWSE RELEASES\|XboxUnity" godsend-server-2026-10-16.log`.
   `BROWSE UNIFIED` às 03:28:08.172; seis `XboxUnity:` em série (10102001 "no result", depois ~1,5 s de XboxDB até o
   próximo, 394707D1, 584107F2, 584D07D1, C0DE9999, FFFE07DF); `BROWSE RELEASES: xbox360 -> 286` às 03:28:13.166.
   **~5 s com a rede boa.** Sem pastas de TitleID (13/10, mesmo log, `godsend-server-2026-10-13.log`), a mesma chamada
   leva ~0,5–0,7 s. Exemplo: `BROWSE` 06:31:52.017 → `RELEASES` 06:31:52.685.
2. Sem cache: no mesmo log de 13/10, `584107F2 → Astropop` é consultado de novo a cada carga (07:11:21, 07:12:40,
   07:13:58, …) e de novo 11 s depois na mesma sessão (07:51:18 e 07:51:30).
3. Reprodução com `ScanTransferFolder` real. `subst W:` sobre uma pasta com 8 TitleIDs vazios
   (FFFE07D1, FFFE07DF, 584E07D1, FFFF0055, 4D5307E6, 545107FC, 41560817, 4D530919) e um teste temporário que chama a
   varredura duas vezes: `scan 0: 1.75s`, `scan 1: 1.30s`. A segunda não fica mais rápida, o que confirma a falta de
   cache. Latência isolada (`curl -w %{time_total}`): XboxUnity ~0,5 s, XboxDB ~0,6–1,5 s (404 em todas).

## Hipóteses descartadas

- **Lock do cache do catálogo segurando o pedido:** as escritas são atribuições sob `Lock` curto (ver acima). Nenhuma
  escrita faz rede segurando o lock.
- **Backend ainda subindo (`waitForBackendListening`):** o catálogo da mesma tela tinha carregado, e ele passa pela
  mesma espera.
- **CPU do agrupamento:** ~0,5 s com 3.114 jogos e 286 lançamentos (prova 1, caso sem TitleIDs).
- **Tela presa para sempre em `loading`:** o `catch` do IPC sempre devolve valor e `backendGet` sempre resolve ou rejeita
  em 120 s. O que fica "preso" é o botão: no `failed` ele também está desabilitado, e a nova tentativa repete o custo.
- **Pânico em `members[0]`:** `FindCompanionDiscs` nunca devolve vazio (`return []string{gameName}` nos dois atalhos).

## Como reproduzir

`subst W: <pasta>` com `<pasta>/Content/0000000000000000/<TitleID>` × N. Depois, `GET /browse/releases?platform=xbox360`
(ou `ScanTransferFolder()` num teste). O tempo cresce ~N × latência do XboxUnity/XboxDB. Para chegar aos 120 s do
cliente, simule o XboxUnity sem resposta (cada fonte espera 10 s).

## Correção planejada

- **T1 — `src/server/services/local/scanner.go`:** a varredura junta os TitleIDs que encontra e resolve todos de uma vez
  (`resolveTitleNames`): em paralelo, com limite de concorrência, e com memória de processo para os nomes resolvidos.
  Falha não fica em memória, para que uma queda passageira da rede não deixe o ID em hexa a sessão toda. O pior caso
  passa de N × 20 s para ~20 s por lote, e a carga seguinte não volta à rede para o que já resolveu.
  `LookupTitleName` não muda: os outros chamadores (pipeline, saves, ini) mantêm o comportamento.
  Teste: `services/local/scanner_test.go`, com a consulta injetada (`lookupTitleName` como variável do pacote):
  (a) 8 IDs cuja consulta leva 300 ms resolvem em bem menos que 8 × 300 ms; (b) a segunda chamada não consulta de novo
  o que resolveu; (c) a falha é consultada de novo e o ID cai para o hexa.
- **T2 — `src/electron-app/ipc/browseHandlers.ts` (`browse:get-release-groups`):** `reportError` no `catch`, no mesmo
  formato do `browse:get-games`. Teste: `tests/unit/browseHandlers.test.cjs`, em que falha de `backendGet` gera um
  report com method `browse:get-release-groups` e o sucesso não gera nenhum.

Fora deste bug (não feito aqui): o botão continuar desabilitado no `failed` é escolha deliberada (comentário em
`BrowsePage.tsx`, contra baixar meio lançamento). Não muda.

## Tasks

| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | scanner resolve TitleIDs em paralelo e memoriza os nomes | -- | -- | -- | -- |
| T2 | `browse:get-release-groups` reporta falha à telemetria | -- | -- | -- | -- |

## Critérios para fechar

- [ ] Reprodução confirmada e compreendida
- [ ] Causa raiz isolada e corrigida
- [ ] Falha de `browse:get-release-groups` reportada à telemetria
- [ ] Teste automatizado cobrindo o caso
