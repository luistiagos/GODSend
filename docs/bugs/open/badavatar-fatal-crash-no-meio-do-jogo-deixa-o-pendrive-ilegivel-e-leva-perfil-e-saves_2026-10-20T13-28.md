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
