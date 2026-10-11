# Bug: o backend Go (`godsend.exe`) sai sem identidade e com hash novo a cada release, e o antivírus o trata como executável nunca visto

- **Detectado em:** 2026-10-11 00:14 (horário local), investigação
- **Origem:** alerta do Kaspersky `VHO:Trojan-PSW.Win32.Convagent.gen` no `torrent.test.exe` que o `go test` gera em `%TEMP%\go-build…` na máquina de desenvolvimento (pacote `src/server/infrastructure/torrent`). Esse arquivo nunca chega ao cliente, mas o backend publicado é compilado do mesmo código. Daí a leitura de `scripts/build-server.js`, `scripts/build-go-all.js`, `src/server/main.go`, `src/server/embed_titles.go`, `src/electron-app/services/backendClient.ts` e `settingsService.ts::buildGodsendEnv`, e a medição nos binários de `dist/`
- **Classe:** distribuição/release (falso positivo de antivírus), sem crash
- **Severidade:** **P3 — Baixo (a confirmar)**. Já houve cliente com o backend em quarentena: é a entrada do `CHANGELOG.md` sobre `spawn UNKNOWN` ("antivirus quarantined or blocked the backend executable"), tratada em `backendClient.ts:121-152`. Mas não há medição de frequência. Sobe se o evento `BACKEND` `spawn threw UNKNOWN` (`backendClient.ts:155`) aparecer com frequência nos logs que os clientes enviam. Não foi conferido se esse evento chega à telemetria.
- **Complexidade:** baixa: duas flags de build, um literal de versão que vira variável de ambiente e um recurso de versão do Windows. Não toca lógica de download nem de gravação.
- **Estado:** passada analítica concluída; nada implementado.
- **Reincidência:** ligado a [`release-xboxcompanion-exe-sem-assinatura-barrado-no-download-pelo-smartscreen-do-edge_2026-10-06T17-49.md`](release-xboxcompanion-exe-sem-assinatura-barrado-no-download-pelo-smartscreen-do-edge_2026-10-06T17-49.md). Mesma raiz (sem assinatura), outro arquivo: lá é o `.exe` externo baixado pelo navegador, aqui é o backend que ele carrega. Ver "Escopo".

## Sintoma

Antivírus com reputação na nuvem (Kaspersky KSN, Defender com proteção na nuvem) julgam cada arquivo pelo hash. Um executável sem assinatura, sem nome de produto e com hash que nenhum outro cliente rodou ainda é suspeito por definição. O backend junta isso ao comportamento que heurística de "ladrão de senha" procura (`net/http`, `os/exec`, leitura e escrita de arquivos). O alerta do Kaspersky no `torrent.test.exe` mostra a heurística disparando nesse código.

Hoje o backend publicado cai nas três condições a cada release:

1. **Sem identidade:** o PE não tem `VERSIONINFO`. Nome de produto, empresa e descrição vêm vazios.
2. **Hash novo a cada release,** mesmo quando a lógica do backend não mudou.
3. **Sem assinatura** (fora deste bug).

Um envio de falso positivo à Microsoft ou ao Kaspersky vale só para o hash enviado. Com a condição 2, a liberação se perde na release seguinte.

## Evidência (2026-10-11)

### O que o código faz (aberto, não inferido)

- [`scripts/build-server.js`](../../../scripts/build-server.js) (`build:server:win:*`, chamado por `build-portable-local.ps1:106-110`): roda `go build -o <saída> .` para `windows/amd64` (`godsend-windows-x64.exe`, copiado para `godsend.exe`) e `windows/386` (`godsend-windows-ia32.exe`). Só define `GOOS`, `GOARCH` e `CGO_ENABLED=0`: sem `-trimpath`, sem `-buildvcs=false`, sem `-ldflags`. Sem Go no PATH, reaproveita o binário que já está em `dist/`.
- [`scripts/build-go-all.js:54`](../../../scripts/build-go-all.js) (`build:server:all`): mesma chamada `go build -o out .`, para as mesmas duas saídas Windows (linhas 43-44) e as de Linux/macOS.
- [`src/server/main.go:25`](../../../src/server/main.go) e `:78`: a versão do app está **escrita no fonte**, só nos dois banners (`Backend Server v2.12.110` e `Server v2.12.109`; estão divergentes agora, porque o bump é manual). Nenhum outro `.go` usa a versão (`grep 2\.12\.1\d\d` em `src/server/*.go` só acha esses dois banners e comentários).
- [`src/server/embed_titles.go`](../../../src/server/embed_titles.go): `//go:embed data/iso2god_titles.jsonl`. Dado embutido no binário, mas parado: zero commits nesse arquivo desde 2026-08-01.
- [`backendClient.ts:138`](../../../src/electron-app/services/backendClient.ts): `spawn(godsendExePath, [], { env: childEnv })`, com `childEnv` de [`settingsService.ts::buildGodsendEnv`](../../../src/electron-app/services/settingsService.ts) (linha 221), que hoje só passa `GODSEND_*` de caminhos, portas e credenciais. A versão do app já está disponível ali (`getAppVersion()`, usado em `backendClient.ts:113`), mas não é repassada ao backend.
- [`scripts/verify-go-binaries.js:157`](../../../scripts/verify-go-binaries.js): o smoke test (só roda com `wine`) espera o banner `GODSend Backend Server v`, que o `main.go` não imprime mais (`Xbox 360 Companion Backend Server v…`). Já está desalinhado hoje. Quem mexer no banner (T1) alinha os dois.

### Comandos que provaram algo

| # | comando | resultado |
|---|---|---|
| 1 | `(Get-Item dist\godsend-windows-x64.exe).VersionInfo` (e `-ia32`) | `ProductName`, `CompanyName` e `FileDescription` **vazios** |
| 2 | `(Get-Item dist\xbox-360-companion-Portable-2.12.99.exe).VersionInfo` | `Xbox 360 Companion` / `Nesquin and ghosty99` / versão `2.12.99`: o `.exe` do Electron **já tem** identidade |
| 3 | `go version -m dist\godsend-windows-x64.exe` (build de 2026-10-09 13:36) | `vcs=git`, `vcs.revision=e7121057…`, `vcs.time=2026-10-09T16:31:52Z`, `vcs.modified=true`; sem `-trimpath` |
| 4 | em `src/server`, HEAD `d7bd9ad`, go1.26.6, `GOOS=windows GOARCH=amd64 CGO_ENABLED=0`: `go build -o a.exe .` duas vezes | `C134627F9A3D7FD8` nas duas: o build é determinístico |
| 5 | idem com `go build -trimpath -buildvcs=false` duas vezes | `62C78DDB86CA0285` nas duas |
| 6 | os 13 últimos commits que tocam `src/electron-app/package.json` (= bumps de versão), `git diff --name-only <anterior> <atual> -- src/server/*.go src/server/**/*.go go.mod go.sum` para cada par | **12 de 12** pares mudam algum `.go`. Em **5 de 12** (`f7e02f0→dee3a10`, `c814e3d→0f530c2`, `758510b→86dfac6`, `86dfac6→1ea25b6`, `1ea25b6→d4cce82`) o único arquivo é `main.go`, e o diff é só o literal de versão (ex.: `v2.12.108` → `v2.12.109` nos dois banners) |

Leitura de 4 e 5: o hash não muda por acaso. Ele muda pelo **conteúdo**, e parte desse conteúdo não é lógica: o carimbo `vcs.*` (muda em qualquer commit, inclusive de doc, e com `vcs.modified` também pela árvore suja) e o literal de versão do `main.go`. Em 5 das 12 últimas releases, o backend publicado só mudou por isso.

### Hipóteses descartadas

- **"`signAndEditExecutable: false` deixa o `.exe` do Electron sem metadados"** (afirmado no chat antes da medição): **falso**, ver comando 2. Só o backend Go está sem identidade.
- **"O build Go não é reprodutível"**: falso, comandos 4 e 5.
- **"É malware de verdade, dependência adulterada"**: `go mod verify` em `src/server` → `all modules verified` (2026-10-10).
- **"Compressor de executável (UPX) piorando a heurística"**: não usado (`grep -i upx` no repo só acha hashes em `go.sum`/`package-lock.json`).
- **"O dado embutido muda a cada release"**: não neste projeto, ver `embed_titles.go` acima.

## Causa raiz

1. **Sem `VERSIONINFO`:** nenhum passo do build gera recurso de versão para o backend (não há `.syso`, `goversioninfo` nem `go-winres` em `src/server` ou nos scripts).
2. **Hash instável sem mudança de lógica:** `-buildvcs` fica no padrão (`auto`, que carimba o commit), e a versão do app está literal em `main.go:25`/`:78`, trocada a mão em toda release.

## Correção planejada

- **T1 — hash estável enquanto o código Go não muda.**
  - `scripts/build-server.js` e `scripts/build-go-all.js`: acrescentar `-trimpath` e `-buildvcs=false` às chamadas `go build`. Nas duas, para os builds Windows não divergirem conforme o script usado.
  - `src/server/main.go`: os banners passam a ler a versão de `GODSEND_APP_VERSION`, com `dev` quando ausente. **Não usar `-ldflags -X`**: isso põe a versão de volta no binário e desfaz a correção.
  - `settingsService.ts::buildGodsendEnv`: `env.GODSEND_APP_VERSION = getAppVersion()` (conferir o import; hoje `getAppVersion` é usado em `backendClient.ts`).
  - `scripts/verify-go-binaries.js:157`: aceitar o banner atual.
  - **Prova:** (a) build no HEAD; `git worktree add` no mesmo HEAD, com um commit vazio por cima; build lá; mesmo SHA-256. Hoje dá diferente por causa de `vcs.revision`. (b) `go version -m` sem `vcs.*` e com `-trimpath=true`. (c) App aberto: o log do backend mostra o banner com a versão do app, não `dev`.
- **T2 — identidade no PE.**
  - Gerar `rsrc_windows_amd64.syso` e `rsrc_windows_386.syso` em `src/server` (pacote `main`; o `go build` liga `.syso` sozinho). A ferramenta candidata é `github.com/tc-hib/go-winres`, a partir de um `winres/winres.json` versionado. Campos: `ProductName` = `Xbox 360 Companion` e `CompanyName` iguais aos do Electron (comando 2), `FileDescription` dizendo que é o serviço local do app, `OriginalFilename` = `godsend.exe`, ícone do app.
  - **A versão do recurso não pode ser a do app**, senão T2 desfaz T1. Usar uma versão própria do backend, que só muda quando o código Go muda, ou fixa.
  - Commitar os `.syso` gerados e o `.json` de origem, para o build não depender de baixar a ferramenta.
  - **Prova:** `(Get-Item dist\godsend-windows-x64.exe).VersionInfo.ProductName -eq 'Xbox 360 Companion'`, idem para `-ia32`. A prova (a) de T1 continua passando com o recurso presente.
- **Depois de T1+T2 (operacional, fora do código):** enviar o backend da release seguinte à Microsoft (envio de arquivo como desenvolvedor de software) e ao Kaspersky como falso positivo. Com T1, a liberação passa a valer até a próxima mudança real no Go.

## Escopo — o que NÃO é este bug

- **O `.exe` externo (`xboxcompanion.exe`, portátil NSIS)** barrado pelo SmartScreen: bug próprio, linkado acima. Esse arquivo muda a cada release por definição (versão do app), então T1 não o ajuda.
- **Assinatura de código** (certificado ou Azure Trusted Signing): decisão de custo, registrada no bug do SmartScreen.
- **Comportamento que a heurística pontua:** `Start-Process … -Verb RunAs -WindowStyle Hidden` em [`fat32Format.ts:571`](../../../src/electron-app/infrastructure/fat32Format.ts) e o portátil que extrai no `%TEMP%`. Não registrado; avaliar à parte.
- **`aria2c.exe` e `fat32format.exe`:** são de terceiros, baixados por `download-aria2.js`/`download-fat32format.js`. Não foram avaliados aqui.
- **O alerta na máquina de desenvolvimento** (`torrent.test.exe`): resolve-se com exclusão no antivírus ou `GOTMPDIR`, sem mudança no repo.

## Critérios para fechar

- T1 e T2 com as provas acima verdes, numa release publicada.
- O backend de uma release enviado à Microsoft e ao Kaspersky, e a release seguinte sem mudança em `src/server` publicando o **mesmo** SHA-256 de backend.
