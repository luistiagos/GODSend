# Bug: o preparo BadAvatar recomeça sozinho depois de chegar ao fim, várias vezes, sem o cliente clicar

## Status

- **Corrigido em:** 2026-10-20, commit `56cbd14` (v2.12.113, não publicada).
- **Onde:** `src/electron-app/renderer/components/BadAvatarUsbPage.tsx::canPrepare` (exige `!done`), o rótulo do
  botão ("Pendrive pronto") e o `onChange` do seletor de unidade (zera `done`/`status`). `renderer-dist` rebuildado.
- **T2 (UI, sem disco):** Electron real (`main.js`) com `tools:badavatar-list-drives`, `-is-admin` e `-prepare`
  trocados por falsos no processo principal; prepara, espera o verde e aciona o botão 3× (clique + Enter).
  Controle positivo com o `renderer-dist` anterior: botão "Preparar pendrive/HD" habilitado, **4** preparos.
  Com o fix: botão "Pendrive pronto" desabilitado, **1** preparo. Evidência (script e prints):
  `C:\projects\.bugfix-xbox360\evidencia\20261020-1500-badavatar-preparo-recomeca-sozinho-depois-de-chegar-ao-fim_2026-10-20T13-28\`.
- **T3:** `npm --prefix src/electron-app run test:safety` → 345 pass / 0 fail (inclui `tsc` e `renderer:typecheck`).
  Go não foi tocado.
- **Falta para `closed/`:** publicar a 2.12.113 (`build-and-upload.ps1`, do dono); preparo real no pendrive de teste
  (serial `247700023090`, desconectado nesta sessão) conferindo o botão depois do verde; prova do cliente. A ORIGEM
  do acionamento repetido no PC do cliente segue sem prova (ver Conclusão): se ele voltar a ver tela trocando
  sozinha em outro ponto do app, é o mesmo fenômeno de entrada, não o preparo.

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
- O app abrir o catálogo sozinho ao terminar: ~~é o fluxo normal~~ — corrigido na Análise: também exige clique.

## Análise (2026-10-20, sessão de correção)

### Símbolos abertos

- `infrastructure/simulatedTransactionalWriter.ts::executeTransactionalWrite` — **não há laço de retentativa**. Um erro
  sai pelo `catch`, que só relança. Diário `completed` com os arquivos conferindo devolve `resumed: true` sem
  regravar e **sem** emitir o 100% (sai depois de reler os 646 arquivos). Hipótese 3 descartada.
- `services/fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice` — percentuais de uma execução são
  monotônicos: 1–2 (registros de falha), ≤12 (formatação), 13, 14, 17 `Configurando…`, 20, 23, 24 `Preparando a
  cópia…`, 27–87 `Copiando`, 89–99 `Finalizando` (o contador i/N volta a 1, a barra não), 100. **A barra só volta
  ao começo com execução nova.** Em erro propaga (o `finally` só apaga a pasta de staging).
- `ipc/badAvatarHandlers.ts` (`tools:badavatar-prepare`) — recusa pedido simultâneo; não tem nada que dispare
  execução por conta própria.
- `app/window.ts::createMainWindow` — fechar a janela só a esconde (bandeja); reabrir pelo `.exe` cai no
  `second-instance` e foca a MESMA janela e o mesmo renderer. Não cria execução. Hipótese 2 não gera execução nova.
- `renderer/components/BadAvatarUsbPage.tsx::handlePrepare` — só é chamada pelo `onClick` do botão (linha 715);
  nenhum `keydown`, `.click()` ou efeito a chama (grep em `renderer/`). Depois de um sucesso, `setBusy(false)`
  **reabilita o botão "Preparar" no mesmo lugar**, embora o pendrive já esteja pronto.
- `renderer/components/HomePage.tsx::checkPreparedDevice` (varredura de 5 s) e
  `services/preparedUsbDetection.ts::nextStepAfterPreparedUsbScan` — não mexem no passo `usb`; não remontam a
  página. Iguais na v2.12.98 (`git show dee3a10:...preparedUsbDetection.ts`).
- `renderer/App.tsx` — nada navega para `browse` sem clique. **O "catálogo abriu sozinho" das 03:56 também exige
  um clique** (o "Adicionar jogos" do quadro de concluído, ou o "Pular e ir para o catálogo"): o item do Escopo
  que dizia "fluxo normal" estava errado.

### Mensagens do chamado (consulta `chamado.py sql "SELECT id, role, dttime, message FROM Wpp_proccess WHERE id IN (...)"`)

| id | hora UTC | o que a tela mostrava |
|---|---|---|
| 112020 / 112024 | 03:35:53 / 03:36:33 | `Copiando apps/Aurora/... 165/646` / `182/646` (botão "Preparando...") |
| 112039 | 03:39:06 | `Copiando Aurora/Plugins/WebRoot/errors/404.html 575/646` (mesma execução: `apps/` vem antes na ordem) |
| 112048 | 03:43:00 | barra "quase completa" |
| 112050 | 03:44:20 | `Preparando a cópia... 1/646` — execução nova |
| 112052 | 03:44:49 | `Configurando inicialização e biblioteca do Aurora...` — outra execução nova |
| 112054 | 03:45:26 | "apareceu pendrive pronto, mas voltou a barra de novo" |

Os vídeos (112057, 112061, 112066, 112079) estão só como `[VÍDEO]` no banco; não há o arquivo.

### Conclusão

Cada ciclo é curto porque, com o pendrive já pronto, o escritor só confere e sai: "vai até o fim, fica verde, volta
do começo". O que reinicia é um acionamento do botão "Preparar" logo que ele volta a ficar habilitado — e o
catálogo aberto às 03:56 mostra que havia acionamento sem o cliente perceber (tecla presa com foco no botão,
mouse/touchpad com clique repetido sob o cursor, cliques enfileirados com a janela travada). **A origem desse
acionamento não é provável sem os vídeos ou o PC do cliente**; o defeito do app é que um preparo concluído rearma o
botão no mesmo lugar e qualquer acionamento recomeça tudo, sem pergunta e sem sinal de que já terminou.

### Hipóteses descartadas

- Retentativa interna (hipótese 3): não existe laço no escritor nem no serviço.
- Janela fechada com execução viva (hipótese 2): fechar só esconde; reabrir foca o mesmo renderer; nada inicia.
- Varredura de 5 s da Home remontando a página: `nextStepAfterPreparedUsbScan` não sai do passo `usb`.
- Ref em vez de estado para o `busy` (tarefa 3 antiga): no React 19 o `setBusy(true)` de um evento de clique é
  aplicado antes do evento seguinte, e o handler já recusa pedido simultâneo; não resolve o ciclo, que acontece
  **depois** de cada fim.

### O que fazer

- **T1** `BadAvatarUsbPage.tsx`: depois de um preparo concluído, o botão fica desabilitado e diz "Pendrive pronto"
  (`canPrepare` exige `!done`); escolher outra unidade na lista volta a habilitar. Prova: `renderer:typecheck` +
  `test:safety`, e na UI: preparar, esperar o verde, clicar/Enter de novo no botão → nenhuma execução nova
  (`APP_BADAVATAR` sem segundo `Preparando a cópia`).

## Tarefas propostas / Próximos passos

1. Abrir o caminho de fechamento da janela durante um preparo (hipótese 2) e procurar retentativa em
   `simulatedTransactionalWriter.ts` (hipótese 3). A guarda do handler já foi aberta (hipótese 1).
2. Reproduzir: dois cliques rápidos em "Preparar" com o processo principal ocupado, num pendrive de teste. Contar
   quantas vezes `Preparando a cópia…` aparece no log `APP_BADAVATAR`.
3. Se for 1 ou 2: o renderer desabilita o botão no mesmo tique do clique (ref, não estado), e o processo principal
   recusa com mensagem clara um segundo pedido para a mesma unidade.
