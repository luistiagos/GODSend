# Bug aberto: "Fatal Crash Intercepted!" ao inserir o pendrive preparado no Xbox 360

Data: 2026-09-05
Status: aberto — mitigado parcialmente, causa raiz não confirmada
Area: preparação BadAvatar USB, launch.ini/DashLaunch, hook ready-to-play do Aurora
Commits: `3a98a11` (2.12.68), `6faedab` + `906e8c4` (2.12.69, mudança e reversão)

## Sintoma

O usuário prepara o pendrive pelo **Toolbox → BadAvatar USB**, conecta no Xbox 360 e o
console exibe um banner com o texto:

```
Fatal Crash Intercepted!
```

Relato acompanhado de foto da tela. Não há, até agora, nenhuma informação sobre qual
exceção ocorreu.

## Origem da mensagem — **não confirmada**

A string `Fatal Crash Intercepted!` **não aparece em nenhum dos 643 arquivos do pacote**.
Varredura feita em ASCII, UTF-16LE e UTF-16BE, incluindo o conteúdo dos `.zip`. Isso não a
descarta: `Aurora/default.xex` e `apps/dash_launch_v3.21/Installer/default.xex` são
comprimidos/criptografados e não expõem strings.

Dois manipuladores de crash rodam nesse ambiente e qualquer um poderia emitir o banner:

1. **DashLaunch, opção `exchandler`** — ligada por padrão quando ausente do `launch.ini`,
   "attempts to handle last chance unhandled exceptions";
2. **Aurora** — demonstravelmente intercepta crashes fatais: é ele quem gerou os nove
   `Aurora/Data/Logs/*.crash.log` com os respectivos `.callstack` que vinham no pacote.

O que vale para os dois: **algo lançou uma exceção não tratada e foi interceptado**. O banner
é o sintoma, não a doença. Desligar `exchandler` apenas trocaria o aviso por um congelamento
do console — não é solução.

A documentação do lado DashLaunch está dentro do próprio pacote distribuído pelo app, em
[`apps/dash_launch_v3.21/info_launch.ini`](../../../src/electron-app/assets/badavatar-1.1/apps/dash_launch_v3.21/info_launch.ini):

```ini
; when set to false, dash launch will not attempt to handle last chance unhandled exceptions
; if set to false, exceptions will also not be dumped to the dumpfile
; if not present this is set to TRUE
exchandler = true
```

Os defaults do DashLaunch quando as opções estão ausentes do `launch.ini` — que é o nosso
caso, exceto pelo `Dumpfile` acrescentado na 2.12.68:

| Opção | Default quando ausente | Efeito |
|---|---|---|
| `exchandler` | `TRUE` | intercepta a exceção e tenta sair para o dash |
| `fatalfreeze` | `FALSE` | não congela |
| `fatalreboot` | `FALSE` | numa falha fatal o console **desliga** |
| `safereboot` | `TRUE` | reboot suave (não *jtag friendly*) |
| `Dumpfile` | vazio | texto da exceção sai **apenas pela UART** |

## Por que não foi possível diagnosticar

`generateReadyToPlayLaunchIni()` em
[`readyToPlayConfiguration.ts`](../../../src/electron-app/infrastructure/readyToPlayConfiguration.ts)
não definia `Dumpfile`. Sem ele o DashLaunch despeja a exceção só na UART — se o banner for
dele, não sobrava nenhum vestígio recuperável.

**Mitigado na 2.12.68**: o `launch.ini` gerado passa a incluir `Dumpfile = Usb:\crashlog.txt`
na seção `[Paths]`.

Se o banner for do Aurora, o vestígio já existia: ele escreve `Aurora\Data\Logs\<ts>.crash.log`
e `.callstack` no próprio pendrive. Só que o app **semeava nove dumps de outro console** na
mesma pasta, tornando impossível distinguir o dump do usuário dos que vieram no pacote. A
exclusão feita na 2.12.68 (candidato 1, abaixo) resolve isso como efeito colateral: a pasta
agora chega vazia e qualquer arquivo nela é do console do usuário.

### Próximo passo, bloqueante para fechar este bug

Pedir a quem reportou que **prepare o pendrive novamente com a versão ≥ 2.12.68**, reproduza a
falha e envie **os dois artefatos**:

- `crashlog.txt` na raiz do pendrive (caminho DashLaunch);
- todo o conteúdo de `Aurora\Data\Logs\` (caminho Aurora) — `.crash.log`, `.callstack` e
  `debug.log`.

Qual dos dois aparecer já identifica o manipulador que emitiu o banner, e ambos dão endereço
da falha e módulo.

Ressalvas do DashLaunch para esse arquivo: com mais de um dispositivo USB conectado ele pode
cair no primeiro enumerado, e o caminho é resolvido apenas no boot — no BadAvatar o pendrive
já está presente ao ligar, então isso não atrapalha.

## Candidatos a causa raiz

### 1. Estado de outro console replicado no pendrive — corrigido na 2.12.68

O pacote BadAvatar foi capturado de um console real. 26 dos seus 643 arquivos (536 KB) eram
estado daquela máquina e eram gravados byte a byte em todo pendrive preparado:

- 9 crash dumps do Aurora com os respectivos `.callstack`;
- `debug.log` / `debug.log.last` do Aurora e do FreeStyle;
- `apps/FreeStyle/Data/Databases/content.db` e `settings.db`, descrevendo 68 `ContentItems`,
  10 `RecentlyPlayedTitles`, 14 `TitleUpdates` e 5 `MountedDevices` de um **HD interno**
  (`Hdd1:`, serial `33533633424A4630334334373235202020202020`) que não existe no pendrive do
  usuário, além de uma `ScanPaths` amarrada a esse mesmo serial.

Os próprios crash dumps replicados documentam um **loop de travamento durante o scan de USB**
naquele console — ver
[`20250916014053.crash.log`](../../../src/electron-app/assets/badavatar-1.1/Aurora/Data/Logs/20250916014053.crash.log):

```
01:40:40  ProfileMonitor  0(0) - Corrupted profile!
01:40:43  ContentManager  Starting ScanPath:  \Xbox360\System\Usb0\JOGOS GOD e XEX
01:40:45  ScnProfileDVD   An error has occurred while processing the state change.
→ 0xc0000025 (non-continuable), pilha de 48 quadros com padrão de exceção-dentro-de-exceção
```

E repetiu às 01:40:53, 01:40:56 e 01:40:59. **Este é o candidato que melhor casa com o
relato** ("logo ao inserir o pendrive"), mas a correlação não é prova: os dumps são daquele
console, não do usuário que reportou.

`isForeignConsoleStatePath`, em
[`fixedBadAvatarPreparationService.ts`](../../../src/electron-app/services/fixedBadAvatarPreparationService.ts),
remove esses arquivos do plano de escrita. O perfil corrompido em
`Content/E0002FF78DFBDE7B/` continua sendo gravado: é o vetor do exploit, não estado residual.
A linha `0(0) - Corrupted profile!` nos logs é justamente ele, por design.

### 2. Laço de reinício do hook ready-to-play — em aberto, não descartado

`XboxCompanionReady.lua` é gravado em `Aurora/User/Scripts/Content/Filters/` e roda na fase
`ContentScripts` do boot. Depois de registrar os scan paths, chama `Aurora.Restart()`.

Isso é **deliberado e necessário** — ver [`READY-TO-PLAY-AURORA.md`](../../READY-TO-PLAY-AURORA.md),
"Sequência no console", itens 5 e 6: os caminhos só valem na inicialização seguinte. Uma
tentativa de remover a chamada (`6faedab`) foi revertida em `906e8c4` por quebrar o recurso.

O risco que permanece: `ensureScanPath` só devolve `false` quando encontra uma linha em
`scanpaths` com **`path` igual e `deviceid` igual**. Se o `deviceid` gravado pelo hook
divergir do que o Aurora escreve ou lê depois — normalização de serial, prefixo `_` do mount
`Game:`, diferença de caixa —, `changed` volta a ser `true` a cada boot e o "reinício uma
única vez" vira laço. Para o usuário isso se parece com o console reiniciando ou travando
logo após inserir o pendrive.

**Como conferir:** item 6 da validação física já prevista no documento ("reinicie novamente e
confirme que não ocorre loop de reinicialização"), somado a `Aurora\Data\Logs\debug.log`
procurando por repetições de `Xbox 360 Companion: caminhos configurados; reiniciando Aurora.`
Uma ocorrência por preparação é o esperado; duas ou mais confirmam o laço.

### 3. Multidisco com set incompleto — em aberto, provavelmente outro bug

O dump mais recente do pacote
([`20251004165013.crash.log`](../../../src/electron-app/assets/badavatar-1.1/Aurora/Data/Logs/20251004165013.crash.log))
mostra o Aurora derefenciando caminho vazio:

```
AuroraSql        Disc count mismatch for 0x545408A7
ContentManager   The number of discs found does not match the number of total discs for 0x545408A7
ContentManager   Registering Path:  [Disc 1]                    ← vazio
ContentManager   Registering Path:  [Disc 2] \Device\Mass0\jogos god e xex\gta v\545408a7\...
ContentManager   Successfully enabled multidisc with plugin.
ContentItem      Launch failed.  Unable to open container, 7aa7931ff6863459f017
→ 0xc0000005 em 0x80086134
```

É crash de **launch**, não de inserção, então provavelmente não é o do relato. Mas o app
passou a instalar sets multidisco em lote na 2.12.66 e já sabe, por
[`models/compat.go`](../../../src/server/models/compat.go), que o disco 1 de GTA V
(`0x545408A7`) é disco de conteúdo. Um set parcial no destino reproduz esse crash.

**Ação sugerida:** bloquear ou avisar quando o destino ficaria com um set multidisco
incompleto, reaproveitando `DiscCompatTable`.

## Decisão pendente do dono do produto

Com os defaults atuais, numa falha **fatal** o console **desliga sozinho** (`fatalreboot`
ausente ⇒ `FALSE`). Definir `fatalreboot = true` no `launch.ini` gerado o faria reiniciar.
No BadAvatar isso devolve o console ao dash retail e o usuário reaplica o exploit — pior que
não travar, melhor que apagar sem explicação. Não foi implementado: é escolha de produto.

## O que já foi feito

| Versão | Mudança |
|---|---|
| 2.12.68 | `Dumpfile = Usb:\crashlog.txt` no `launch.ini` gerado |
| 2.12.68 | 26 arquivos de estado do console de origem removidos do plano de escrita |
| 2.12.68 | `READY_TO_PLAY_CONFIGURATION_VERSION` 2 → 3 (o diário transacional vive no pendrive e recusaria o plano novo) |
| 2.12.69 | Reversão da remoção do `Aurora.Restart()` |

## Critério para fechar

1. dump de uma reprodução real, com endereço e módulo da exceção — `crashlog.txt` na raiz ou
   `Aurora\Data\Logs\*.crash.log`, o que também resolve qual manipulador emite o banner;
2. causa identificada entre os candidatos acima (ou outra);
3. correção com teste, validada em hardware conforme a lista de
   [`READY-TO-PLAY-AURORA.md`](../../READY-TO-PLAY-AURORA.md).
