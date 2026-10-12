# Bug: a lista "Dispositivo conectado" mostra só o pendrive e omite o HD externo

## Status

- Movido de `open/` para `retest/` em 2026-10-12 a pedido do dono, depois da execucao 20261010-2242 do pipeline (planning: correcao ja em `origin/main`, sem codigo a mudar).
- **Corrigido em:** 2026-10-09. **NAO publicado:** `0a719db` e posterior a 2.12.109 (a publicada).
- **Commits:** `0a719db` [T1] fix(usb) (enumeracao nativa sinaliza unidades Fixed e a fisica acrescenta o HD).
- **Onde:** `src/electron-app/infrastructure/windowsUsbDeviceService.ts::ENUMERATE_REMOVABLE_SCRIPT` (marcador `FixedDriveMarker`), `::enumerateSafeWindowsUsbDevices` (`parseNativeOutput`/`finishNative`, tambem via `recoverNativeListing`), `::isFixedDriveMarker` em `revalidateWithScript`.
- **Evidencia:** secao "Testes executados" abaixo — `tests/unit/usbFixedDriveMerge.test.cjs` 5/5, com o patch revertido 4 falhas e 1 verde (o controle); script nativo real devolve o marcador `D:\` e a linha `E:\`.
- **Falta para `closed/`:** publicar a versao (dono); prova ponta a ponta com pendrive **e** HD externo USB reais conectados juntos (nao ha HD visivel na maquina de teste) — conferir tambem o `BusType` do HD no `Get-Disk` (se nao for `USB`, e outra correcao); confirmacao do dono/cliente.

- **Detectado em:** 2026-10-09, relato do dono com print
- **Origem:** tela de preparo BadAvatar (`BadAvatarUsbPage.tsx`, bloco "Dispositivo conectado")
- **Estado:** passada 1 — só sintoma e evidência. Causa raiz não investigada

## Sintoma

Relato do dono: "No xboxcompanion não está listando os 2 HDs. Temos conectado um pendrive menor e um HD externo
e ele apenas lista o pendrive menor."

## Evidência

1. **Print do app** (dropdown aberto): uma única opção,
   `E:\ — Dispositivo USB removivel (14.4 GB)`, com a linha de detalhe
   `Dispositivo USB removivel · FAT32 · 14.4 GB livres · Pronto para uso`. Nenhuma entrada para o HD externo.

2. **Estado do Windows na máquina de desenvolvimento, 2026-10-09** (comandos literais):

   `Get-Disk` — três discos, só um USB:

   ```
   Number FriendlyName           BusType PartitionStyle    GB
        1 Patriot M.2 P320 512GB NVMe    GPT            476.9
        0 WD Green SN350 2TB     NVMe    GPT             1863
        2  USB DISK 2.0          USB     GPT             14.5
   ```

   `Get-Volume` — letras C (NTFS, Fixed), D (NTFS, Fixed), E (FAT32, Removable, rótulo `GPTTEST`).

   `Get-PnpDevice -Class DiskDrive | Where Present -eq $false` lista, entre os **não presentes**,
   `JMicron Generic SCSI Disk Device` (`SCSI\DISK&VEN_JMICRON&PROD_GENERIC\...`) e
   `Mass Storage Device USB Device` (`USBSTOR\...`). JMicron é ponte SATA→USB comum em gaveta/HD externo;
   o prefixo `SCSI\` (e não `USBSTOR\`) indica que ele enumera pelo driver UAS.

   Ou seja: no momento desta captura, **o próprio Windows não enxerga o HD externo** nesta máquina. Falta
   confirmar se o print foi tirado nesta máquina e com o HD aparecendo no Explorador/Gerenciamento de Disco.

## Causa raiz

Lida no código, com os call-sites:

- `infrastructure/windowsUsbDeviceService.ts::enumerateSafeWindowsUsbDevices` roda primeiro
  `ENUMERATE_REMOVABLE_SCRIPT` (a "enumeração nativa"). **Se ela devolve qualquer linha, a função retorna ali**
  (`return finishRemovableEnumeration(removable, includeHealth)`), e a enumeração física
  (`ENUMERATE_USB_SCRIPT`, `Get-Disk | Where BusType -eq 'USB'`) não roda.
- `ENUMERATE_REMOVABLE_SCRIPT` descarta tudo que não é `[System.IO.DriveType]::Removable`
  (`if (-not $drive.IsReady -or $drive.DriveType -ne ...Removable) { continue }`). O Windows reporta HD/SSD externo
  USB como `Fixed`. O próprio código já registra isso: o comentário de
  `deviceSafetyPolicy.ts::planRevalidationRetry` diz "for a USB HDD (reported as `Fixed`) the retry cannot produce
  a row at all".
- Resultado: **com um pendrive conectado, o HD externo nunca aparece**. Com o HD sozinho ele aparece, porque a
  nativa volta vazia e a física roda. O CHANGELOG da correção do timeout de enumeração já registrava isso como
  "Ressalva": "sem pendrive removível conectado, o script físico continua sendo executado sempre — HDs USB
  aparecem como `Fixed` [...] e só o caminho físico os encontra". O caso com os dois conectados ficou de fora.
- A mesma função é a revalidação do preparo (`requireSafeWindowsUsbTarget`). Então, se o HD foi escolhido sem o
  pendrive e o pendrive é conectado antes de preparar, o preparo falha com
  "Não foi possível identificar uma única unidade USB física".

## Hipóteses descartadas

- **Cache da lista (`badAvatarUsbService.ts::listWindowsUsbDrivesOnVolumeChange`) segurando a lista antiga.**
  Caiu: a assinatura (`readMountedVolumes`) faz `stat` das 26 letras, então uma letra nova (o HD) invalida o cache e
  força uma nova enumeração. O botão "Atualizar" também passa `fresh`. Mas a nova enumeração devolve a mesma lista
  sem o HD.
- **HD em UAS (`SCSI\...`) com `BusType` diferente de `USB`.** Não testado. Mesmo que o HD apareça como `USB`
  no `Get-Disk`, o retorno antecipado já o esconde. Precisa ser conferido com o HD real (ver Testes).
- **Filtro do renderer (`BadAvatarUsbPage.tsx`).** O dropdown mostra o que a IPC devolve. O defeito está antes.

## Correção planejada

Em `windowsUsbDeviceService.ts`:

1. `ENUMERATE_REMOVABLE_SCRIPT` passa a emitir também uma linha-marcador para cada unidade `Fixed` montada que
   não é a do sistema (`RootPath`, `DriveType='Fixed'`). Isso não chama Storage Management.
2. `parseOutput`, para a nativa, separa as linhas: as `Removable` viram dispositivos e as `Fixed` só informam que
   existe candidato a HD USB. Uma linha `Fixed` da nativa **nunca** vira dispositivo, porque a nativa não sabe o
   barramento.
3. Se a nativa achou removíveis **e** há candidato `Fixed`, roda a enumeração física e acrescenta as linhas dela
   cujas letras não estão entre as removíveis (o HD). Se a física falhar ou estourar o prazo, a lista fica só com
   as removíveis e o motivo vai para o log. Não lança erro, porque o pendrive continua válido.
   Sem candidato `Fixed`, nada muda: nenhum PowerShell a mais.
4. `revalidateWithScript` com a nativa filtra só as linhas `Removable`.

Custo: uma enumeração física a mais por mudança de volume, só em máquina com disco fixo além do C:. O cache já
limita isso a cada troca de letra/serial (mais 15 s de acomodação). Não roda a cada poll.

## Tasks

| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | enumeração nativa sinaliza unidades Fixed; com removível + Fixed, mesclar o HD da física; teste unitário com PowerShell simulado (pendrive + HD -> 2 itens; sem Fixed -> só a nativa roda; física falha -> mantém o pendrive) | -- | -- | -- | -- |

Prova ponta a ponta: no app buildado, com o pendrive e o HD externo conectados, o dropdown mostra os dois.
Controle: só o pendrive mostra só o pendrive, e só o HD mostra só o HD.

## Correção aplicada

Commit `0a719db`, conforme o plano, em `infrastructure/windowsUsbDeviceService.ts`:

- `ENUMERATE_REMOVABLE_SCRIPT` emite `{ RootPath, DriveType: 'Fixed', FixedDriveMarker: $true }` para cada unidade
  `Fixed` montada que não é o `$env:SystemDrive`. O marcador usa uma flag explícita, e não "linha sem `Label`",
  para não confundir com a linha física do HD (também `DriveType: Fixed`).
- `enumerateSafeWindowsUsbDevices`: `parseNativeOutput` separa marcadores e removíveis, e `finishNative` roda a
  física quando há marcador e acrescenta as letras que ainda não estão na lista. A falha da física fica só no log
  (`enumeracao fisica de HD USB falhou; listando so os removiveis`). Vale também para a nova tentativa
  (`recoverNativeListing`).
- `isFixedDriveMarker` filtra os marcadores também em `revalidateWithScript`.

## Testes executados

- `tests/unit/usbFixedDriveMerge.test.cjs` (novo, PowerShell simulado): **5/5 verdes**. Pendrive + HD -> `E:\`, `F:\`,
  com o pendrive mantido como linha nativa (fingerprint inalterado); revalidação do HD com pendrive conectado;
  controle sem `Fixed` -> só a nativa roda; física falhando -> mantém o pendrive; só marcadores -> cai na física.
- **Contraprova:** com o patch revertido (`git apply -R`), o mesmo arquivo dá **4 falhas e 1 verde** (o controle).
- Script nativo real nesta máquina: devolve o marcador `D:\` (NVMe interno), sem `C:\`, e a linha `E:\`.
  `enumerateSafeWindowsUsbDevices(true)` real devolve só `E:\`, o que está certo: a física roda por causa do `D:`
  e não acha nenhum outro USB.
- Suíte `node --test tests/unit/*.test.cjs`: 279/282. As 3 falhas (`fat32FormatGuard`, `loopAwareTimeout`) passam
  21/21 rodando os arquivos sozinhos. São testes de tempo sob carga e não tocam esta área.
- **Pendente: prova ponta a ponta com o HD externo real.** Nesta máquina o Windows não enxerga o HD agora
  (ver Evidência). Também confere a hipótese do UAS: se o `Get-Disk` mostrar o HD com `BusType` diferente de `USB`,
  a física não o acha, e é outra correção.

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** bloqueado — a correção de código já está no fluxo principal (`0a719db`, ancestral de `origin/main`);
o que falta é a prova com um HD externo USB real ao lado do pendrive, e não há HD na máquina de teste (o Windows
não o enxerga) nem disco liberado para o pipeline.
**Complexidade:** alta — `windowsUsbDeviceService.ts` está no critério "Alta" do `docs/bugs/open/README.md`
(preparo de disco); não há trabalho de código pendente.
**Severidade:** medio — só atinge quem conecta pendrive e HD externo juntos, e há contorno (desconectar o pendrive:
com o HD sozinho a enumeração física já o listava).
**Arquivos a alterar (reserva da onda):** nenhum.

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

A causa raiz das passadas anteriores continua valendo e já foi corrigida. Conferido no HEAD desta worktree
(`d7bd9ad`):

- `src/electron-app/infrastructure/windowsUsbDeviceService.ts::ENUMERATE_REMOVABLE_SCRIPT`: para cada unidade
  `Fixed` pronta que não é o `$env:SystemDrive`, emite `{ RootPath, DriveType='Fixed', FixedDriveMarker=$true }`
  e segue em frente. Unidades `Removable` viram linha completa. Em erro: `try {} catch {}` por unidade, que pula
  só a unidade com problema.
- `...::enumerateSafeWindowsUsbDevices` → `parseNativeOutput` guarda `fixedDriveMounted` e tira os marcadores das
  linhas. `finishNative` roda `ENUMERATE_USB_SCRIPT` quando há marcador e acrescenta as letras que ainda não estão
  na lista. **Em erro**, `catch` → log `enumeracao fisica de HD USB falhou; listando so os removiveis` → devolve só
  os removíveis, sem lançar. `recoverNativeListing` também passa por `finishNative`.
- `...::ENUMERATE_USB_SCRIPT`: `Get-Disk | Where BusType -eq 'USB'`. **Aqui está o único risco que sobra:** se o
  HD JMicron em UAS aparecer no `Get-Disk` com `BusType` diferente de `USB`, ele não entra na lista, com ou sem
  pendrive. Isso só se confere com o HD conectado.
- `...::revalidateWithScript` filtra `isFixedDriveMarker`, então a revalidação do preparo não trata o marcador
  como unidade.

### Provas (comando literal -> resultado)

- `git merge-base --is-ancestor 0a719db HEAD && echo ANCESTOR` -> `ANCESTOR`. O fix está no fluxo principal
  (`git branch --contains 0a719db` -> `main`).
- `grep -n "FixedDriveMarker\|isFixedDriveMarker\|finishNative" infrastructure/windowsUsbDeviceService.ts` ->
  linhas 217/232 (script), 426 (`isFixedDriveMarker`), 571-572 (`parseNativeOutput`), 578 (`finishNative`),
  836 (`revalidateWithScript`).
- `ls src/electron-app/tests/unit/ | grep -i fixed` -> `usbFixedDriveMerge.test.cjs` presente (5/5 e contraprova
  4 falhas com o patch revertido, segundo "Testes executados"). Não rodei de novo: o teste importa o `.js` que o
  `tsc` gera, e o `tsc` fica com o helper.
- `Get-Disk` (2026-10-10, máquina do pipeline) -> NVMe 1, NVMe 0, `2 USB DISK 2.0 USB MBR 14.5`. **Nenhum HD
  externo.**
- `Get-PnpDevice -Class DiskDrive` -> `JMicron Generic SCSI Disk Device  Present=False`
  (`SCSI\DISK&VEN_JMICRON&PROD_GENERIC\...`). O HD continua ausente do Windows.

### Hipoteses descartadas (e por que)

- **Veredito `corrigir`:** não há código a mudar. O retorno antecipado que escondia o HD já foi removido pelo
  `0a719db`, e o teste unitário cobre os 5 caminhos (com HD, sem `Fixed`, física falhando, revalidação, só
  marcadores). Uma onda de dev teria diff vazio.
- **Mandar para retest pela T2 do pipeline:** a T2 precisa do sinal "o dropdown lista pendrive E HD", e para isso
  o HD tem que estar conectado e visível ao Windows. Ele não está (`Present=False`), e o manual não libera disco
  real para o pipeline. Uma T2 só com o pendrive mostraria o caso de controle, não o bug.
- **UAS (`BusType` ≠ `USB`) como causa já confirmada:** continua sem prova. Não dá para abrir bug lateral sem a
  leitura do `Get-Disk` com o HD conectado.

### Tarefas

- [ ] (dono, hardware) Conectar o pendrive e o HD externo JMicron na máquina e confirmar que o HD aparece no
  Gerenciamento de Disco. Rodar `Get-Disk | Select Number,FriendlyName,BusType` e anotar o `BusType` do HD aqui.
- [ ] (dono) Abrir a tela BadAvatar USB num build que contenha `0a719db` (`npm start` da árvore principal ou a
  próxima versão publicada). O dropdown deve listar as duas letras. Não preparar nada.
- [ ] Se o `BusType` do HD não for `USB`, abrir um bug novo: `ENUMERATE_USB_SCRIPT` filtra só `BusType -eq 'USB'`.

### Plano de teste

- **Offline (sem slot):** `node --test tests/unit/usbFixedDriveMerge.test.cjs` depois do build do helper (5/5) e
  `npm --prefix src/electron-app run test:safety` sem falhas novas. Já feito na passada de correção.
- **T2 reproducao como o usuario (E2E, no slot):** estado de partida: pendrive FAT32 (`E:\`) e HD externo USB
  conectados e visíveis no Explorador. App da árvore com `0a719db`, aberto em **BadAvatar USB**. Abrir o dropdown
  "Dispositivo conectado" (sem escolher disco). Sinal: duas opções, `E:\ — Dispositivo USB removivel` e a letra do
  HD com o `FriendlyName` dele. No log `%APPDATA%\xbox-360-companion-electron\logs\`, a linha
  `enumeracao fisica de HD USB encontrou 1 unidade(s): <letra>`. **Bloqueada:** o HD não está disponível.
- **Controle positivo:** `deploy --at-base` não existe neste projeto. O controle é o mesmo caminho com um build
  anterior a `0a719db`: só o pendrive aparece, e o log mostra `enumeracao nativa encontrou 1 unidade(s): E:\` sem a
  linha da física. Os controles "só pendrive -> só pendrive" e "só HD -> só HD" também valem.
- **T3 regressao direcionada:** revalidação do preparo com o pendrive (`requireSafeWindowsUsbTarget`, que não pode
  ver o marcador como unidade) e a lista com só o pendrive numa máquina com um segundo disco interno (`D:`). Nesse
  caso a física roda e não acrescenta nada. Já provado na máquina de desenvolvimento ("Testes executados": real
  devolve só `E:\`).

### Sessoes seguintes

- dev: nenhuma (bloqueado; sem código pendente).
- teste: nenhuma no pipeline. Quando o HD voltar, o teste fica com o dono (effort low, sem ultrathink: é
  observar o dropdown e uma linha de log).

### Evidencia acrescentada (pipeline 20261010-2242, planning de outro bug)

- A tela "Jogos Instalados" (`renderer/components/UsbGamesPage.tsx`) também lista as unidades por
  `toolsBadAvatarListDrives`, e o botão "Reparar (CHKDSK)" só aparece para a unidade dessa lista
  (`activeDriveInfo`). Com o HD externo omitido, o cliente com HD não alcança o reparo pelo app —
  caso do #144 em
  [[pipeline-mkdir-da-pasta-do-jogo-falha-com-caminho-nao-encontrado-e-o-dispositivo-presente_2026-10-04T23-28]],
  cuja mensagem por isso cita também o caminho do Windows (Propriedades > Ferramentas > Verificar).
