# Bug: reparo CHKDSK acusa "tempo limite de 5 minutos" mas o chkdsk continua rodando até o fim

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
