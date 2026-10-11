# Bug: falha no preparo do pendrive/HD (BadAvatar/RGH) não chega à telemetria — o handler devolve `{ ok: false }` e a tela só mostra o erro

- **Detectado em:** 2026-10-04 23:28 (chamado #144 do painel, sessão `165291833184337@lid`, telefone `553196998502`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/ipc/badAvatarHandlers.ts` (handler `tools:badavatar-prepare`), `src/electron-app/renderer/components/BadAvatarUsbPage.tsx` (chamada a `toolsBadAvatarPrepare`) e `src/electron-app/services/fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice`
- **Classe:** diagnóstico (ponto cego de telemetria) — esconde uma falha funcional
- **Severidade:** **P2 — Médio** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): o preparo é a porta de entrada do produto, e uma falha ali só chega até nós se o cliente reclamar no WhatsApp
- **Complexidade:** baixa — um `reportError` no `catch` do handler, com o mesmo formato dos outros handlers do arquivo
- **Versões:** o trecho é o mesmo desde `d4db121` (2026-06-25, `git blame` das linhas do `catch`) até o HEAD atual (`5be1c63`, 2026-10-04)
- **Reincidência:** primeira vez

## Sintoma, na ordem que o cliente viveu

1. 2026-09-14 19:22 UTC: o agente manda conectar o pendrive e clicar em "Gravar em um Pendrive
   ou HD" (`[108976]`).
2. 21:25:49 UTC, `[109095]`: *"Toda hora aparece esse erro"*. Print: *"UNKNOWN: unknown error,
   mkdir 'D:\xbox-downloader\transactions'"*. A [DESCRIÇÃO] é transcrição da visão e
   provavelmente perdeu o ponto: o caminho real do diário é `D:\.xbox-downloader\transactions`
   (`infrastructure/simulatedTransactionalWriter.ts::metadataPaths`, `journalRoot`).
3. 22:00:01 `[109133]`: *"Agora acho que foi"*. O preparo passou, em algum momento, depois de
   ~35 min e da troca de porta USB sugerida pelo agente.

## Evidencia

**Nenhum report.** `/diag/query` na tabela `errors`, `project LIKE 'xbox-360-companion%'` e
mensagem com `transactions` ou `UNKNOWN: unknown error`, em toda a história: **0 linhas**. A
cliente diz que o erro aparecia "toda hora".

**O código engole o erro**, aberto nesta passada:

- `ipc/badAvatarHandlers.ts`, handler `tools:badavatar-prepare`:
  ```ts
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    preparationInProgress = false;
  }
  ```
  O arquivo importa `reportError` e o usa em outro handler. Este não chama.
- `renderer/components/BadAvatarUsbPage.tsx`: `if (!response?.ok) throw new Error(...)` →
  `catch (prepareError) { setError(prepareError?.message || "Não foi possível preparar o dispositivo.") }`.
  Mostra na tela e não reporta.
- `fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice` é `try/finally` (só limpa o
  staging temporário). Propaga o erro, então ele chega inteiro ao handler, que o descarta.

## Causa raiz

Do ponto cego, provada pelo código acima: o único caminho de erro do preparo termina num
`return { ok: false }` sem `reportError`, e o renderer só exibe. A **causa do `mkdir UNKNOWN`**
em si não está provada. É o mesmo volume que dois dias depois falhou em `mkdir` na gravação de
jogos ([[pipeline-mkdir-da-pasta-do-jogo-falha-com-caminho-nao-encontrado-e-o-dispositivo-presente_2026-10-04T23-28]]),
e é por causa deste ponto cego que não há como medir.

## Escopo — o que NAO e este bug

- A falha de `mkdir` na gravação de jogos (pipeline Go): ela **chega** à telemetria; doc irmão
  acima.
- O caminho `tools:badavatar-preview`: não verificado nesta passada. Conferir junto, porque tem o
  mesmo formato de handler.

## Tarefas propostas / Proximos passos

1. `reportError` no `catch` de `tools:badavatar-prepare`, com o modo (`isRghOnly`),
   `formatDrive`, sistema de arquivos/tamanho do volume e a fase em que falhou (o `status` do
   último `onProgress`). Cuidar para não reportar o erro esperado de "preparação em andamento".
2. Conferir os demais handlers do arquivo (`tools:badavatar-preview` e os outros `catch`) pelo
   mesmo padrão.
3. Depois do deploy, medir quantos preparos falham por dia e com que mensagem. É o número que
   decide se o `mkdir UNKNOWN` é um caso isolado.

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** corrigir — o `catch` de `tools:badavatar-prepare` devolve `{ ok: false }` sem `reportError`; o conserto é um reporte com contexto no handler, testável offline com o harness de mock de módulo que `browseHandlers.test.cjs` já usa.
**Complexidade:** baixa — "validação que já tem a regra pronta em outro lugar e só falta chamar": o mesmo arquivo já reporta em `tools:badavatar-list-drives`, e `browseHandlers.ts` tem o formato exato (contexto + stack em `extraLogs`). Não toca `fixedBadAvatarPreparationService.ts` nem disco.
**Severidade:** medio — o preparo em si não muda; falta a visibilidade da falha (o cliente tem contorno e reclama no WhatsApp), mas é ponto cego na porta de entrada do produto.
**Arquivos a alterar (reserva da onda):**
- `src/electron-app/ipc/badAvatarHandlers.ts` — `catch` de `tools:badavatar-prepare` passa a registrar no log e reportar à telemetria, com a última fase do progresso
- `src/electron-app/tests/unit/badAvatarHandlers.test.cjs` — novo; prova o reporte, e o não-reporte de "preparação em andamento" e do sucesso

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `src/electron-app/ipc/badAvatarHandlers.ts::register`, handler `tools:badavatar-prepare` (linhas 95-113) — se `preparationInProgress`, devolve `{ ok:false, error:"Já existe uma preparação em andamento." }` **antes** do `try` (logo, um reporte no `catch` nunca o vê: o cuidado pedido na tarefa 1 do doc sai de graça). Senão chama `prepareFixedBadAvatarDevice(request, onProgress)` repassando cada progresso ao renderer. **Em erro:** o `catch` faz só `return { ok:false, error: err?.message || String(err) }`; o `finally` zera `preparationInProgress` e chama `setUsbPreparationActive(false)`. Nenhum log, nenhum `reportError`. **Este é o ponto cego.**
- mesmo arquivo, handler `tools:badavatar-list-drives` (linhas 34-62) — o precedente no próprio arquivo: `appendAppEvent("usb", …)` + `reportError("electron-main", "badAvatarHandlers.ts", "tools:badavatar-list-drives", message, "", [environment], false)`, com comentário explicando que erro capturado nunca chega aos hooks `uncaughtException`/`unhandledRejection` de `bootstrap.ts`.
- `src/electron-app/ipc/browseHandlers.ts::register`, `browse:get-games` (linhas 69-86) — formato a copiar: `context` em texto (`chave=valor; …`), `appendAppEvent("BROWSE", context + "; " + message)`, `reportError(..., stack ? [context, stack] : [context], false)`.
- `src/electron-app/infrastructure/telemetry.ts::reportError` — nunca lança (corpo inteiro em `try/catch` que só faz `console.error`); retorna cedo se `errorReporting` está desligado na config; **deduplica por `component|message` na sessão** (`seenErrors`), então "toda hora" vira 1 reporte por sessão por mensagem; anexa o fim (até 256 KB) do log da sessão (`getLogInfo().currentLogFile`), que é o mesmo arquivo onde `appendAppEvent` escreve (`serverLog.ts::appendAppEvent` -> `appendLine("APP_<CAT>", …)`); `extraLogs` até 20; envio assíncrono (POST, cai para GET sem logs) para `errorReportingEndpoint` da config (`settingsService.ts::getConfiguredErrorReportingEndpoint`) ou `https://digitalstoregames.pythonanywhere.com/logErr`.
- `src/electron-app/services/fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice` (linhas 485-667) — lança `Error` com texto ao usuário nas validações (requisitos; fingerprint fora de `/^[a-f0-9]{64}$/i` -> "Atualize a lista e selecione novamente o pendrive ou HD."; não-FAT32; espaço) e propaga qualquer erro de formatação/plano/gravação; o `try/finally` interno só apaga o staging temporário. Emite `onProgress({ status, percent, detail? })` (`FixedPreparationProgress`, exportado) em cada fase: 1 (crash logs), até 12 (formatação), 13 (layout), 14 (pacote), 17 (staging), 20 (espaço), 23 (quarentena), 24-100 (gravação transacional, `detail` "n/total"). O handler sabe a fase pelo último progresso — não precisa mexer no serviço.
- mesmo serviço, `requireXboxReadableLayout` (linhas 402-~460) — grava no log `layout do disco: <estilo>, <n> particao(oes), tipo X, setor a/b, <sistema de arquivos>, <bytes> bytes, "<nome>"` (`describeDiskLayout`, linha 379). Como o log da sessão vai anexo ao reporte, **sistema de arquivos e tamanho do volume já chegam** em toda falha a partir da fase 13 (a do cliente, `mkdir …transactions`, é na gravação, fase 24+). Também reporta sozinho, componente `badavatar-layout`, quando o layout sai errado **depois** de formatar — nesse único caso haverá dois reportes (um com o detalhe do layout, outro genérico do handler); aceitável, componentes e mensagens distintos.
- `src/electron-app/renderer/components/BadAvatarUsbPage.tsx` (linhas 259-281) — `if (!response?.ok) throw …` -> `catch -> setError(...)`. Só exibe. Não muda: reportando no handler (main), todo erro do preparo passa por lá.

### Provas (comando literal -> resultado)

- `cat -n src/electron-app/ipc/badAvatarHandlers.ts` -> `catch` das linhas 107-109 sem `reportError`; o import de `reportError` (linha 26) só é usado na linha 51 (list-drives).
- `grep -rn "reportError(" --include=*.ts services infrastructure ipc app` (em `src/electron-app`) -> no caminho do preparo só `badavatar-console-crash` (serviço, linha 277, artefatos do console) e `badavatar-layout` (linha 446, layout pós-formatação). Erro genérico do preparo: nenhum.
- `grep -rn "toolsBadAvatarPreview\b\|toolsBadAvatarPreview(\|toolsBadAvatarPrepare\b" renderer --include=*.tsx --include=*.ts | grep -v global.d.ts` -> só `BadAvatarUsbPage.tsx:264` (`toolsBadAvatarPrepare`). **Nenhum chamador de `toolsBadAvatarPreview` no renderer.**
- Telemetria (passada anterior deste doc): `/diag/query` em `errors`, `project LIKE 'xbox-360-companion%'` com `transactions` ou `UNKNOWN: unknown error` -> 0 linhas.

### Hipoteses descartadas (e por que)

- **Reportar também em `tools:badavatar-preview`** (tarefa 2 do doc): descartado. O canal existe em `preload.ts:137`, mas nenhum componente do renderer o chama (grep acima): não há caminho de usuário que gere esse erro, e o reporte seria código morto. Os outros handlers do arquivo: `list-drives` já reporta; `is-admin` não tem `catch`; `preview-cancel` só devolve "não existe prévia" (estado, não falha).
- **Filtrar as validações (requisitos, fingerprint, FAT32 sem formatar, espaço)**: descartado. A tarefa 3 do doc é medir quantos preparos falham e com que mensagem; o cliente viu cada uma como falha, a dedup da sessão limita o volume e a triagem fecha o esperado. "Preparação em andamento" já fica de fora (retorna antes do `try`).
- **Ler sistema de arquivos/tamanho do volume no `catch`** (`statfs` ou `listFat32UsbDrives`): descartado. É I/O contra um volume que talvez acabou de falhar (pode travar ou lançar dentro do `catch`), e `listFat32UsbDrives` ainda roda `detectPreparedDeviceState` em cada unidade. A linha `layout do disco: …` do log anexo já traz os dois a partir da fase 13; antes dela a falha é de validação ou da formatação, que loga sozinha.
- **Reportar no renderer** (`BadAvatarUsbPage.tsx`): descartado; o main tem o erro original com stack.
- **A causa do `mkdir UNKNOWN`**: fora deste bug; só fica medível depois deste fix (doc irmão `pipeline-mkdir-da-pasta-do-jogo-…`).

### Tarefas

- [ ] `src/electron-app/ipc/badAvatarHandlers.ts::register` (`tools:badavatar-prepare`) — guardar o último progresso numa variável local (`let lastProgress: FixedPreparationProgress | null = null`, tipo importado de `../services/fixedBadAvatarPreparationService`) dentro do callback de progresso. No `catch`: `message = err?.message || String(err)`; `context` = `modo=<rgh|badavatar>; formatar=<true|false>; unidade=<driveRoot>; fase=<status> (<percent>%[, <detail>])` ou `fase=antes do primeiro progresso`; `appendAppEvent("BADAVATAR", "falha no preparo: " + context + "; " + message)`; `reportError("electron-main", "badAvatarHandlers.ts", "tools:badavatar-prepare", message, "", err?.stack ? [context, err.stack] : [context], false)`; o `return { ok:false, error: message }` fica igual (o texto que o usuário vê não muda). Não mandar `expectedDeviceFingerprint` (não ajuda e identifica o dispositivo). Comentário cita `[[electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28]]`. — teste: `badAvatarHandlers.test.cjs`.
- [ ] `src/electron-app/tests/unit/badAvatarHandlers.test.cjs` (novo) — mesmo harness de `browseHandlers.test.cjs` (`new Module` + `require` interceptado) sobre `ipc/badAvatarHandlers.js`, com mocks de `electron` (`{ app: { getPath: () => "" } }`), `../infrastructure/fat32Format`, `../services/badAvatarUsbService` (`setUsbPreparationActive` registrando chamadas), `../app/window` (`getWebContentsForPush` -> objeto com `isDestroyed: () => false` e `send` que registra), `../services/preparationReadinessService`, `../services/preparationPreviewService`, `../services/fixedBadAvatarPreparationService` (`prepareFixedBadAvatarDevice` controlável), `../infrastructure/serverLog`, `../infrastructure/telemetry`, `../infrastructure/windowsSystemExecutables`. Casos: **(a)** o serviço chama `onProgress({status:"Gravando…",percent:40,detail:"3/10"})` e lança `Error("UNKNOWN: unknown error, mkdir 'D:/.xbox-downloader/transactions'")` com `formatDrive:true` -> resposta `{ok:false, error:<mensagem>}`; 1 reporte `("electron-main","badAvatarHandlers.ts","tools:badavatar-prepare",<mensagem>,"",logs,false)` com `logs[0]` contendo `modo=badavatar`, `formatar=true`, a unidade e `Gravando… (40%, 3/10)`, e `logs` contendo o `stack`; 1 evento `BADAVATAR` com contexto e mensagem; `setUsbPreparationActive` termina em `false`. **(b)** erro antes de qualquer progresso com `isRghOnly:true` -> `modo=rgh` e `fase=antes do primeiro progresso`. **(c)** segunda chamada com a primeira pendente (promessa não resolvida) -> `"Já existe uma preparação em andamento."` e **0** reportes. **(d)** sucesso -> `{ok:true,result}` e 0 reportes. Contra o handler da base, (a) e (b) falham (0 reportes).
- [ ] `CHANGELOG.md` — `## [Unreleased]` / `### Fixed`, com o porquê, `ipc/badAvatarHandlers.ts::tools:badavatar-prepare` e o link deste doc (sem subir versão: manual, secao Dev). doc-sync: nenhum canal/rota/serviço novo — nada mais a atualizar.

### Plano de teste

- **Offline (sem slot):** `node --test tests/unit/badAvatarHandlers.test.cjs` em `src/electron-app` (depois do `tsc` do `build` do helper) — os 4 casos; e `npm --prefix src/electron-app run test:safety` (linha de base 258 pass / 0 fail; esperado 262 pass / 0 fail).
- **T2 reproducao como o usuario (E2E, no slot):** o caminho do cliente é "BadAvatar USB -> escolher o pendrive -> Gravar em um Pendrive ou HD -> falha". **Escolher um disco na tela está proibido** (manual, secao Teste: nenhum disco liberado), então o clique final não pode ser repetido. A receita exercita o MESMO canal IPC que o botão chama, sem tocar disco:
  1. Copiar `%APPDATA%\xbox-360-companion-electron\config.json` para a evidência; nele, `errorReporting: true` e `errorReportingEndpoint: "http://127.0.0.1:<porta>/logErr"`, com um listener HTTP local descartável (ex.: `node -e` com `http.createServer` que grava cada corpo de POST num arquivo da evidência e responde 200).
  2. `npm start` na lane via Playwright `_electron.launch` sobre o `main.js` da lane; abrir a tela **BadAvatar USB** (só abrir, sem selecionar unidade; `page.screenshot`).
  3. Pelo renderer (`page.evaluate`), chamar o que o botão chama: `window.godsendApi.toolsBadAvatarPrepare({ driveRoot: "Z:\\", expectedDeviceFingerprint: "nao-e-um-fingerprint", formatDrive: false, requirementsAccepted: true, isRghOnly: false })`. Falha na validação de fingerprint de `prepareFixedBadAvatarDevice`, **antes de qualquer acesso a disco**.
  4. **Sinais:** retorno `{ ok:false, error:"Atualize a lista e selecione novamente o pendrive ou HD." }`; o listener recebe 1 POST com `project: "xbox-360-companion/electron-main"`, `method: "tools:badavatar-prepare"`, `message` igual ao erro e `logs` contendo `modo=badavatar; formatar=false; unidade=Z:\; fase=antes do primeiro progresso`; em `%APPDATA%\xbox-360-companion-electron\logs\` a linha `APP_BADAVATAR` `falha no preparo: …`. Repetir a chamada -> mesmo retorno e nenhum POST novo (dedup da sessão, esperado).
  5. Devolver o `config.json` original; fechar só o PID aberto.
- **Controle positivo:** não há `deploy --at-base` neste projeto. Controle = casos (a)/(b) do unitário contra o handler da base (0 reportes -> falham). Na receita T2, o sinal ausente sem o fix é: listener sem POST e log sem `falha no preparo` (o retorno `{ok:false}` é o mesmo nos dois).
- **T3 regressao direcionada:** (1) sucesso e "preparação em andamento" — casos (c)/(d) (o `finally` continua liberando `preparationInProgress` e `setUsbPreparationActive(false)`); (2) a tela BadAvatar USB segue exibindo a mesma mensagem de erro (texto do `return` inalterado; no T2, conferir que a tela não quebra depois da chamada); (3) `test:safety` inteiro e `go test -count=1 ./...` em `src/server` (não tocado; linha de base). **Falta para close:** um preparo real que falhe num pendrive (disco proibido aqui) e a medição em produção depois da versão publicada (tarefa 3 do doc: quantos preparos falham por dia e com que mensagem).

### Sessoes seguintes

- dev: effort medium, ultrathink nao — troca localizada num handler, formato copiado de `browseHandlers.ts`; o teste novo segue um harness pronto.
- teste: effort medium, ultrathink nao — offline determinístico; o T2 exige montar o listener local e restaurar o `config.json`, sem classificação sutil.

## Correcao (pipeline 20261010-2242, rodada 1)

- `src/electron-app/ipc/badAvatarHandlers.ts::register`, handler `tools:badavatar-prepare` — o callback de progresso guarda o último `FixedPreparationProgress` em `lastProgress` (tipo agora importado do serviço). No `catch`: monta `context` = `modo=<rgh|badavatar>; formatar=<bool>; unidade=<driveRoot>; fase=<status> (<percent>%[, <detail>])` ou `fase=antes do primeiro progresso`; grava `appendAppEvent("BADAVATAR", "falha no preparo: " + context + "; " + message)`; chama `reportError("electron-main", "badAvatarHandlers.ts", "tools:badavatar-prepare", message, "", [context, stack?], false)`. O `return { ok:false, error: message }` e o `finally` não mudaram; o fingerprint não vai no contexto. "Preparação em andamento" segue retornando antes do `try` (não reporta).
  - Nota de implementação: a atribuição dentro do callback não é vista pelo narrowing do TS (no `catch`, `lastProgress` seria `null`), por isso `const phase = lastProgress as FixedPreparationProgress | null`.
- `src/electron-app/tests/unit/badAvatarHandlers.test.cjs` (novo) — harness de `browseHandlers.test.cjs` (`new Module` + `require` interceptado) sobre `ipc/badAvatarHandlers.js`; casos (a) falha na fase `Gravando… (40%, 3/10)` com `formatDrive:true` -> 1 reporte com contexto + stack, sem fingerprint, 1 evento `BADAVATAR`, `setUsbPreparationActive` `[true,false]`; (b) RGH antes do primeiro progresso -> `modo=rgh`, `fase=antes do primeiro progresso`; (c) segunda chamada com a primeira pendente -> "Já existe uma preparação em andamento." e 0 reportes/eventos, a primeira conclui; (d) sucesso -> 0 reportes.
- `CHANGELOG.md` — `## [Unreleased]` / `### Fixed` (sem subir versão: manual, seção Dev). doc-sync: nenhum canal/rota/serviço novo.
- Plano de teste: sem ajustes.
- Compile-check: `pipeline.py build` rc 0 (build-server + `tsc` + `renderer:typecheck`). Offline: `node --test tests/unit/badAvatarHandlers.test.cjs` -> 4 pass / 0 fail; `node --test tests/unit/*.test.cjs` -> 310 pass / 0 fail (a linha de base do manual, 258, é anterior a outros testes já integrados no main).

- 2026-10-11: `enqueue-test` recusou (saida 9: `CHANGELOG.md` nao reservado; o manual diz que ele nao entra na reserva, mas o helper exige) e o `claim` deu saida 8 (reservado por `electron-main-reparo-chkdsk-acusa-tempo-limite-de-5-min-mas-o-chkdsk-continua-rodando_2026-10-09T22-50`). Codigo commitado; `park` ate o dono liberar. Na retomada: `sync`, conferir a entrada do CHANGELOG e `enqueue-test`.
- 2026-10-11: CHKDSK liberou; `sync` sobre origin/main @ 2e886d2 sem conflito. Novo `claim` do `CHANGELOG.md` deu saida 8 (agora reservado por `backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio-e-extrai-iso-incompleta-sem-erro_2026-10-09T20-20`); `park` de novo.
- 2026-10-11: iso2god liberou; `sync` sobre origin/main @ e5e658f sem conflito; `claim` do `CHANGELOG.md` ok. Rebuild rc 0; `node --test tests/unit/*.test.cjs` -> 311 pass / 0 fail. `enqueue-test`.
