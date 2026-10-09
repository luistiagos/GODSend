# Bug: a lista "Dispositivo conectado" mostra só o pendrive e omite o HD externo

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
