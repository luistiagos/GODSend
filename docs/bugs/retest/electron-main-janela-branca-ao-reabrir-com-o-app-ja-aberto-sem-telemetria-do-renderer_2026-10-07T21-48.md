# Bug: "o Xbox Companion não quer abrir, a tela fica branca" com o app já aberto e baixando, e o log não tem nada do renderer para diagnosticar

## Status

- **Correção:** 2026-10-10/11 (pipeline 20261010-2242). Testada em 2026-10-12 01:06–01:12 UTC (rodada 1, aprovada).
- **Commits:** `5b1816f` fix(electron) e `a3de5ea` docs. Base: `origin/main` @ `7bce045`.
- **Onde:** `src/electron-app/app/window.ts::watchRendererHealth` (chamada em `createMainWindow`) e
  `src/electron-app/app/bootstrap.ts::bootstrapApp` (`second-instance` com o estado da janela;
  `app.on("child-process-gone")` para a GPU). Teste novo: `tests/unit/rendererHealth.test.cjs`.
- **Evidência:** `C:\projects\.bugfix-xbox360\evidencia\20261011-1403-electron-main-janela-branca-ao-reabrir-com-o-app-ja-aberto-sem-telemetria-do-renderer_2026-10-07T21-48\`
  (`LEIAME.md` explica cada pasta; a rodada válida é `r1-tentativa3/`).
  - **Offline:** build do helper rc 0; `node --test rendererHealth + singleInstance`: 12 pass / 0 fail.
  - **T2 (caminho do cliente, app da lane, backend `godsend-windows-x64` com Path na `wt-4`):** Home aberta,
    minimizar (vai para a bandeja: `visible=false`), `forcefullyCrashRenderer()`, depois "clicar de novo no exe"
    (`electron .` na lane: a segunda instância sai em ~200 ms). Log: `APP_RENDERER render-process-gone
    reason=crashed exitCode=2`, `APP_RENDERER reloading after render-process-gone` e `APP_LIFECYCLE second-instance
    ... minimized=true visible=false crashed=false loading=false`. A janela volta visível com o renderer vivo
    (`isCrashed()=false`, `#root` com texto, `window.godsendApi` presente), Home renderizada (`02-...png`). O stub
    local recebeu 1 POST `renderer gone: reason=crashed exitCode=2` (`xbox-360-companion/electron-main`,
    `window.ts`). O backend continua no mesmo PID (54716): não reiniciou.
  - **Trava contra laço:** segundo crash 12 s depois: `not reloading: crash loop`; a segunda instância seguinte
    loga `crashed=true`. Crash 71 s depois da 1a recarga: recarrega de novo.
  - **Complementos:** `console.error` gera `APP_RENDERER console error :1 teste-pipeline-renderer`. GPU morta gera
    `APP_RENDERER gpu-process-gone reason=killed exitCode=1` e 1 POST `gpu process gone: reason=killed`. **Com a
    GPU morta, a janela ficou BRANCA por alguns segundos (`05-apos-gpu.png`)**, o que reforça a hipótese 3; agora
    esse caso deixa rastro.
  - **Controle positivo:** o projeto não tem `deploy --at-base`. Fiz o controle alternativo do plano, em duas partes.
    (1) No crash dentro da trava (comportamento igual ao da base: sem recarga), a janela reaberta fica com o
    renderer MORTO (`crashed=true`, nenhum JS executa). Ressalva: o PrintWindow mostra o último quadro e não
    branco (`03-...png` é igual ao `02`), então o sinal objetivo é `isCrashed()` e não o screenshot.
    (2) Grep dos eventos em `git show origin/main:` de `window.ts` e `bootstrap.ts`: nada (a base não registra
    nenhum deles).
  - **T3:** `go test -count=1 ./...` rc 0 (9 pacotes `ok`); `test:safety` 319 pass / 0 fail. Minimizar esconde;
    fechar no X esconde (não sai); Quit loga `before-quit` sem `render-process-gone` e sem POST.
  - **T4:** nenhum erro novo do processo principal nos logs da janela de teste. Linhas `APP_RENDERER console error`
    que agora aparecem, preexistentes e só antes invisíveis (não são regressão): (a) a CSP bloqueia o Google
    Fonts em toda abertura; (b) logo após cada recarga pós-crash (inclusive uma recarga manual, sem o handler),
    `sandboxed_renderer.bundle.js script failed to run ... preloadScripts ... null` vindo do Electron. A UI
    recarregada funciona: `godsendApi` está presente e a verificação do pendrive concluiu (`06-...png`).
- **Não provado no E2E:** `unresponsive`/`responsive`. Um laço de 40 s e outro de 70 s, com `sendInputEvent`,
  não dispararam o hang monitor do Chromium nesta máquina; o handler é coberto só pelo teste de unidade.
  Também ficaram de fora a navegação Catálogo/Fila/Configurações (o app de teste abre no onboarding "Modo de
  Instalação", e escolher um modo mudaria o estado do dono; o fix não toca o renderer) e o `Open`/duplo
  clique da bandeja (Playwright não alcança o tray; código não alterado).
- **Falta para `closed/`:** a versão publicada (subida de versão + `build-and-upload.ps1`, feitos pelo dono); a
  causa real da tela branca, que só vem do próximo caso de cliente com esta versão (T3 do doc); consultar no
  painel o report `electron-renderer` do host `DESKTOP-1HAMO38` em 2026-10-07 21:30–22:01 UTC. Ignorar na
  triagem o report de teste `renderer gone: reason=crashed exitCode=2` do host `DESKTOP-ALLJ8C3` (~2026-10-11
  17:06Z), que o arnês mandou à produção por engano.

- **Detectado em:** 2026-10-07 21:48 (chamado #157 do painel, sessão `255490944716923@lid`, telefone `5511964233557`; telemetria `9541`, host `DESKTOP-1HAMO38`)
- **Origem:** conversa de suporte + log anexo do report `9541` + leitura de `src/electron-app/app/bootstrap.ts::bootstrapApp` (handler `second-instance`) e `infrastructure/electronTray.ts::createTray`
- **Classe:** diagnóstico (falta de telemetria) + falha funcional não reproduzida
- **Severidade:** **P2 - Médio**: o cliente não conseguiu usar o app por ~15 min. Ele fechou pela bandeja, reabriu duas vezes e na segunda funcionou. Sem log do renderer, cada nova ocorrência vai custar o mesmo diagnóstico às cegas
- **Complexidade:** baixa para a telemetria (dois handlers de `webContents`), desconhecida para a causa
- **Versões:** 2.12.107 (portátil, `execPath` em `%TEMP%\nsc78F7.tmp\app\Xbox360Companion.exe`)
- **Reincidência:** primeira vez que o sintoma é "tela branca". Não é o "não abre" de [[release-portable-extrai-1-35-gb-no-temp-em-silencio-e-nao-abre-sem-avisar-o-motivo_2026-10-06T22-40]]: lá não aparece janela nenhuma; aqui a janela aparece e fica branca

## Sintoma, na ordem que o cliente viveu

Horas em UTC.

1. 21:32:33 [134420]: *"Quando eu abri o xboxcom panion ele já me jogo prós jogos"*. A janela funcionava.
2. 21:48:19 [134442]: *"O Xbox companion não quer abrir, a tela fica branca"*.
3. O agente mandou fechar pela bandeja e reabrir ([134443]). O app recebeu `before-quit` em
   22:01:04. A instância de 22:06:53 (pid 1244) fechou 25 s depois (22:07:18), e a de
   22:12:08 (pid 9420) funcionou: o cliente usou o catálogo e baixou GTA SA HD e Farming Simulator.

## Evidência

Log `9541` (`python telemetria.py logs 9541`), canais presentes: `APP_USB` 979 linhas,
`APP_BROWSE` 63, `ELECTRON_UI` 27, `APP_LIFECYCLE` 9, `APP_BACKEND` 6, `APP_BADAVATAR` 1.
**Nenhuma linha do renderer.** Os eventos de ciclo de vida do processo que estava aberto (pid 4108,
iniciado ~20:1x e baixando o PES):

```
21:34:59.900Z pid=4108 APP_LIFECYCLE second-instance event received; restoring and focusing window
21:40:40.914Z pid=4108 APP_LIFECYCLE second-instance event received; restoring and focusing window
21:54:23.180Z pid=4108 APP_LIFECYCLE second-instance event received; restoring and focusing window
22:01:04.429Z pid=4108 APP_LIFECYCLE application before-quit
```

- O cliente clicou de novo no `xboxcompanion.exe` com o app já aberto. Cada clique passa pelo stub
  portátil e cai no `second-instance` da instância viva, que só chama `focusMainWindow()`
  (`bootstrap.ts:147-150`). A janela que ficou branca é a da instância **pid 4108**.
- O processo principal estava vivo e respondendo: `APP_BROWSE varredura de jogos instalados` em
  21:44:48 (1,8 s) e o backend baixando a 2,8 MB/s até 21:55. **Não há como saber pelo log se o
  renderer travou, caiu ou só não pintou.**
- `grep -rn "render-process-gone\|'unresponsive'\|did-fail-load" src/electron-app --include=*.ts`
  (fora de `node_modules`) não acha nada. **O app não registra queda nem travamento do renderer.**

## Hipóteses — nenhuma verificada

1. **Renderer caiu (`render-process-gone`)** e a janela restaurada ficou sem conteúdo. Sem o
   handler, isso não deixa rastro.
2. **Renderer travado (`unresponsive`)** por alguma rotina pesada na UI, numa máquina lenta.
   Varreduras do processo principal levaram 25-35 s entre 21:58 e 22:00, com o pendrive fora.
3. **Janela restaurada de minimizada sem repintar** (problema de GPU/compositor no
   `restore()`/`focus()`). Precisaria abrir `focusMainWindow` e testar na máquina.

O que falta medir: qualquer uma das três aparece no log assim que existirem os handlers da T1.

## Escopo — o que NÃO é este bug

- O PES recomeçar do zero depois do fechamento: [[pipeline-download-chunked-concluido-perdido-ao-fechar-durante-o-hash-final-recomeca-do-zero_2026-10-07T21-48]].
- O stub portátil que não mostra nada enquanto extrai: [[release-portable-extrai-1-35-gb-no-temp-em-silencio-e-nao-abre-sem-avisar-o-motivo_2026-10-06T22-40]].
- O conselho do agente estava certo: a bandeja existe e o item é `Quit` (`electronTray.ts:40`).

## Tarefas propostas

| # | task | arquivo/símbolo | prova |
|---|---|---|---|
| T1 | registrar `render-process-gone` (motivo + exitCode), `unresponsive`/`responsive` e `did-fail-load` da janela principal no log de app, e mandar `render-process-gone` para a telemetria | `bootstrap.ts` / criação da `BrowserWindow` | forçar `webContents.forcefullyCrashRenderer()` em build de teste e ver a linha no log e o report |
| T2 | no `render-process-gone`, recarregar a janela (ou mostrar aviso) em vez de deixar branca | idem | mesma prova da T1, com a janela voltando |
| T3 | com a telemetria no ar, reabrir este doc com a causa do próximo caso | — | — |

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** corrigir — a causa da tela branca não é provável sem dado, mas a falta de telemetria (o que impede
diagnosticá-la) e a recuperação do caso "renderer caiu" são código deste repo, testáveis na lane injetando a falha.
**Complexidade:** media — lógica nova no processo principal do Electron (handlers de `webContents`/`app` +
recarga com trava contra laço), sem IPC, rota nem UI nova.
**Severidade:** medio — falha com contorno (sair pela bandeja e reabrir), num subconjunto (uma ocorrência
registrada); sem log, toda nova ocorrência é diagnóstico às cegas.
**Arquivos a alterar (reserva da onda):**
- `src/electron-app/app/window.ts` — nova `watchRendererHealth(win, deps)` chamada em `createMainWindow`: loga
  `render-process-gone`/`unresponsive`/`responsive`/`did-fail-load`/`console-message` de nível `error`, reporta à
  telemetria e recarrega no `render-process-gone`
- `src/electron-app/app/bootstrap.ts` — `app.on("child-process-gone")` (processo GPU) no `bootstrapApp`; o log do
  `second-instance` passa a levar o estado da janela
- `src/electron-app/tests/unit/rendererHealth.test.cjs` — novo, teste de unidade com `webContents` falso

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

A causa da tela branca segue **não provada**: nada no log a distingue. O que está provado é por que o log não
tem nada:

- `src/electron-app/app/window.ts::createMainWindow` — cria a `BrowserWindow` (sandbox, contextIsolation), e só
  registra em `webContents` os eventos `will-navigate` (política de navegação) e `did-finish-load` (limpa cache).
  Em `minimize` chama `hide()` (vai para a bandeja); em `close` sem `isQuitting` também `hide()`. **Nenhum
  handler de `render-process-gone`, `unresponsive`, `did-fail-load` nem `console-message`**: queda, travamento ou
  erro do renderer não deixam linha no log.
- `src/electron-app/app/window.ts::focusMainWindow` — `restore()` se minimizada, `show()` se invisível, `focus()`.
  Não olha se o renderer está vivo (`webContents.isCrashed()`), então reabrir a janela de um renderer morto mostra
  a área branca sem recarregar nem avisar.
- `src/electron-app/app/bootstrap.ts::bootstrapApp` — `second-instance` grava só
  `second-instance event received; restoring and focusing window` e chama `focusMainWindow()`. Não registra o
  estado da janela (minimizada, visível, renderer caído, carregando). `webContents.once("did-finish-load")` sobe o
  backend uma vez só (`once`): recarregar a página NÃO reinicia o backend (relevante para a T2).
  `installCrashLogging` cobre só `uncaughtException`/`unhandledRejection` do processo principal. Não existe
  `app.on("child-process-gone")`: queda do processo GPU (hipótese 3) também não deixa rastro.
- `src/electron-app/renderer/main.tsx` — `window` `error` e `unhandledrejection` chamam
  `godsendApi.reportError` → IPC `telemetry:report` (`bootstrap.ts::registerIpcHandlers`) → `reportError` com
  componente `electron-renderer`. **Vai para a telemetria como report separado, mas NUNCA para o arquivo de log**
  (`reportError` só lê a cauda do log, não escreve nele). Por isso o log anexo ao report `9541` não tem
  "nenhuma linha do renderer" mesmo que o renderer tenha reportado erro. Não há ErrorBoundary no React
  (`grep -rn "ErrorBoundary\|getDerivedStateFromError" renderer` vazio).
- `src/electron-app/infrastructure/telemetry.ts::reportError` — nunca lança (try/catch geral); desliga com
  `errorReporting:false` (padrão `true`, `settingsService.ts::getConfiguredErrorReporting`); dedup por
  `component|message` no processo (mesma mensagem só sai uma vez por sessão); anexa a cauda de 256 KB do log do
  dia. Endpoint trocável por `errorReportingEndpoint` na config (usado no Plano de teste).
- `src/electron-app/infrastructure/serverLog.ts::appendAppEvent` — grava `APP_<CATEGORIA>`; `appendLine` é
  síncrono e em erro só faz `console.error` (não lança).
- `src/electron-app/infrastructure/electronTray.ts::createTray` — `Open`/duplo clique fazem `show()`+`focus()`
  direto na referência da janela, sem passar por `focusMainWindow` (mesma cegueira; não muda neste fix).
- Biblioteca (Electron 42.4.1, `node_modules/electron/electron.d.ts`): `WebContents` emite
  `render-process-gone (event, details{reason, exitCode})`, `unresponsive`/`responsive` (sem argumentos),
  `did-fail-load (event, errorCode, errorDescription, validatedURL, isMainFrame, ...)` e
  `console-message (details: Event<{message, level:'info'|'warning'|'error'|'debug', lineNumber, sourceId}>)`
  (assinatura nova, objeto único). `App` emite `child-process-gone (event, details{type:'GPU'|..., reason,
  exitCode})`, que **não inclui renderer**. Existem `webContents.isCrashed()`, `isLoading()`, `reload()`,
  `forcefullyCrashRenderer()`.
- Biblioteca (react-dom 19.2.5, `cjs/react-dom-client.production.js:5888`): `defaultOnUncaughtError` →
  `reportGlobalError` = `window.reportError` → evento `error` na `window` (e erro no console). Ou seja, um erro de
  render sem ErrorBoundary **desmonta a árvore inteira (tela branca com renderer vivo)** e cai no listener do
  `main.tsx` → report `electron-renderer`, e também num `console-message` de nível `error`.

### Provas (comando literal -> resultado)

- `grep -rn "render-process-gone\|unresponsive\|did-fail-load\|child-process-gone\|console-message\|forcefullyCrashRenderer\|webContents.on\|webContents.once" --include=*.ts --include=*.tsx .`
  em `src/electron-app` (sem `node_modules`) → 3 linhas: `bootstrap.ts:199` (`once did-finish-load`),
  `window.ts:88` (`will-navigate`), `window.ts:112` (`did-finish-load`). Nenhum evento de saúde do renderer.
- `grep -rn "ErrorBoundary\|getDerivedStateFromError" renderer` → vazio.
- `grep -n '"version"' node_modules/electron/package.json` → `42.4.1`; `node_modules/react-dom/package.json` →
  `19.2.5`.
- `grep -n "function defaultOnUncaughtError" -A3 node_modules/react-dom/cjs/react-dom-client.production.js` →
  `reportGlobalError(error)`; `reportGlobalError` = `reportError` global quando existe.
- Telemetria: não foi possível conferir se houve report `xbox-360-companion/electron-renderer` do host
  `DESKTOP-1HAMO38` entre 21:30 e 22:01 UTC de 2026-10-07 (`JWT_SECRET_KEY`/`TRIAGEM_TOKEN` ausentes na sessão do
  pipeline). **Essa consulta é a primeira coisa a fazer quando houver credencial**: um report desses ali prova a
  hipótese 4 sem esperar novo caso.

### Hipoteses descartadas (e por que)

Nenhuma das três do doc foi descartada; nenhuma é provável sem dado. Acrescentada a hipótese **4**: erro de
render no React sem ErrorBoundary desmonta a árvore (janela branca, renderer vivo e responsivo, main e backend
normais — combina com o log). Descartado nesta análise:

- "O `second-instance` recria ou recarrega a janela e é isso que deixa branco" — não: `focusMainWindow` só faz
  `restore`/`show`/`focus`, e a janela ficou branca entre 21:40 e 21:54 com dois `second-instance` no meio.
- "O backend caiu e a UI ficou vazia" — não: o backend baixava a 2,8 MB/s até 21:55 e `APP_BROWSE` respondia em
  21:44; uma UI sem backend mostra a tela com erro de conexão, não branca.
- Corrigir a hipótese 3 (repintura ao restaurar) ou pôr ErrorBoundary (hipótese 4) agora — não: seria correção
  especulativa sem saber a causa (YAGNI). A T1 captura as duas; a T2 só recupera o caso que o próprio evento
  prova (renderer caído).

### Tarefas

- [ ] T1 `src/electron-app/app/window.ts::watchRendererHealth` (nova, exportada; chamada em `createMainWindow`
  logo após o `new BrowserWindow`; dependências injetáveis `{ log, report, now }`, padrão `appendAppEvent`,
  `reportError`, `Date.now`) — categoria de log `RENDERER`:
  - `render-process-gone`: log `render-process-gone reason=<reason> exitCode=<n>`; telemetria
    `report("electron-main", "window.ts", "render-process-gone", "renderer gone: reason=<reason> exitCode=<n>")`
    (não-terminal), exceto `reason === "clean-exit"` ou `getIsQuitting()`;
  - `unresponsive`: log + telemetria `"renderer unresponsive"` (mensagem fixa: o dedup segura a 1 por sessão);
    `responsive`: log com a duração desde o `unresponsive`;
  - `did-fail-load` com `isMainFrame` e `errorCode !== -3` (ERR_ABORTED): log
    `did-fail-load code=<n> desc=<s> url=<url>`;
  - `console-message` só `level === "error"`: log `console error <sourceId>:<line> <message>` truncado (ex.: 500
    chars), com teto de linhas por sessão (ex.: 50) para não inundar o log. Isso põe no log o erro que hoje só
    vai à telemetria (hipótese 4).
  - Comentário cita `[[electron-main-janela-branca-ao-reabrir-com-o-app-ja-aberto-sem-telemetria-do-renderer_2026-10-07T21-48]]`.
  - Teste: `tests/unit/rendererHealth.test.cjs` com `EventEmitter` como `webContents`/janela e `log`/`report`
    falsos: cada evento gera a linha esperada; `clean-exit` não reporta; `did-fail-load` de subframe e `-3` não
    logam; `console-message` `warning` não loga e o teto corta na N-ésima linha.
- [ ] T2 mesmo símbolo — no `render-process-gone` (não `clean-exit`, não `getIsQuitting()`, janela não
  destruída) chamar `webContents.reload()` e logar `reloading after render-process-gone`; trava contra laço: no
  máximo 1 recarga a cada 60 s (`now()` injetado), senão loga `not reloading: crash loop` e não recarrega. O
  `once("did-finish-load")` do `bootstrap.ts` não reinicia o backend; o `did-finish-load` do `window.ts` só limpa
  cache; `App.tsx:108` rebusca o buffer do console no mount. Teste: no mesmo arquivo, `reload` falso chamado 1 vez
  no primeiro crash, 0 vez num segundo crash a <60 s, 1 vez de novo a >60 s; 0 vez com `isQuitting`.
- [ ] T1b `src/electron-app/app/bootstrap.ts::bootstrapApp` — `app.on("child-process-gone", (_e, d) => ...)`: só
  `d.type === "GPU"` e `d.reason !== "clean-exit"`: log `RENDERER gpu-process-gone reason=<r> exitCode=<n>` e
  telemetria `"gpu process gone: reason=<r>"`. E o log do `second-instance` passa a levar o estado antes do foco:
  `minimized=<b> visible=<b> crashed=<b> loading=<b>` (via `getMainWindow()`, protegido contra janela
  nula/destruída — `focusMainWindow` já é). Teste: `singleInstance.test.cjs` continua verde; o GPU é provado só
  no E2E (o `app` do Electron não existe no `node --test`).
- [ ] `CHANGELOG.md` `[Unreleased]` `### Fixed` (sem subir versão, regra do manual).

### Plano de teste

- **Offline (sem slot):** `node --test tests/unit/rendererHealth.test.cjs tests/unit/singleInstance.test.cjs`
  (após o `tsc` do helper) → todos `pass`; mais o build do helper.
- **Preparação comum (no slot):** copiar `%APPDATA%\xbox-360-companion-electron\config.json` para a evidência;
  pôr `"errorReportingEndpoint": "http://127.0.0.1:18999/logErr"` e subir um servidor Node de 10 linhas que grava
  cada POST num arquivo da evidência (não poluir a telemetria de produção). Devolver o `config.json` no fim.
- **T2 reproducao como o usuario (E2E, no slot):** o cliente estava com o app aberto, mandou para a bandeja,
  clicou de novo no executável e viu a janela branca. Na lane: `npm start` (ou Playwright `_electron.launch` no
  `main.js` da lane); esperar a Home com o console do backend (banner `Xbox 360 Companion Backend Server`);
  minimizar a janela (vai para a bandeja: `isVisible()===false`). Injetar a falha que o cliente não sabe
  provocar, via `electronApp.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())`.
  Clicar de novo no "executável": rodar `npx electron .` em `src/electron-app` da lane (segunda instância → sai e
  dispara `second-instance` na primeira). **Sinais com o fix:** no log do dia
  (`%APPDATA%\xbox-360-companion-electron\logs\godsend-server-<data>.log`) as linhas
  `APP_RENDERER render-process-gone reason=crashed exitCode=...`, `APP_RENDERER reloading after render-process-gone`
  e `APP_LIFECYCLE second-instance ... crashed=false` (ou `true` se o foco vier antes da recarga); a janela volta
  visível com a Home renderizada (screenshot da janela por `page.screenshot` do novo `firstWindow`/PrintWindow); o
  servidor local recebeu 1 POST com `message` `renderer gone: reason=crashed ...` e `project`
  `xbox-360-companion/electron-main`; o processo `godsend-windows-x64` é o mesmo PID de antes (backend não
  reiniciou). Repetir o crash em <60 s → `not reloading: crash loop`, sem recarga.
  Complementos na mesma sessão: (a) **travamento**: `page.evaluate(() => setTimeout(() => { const t = Date.now(); while (Date.now() - t < 40000) {} }, 0))`
  → log `APP_RENDERER unresponsive` e, ~40 s depois, `responsive after <n> ms`, 1 POST `renderer unresponsive`;
  (b) **GPU**: no main, `app.getAppMetrics().find(m => m.type === "GPU").pid` e `process.kill(pid)` →
  `APP_RENDERER gpu-process-gone reason=killed ...` e 1 POST; (c) **erro do React** (hipótese 4):
  `page.evaluate(() => console.error("teste-pipeline-renderer"))` → `APP_RENDERER console error ... teste-pipeline-renderer`.
- **Controle positivo:** este projeto não tem `deploy --at-base` (o helper recusa, saída 2). Se a sessão de
  teste tiver como rodar a T2 com o código da base (fluxo principal sem o commit do fix), o sinal esperado é: após
  `forcefullyCrashRenderer()` + segunda instância a janela fica **branca** (screenshot) e o log tem só
  `second-instance event received; restoring and focusing window`, nenhuma linha `APP_RENDERER` e nenhum POST no
  servidor local — exatamente o rastro do report `9541`. Sem esse caminho, o controle se faz em duas partes que
  não exigem a base rodando: (1) **a injeção reproduz o sintoma**: no app COM o fix, o segundo
  `forcefullyCrashRenderer()` em menos de 60 s cai na trava (`not reloading: crash loop`) e a janela fica branca
  no `second-instance` seguinte (screenshot), provando que a receita produz a tela branca e que o screenshot a
  detecta; (2) **a base não registra nada**: o grep da seção Provas rodado com `git show origin/main:<arquivo>`
  sobre `app/window.ts` e `app/bootstrap.ts` não acha nenhum dos eventos.
- **T3 regressao direcionada:** `go test -count=1 ./...` em `src/server` (rc 0, 9 pacotes) e
  `npm --prefix src/electron-app run test:safety` (linha de base 258 pass / 0 fail, mais os testes novos).
  Fluxos vizinhos pela UI: minimizar → bandeja → `Open` e duplo clique restauram a janela funcionando; fechar no
  X esconde (não sai); `Quit` da bandeja encerra (log `before-quit`, sem `render-process-gone` reportado — é
  `clean-exit`/`isQuitting`); abrir o app e navegar Catálogo/Fila/Configurações sem nenhuma linha
  `APP_RENDERER console error` nova num uso normal (se aparecer, anotar: é erro real do renderer que hoje passa
  despercebido, não regressão).
- **Falta para close (fora do pipeline):** a causa real só vem do próximo caso de cliente com a versão
  publicada (T3 do doc); consultar no painel o report `electron-renderer` do host `DESKTOP-1HAMO38` em
  2026-10-07 21:30-22:01 UTC.

### Sessoes seguintes

- dev: effort medium, ultrathink nao — handlers localizados num arquivo, contrato de evento já conferido no
  `electron.d.ts`; o único ponto de cuidado (trava da recarga, `clean-exit`/`isQuitting`) está especificado e
  coberto por teste.
- teste: effort medium, ultrathink nao — receita E2E concreta (injeção por Playwright, segunda instância, servidor
  local de telemetria); exige cuidado com a config do dono, não raciocínio sobre classificação.

## Correcao (pipeline 20261010-2242, rodada 1)

Implementado conforme o Planejamento, sem desvio.

- `src/electron-app/app/window.ts::watchRendererHealth` (nova, exportada; deps injetaveis `{ log, report, now,
  isQuitting }`, padrao `appendAppEvent`/`reportError`/`Date.now`/`getIsQuitting`), chamada em
  `createMainWindow` logo apos o `new BrowserWindow`. Categoria `APP_RENDERER`:
  - `render-process-gone` -> `render-process-gone reason=<r> exitCode=<n>` sempre; fora de `clean-exit`/Quit
    reporta `renderer gone: reason=<r> exitCode=<n>` (`electron-main`, `window.ts`); com a janela viva recarrega
    (`reloading after render-process-gone`), no maximo 1 vez a cada 60 s (`not reloading: crash loop`).
    `reload()` que lanca e capturado (`reload failed: ...`) para nao virar `uncaughtException`/dialogo.
  - `unresponsive` -> log + report `renderer unresponsive`; `responsive` -> `responsive after <ms> ms`.
  - `did-fail-load` so do frame principal e sem `-3` (ERR_ABORTED).
  - `console-message` so `level === "error"`, linha truncada em 500 caracteres, teto de 50 linhas por janela.
- `src/electron-app/app/bootstrap.ts::bootstrapApp`: `second-instance` loga `... restoring and focusing window
  minimized=<b> visible=<b> crashed=<b> loading=<b>` (ou `window=none`); `app.on("child-process-gone")` so `GPU`
  e fora de `clean-exit` -> `APP_RENDERER gpu-process-gone reason=<r> exitCode=<n>` + report
  `gpu process gone: reason=<r>` (`bootstrap.ts`, `child-process-gone`).
- `src/electron-app/tests/unit/rendererHealth.test.cjs` (novo, 8 casos: crash/report/reload, clean-exit e Quit,
  janela destruida, trava de 60 s, reload que lanca, unresponsive/responsive, did-fail-load, console-message).
- `CHANGELOG.md` `[Unreleased]` `### Fixed` (sem subir versao).

**Provas offline:** `python pipeline.py build --bug <slug>` -> rc 0 (build:server + tsc + renderer:typecheck);
`node --test tests/unit/rendererHealth.test.cjs tests/unit/singleInstance.test.cjs` -> 12 pass / 0 fail;
`node --test tests/unit/*.test.cjs` -> 314 pass / 0 fail.

**Ajustes ao Plano de teste:** nenhum. A linha do `second-instance` agora termina com o estado da janela; o
sinal esperado no E2E e `second-instance event received; restoring and focusing window minimized=... crashed=...`.

**Rebase (2026-10-11):** o `CHANGELOG.md` ficou reservado por tres bugs da onda em sequencia (park x3). Apos o
`sync` sobre `origin/main` @ `7bce045` e o `claim`: build do helper rc 0; `node --test tests/unit/*.test.cjs` ->
319 pass / 0 fail.
