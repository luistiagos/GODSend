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

- `powerShellExe()` / `system32Exe(rel, fallback)` → resolvem na ordem **`%PATH%` →
  `%SystemRoot%\System32\…` → nome simples**. A varredura do PATH usa `existsSync` em vez de
  gastar um `spawn` que falha, como o backend Go já faz para o `aria2c`
  ([`torrent.go:142`](../../../src/server/infrastructure/torrent/torrent.go#L142))
- `buildElevationScript(ps1Path, psExe)` (em `fat32Format.ts`) → o `Start-Process … -Verb RunAs`
  **aninhado** recebe o interpretador já resolvido pelo pai, em vez de repetir a busca por conta
  própria; pai e filho elevado são sempre o mesmo PowerShell
- `isExecutableNotFound()` / `powerShellMissingMessage()` → traduzem o ENOENT residual

Fora do Windows, ou quando nem o PATH nem o `System32` têm o arquivo, as funções devolvem o
nome simples de antes: um Windows sem PowerShell degrada como degradava, e não numa falha em
caminho inventado.

**A ordem mudou depois da correção original.** A v2.12.76 fixou `System32` primeiro; a
v2.12.78 inverteu, a pedido, para o `%PATH%` continuar autoritativo. O que resolve o bug é o
*fallback* existir — em qualquer ordem, um PATH quebrado deixa de ser fatal. A inversão tem um
custo registrado: com o PATH na frente, um `powershell.exe` plantado numa pasta anterior da
lista roda no nosso lugar, inclusive no caminho elevado. Detalhes na entrada 2.12.78 do
`CHANGELOG.md`.

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

## Por que só soubemos por uma foto (resolvido na v2.12.77)

A telemetria só dispara em `uncaughtException` / `unhandledRejection`
([`bootstrap.ts:25,55`](../../../src/electron-app/app/bootstrap.ts#L25)) e no `window.onerror`
do renderer. Esta falha é capturada pelo `try/catch` do handler e devolvida como
`{ ok:false }` — comportamento correto, e exatamente por isso ela nunca chegou ao painel de
erros. Não havia log, versão, nem build do Windows: só a foto do monitor.

Na v2.12.77 o `catch` de `tools:badavatar-list-drives` passou a chamar `reportError`, e
`describeWindowsExecutableEnvironment()` anexa a linha que decide entre as hipóteses:

```
arch=x64 systemRoot=C:\WINDOWS powershellNoDisco=true pathTemSystem32=false
pathTemWindowsPowerShell=false pathEntradas=2 pathChars=37 path=C:\NaoExiste;…
```

| Campo | O que responde |
|---|---|
| `powershellNoDisco=false` | Windows "debloatado" — o arquivo sumiu; PATH nenhum resolve |
| `pathTemWindowsPowerShell=false` com `powershellNoDisco=true` | **a assinatura deste bug**: arquivo lá, PATH sem a pasta |
| `pathChars` perto de 1024 ou 2047 | truncamento (`setx`, diálogo antigo) em vez de edição manual |
| `arch=ia32` | build 32-bit sobre Windows 64-bit, onde `System32` é redirecionado para `SysWOW64` |

O PATH vai com a pasta do perfil mascarada (`%USERPROFILE%`) — o nome da conta do Windows
costuma ser o nome real da pessoa, e o log inteiro é anexado a todo reporte.

## O que continua aberto

A causa **na máquina do usuário** — PATH quebrado ou Windows modificado — não foi
diagnosticada; o app apenas deixou de depender dela. O próximo caso chega com a linha de
diagnóstico acima, mas o usuário do print (Windows 10) usa uma build anterior à v2.12.77 e
não vai reportar retroativamente: para esse, o caminho continua sendo o log local em
`%APPDATA%\Xbox 360 Companion\logs\`.

Se o `powershell.exe` tiver sido removido de fato, o sintoma vira a nova mensagem
explicativa, e aí a enumeração de USB precisará de um caminho sem PowerShell — hoje não
existe: a política de segurança do dispositivo depende de `Get-Disk`/`Get-Volume`.
