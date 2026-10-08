# Bug: o Xbox 360 mostra como "Não Formatado" um pendrive que o Companion declarou pronto — e o app não confere o layout de disco que o console lê

- **Detectado em:** 2026-10-08 17:09 (chamado **#153**, sessão `81325272899783@lid`; prints repassados pelo dono)
- **Origem:** conversa de suporte e prints da cliente + leitura de `infrastructure/fat32Format.ts::buildGuardedWindowsFat32Script`, `services/fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice` / `waitForFormattedDevice`, `infrastructure/windowsUsbDeviceService.ts` (`ENUMERATE_USB_SCRIPT`) e do histórico de `fat32Format.ts` (`git log` / `git show`)
- **Errors (serviço):** N/A — o preparo **terminou com sucesso**, e preparo bem-sucedido não reporta nada
- **Classe:** fail (o console não lê o dispositivo) + diagnóstico (nenhum dado do layout do disco sai da máquina do cliente)
- **Severidade:** **P1 — Alto** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): bloqueio total — sem leitura do pendrive não há perfil `ABadAvatar`, nem Aurora, nem jogo. No #153 a cliente já falou em reembolso (`[134109]`)
- **Versões:** a cliente não informou; o preparo foi em 2026-10-08, com a série 2.12.10x no ar. Código lido no HEAD `002d3c8` (2.12.109)
- **Reincidência:** 2 casos confirmados com o mesmo print depois de um preparo concluído (ver "Evidência"). Mesma família de sintoma do bug aberto [`badavatar-perfil-do-exploit-nao-aparece-na-tela-de-perfis_2026-09-23T15-20.md`](badavatar-perfil-do-exploit-nao-aparece-na-tela-de-perfis_2026-09-23T15-20.md): lá o console **lê** o pendrive e o perfil não aparece; aqui o console **não lê** o pendrive

## Sintoma

Relato do dono: a cliente preparou o pendrive no Companion (com formatação), ligou o Xbox com o pendrive e
*"nada aparece, apenas o logo do Xbox"* — nem o perfil `ABadAvatar`, nem a Aurora.

Na conversa (horários UTC):

- `[134886]` 18:13 — *"Coloquei de novo tá nessa tela congelada"*, com print do logo de inicialização do Xbox parado;
- `[134890]` 18:16 — *"Tirei sem o pen drive abre normal com pendrive acontece a msm coisa"*;
- `[134903]` 18:39 — *"abriu sem travar mas não aparece aurora nem o nome do pendrive"*;
- `[134905]` 18:41 — *"Apareceu o pendrive escrito Não formatado"*, com o print `[134907]`:
  *Dispositivos de Armazenamento* → *Unidade de Memória 2,3 GB livres* · **Não Formatado** · *Jogos Salvos na Nuvem*.

Dois comportamentos com o mesmo pendrive: em parte das partidas o console **trava no logo**; nas outras,
liga normalmente e lista o pendrive como **Não Formatado**.

## Evidência

### A régua: "o console lê" × "o console não lê"

Na tela *Configurações → Sistema → Armazenamento* do Xbox 360:

- dispositivo **legível** aparece como **"Dispositivo USB — N GB livres"**. Prints de clientes: `[73655]` 15,3 GB,
  `[88967]` 14,4 GB, `[95058]` 7,1 GB, `[96017]` 52,8 GB, `[106887]` 17,9 GB, `[111073]` 58,3 GB,
  `[120674]` 28,7 GB, `[127275]` 222 GB;
- dispositivo **ilegível** aparece como **"Não Formatado"**, sem tamanho;
- a **"Unidade de Memória"** dessa tela é a memória interna do console, não o pendrive: no #153 ela mostra os
  mesmos 2,3 GB livres com o HD conectado (`[133594]`, 07/10) e com o pendrive (`[134907]`, 08/10).

### Caso 1 — chamado #153 (`81325272899783@lid`), 2026-10-08

| Fato | Prova |
|---|---|
| Pendrive genérico: o Gerenciador de Dispositivos o chama **"Mass Storage Device USB Device"**, fabricante **"Mass"**; 30200 MB, removível | prints do dono (abas *Geral* e *Volumes*); `[134977]`, `[134982]` |
| O Windows lê: **FAT32**, rótulo `BADAVATAR`, 733 MB usados de 31.650.201.600 bytes | print *Propriedades de BADAVATAR (G:)*; `[134911]` *"Sim sistema de arquivos FAT32"* |
| **Estilo de partição: MBR**; um único volume, `BADAVATAR (G:)` 30200 MB; **espaço não alocado: 0 MB** | print da aba *Volumes* depois de *Popular* (`[134982]`, repassado pelo dono) |
| Preparo no modo **Bloqueado/LT**, completo: raiz com `.xbox-downloader`, `apps`, `Aurora`, `BadUpdatePayload`, `Content`, `games`, `launch.ini`, `lhelper.xex`, `UsbdSecPatch.xex` | print da raiz (dono). `BadUpdatePayload` e `apps` só são gravados fora do modo RGH ([`fixedBadAvatarPreparationService.ts:480-482`](../../../src/electron-app/services/fixedBadAvatarPreparationService.ts#L480-L482)) |
| O app confirmou o perfil do exploit no dispositivo: *"Desbloqueio BadAvatar encontrado — O perfil ABadAvatar está gravado neste dispositivo"* | `[134921]`; a frase é a do estado `preparado-bloqueado-lt` ([`preparedDeviceCopy.ts:33`](../../../src/electron-app/services/preparedDeviceCopy.ts#L33)), que confere o perfil contra o manifesto |
| Avatares coloridos; console sem Wi-Fi e sem cabo | `[133584]`, `[133582]` |
| No Xbox: **Não Formatado**; às vezes trava no logo, só com este pendrive | `[134907]`, `[134967]`; `[134886]`, `[134890]` |

Antes deste pendrive, em 07/10, a cliente tentou um **HD de 465,8 GB**, que o app também listou como
*"Mass Storage Device"* (`[133560]`), com arquivos pessoais que ela queria manter (`[133533]`). Esse preparo
**não terminou** (raiz vazia, `[134233]`), e o Xbox também mostrou "Não Formatado" (`[133594]`). **Esse episódio
não conta como caso:** o HD não chegou a ser preparado.

### Caso 2 — `45367823446171@lid`, 2026-09-10

| Fato | Prova |
|---|---|
| HD de 4 TB; depois do preparo o volume ficou com metade do tamanho (teto de 2 TiB do MBR) | `[103979]` *"O tamanho do drive continua diminuído pela metade"* |
| Formatação acidentada antes de dar certo: NTFS, `fat32format` com acesso negado, acesso controlado a pastas | `[103977]`, `[103988]`, `[104000]`, `[104066]` |
| Preparo concluído; o Windows lê FAT32, 743 MB usados, 1,99 TB livres, rótulo `BADAVATAR (D:)` | `[104182]`–`[104185]`, `[104212]`, `[104214]` |
| No Xbox: **Não Formatado**; avatares coloridos | `[104208]`, `[104249]`; `[104222]` |
| O console era **RGH** (tela do XeLL); no dia seguinte um **pendrive** preparado funcionou, e o HD de 4 TB *"travou. Não estava lendo"* | `[104794]`; `[106430]`–`[106436]`; `[106444]` |

O estilo de partição não foi pedido. O volume cortado em ~2 TB indica MBR: em GPT o Windows mostraria ~3,64 TiB.
**Este lid está na tabela do bug do perfil como "preparado em modo RGH".** O modo estava mesmo errado, mas antes
disso o console nem lia o HD.

### Varredura das conversas

Feita pelo `/diag/query` (cliente `chamado.py` da skill `triagem-chamados`), em 2026-10-08:

1. ```sql
   SELECT id, main_phone, role, dttime, LEFT(message, 400) AS msg FROM Wpp_proccess
   WHERE (message LIKE '%não formatad%' OR message LIKE '%nao formatad%'
          OR message LIKE '%unformatted%' OR message LIKE '%precisa ser formatad%') ORDER BY id
   ```
   → **25 linhas**. Prints do Xbox com "Não Formatado" vêm de 3 lids: os dois casos acima e `243894113562743`.
2. `role='customer'` com `Dispositivo USB`, `Configurar agora`, `Configurar Dispositivo`, `marca 0`,
   `não reconhece o pen/hd`, `xbox não reconhece` → **112 linhas**. Filtradas para telas de armazenamento do console
   e alegações de "não reconhece" desde 2026-08-01, sobraram **24**, lidas na janela de cada conversa.
3. `wpp_support_ticket` de origem Xbox com `formatad`, `reconhec` ou `armazenamento` na abertura ou no resumo → só
   os chamados da cliente do caso 1 (#132, #150, **#153**).

Relatos parecidos que **não** são este bug:

| lid | data | por quê |
|---|---|---|
| `243894113562743` | 2026-08-21 | HD WD de 1 TB mostrado "Não Formatado" **antes** de ser preparado; a formatação seguinte falhou (`[80287]`, erro de `Int32` no `fat32format`). Outro HD, preparado, funcionou (`[81632]`) |
| `149482142482522` | 2026-09-05 | HD em **NTFS** (`[97777]`); preparado com formatação, a Aurora abriu e o jogo rodou (`[98140]`, `[98152]`) |
| `182205548634238` | 2026-09-16 | pendrive de 58,6 GB **lido** pelo console (`[111073]`, "Dispositivo USB 58,3 GB"); o problema era o perfil não aparecer → bug do perfil |
| `4144962261138` | 2026-08-25 | quem não reconhecia era o **app** (*"fica só verificando pen drive"*, `[84052]`) → família da enumeração USB |
| `184301425549488` | 2026-08-08 | pendrive formatado pelo próprio cliente; "o jogo não aparece", sem print do armazenamento — não classificável |
| `157135807738048` | 2026-09-13 | relato único, sem continuação |

## Defeito provado no código — que NÃO é a causa provada dos dois casos

### O preparo não confere o que o console exige

O Xbox 360 lê FAT32 em **MBR** (invariante do projeto, seção `fat32Format.ts` do `AGENTS.md`). O preparo só
confere o **sistema de arquivos**:

- **com "Formatar antes":** o script elevado termina conferindo só `FileSystem = FAT32` e o rótulo
  ([`fat32Format.ts:421-437`](../../../src/electron-app/infrastructure/fat32Format.ts#L421-L437)). Depois,
  `waitForFormattedDevice` confere reaparecimento, capacidade e FAT32
  ([`fixedBadAvatarPreparationService.ts:346-374`](../../../src/electron-app/services/fixedBadAvatarPreparationService.ts#L346-L374));
- **sem "Formatar antes":** só FAT32
  ([`fixedBadAvatarPreparationService.ts:449-451`](../../../src/electron-app/services/fixedBadAvatarPreparationService.ts#L449-L451)).

A enumeração **já lê** o estilo de partição (`PartitionStyle = [string]$disk.PartitionStyle`,
[`windowsUsbDeviceService.ts:295`](../../../src/electron-app/infrastructure/windowsUsbDeviceService.ts#L295);
campo `partitionStyle` em [`deviceSafetyPolicy.ts:30`](../../../src/electron-app/infrastructure/deviceSafetyPolicy.ts#L30)),
mas nenhuma decisão o usa. Três coisas nem são lidas:

- quantas partições o disco tem (a enumeração só pega as que têm letra, linha 271);
- o byte de tipo da partição no MBR;
- o tamanho de setor lógico.

Resultado: um pendrive em GPT, ou com uma segunda partição sem letra, sai como "preparado" e o console não o lê.

### Desde a 2.12.64 o formatador deixou de recriar a tabela de partições

**Até a 2.12.63** (ex.: `90a3265`, de 2026-08-20), todo preparo com formatação rodava:

```
diskpart: select disk N → attributes disk clear readonly → clean → create partition primary → assign letter
fat32format X:
```

O `clean` apaga a tabela inteira, e o diskpart inicializa em MBR (o padrão dele) o disco que ficou sem tabela.
Qualquer que fosse o estado de chegada (GPT, várias partições), o pendrive saía MBR com partição única. Essa
garantia era **efeito colateral**: o script nem tinha `convert mbr`, e nada no código, nos comentários ou nos testes
dizia que aquilo era requisito.

**Na 2.12.64** (entrada do CHANGELOG de 2026-09-03; commit `9d82b3f`, de 2026-09-05, mensagem `*`), o formatador
virou uma cascata:

- **até 32 GB** ([`fat32Format.ts:255-348`](../../../src/electron-app/infrastructure/fat32Format.ts#L255-L348)):
  `Format-Volume` na **partição existente** → se falhar, `fat32format.exe` → `format.com` → só então
  `diskpart clean` + `convert mbr`. Como o `Format-Volume` quase sempre funciona, o passo que garantia o MBR quase
  nunca roda;
- **acima de 32 GB** ([`fat32Format.ts:349-419`](../../../src/electron-app/infrastructure/fat32Format.ts#L349-L419)):
  `fat32format` na partição existente. O `clean` só roda se não houver volume (linha 373) ou se o `fat32format`
  falhar (linha 386). O commit `b890166` (2026-09-10) mexeu nesse trecho e manteve a condição.

**Por que mudou.** Pelo CHANGELOG 2.12.62–2.12.65, quatro versões no mesmo dia tentaram fazer a formatação parar de
falhar no PC do cliente:

1. depois do `clean`, a partição nova fica sem sistema de arquivos por um instante; o Windows abria o modal
   *"Formate o disco na unidade X:"* e o Explorer/AutoPlay segurava a unidade;
2. com a unidade presa, o `fat32format` falhava com `GetLastError()=32`;
3. o `diskpart` dava "acesso negado" sem dizer por quê.

A saída escolhida foi não recriar a partição: o `Format-Volume` não deixa a unidade sem sistema de arquivos, então
não há modal nem bloqueio. A 2.12.65 acrescentou `convert mbr`, mas **só no último recurso**. Não há bug doc dessas
falhas, nem registro de teste em console depois da mudança.

Outra diferença da mesma versão: até 32 GB, quem escreve o FAT32 passou a ser o formatador do Windows, e não mais o
`fat32format` da Ridgecrop. FAT32 feito pelo Windows é o caminho oficial de pendrive para o Xbox 360. Fica anotado
aqui só para não ser redescoberto.

**Os docs afirmam a garantia que o código perdeu.** O `AGENTS.md` (seção `fat32Format.ts`) e o
[`CAPACIDADE-E-ESPACO.md`](../../CAPACIDADE-E-ESPACO.md) dizem que *"os quatro caminhos de `diskpart` usam
`convert mbr`"*. É verdade, mas o caminho principal não passa pelo `diskpart`.

## Causa raiz — NÃO provada

O defeito acima é real e precisa ser fechado: é ele que impede o app de garantir o requisito do dono. Mas ele **não
explica o caso 1**, porque o disco da cliente já está em MBR, com partição única.

### Hipóteses descartadas

| Hipótese | Por que caiu |
|---|---|
| Pendrive do #153 em **GPT**, que a 2.12.64 não converte | aba *Volumes* (`[134982]`): **MBR** |
| Segunda partição escondida no pendrive | aba *Volumes*: um volume, 0 MB não alocado |
| Preparo incompleto ou no modo RGH | o app confirmou o perfil gravado (`[134921]`); a raiz tem `BadUpdatePayload` e `apps` |
| A "Unidade de Memória" da tela do Xbox é o pendrive | é a memória interna do console: 2,3 GB livres com qualquer dispositivo; o pendrive é a linha "Não Formatado" |
| Sistema de arquivos errado | o Windows mostra FAT32 (`[134911]` e print das propriedades) |

### Hipóteses em aberto, da mais barata de testar para a mais cara

- **H1 — o pendrive não é compatível com o console.** Nome genérico (*"Mass Storage Device"*, fabricante
  *"Mass"*), layout correto no Windows, e o console **trava no logo só com ele**. Testes:
  (a) o mesmo preparo num pendrive de marca (SanDisk/Kingston, até 32 GB), no mesmo console;
  (b) *Testar Capacidade* (botão verde da aba de jogos do pendrive, [`UsbGamesPage.tsx:434-443`](../../../src/electron-app/renderer/components/UsbGamesPage.tsx#L434-L443)) do Companion (`fakeDriveProbeService`) neste pendrive.
- **H2 — o byte de tipo da partição no MBR não é FAT32** (`0x0B`/`0x0C`). O `Format-Volume` reformata a partição
  existente, e **não verifiquei** se ele reescreve esse byte (nem o `fat32format`). Teste no PC, sem formatar nada:
  `Get-Partition -DriveLetter G | Format-List MbrType,Offset,Size` (12 = FAT32 LBA; 7 = NTFS/exFAT).
- **H3 — setor lógico diferente de 512 bytes.** Teste:
  `Get-Disk -Number <n> | Format-List LogicalSectorSize,PhysicalSectorSize,Model,FirmwareVersion`.
- **H4 (caso 2) — FAT32 de ~2 TB.** HD de 222 GB em FAT32 é lido (`[127275]`), mas não há caso lido acima disso. O
  console do caso 2 era RGH, e o pendrive dele funcionou.

Sobre o travamento no logo: se o console tivesse lido o pendrive e o exploit travasse, a mesma mídia não apareceria
como "Não Formatado" na partida seguinte. Os dois sintomas juntos apontam para a leitura do dispositivo, não para o
exploit. Isso é inferência, não prova.

## Correção planejada — "preparado" passa a significar "o console lê"

O requisito do dono: depois do preparo, o pendrive/HD tem de funcionar no Xbox 360 sem mais nada. O app **pode
garantir** o layout do disco. Ele **não pode garantir** o hardware, mas pode detectar, registrar e avisar.

- **T1 — Portão de layout antes de declarar "pronto"**, nos dois caminhos (com e sem formatar), em
  `prepareFixedBadAvatarDevice`, antes do plano de escrita. Exige:
  - `partitionStyle = MBR`;
  - **uma** partição no disco;
  - tipo da partição FAT32 (`MbrType` 11 ou 12);
  - setor lógico de 512 bytes;
  - FAT32;
  - volume ≤ 2 TiB.

  Sem formatar, a reprovação manda marcar "Formatar antes". Formatando, a reprovação é bug do formatador e tem de
  chegar à telemetria. Os dados vêm do `ENUMERATE_USB_SCRIPT`, sem nenhum script novo:
  - `PartitionCount`, da chamada `Get-Partition -DiskNumber` que já existe (antes do filtro por letra);
  - `MbrType`, `LogicalSectorSize` e `PhysicalSectorSize`, propriedades dos objetos que o script já lê.

  **Corrigido na implementação:** num pendrive o preparo não roda o `ENUMERATE_USB_SCRIPT` (a enumeração nativa
  responde primeiro e não tem estilo de partição), então o portão roda esse script **uma vez** para ler o layout.
  Ver "Análise antes de implementar T1 e T2".

  Regra pura `assessXboxLayout(device)`, com teste unitário por caso: GPT, 2 partições, `MbrType` 7, setor 4096 e
  layout certo.
- **T2 — O formatador volta a garantir MBR e partição única**, sem trazer de volta os problemas de 03/09:
  - disco fora de MBR, ou com mais de uma partição: ir direto ao caminho `diskpart clean` + `convert mbr`;
  - disco já em MBR com partição única: manter `Format-Volume` / `fat32format`;
  - depois de formatar, o próprio script elevado confere `Get-Disk` (MBR), a contagem de partições (1) e o
    `MbrType`. Se H2 se confirmar, acerta o tipo com `Set-Partition -MbrType 12`.

  Teste em `fat32FormatGuard.test.cjs` (o script gerado contém a decisão e a conferência) e teste em hardware com um
  pendrive convertido para GPT.
- **T3 — Registro do layout no dispositivo.** Gravar em `.xbox-downloader/` um arquivo **separado do marcador**:
  versão do app, modo, data, caminho de formatação usado, estilo de partição, partições, tipo, setor, unidade de
  alocação, sistema de arquivos e modelo/fabricante do disco. O marcador
  ([`readyToPlayConfiguration.ts:27-29`](../../../src/electron-app/infrastructure/readyToPlayConfiguration.ts#L27-L29))
  é lido pelo hook do Aurora e pela coleta de crash, então não mexer nele. O arquivo novo entra no plano
  transacional como o marcador (`replaceGeneratedEntry`). Serve ao suporte (um print da pasta responde) e à
  telemetria.
- **T4 — Telemetria do preparo concluído**, com os mesmos campos e sem dados pessoais. Depende do bug
  [`electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28.md`](electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28.md).
  Sem ela, não sabemos quantos dispositivos saem do app em GPT, com tipo errado ou com setor de 4 KB.
- **T5 — Decidir H1–H3 no #153.** Não depende de código:
  - pedir à cliente as duas linhas de PowerShell de H2 e H3;
  - testar um pendrive de marca no mesmo console;
  - rodar *Testar Capacidade* (botão verde da aba de jogos do pendrive, [`UsbGamesPage.tsx:434-443`](../../../src/electron-app/renderer/components/UsbGamesPage.tsx#L434-L443)) no pendrive dela.

  Registrar o resultado aqui.
- **T6 — Docs e suporte.**
  - Corrigir a frase sobre `convert mbr` no `AGENTS.md` e no `CAPACIDADE-E-ESPACO.md`, registrando a nova
    invariante depois de T2.
  - Ensinar ao suporte e ao agente que "Não Formatado" = o console não lê, e o que pedir nesse caso: tela de
    Armazenamento, estilo de partição e modelo do pendrive. A KB do agente vive no `digitalstoregamesproject`.

## Análise antes de implementar T1 e T2 (2026-10-08)

### O que o código faz (aberto, não inferido)

- `windowsUsbDeviceService.ts::enumerateSafeWindowsUsbDevices` roda primeiro o `ENUMERATE_REMOVABLE_SCRIPT` e
  devolve as linhas dele sempre que existe alguma unidade `Removable`. O `ENUMERATE_USB_SCRIPT` só roda quando não
  há removível (HD USB, que o Windows chama de `Fixed`), quando o nativo falha, ou na revalidação cruzada
  (`planRevalidationRetry`). A linha nativa traz `PartitionStyle = ''` e `DiskNumber = -1`.
  **Num pendrive (o caso 1) o preparo não tem estilo de partição nenhum.** O script nativo não pode ganhar
  `Get-Disk`: ele existe para quando o Storage Management trava (comentário acima de `ENUMERATE_REMOVABLE_SCRIPT`).
- `ENUMERATE_USB_SCRIPT` filtra `Get-Partition -DiskNumber` por letra, e o fallback `Win32_DiskDrive` também
  devolve `PartitionStyle = ''`.
- `fixedBadAvatarPreparationService.ts::waitForFormattedDevice(root, expectedVolumeBytes)` recebe o tamanho da
  partição de **antes** da formatação e reprova se a que volta diferir mais que max(16 MiB, 1 %).
  **Recriar a tabela muda esse tamanho:**
  - GPT → MBR ganha ~17 MB (a MSR de 16 MB mais o alinhamento), o que estoura a tolerância num pendrive de 1 GB;
  - um disco GPT acima de 2 TiB cai para 2 TiB;
  - um disco com uma segunda partição oculta cresce.

  Sem ajuste, T2 só trocaria "pronto em GPT" por *"A capacidade mudou após a formatação"*.
- `fat32Format.ts::buildGuardedWindowsFat32Script` escolhe o ramo por `$partition.Size` (a partição montada). Com
  a tabela recriada, a partição final ocupa o disco inteiro. Num disco > 32 GB com partição ≤ 32 GB, o ramo
  ≤ 32 GB cairia no `format fs=fat32` do diskpart, que recusa volume > 32 GB, e depois no NTFS + `fat32format`,
  que é o `GetLastError()=5` documentado no `AGENTS.md`.
- `formatWindowsFat32`: do script elevado só voltam o código de saída e o log, que o `finally` apaga.
- `deviceSafetyPolicy.ts::createDeviceFingerprint`: não pode receber campo novo, porque o fingerprint alimenta
  `deterministicTransactionId` e mudar a identidade quebraria a retomada de preparos interrompidos.
- `telemetry.ts::reportError(component, file, method, message, pageUrl, extraLogs)` deduplica por
  `component|message` na sessão e anexa a cauda do log do app.

### Comandos que provaram algo

Nesta máquina, sem elevação e só com leitura:

- `Get-Disk | Select Number,BusType,PartitionStyle,LogicalSectorSize,PhysicalSectorSize` → disco USB: MBR,
  512/512; os NVMe: GPT, 512/4096.
- `Get-Partition | Select DiskNumber,PartitionNumber,DriveLetter,Type,MbrType,GptType,Size` → o pendrive FAT32
  tem `MbrType 12` (`FAT32 XINT13`). Em GPT o `MbrType` é nulo, e todo disco de dados GPT criado pelo Windows tem
  uma partição `Reserved` (MSR) sem letra, então a contagem dá 2.
- `(Get-Command Set-Partition).Parameters['MbrType']` → `System.UInt16`. `Update-Disk` aceita `-Number`.
- Baseline antes da mudança: `npx tsc` + `node --test tests/unit/*.test.cjs` → **258/258**.
- O shell não é administrador (`IsInRole(Administrator)` = False), então o script elevado **não** foi rodado
  num VHD.

### Hipóteses descartadas nesta etapa

| Ideia | Por que caiu |
|---|---|
| Ler o layout no script nativo | ele não pode chamar Storage Management |
| Ler o layout por `DeviceIoControl` (`IOCTL_DISK_GET_PARTITION_INFO_EX` abre o volume sem privilégio) | exigiria `Add-Type`, tirado na 2.12.108 por custo, ou módulo nativo, que o projeto não carrega |
| Reprovar quando o layout **não puder ser lido** | numa máquina onde o `Get-Disk` não responde, o preparo sem formatar pararia de funcionar para sempre (e formatar também depende do Storage Management). Fica assim: layout desconhecido passa e vai para o log; layout lido e errado reprova |
| Pôr o layout em `assessDeviceSafety` | os códigos de lá tratam de segurança e todos bloqueiam a formatação; GPT se resolve formatando |

### Plano corrigido

**T1**
- `ENUMERATE_USB_SCRIPT` ganha `PartitionCount` (todas as partições, antes do filtro por letra), `MbrType`,
  `LogicalSectorSize` e `PhysicalSectorSize`. `parsePhysicalDevice` os lê, e 0 significa desconhecido.
- `windowsUsbDeviceService.ts::readWindowsUsbDiskLayout(root)` (novo) roda o `ENUMERATE_USB_SCRIPT` uma vez, com
  o prazo adaptativo de sempre, e devolve a linha da letra ou `null`, com o motivo no log. **É um PowerShell a
  mais no preparo de pendrive.** No HD a linha já é física e nada novo roda. Nenhum script novo, nenhum prazo
  novo, e nada de polling chama essa função.
- `infrastructure/xboxDiskLayoutPolicy.ts::assessXboxLayout` (função pura) devolve `ok | rejected | unknown`, com
  os códigos `NOT_MBR`, `PARTITION_COUNT`, `MBR_TYPE`, `SECTOR_SIZE`, `NOT_FAT32` e `VOLUME_TOO_LARGE`.
  `fixableByFormat` é falso quando há `SECTOR_SIZE`, que formatar não muda.
- O portão em `prepareFixedBadAvatarDevice` fica depois da conferência de FAT32 e antes do plano:
  - sem formatar: pede para marcar "Formatar antes";
  - setor diferente de 512: diz que o dispositivo não serve ao Xbox 360;
  - depois de formatar: `reportError("badavatar-layout", …)` e mensagem de falha do formatador. Esse report não
    espera o bug de telemetria do preparo.
- Prova: `tests/unit/xboxDiskLayoutPolicy.test.cjs`, com GPT, 2 partições, `MbrType` 7, setor 4096, > 2 TiB,
  não FAT32, layout certo e desconhecido.

**T2**
- Antes de formatar, o script elevado calcula `Get-XboxLayoutProblem $disk $partitions` → `$needsNewTable`.
  - No ramo ≤ 32 GB, `$needsNewTable` pula os três formatadores que trabalham na partição existente e vai direto
    ao `diskpart clean` + `convert mbr`.
  - No ramo > 32 GB, entra no `$rawPartitionCmds` antes do `fat32format`.
  - Com a tabela recriada, o ramo é escolhido por `min(tamanho do disco, 2 TiB)`.
- Depois de formatar, o próprio script confere o layout (`Update-Disk`, `Get-Disk`, `Get-Partition -DiskNumber`):
  - se não for MBR com 1 partição: `throw`;
  - tipo fora de 11/12: `Set-Partition -MbrType 12` uma vez, e confere de novo. **Isso é deliberado:** sem a
    correção, se H2 for verdadeira, todo preparo desses pendrives pararia na conferência sem ter saída;
  - grava `Particao final: <bytes> bytes` no log.
- `formatWindowsFat32` lê essa linha antes de apagar o log, `formatVolumeFat32` devolve `{ partitionBytes }`, e o
  preparo passa esse tamanho a `waitForFormattedDevice`.
- Prova: `fat32FormatGuard.test.cjs`.
  - As funções de decisão e de conferência rodam no PowerShell com objetos falsos: GPT, MBR com 2 partições, MBR
    com 1, tipo 7 e tipo 12.
  - O script tem a decisão nos dois ramos e a conferência dentro do `try`.
  - A linha `Particao final` é lida.
  - O teste com pendrive GPT de verdade continua no critério de fechamento.

## Coordenação com os bugs abertos que mexem no mesmo código

Conferido em 2026-10-08: `git status` sem mudança pendente em `fat32Format.ts`,
`fixedBadAvatarPreparationService.ts`, `windowsUsbDeviceService.ts`, `deviceSafetyPolicy.ts` ou
`badAvatarHandlers.ts`.

| Bug aberto | O que toca | Risco para T1–T4 |
|---|---|---|
| [`electron-main-powershell-lento-…_2026-10-07T20-40`](electron-main-powershell-lento-estoura-prazo-fixo-da-enumeracao-usb-e-preparo-falha-com-pendrive-presente_2026-10-07T20-40.md) — correção aplicada na **2.12.108** (`1ea25b6`), aguardando campo | prazos do `runPowerShell`, `ENUMERATE_REMOVABLE_SCRIPT` sem `Add-Type`, enumeração suspensa durante o preparo, mensagens de `requireSafeWindowsUsbTarget` / `waitForFormattedDevice` | **mesmos arquivos.** T1 acrescenta propriedades às chamadas que já existem e, no pendrive, roda o `ENUMERATE_USB_SCRIPT` uma vez no portão — **nenhum script novo, nenhum prazo alterado**. T2 roda dentro do script elevado que já existe. Rodar os testes desse bug depois de T1 e T2 |
| [`electron-main-falha-no-preparo-…-telemetria_2026-10-04T23-28`](electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28.md) — **não implementado** | `reportError` no `catch` de `tools:badavatar-prepare` (`badAvatarHandlers.ts`) | T4 depende dele: implementá-lo primeiro (é pequeno). **Depois de T1:** a reprovação do portão **depois de formatar** já reporta sozinha (`badavatar-layout`). Quando o handler passar a reportar todo erro, essa falha vai sair duas vezes, com componentes diferentes; decidir ali se isso é aceitável. A reprovação **sem formatar** e a falha da conferência do script elevado (T2) só chegam à telemetria por este bug |
| [`electron-main-varredura-sincrona-…_2026-10-05T17-25`](electron-main-varredura-sincrona-de-jogos-instalados-congela-a-janela-e-gera-falso-timeout-de-usb_2026-10-05T17-25.md) — T1 commitada (`9258bfe`) | `setLoopAwareTimeout` em `windowsUsbDeviceService.ts` | nenhum: não tocar nessa função |
| [`release-companion-32-bits-…_2026-10-07T23-30`](release-companion-32-bits-nao-publicado-e-atualizador-trocaria-pelo-x64_2026-10-07T23-30.md) | empacotamento (`fat32format.exe` ia32) | sem conflito de código; testar T2 também no build 32 bits (PowerShell em WOW64) |
| [`badavatar-perfil-do-exploit-nao-aparece-…_2026-09-23T15-20`](badavatar-perfil-do-exploit-nao-aparece-na-tela-de-perfis_2026-09-23T15-20.md) | sem código pendente (correção na 2.12.99) | mesma família de sintoma. A hipótese "Unidade de Memória × Dispositivo USB" de lá deve ser lida com a régua da seção "Evidência" daqui, e o lid `45367823446171` da tabela de lá é o caso 2 |

## Como reproduzir

- **Defeito do formatador (T2):** pendrive real de até 32 GB (o guarda recusa disco que não seja `BusType = USB`,
  [`fat32Format.ts:238`](../../../src/electron-app/infrastructure/fat32Format.ts#L238), então VHD não serve). No
  *Gerenciamento de Disco*: excluir o volume → *Converter em disco GPT* → novo volume. Preparar no Companion com
  "Formatar antes". Esperado hoje: `Get-Disk` continua **GPT**. Esperado depois de T2: **MBR**, uma partição.
- **Caso 1:** não reproduz sem o pendrive da cliente; depende de T5.

## Critérios para fechar

- [ ] H1–H3 decididas no #153 e registradas aqui
- [x] T1 e T2 com teste unitário (`a6ac2df`, `5c08a61`; ver "Testes executados")
- [ ] Hardware: pendrive GPT preparado sai MBR, com partição única, e o Xbox o lista como "Dispositivo USB — N GB livres"
- [ ] T3 e T4 no ar: o layout do dispositivo chega à telemetria em todo preparo
- [ ] T6: docs e orientação do suporte atualizados

## Tasks

| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | portão de layout (MBR, 1 partição, tipo FAT32, setor 512, ≤ 2 TiB) nos dois caminhos do preparo | `a6ac2df` | commitado, sem release | claude-opus-5-5 | -- |
| T2 | formatador volta a garantir MBR e partição única, com conferência no script | `5c08a61` | commitado, sem release; falta o teste em hardware | claude-opus-5-5 | -- |
| T3 | arquivo de layout do preparo em `.xbox-downloader/` | -- | -- | -- | -- |
| T4 | telemetria do preparo concluído com o layout (depende do bug de telemetria do preparo) | -- | -- | -- | -- |
| T5 | decidir H1–H3 no chamado #153 | -- | -- | -- | -- |
| T6 | docs (`AGENTS.md`, `CAPACIDADE-E-ESPACO.md`) e orientação do suporte | -- | -- | -- | -- |

## Correção aplicada (T1 e T2, 2026-10-08, sem release)

**T1 — portão de layout** (`a6ac2df`)

- `infrastructure/xboxDiskLayoutPolicy.ts::assessXboxLayout` é a regra, numa função pura. Exige MBR, 1 partição,
  tipo 11/12, setor lógico de 512 bytes, FAT32 e volume ≤ 2 TiB. Linha sem layout físico dá `unknown`.
- `windowsUsbDeviceService.ts`:
  - o `ENUMERATE_USB_SCRIPT` conta todas as partições antes do filtro por letra e devolve `PartitionCount`,
    `MbrType`, `LogicalSectorSize` e `PhysicalSectorSize`;
  - `readWindowsUsbDiskLayout(root)` roda esse script uma vez para a letra.
- `fixedBadAvatarPreparationService.ts::requireXboxReadableLayout` roda depois da conferência de FAT32 e antes
  do plano:
  - linha nativa (pendrive): lê o layout físico. O HD já chega com ele;
  - layout desconhecido: passa, e o log ganha a linha `layout do disco … nao conferido`;
  - sem formatar: *"O Xbox 360 não vai ler este dispositivo como está. <motivos> Marque “Formatar antes” e tente
    novamente."*;
  - setor diferente de 512, com ou sem formatar: *"Este dispositivo não funciona no Xbox 360. <motivos> Use outro
    pendrive ou HD."*;
  - depois de formatar: `reportError("badavatar-layout", …)` com os códigos, o layout e o modelo (sem o
    serial), e mensagem de falha do formatador;
  - toda decisão com layout conhecido deixa no log do app a linha `layout do disco: <resumo> -> …`. Esse log vai
    anexo a qualquer report.
- `PhysicalUsbDevice` ganhou os quatro campos. `createDeviceFingerprint` não mudou.

**T2 — formatador** (`5c08a61`)

- Em `buildGuardedWindowsFat32Script`:
  - antes de qualquer formatador, `Get-XboxLayoutProblem` (estilo diferente de MBR, ou contagem diferente de 1)
    decide `$needsNewTable`, e o log ganha `Layout de chegada: …`;
  - o ramo é escolhido por `$targetBytes`: `min(disco, 2 TiB)` quando a tabela vai ser recriada; senão, o tamanho
    da partição;
  - ≤ 32 GB: `Format-Volume`, `fat32format` e `format.com` só rodam sem `$needsNewTable`. Com ele, o script vai
    direto ao `diskpart clean` + `convert mbr` + `format fs=fat32`;
  - > 32 GB: `if ($needsNewTable -or -not $vol)` recria a partição, sem sistema de arquivos, antes do
    `fat32format`;
  - depois de formatar: `Update-Disk`, `Get-Disk` e `Get-Partition -DiskNumber`. Se o disco não for MBR com 1
    partição, `throw`. Tipo fora de 11/12: `Set-Partition -MbrType 12`, e confere de novo. Por fim, grava
    `Particao final: <bytes> bytes`.
- `readFormattedPartitionBytes` lê essa linha, `formatVolumeFat32` devolve `{ partitionBytes }`, e o preparo
  passa esse tamanho a `waitForFormattedDevice`.
- Disco MBR com partição única, o caso comum, segue o caminho de antes. A mudança de 03/09, que evitou o modal e
  o bloqueio da unidade, continua valendo para ele.

## Testes executados (2026-10-08)

| Prova | Resultado |
|---|---|
| `npx tsc` e `npm run renderer:typecheck` | sem erro |
| `node --test tests/unit/*.test.cjs` | **277/277**: os 258 de antes, 14 de `xboxDiskLayoutPolicy.test.cjs` e 5 novos em `fat32FormatGuard.test.cjs` |
| Mutação no JS compilado, uma de cada vez | as 6 reprovaram: sem a checagem de MBR (4 falhas); portão que ignora a formatação (1); ramo ≤ 32 GB sem o teste de `$needsNewTable` (1); contagem que aceita 2 (1); sem o teste de `$null` (1); sem a conferência final (1) |
| `readWindowsUsbDiskLayout("E:\\")` no pendrive desta máquina, só leitura | a enumeração normal devolve a linha nativa, com `partitionStyle ""`. A leitura física devolve MBR, 1 partição, tipo 12, 512/512, FAT32 → `ok`, em **2,6 s**. Letra inexistente → `null`, com a linha no log |
| `Get-XboxLayoutProblem` e `Get-Fat32MbrTypeProblem` sobre os `Get-Disk`/`Get-Partition` reais, só leitura | `PartitionStyle` chega como `String`. NVMe GPT → `disco GPT, nao MBR`. USB MBR com 1 partição tipo 12 → sem problema |

**Ainda não provado:**

- o script elevado não rodou em disco nenhum, porque o shell não é administrador. Falta ver o caminho com a
  tabela recriada, a conferência final, o `Set-Partition -MbrType` num volume montado e se o `Update-Disk` é
  necessário;
- a linha de `prepareFixedBadAvatarDevice` que passa `partitionBytes` a `waitForFormattedDevice` só foi conferida
  por leitura e por `tsc`, porque o preparo não roda fora do Electron;
- custo: o portão soma um PowerShell ao preparo de pendrive (~2,6 s nesta máquina).

**Próximo passo para fechar T2:** com um build, preparar com "Formatar antes":

- um pendrive real de até 32 GB convertido para GPT (ver "Como reproduzir");
- um pendrive acima de 32 GB;
- os mesmos testes no build 32 bits (WOW64).

Em cada um, conferir no log do formatador `Layout de chegada: GPT` → `Layout final: MBR, 1 particao, tipo 12`,
e no Xbox a linha *"Dispositivo USB — N GB livres"*.

## Passagem de bastão (2026-10-08, fim da sessão de T1/T2)

- **Feito:** T1 `a6ac2df` (+ `5cb88f5`), T2 `5c08a61`, docs `3af68d6`/`667fc3c`. Árvore sem mudança minha
  pendente. `main` está 7 commits à frente do `origin` (alguns de outras sessões); **push não feito**, é do dono.
- **Decisões abertas para o dono:** (a) layout desconhecido passa (só log) — trocar para reprovar está em
  `requireXboxReadableLayout`, no `if (layout.verdict === "unknown")`; (b) `Set-Partition -MbrType 12` incluído
  antes de H2 ser decidida.
- **Próximo passo exato, escolher um:**
  1. **Teste em VHD (precisa de 1 UAC do dono):** script de teste que cria um VHD, converte para GPT, roda o
     `buildGuardedWindowsFat32Script` gerado com o guarda de `BusType = USB` relaxado **só na cópia de teste**
     e confere `Get-Disk` (MBR), `Get-Partition` (1, tipo 12) e a linha `Particao final`. Prova o caminho
     recriado, a conferência, o `Set-Partition` e o `Update-Disk`.
  2. **Hardware** (critério de fechamento): "Próximo passo para fechar T2", acima.
  3. **T6** (docs): `AGENTS.md` seção `fat32Format.ts` — trocar "Acima de 32 GB o caminho principal formata a
     partição existente…" e a frase dos "quatro caminhos de `diskpart`" pela invariante nova (GPT/2 partições →
     `clean` + `convert mbr`; conferência no script; portão `xboxDiskLayoutPolicy.ts`); idem
     `docs/CAPACIDADE-E-ESPACO.md`; registrar o portão na seção de `windowsUsbDeviceService.ts`
     (`readWindowsUsbDiskLayout` nunca em polling).
  4. **T4** depende do bug `electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria`; T3 e T5 seguem
     como na seção "Correção planejada".
- **Prova de que nada regrediu:** `cd src/electron-app && npx tsc && node --test tests/unit/*.test.cjs` → 277/277.
