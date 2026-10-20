# Bug: "fatal" no meio do jogo deixa o pendrive BadAvatar ilegível no Xbox, e o cliente perde perfil e saves — duas vezes no mesmo cliente

- **Detectado em:** 2026-10-20 13:28 (chamados #18 e #233 do painel, sessão `258204978155575@lid`, telefone `5513988813688`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/infrastructure/readyToPlayConfiguration.ts::generateReadyToPlayLaunchIni`
  e `src/electron-app/services/fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice`
- **Classe:** crash (console) + perda de dados no dispositivo
- **Severidade:** **P0 — Crítico** pela matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md) (crash de console com
  corrupção de FAT32). **Provisória:** ainda não está provado que a causa é nossa. Custo medido: duas vezes o cliente perdeu
  o progresso inteiro ("Tava bem longe"), refez o preparo do pendrive de madrugada (~1h40 em 18/09) e voltou hoje para o
  suporte.
- **Complexidade:** alta. Falta o dump (ver Hipóteses), e o crash acontece no console, durante o jogo.
- **Reincidência:** no mesmo cliente, 18/09 e 20/10. Não é o [[2026-09-05-fatal-crash-intercepted-pendrive-preparado]] (fechado):
  aquele é crash **no boot/inserção** do pendrive; aqui o console bootou, o Aurora abriu e o cliente jogou por semanas.

## Sintoma, na ordem que o cliente viveu

Horários em UTC (o cliente está em UTC-3).

1. **26–28/08:** comprou, preparou o pendrive de 29,3 GB (FAT32) com a **v2.12.43**, instalou o PES 2018 e jogou. O perfil
   dele ("Julio") aparece na tela de perfis com **"Unidade de Memória"** ([87415], 28/08). Ou seja, o perfil e os saves
   ficam **no próprio pendrive**.
2. **18/09 03:09** ([111960]–[111963]): *"Mas apareceu uma msg de fatal finishi"* / *"E apagou td"* /
   *"Agora o pendrive não aparece mais nada"* / *"Né lê no game"*. No PC o pendrive abre e mostra pastas
   (`Content`, `Content\0000000000000000`, `Content\EE6287EC0E5C58B3`, que é pasta de perfil; [111981]–[111987]).
3. **18/09 03:39** ([112041]–[112043]): *"Perdi TD o meu jogo"* / *"Tava bem longe"*.
4. Repreparou **sem** formatar (já na **v2.12.98**, atualizada na hora), e o pendrive voltou a abrir o Aurora. Mas duas
   gravações seguidas do PES 2018 falharam no dispositivo:
   - [112163] 04:20: `GOD convert failed: falha no dispositivo local: fase con…`
   - [112193] 04:28: `Extract failed: falha no dispositivo local: fase extra…`
   - [112199] *"Não aparece nada"* (o pendrive sumiu do "Este Computador");
   - [112216] o Windows não consegue apagar: *"O nome de arquivo especificado é inválido ou muito longo"*.
5. **18/09 04:43**: preparo **com "Formatar antes"** ([112230]). Depois disso o PES 2018 gravou ([112547], 13:35:
   *"Deu TD certo ta / O jogo já tá no pendrive"*).
6. **20/10 15:34** (chamado #233, [148862]–[148867]): *"Aconteceu de novo / Travou o pen drive e deu erro igual a outra
   vez"* / *"perdi TD de novo"* / *"Coloquei o pendrive no Pc e apareceu isso"* + print (sem descrição da visão no
   banco) / *"O que aconteceu"*.

## Evidência

- Ids de `Wpp_proccess` acima, todos lidos na conversa inteira (`chamado.py conversa-lid 258204978155575@lid`, 997 msgs).
- **A sequência do item 4 é a de um FAT32 sujo:** o Windows lista os arquivos, mas falha ao gravar e ao apagar entradas
  ("nome inválido ou muito longo" num arquivo que o próprio app gravou). Só o formatar resolveu.
- **Telemetria vazia nas duas janelas.** `errors` com `project LIKE 'xbox-360-companion%'`:
  - 18/09 03:00–05:30 UTC: **0 linhas**, embora o pipeline (v2.12.98) tenha mostrado duas falhas de dispositivo local
    na tela. Outros clientes reportaram falhas do mesmo tipo na mesma noite (7219, 7232, 7253), então o endpoint
    estava no ar. Explicação mais provável: `errorReporting` desligado nesta instalação (não verificado).
  - 20/10 14:00–18:00 UTC: só o 11001 (Alice Madness Returns, espaço insuficiente), que **não** dá para ligar a este
    cliente.
- **O pendrive de hoje tem como deixar um dump.** O `launch.ini` canônico grava `Dumpfile = Usb:\crashlog.txt`
  (`readyToPlayConfiguration.ts:17`, desde `3a98a11`, v2.12.68). O pendrive do crash de 20/10 foi preparado em 18/09
  com a v2.12.98, que já tinha essa linha. O crash de 18/09 não tem dump: aquele pendrive era da v2.12.43.
- **O próximo preparo recolhe o dump antes de formatar:** `prepareFixedBadAvatarDevice` chama
  `reportConsoleCrashArtifacts(request.driveRoot, …)` antes do `if (request.formatDrive)`
  (`fixedBadAvatarPreparationService.ts:529-539`). Isso só sai do PC se a telemetria do cliente estiver ligada; pelo
  item acima, provavelmente não está.

## Hipóteses — nenhuma verificada

1. **O crash é do jogo/console e o dano ao pendrive é consequência.** O DashLaunch intercepta a exceção; sem
   `fatalreboot` o console desliga (tabela de defaults no doc fechado de 09-05). Se o desligamento cai durante uma
   gravação de save no FAT32 do pendrive, a FAT fica suja. O BadAvatar/Aurora então não sobe, e os saves vão junto.
   Para medir: o `crashlog.txt` do pendrive de 20/10 (módulo e endereço da exceção).
2. **O próprio `Dumpfile` no pendrive piora o dano:** o DashLaunch grava o dump no mesmo FAT32 durante a exceção. Para
   medir: data/tamanho do `crashlog.txt` contra o estado da FAT (`chkdsk /f` em modo leitura antes de reparar).
3. **O pendrive (hardware) é fraco**, e o crash e o dano vêm dele. Para medir: `chkdsk` + teste de superfície. Um segundo
   pendrive, se o cliente arranjar, isola a hipótese ("Não tenho", [112197]).
4. **Jogo específico:** os dois episódios podem ser no PES 2018 (o único jogo citado). Para confirmar: perguntar ao
   cliente que jogo estava aberto hoje.

## Escopo — o que NÃO é este bug

- O crash **no boot** ao inserir o pendrive: fechado em [[2026-09-05-fatal-crash-intercepted-pendrive-preparado]].
- O "Não Formatado" logo depois de preparar: [[badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09]]
  (retest). Aqui o pendrive funcionou por semanas antes de falhar.
- A barra do preparo que recomeça sozinha na mesma noite: doc próprio,
  [[badavatar-preparo-recomeca-sozinho-depois-de-chegar-ao-fim_2026-10-20T13-28]].
- O `mkdir UNKNOWN` no primeiro preparo de 18/09: anexado em
  [[electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28]].
- O agente dizendo ao cliente que o "fatal" acontece se o pendrive é *"removido no meio de um processo"* ([112035]):
  é afirmação inventada, registrada do lado do agente
  (`digitalstoregamesproject/docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-10-20-agente-xbox360-inventa-explicacoes-sobre-o-pendrive-o-preparo-e-a-tela-do-aurora.md`).

## Tarefas propostas / Próximos passos

1. **Antes de qualquer reparo/preparo deste pendrive:** pedir ao cliente o `crashlog.txt` da raiz (print da raiz +
   o arquivo pelo WhatsApp), ou ligar a telemetria e repreparar, que recolhe o dump antes de formatar. Sem isso a
   hipótese 1 não sai do lugar.
2. Medir se é caso isolado: `errors` com componente `badavatar-console-crash` desde a v2.12.96, separando dump de boot
   e dump com jogo em execução.
3. Se a hipótese 1 se confirmar: avaliar o que o app controla.
   - (a) Ao detectar um pendrive já preparado com FAT suja, oferecer o reparo (`driveRepairService`) em vez de
     repreparar por cima. Em 18/09 o app aceitou repreparar um volume sujo e as gravações seguintes falharam.
   - (b) Avisar no fim do preparo que perfil/saves no pendrive somem junto se ele corromper. Se o console tiver HD
     interno, orientar a mover o perfil para lá.
4. Quem fecha: um dump de reprodução real lido, com causa isolada; ou a prova de que a causa é o jogo/hardware, com o
   app reagindo (3a) ao volume sujo.

## Análise 2026-10-20 (sessão de correção)

**Veredito: sem correção de código por ora.** Nenhuma hipótese tem evidência, e as tarefas 3a/3b dependem da hipótese 1.

Símbolos abertos:
- `infrastructure/readyToPlayConfiguration.ts::generateReadyToPlayLaunchIni` — grava `Dumpfile = Usb:\crashlog.txt`; não há
  `fatalreboot`.
- `services/fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice` — recolhe os vestígios
  (`reportConsoleCrashArtifacts`) antes de formatar. **Não confere a saúde do FAT32** antes de repreparar sem formatar: só
  `fileSystem === "FAT32"`, layout e espaço. É esse o ponto onde a 3a entraria.
- `services/fixedBadAvatarPreparationService.ts::reportConsoleCrashArtifacts` — nunca lança; em erro só faz `appendAppEvent`.
- `infrastructure/consoleCrashArtifacts.ts` — procura `crashlog.txt` na raiz e `Aurora/Data/Logs`; só lê pendrive com
  marcador `ready-to-play-v*.marker`.
- `services/driveRepairService.ts::diagnoseDrive` — usa `Get-Volume` (HealthStatus/OperationalStatus). **Não verificado**
  se isso enxerga um FAT32 sujo (dirty bit / `ClnShutBit` da FAT[1]); `fsutil dirty query` e `chkdsk` pedem admin. Em
  erro devolve `needsRepair: false` (mente "íntegro"), então não serve de portão sem prova. `repairDrive` roda
  `chkdsk /f /x`.

Medição (tarefa 2):
- `python chamado.py sql "SELECT id, time, project, LEFT(message,300) m FROM errors WHERE method='prepareFixedBadAvatarDevice' AND message LIKE '%falha do console%' ORDER BY id DESC LIMIT 40"`
  → **18 linhas** (`xbox-360-companion/badavatar-console-crash`, 7608 de 20/09 a 10715 de 19/10). **Nenhuma traz
  `crashlog.txt`** do DashLaunch: 16 são só `debug.log`/`debug.log.last` do Aurora e 2 (7734, 8238) trazem o mesmo
  `20051122102107.crash.log` (+ `.callstack`) do Aurora. Ou seja: em um mês, o `Dumpfile` nunca chegou à telemetria.
  Isso não prova que ele não grava (pode não ter havido "fatal" nesses pendrives), mas tira a esperança de que o dump
  deste cliente chegue sozinho.

Hipóteses descartadas: nenhuma nesta sessão.

Próximo passo exato: continua a tarefa 1 (suporte pedir o `crashlog.txt` e o print da raiz ao cliente, **antes** de ele
repreparar/formatar). Com o dump em mãos, ler o módulo/endereço e decidir entre jogo, DashLaunch ou hardware.

### 3a — como detectar o volume sujo (análise, dono escolheu a 3a em 2026-10-20)

- **O "sujo" do Windows é só um bit do boot sector.** Fonte do FastFAT (`microsoft/Windows-driver-samples`,
  `filesys/fastfat`): `verfysup.c::FatCheckDirtyBit` lê `CurrentHead & FAT_BOOT_SECTOR_DIRTY` (0x01, byte de flags NT do
  boot sector) e liga `VCB_STATE_FLAG_MOUNTED_DIRTY`; `fsctrl.c::FatIsVolumeDirty` (FSCTL_IS_VOLUME_DIRTY, 0x90078)
  devolve só esse flag. A FAT[1] (`ClnShutBit`) **não** é lida para isso. `FatIsVolumeDirty` não confere acesso: basta
  um handle `UserVolumeOpen`.
- **Consequência:** o bit só fica ligado se quem escreveu por último segue a convenção NT. O Windows segue (desconexão
  no meio de uma gravação no PC). **Não se sabe se o kernel do Xbox 360 liga esse bit** — se não ligar, a detecção não
  vê justamente a corrupção deste bug (crash no console).
- **Sem admin, sem prova em FAT:** nesta máquina (sem admin, sem pendrive), `CreateFileW("\\.\C:", 0x80)` +
  FSCTL_IS_VOLUME_DIRTY deu `ERROR_INVALID_FUNCTION` (1) em NTFS; `GENERIC_READ` deu `ERROR_ACCESS_DENIED` (5). Em FAT32
  removível não testado.
- **Sinal alternativo, sem admin:** o sintoma de 18/09 (o Windows lista a entrada mas não consegue apagá-la: "nome
  inválido ou muito longo") é uma entrada de diretório que `readdir` devolve e `lstat` não abre. Uma varredura
  `readdir` + `lstat` do pendrive acharia isso. Não testado; custo proporcional ao número de arquivos (o chkdsk levou
  16 min para 65.912).
- **Prova que falta para qualquer caminho:** um pendrive FAT32 de verdade — (1) o FSCTL sem admin; (2) um pendrive
  sujo (ex.: pendrive que o Xbox deixou corrompido, ou um arrancado no meio de uma gravação no PC).

**Prova num pendrive real (E:, FAT32 removível de 15,5 GB, sem admin, só leitura), 2026-10-20:**
- `CreateFileW("\\.\E:", GENERIC_READ, share 3)` + FSCTL_IS_VOLUME_DIRTY → `state 0` (limpo). Com acesso `0` ou
  `0x80` → `ERROR_INVALID_FUNCTION`: sem acesso a dados o handle vai para o volume, não para o FastFAT. Em `C:` (fixo)
  `GENERIC_READ` → `ERROR_ACCESS_DENIED`; em removível abre. **Falta o controle positivo** (volume sujo → 1): pede admin
  (`fsutil dirty set E:`) ou um pendrive sujo de verdade. Fica para o retest.
- Varredura `readdir` + `lstat` (Node): 10.942 arquivos, 210 pastas, **0 falhas, 11,1 s**. Sem falso positivo. Falta o
  controle positivo (pendrive com entrada corrompida).

### Tarefas da 3a
1. `src/electron-app/services/driveRepairService.ts` — `isVolumeDirty(root)` (FSCTL acima via PowerShell; `null` em
   erro, nunca "limpo") e `findBrokenEntries(root)` (readdir+lstat; conta só código de corrupção, não `EACCES`/`EPERM`/
   `EBUSY`). Teste: `tests/unit/driveRepairService.test.cjs` com `lstat`/`readdir` simulados.
2. `src/electron-app/services/fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice` — sem "Formatar antes",
   depois de recolher os vestígios e antes de qualquer gravação: volume sujo ou entrada quebrada → erro que manda usar
   "Reparar (CHKDSK)" em "Jogos Instalados" (preserva o que der dos saves) ou marcar "Formatar antes" (apaga tudo).
   Verificação que falha (`null`) não bloqueia, só registra. Teste: tsc + unidade da tarefa 1.

### 3a implementada (2.12.114)

- Feito como planejado, em `requireCleanFileSystem()` (exportada, chamada em `prepareFixedBadAvatarDevice` a 3%, depois
  de `reportConsoleCrashArtifacts`, só quando `formatDrive` é falso).
- **A implementação corrigiu a análise em dois pontos:**
  - Na primeira rodada do portão no pendrive E:, a varredura acusou 5 arquivos `ENOENT` (`godsend-fat32-test-…/Games/EA FC
    26/faces/face_121xx_….rx3`) que abriram em todas as rodadas seguintes. Causa não achada. Por isso `findBrokenEntries`
    **repete a chamada que falhou** em cada suspeito depois da varredura e só acusa o que falha duas vezes.
  - `'\\.\${driveLetter}:'` dentro do `String.raw` não interpola (o `\` antes de `${` escapa a substituição). O
    PowerShell recebia o texto literal e o `CreateFileW` dava erro 2. O caminho agora é montado fora do template.
- Prova pelo caminho real (`gate.js` com o JS compilado, no E:): `isVolumeDirty` → `false` em 1,4 s; `findBrokenEntries`
  → `[]` em ~12 s; portão passou. `C:` (fixo) → `null` por acesso negado (erro 5), sem bloquear.
- `npm run test:safety` → 349/349.
- **Continua faltando:** o controle positivo (pendrive sujo de verdade → bloqueia), para o retest. O bug **fica em
  `open`**, porque a causa do crash (tarefa 1, o `crashlog.txt`) não foi resolvida.
