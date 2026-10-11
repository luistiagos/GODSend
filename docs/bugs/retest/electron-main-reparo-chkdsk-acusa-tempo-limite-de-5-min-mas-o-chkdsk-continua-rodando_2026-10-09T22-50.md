# Bug: reparo CHKDSK acusa "tempo limite de 5 minutos" mas o chkdsk continua rodando até o fim

## Status

- **Corrigido:** 2026-10-10 (fix de produção) e 2026-10-11 (teste de regressão + CHANGELOG); testado na lane `wt-2`
  em 2026-10-11 16:30–16:40 UTC (pipeline 20261010-2242, teste rodada 1).
- **Commits:** `b9be24c` (fix: reparo sem prazo, `code null` = falha, duração no log, aviso no modal) e o commit
  `fix(usb): teste de repairDrive ...` deste branch (teste novo + entrada no `CHANGELOG.md` `[Unreleased]`/`Fixed`).
- **Onde:** `src/electron-app/services/driveRepairService.ts::repairDrive` (sem `setTimeout`; resolve só no
  `close`/`error`), `::summarizeChkdskExit` (`null` → `ok:false`, `exitCode -1`),
  `renderer/components/DriveRepairModal.tsx` (aviso de mais de 15 min); teste `tests/unit/driveRepairService.test.cjs`.
- **Evidência:** `C:\projects\.bugfix-xbox360\evidencia\20261011-chkdsk-e2e\` (`e2e-chkdsk.cjs`, `e2e.log`,
  `result.json`, prints `01-home.png`/`01b-apos-avancar.png`/`02-usb-games.png`).
  - **T2 (sem disco, no app da lane):** Electron lançado por Playwright sobre o `main.js` da lane; backend
    `wt-2\dist\godsend-windows-x64.exe` (log: `Executable: C:\projects\.bugfix-xbox360\lanes\wt-2\dist\...`, banner
    `Xbox 360 Companion Backend Server v2.12.110`). `window.godsendApi.toolsDriveRepair("Q:\\")` (Q: confirmado
    inexistente: drives C, D, E) → `{ok:false, exitCode:3, output:"Não é possível abrir o volume para acesso direto."}`
    em 97 ms, 1 linha de progresso; log `APP_USB Reparo CHKDSK em Q: finalizado em 0m 0s (código 3, reparado: false)`
    — duração e código real, sem `-1` nem `0` inventado. A página Jogos Instalados não foi aberta: no modo simples
    o assistente "Modo de Instalação" não tem o botão sem pendrive preparado, e o passo "Pendrive" é a tela de
    preparo, que o manual proíbe.
  - **Controle positivo:** o sintoma de UI pede chkdsk de mais de 5 min em disco real (nenhum liberado) e a base já
    tem o `b9be24c`; o controle feito é o do teste: `setTimeout(() => { child.kill(); resolve({... "excedeu o tempo
    limite de 5 minutos." }) }, 300000)` reposto no `services/driveRepairService.js` compilado → 3 pass / **1 fail**
    (`repairDrive resolveu antes do close (prazo de volta?)`); restaurado (byte a byte) → 4 pass.
  - **T3:** após o `sync` sobre `a29deeb`: `go test -count=1 ./...` em `src/server` rc 0, 9 pacotes `ok`;
    `npm --prefix src/electron-app run test:safety` rc 0, 307 pass / 0 fail. Os logs do dono em
    `%APPDATA%\xbox-360-companion-electron\logs\` mantiveram os mesmos tamanhos.
  - **T4:** log da janela (`%APPDATA%\Electron\logs\godsend-server-2026-10-11.log`, pid 46260; lançado por
    `main.js`, o userData é `Electron`): só um erro, `QUEUE RESUME: "FIFA STREET 26 ..." restaurado como Erro`,
    que vem da fila de runtime da lane e não tem relação com o fix. Nenhum processo sobrou; o `config.json` do dono
    ficou intocado.
- **Falta para `closed/`:** versão publicada (subir versão + `build-and-upload.ps1`, do dono); reparo real do
  pendrive `E:` (65.912 arquivos) pelo app publicado: o diálogo termina sem "excedeu o tempo limite", com o
  relatório do chkdsk, e o log traz `finalizado em ~16m (código 0, reparado: true)` (depende de disco real, que
  não está liberado no teste).

- **Detectado em:** 2026-10-09 22:50 (relato do dono, print do app no Windows pt-BR)
- **Origem:** `src/electron-app/services/driveRepairService.ts::repairDrive` → `src/electron-app/ipc/driveMaintenanceHandlers.ts` (`tools:drive-repair`) → `renderer/components/DriveRepairModal.tsx`
- **Errors (serviço):** N/A (local)
- **Classe:** correção / ux
- **Reincidência:** primeira vez. Os `�` do mesmo print são outro bug, já corrigido:
  [`electron-main-saida-do-chkdsk-no-reparo-de-unidade-aparece-com-acentos-corrompidos_2026-10-09T22-00.md`](../retest/electron-main-saida-do-chkdsk-no-reparo-de-unidade-aparece-com-acentos-corrompidos_2026-10-09T22-00.md)

## Sintoma

"Aparece esta mensagem, primeiro, porque o reparo demorou tanto?" — no diálogo **Reparar Sistema de
Arquivos (CHKDSK)**, unidade `E:\`, a "Saída do Reparo" mostra o relatório completo do chkdsk
("Não há problemas no sistema de arquivos. Nenhuma ação necessária." ... "719,341 unidades de alocação
disponíveis em disco.") e, embaixo, o erro vermelho **"O reparo do disco excedeu o tempo limite de 5 minutos."**
O dono quer saber (1) por que a mensagem de erro aparece com o chkdsk tendo terminado sem problemas e
(2) por que demorou tanto.

## Evidencia

- Print do dono (diálogo após o fim).
- Log do app `%APPDATA%\xbox-360-companion-electron\logs\godsend-server-2026-10-10.log` (horário UTC):
  ```
  01:28:20.800Z pid=45652 APP_LIFECYCLE app ready ...
  01:29:17.599Z pid=45652 APP_USB Iniciando reparo de volume CHKDSK na unidade E:
  01:45:29.914Z pid=45652 APP_USB Reparo CHKDSK em E: finalizado (código 0, reparado: true)
  ```
  Comando: `grep -n -i "chkdsk\|reparo" godsend-server-2026-10-10.log` → só essas duas linhas do reparo.
  Do início ao `close`: **16 min 12 s**. Nenhuma linha registra o estouro do prazo.
- Volume: FAT32, 15.143.936 KB, 65.912 arquivos em 256 pastas, cluster de 8 KB (do próprio print).
- Durante o reparo o backend logou `CreateFile E:\: Access is denied.` para 3 itens da fila (01:29:38Z) —
  o `/x` desmontou o volume.

## Causa raiz

Duas coisas independentes, e só a segunda é bug:

**1. Por que demorou 16 min** — é o tempo do próprio `chkdsk /f /x` num pendrive FAT32 com 65.912 arquivos:
o log mostra o `close` do processo 16 min 12 s depois do início, e a saída é o relatório normal de um volume
sem erros. O app não acelera nem atrasa o chkdsk; com `/f` ele lê a FAT inteira e todas as entradas de
diretório, e a velocidade é a da leitura aleatória do pendrive. Não é defeito do app.

**2. Por que a mensagem de erro aparece com o chkdsk terminado bem** — `driveRepairService.ts::repairDrive`:
- o processo lançado é `cmd.exe /c "echo Y | chkdsk E: /f /x"`; o chkdsk é **neto** do Electron;
- o `setTimeout` de 5 min chama `child.kill()` e faz `resolve({ ok:false, summary:"...excedeu o tempo limite
  de 5 minutos." })`. No Windows o `kill()` termina **só o `cmd.exe`**; o chkdsk continua vivo, com o pipe
  herdado, e continua escrevendo;
- os `data` seguem chamando `onProgress`, e o listener de `DriveRepairModal.tsx` (`onDriveRepairProgress`)
  continua anexando linhas mesmo com `result` já setado → o print mostra o relatório completo **e** o erro;
- quando o chkdsk enfim sai, o `close` chega com `code === null` (processo morto por sinal), e
  `const exitCode = code ?? 0` transforma isso em **sucesso**: a linha `finalizado (código 0, reparado: true)`
  do log é fabricada — o código real do chkdsk nunca é lido. O `resolve` dessa vez é ignorado (promise já
  resolvida);
- efeito colateral: `driveMaintenanceHandlers.ts` (`tools:drive-repair`) libera `repairInProgress` no
  `finally` do primeiro `resolve`, aos 5 min → dava para disparar um **segundo** chkdsk na mesma unidade com
  o primeiro ainda rodando.

Prova (Node 24, script `killtest.js` no scratchpad da sessão), mesma forma de spawn do app com `PING -n 8`
no lugar do chkdsk, `kill()` aos 1,5 s:
```
kill() at 1538 ms -> true
exit 1543 ms code null sig SIGTERM
close 7292 ms code null sig SIGTERM chunks 10 -> code ?? 0 = 0
```
O filho seguiu até o fim (close aos 7,3 s, 10 blocos de saída) e o `code ?? 0` deu 0.

## Hipoteses descartadas

- **O chkdsk travou esperando resposta** — não: a saída terminou com o relatório final e o processo saiu
  sozinho (`close` aos 16 min); o `echo Y |` fecha o stdin, então não há prompt pendurado.
- **Os `�` fazem parte deste bug** — não: o app (pid 45652) subiu 01:28:20Z, antes do commit `f9842ce`
  (01:35Z) que corrigiu a decodificação; é o bug irmão, já em `retest/`.
- **Aumentar o prazo resolve** — não: qualquer prazo fixo menor que o pior pendrive repete o sintoma, e
  matar um `chkdsk /f` no meio da escrita na FAT é justamente o que pode corromper o volume.

## Correcao planejada

`src/electron-app/services/driveRepairService.ts::repairDrive`:
- remover o `setTimeout` que mata o processo: o reparo `/f` não é interrompido; termina quando o chkdsk
  termina (o stdin já fecha via `echo`, então não há espera infinita por prompt);
- `close` com `code === null` passa a ser falha (`exitCode -1`, "O CHKDSK foi interrompido"), nunca 0 —
  extrair a decisão para uma função pura `summarizeChkdskExit(code, output)`;
- registrar a duração no log (`finalizado em Xm Ys`).

`renderer/components/DriveRepairModal.tsx`: aviso de que o reparo pode levar vários minutos em pendrives
com muitos arquivos e não deve ser interrompido.

Prova: `tests/unit/driveRepairService.test.cjs` — `summarizeChkdskExit(null, ...)` → `ok:false`;
`0` → íntegro; `1` → reparado; `3` sem texto de correção → aviso. Ponta a ponta: reparo real em E: pelo
app novo, sem mensagem de tempo limite e com a duração no log (precisa do dono com o pendrive).

## Tasks
| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | reparo sem kill por prazo, `code null` = falha, duração no log, aviso no modal | -- | -- | -- | -- |

## Correcao aplicada

Como planejado, sem desvio:
- `driveRepairService.ts::repairDrive` — removido o `setTimeout` de 5 min que matava o `cmd.exe` e
  resolvia com "excedeu o tempo limite"; o reparo agora termina quando o chkdsk termina. O log passa a
  dizer a duração e o código real: `finalizado em 16m 12s (código 0, reparado: true)`, ou `código nenhum`
  quando o processo morreu por sinal.
- nova função pura `driveRepairService.ts::summarizeChkdskExit(code, output)` — `code === null` vira
  `ok:false, exitCode:-1`, "O CHKDSK foi interrompido..."; o resto da regra (0/1/2/3 + texto) é a mesma de antes.
- `DriveRepairModal.tsx` — o texto do quadro informativo avisa que pode passar de 15 minutos em pendrive
  com muitos arquivos e que não se deve remover a unidade nem fechar o programa.
- Como o primeiro `resolve` não acontece mais aos 5 min, `repairInProgress` só é liberado no fim real
  do chkdsk (sem segundo reparo concorrente).

## Testes executados

- `npm run tsc` e `npm run renderer:typecheck` — limpos.
- `node --test tests/unit/driveRepairService.test.cjs` — 3/3 pass (2 testes novos de `summarizeChkdskExit`).
- Controle positivo: trocado `if (code === null)` por `if (false)` no JS compilado → **1 fail** (o teste do
  `code null`); restaurado com `npm run tsc` → 3/3.
- **Pendente (ponta a ponta):** reparo real de `E:` pelo app rebuildado, com o pendrive do dono: o diálogo
  deve terminar com "Nenhum erro encontrado" sem a mensagem de tempo limite, e o log deve trazer
  `finalizado em ...`. O `renderer-dist` não foi rebuildado nesta sessão porque tem mudanças de outra
  sessão sem commit.

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** corrigir — o fix de código já está em `origin/main` (b9be24c) e está correto; falta o que ele
deixou de fora: o teste que pega a volta do prazo de 5 min (hoje nenhum teste falharia) e a entrada no `CHANGELOG.md`.
**Complexidade:** baixa — só um teste de unidade e uma entrada de changelog; nenhuma lógica de produção muda.
**Severidade:** medio — o reparo de fato termina, mas o app mostra erro falso aos 5 min, grava no log um
"código 0" inventado e libera um segundo chkdsk na mesma unidade. Só atinge quem usa o reparo num pendrive grande.
**Arquivos a alterar (reserva da onda):**
- `src/electron-app/tests/unit/driveRepairService.test.cjs` — teste novo de `repairDrive` com `spawn` falso e relógio falso

(`CHANGELOG.md` fica fora da reserva, como manda o manual: `merge=union`.)

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

A causa é a da seção `## Causa raiz` acima e o fix já foi aplicado. Conferido no código atual (base `d7bd9ad`):
- `src/electron-app/services/driveRepairService.ts::repairDrive` — `spawn(cmd.exe, ["/c", "echo Y | chkdsk X: /f /x"])`;
  não tem mais `setTimeout`; resolve **só** no `close` (via `summarizeChkdskExit`) ou no `error` (`ok:false, exitCode:-1`).
  Log: `Reparo CHKDSK em X: finalizado em Nm Ss (código <code ?? "nenhum">, reparado: <bool>)`. Antes do spawn, chama
  `appendAppEvent("usb", "Iniciando ...")` e espera `windowsAnsiCodePage()`.
- `driveRepairService.ts::summarizeChkdskExit` — `null` → `{ok:false, exitCode:-1, repaired:false, "...interrompido..."}`;
  0/1 → reparado; >1 sem texto de correção → `ok:false`, "código N". Coberta por 2 testes em `driveRepairService.test.cjs`.
- `infrastructure/windowsAnsiCodePage.ts::windowsAnsiCodePage` — fora do win32 devolve 1252 sem I/O; no Windows roda
  `reg.exe query` **uma vez** (promise em cache no módulo) e cai para 1252 em erro. Nunca rejeita.
- `infrastructure/serverLog.ts::appendAppEvent` → `appendLine` — grava em `<userData|%APPDATA%>\...\logs\` e engole
  o erro (`console.error`). No `node --test` puro, `app` do electron não existe e o caminho cai para `%APPDATA%`: um
  teste que chama `repairDrive` de verdade **escreveria no log do dono**. Por isso o teste novo troca o módulo
  `serverLog.js` em `require.cache` antes de carregar o serviço.
- `ipc/driveMaintenanceHandlers.ts` (`tools:drive-repair`) — `repairInProgress` só volta a `false` no `finally`
  depois do `await repairDrive(...)`; com o resolve só no `close`, não sai mais um segundo chkdsk aos 5 min.
- `renderer/components/UsbGamesPage.tsx:764` abre `DriveRepairModal` para a unidade escolhida na página do pendrive;
  `DriveRepairModal.tsx` chama `window.godsendApi.toolsDriveRepair(driveRoot)` e escuta `onDriveRepairProgress`.
- O JS compilado é CommonJS: `repairDrive` lê `child_process_1.spawn` **na hora da chamada**, então trocar
  `require("child_process").spawn` no teste funciona sem mexer no código de produção.

### Provas (comando literal -> resultado)

- `git log origin/main --oneline -3` → `d7bd9ad`, `b9be24c fix(electron): reparo CHKDSK sem prazo ...`, `9351725`: o fix está na base.
- `git show --stat b9be24c` → `DriveRepairModal.tsx`, `driveRepairService.ts`, `driveRepairService.test.cjs` e o doc;
  **sem `CHANGELOG.md`**. `grep -n -i chkdsk CHANGELOG.md` → nenhuma linha em `[Unreleased]` (as citações são de 2.12.x antigas).
- `grep -rn "setTimeout\|timeout" services/driveRepairService.ts ipc/driveMaintenanceHandlers.ts renderer/components/DriveRepairModal.tsx`
  (em `src/electron-app`) → nada: não sobrou prazo em nenhuma camada (o `timeout: 10_000` do `reg.exe` é de outro módulo).
- Cobertura: os testes atuais só chamam `extractDriveLetter` e `summarizeChkdskExit`. Repor o `setTimeout` de 5 min
  em `repairDrive` não faria nenhum teste falhar (o controle positivo da sessão anterior mudou só o `code === null`).
- `node --version` → `v24.19.0` (tem `mock.timers` com `setTimeout` e `Date` no `node:test`).

### Hipoteses descartadas (e por que)

- **Bug sem código, só mover para retest** — não: o fix saiu sem a entrada no CHANGELOG que o manual exige, e o
  sintoma relatado (erro aos 5 min) não tem teste que o pegue se voltar. Além disso, o helper só deixa um
  `corrigir` andar com commit de código no branch.
- **Testar o reparo de ponta a ponta numa unidade de verdade** — proibido: nenhum disco liberado (manual, Teste).
  O chkdsk numa letra que **não existe** (sem disco) é o complemento do Plano de teste.
- **Matar a árvore do processo (`taskkill /T`) e manter um prazo** — não: interromper um `chkdsk /f` no meio da
  gravação da FAT é o que pode corromper o volume (já descartado acima); o fix certo é não ter prazo.
- **O `renderer-dist` versionado ainda tem o texto antigo do modal** — não é deste bug: `grep -l "mais de 15 minutos"
  src/electron-app/renderer-dist/assets/*.js` → nada, mas o `renderer-dist` só é commitado no release do dono
  (`d373fff chore(renderer): renderer-dist da build publicada na 2.12.105`), e todo `build:*`/`start` roda
  `renderer:build` antes. Não entra na reserva.

### Tarefas

- [ ] `src/electron-app/tests/unit/driveRepairService.test.cjs` — teste novo `repairDrive: sem prazo; resolve só
  no close`. Montagem: (1) `require.cache[require.resolve("../../infrastructure/serverLog.js")] = { exports:
  { appendAppEvent: (c, m) => events.push(m) } }` **antes** do primeiro `require` do serviço (hoje o arquivo carrega
  o serviço na linha 4: o stub tem de vir no topo, senão o módulo em cache já tem o `serverLog` real); (2) trocar
  `require("child_process").spawn` por um fake que devolve um `EventEmitter` com `stdout`/`stderr` (`EventEmitter`)
  e devolver o original no fim (`t.after`); (3) `Object.defineProperty(process, "platform", { value: "win32" })`
  só se não for win32 e restaurar; (4) `mock.timers.enable({ apis: ["setTimeout", "Date"] })`. Passos: chamar
  `repairDrive("E:\\", onProgress)`, esperar o spawn acontecer (o `await windowsAnsiCodePage()` vem antes —
  aguardar até o fake ter sido chamado), `mock.timers.tick(6 * 60 * 1000)`, drenar microtasks e confirmar que a
  promise **ainda não resolveu**; emitir um `data` (`Buffer` com "Não há problemas") e conferir o `onProgress`;
  emitir `close` com `0` → `ok:true`, `exitCode:0`, `summary` "Nenhum erro encontrado...", e a linha do log contém
  `finalizado em 6m 0s (código 0`. Segundo caso: `close` com `null` → `ok:false`, `exitCode:-1` e `código nenhum`
  no log. **Prova que pega a regressão:** repor no JS compilado o `setTimeout(() => { child.kill(); resolve({...
  "excedeu o tempo limite de 5 minutos." }) }, 300000)` → o teste falha; restaurar com `npm run tsc` → passa.
- [ ] `CHANGELOG.md` `## [Unreleased]` / `### Fixed` — entrada do b9be24c: o porquê (o `kill()` aos 5 min matava
  só o `cmd.exe`, o chkdsk seguia, o erro aparecia junto do relatório completo e o `code ?? 0` gravava "código 0"),
  `driveRepairService.ts::repairDrive` / `::summarizeChkdskExit`, o aviso no `DriveRepairModal.tsx` e o link do doc.
  Sem subir versão (manual, Dev).

### Plano de teste

- **Offline (sem slot):** `npm --prefix src/electron-app run test:safety` → os 3 testes antigos de
  `driveRepairService.test.cjs` mais o novo passam; nenhum teste escreve em `%APPDATA%\...\logs` (conferir o tamanho
  do log de hoje antes e depois). Controle positivo da Tarefa 1 (repor o `setTimeout` no `.js` compilado → falha).
- **T2 reproducao como o usuario (E2E, no slot):** o caminho do dono é Pendrive/USB (`UsbGamesPage`) → escolher a
  unidade → **Reparar (CHKDSK)** → esperar o fim. Isso exige um pendrive real com o chkdsk rodando mais de 5 min:
  **não dá no slot** (nenhum disco liberado) → vai para "falta para close" no `## Status` (o dono repete com o
  pendrive `E:` de 65.912 arquivos: diálogo termina sem "excedeu o tempo limite", com o resultado do chkdsk, e o log
  traz `finalizado em ~16m (código 0, reparado: true)`). Complemento possível sem disco, no app da lane (`npm start`
  ou Playwright `_electron.launch`): confirmar com `Get-PSDrive -PSProvider FileSystem` uma letra que **não existe**
  (ex.: `Q:`), e no renderer `await window.godsendApi.toolsDriveRepair("Q:\\")` (Playwright `page.evaluate`) →
  resposta com `result.exitCode` igual ao código real do chkdsk (não `-1` nem `0` inventado) e linha
  `APP_USB Reparo CHKDSK em Q: finalizado em 0m Ns (código N, ...)` em `%APPDATA%\xbox-360-companion-electron\logs\`.
  O chkdsk numa letra inexistente não toca disco nenhum. Na mesma janela, abrir a página Pendrive/USB e conferir
  que a lista e o botão aparecem sem erro novo (sem escolher unidade).
- **Controle positivo:** sem o fix, o sintoma só aparece com chkdsk de mais de 5 min (disco real) → não há no slot.
  O que existe é a prova do mecanismo da sessão anterior (`killtest.js`: `kill()` aos 1,5 s, filho segue até 7,3 s,
  `code ?? 0 = 0`) e o controle positivo da Tarefa 1 (o teste novo falha com o `setTimeout` de volta).
- **T3 regressao direcionada:** `go test -count=1 ./...` em `src/server` e `npm --prefix src/electron-app run
  test:safety` (linha de base: Go 9 `ok`; `test:safety` 258 pass / 0 fail + os testes novos). Vizinhos: os outros
  testes de `tests/unit` que carregam `serverLog.js` ou `child_process` no mesmo processo do `node --test` — o
  stub em `require.cache` e o `spawn` trocado precisam ser restaurados para não vazar (cada arquivo roda em processo
  próprio no `node --test`, mas conferir que o próprio arquivo não quebra os 3 testes antigos).

### Sessoes seguintes

- dev: effort medium, ultrathink nao — um teste com `spawn` falso e relógio falso mais uma entrada de changelog; o
  único cuidado é a ordem do stub no `require.cache` e esperar o `await windowsAnsiCodePage()` antes do `tick`.
- teste: effort medium, ultrathink nao — T3 mecânica e o complemento sem disco; o T2 real vai para "falta para close".

## Correcao (pipeline 20261010-2242, rodada 1)

Como planejado; o codigo de producao nao muda (o fix e o b9be24c, ja na base).
- `src/electron-app/tests/unit/driveRepairService.test.cjs` — teste novo `repairDrive: sem prazo; resolve só no close,
  com a duração e o código real no log`. Stub de `infrastructure/serverLog.js` em `require.cache` no TOPO do arquivo
  (antes do primeiro `require` do servico), `child_process.spawn` trocado por um `EventEmitter` falso e restaurado em
  `t.after`, `process.platform` forcado a `win32` so fora do Windows. Desvio pequeno do plano: o cache de
  `windowsAnsiCodePage()` e aquecido com relogio REAL antes do `mock.timers.enable` (o `execFile` do `reg.exe` tem
  `timeout` e nao deve cair no relogio falso). Casos: `tick(6 min)` sem resolver → `data` chega ao `onProgress` →
  `close 0` → `ok`, `exitCode 0`, "Nenhum erro encontrado..." e log `finalizado em 6m 0s (código 0`; segundo
  `repairDrive` com `close null` → `ok:false`, `exitCode -1`, log `(código nenhum`. O chunk de saida e ASCII para nao
  depender da ACP da maquina.
- `CHANGELOG.md` `[Unreleased]` / `### Fixed` — entrada do b9be24c (porque, simbolos, aviso do modal, link do doc). Versao nao sobe.

Provas (rodadas na lane, apos `pipeline.py build` rc 0):
- `node --test tests/unit/driveRepairService.test.cjs` → 4 pass / 0 fail.
- Controle positivo: `setTimeout(() => { child.kill(); resolve({... "excedeu o tempo limite de 5 minutos." }) }, 300000)`
  inserido no `services/driveRepairService.js` compilado → 3 pass / **1 fail** (`repairDrive resolveu antes do close
  (prazo de volta?)`); `.js` restaurado da copia → 4 pass.
- `node --test tests/unit/*.test.cjs` → 307 pass / 0 fail.
- Log do dono intocado: `%APPDATA%\xbox-360-companion-electron\logs\` com os mesmos tamanhos antes e depois (o ultimo,
  `godsend-server-2026-10-10.log`, 44212 bytes).

Plano de teste: sem ajuste.
