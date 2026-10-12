# Bug: report de telemetria do backend Go não carrega versão do app nem identificação da máquina, e a triagem não separa versões nem máquinas

- **Detectado em:** 2026-10-10 23:30 (leitura de código e da tabela `errors` da telemetria)
- **Origem:** achado lateral do pipeline em pipeline-mkdir-da-pasta-do-jogo-falha-com-caminho-nao-encontrado-e-o-dispositivo-presente_2026-10-04T23-28 — `src/server/infrastructure/telemetry/telemetry.go::Report` / `ErrorReport`
- **Errors (serviço):** N/A (afeta todos os reports `xbox-360-companion/*` do backend; exemplos: 7026, 8565, 8616)
- **Classe:** ux (observabilidade)
- **Severidade:** P3 — Baixo: nada quebra para o usuário; trava a triagem de bugs que dependem de versão
- **Complexidade:** media — campo novo no report do backend; a versão hoje só existe como literal
- **Versões:** código atual (v2.12.110)
- **Reincidência:** primeira vez

## Sintoma

Os reports do backend chegam com `user_agent = '<componente>'` (ex.: `pipeline`), `screen = NULL`,
`page_url = NULL` e `platform = 'windows/amd64'`. Nenhum campo traz a versão do app nem um id da
máquina. No bug de origem, a hipótese "instâncias simultâneas" (corrigida na v2.12.95) não pôde ser
medida porque não há como saber se os reports de 2026-09-25 vieram de versão anterior ou posterior, nem
quantos dos 10 reports são da mesma máquina (só o idioma do texto do Windows separou duas).

## Causa raiz

`telemetry.go::Report` monta `ErrorReport{Project, File, Method, Message, UserAgent: component,
Platform: GOOS/GOARCH, Screen: "", PageURL: pageURL, Logs}`; não há campo nem origem de versão. A versão
do backend só existe como literal em `src/server/main.go` (`fmt.Printf("... v2.12.110")` na linha 25 e
o banner `"... Server v2.12.109"` na linha 78 — já divergentes entre si).

## Como reproduzir

`SELECT id, user_agent, platform, screen, page_url FROM errors WHERE project = 'xbox-360-companion/pipeline' ORDER BY id DESC LIMIT 5`
no `/diag/query`: nenhuma coluna identifica versão ou máquina.

## Resolução

A definir no planejamento (ex.: constante de versão única no backend, usada pelo banner e pelo report,
e incluída na subida de versão; ou o Electron passar a versão ao backend por env ao iniciar).

## Critérios para fechar

- [ ] Report do backend carrega a versão do app (e, se o dono quiser, um id anônimo da máquina)
- [ ] Banner e report usam a mesma origem de versão
- [ ] Teste de unidade do conteúdo do report

## Planejamento (pipeline 20261012-1854, 2026-10-12)

**Veredito:** corrigir — uma constante de versao unica no backend Go alimenta os dois banners e o `user_agent` do report; o backend passa a ler o endpoint de telemetria que o Electron ja manda.
**Complexidade:** media — logica nova num servico Go (`infrastructure/telemetry`) + troca de assinatura do `Initialize`; nao atravessa IPC nem UI.
**Severidade:** baixo — nada quebra para o usuario; afeta so a triagem (observabilidade).
**Arquivos a alterar (reserva da onda):**
- `src/server/main.go` — `const appVersion = "2.12.110"`; os dois banners (linhas 25 e 78) passam a usa-la; as duas chamadas de `telemetry.Initialize` recebem `appVersion`
- `src/server/infrastructure/telemetry/telemetry.go` — `Initialize(enabled, endpoint, version string)` guarda a versao; montagem do `ErrorReport` extraida para funcao pura (`buildReport`); `UserAgent = component + " v" + version` (so `component` se a versao vier vazia)
- `src/server/infrastructure/telemetry/telemetry_test.go` — novo: conteudo do report e POST recebido por `httptest`
- `src/server/main_test.go` — novo: `appVersion` igual ao `"version"` de `../../package.json`
- `src/server/app/config.go` — `SetupPaths` le `GODSEND_ERROR_REPORTING_ENDPOINT` em `a.TelemetryEndpoint`
- `AGENTS.md` — tabela "Atualizar a Versao nos 4 Locais" (linha 210): `src/server/main.go` -> constante `appVersion`
- `CONTRIBUTING.md` — tabela de versao (linha 74): idem
- `docs/agents/skills/docs-source-of-truth.md` — linha 22 (`banner line`): idem

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `src/server/infrastructure/telemetry/telemetry.go::Report` — monta `ErrorReport{Project: "xbox-360-companion/"+component, UserAgent: component, Platform: GOOS/GOARCH, Screen: "", PageURL, Logs}` e envia (POST, fallback GET). Nao existe variavel nem parametro de versao no pacote. Em erro: `defer recover()`, best-effort, nunca propaga.
- `telemetry.go::Initialize(enabled bool, endpoint string)` — protegido por `initOnce`; so troca o endpoint se nao vazio. Unicos chamadores: `src/server/main.go:31` (falha de `SetupPaths`, `Initialize(true, "")`) e `main.go:36` (`Initialize(a.TelemetryEnabled, a.TelemetryEndpoint)`).
- `src/server/main.go::main` — a versao so existe como literal: `"[INFO] Xbox 360 Companion Backend Server v2.12.110"` (linha 25) e o quadro `"Xbox 360 Companion Server v2.12.109"` (linha 78), ja divergentes. Os dois sao `fmt.Print*` sem consumidor no Go.
- `src/server/app/config.go::SetupPaths` (linhas 592-595) — le `GODSEND_ERROR_REPORTING` em `a.TelemetryEnabled`; **nenhuma linha atribui `a.TelemetryEndpoint`**. Mas `src/electron-app/services/settingsService.ts:254-255` manda `GODSEND_ERROR_REPORTING_ENDPOINT` ao backend quando o `config.json` tem `errorReportingEndpoint`: o backend ignora e sempre envia para producao. Entra neste fix porque e o mesmo report e porque e o que permite provar a T2 sem gravar linha de teste na telemetria de producao.
- Referencia do lado Electron (nao muda): `src/electron-app/infrastructure/telemetry.ts::reportError` ja manda `user_agent: "ElectronApp v${getAppVersion()}"`; o backend fica no mesmo formato (`<componente> v<versao>`), mantendo o componente como prefixo para quem filtra `user_agent LIKE 'pipeline%'`.
- Servidor da telemetria (outro projeto, nao muda): `digitalstoregamesbackend/mysite/flask_app.py::logError` so le `file, method, message, user_agent, platform, screen, page_url, project` (via `errorhelper.sanitize_error_input`); campo JSON novo seria descartado. `_MAX_UA = 512`. Por isso a versao vai no `user_agent`, e nao num campo novo.

### Provas (comando literal -> resultado)

- `grep -rn "2\.12\.1[01][0-9]" src/server --include=*.go` -> `main.go:25` (`v2.12.110`) e `main.go:78` (`v2.12.109`); o resto sao comentarios de teste.
- `grep -rn "telemetry\.Initialize" src --include=*.go` (testes inclusos) -> `main.go:31`, `main.go:36` (unicos).
- `grep -rn "GODSEND_ERROR_REPORTING_ENDPOINT\|TelemetryEndpoint" src/server` -> `app/app.go:44` (campo) e `main.go:36` (uso); nenhum leitor do env.
- `grep -rn "main\.go" --include=*.ps1 --include=*.js .` -> nenhum script de release le/edita a versao em `main.go` (a troca para constante nao quebra automacao). Os consumidores do texto do banner (`scripts/verify-go-binaries.js:157`, dois specs Playwright) ja procuram o texto antigo `GODSend Backend Server` desde o rebrand `2bfaca3` — registrado a parte (Achado lateral, abaixo).
- `git ls-files src/server/data` -> `iso2god_titles.jsonl` rastreado: `main_test.go` compila o `package main` (o `//go:embed` de `embed_titles.go` resolve).

### Hipoteses descartadas (e por que)

- **Electron passar a versao por env ao spawnar o backend** — descartada: o backend tambem roda sem o Electron (Android via JNI, Linux/mac direto), e o report de falha de `SetupPaths` sai antes de qualquer config; a constante cobre todos. Continua exigindo subir a versao em `main.go`, que ja e um dos 4 locais; o `main_test.go` pega a divergencia com o `package.json`.
- **Injetar a versao por `-ldflags -X` no `scripts/build-server.js`** — descartada: o manual do pipeline diz "sem flags de build", os `build:server:mac/linux/android` sao outros caminhos que teriam de mudar todos, e `go test`/`go run` ficariam com versao vazia.
- **Campo JSON novo (`version`) no report** — descartada: o `/logErr` ignora campos fora da lista (ver Causa raiz); exigiria migracao no digitalstoregamesproject.
- **Id anonimo da maquina** — NAO entra: o criterio diz "se o dono quiser", o Electron tambem nao manda id, e gerar/persistir um id que sai da maquina e decisao de privacidade do dono. Fica em "falta para close" como decisao pendente; se aprovado, vira task propria (Electron + backend, mesmo id nos dois).

### Tarefas

- [ ] `src/server/infrastructure/telemetry/telemetry.go::Initialize` — 3o parametro `version string`, guardado em variavel do pacote dentro do `initOnce` — `telemetry_test.go`: com endpoint num `httptest.Server` e versao `9.9.9`, `Report("pipeline", ...)` com `terminal=true` faz o servidor receber JSON com `user_agent == "pipeline v9.9.9"` e `project == "xbox-360-companion/pipeline"` (teste interno do pacote pode setar as variaveis direto, por causa do `initOnce`)
- [ ] `telemetry.go::Report` -> extrair `buildReport(component, file, method, message, pageURL string, logs []string) ErrorReport` (capas de mensagem/logs inclusas) com `UserAgent = component + " v" + version` quando `version != ""` — `telemetry_test.go`: versao vazia -> `user_agent == component`; mensagem de 5000 chars cortada em 4000; 25 logs -> 20
- [ ] `src/server/main.go::main` — `const appVersion = "2.12.110"`; linha 25 e quadro da linha 78 usam `appVersion` (texto `Xbox 360 Companion Backend Server v` mantido: a etapa de teste o usa como sinal); `Initialize(true, "", appVersion)` e `Initialize(a.TelemetryEnabled, a.TelemetryEndpoint, appVersion)` — `main_test.go`: `appVersion` == `"version"` de `../../package.json`
- [ ] `src/server/app/config.go::SetupPaths` — `a.TelemetryEndpoint = strings.TrimSpace(os.Getenv("GODSEND_ERROR_REPORTING_ENDPOINT"))` ao lado da leitura de `GODSEND_ERROR_REPORTING` — prova na T2 (o POST chega ao capturador local)
- [ ] doc-sync: `AGENTS.md:210`, `CONTRIBUTING.md:74`, `docs/agents/skills/docs-source-of-truth.md:22` passam a dizer "constante `appVersion` em `src/server/main.go`"; `CHANGELOG.md` `[Unreleased]` `### Fixed` com o link deste doc (sem subir versao)

### Plano de teste

- **Offline (sem slot):** `go test -count=1 ./infrastructure/telemetry/ .` em `src/server` (os testes novos); `go test -count=1 ./...` sem falha nova.
- **T2 reproducao como o usuario (E2E, no slot):** o "usuario" deste bug e quem tria a telemetria; o sinal e o corpo do report que o app da lane envia. Receita:
  1. Copiar `%APPDATA%\xbox-360-companion-electron\config.json` para a evidencia; acrescentar `"errorReportingEndpoint": "http://127.0.0.1:8765/logErr"`.
  2. Subir um capturador local (script descartavel na evidencia: servidor HTTP que grava cada POST/GET em arquivo e responde 200) em `127.0.0.1:8765`.
  3. `npm start` na lane; na Home, conferir no console do backend as DUAS linhas de banner com `v2.12.110` (no base: `.110` e `.109`).
  4. Provocar um report do backend pela UI: em Configuracoes, destino LOCAL numa pasta sem permissao de escrita (pasta criada e com `icacls <pasta> /deny %USERNAME%:(W)`); no Catalogo, enfileirar um jogo pequeno (XBLA de poucos MB) para esse destino. A gravacao falha -> `fallback.go::haltOnLocalStorageFailure` -> `telemetry.Report("pipeline", ...)`.
  5. SINAL: o capturador recebe POST com `"project": "xbox-360-companion/pipeline"` e `"user_agent": "pipeline v2.12.110"`. Se o destino sem escrita nao cair em `isLocalStorageHalt`, qualquer outro report do backend serve (o `user_agent` e montado no mesmo lugar); registrar qual caminho foi usado.
  6. Devolver o `config.json` original, remover o `deny` da pasta, fechar so os PIDs abertos.
- **Controle positivo:** no base o backend IGNORA `GODSEND_ERROR_REPORTING_ENDPOINT` (o report iria para producao), entao a receita da T2 no base NAO e rodada (gravaria linha de teste na telemetria real). O sintoma no base esta provado por (a) as linhas ja existentes na telemetria (7026, 8565, 8616: `user_agent = 'pipeline'`, sem versao), (b) o banner do base com `.110`/`.109` e (c) o `telemetry_test.go` novo, que nao compila no base (`buildReport`/3o parametro inexistentes).
- **T3 regressao direcionada:** `go test -count=1 ./...` em `src/server` e `npm --prefix src/electron-app run test:safety` (linha de base do manual). Vizinhos: (a) "enviar relatorios de erro" desligado em Configuracoes continua impedindo o envio (o capturador nao recebe nada); (b) sem `errorReportingEndpoint` no `config.json` o backend continua no endpoint padrao (`Initialize` com endpoint vazio nao troca); (c) report do Electron (`user_agent: ElectronApp v...`) inalterado.
- **T4:** console do backend na Home e `%APPDATA%\xbox-360-companion-electron\logs\` sem erro novo.
- **Falta para close:** versao publicada pelo dono e um report real de producao com `user_agent = '<componente> v<versao>'`; decisao do dono sobre o id anonimo da maquina.

### Sessoes seguintes

- dev: effort medium, ultrathink nao — troca localizada (constante, um parametro, um campo, uma leitura de env) com testes simples; o unico cuidado e o `initOnce` no teste.
- teste: effort medium, ultrathink nao — a parte delicada e provocar um report do backend pela UI sem gravar na telemetria de producao; o resto e conferir um campo.

### Achado lateral

- [`testes-smoke-wine-e-specs-playwright-esperam-banner-godsend-backend-server-que-nao-existe-mais_2026-10-12T18-57.md`](testes-smoke-wine-e-specs-playwright-esperam-banner-godsend-backend-server-que-nao-existe-mais_2026-10-12T18-57.md) — fora da reserva deste fix.

## Correcao (pipeline 20261012-1854, rodada 1)

Plano seguido sem desvio.

- `src/server/infrastructure/telemetry/telemetry.go::Initialize` — 3o parametro `appVersion`, guardado em `version` (variavel do pacote) dentro do `initOnce`.
- `telemetry.go::buildReport` — nova funcao pura, extraida de `Report` com os cortes (mensagem 4000, 20 logs, 256 KB por log); `UserAgent = component + " v" + version`, ou so `component` com versao vazia. `Report` mantem `recover`, `enabled` e o dedup, e chama `buildReport`.
- `src/server/main.go::appVersion` — `const appVersion = "2.12.110"`; banner `[INFO] Xbox 360 Companion Backend Server v%s` e o quadro (`Printf` com `%-12s`, mesma largura do quadro) usam a constante; as duas chamadas de `telemetry.Initialize` passam `appVersion`.
- `src/server/app/config.go::SetupPaths` — `a.TelemetryEndpoint = strings.TrimSpace(os.Getenv("GODSEND_ERROR_REPORTING_ENDPOINT"))`; vazio mantem o endpoint padrao (o `Initialize` so troca se nao vazio).
- doc-sync: `AGENTS.md` (tabela dos 4 locais), `CONTRIBUTING.md` (tabela de versao), `docs/agents/skills/docs-source-of-truth.md` (Version Bump Workflow) passam a citar a constante `appVersion`. `CHANGELOG.md` `[Unreleased]` `### Fixed`, sem subir versao.
- Testes novos: `telemetry_test.go` (`TestBuildReportCarriesVersionInUserAgent`, `TestBuildReportWithoutVersionKeepsComponent`, `TestBuildReportCapsMessageAndLogs`, `TestReportPostsVersionedUserAgent` com `httptest`) e `main_test.go` (`TestAppVersionMatchesPackageJSON`). `go test -count=1 ./infrastructure/telemetry/ .` em `src/server` -> `ok` nos dois pacotes.
- Ajuste ao Plano de teste: nenhum. Na T2, o quadro do banner mostra `Xbox 360 Companion Server v2.12.110` seguido de espacos ate a borda (formato `%-12s`).
