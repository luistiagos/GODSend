# Manual do projeto — Downloader-XBOX360 (Xbox 360 Companion)

O que as `etapas/*.md` e o `SKILL.md` deixam para o projeto. Cada secao diz qual etapa a cita.
Nunca sobrescrito pela sincronizacao das copias (DESIGN secao 22). A config que o MOTOR le
(build, base, entradas ignoradas, gerados, e2e) esta no `projeto.json` ao lado; aqui fica o que a SESSAO
precisa saber. Fatos medidos que sustentam este manual: DESIGN 22.11.C.

## Caminhos

- Arvore principal (repo): `C:\projects\Downloader-XBOX360-XEX-HDD-Games` (a raiz do projeto e o proprio repo).
- Pasta do pipeline: `C:\projects\.bugfix-xbox360` (`state.json`, `lanes\`, `reports\`, `runs\`), fora do repo.
  **Nome curto de proposito:** o repo rastreia caminhos de ate 203 caracteres (`src/android-app/app/build/...`);
  com prefixo de lane maior que ~55 caracteres o `git worktree add` falha com `Filename too long`.
- Fluxo principal: `origin/main`.
- Helper: `python "C:\projects\Downloader-XBOX360-XEX-HDD-Games\.claude\skills\pipeline-correcao-bugs\scripts\pipeline.py"`.
- Onde a skill mora: versionada em `.claude/skills/pipeline-correcao-bugs/` (aqui `.claude/` e versionado, sem
  junction). E COPIA da fonte no retrobatnew: so `projeto.json` e este arquivo se editam aqui (`SKILL.md`,
  "Fonte e copias").
- Caminhos de arquivo no plano e nos `claim`: relativos a raiz do repo (`src/server/...`, `src/electron-app/...`).

## Leituras obrigatorias (planning Passo 1, dev Passo 1)

- `docs/bugs/open/README.md` (ciclo de pastas, criterio de complexidade) e `docs/bugs/retest/README.md` (a secao
  `## Status`).
- `AGENTS.md` (raiz): arquitetura e as INVARIANTES de cada modulo (formatacao MBR/FAT32, nome de pasta XEX,
  multidisco, `LogStatus`, launcher do portatil...). Leia o trecho do modulo que o fix toca; muitas regras dizem
  "nao volte a fazer X" com o motivo.
- `docs/agents/skills/bug-triage.md`: template do doc de bug (secao 3), severidade P0-P3, nome do arquivo.
- `docs/agents/skills/doc-sync.md`: o que atualizar junto quando o fix muda rota HTTP, canal IPC, servico, pasta
  de runtime, env var ou funcao visivel ao usuario.
- `CHANGELOG.md`, entradas recentes do modulo: o historico de por que o codigo e como e (o `AGENTS.md` cita a
  versao, ex.: "ver a entrada 2.12.102").

## O app e o runtime (todas as etapas)

- O app e o **Xbox 360 Companion**: backend Go (`src/server`, DDD com `*app.App`) + app Electron
  (`src/electron-app`: `main.ts`, `app/`, `ipc/`, `services/`, `infrastructure/`, UI React/Vite em `renderer/`).
  Tambem existem `src/android-app` (Kotlin, backend como JNI) e `aurora-scripts/` (Lua no console); o pipeline
  nao builda nem testa esses dois (bug neles: `bloqueado`, salvo se o fix for so no backend Go).
- O cliente usa o portatil `xboxcompanion.exe` (ou o instalador NSIS): baixa jogos (Internet Archive, Minerva/
  torrent), grava em pendrive/HD (FAT32) ou manda ao console por FTP, e prepara o pendrive BadAvatar para
  console travado/LT.
- O Electron conversa com o backend por HTTP local (rotas em `src/server/interfaces/http/router.go`; porta
  `serverPort` da config, padrao 8080).
- **Modo dev** (`npm start` de uma arvore = `renderer:build` + `tsc` + `electron .`): o backend e
  `<arvore>/dist/godsend-windows-x64.exe` (`infrastructure/fileSystem.ts::getGodsendExePath`) e a raiz de runtime e
  a PROPRIA arvore (`getBundledRoot`): `.godsend.lock`, `pending_queue/`, `pending_ftp/`, `cache/`, `Temp/`, `Ready/`
  ficam na lane. `.godsend.lock` e `pending_queue/` sao rastreados por engano: estao em `gerados`, o helper os
  descarta e eles nunca vao para commit.
- **Nao ha deploy**: nada e instalado num lugar comum. O teste roda o app a partir da lane (secao Teste).
- Build (compile-check, o helper roda): `npm run build:server` (gera `dist/godsend*.exe`) + `tsc` +
  `renderer:typecheck` do Electron. A sessao nunca roda `npm run build:server`, `go build` nem `tsc` direto. Sem
  flags de build. Um build por vez (lock `xbox-build`); leva menos de 1 min.
- Entradas ignoradas copiadas da arvore principal para cada lane na criacao: `src/electron-app/node_modules`
  (1 GB), `dist/tools` (aria2c, fat32format; sem elas o build baixa da rede) e
  `src/electron-app/assets/badavatar-1.1` (726 MB, o pacote que o preparo do pendrive grava).

## Planning

- **Exemplos de veredito:** `sem-codigo` = guia/KB do suporte, publicacao de versao (`build-and-upload.ps1`),
  link quebrado no catalogo remoto, SmartScreen/assinatura do `.exe`; `bloqueado` = so reproduz no console (Aurora,
  DashLaunch, boot do jogo), no app Android, num Windows sem maquina de teste (Windows 7, 32 bits), em hardware do
  cliente, ou precisa de pendrive/HD real (nao ha disco de teste designado: secao Teste).
- **Exemplo de arquivo na reserva:** `src/server/services/pipeline/local_resilient.go` (no plan.json:
  `"files": ["src/server/services/pipeline/local_resilient.go"]`).
- **Arquivos que a correcao arrasta** (entram na reserva): rota nova -> `src/server/interfaces/http/router.go` +
  `docs/api-reference.md`; canal IPC novo -> `src/electron-app/ipc/<area>Handlers.ts` + `src/electron-app/preload.ts` +
  `src/electron-app/renderer/global.d.ts`; campo novo de config -> `src/electron-app/services/settingsService.ts`;
  texto do estado do pendrive -> `src/electron-app/services/preparedDeviceCopy.ts` (teste
  `tests/unit/preparedDeviceCopy.test.cjs`); mudanca no `launch.ini`/hook do Aurora ->
  `infrastructure/readyToPlayConfiguration.ts` com `READY_TO_PLAY_CONFIGURATION_VERSION` subindo. **`CHANGELOG.md`
  NAO entra na reserva:** todo fix o toca e o `.gitattributes` (`merge=union`) junta as entradas no rebase.
- **Effort:** `high` para formatacao/preparo de disco (`infrastructure/fat32Format.ts`, `windowsUsbDeviceService.ts`,
  `fixedBadAvatarPreparationService.ts`: perda de dados se errar), pipeline de download/extracao/gravacao
  (`src/server/services/pipeline/`), fila duravel e FTP, multidisco e o launcher do portatil (`build/portable.nsi`).
- **T2 (reproducao como o usuario) no Plano de teste:** o caminho que o CLIENTE fez, no app rodando da lane:
  estado de partida (config, fila, pasta de destino), cada acao na UI (Home, Catalogo/Browse, Fila, Biblioteca,
  BadAvatar USB, Configuracoes; botao, caixa marcada) e o SINAL objetivo (texto na tela, resposta da rota HTTP,
  linha no console do backend na Home, arquivo na pasta de destino). Gravacao num destino LOCAL (uma pasta da
  maquina) substitui o pendrive quando o bug nao depende de FAT32/USB. Chamar a rota HTTP direto e complemento,
  nunca substituto. O que so o console ou um disco real prova vai para "falta para close". Bug sem caminho de
  usuario (build, empacotamento) dispensa a UI, com o motivo escrito.

## Bug de outro projeto (planning Passo 6, teste Passo 6)

`outro-projeto` aqui = o conserto e do `digitalstoregamesproject` (agente de WhatsApp, guias, KB do suporte) ou
de outro produto. Rota e formato estao no Passo 4 de
`C:\projects\Downloader-XBOX360-XEX-HDD-Games\.claude\skills\triagem-chamados\SKILL.md` (produto -> repo do
produto; agente/plataforma ->
`C:\projects\digitalstoregamesproject\docs\modules\<modulo>\[areas\<area>\]bugs\AAAA-MM-DD-slug.md`). Siga o
fluxo de bug daquele projeto (1a passada: sintoma e evidencia). Escreva o arquivo, **nao commite** (o checkout e
compartilhado e commit local la vai ao ar no deploy de outra sessao; o helper commita com pathspec, sem push).
Exemplo de `external_docs` no plan.json:
`"C:\\projects\\digitalstoregamesproject\\docs\\modules\\...\\bugs\\<arquivo>.md"`.

## Dev

- Arrastes: os da secao Planning.
- **Gerados que nunca se commitam:** `.godsend.lock`, `pending_queue/`, `pending_ftp/` e
  `src/android-app/(.gradle|app/build|build)/` (estado de runtime/IDE rastreado por engano; o helper descarta e
  recusa commit com eles, saida 5). `dist/`, `renderer-dist/` e os `.js` que o `tsc` escreve ao lado dos `.ts` sao
  gitignored; nunca os force (`git add -f`).
- **Testes de unidade** fazem parte do fix: Go `_test.go` ao lado do pacote; Electron em
  `src/electron-app/tests/unit/*.test.cjs` (`node --test`).
- **CHANGELOG, sim; versao, nao** (decisao do dono, 2026-10-09, contra a regra geral do `CLAUDE.md` do repo, que
  vale para quem trabalha fora do pipeline): o fix acrescenta a entrada em `## [Unreleased]` do `CHANGELOG.md`
  (`### Fixed`, com o porque, o `arquivo::simbolo` e o link do doc do bug) e **nao** sobe a versao nos 4 arquivos
  (`package.json`, `src/electron-app/package.json`, `src/server/main.go`, `aurora-scripts/main.lua`): lanes
  paralelas conflitariam ali. A versao sobe no `chore(release)` do dono.
- **doc-sync** (`docs/agents/skills/doc-sync.md`): rota, IPC, servico, pasta de runtime ou env var nova atualiza
  `AGENTS.md`/`README`/`docs/features.md`/`docs/api-reference.md` no MESMO commit do codigo.
- **Commit do fix:** `fix(<area>): <resumo> (bug: <slug>)`, com as areas que o repo ja usa (`pipeline`, `usb`,
  `multidisco`, `badavatar`, `usb`, `fat32`, `fila`, `update`, `portable`...); comentario no codigo cita `[[<slug>]]`.
- **Commit de docs** (teste, finalizacao): `docs(bugs): ...` (o mesmo `commit_docs` do `projeto.json`).

## Teste (E2E)

**Onde o teste roda: na propria lane, com o app em modo dev.** Nao ha `deploy` (o helper recusa com saida 2):
dentro do slot, rode `npm start` na lane (builda renderer + `tsc` e abre o Electron com o backend da lane) e
repita o caminho do cliente pela UI. Para dirigir a UI sem SendInput: Playwright `_electron.launch` sobre o
`main.js` da lane (`src/electron-app/playwright.config.ts`; regras de seletor em
`docs/agents/skills/playwright-testing.md`); spec descartavel fica na evidencia, nao no commit, salvo se virar
teste de regressao do fix.

```
wt-1 (fonte do bug A) --npm start (no slot)--> Electron + dist\godsend-windows-x64.exe DA LANE <-- teste de A
wt-2 (fonte do bug B) --(espera o slot)--> ...
```

- **Por que o slot e exclusivo:** o `userData` em modo dev e um so para todas as lanes
  (`%APPDATA%\xbox-360-companion-electron`, com `config.json`) e o Electron tem trava de instancia unica; a porta
  do backend (`serverPort`) tambem e uma so. Antes de mexer na config, copie o `config.json` para a evidencia e
  devolva-o no fim (o dono tambem usa essa pasta). O app instalado do dono usa outra pasta
  (`%APPDATA%\Xbox 360 Companion`), mas o backend dele disputa a porta.
- **`env-wait`** procura `godsend-windows-x64`, `godsend-windows-ia32`, `godsend` (backend dev) e `godsend-backend`
  (instalado). Feche SO o processo que voce abriu (pelo PID).
- **Disco real: NENHUM esta liberado** (decisao do dono, 2026-10-09). Preparar, formatar ou gravar pendrive/HD
  esta proibido; nunca escolha um disco na tela BadAvatar USB nem como destino. O que depende de disco real
  (FAT32, layout MBR, preparo BadAvatar) e ambiente: vai para "falta para close" no `## Status`, nao e reprovacao.
  O teste unitario que o repo ja tem para isso (`GODSEND_FAT32_TEST_DIR` num volume FAT32, harness com mock de
  disco) e o maximo sem disco.
- **Console Xbox (FTP/Aurora):** nao ha console de teste; o que so o console prova fica para o cliente.
- **Prova:** ponta a ponta pela UI do app da lane; estado final conferido na pasta de destino local e/ou na rota
  HTTP.
- **Binario em execucao:** o console do backend na Home mostra o banner `Xbox 360 Companion Backend Server` e o
  processo `godsend-windows-x64` tem `Path` dentro da SUA lane (`Get-Process godsend-windows-x64 | Select Id,Path`).
- **Evidencia:** `C:\projects\.bugfix-xbox360\evidencia\<AAAAMMDD-HHMM>-<slug>\` (prints so da janela do app, por
  PrintWindow do hwnd ou `page.screenshot` do Playwright; nunca captura da tela inteira). Logs do app dev:
  `%APPDATA%\xbox-360-companion-electron\logs\`.

| Nivel | O que | Criterio |
|---|---|---|
| T2 | **o cliente de novo**: o mesmo caminho do controle positivo, no app da lane, pela UI, agora com o fix | sinal do sintoma AUSENTE e comportamento correto PRESENTE |
| T3 | regressao: `go test -count=1 ./...` em `src/server` e `npm --prefix src/electron-app run test:safety` na lane | sem `fail` novo. Linha de base medida em 2026-10-09 na lane: Go rc 0 (9 pacotes `ok`), `test:safety` 258 pass / 0 fail |
| T4 | logs do app dev e o console do backend/Electron na janela do teste | sem erro novo atribuivel ao fix |

## Finalizacao

- `final-sync-main`: o codigo que outras sessoes deixaram sem commit so e publicado se o build do
  `projeto.json` sair 0 numa lane. Os `gerados` (estado de runtime) ficam de fora.
- `final-deploy`: sem deploy neste projeto, sai 0 sem fazer nada. Subir a versao e publicar
  (`build-and-upload.ps1`) e do dono: no briefing, vai em "falta para close" com as entradas do `[Unreleased]`.
- Ciclo de pastas: `open/` -> `retest/` (o pipeline) -> `closed/` (o dono, com a versao publicada e a prova do
  cliente). Aqui `closed/` faz o papel do `done/` que as etapas citam.
- Briefing em `C:\projects\.bugfix-xbox360\runs\<execucao>-briefing.md`; o link de cada doc e relativo a essa
  pasta: `../../Downloader-XBOX360-XEX-HDD-Games/docs/bugs/retest/<doc>.md`.

## Maestro (SKILL.md)

- Trust: o dono roda o `claude.exe` num terminal em `C:\projects\Downloader-XBOX360-XEX-HDD-Games`, aceita e sai.
- O E2E abre janela do app: ao iniciar, avise o dono que a maquina deve ficar ociosa nas janelas de teste e que,
  enquanto o app dele (instalado ou dev) estiver aberto, os testes ESPERAM o slot (o `env-wait` nao mata processo
  alheio): fechar o app libera a fila.
- Commits locais na arvore principal: publicar antes com
  `git -C C:\projects\Downloader-XBOX360-XEX-HDD-Games push origin main`, que nao mexe na arvore de trabalho.
- Rodizio de contas: desligado (`"rodizio_contas": false`, DESIGN 22.3): no limite de uso, a execucao espera o
  reset.
