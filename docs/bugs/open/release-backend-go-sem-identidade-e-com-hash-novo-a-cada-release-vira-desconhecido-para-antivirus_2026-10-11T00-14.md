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

## Planejamento (pipeline 20261012-1854, 2026-10-12)

**Veredito:** corrigir — o build do backend Windows passa a sair com `-trimpath -buildvcs=false` e com recurso `VERSIONINFO` (gerado por `go-winres`, versionado como `.syso`); a parte "tirar a versão do app do binário" (env `GODSEND_APP_VERSION`) **sai do escopo**, porque colide com o bug irmão desta execução, que já está planejado com uma constante de versão no Go (ver "Hipóteses descartadas").
**Complexidade:** media — empacotamento do backend (flags de `go build` + recurso PE gerado e commitado), critério do `docs/bugs/open/README.md`; nenhuma lógica de runtime muda.
**Severidade:** baixo — falso positivo de antivírus sem medição de frequência; o contorno (liberar no antivírus) já é sugerido em `backendClient.ts::startGodsend`; a cura de verdade é a assinatura (bug do SmartScreen, decisão do dono).
**Arquivos a alterar (reserva da onda):**
- `scripts/build-server.js` — `-trimpath -buildvcs=false` nos dois `go build` (x64 e ia32)
- `scripts/build-go-all.js` — as mesmas flags no `go build` do laço de alvos
- `src/server/winres.json` — novo: `RT_VERSION` (+ `RT_GROUP_ICON`), fonte do recurso (na raiz de `src/server`, não em `winres/`: o helper exige pasta existente na reserva; gera-se com `make --in winres.json`)
- `src/server/rsrc_windows_amd64.syso` — novo, gerado do `.json` (binário, commitado)
- `src/server/rsrc_windows_386.syso` — novo, gerado do `.json` (binário, commitado)
- `docs/building.md` — doc-sync: flags do build Windows e como regenerar o recurso

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `scripts/build-server.js` (script inteiro, sem funções nomeadas além de `run`/`hasGo`) — com `go` no PATH, roda `go build -o <dist>\godsend-windows-x64.exe .` (copia para `godsend.exe`) e `go build -o <dist>\godsend-windows-ia32.exe .` em `src/server`, env `GOOS/GOARCH/CGO_ENABLED=0`, **sem nenhuma outra flag**; no fim roda `verify-go-binaries.js windows-all`. Em erro: `run()` faz `process.exit(status)`. É o que o `projeto.json` (build do helper: `npm run build:server`), o `build-and-upload.ps1:239` e o `build-portable-local.ps1:106-110` chamam.
- `scripts/build-go-all.js` (`build:server:all`) — laço `targets` com `spawnSync("go", ["build", "-o", out, "."])`, as mesmas duas saídas Windows e as Linux/macOS; sem flags. Em erro: `process.exit`.
- `src/server` não tem `.syso`, `winres/` nem `goversioninfo`/`go-winres` (`ls src/server/*.syso` vazio): o PE sai sem `VERSIONINFO` nem ícone.
- Nenhum código lê o carimbo de build: `grep -rn "ReadBuildInfo\|vcs\.revision" src/server src/electron-app` vazio — `-buildvcs=false` não tira nada de ninguém. `runtime.Caller`/`debug.Stack` também não aparecem em `src/server` (fora de teste): `-trimpath` não muda texto de log.
- Nada no app fixa o hash do backend (o `trustedComponentManifest` não cita `godsend`): o hash mudar ou ficar igual não quebra o spawn.
- Nome com que o backend é instalado no app empacotado: `godsend-backend.exe` (`src/electron-app/infrastructure/fileSystem.ts:37`, `package.json:148` `"to": "godsend-backend.exe"`). Ícone do app Windows: `src/electron-app/assets/tray.ico` (`package.json:142`, `build.win.icon`). Identidade do `.exe` do Electron: `productName` `Xbox 360 Companion` (`package.json:90`), `author` `Nesquin and ghosty99` (`package.json:40`).
- Biblioteca (aberta no cache de módulos, `github.com/tc-hib/go-winres@v0.3.3`, a última, de 2023-10-13): `make` lê `winres/winres.json` por padrão (`defaultJSONFile`; outro caminho com `--in`), gera `rsrc_windows_amd64.syso` e `rsrc_windows_386.syso` (padrão `defaultArch = "amd64,386"`) no diretório corrente; só gera os recursos listados no `.json` (sem `RT_MANIFEST` no `.json`, sem manifesto). O sufixo `_windows_<arch>` faz o `go build` ligar o `.syso` só naquele GOOS/GOARCH (README da ferramenta e regra de nome de arquivo do Go).

### Provas (comando literal -> resultado)

| # | comando | resultado |
|---|---|---|
| P1 | `(Get-Item C:\projects\Downloader-XBOX360-XEX-HDD-Games\dist\godsend-windows-x64.exe).VersionInfo` (build de hoje, 18:22) | `ProductName`, `CompanyName`, `FileDescription` vazios (confirma o comando 1 do doc) |
| P2 | `go version -m <mesmo arquivo>` | `vcs=git`, `vcs.revision=bc5f5e6c…`, `vcs.time=2026-10-12T21:19:55Z`, `vcs.modified=false`; sem `-trimpath` |
| P3 | `grep -a -o "C:/Users/[a-zA-Z]*/go/pkg/mod" <mesmo arquivo> \| sort \| uniq -c` | **219** ocorrências de `C:/Users/luist/go/pkg/mod`; e **62** caminhos `C:/projects/Downloader-XBOX360-XEX-HDD-Games/src/server/*.go`. O binário publicado leva o caminho da árvore e o nome de usuário de quem buildou, e o hash muda conforme a pasta (lane x árvore principal) |
| P4 | `sha256sum <mesmo arquivo>` | `99539683ae54c612…` (controle positivo do base) |
| P5 | `go list -m -versions github.com/tc-hib/go-winres` | `… v0.3.2 v0.3.3` |
| P6 | `grep -rn "main\.go" --include=*.ps1 --include=*.js .` e `grep -n main.go AGENTS.md CONTRIBUTING.md docs/...` | nenhum script edita `main.go`; a versão nele é passo manual do bump (AGENTS.md:210, CONTRIBUTING.md:74, `.claude/CLAUDE.md:15`, `docs/ATUALIZACAO-AUTOMATICA.md:205`) |

### Hipoteses descartadas (e por que)

- **Tirar a versão do app do binário (`GODSEND_APP_VERSION` por env do Electron, banners lendo o env) — T1 original deste doc: FORA DO ESCOPO.** O bug irmão desta execução [`pipeline-report-de-telemetria-do-backend-nao-carrega-versao-do-app_2026-10-10T23-30`](pipeline-report-de-telemetria-do-backend-nao-carrega-versao-do-app_2026-10-10T23-30.md) já está `planejado` com `const appVersion = "2.12.110"` em `main.go` alimentando banners e o `user_agent` da telemetria, e descartou o env com motivo válido: o backend também roda sem o Electron (Android, que o sobe por `GodsendBackendService.kt` com env próprio; Linux/mac direto) e ficaria sem versão. Com a constante, `main.go` muda a cada bump e **o hash do backend muda a cada release de qualquer forma**. Pela medição do próprio doc (comando 6), 7 de 12 releases já mudam código Go de verdade; o ganho de "mesmo hash entre releases sem mudança de Go" valia para ~5 de 12 e dependia de o dono reenviar o binário a Microsoft/Kaspersky — não justifica disputar `main.go`/`settingsService.ts` com um fix de telemetria que a triagem precisa. O que resolve reputação de verdade é a assinatura (bug do SmartScreen).
- **Versão do recurso = versão do app (`--product-version`/`--file-version`):** descartada. Obrigaria regenerar o `.syso` a cada bump (5º local manual, fácil de esquecer e de ficar velho). O recurso leva versão fixa `1.0.0.0`; a versão do app continua no banner (bug irmão).
- **`-ldflags -X` para a versão:** fora do escopo pelo mesmo motivo; o irmão também a descartou.
- **Manifesto (`RT_MANIFEST`) no recurso:** descartado. Hoje o backend não tem manifesto; um manifesto muda o comportamento do processo (compatibilidade de SO, DPI, long path). O objetivo é só identidade: `RT_VERSION` + ícone.
- **Alinhar o banner esperado em `scripts/verify-go-binaries.js:157`** (estava na T1 original): já é bug próprio, aberto hoje por outro planner — [`testes-smoke-wine-e-specs-playwright-esperam-banner-godsend-backend-server-que-nao-existe-mais_2026-10-12T18-57`](testes-smoke-wine-e-specs-playwright-esperam-banner-godsend-backend-server-que-nao-existe-mais_2026-10-12T18-57.md). Este fix não muda o texto do banner.
- **`npm run build:server:mac/linux/android`** (`go build` inline no `package.json` e `build-android.js`): não recebem as flags. O falso positivo é de antivírus Windows; mexer neles só aumentaria a reserva.

**Critérios para fechar (revisados por este planejamento; os de cima ficam como histórico):**
- `VERSIONINFO` presente nos dois backends Windows publicados (`ProductName` `Xbox 360 Companion`).
- O backend publicado sem `vcs.*` e sem caminho local (`C:/Users/…`, `C:/projects/…`).
- Dois builds do MESMO código Go em commits/pastas diferentes dão o mesmo SHA-256 (reprodutível; entre releases muda, por causa da constante do bug irmão).
- (Operacional, dono) enviar o backend da release à Microsoft/Kaspersky quando houver alerta de cliente.

### Tarefas

- [ ] `scripts/build-server.js` — nos dois `run("go", ["build", "-o", …, "."])` (x64 e ia32) usar `["build", "-trimpath", "-buildvcs=false", "-o", out, "."]` (constante única para os dois, comentário citando `[[release-backend-go-sem-identidade-e-com-hash-novo-a-cada-release-vira-desconhecido-para-antivirus_2026-10-11T00-14]]`: sem carimbo de commit nem caminho local o binário só muda quando o Go muda) — prova: P-off-2/P-off-3/P-off-4 abaixo, depois do `build` do helper.
- [ ] `scripts/build-go-all.js` — as mesmas flags no `spawnSync("go", ["build", …])` do laço `targets` — prova: leitura do diff (o helper não roda este script; não rodar `build:server:all` à mão).
- [ ] `src/server/winres.json` — novo, só `RT_GROUP_ICON` (`"APP"` → `"0000"` → `"../electron-app/assets/tray.ico"`, caminho relativo ao `.json`; conferir que a ferramenta resolve assim) e `RT_VERSION` `#1`/`0000`: `fixed.file_version` = `fixed.product_version` = `1.0.0.0`, **sem `timestamp`**; `info."0409"`: `ProductName` `Xbox 360 Companion`, `CompanyName` `Nesquin and ghosty99`, `FileDescription` `Xbox 360 Companion - servico local (backend)`, `InternalName` `godsend`, `OriginalFilename` `godsend-backend.exe`, `FileVersion`/`ProductVersion` `1.0.0.0`, `LegalCopyright` vazio. **Sem `RT_MANIFEST`.**
- [ ] `src/server/rsrc_windows_amd64.syso` e `src/server/rsrc_windows_386.syso` — gerar em `src/server` com `go run github.com/tc-hib/go-winres@v0.3.3 make --in winres.json` (gerador de código, não é o build do projeto: o build continua SÓ pelo `build` do helper) e commitar os dois junto do `.json`, para o build não baixar a ferramenta — prova: P-off-1 e P-off-5. Se a ferramenta gravar `.syso` de outra arquitetura, commitar só os dois.
- [ ] `docs/building.md` — logo abaixo da lista "Backend only": os builds Windows usam `-trimpath -buildvcs=false` (por quê, em uma linha) e o recurso de versão vem de `src/server/winres.json` → `.syso` commitados; regenerar com o comando acima ao mudar o `.json` ou o ícone; versão do recurso fixa de propósito. Na árvore "Repository structure", uma linha para `winres.json` e `rsrc_windows_*.syso`.
- [ ] `CHANGELOG.md` `[Unreleased]` `### Fixed` (fora da reserva, `merge=union`): o porquê, os arquivos e o link deste doc; **sem subir versão** (manual, seção Dev).
- [ ] Commit `fix(build): backend Windows com VERSIONINFO e build reprodutivel (-trimpath -buildvcs=false) (bug: release-backend-go-sem-identidade-e-com-hash-novo-a-cada-release-vira-desconhecido-para-antivirus_2026-10-11T00-14)`. Depois do `build` do helper no commit do fix, **registrar no doc o SHA-256 de `dist\godsend-windows-x64.exe` e `dist\godsend-windows-ia32.exe`** (entrada da prova de reprodutibilidade do teste).

### Plano de teste

- **Offline (sem slot)** — todos sobre o `dist\` da lane depois do `build` do helper (nunca `go build` à mão):
  - P-off-1: `(Get-Item dist\godsend-windows-x64.exe).VersionInfo | Select ProductName,CompanyName,FileDescription,OriginalFilename,FileVersion` → `Xbox 360 Companion`, `Nesquin and ghosty99`, a descrição, `godsend-backend.exe`, `1.0.0.0`; idem `dist\godsend-windows-ia32.exe` e `dist\godsend.exe`. (Base: vazio, P1.)
  - P-off-2: `go version -m dist\godsend-windows-x64.exe` → tem `-buildvcs=false` e `-trimpath=true`, **nenhuma** linha `vcs.` (base: P2). Idem `-ia32`.
  - P-off-3: `grep -a -c "C:/Users/" dist/godsend-windows-x64.exe` e `grep -a -c "Downloader-XBOX360\|bugfix-xbox360" dist/godsend-windows-x64.exe` → `0` (base: 219 / 62, P3).
  - P-off-4 (reprodutível): SHA-256 do `dist\godsend-windows-x64.exe`/`-ia32` depois do `build` do helper no HEAD da etapa de teste (que já tem commits de doc a mais que o commit do fix) **igual** ao que o dev registrou no doc. Mesmo toolchain (`go version` = go1.26.6) é pré-requisito; se o Go da máquina mudou entre as duas sessões, registrar e não reprovar por isso.
  - P-off-5: em `src/server`, `$env:GOOS='linux'; $env:GOARCH='amd64'; go list -f '{{.SysoFiles}}' .` → `[]`; com `GOOS=windows GOARCH=amd64` → `[rsrc_windows_amd64.syso]`; `GOARCH=386` → `[rsrc_windows_386.syso]` (`go list` não compila; prova que Linux/mac/Android não recebem o recurso). Limpar as variáveis depois.
- **T2 reproducao como o usuario (E2E, no slot):** o sintoma em si (antivírus com reputação na nuvem tratando o backend como desconhecido) **não tem caminho de usuário reproduzível aqui**: depende do Kaspersky/Defender do cliente e da reputação do hash na nuvem — é bug de empacotamento. A T2 é a do usuário usando o app com o backend NOVO (o `.syso` entra no PE que ele executa): `npm start` na lane (config copiada para a evidência antes); na Home o console do backend mostra o banner `Xbox 360 Companion Backend Server v…` e o backend chega a "escutando"; `Get-Process godsend-windows-x64 | Select Id,Path,Description,Product` → `Path` dentro da lane, `Description` = a `FileDescription` do `.json`, `Product` = `Xbox 360 Companion` (é o que o cliente vê no Gerenciador de Tarefas e o que o antivírus registra); abrir Catálogo/Browse (Xbox 360) e ver a lista carregar (rota HTTP do backend respondendo). Print da janela do app (PrintWindow/`page.screenshot`) e a saída do `Get-Process` na evidência. Fechar só o PID aberto; devolver o `config.json`.
- **Controle positivo:** o backend do base já buildado na árvore principal (`C:\projects\Downloader-XBOX360-XEX-HDD-Games\dist\godsend-windows-x64.exe`, commit `bc5f5e6`, só leitura): P1-P4 acima (identidade vazia, `vcs.*`, 219 caminhos locais). Não há `deploy --at-base` neste projeto. No base, o `Get-Process … Description` vem vazio.
- **T3 regressao direcionada:** `go test -count=1 ./...` em `src/server` (o pacote `main` passa a ligar o `.syso` no teste Windows; o irmão de telemetria acrescenta `main_test.go`) e `npm --prefix src/electron-app run test:safety`; linha de base do manual (Go rc 0; `test:safety` sem `fail` novo). Vizinhos: (a) o `verify-go-binaries.js windows-all` do fim do `build:server` continua aceitando os PE (magic/machine) com o recurso — sai 0 no `build` do helper; (b) o spawn do backend pelo Electron (T2) — sem manifesto, o processo sobe igual; (c) se o fix de `build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30` (mesmo `build-server.js`) já tiver entrado, conferir que as flags estão nas DUAS chamadas depois do rebase.
- **T4:** console do backend na Home e `%APPDATA%\xbox-360-companion-electron\logs\` sem erro novo.
- **Falta para close:** versão publicada pelo dono (`build-and-upload.ps1`) e a conferência P-off-1/P-off-3 no `godsend-backend.exe` instalado pela release; envio ao antivírus se houver alerta de cliente.

### Sessoes seguintes

- dev: effort medium, ultrathink nao — troca mecânica (flags) + gerar um recurso com ferramenta conhecida; o único cuidado é o `.json` (caminho do ícone, sem manifesto, sem timestamp) e registrar os SHA-256.
- teste: effort medium, ultrathink nao — provas majoritariamente offline (VersionInfo, `go version -m`, `grep`, SHA); E2E curto de subir o app e ver o backend responder.

### Coordenacao com outros itens desta execucao

- `pipeline-report-de-telemetria-do-backend-nao-carrega-versao-do-app_2026-10-10T23-30` (planejado): sem arquivo em comum com este plano depois do corte; nenhum dos dois depende do outro. Este fix **não** toca `main.go` nem `settingsService.ts`.
- `build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30` (em planejamento): também mexe em `scripts/build-server.js` (chamada final ao verify). A reserva serializa os dois; sem dependência lógica.
