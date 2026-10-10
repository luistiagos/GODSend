# Bug: a saída do CHKDSK no diálogo "Reparar Sistema de Arquivos" aparece com acentos corrompidos

- **Detectado em:** 2026-10-09 22:00 (relato do dono, print do app no Windows pt-BR)
- **Origem:** `src/electron-app/services/driveRepairService.ts::repairDrive` → `renderer/components/DriveRepairModal.tsx`
- **Errors (serviço):** N/A (local)
- **Classe:** ux
- **Severidade:** P3 (baixo) — o reparo roda; só o texto fica ilegível
- **Reincidência:** primeira vez. Parente de, mas não igual a,
  [`electron-main-mensagens-do-formatador-elevado-chegam-com-acentos-corrompidos_2026-10-08T21-40.md`](electron-main-mensagens-do-formatador-elevado-chegam-com-acentos-corrompidos_2026-10-08T21-40.md)
  (lá é o `.ps1` sem BOM; aqui é a saída de um processo externo)

## Sintoma

"Xboxcompanion verifique o encoding, ele está errado no windows." No diálogo **Reparar Sistema de Arquivos
(CHKDSK)**, unidade `E:\`, a "Saída do Reparo" mostra:

```
O tipo do sistema de arquivos � FAT32.
O volume BADAVATAR criou 10/9/2026 �s 2:32 AM
O N�mero de S�rie do Volume � 8890-AB76
O Windows est� verificando os arquivos e pastas...
0 por cento conclu�do.
```

A linha gerada pelo próprio app (`[INÍCIO] Iniciando verificação e reparo ...`) sai certa; só as linhas do
`chkdsk` saem com `�`.

## Evidencia

- Print do dono (diálogo aberto durante o reparo de `E:`).
