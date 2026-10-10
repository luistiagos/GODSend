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
