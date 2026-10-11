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
