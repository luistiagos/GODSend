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
