# Bug: `spawn powershell.exe ENOENT` no lugar da lista de dispositivos

- **Detectado em:** 2026-09-06 (print enviado pelo usuário)
- **Status:** **Resolvido** (v2.12.76)
- **Origem:** relato direto — tela "Prepare seu pendrive ou HD", card **Dispositivo conectado**
- **Classe:** falha funcional (não é crash — a tela continua de pé, mas sem nenhuma unidade)
- **Plataforma:** Windows

## Sintoma

O card **Dispositivo conectado** mostra, na faixa vermelha de erro:

```
spawn powershell.exe ENOENT
```

O seletor de unidade fica vazio, **Atualizar** repete o mesmo erro e "Formatar antes de
preparar" aparece desabilitado com o texto padrão *"O formatador FAT32 não está disponível
ou o dispositivo não passou na validação de segurança"* — porque nenhuma unidade chegou à
lista, não porque o formatador esteja de fato ausente.

## Caminho até a tela

| Etapa | Arquivo | O que acontece |
|---|---|---|
| 1 | [`BadAvatarUsbPage.tsx:108`](../../../src/electron-app/renderer/components/BadAvatarUsbPage.tsx#L108) | `refreshDrives` chama `toolsBadAvatarListDrives()` |
| 2 | [`badAvatarHandlers.ts:31`](../../../src/electron-app/ipc/badAvatarHandlers.ts#L31) | `tools:badavatar-list-drives` → `listFat32UsbDrives()` |
| 3 | [`windowsUsbDeviceService.ts:313`](../../../src/electron-app/infrastructure/windowsUsbDeviceService.ts#L313) | `enumerateSafeWindowsUsbDevices()` → `runPowerShell()` |
| 4 | `windowsUsbDeviceService.ts` (`runPowerShell`) | `spawn("powershell.exe", …)` emite `error` com `code === "ENOENT"` |
| 5 | `badAvatarHandlers.ts:41` | devolve `{ ok:false, error: err.message }` — a mensagem crua do Node |
| 6 | `BadAvatarUsbPage.tsx:112` | grava esse texto em `loadError` e renderiza a faixa vermelha |

A primeira enumeração (`ENUMERATE_REMOVABLE_SCRIPT`) tem `try/catch` que só registra em log;
a segunda (`ENUMERATE_USB_SCRIPT`) não tem, e é a que propaga. Por isso o erro chega inteiro
à interface.

## Causa raiz

Todos os `spawn`/`spawnSync` do app passavam o **nome simples** do executável:

```ts
spawn("powershell.exe", ["-NoLogo", "-NoProfile", …], { windowsHide: true });
```

No Windows esse nome é resolvido pelo `%PATH%` do processo. Quando o PATH não contém
`%SystemRoot%\System32\WindowsPowerShell\v1.0`, o `CreateProcess` falha antes de executar
qualquer script e o libuv devolve `ENOENT`. Isso acontece com PATH editado à mão, PATH
truncado no limite de 2047 caracteres da caixa de diálogo antiga, e em imagens
"debloatadas" do Windows (tiny11, Ghost Spectre e afins) — justamente comuns no público que
instala RGH.

**Não era hipótese.** Reproduzido nesta máquina com o PATH inutilizado:

```
PATH=C:\NaoExiste
  spawnSync("powershell.exe", …)                        -> spawnSync powershell.exe ENOENT
  spawnSync("C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", …) -> "OK"
```

O detalhe que confirma o diagnóstico: os próprios scripts `.ps1` deste repositório **já**
resolviam `diskpart.exe`, `mountvol.exe` e `format.com` via `$env:SystemRoot`
(`fat32Format.ts:88,119,166,227`, `windowsUsbDeviceService.ts:91,172`) exatamente porque
`System32` pode não estar no PATH. O que ninguém tinha resolvido era o **interpretador**.

## Correção

Novo [`infrastructure/windowsSystemExecutables.ts`](../../../src/electron-app/infrastructure/windowsSystemExecutables.ts):

- `powerShellExe()` → `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`
- `system32Exe(rel, fallback)` → qualquer executável de `System32` (`cmd.exe`, `net.exe`, `chkdsk.exe`)
- `POWERSHELL_EXE_PS_EXPRESSION` → `(Join-Path $env:SystemRoot …)` para o `Start-Process
  powershell -Verb RunAs` **aninhado** do script de elevação do formatador, que tinha a mesma exposição
- `isExecutableNotFound()` / `powerShellMissingMessage()` → traduzem o ENOENT residual

Fora do Windows, ou quando o arquivo realmente não está lá, as funções devolvem o nome
simples de antes: um Windows sem PowerShell degrada como degradava, e não numa falha em
caminho inventado.

Sites atualizados: `windowsUsbDeviceService.ts`, `badAvatarUsbService.ts` (3 chamadas +
`net session`), `fat32Format.ts` (2 + o `Start-Process` interno), `driveRepairService.ts`
(PowerShell, `cmd.exe` e `chkdsk`), `fakeDriveProbeService.ts`, `autoUpdateService.ts`.

### Armadilha encontrada ao corrigir: não use aspas dentro do `cmd /c`

A primeira versão do `repairDrive` passou o caminho do `chkdsk` entre aspas
(`echo Y | "C:\Windows\System32\chkdsk.exe" F: /f /x`). O Node escapa o `"` interno como
`\"` ao montar a linha de comando do Windows, e o `cmd` não entende essa convenção:

```
COM aspas | status = 255 | '\"C:\WINDOWS\System32\where.exe\"' não é reconhecido como um comando interno ou externo
SEM aspas | status = 0   | C:\Windows\System32\cmd.exe
```

O caminho vai **sem aspas**. Como `%SystemRoot%` nunca contém espaço, não há perda; com
aspas, o reparo CHKDSK teria quebrado em toda máquina, inclusive nas que hoje funcionam.

### Efeito colateral corrigido junto

`isRunningAsAdmin()` chamava `net session` pelo nome simples. Nas mesmas máquinas,
`tools:badavatar-is-admin` rejeitava, `readinessPromise` era absorvida pelo
`Promise.allSettled` do `refreshDrives` e a disponibilidade do formatador FAT32 ficava
indefinida sem nenhum sinal na interface.

### Mensagem para o caso restante

Se o PowerShell de fato não existir, a listagem agora diz o que falta, onde foi procurado e
o que verificar no PATH, em vez de repetir `spawn powershell.exe ENOENT`.

## Testes

[`tests/unit/windowsSystemExecutables.test.cjs`](../../../src/electron-app/tests/unit/windowsSystemExecutables.test.cjs):
caminho absoluto existente e igual ao esperado; fallback para o nome simples quando o
arquivo não existe; barras preservadas na expressão de elevação (o mesmo erro de
`System32mountvol.exe` que `fat32FormatGuard.test.cjs` já vigia); tradução do ENOENT.
Suíte completa: 150 testes, 0 falhas.

## O que continua aberto

A causa **na máquina do usuário** — PATH quebrado ou Windows modificado — não foi
diagnosticada; o app apenas deixou de depender dela. Se o print vier de um Windows com o
`powershell.exe` removido de fato, o sintoma vira a nova mensagem explicativa, e aí a
enumeração de USB precisará de um caminho sem PowerShell (hoje não existe: a política de
segurança do dispositivo depende de `Get-Disk`/`Get-Volume`).
