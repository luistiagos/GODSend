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

## Causa raiz

- `services/driveRepairService.ts::repairDrive` sobe `cmd.exe /c "echo Y | chkdsk.exe E: /f /x"` e, em
  `handleData`, converte cada pedaço com `chunk.toString()` — **UTF-8**. As linhas vão para
  `onProgress` → `ipc/driveMaintenanceHandlers.ts` (`tools:drive-repair-progress`) → `DriveRepairModal`.
  O mesmo texto vai em `result.output` (e é nele que rodam as regex `corrigiu|...` e `encontrou erros`).
- Com a saída num pipe, o `chkdsk` grava na **página de código ANSI** do Windows (ACP), um byte por caractere.
  Em UTF-8, cada byte ≥ 0x80 solto é inválido e vira `U+FFFD` (`�`) — exatamente um `�` por letra
  acentuada, como no print.
- A linha `[INÍCIO] ...` sai certa porque é texto do próprio app, não do `chkdsk`.

Provas (máquina de dev, Windows 11 pt-BR):

```
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage" /v ACP    -> 1252
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage" /v OEMCP  -> 437
cmd /c chcp (via spawn do Node)                                           -> 437
```

`cmd /c "echo N | chkdsk.exe C:"` (sem admin, só leitura; spawn do Node, bytes crus):

```
hex: ea e3 e9 | windows-1252: Acesso negado, pois você não tem privilégios suficientes ou
hex: e1 e7 e3 | windows-1252: Invoque este utilitário durante a execução em modo privilegiado
```

`ê` = 0xEA, `ã` = 0xE3: é **1252 (ACP)**. Em 437 (OEM), `ê` seria 0x88.

## Hipoteses descartadas

- **Saída na página OEM (437/850), como o `cmd` interno.** Descartada pelos bytes acima: 0xEA/0xE3/0xE9 são
  1252; em 437 seriam 0x88/—/0x82. O `chkdsk /?` também saiu com `ó` = 0xF3 (1252).
- **Forçar `chcp 65001` antes do `chkdsk`.** O `chkdsk` não segue a página do console (console em 437, saída em
  1252), então trocar o `chcp` não muda a saída.
- **Mesma causa do bug do formatador** (`.ps1` sem BOM). Lá o texto corrompido é do script lido errado pelo
  PowerShell (`Ã§`, dois caracteres por letra); aqui é a saída de processo externo lida como UTF-8 (`�`, um por letra).
- **`Buffer.toString("latin1")` como correção.** Acertaria pt-BR (0xA0–0xFF batem com 1252), mas erra 0x80–0x9F e
  qualquer Windows com ACP diferente (1250, 1251, 932...). `TextDecoder` com o rótulo da ACP cobre tudo.
- **`TextDecoder` sem suporte a páginas legadas no Electron.** Conferido no runtime do app
  (`ELECTRON_RUN_AS_NODE=1 electron -e ...`, Electron 42.4.1, ICU 78.2): `windows-1250/1251/1252/874`,
  `shift_jis`, `gbk`, `euc-kr`, `big5` todos existem; `windows-1252` decodifica `ea e3 e9` como `êãé`.

## Correcao planejada

1. Novo `infrastructure/windowsAnsiCodePage.ts`:
   - `parseAnsiCodePage(regOutput)` — extrai o número do `reg query ... /v ACP`;
   - `textDecoderLabelForCodePage(cp)` — 125x/874 → `windows-<cp>`, 932 → `shift_jis`, 936 → `gbk`,
     949 → `euc-kr`, 950 → `big5`, resto/inválido → `windows-1252`;
   - `windowsAnsiCodePage()` — async, `reg.exe` via `system32Exe`, com cache; em erro devolve 1252;
   - `createWindowsAnsiDecoder()` — `TextDecoder` com o rótulo acima (fallback `windows-1252`).
2. `services/driveRepairService.ts::repairDrive` — um decoder por stream (stdout/stderr), `decode(chunk,
   {stream:true})`, para que um caractere DBCS partido entre dois pedaços não quebre.
3. Testes: `tests/unit/windowsAnsiCodePage.test.cjs` (parse, mapeamento, decode de `ea e3 e9` e de "concluído");
   prova real: script que roda o `chkdsk C:` (só leitura) pelo mesmo decoder e mostra o texto acentuado certo.

Fora do escopo (registrar se aparecer): outros `spawn` que leem saída de ferramenta do Windows como UTF-8.

## Tasks
| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | decodificar a saída do chkdsk na página ANSI do Windows | `f9842ce` | retest | claude-opus-5-5 | -- |

## Correcao aplicada

Conforme o plano, sem desvio (commit `f9842ce`):

1. `src/electron-app/infrastructure/windowsAnsiCodePage.ts` (novo): `parseAnsiCodePage`,
   `textDecoderLabelForCodePage`, `windowsAnsiCodePage` (lê o ACP com `reg.exe` de System32, uma vez, em cache;
   1252 se falhar) e `createAnsiDecoder` (fallback `windows-1252`).
2. `services/driveRepairService.ts::repairDrive`: busca o ACP antes do `spawn` e decodifica stdout e stderr com
   um `TextDecoder` por stream (`stream: true`). As linhas do diálogo e o `result.output` (onde rodam as regex de
   "corrigiu"/"encontrou erros") passam a sair com acento certo.

## Testes executados

- `npm run tsc` — ok.
- `node --test tests/unit/windowsAnsiCodePage.test.cjs` — 5/5: parse do `reg query`, mapeamento das páginas,
  decode dos bytes do print (`conclu\xeddo` → `concluído`, `N\xfamero de S\xe9rie ... \xe9` → `Número de Série ... é`),
  controle negativo (o decode antigo, UTF-8, dá `conclu�do`), DBCS partido entre pedaços (Shift_JIS), e o ACP
  real da máquina.
- Suíte unitária inteira (`node --test tests/unit/*.test.cjs`) — 304/304.
- Prova real no runtime do app (`ELECTRON_RUN_AS_NODE=1 electron proof.cjs`, Electron 42.4.1): `chkdsk C:` real
  (só leitura, sem admin) pelo módulo compilado:

  ```
  ACP: 1252 label: windows-1252
  --- ANTES (UTF-8):  Acesso negado, pois voc� n�o tem privil�gios suficientes ou ...
  --- DEPOIS (ACP):   Acesso negado, pois você não tem privilégios suficientes ou ...
  U+FFFD antes: 7 depois: 0
  ```

**Não feito:** o reparo real (`chkdsk /f /x`) pelo diálogo do app. Ele exige admin e desmonta à força o pendrive —
o `E:` estava em uso pelo dono. Falta a prova no app: abrir **Reparar Sistema de Arquivos** num pendrive descartável e
ver "concluído" / "Número de Série" com acento.
