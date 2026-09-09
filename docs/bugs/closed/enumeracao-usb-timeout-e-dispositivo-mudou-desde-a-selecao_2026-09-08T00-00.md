# Bug: "demorou demais para listar os dispositivos USB" seguido de "o dispositivo mudou desde a seleção"

- **Detectado em:** 2026-09-08 (dois prints enviados pelo cliente, na mesma sessão)
- **Status:** **Resolvido** (v2.12.79)
- **Origem:** relato de suporte — *"toda hora quando tenta utilizar dá esta mesma mensagem, depois deu esta outra"*
- **Classe:** falha funcional recorrente (a tela continua de pé; o fluxo não anda)
- **Plataforma:** Windows
- **Recorrência:** já relatado antes e não resolvido pelas correções anteriores da mesma tela
  (v2.12.76/77/78 trataram `spawn powershell.exe ENOENT`, que é **outra** causa —
  ver [`electron-main-spawn-powershell-enoent-lista-dispositivos_2026-09-06T12-00.md`](electron-main-spawn-powershell-enoent-lista-dispositivos_2026-09-06T12-00.md))

## Sintoma

Print 1, na faixa de erro do card **Dispositivo conectado**:

```
O Windows demorou demais para listar os dispositivos USB. Remova e conecte o
pendrive novamente, aguarde alguns segundos e tente atualizar a lista.
```

Print 2, momentos depois, no mesmo fluxo:

```
O dispositivo mudou desde a seleção. Atualize a lista e selecione novamente
antes de continuar.
```

O pendrive nunca saiu da porta.

## Por que as duas mensagens são o mesmo bug

Não são duas falhas independentes. São os dois lados de um **vaivém entre os dois
caminhos de enumeração**.

| Origem | Arquivo | Papel |
|---|---|---|
| Mensagem 1 | [`windowsUsbDeviceService.ts:63`](../../../src/electron-app/infrastructure/windowsUsbDeviceService.ts#L63) | *timeout* de `runPowerShell` |
| Mensagem 2 | [`deviceSafetyPolicy.ts:204`](../../../src/electron-app/infrastructure/deviceSafetyPolicy.ts#L204) | `assertDeviceStillMatches` recusou o fingerprint |

`enumerateSafeWindowsUsbDevices()` tenta dois scripts, nesta ordem:

1. `ENUMERATE_REMOVABLE_SCRIPT` — `DriveInfo` + `mountvol`, teto de 5 s. Vence sempre
   que devolve pelo menos uma linha, então é o caminho **padrão**.
2. `ENUMERATE_USB_SCRIPT` — `Get-Disk`/`Get-Partition`/`Get-Volume`, teto de 12 s. Só a
   falha **deste** propaga para a interface; a do primeiro é engolida por um `try/catch`
   que só registra em log.

Os dois descrevem o mesmo pendrive com **identidades diferentes**: o nativo não tem
número de disco, serial nem modelo, e preenche esses campos com o GUID do volume.

## Causa raiz 1 — o fallback dependia do serviço do qual ele era o fallback

O comentário acima do script nativo diz, textualmente, que Storage Management *"pode
bloquear indefinidamente depois de uma desconexão USB instável"* e que `DriveInfo` +
`mountvol` usam caminhos Win32 independentes. E o script **chamava `Get-Volume`** —
que é Storage Management — uma vez por unidade listada, dentro do laço, só para
preencher `HealthStatus`/`OperationalStatus`/`NeedsRepair`.

Medido nesta máquina, saudável, com cache quente, dentro de um único processo:

| Passo | Custo |
|---|---|
| `[System.IO.DriveInfo]::GetDrives()` | 2 ms |
| `mountvol X: /L` | 44 ms |
| `Add-Type` (P/Invoke de `GetDiskFreeSpace`) | 187 ms |
| **`Get-Volume` — primeira chamada** | **1248 ms** |
| `Get-Volume` — chamadas seguintes | 48 ms |
| total com o *startup* do PowerShell | 1765 ms |

1248 ms de um orçamento de 5000 ms, numa máquina em que nada está errado. A primeira
chamada paga o autoload do módulo `Storage` e o CIM até o serviço. Na máquina do
cliente — que é exatamente o cenário descrito no comentário — esse serviço está
travado, a chamada não retorna, os 5 s estouram, cai-se para o script físico, que é
**100% Storage Management**, e os 12 s estouram também. **Mensagem 1.**

## Causa raiz 2 — o fingerprint não sobrevive à troca de caminho

Quando só um dos dois lados falha, o caminho de enumeração troca **entre a listagem e
a revalidação**. O fingerprint que o usuário está segurando foi emitido por um script;
a revalidação pergunta ao outro. Como as identidades diferem, o hash nunca bate:
**mensagem 2**, acusando o usuário de trocar um pendrive que não saiu da porta.

`createSyntheticRemovableFingerprint` existe para cobrir isso, mas não cobre. Ela
recalcula o hash sintético a partir do dispositivo **atual**, testando
`partitionSizeBytes` e `sizeBytes` — e o fingerprint sintético carrega
`DriveInfo.TotalSize`, que não é nenhum dos dois. Medido em volumes reais:

```
C:\  DriveInfo.TotalSize=1999303290880  Get-Partition.Size=1999303293952  (+3072 bytes)
D:\  DriveInfo.TotalSize= 512092008448  Get-Partition.Size= 512092012544  (+4096 bytes)
```

Em NTFS a diferença é de 3 a 4 KB; em FAT32 é maior, porque `TotalSize` exclui FATs e
setores reservados. Num SHA-256, 3 KB de diferença vale o mesmo que 3 TB.

**O teste que cobria essa transição passava porque usava o mesmo número dos dois
lados** (`sizeBytes: sizeBytes, partitionSizeBytes: sizeBytes`) — combinação que não
ocorre em disco real. Reproduzido em código, com os tamanhos reais de um pendrive de
64 GB:

```
listado nativo -> revalidado nativo   -> OK
listado fisico -> revalidado fisico   -> OK
listado nativo -> revalidado fisico   -> ERRO: O dispositivo mudou desde a seleção…
listado fisico -> revalidado nativo   -> ERRO: O dispositivo mudou desde a seleção…
```

Havia um resgate em `requireSafeWindowsUsbTarget`, mas só para
`matches[0].diskNumber === -1`, isto é, só quando a revalidação caiu no caminho
**nativo**. O caso sem resgate era o outro — e é o mais provável, porque o nativo é o
caminho padrão: quem lista pelo nativo e revalida pelo físico não tinha nenhuma
segunda chance.

`Get-Volume.Size`, aliás, é exatamente igual a `DriveInfo.TotalSize` nos dois volumes
medidos — mas depender dessa igualdade em FAT32 seria um palpite, e o resgate por
reexecução não precisa dela.

## Correção

**1. O script nativo não chama mais Storage Management.** As dicas de integridade
saíram para `annotateRemovableHealth()`: processo próprio, teto de 3 s, `try/catch`,
resultado descartável. Serviço travado passa a degradar o aviso *"sistema de arquivos
com inconsistências"* em vez de derrubar a lista inteira. Isso é aceitável porque
`healthStatus`/`needsRepair` **não** entram em `createDeviceFingerprint` nem em
`assessDeviceSafety` — custam uma sugestão de marcar "Formatar antes de preparar", não
uma verificação de segurança. O comentário do script agora diz que nada ali pode
chamar Storage Management, e por quê.

A sonda é **opt-in**, e isso não é detalhe: `enumerateSafeWindowsUsbDevices()` é também
o caminho de revalidação, que `createThrottledUsbTargetRevalidator` dispara a cada
`DEVICE_REVALIDATION_INTERVAL_MS` (10 s) durante toda a gravação. Ligada ali, ela
custaria ~120 chamadas a `Get-Volume` numa preparação de 20 minutos — recolocando no
caminho quente exatamente o serviço do qual esta correção tira a dependência. Só
`listFat32UsbDrives()` pede `includeHealth`, porque a lista da interface é a única
consumidora.

**2. O resgate ganhou o sentido inverso — deliberadamente assimétrico.** A decisão
virou uma função pura em `deviceSafetyPolicy.ts`, `planRevalidationRetry()`:

| Linha atual | Retentativa | Por quê |
|---|---|---|
| nativa (`diskNumber === -1`) | script físico | o físico traz `isReadOnly`, `isOffline`, `isBoot`/`isSystem` e contagem de partições reais: só pode apertar o veredito |
| física, `allowed`, `Removable` | script nativo | é o único que reproduz o fingerprint sintético que o usuário está segurando |
| física, **bloqueada** | nenhuma | as linhas nativas fixam aquelas flags no valor permissivo e a contagem de partições em 1; resgatar aqui devolveria como segura uma unidade recém-recusada — pendrive com trava de gravação, ou com uma segunda partição montada |
| física, `Fixed` (HD USB) | nenhuma | o script nativo pula tudo que não é `Removable`: a retentativa não produziria linha nenhuma, só um processo e um timeout antes do mesmo erro |

A primeira versão desta correção **não** tinha as duas últimas linhas da tabela: ela
reexecutava o script nativo em qualquer falha, inclusive na de segurança. Como
`assertDeviceStillMatches` lança tanto para identidade divergente quanto para
`Operação bloqueada: …`, um pendrive protegido contra gravação podia ser recusado pelo
caminho físico e liberado pelo nativo, chegando a `formatVolumeFat32`. Foi pego em
revisão, antes de sair do diff.

Os dois ramos passaram a compartilhar `revalidateWithScript()`.

## Testes

[`tests/unit/deviceSafetyPolicy.test.cjs`](../../../src/electron-app/tests/unit/deviceSafetyPolicy.test.cjs):
novo caso *"com tamanhos reais, a tolerância sintética não cobre a troca de caminho de
enumeração"*, que fixa as duas recusas acima e explica por que o resgate por
reexecução é necessário, mais quatro casos sobre `planRevalidationRetry()` — incluindo
os dois em que a retentativa é recusada, que são a correção do achado de revisão. O
teste antigo ganhou o aviso de que seus tamanhos iguais são artificiais.

Como `windowsUsbDeviceService.ts` importa `serverLog.ts`, que importa `electron`, ele
não é carregável em teste unitário — foi essa a razão de a decisão de retentativa virar
função pura em `deviceSafetyPolicy.ts`, que só depende de `crypto`. Verificado por
mutação: inverter a escolha de caminho em `planRevalidationRetry()` derruba 4 testes
(antes da extração, a mesma inversão no ternário deixava a suíte inteira verde).

Sintaxe dos scripts PowerShell validada com
`[System.Management.Automation.Language.Parser]::ParseFile`, e a sonda de integridade
executada de ponta a ponta (1628 ms, JSON no formato esperado). Suíte completa: 158
testes, 0 falhas.

## O que continua aberto

Sem nenhum pendrive **removível** conectado, o script físico continua sendo executado
em toda atualização da lista — HDs USB aparecem como `Fixed`, não `Removable`, e só o
caminho físico os encontra. Numa máquina com Storage Management travado *e* nenhum
pendrive na porta, a mensagem 1 ainda é possível. Ela deixa de aparecer com o
dispositivo conectado, que é o cenário do relato.

A causa **na máquina do cliente** — por que o Storage Management trava ali — continua
sem diagnóstico; o app apenas deixou de depender dele para listar pendrives. Desde a
v2.12.77 a falha de enumeração vai para a telemetria com a linha de
`describeWindowsExecutableEnvironment()`, então o próximo caso chega com dados em vez
de foto.

`diagnoseDrive()` (`driveRepairService.ts:38`) roda `Get-Volume` **sem timeout
nenhum** — se aquele serviço travar, a promise nunca resolve. Não está no caminho
desta correção (é acionada por `tools:drive-diagnose`, que a interface hoje não
chama), mas é a mesma armadilha e vale corrigir antes de alguém ligar esse canal.
