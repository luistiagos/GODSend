# Bug: em PC lento o PowerShell passa do prazo fixo da enumeração USB e o preparo do pendrive/HD falha com "O Windows ainda está reconhecendo seu pendrive ou HD", com o dispositivo listado e liberado

- **Detectado em:** 2026-10-07 20:40 (foto da tela enviada pelo dono + telemetria `9526`–`9530`)
- **Origem:** foto da tela BadAvatar (caixa vermelha com barra em ~12% abaixo de "Preparar pendrive/HD") + logs anexos dos reports `9527`, `9528`, `9529`, `9530` + leitura de `infrastructure/windowsUsbDeviceService.ts` (`runPowerShell`, `enumerateSafeWindowsUsbDevices`, `requireSafeWindowsUsbTarget`, `annotateRemovableHealth`), `services/badAvatarUsbService.ts` (`listFat32UsbDrives`, `listWindowsUsbDrivesOnVolumeChange`), `services/fixedBadAvatarPreparationService.ts` (`prepareFixedBadAvatarDevice`, `waitForFormattedDevice`, `createThrottledUsbTargetRevalidator`) e `renderer/components/BadAvatarUsbPage.tsx` (`handlePrepare`, `refreshDrives`)
- **Classe:** falha funcional (o preparo não anda) + mensagem que culpa o dispositivo errado
- **Severidade:** **P1 — Alto**: o preparo é a porta de entrada do produto e falha com o pendrive presente; reproduzido em 4 máquinas distintas em 2 dias, 2 delas já na 2.12.107
- **Versões:** visto na **2.12.107** (já com a correção da varredura síncrona, `9258bfe`/`426d4ff`/`91d20dc`) e na 2.12.106/2.12.97
- **Reincidência:** mesma **mensagem** de [`electron-main-varredura-sincrona-...`](electron-main-varredura-sincrona-de-jogos-instalados-congela-a-janela-e-gera-falso-timeout-de-usb_2026-10-05T17-25.md) e de [`closed/enumeracao-usb-timeout-...`](../closed/enumeracao-usb-timeout-e-dispositivo-mudou-desde-a-selecao_2026-09-08T00-00.md); **causa diferente** — aqui o loop de eventos NÃO está bloqueado, o PowerShell é que é lento de verdade

## Sintoma

Foto do cliente: BadAvatar, requisitos marcados, botão **"Preparar pendrive/HD"** habilitado (logo
o dispositivo foi listado e `safety.allowed === true`), e abaixo a caixa vermelha com a barra em
~12% e *"O Windows ainda está reconhecendo seu pendrive ou HD. Aguarde alguns instantes e clique
no botão 'Atualizar'..."*. O pendrive aparece no Windows.

A caixa vermelha com barra é a de `BadAvatarUsbPage.tsx::handlePrepare` (`setError` no `catch` de
`toolsBadAvatarPrepare`), não a de `refreshDrives` (`setLoadError`). Ou seja: **falhou o preparo**,
não a listagem.

## Evidência

### 1. Máquinas e versões (reports abertos com essa mensagem)

| report | versão | host | timeouts no log | listagens com unidade |
|---|---|---|---|---|
| `9530` | 2.12.107 | `DESKTOP-1HAMO38` | 16 | 9 |
| `9528` | 2.12.107 | `DESKTOP-1HAMO38` | 2 | 0 |
| `9527` | 2.12.107 | `DESKTOP-I631120` | 2 | 0 |
| `9529` | 2.12.106 | `DESKTOP-9H7UCVJ` | 307 | 17 |
| `9507` | 2.12.106 | `DESKTOP-9H7UCVJ` | 204 | 11 |
| `9458` | 2.12.106 | `DESKTOP-J8MNV7C` | 2 | 0 |

Comando: `python C:\Windows\Temp\triagem\telemetria.py logs <id>` e
`grep -a -c "excedeu o tempo\|fisica falhou"` / `grep -a -c "encontrou [1-9]"` em cada log.

### 2. O loop de eventos está livre — não é o bug da varredura síncrona

No `9530` (2.12.107, `pid=7832`), durante os timeouts as linhas `BACKEND_OUT` continuam chegando
normalmente e, depois que a lista sai, `lista enviada à interface` sai a cada 5 s cravados, sem
lacuna. A varredura de jogos loga `0 pasta(s) analisada(s)` em 25 931 ms — o tempo é só a espera
pela enumeração (5 + 0,75 + 7 + 12 s ≈ 25 s), não disco.

### 3. O PowerShell dessa máquina leva 5–8 s; os prazos são 3/5/7/12 s

Sequência típica no `9530` (UTC):

```
19:27:21.093 enumeracao nativa falhou (5 s)
19:27:28.938 recuperacao por enumeracao nativa falhou (0,75 + 7 s)
19:27:41.018 enumeracao fisica falhou (12 s)
19:27:41.021 falha ao listar unidades
... repete a cada ~25 s até ...
19:30:06.729 diagnostico de integridade indisponivel   (Get-Volume, 3 s — falha SEMPRE)
19:30:06.730 enumeracao nativa recuperada encontrou 1 unidade(s): D:\   (passou dentro dos 7 s)
19:38:38.521 enumeracao nativa falhou
19:38:46.413 enumeracao fisica encontrou 1 unidade(s): D:\     (~8 s, dentro dos 12 s)
```

O probe de integridade é só `Get-Volume` com prazo de 3 s e estoura **todas** as vezes; a nativa
às vezes passa nos 7 s da recuperação e nunca nos 5 s da primeira tentativa. A mesma máquina leva
15 s entre `app ready` e iniciar o backend. É PC lento (ou antivírus inspecionando cada
`powershell.exe`/`csc.exe`), não USB.

Medido nesta máquina de desenvolvimento, para comparação (4 execuções cada, `powershell.exe -File`):

```
script vazio           374/334/347/338 ms
só Add-Type            536/432/432/426 ms
ENUMERATE_REMOVABLE    515/515/688/542 ms
```

Na máquina do cliente a mesma coisa passa de 5 s: ~10× mais lenta. `Add-Type` custa +100–200 ms
aqui (compila C# com `csc.exe` a cada chamada); em máquina lenta com antivírus é candidato a ser o
maior pedaço — **não medido lá**.

### 4. Por que a lista aparece e o preparo falha

- **Lista** (`listFat32UsbDrives` → `enumerateSafeWindowsUsbDevices(true)`): tem a recuperação
  nativa de 7 s e, quando tudo falha, `listWindowsUsbDrivesOnVolumeChange` devolve
  `usbListLastGood` ("mantendo a ultima lista confiavel"). Uma vez listada, a unidade fica na tela.
- **Preparo** (`prepareFixedBadAvatarDevice`): chama `requireSafeWindowsUsbTarget` (linha 414, de
  novo na 519, e a cada 10 s em `createThrottledUsbTargetRevalidator`) e, com "Formatar antes",
  `waitForFormattedDevice` (20 tentativas). Todos usam `enumerateSafeWindowsUsbDevices()` com
  `includeHealth = false`, e `recoverNativeListing` retorna `null` logo na primeira linha quando
  `!includeHealth`. Então o preparo tem só **nativa 5 s → física 12 s → lança** o timeout. Sem
  recuperação e sem última lista confiável — corretamente, porque é checagem de segurança, mas
  aí precisa de prazo que caiba na máquina.
- Barra em ~12% na foto: coerente com falha depois da formatação (`formatVolumeFat32` limita o
  progresso a 12%, segue `waitForFormattedDevice`), mas não dá para afirmar só pela foto. O log não
  diz: o preparo não loga nem reporta a falha — é o bug aberto
  [`electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28.md`](electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28.md).
- Durante o preparo a tela continua pedindo a lista (polling) e o contador de jogos também: em
  máquina lenta, mais `powershell.exe` concorrentes deixam cada um mais lento. No `9529` há linhas
  `enumeracao nativa falhou` e `enumeracao fisica falhou` intercaladas de duas enumerações ao mesmo
  tempo (19:57:40 / 19:57:42 / 19:57:45).

### 5. A mensagem manda o cliente fazer a coisa errada

"O Windows ainda está reconhecendo seu pendrive ou HD... reconecte em outra porta USB" — o Windows
já reconheceu (a unidade está no Explorer e na lista do app). O cliente troca de porta, reconecta,
e nada muda, porque o gargalo é o PowerShell.

## Causa raiz

Prazos fixos de `runPowerShell` (3/5/7/12 s) calibrados em máquina rápida (~0,5 s por script),
aplicados a máquinas em que um `powershell.exe` leva 5–8 s. Na listagem isso é mascarado pela
recuperação e pela última lista confiável; no preparo, que só tem nativa 5 s + física 12 s, vira
falha dura com a unidade presente. A mensagem atribui ao USB um atraso que é do PowerShell.

## Hipóteses descartadas

- **Loop de eventos bloqueado (bug da varredura síncrona):** descartado pelo log da 2.12.107 —
  sem lacunas, `BACKEND_OUT` fluindo durante os timeouts, varredura com 0 pastas.
- **Storage Management travado (motivo da enumeração nativa existir):** não explica a nativa
  (`DriveInfo` + `mountvol`, sem Storage Management) estourar 5 s, nem ela passar em 7 s logo em
  seguida. A física (Get-Disk) também passa às vezes em ~8 s.
- **USB/porta/dispositivo:** a unidade aparece `D:\:permitida` e o Explorer a vê; a falha
  acontece também com a unidade parada.
- **Várias instâncias do app competindo:** um `pid` por sessão nos logs.

## O que deve ser feito (não implementado)

- **T1 — prazo do preparo que caiba na máquina.** Em `requireSafeWindowsUsbTarget` /
  `enumerateSafeWindowsUsbDevices(false)`, quando a primeira nativa estoura, tentar de novo a
  nativa com prazo maior (como `recoverNativeListing`, mas sem o probe de integridade) antes de cair
  na física; ou prazo adaptativo: medir a duração da última enumeração bem-sucedida e usar
  `max(prazo atual, 3 × última duração)`, com teto. Prova: teste unitário com `powershell` falso que
  responde em 6 s — hoje lança, depois resolve; controle: filho que nunca responde continua
  expirando no teto.
- **T2 — tirar o `Add-Type` do caminho quente.** O único uso é `GetDiskFreeSpace` para
  `allocationUnitBytes`; o Node já entrega isso em `fs.promises.statfs(root).bsize` (libuv usa
  `GetDiskFreeSpaceW`: `bsize = bytesPerSector × sectorsPerCluster` — **conferir na fonte do libuv
  antes de usar**). Sem `Add-Type`, não há `csc.exe` por chamada. Prova: medir na máquina de dev
  (antes ~540 ms, esperado ~350 ms) e teste de que `allocationUnitBytes` continua igual ao de hoje
  num pendrive FAT32 real. O fingerprint (`deviceSafetyPolicy.ts::createDeviceFingerprint`) **não**
  usa `allocationUnitBytes` (conferido: disco, partição, ids, volumeGuid, fabricante, nome, bus,
  tamanho, raiz) — trocar a fonte não invalida seleções; o valor só alimenta `assessWriteCapacity`.
- **T3 — não enumerar em paralelo ao preparo.** Enquanto `preparationInProgress`, o polling da
  lista (`tools:badavatar-list-drives`) e o contador de jogos devolvem o cache/última lista sem
  abrir `powershell.exe`. Prova: teste de que, com preparo em curso, o handler da lista não chama
  `enumerateSafeWindowsUsbDevices`.
- **T4 — mensagem honesta.** Distinguir "PowerShell lento" de "dispositivo ainda montando": se a
  letra existe (`fs.promises.stat(root)` responde) e o script estourou, dizer que o computador está
  demorando para responder e que o app vai tentar de novo, sem mandar trocar de porta.
- **T5 — depende do bug de telemetria do preparo:** com a falha do preparo reportada (bug de
  2026-10-04), passar a logar a etapa/percentual em que o preparo caiu, para confirmar o ~12% da foto.

## O que falta medir

- Quanto do tempo na máquina do cliente é `Add-Type`/`csc.exe` vs. partida do `powershell.exe`.
  Uma linha de log com a duração de cada `runPowerShell` (sucesso ou não) responde isso no próximo
  report.
- Alcance real: os 19+ reports abertos dessa mensagem nas versões 2.12.10x precisam ser separados
  entre "loop bloqueado" (lacunas no log, bug de 2026-10-05) e "PowerShell lento" (este).

## Correção planejada (2026-10-07, antes de editar código)

### Conferido nesta passada

- `windowsUsbDeviceService.ts::recoverNativeListing` — a primeira linha é
  `if (!includeHealth || nativeRecoveryAttempted) return null`. O `!includeHealth` não protege
  nada do caminho de revalidação: `finishRemovableEnumeration(…, includeHealth)` já pula o probe
  `Get-Volume` quando `includeHealth` é falso. `git log -S` aponta só para `c859f97` (mensagem `*`),
  sem motivo registrado. Tirar o `!includeHealth` dá ao preparo a mesma 2ª tentativa nativa da lista.
- `runPowerShell` — prazo fixo recebido do chamador; em timeout mata o filho e rejeita com
  `code = USB_ENUMERATION_TIMEOUT`; não registra duração de nada (por isso o log não diz quanto o
  PowerShell levou).
- `requireSafeWindowsUsbTarget` — conhece a raiz; a enumeração lança o timeout sem tratar, e é essa
  mensagem que chega à caixa vermelha (`BadAvatarUsbPage.tsx::handlePrepare` → `setError`).
  `waitForFormattedDevice` guarda o último erro de 20 tentativas e lança o mesmo texto.
- `renderer/components/BadAvatarUsbPage.tsx:481` usa `/reconhecendo|atualizar/i` só para a cor do
  `loadError` da **lista**; o erro do preparo (`error`) não depende do texto.
- `deviceSafetyPolicy.ts::createDeviceFingerprint` — confirmado: não usa `allocationUnitBytes`.
  `writeCapacityPolicy.ts::validateStorageInfo` bloqueia `allocationUnitBytes` < 512, e
  `assessWriteCapacity` cai para 32 KiB nesse caso — então o valor importa e não pode virar 0.
- **libuv v1.52.1** (a do Node 24.19 / Electron 42), `src/win/fs.c::fs__statfs`:
  `f_bsize = SectorsPerAllocationUnit * BytesPerSector` de `FileFsFullSizeInformation` — o mesmo
  cluster que `GetDiskFreeSpace` devolve. Medido aqui (`scratchpad/compare-cluster.js`): C:\ e D:\
  NTFS, `GetDiskFreeSpace=4096`, `statfs.bsize=4096`, iguais. Não há pendrive FAT32 nesta máquina.
- `badAvatarUsbService.ts::listWindowsUsbDrivesOnVolumeChange` — `usbListLastGood` guarda a última
  lista que veio de enumeração bem-sucedida; `tests/unit/usbDriveListCache.test.cjs` já simula
  `enumerateSafeWindowsUsbDevices` por `t.mock.method` no objeto do módulo.
- `ipc/badAvatarHandlers.ts` — `preparationInProgress` é local ao handler; a lista e o contador de
  jogos (`localGameScannerService.ts:733`) não sabem dele.

### Tasks

- **T1 — prazos que acompanham a máquina** (`windowsUsbDeviceService.ts`). `runPowerShell` mede cada
  execução bem-sucedida e guarda as 5 últimas; as enumerações (nativa, recuperação, física e a
  revalidação de `requireSafeWindowsUsbTarget`) usam `max(prazo base, 3 × a mais lenta recente)`, com
  teto de 30 s. O probe de integridade (best-effort, 3 s) e a ejeção ficam fixos: esperar mais por
  eles atrasaria a lista sem proteger nada. `recoverNativeListing` vale também sem `includeHealth`
  (o preparo ganha a 2ª tentativa nativa) e o prazo da recuperação sobe de 7 para 12 s (a nativa
  levou 5–8 s no `9530`). Só sucesso alimenta a medida: timeout pode ser travamento de verdade.
  Prova: `tests/unit/powershellSlowMachine.test.cjs` com `child_process.spawn` substituído por um
  `node` que responde como o PowerShell lento — (a) nativa em 6 s e física que não responde:
  `requireSafeWindowsUsbTarget` resolve (hoje lança); (b) depois de um sucesso de 6 s o prazo da
  nativa passa de 5 s; (c) controle: filho que nunca responde continua expirando, no teto.
- **T2 — sem `Add-Type`** no `ENUMERATE_REMOVABLE_SCRIPT`; `allocationUnitBytes` = 0 vindo do
  script é preenchido em TS com `fs.promises.statfs(root).bsize`. Prova: tempo do script antes/depois
  nesta máquina; teste de que a linha nativa sai com o `bsize` do `statfs`.
- **T3 — sem enumeração concorrente ao preparo**: `setUsbPreparationActive()` em
  `badAvatarUsbService.ts`, ligado/desligado pelo handler `tools:badavatar-prepare`; com preparo em
  curso e uma última lista confiável, `listFat32UsbDrives` a devolve sem abrir `powershell.exe`.
  Prova: caso novo em `usbDriveListCache.test.cjs` contando as enumerações.
- **T4 — mensagem honesta**: no preparo (`requireSafeWindowsUsbTarget`, `waitForFormattedDevice`),
  timeout de enumeração com a letra respondendo a `fs.promises.stat(root)` vira "o pendrive está
  conectado, mas o computador está demorando para responder… não precisa trocar de porta… clique em
  'Preparar pendrive/HD' de novo". Sem a letra, mantém a mensagem atual. Prova: teste unitário.
- **T5** continua dependente do bug de telemetria do preparo (fora desta correção). A linha de log
  com a duração de cada PowerShell lento (≥ 2 s) e de cada prazo estourado entra no T1 e responde o
  "O que falta medir".

## Correção aplicada (2.12.108, 2026-10-07)

T1–T4 implementadas como planejado, sem desvio. Símbolos novos/alterados:

- `windowsUsbDeviceService.ts`: `enumerationTimeoutFor()` (exportada, pura) / `enumerationTimeout()`;
  `runPowerShell(script, timeoutMs, label, learnDuration = true)` mede sucesso, guarda as 5 últimas
  durações e loga `powershell (<label>) respondeu em N ms` (≥ 2 s) e `excedeu o prazo de N ms`;
  `recoverNativeListing` sem `!includeHealth`; `REMOVABLE_RECOVERY_TIMEOUT_MS` 7 → 12 s;
  `ENUMERATE_REMOVABLE_SCRIPT` sem `Add-Type`; `fillAllocationUnits()` (statfs) em todas as linhas
  com cluster 0, inclusive em `revalidateWithScript`; `explainSlowEnumeration()` (exportada) usada
  em `requireSafeWindowsUsbTarget`. Probe de integridade e ejeção com prazo fixo (ejeção não alimenta
  a medida).
- `fixedBadAvatarPreparationService.ts::waitForFormattedDevice` — último erro passa por
  `explainSlowEnumeration`.
- `badAvatarUsbService.ts::setUsbPreparationActive` + curto-circuito no início de
  `listWindowsUsbDrivesOnVolumeChange`; ligado/desligado em `ipc/badAvatarHandlers.ts`
  (`tools:badavatar-prepare`, no `try`/`finally`).

### Provas

- `node --test tests/unit/powershellSlowMachine.test.cjs` contra o código **anterior**: falha em
  17 074 ms com `O Windows ainda está reconhecendo...` (`timeoutMs: 12000`) — a foto do cliente.
  Com a correção: verde em 18,2 s (nativa 6 s → 2ª tentativa; depois revalidação numa tentativa só).
- Mutações no JS compilado, uma por vez, cada uma derruba o seu teste: devolver o `!includeHealth`
  (falha em 17 s), prazo fixo em `enumerationTimeout` (falha: duas tentativas), sem
  `fillAllocationUnits` (falha: cluster 0), sem o curto-circuito do preparo
  (`usbDriveListCache.test.cjs` falha: enumerou durante o preparo).
- `npm run test:safety` (tsc + typecheck do renderer + unitários): **255/255**.
- Script nativo, `powershell.exe -File`, 3 rodadas intercaladas de 5 nesta máquina: antes (com
  `Add-Type`) medianas 790/775/753 ms; depois 563/419/479 ms.
- `electron tests/electron/usb-enumeration-smoke.cjs` (Electron 42, PowerShell real): termina com
  `[]` e saída 0. **Sem pendrive nesta máquina** (C:\ e D:\ fixos; VHD não aparece como removível),
  então o caminho com dispositivo real e a igualdade `statfs.bsize` × `GetDiskFreeSpace` num FAT32
  ficam para o campo.
- `go build` do backend (banner 2.12.108) ok.

### Pendente

- Confirmação em campo: próximo report de máquina lenta deve trazer as linhas
  `powershell (...) respondeu em N ms` e nenhum preparo falhando com a letra presente.
- T5 continua dependente de
  [`electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28.md`](electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28.md).

### Prova com pendrive real (2026-10-07, mesma sessão)

Pendrive `USB DISK 2.0` 15,5 GB em `E:\`, FAT32, rótulo `BADAVATAR` (Get-Disk nº 2, MBR). Só leitura —
nada foi gravado no dispositivo.

- Cluster: `GetDiskFreeSpace` (método antigo, via `Add-Type`) = **8192**; `fs.statfsSync('E:\').bsize`
  = **8192**; o script antigo devolvia `"AllocationUnitBytes":8192`. Igual (`scratchpad/compare-cluster.js`).
- `EXPECT_USB_ROOT=E: electron tests/electron/usb-enumeration-smoke.cjs` (Electron 42, PowerShell
  real): saída 0; `E:\`, `FAT32`, `allocationUnitBytes: 8192`, `safety.allowed: true`, e
  `requireSafeWindowsUsbTarget` revalidou com o mesmo fingerprint.
- Script nativo com o pendrive presente, 2 rodadas intercaladas de 5: antes 670/649 ms, depois
  525/483 ms (medianas).
- Não executado: o preparo completo (formata/grava o pendrive) — depende de autorização do dono.

### Prova ponta a ponta: preparo real com PowerShell lento (2026-10-07, autorizado pelo dono)

`electron scratchpad/e2e-prepare.cjs` sobre o código 2.12.108 compilado: cada `powershell.exe` **real**
só inicia depois de 6 s (o PC do cliente), a lista é listada como a tela faz ao abrir, e durante o
preparo a lista é consultada a cada 2 s, como o polling da Home. Preparo **sem formatar** (o dono não
estava como administrador; formatar abriria UAC), pendrive `E:\` FAT32 de 15,5 GB.

- Abertura da lista: `enumeracao nativa excedeu o prazo de 5000 ms` → `nova tentativa respondeu em
  6830 ms (prazo 12000 ms)` → `enumeracao nativa recuperada encontrou 1 unidade(s): E:\`. O probe de
  integridade estoura os 3 s, como esperado (prazo fixo, best-effort). É a sequência do `9530`, agora
  terminando com a unidade encontrada.
- Depois disso o prazo da nativa passou a 20–22 s (3 × 6,6–7,4 s). Todas as enumerações passaram,
  levando de 6,5 a 7,4 s cada; nenhuma estourou durante o preparo.
- Resultado: `100% Dispositivo preparado com sucesso.` em 804,8 s; release
  `1.1-autostart-aurora-freestyle-dashlaunch-xexmenu`, 620 arquivos (418 gravados, 202 reaproveitados).
  393 consultas da lista durante o preparo; os 41 `powershell.exe` abertos no período são as
  revalidações do próprio preparo (uma a cada ~17 s = 10 s de intervalo + ~7 s de PowerShell).
- No código 2.12.107 a primeira revalidação (`requireSafeWindowsUsbTarget`, nativa 5 s → física 12 s)
  estouraria nessa mesma máquina simulada — é o que `powershellSlowMachine.test.cjs` prova (falha em
  17 s).

**Observação fora do escopo:** num PC assim, cada revalidação de 10 s em 10 s custa ~7 s de
PowerShell, e o preparo fica bem mais lento (805 s aqui). Não falha mais, mas é candidato a
melhoria: espaçar a revalidação completa quando a enumeração é lenta, mantendo o `fs.access` barato
a cada chamada. Não implementado.

Não coberto: o caminho com "Formatar antes" (`waitForFormattedDevice`), que pede administrador.
