# Bug: HD externo USB (`Fixed`) sem pendrive na máquina falha em `tools:badavatar-list-drives` com "O Windows ainda está reconhecendo..." na v2.12.128

- **Detectado em:** 2026-11-12 20:35 (sessão WhatsApp `556999793860`, sem chamado formal em `wpp_support_ticket`)
- **Origem:** conversa de suporte + telemetria (`13677`, `13720`, `13721`) + leitura de `src/electron-app/infrastructure/windowsUsbDeviceService.ts` (`enumerateSafeWindowsUsbDevices`, `recoverNativeListing`, `enumerationTimeout`, `explainSlowEnumeration`), `src/electron-app/services/badAvatarUsbService.ts` (`listWindowsUsbDrivesOnVolumeChange`, `listFat32UsbDrives`) e `src/electron-app/ipc/badAvatarHandlers.ts` (`tools:badavatar-list-drives`)
- **Errors (serviço):** `13677` (`2026-11-12T00:58:27`), `13720` (`2026-11-12T22:51:59`), `13721` (`2026-11-12T23:00:04`) — todos `ElectronApp v2.12.128`, `hostname: DESKTOP-H1NAROL`, `method: tools:badavatar-list-drives`
- **Classe:** falha funcional
- **Severidade:** P1 - Alto — bloqueia totalmente a listagem/seleção do HD externo USB na tela **BadAvatar USB** na versão atual (`v2.12.128`), mesmo com o HD montado e legível no Explorer
- **Complexidade:** alta — `windowsUsbDeviceService.ts`, `badAvatarUsbService.ts` e `badAvatarHandlers.ts` (enumeração e detecção de dispositivos USB no Windows)
- **Reincidência:** primeira vez deste defeito específico; relacionado a [[electron-main-powershell-lento-estoura-prazo-fixo-da-enumeracao-usb-e-preparo-falha-com-pendrive-presente_2026-10-07T20-40]] (`retest/`) e [[badavatar-lista-de-dispositivos-mostra-so-o-pendrive-e-omite-o-hd-externo_2026-10-09T00-00]] (`retest/`)

## Sintoma, na ordem que o cliente viveu

Cliente comprou o acesso em `2026-11-11 22:42:49 UTC` (`[176726]`), recebeu e baixou `https://versions.digitalstoregames.com/xboxcompanion.exe` às `23:08:20 UTC` (`[176759]`, já na `v2.12.128`, publicada em `2026-11-10`). Conseguiu baixar um jogo (`Modern Warfare - 415607E6`) e iniciou `GTA 5` em `E:\` (`BADAVATAR`, HD externo de 931 GB). Ao reabrir o aplicativo depois e entrar em **Gravar em um Pendrive ou HD**, a tela **Prepare seu pendrive ou HD** passou a exibir a faixa âmbar:

> *"O Windows ainda está reconhecendo seu pendrive ou HD. Aguarde alguns instantes e clique no botão 'Atualizar'. (Dica: se não aparecer após alguns segundos, experimente reconectar em outra porta USB)."*

Mesmo após fechar pelo tray (`Quit`), reabrir e baixar novamente o executável atualizado pelo link oficial (`xboxcompanion (1).exe`), a lista continuou falhando com a mesma mensagem enquanto o Explorador de Arquivos já mostrava `BADAVATAR (E:)` normalmente com as pastas `Aurora`, `Content`, `Games` e `xbox-downloader`.

## Evidência

1. **Conversa de suporte (`Wpp_proccess`, `lid=556999793860`):**
   - `[178633]` (`2026-11-12T23:03:45Z`) e `[178650]` (`2026-11-12T23:07:28Z`): prints da tela *"Prepare seu pendrive ou HD"* com *"O Windows ainda está reconhecendo seu pendrive ou HD..."*.
   - `[178644]` (`2026-11-12T23:05:46Z`): cliente manda foto do Explorador mostrando `BADAVATAR (E:)` aberto e legível (*"Aparece isso"*).
2. **Telemetria (`errors` + `error_logs` em `DESKTOP-H1NAROL`, `ElectronApp v2.12.128`):**
   - `error_id=13677` (`2026-11-12T00:58:27Z`, `pid=16748`):
     - `APP_UPDATE Check result: current=2.12.128, latest=2.12.128, updateAvailable=false`
     - `APP_USB powershell (enumeracao nativa) respondeu em 3955 ms (prazo 5000 ms)`
     - `APP_USB powershell (enumeracao fisica) excedeu o prazo de 12000 ms`
     - `APP_USB enumeracao fisica excedeu o tempo; tentando novamente pela enumeracao nativa`
     - `APP_USB falha ao listar unidades: O Windows ainda está reconhecendo seu pendrive ou HD...`
   - `error_id=13721` (mesmo log contínuo contendo `pid=10260`, `pid=10312` de `13720` e `pid=7868` de `13721`):
     - Em `pid=10260` (`19:14:07Z`), `powershell (enumeracao fisica) respondeu em 7131 ms`, elevando temporariamente o prazo físico para `21393 ms` (`3 × 7131`) e depois `15624 ms` (`19:14:32Z`, `5208 ms`). Mais tarde, após novas chamadas nativas `< 4000 ms` expulsarem as amostras lentas da janela de 5 amostras (`RECENT_DURATION_SAMPLES = 5`), o prazo caiu de `21393 ms` (`21:47:00Z`) para `15624 ms` (`21:47:25Z`) e voltou ao piso de `12000 ms` (`21:47:59Z`).
     - Em `pid=10312` (`22:51:54Z` até `22:59:28Z`, vários retries) e em `pid=7868` (`22:59:59Z`), cada nova instância começou sem histórico em RAM (`12000 ms`), estourou `enumeracao fisica` em `12000 ms`, tentou `recoverNativeListing`, retornou `falha ao listar unidades` em ~1,5 s depois (`22:51:55.662Z`, `23:00:00.713Z`) e propagou o erro à UI — ao mesmo tempo em que `APP_BROWSE varredura de jogos instalados: 1 jogo(s)` lia `E:\` normalmente.

## Causa raiz

Quatro pontos combinados, confirmados no código atual (`src/electron-app`):

1. **Recuperação nativa cega para HD externo USB (`DriveType = Fixed`):**
   - Em `windowsUsbDeviceService.ts` (`ENUMERATE_REMOVABLE_SCRIPT` / `parseNativeOutput`, L575), discos `Fixed` fora do `SystemDrive` geram apenas `{ FixedDriveMarker: true }` e são filtrados em `parseNativeOutput`: `rows.filter((row) => !isFixedDriveMarker(row))`.
   - Sem pendrive `Removable` conectado, `removable.length === 0`, então `enumerateSafeWindowsUsbDevices` cai obrigatoriamente em `ENUMERATE_USB_SCRIPT` (`enumeracao fisica`, L665-685).
   - Quando `enumeracao fisica` dá `USB_ENUMERATION_TIMEOUT`, L681 chama `recoverNativeListing("enumeracao fisica excedeu o tempo")`, que re-executa **somente** `ENUMERATE_REMOVABLE_SCRIPT` (L628-633) — que nunca retorna um HD `Fixed` (`[]`), fazendo `recoverNativeListing` devolver `null` e relançar `USB_ENUMERATION_TIMEOUT`.
2. **Prazo adaptativo não persiste entre sessões e é expulso por chamadas rápidas da nativa:**
   - `recentPowerShellDurationsMs` (`windowsUsbDeviceService.ts:26,29,190-193`) fica apenas em memória, compartilha uma única janela de 5 amostras (`RECENT_DURATION_SAMPLES = 5`) entre `enumeracao nativa` (Win32 rápido) e `enumeracao fisica` (Storage Management `Get-Disk`), e ignora timeouts (`Only successes are measured`). Na primeira execução fria (`13677`, `13720`, `13721`), `enumeracao fisica` sempre começa em `USB_ENUMERATION_TIMEOUT_MS = 12_000`, insuficiente nessa máquina quando Storage Management passa de 12 s; e, durante a sessão (`pid=10260`), 5 enumerações nativas < 4 s expulsam a medição física anterior (> 7 s), devolvendo a física ao teto de `12_000 ms`.
3. **Sem cache prévio na abertura, o erro cru substitui o texto específico:**
   - Em `badAvatarUsbService.ts::listWindowsUsbDrivesOnVolumeChange` (L472-481), `usbListLastGood` começa `null` no processo novo; a falha na abertura do diálogo é relançada direto à UI.
   - Em `badAvatarHandlers.ts::tools:badavatar-list-drives` (L35-63), o `catch` não passa o erro por `explainSlowEnumeration` (que hoje só é chamada em `requireSafeWindowsUsbTarget` e `waitForFormattedDevice`, e exige uma `rootPath` específica), mantendo a orientação enganosa *"reconectar em outra porta USB"* mesmo com a unidade montada.

## Escopo — o que NÃO é este bug

- **Não é falha do fix de [[electron-main-powershell-lento-estoura-prazo-fixo-da-enumeracao-usb-e-preparo-falha-com-pendrive-presente_2026-10-07T20-40]]:** aquele doc tratava de `requireSafeWindowsUsbTarget` falhando no **preparo** com um **pendrive `Removable` já listado** na tela; neste caso a falha acontece na listagem inicial (`tools:badavatar-list-drives`) com **HD externo `Fixed` sem pendrive**, caminho onde `recoverNativeListing` não alcança o dispositivo e o prazo inicial/evicto continua em `12_000 ms`.
- **Não é o cliente em versão desatualizada:** a versão instalada (`v2.12.128`) era a mesma publicada no `version.json` no momento da sessão (`APP_UPDATE Check result: current=2.12.128, latest=2.12.128, updateAvailable=false`).

## Tarefas propostas / Próximos passos

1. Separar o histórico de duração de PowerShell por tipo de script (ou por `label`: nativa vs física `Get-Disk`) e considerar prazo inicial ou escalonamento após timeout na física até `ENUMERATION_TIMEOUT_CEILING_MS` (30 s) — sem poluir a nativa nem esperar que uma física bem-sucedida ocorra antes do primeiro timeout em máquina fria.
2. Quando `enumeracao fisica` falhar por timeout com marcador `FixedDriveMarker` ativo (ou na recuperação após timeout físico), tentar segunda chamada física com prazo estendido (até 30 s) em vez de chamar `recoverNativeListing` nativa que não detecta `Fixed`.
3. Em `tools:badavatar-list-drives` / `listFat32UsbDrives`, detectar se há unidade não-sistema `Fixed` respondendo ou aplicar variante de `explainSlowEnumeration` quando o computador já montou unidades elegíveis mas a enumeração estourou o tempo.


## Análise da correção (2026-11-12)

### Símbolos abertos

- `windowsUsbDeviceService.ts::enumerateSafeWindowsUsbDevices` — nativa (prazo `enumerationTimeout(5000)`); com `removable.length > 0` vai a `finishNative`; senão cai na física com `enumerationTimeout(12000)`. Em timeout da física chama `recoverNativeListing`, que só devolve algo se a nativa achar `Removable` (L634) — com só HD `Fixed` devolve `null` e a física relança `USB_ENUMERATION_TIMEOUT` (L684). Confirmado: a recuperação nunca alcança o HD.
- `parseNativeOutput` — liga `fixedDriveMounted` quando há marcador; só roda em nativa **bem-sucedida**, então `fixedDriveMounted === true` no ponto da física significa "a nativa respondeu, não há pendrive e há um `Fixed` não-sistema montado".
- `runPowerShell` — `recentPowerShellDurationsMs` é uma janela única de 5 (L190-193), alimentada por todo label com `learnDuration` (nativa, física, layout, diagnóstico de integridade). Em erro/timeout não aprende.
- `enumerationTimeoutFor` — pura, `max(base, min(30000, slowest × 3))`; testada em `tests/unit/powershellSlowMachine.test.cjs`.
- `explainSlowEnumeration(error, rootPath)` — se for timeout e `stat(root)` responder, troca pela mensagem "está conectado... não é preciso trocar de porta"; senão devolve o erro intacto.
- `readWindowsUsbDiskLayout` — física com `enumerationTimeout(12000)`; também sofre a expulsão da amostra lenta pela nativa (o gate de layout do preparo).
- `badAvatarUsbService.ts::listWindowsUsbDrivesOnVolumeChange` — sem `usbListLastGood` relança o erro; `badAvatarHandlers.ts::tools:badavatar-list-drives` devolve `err.message` cru à UI. O renderer (`BadAvatarUsbPage.tsx::refreshDrives`) não tem prazo próprio — espera o IPC o tempo que for.

### Hipóteses descartadas

- **Tentar a física de novo após o timeout (tarefa 2 original):** custa 12 s jogados fora + a segunda tentativa; dar o prazo longo já na primeira chamada é estritamente melhor no caso lento e custa o mesmo no travamento real.
- **Persistir o histórico em disco (tarefa 1 original, parte "persistir"):** o prazo longo no caminho só-física já resolve a máquina fria; persistência é estado a mais sem ganho para o sintoma.
- **Mudar o handler `tools:badavatar-list-drives`:** desnecessário se o erro já sair explicado de `enumerateSafeWindowsUsbDevices` (as raízes dos marcadores estão lá; a camada do handler não sabe qual letra testar).

### Tarefas

1. `enumerateSafeWindowsUsbDevices`: quando a física é o único caminho (nativa respondeu, sem pendrive, com marcador `Fixed`), prazo `ENUMERATION_TIMEOUT_CEILING_MS` (30 s) em vez de 12 s; em timeout ali, **não** chamar `recoverNativeListing` (cega para `Fixed`) e lançar `explainSlowEnumeration(error, <raiz do marcador>)`. Teste: nativa só com marcador, física leva 13 s → lista o HD; física travada → erro "está conectado", sem 2ª nativa.
2. `runPowerShell`/`enumerationTimeout`: janela de 5 amostras **por label** (Map), prazo = mais lenta entre todas as janelas — a física não é mais expulsa por 5 nativas rápidas. Teste: física 4,5 s → 5 nativas rápidas → `readWindowsUsbDiskLayout` com física de 12,5 s responde (antes estourava em 12 s).
3. Limitação aceita: com só um `D:` interno e nenhum USB, um travamento real da física leva 30 s (antes ~17 s) e a mensagem diz "está conectado".

## Correção (2.12.129)

- `windowsUsbDeviceService.ts::enumerateSafeWindowsUsbDevices` — `fixedDriveMounted` virou `fixedDriveRoots` (raízes dos marcadores); com marcador presente no ponto da física (`onlyPhysicalCanList`) o prazo é `ENUMERATION_TIMEOUT_CEILING_MS`, e a falha lança `explainSlowEnumeration(error, fixedDriveRoots[0])` sem passar por `recoverNativeListing`.
- `runPowerShell` / `enumerationTimeout` — `recentPowerShellDurationsMs` virou `Map<label, number[]>` (5 amostras por label); o prazo usa a mais lenta entre todas as janelas.
- `AGENTS.md` (linha do `windowsUsbDeviceService.ts`) e `CHANGELOG.md` atualizados.
- **Testes:** `src/electron-app/tests/unit/usbFixedOnlyPhysicalDeadline.test.cjs` — 3 testes, vermelhos contra o `.ts` do HEAD (transpilado à parte: `12000 !== 30000`, física estourando em 12000 ms, layout `null`), verdes agora; suíte USB (`usbFixedDriveMerge`, `powershellSlowMachine`, `usbDriveListCache`, `loopAwareTimeout`, `preparationRevalidationInterval`, `badAvatarHandlers`) 25/25.
- **Falta:** publicar a 2.12.129 e o cliente `DESKTOP-H1NAROL` (`556999793860`) confirmar que o HD aparece na lista.
- **Fora deste bug (não tocado):** com pendrive **e** HD, a "enumeracao fisica de HD USB" em `finishNative` continua com prazo adaptativo de 12 s e, se estourar, omite o HD em silêncio — mesmo mecanismo, caminho do bug `badavatar-lista-de-dispositivos-mostra-so-o-pendrive-e-omite-o-hd-externo` (`retest/`).
