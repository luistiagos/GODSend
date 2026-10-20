# Bug: o preparo BadAvatar recomeça sozinho depois de chegar ao fim, várias vezes, sem o cliente clicar

- **Detectado em:** 2026-10-20 13:28 (chamado #18 do painel, sessão `258204978155575@lid`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/renderer/components/BadAvatarUsbPage.tsx::handlePrepare`,
  `src/electron-app/services/fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice` e
  `src/electron-app/infrastructure/simulatedTransactionalWriter.ts` (textos de progresso)
- **Classe:** falha funcional
- **Severidade:** **P2 — Médio** ([`bug-triage.md`](../../agents/skills/bug-triage.md)): o preparo terminou e o pendrive funcionou,
  mas o cliente passou ~25 min vendo a barra "voltar do começo" sem saber se podia tirar o pendrive. O agente escalou
  por isso três vezes.
- **Complexidade:** média. A causa não está provada.
- **Versão:** v2.12.98 (atualizada pelo próprio app às 03:18 UTC, [111996]).
- **Reincidência:** primeira vez registrada.

## Sintoma, na ordem que o cliente viveu

Horários em UTC, 18/09.

1. 03:21–03:22: primeiro preparo falha com `mkdir` (outro doc, ver Escopo). O agente manda abrir como administrador.
2. 03:29 [112010] *"Não consigo clicar em preparar"*; 03:29 [112012] *"Não vai"*; 03:31 [112014] *"Não vai nada"*;
   03:31 [112016] *"Vou sair e entra de novo"*.
3. 03:35 [112020]: está preparando (`Copiando … 165/646`). 03:36 [112024]: *"Ele foi sozinho / Eu não selecione nada"*.
   03:36 [112027]: *"Só cliquei para preparar"*.
4. 03:39 [112039]: `Copiando Aurora/Plugins/WebRoot/errors/404.html - 575/646`.
5. 03:44 [112050]: `Preparando a cópia... 1/646`. 03:44 [112052]: `Configurando inicialização e biblioteca do Aurora...`.
6. 03:45 [112054] *"Ele apareceu pendrive pronto / Mas voltou a barra de novo"*; [112059] *"Ta fazendo isso agora
   direto"*; [112062] *"Isso ela vai sozinha"*; [112065] *"Não tô mexendo em nada"*; [112077] *"Estranho que não para a
   barra kkk"*; [112086]–[112088] *"A barra de preparo vai até o fim e volta TD de novo / Sim fica verde / E volta do
   começo"*. Três vídeos ([112057], [112061], [112066]), que o bot não conseguiu ler.
7. 03:56 [112090]–[112095]: o app abre o catálogo *"Sozinho / Não cliquei em nada"*. O pendrive estava pronto e abriu o
   Aurora no console ([112120]).

## Evidência

**A ordem dos textos na tela não cabe numa execução só.** Numa execução de `prepareFixedBadAvatarDevice` a ordem é:

| % | texto | onde |
|---|---|---|
| 17 | `Configurando inicialização e biblioteca do Aurora…` | `fixedBadAvatarPreparationService.ts:592` |
| 24+ | `Preparando a cópia…` | `simulatedTransactionalWriter.ts:277` |
| … | `Copiando <arquivo>` i/N | `simulatedTransactionalWriter.ts:310` |
| … | `Finalizando <arquivo>` i/N | `simulatedTransactionalWriter.ts:351` |

O cliente viu `Copiando … 575/646` (03:39), **depois** `Preparando a cópia 1/646` (03:44:20) e **depois**
`Configurando inicialização…` (03:44:49). Para "Configurando" vir depois de "Preparando a cópia" é preciso uma
**execução nova**. Logo houve pelo menos três execuções (a do 575/646, a do 1/646 e a do "Configurando"), sem clique
novo, segundo o cliente.

O renderer não tem repetição automática. `handlePrepare` só roda no `onClick` do botão (`BadAvatarUsbPage.tsx:715`),
e nenhum `useEffect` chama `toolsBadAvatarPrepare`. O progresso vem de um único ouvinte global
(`onBadAvatarPrepareProgress`, linha 213), que mostra qualquer preparo em curso no processo principal.

Telemetria: nada nesta janela (0 linhas em `errors`, 18/09 03:00–05:30). Neste cliente a telemetria provavelmente
está desligada; ver o doc irmão.

## Hipóteses — nenhuma verificada

1. **Cliques enfileirados com a janela congelada — enfraquecida.** Em 03:29–03:31 o botão "não ia" (ver
   [[electron-main-varredura-sincrona-de-jogos-instalados-congela-a-janela-e-gera-falso-timeout-de-usb_2026-10-05T17-25]]).
   Mas `ipc/badAvatarHandlers.ts` **recusa**, não enfileira, um segundo pedido simultâneo: `if (preparationInProgress)
   return { ok: false, error: "Já existe uma preparação em andamento." }`. Isso vale no HEAD (linha 97) e na v2.12.98
   (`dee3a10`, linha 95). Cliques entregues juntos durante uma execução seriam recusados. Só sobrevive se os cliques
   chegaram **depois** do fim de cada execução, quando o botão volta a ficar habilitado.
2. **"Sair e entrar de novo"** (03:31) com uma execução ainda viva no processo principal: a janela reaberta mostraria o
   progresso dela pelo ouvinte global, e um clique novo somaria outra. Falta conferir se fechar a janela encerra o
   preparo em curso.
3. **Retentativa interna** do serviço ou do escritor transacional após uma falha de gravação (o volume vinha de um
   crash, com FAT suja: [[badavatar-fatal-crash-no-meio-do-jogo-deixa-o-pendrive-ilegivel-e-leva-perfil-e-saves_2026-10-20T13-28]]).
   Falta procurar laço de retentativa em `simulatedTransactionalWriter.ts`.

## Escopo — o que NÃO é este bug

- O `mkdir UNKNOWN` do primeiro preparo: [[electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28]].
- Várias instâncias do app: a trava de instância única existe desde `237a639` (2026-09-15), antes da v2.12.98
  ([[electron-main-multiplas-instancias-sem-single-instance-lock_2026-09-15T14-44]], fechado).
- O app abrir o catálogo sozinho ao terminar: é o fluxo normal depois de `refreshDrives` detectar o pendrive preparado.

## Tarefas propostas / Próximos passos

1. Abrir o caminho de fechamento da janela durante um preparo (hipótese 2) e procurar retentativa em
   `simulatedTransactionalWriter.ts` (hipótese 3). A guarda do handler já foi aberta (hipótese 1).
2. Reproduzir: dois cliques rápidos em "Preparar" com o processo principal ocupado, num pendrive de teste. Contar
   quantas vezes `Preparando a cópia…` aparece no log `APP_BADAVATAR`.
3. Se for 1 ou 2: o renderer desabilita o botão no mesmo tique do clique (ref, não estado), e o processo principal
   recusa com mensagem clara um segundo pedido para a mesma unidade.
