# Bug: `npm run build:server:win:ia32` sozinho falha no verify, exigindo o `godsend.exe` x64

- **Detectado em:** 2026-10-07 22:50 (build do portátil ia32 numa worktree limpa, sessão que fez a T3 do bug do 32 bits); registrado em 2026-10-10
- **Origem:** achado lateral do pipeline em release-companion-32-bits-nao-publicado-e-atualizador-trocaria-pelo-x64_2026-10-07T23-30 (`scripts/build-server.js`, chamada final a `scripts/verify-go-binaries.js`)
- **Errors (serviço):** N/A (build local)
- **Classe:** fail (build)
- **Versões:** visto na 2.12.109; código atual (`d7bd9ad`) igual
- **Reincidência:** primeira vez
- **Severidade:** P3 — só quebra o build ia32 isolado numa árvore sem `dist/godsend.exe`; o `build-and-upload.ps1` usa `build:server` (todas as arquiteturas) e não é afetado.

## Sintoma

Numa árvore limpa (sem `dist/godsend.exe`), `npm run build:server:win:ia32` compila
`dist/godsend-windows-ia32.exe` e depois falha no `verify` cobrando o `godsend.exe` x64
(registrado em "Execução da T3" do doc
[release-companion-32-bits...](../retest/release-companion-32-bits-nao-publicado-e-atualizador-trocaria-pelo-x64_2026-10-07T23-30.md)).
Quem chama: `build:win:ia32` (`package.json`) e `build-portable-local.ps1 -Arch ia32`
(`Invoke-Step ... "build:server:win:ia32"`).

## Causa raiz

- `scripts/build-server.js`: com `--ia32`, `buildX64` é falso e só o ia32 é compilado; mas a última
  instrução roda **sempre** `verify-go-binaries.js windows-all`.
- `scripts/verify-go-binaries.js::expand("windows-all")` começa a lista com `"windows"` incondicionalmente
  (`const list = ["windows"]`, alvo `godsend.exe` PE32+); `windows-x64`/`windows-ia32` só entram se o
  arquivo existir. Logo, sem `godsend.exe`, o verify falha mesmo com o ia32 correto.

## Como reproduzir

Árvore sem `dist/godsend.exe` → `npm run build:server:win:ia32` → exit != 0 no verify.

## Resolução (a planejar)

Verificar só o que foi construído: passar ao verify as chaves das arquiteturas escolhidas
(`windows`/`windows-x64` quando `buildX64`, `windows-ia32` quando `buildIa32`). Não investigado além disso.

## Critérios para fechar

- [ ] `build:server:win:ia32` numa árvore sem `dist/godsend.exe` sai 0 e verifica o PE32 do ia32
- [ ] `build:server` (todas) continua verificando o `godsend.exe` x64

## Planejamento (pipeline 20261012-1854, 2026-10-12)

**Veredito:** corrigir — `scripts/build-server.js` passa ao verify a lista fixa `windows-all`, que sempre exige `godsend.exe`; o fix passa só as arquiteturas compiladas.
**Complexidade:** baixa — troca localizada num script de build (argv e lista de alvos), sem Go, IPC nem UI.
**Severidade:** baixo — só o build isolado ia32 (`build:win:ia32`, `build-portable-local.ps1 -Arch ia32`) numa árvore sem `dist/godsend.exe`; a publicação (`build-and-upload.ps1` -> `build:server` sem argumento) não é afetada.
**Arquivos a alterar (reserva da onda):**
- `scripts/build-server.js` — aceitar `--all`; montar a lista de alvos do verify a partir de `buildX64`/`buildIa32` em vez de `windows-all`

(`CHANGELOG.md` também, fora da reserva por regra do manual.)

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `scripts/build-server.js` (top-level, 92 linhas, lido inteiro):
  - `buildX64`/`buildIa32` = `argv.length === 0 || includes("x64"|"amd64"|"--x64"|"all")` / `("ia32"|"386"|"--ia32"|"all")`. **Não aceita `--all`** (achado lateral, abaixo).
  - bloco `if (buildX64)`: com Go, compila `godsend-windows-x64.exe` e copia para `godsend.exe`; sem Go, reusa o prebuilt (sincronizando os dois nomes) ou `process.exit(1)` se não houver nenhum. Logo, se o fluxo chega ao verify com `buildX64`, os dois arquivos x64 existem.
  - bloco `if (buildIa32)`: com Go, compila `godsend-windows-ia32.exe`; sem Go e sem prebuilt, só `console.warn` ("skipping ia32 backend compilation") e **segue** — o ia32 pode faltar no verify, e isso é intencional (aviso, não erro).
  - última instrução: `run(node, [verify-go-binaries.js, "windows-all"])` **incondicional**; `run` faz `process.exit(status)` se o filho sair != 0.
- `scripts/verify-go-binaries.js::expand("windows-all")` — devolve `["windows"]` + `"windows-x64"` se `dist/godsend-windows-x64.exe` existir + `"windows-ia32"` se `dist/godsend-windows-ia32.exe` existir. `"windows"` (= `dist/godsend.exe`, PE32+ x64) entra **sempre**.
- `scripts/verify-go-binaries.js::checkOne(key)` — arquivo ausente: `console.error("✗ ... missing")` e devolve `false`; `main` sai 1 se algum `false`. Sem alvo nenhum (`targets.length === 0`): imprime o uso e sai **2**. Aceita vários alvos posicionais (`targets.flatMap(expand)`).
- Chamadores de `windows-all` (grep no repo, fora de node_modules e docs de bug): **só** `scripts/build-server.js:89`. `build-go-all.js` usa `"all"`; os `build:server:mac|linux*` passam alvos explícitos. Portanto `verify-go-binaries.js` não muda.
- Chamadores de `build-server.js`: `package.json` (`build:server` sem arg; `:win:x64` `--x64`; `:win:ia32` `--ia32`; `:win:all` `--all`), `build-and-upload.ps1:239` (`npm run build:server`), `build-portable-local.ps1:105-111` (`-Arch all|ia32|x64`, padrão `x64`) e o `build` do pipeline (`projeto.json`: `npm run build:server`).

### Provas (comando literal -> resultado)

- Parsing do argv com as mesmas expressões do script (`node -e '<buildX64/buildIa32 copiados>' -- <arg>`):
  `[]` -> x64=true ia32=true; `["--x64"]` -> x64=true ia32=false; `["--ia32"]` -> x64=false ia32=true; **`["--all"]` -> x64=false ia32=false**.
- `grep -rn "verify-go-binaries\|build-server\.js\|build:server:win"` (repo, sem node_modules) -> único uso de `windows-all` em `scripts/build-server.js:89`.
- O sintoma em si foi executado e registrado no doc de origem (retest/release-companion-32-bits..., "Execução da T3"); o planning não compila, então não foi reexecutado.

### Hipoteses descartadas (e por que)

- **Mudar `expand("windows-all")` no verify para não exigir `godsend.exe`:** enfraqueceria a garantia do build completo (critério 2), e o verify não sabe o que foi compilado; quem sabe é o `build-server.js`.
- **Verificar o ia32 sempre que `buildIa32`:** quebraria o caminho sem Go e sem prebuilt ia32, que hoje é só aviso. Verificar o ia32 só se o arquivo existir mantém esse contrato.
- **Corrigir só a lista e deixar `--all` como está:** com a lista nova, `--all` (nenhuma arquitetura marcada) chamaria o verify sem alvo -> saída 2. Hoje ele passa sobre binários velhos (empacotando backend velho) ou falha em árvore limpa. O ajuste é um token nas mesmas duas linhas: entra neste fix, e o doc lateral é corrigido junto.
- **Refatorar `build-server.js` em funções exportáveis para teste de unidade:** mais código que o fix; a prova real é rodar o script (Plano de teste).

### Tarefas

- [ ] `scripts/build-server.js` (cálculo de `buildX64`/`buildIa32`) — acrescentar `argv.includes("--all")` às duas condições — prova: T2-c.
- [ ] `scripts/build-server.js` (chamada final ao verify) — trocar `"windows-all"` por alvos explícitos: `"windows"` e `"windows-x64"` se `buildX64`; `"windows-ia32"` se `buildIa32 && fs.existsSync(dist/godsend-windows-ia32.exe)`; comentário citando `[[build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30]]` — prova: T2-a e T2-b.
- [ ] `CHANGELOG.md` `## [Unreleased]` `### Fixed` — uma entrada citando os dois docs (este e o lateral [build-build-server-win-all-nao-compila...](build-build-server-win-all-nao-compila-nenhuma-arquitetura-e-verifica-binarios-antigos_2026-10-12T19-20.md)); o dev leva os dois para `retest/`.
- Sem doc-sync: nenhuma rota/IPC/serviço/env; os nomes dos scripts npm não mudam (`AGENTS.md:164-165` e `docs/building.md:15-16` seguem corretos).

### Plano de teste

- **Offline (sem slot):** `python <helper> build --bug <slug>` roda `npm run build:server` (sem argumento) -> sai 0 e o log mostra `[verify] ✓ godsend.exe`, `✓ godsend-windows-x64.exe` e `✓ godsend-windows-ia32.exe` (critério 2).
- **T2 reproducao como o usuario (sem UI, na lane de teste):** bug de build, sem caminho no app; o "usuário" é quem roda o build do portátil ia32. Não usa o app, a porta nem o pendrive, então não precisa do slot E2E. É a reprodução do script sob correção (não o compile-check do helper), roda dentro da lane e mexe só no `dist/` dela. Com o fix:
  - a) Mover `dist/godsend.exe` e `dist/godsend-windows-x64.exe` para a pasta de evidência; `node scripts/build-server.js --ia32` -> **exit 0**, log com `[verify] ✓ godsend-windows-ia32.exe ... PE32 (ia32/386)` e **sem** `godsend.exe missing`; os x64 continuam ausentes. Devolver os dois `.exe`.
  - b) `node scripts/build-server.js --x64` -> exit 0; verifica `godsend.exe` e `godsend-windows-x64.exe` e **não** lista o ia32.
  - c) `node scripts/build-server.js --all` -> exit 0; log com `[build-server] windows/amd64 ...` e `[build-server] windows/386 ...`; verifica os três; `LastWriteTime` dos três `.exe` posterior ao início do passo.
  - Sinal objetivo: exit code de cada comando + as linhas `[verify]`/`[build-server]` (salvar em `evidencia/<...>/t2-*.log`).
- **Controle positivo:** copiar o script da base para dentro da lane (o script resolve `root` por `__dirname`, então a cópia precisa estar em `scripts/`): `git show origin/main:scripts/build-server.js > scripts/build-server.base.js`; sem os dois x64, `node scripts/build-server.base.js --ia32` -> **exit 1** com `[verify] ✗ godsend.exe missing`; `node scripts/build-server.base.js --all` -> nenhuma linha `[build-server] windows/...` (não compilou). Apagar a cópia e devolver os `.exe` depois (nada disso vai a commit).
- **T3 regressao direcionada:** `npm run build:server` sem argumento (o do `build-and-upload.ps1` e do helper) continua compilando e verificando os três — coberto pelo Offline. `go test -count=1 ./...` em `src/server` e `npm --prefix src/electron-app run test:safety` não exercitam este script; rodar só como linha de base da tabela do manual (sem `fail` novo).
- **Falta para close:** nada de console ou disco; o dono confirma no próximo `build-portable-local.ps1 -Arch ia32`.

### Sessoes seguintes

- dev: effort low, ultrathink nao — duas linhas num script de 92 linhas, com a lista exata acima.
- teste: effort medium, ultrathink nao — receita mecânica, mas exige mover/devolver os `.exe` e manter a cópia da base fora do commit.

## Correcao (pipeline 20261012-1854, rodada 1)

- `scripts/build-server.js` (calculo de `buildX64`/`buildIa32`): `argv.includes("--all")` nas duas condicoes — `--all` volta a compilar x64 e ia32.
- `scripts/build-server.js` (chamada final ao verify): `"windows-all"` -> `verifyTargets` = `windows` + `windows-x64` se `buildX64`; `windows-ia32` se `buildIa32` e `dist/godsend-windows-ia32.exe` existir (ia32 continua opcional: sem Go e sem prebuilt e so aviso). Comentario cita o slug.
- `CHANGELOG.md` `[Unreleased]` `### Fixed`: entrada citando este doc e o lateral (`...win-all-nao-compila...`).
- Plano de teste sem ajuste.
- **Pendente:** compile-check. `pipeline.py build --bug <slug>` recusou: "nao tem worktree (estado planejado)" — o ledger (`C:\projects\.bugfix-xbox360\state.json`) mostra `ondas: 0`, sem `elencar`, embora a sessao tenha sido aberta como onda 1 em `lanes/wt-2`. Nao contornado; `enqueue-test` nao rodado. Ao corrigir o ledger: `build` e depois `enqueue-test`.
