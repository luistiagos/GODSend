# Bug: catálogo falha com `ECONNREFUSED` porque o backend ainda está limpando o `Temp` antigo e não abriu a porta

- **Detectado em:** 2026-10-09, relato do dono
- **Origem:** abertura do catálogo logo após (re)iniciar o app — `ipc/browseHandlers.ts::browse:get-games`
- **Versão:** 2.12.110 (rodando do fonte, `packaged: false`)

## Sintoma

Relato do dono: "No xboxcompanion estamos com este erro":

> Falha ao carregar o catálogo em http://127.0.0.1:8082/browse: ECONNREFUSED ao contatar o servidor local em
> http://127.0.0.1:8082/browse?platform=xbox360&source=unified&priority=huggingface%2Cia%2Cminerva
> (connect ECONNREFUSED 127.0.0.1:8082)

## Evidência

Log `%APPDATA%\xbox-360-companion-electron\logs\godsend-server-2026-10-09.log` (linhas 860–950), sessão `pid=39040`:

| hora (UTC) | linha |
|---|---|
| 18:45:43.797 | `APP_BACKEND stop requested (kill)` — fim da sessão anterior (`pid=56588`) |
| 18:46:21.786 | `APP_LIFECYCLE app ready` |
| 18:46:23.124 | `APP_BACKEND spawned pid=36772` |
| 18:46:23.213 | `BACKEND_OUT [INFO] Executable: ...\dist\godsend-windows-x64.exe` — última linha do backend por 78 s |
| 18:46:35.167 | `APP_BROWSE ... Falha ao carregar o catálogo ... ECONNREFUSED` (1ª de 5, até 18:46:50.794) |
| 18:47:41.325 | `BACKEND_OUT [INFO] Removed 12.27 GB of stale processing data from C:\projects\Downloader-XBOX360-XEX-HDD-Games\Temp` |
| 18:47:41.815 | `BACKEND_OUT [INFO] Server bind: 127.0.0.1:8082` |
| 18:47:41.817 | `Starting server on port 8082... Server started.` |

Depois de 18:47:41 não há mais `ECONNREFUSED`; às 15:49 local `Get-NetTCPConnection -LocalPort 8082` mostra
`127.0.0.1 Listen 36772` (o mesmo backend).

Atraso spawn → `Server bind` em todas as 46 sessões dos logs desta máquina (awk sobre
`godsend-server-2026-*.log`, pares `APP_BACKEND spawned` / `Server bind:`):

| atraso | sessão | limpeza do `Temp` |
|---|---|---|
| **78,7 s** | 2026-10-09T18:46:23 | 12,27 GB |
| 9,3 s | 2026-10-09T05:31:56 | 1,08 GB |
| 1,5 s | 2026-09-02T14:37:25 | 13,58 GB |
| 1,3 s | 2026-10-08T00:47:37 | 10,83 GB |
| ≤ 1,3 s | as outras 42 | 0–17,77 GB |

## Causa raiz

Duas metades; nenhuma sozinha produz o erro.

1. **O backend só abre a porta depois de apagar o `Temp` antigo, de forma síncrona.**
   `src/server/main.go::main` chama `a.SetupPaths()` (linha 28) antes de qualquer `net.Listen`/`server.Serve`
   (linhas ~185–220). `src/server/app/config.go::SetupPaths` chama `cleanupStaleScratchDir(ToolsDir\Temp)` e, por
   volume fixo, `godsend-temp\proc` e `godsend-temp\torrent-dl` (linhas 441–446), **antes** de escolher o volume
   (`bestFixedVolume`) — de propósito: o comentário diz que o espaço do scratch antigo tem de ser liberado antes de
   comparar o espaço livre. `cleanupStaleScratchDir` (linha 348) faz, por entrada, `scratchDirSize` (walk) e
   `os.RemoveAll`; erro de remoção só vira `[WARN]` e segue. Não loga nada **antes** de começar, só o total no fim —
   por isso o log mostra 78 s de silêncio.
   O tempo depende do **número de arquivos**, não dos GB: 10,83 GB levaram 1,3 s (2026-10-08), 12,27 GB levaram 78 s
   hoje. O `Temp` de hoje era a extração do "EA FC 26 Legacy Edition" (a varredura de jogos instalados do mesmo log
   mede 20.420 arquivos nesse jogo; a contagem exata do que foi apagado não está logada). O backend anterior foi
   morto com SIGTERM às 18:45:43 no meio do processamento, deixando a extração no `Temp`.
2. **O Electron não sabe distinguir "backend iniciando" de "backend fora do ar".**
   `services/backendClient.ts::startGodsend` marca o processo como vivo no `spawn` e já lê a linha
   `GODSEND_LISTEN_PORT=` (regex `GODSEND_LISTEN_PORT_RE`, usada só para gravar a porta efetiva), mas não guarda
   "porta aberta". `infrastructure/backendHttp.ts::backendGetWithStatus` faz o `http.get` na hora; `ECONNREFUSED`
   vira erro imediato. `ipc/browseHandlers.ts::browse:get-games` (catch) monta a mensagem que o dono viu, loga
   `APP_BROWSE` e chama `reportError`; `renderer/components/BrowsePage.tsx::loadGames` (linha ~1341) põe
   `status="error"` e fica parado até "Tentar de novo" — não há nova tentativa automática.

Resultado: qualquer início lento do backend (limpeza grande, antivírus, disco lento) aparece para o usuário como
"servidor recusou a conexão", com o backend saudável e prestes a responder.

## Hipóteses descartadas

- **`localhost` resolvendo para `::1`** (causa do bug fechado
  `docs/bugs/closed/browse-falha-comunicacao-backend-oculta-erro-sem-telemetria_2026-09-24T21-30.md`): a URL já é
  `127.0.0.1` e o backend faz bind em `127.0.0.1:8082` (linha `Server bind`). Não é IPv6.
- **Porta ocupada / backend em outra porta:** não houve `Port ... was in use`; `GODSEND_LISTEN_PORT=8082` igual ao
  `GODSEND_PORT=8082` do ambiente do filho.
- **Backend caiu:** não há `BACKEND_END` na sessão `pid=39040`; o processo 36772 segue escutando.
- **Tamanho do `Temp` como causa:** limpezas de 10–17 GB terminaram em ≤ 1,5 s; o que pesa é a contagem de arquivos.
- **Antivírus/firewall bloqueando o loopback:** depois de 18:47:41 a mesma URL responde; não há bloqueio.

## Observação fora do escopo

O cabeçalho do backend imprime `Xbox 360 Companion Server v2.12.109` enquanto a primeira linha imprime
`v2.12.110` (`main.go:25`). Versão desatualizada no banner; não é este bug.

## Correção planejada

**T1 — Electron espera a porta abrir antes de falar com o backend que acabou de subir.**
- Novo `src/electron-app/infrastructure/backendReadiness.ts`, sem imports: estado "iniciando / escutando /
  sem processo". `markBackendStarting()`, `markBackendListening()`, `markBackendStopped()` e
  `waitForBackendListening(timeoutMs)`, que resolve na hora se não há processo gerenciado (backend rodando por
  fora, testes) ou se já está escutando; senão, quando a porta abrir, o processo terminar ou o prazo vencer.
- `services/backendClient.ts::startGodsend`: `markBackendStarting()` logo após o `spawn`; `markBackendListening()`
  no handler de stdout quando casar `GODSEND_LISTEN_PORT_RE` (depois do `writeConfig` da porta);
  `markBackendStopped()` em `error`, `close` e nos retornos de falha do spawn.
- `infrastructure/backendHttp.ts`: `backendGetWithStatus` e `backendPost` aguardam `waitForBackendListening` e só
  então leem `getConfiguredServerPort()` (a porta pode mudar na linha `GODSEND_LISTEN_PORT`). Prazo de 120 s, o
  mesmo do GET; vencido, a requisição segue e o erro real (`ECONNREFUSED`) continua aparecendo como hoje.
- Na tela nada muda: durante a espera o catálogo fica no estado "carregando" que já existe.
- **Prova:** `tests/unit/backendReadiness.test.cjs` — (a) sem processo resolve na hora; (b) "iniciando" segura uma
  requisição até `markBackendListening` e ela chega a um listener aberto **depois** da chamada (controle: sem o
  gate a mesma chamada dá `ECONNREFUSED`); (c) `markBackendStopped` libera o waiter; (d) prazo vencido libera.
  Mais `npm run test:safety`. Ponta a ponta: reiniciar o app com um `Temp` cheio de arquivos sintéticos e abrir o
  catálogo durante a limpeza — tem de carregar sem erro.

**T2 — backend avisa no log que está limpando o `Temp`.** `config.go::cleanupStaleScratchDir` loga
`[INFO] Cleaning stale processing data in <dir>...` antes do primeiro `RemoveAll`, e o total com a duração e a
contagem de arquivos no fim. Assim os 78 s de silêncio passam a ter dono no log do cliente.
**Prova:** `go test ./app/...` com teste que cria entradas antigas e confere as duas linhas.

**Fora deste bug (decisão do dono):** tirar o `RemoveAll` do caminho crítico (renomear para uma lixeira e apagar
em goroutine depois do `Serve`) exige refazer a conta de espaço livre do `bestFixedVolume`, que hoje depende da
limpeza já ter acontecido. Com T1 o sintoma some; o início continua lento nesse caso raro.

## Tasks
| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | Electron espera o backend abrir a porta antes de requisitar | -- | -- | -- | -- |
| T2 | backend loga início, duração e contagem da limpeza do Temp | -- | -- | -- | -- |

## Correção aplicada (2.12.110)

Sem desvio do plano.

- **T1** (`2a9816d`): `src/electron-app/infrastructure/backendReadiness.ts` (novo, sem imports);
  `backendClient.ts::startGodsend` chama `markBackendStarting()` após o `spawn`, `markBackendListening()` na linha
  `GODSEND_LISTEN_PORT=` (depois do `writeConfig` da porta) e `markBackendStopped()` em `error`/`close`;
  `backendHttp.ts::backendGetWithStatus` e `::backendPost` viraram `async`, aguardam `waitForBackendListening()`
  (120 s) e só então leem a porta.
- **T2**: `src/server/app/config.go::cleanupStaleScratchDir` loga
  `[INFO] Cleaning stale processing data in <dir> (the server listens after this)...` antes da primeira entrada não
  protegida, e o total passa a terminar em `(<N> files in <duração>)`; `scratchDirSize` devolve bytes e contagem.
  Só uma entrada protegida (ou nada) não anuncia limpeza.

Não coberto (ver "Correção planejada"): requisições que não passam por `backendHttp.ts` (ex.: `http.get` direto de
`xbox:get-queue` em `browseHandlers.ts`) ainda podem receber `ECONNREFUSED` nos primeiros segundos; não são o
catálogo do relato.

## Testes executados

- `npx tsc` limpo; `node --test tests/unit/backendReadiness.test.cjs tests/unit/backendHttp.test.cjs
  tests/unit/browseHandlers.test.cjs` → 18/18; `npm run test:safety` → **288/288**.
- Mutação T1: retirar `await waitForBackendListening()` do `backendHttp.js` compilado → os 2 testes do gate falham
  com `ECONNREFUSED`; restaurado com `npx tsc`.
- `go test ./app/ -run CleanupStaleScratch` → 6/6; `go test ./... -count=1` → sem falha. Mutação T2: trocar o texto
  da linha de início → `TestCleanupStaleScratchLogsStartAndFileCount` falha.
- **Ponta a ponta com o backend real** (`scratchpad/e2e_readiness.cjs`: binário Go real, `GODSEND_HOME` isolado,
  porta 8093, `Temp` com 60.000 arquivos, módulos compilados do app; o app aberto do dono não foi tocado):
  - controle, sem o gate (`dist/godsend-windows-x64.exe`): `1.5s APP erro ECONNREFUSED ... 127.0.0.1:8093` — o erro do relato;
  - com o gate, mesmo binário: limpeza termina e `Server bind` aos 15,2 s; `18.5s APP resposta HTTP 200 {"releases":[]}`;
  - com o gate e o binário de T2: `1.3s Cleaning stale processing data in ...\Temp (the server listens after this)...`,
    `18.5s Removed 0.03 GB ... (60000 files in 17.2s)`, `20.9s APP resposta HTTP 200`.

## Pendente

- `dist/godsend-windows-x64.exe` **não foi recompilado**: está em uso pelo app aberto (pid 36772, filho do Electron
  39040). Ao reiniciar o app, rodar o build do backend (`docs/building.md`) para T2 entrar no runtime. T1 já está
  no `.js` compilado e vale no próximo início do app.
- Prova na UI real: reiniciar o app com um `Temp` grande e abrir o catálogo durante a limpeza.
