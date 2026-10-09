---
name: pipeline-correcao-bugs
description: >-
  Pipeline automatico de correcao dos bugs abertos do projeto (docs/bugs/open do repo), em 5
  etapas com sessoes visiveis no gerenciador de sessoes (`claude agents`): 1 Planning em paralelo
  (4 por vez; complexidade, severidade, arquivos a alterar, bugs novos no projeto certo), 2 Elencar
  em ondas de arquivos disjuntos da menor para a maior complexidade, 3 Desenvolvimento numa worktree
  por bug, 4 Testes pontuais com fila exclusiva E2E (reprovado volta ao dev ate 3 vezes; aprovado e
  integrado no fluxo principal e o doc vai para retest), 5 Finalizacao com briefing. So roda
  quando o dono chama `/pipeline-correcao-bugs`. Argumentos: vazio ou `iniciar` | `iniciar tasks`
  (tasks abertas do projeto em vez de bugs, se o projeto tem `tarefas`) | `status` | `reconcile` |
  `preflight`.
disable-model-invocation: true
---

> **Execucao so a pedido do dono.** Esta skill nunca e disparada por iniciativa propria, nem
> agendada (`/loop`, cron): abre dezenas de sessoes Opus e faz push. Depois de iniciada, as etapas
> encadeiam sozinhas ate a finalizacao; `status` e `reconcile` tambem so quando o dono pedir.

# Pipeline de correcao de bugs — maestro

Voce e o **maestro**: confere o ambiente, monta a lista de bugs, dispara e acompanha. **Nao
planeja nem corrige bug** (isso e das sessoes de etapa) e **nao escreve na arvore principal**
(o checkout do repo). A Etapa 2 (ondas) nao e voce: e mecanica, feita pelo helper quando o ultimo planning
termina.

Arquivos desta skill:

- `DESIGN.md` — por que o pipeline e assim (fatos medidos, decisoes do dono, hipoteses descartadas).
- `etapas/planning.md`, `etapas/dev.md`, `etapas/teste.md`, `etapas/finalizacao.md` — roteiro de
  cada sessao, generico; o helper injeta o caminho no prompt.
- `projeto.json` — config do projeto que o MOTOR le (repo, raiz, base, remoto, build, deploy,
  gerados, rodizio). `projeto.md` — **manual do projeto**: caminhos, app, E2E, exemplos; as etapas o
  citam e o helper injeta o caminho dele no prompt. Os dois sao do projeto e a sincronizacao das
  copias nunca os sobrescreve (DESIGN secao 22).
- `scripts/pipeline.py` — **toda** transicao, spawn de sessao, onda, reserva de arquivo, fila e
  slot de teste. Ledger em `<pasta do pipeline>\state.json`.

Leia o `projeto.md` antes de tudo: ele da a arvore principal, a pasta do pipeline, o fluxo
principal e o comando do helper deste projeto. `H` abaixo = `python "<pasta desta skill>\scripts\pipeline.py"`
(o caminho absoluto esta no `projeto.md`, secao Caminhos).

**Onde a skill mora:** versionada no git, numa pasta `pipeline-correcao-bugs/` do repo (o
`projeto.md` diz a deste projeto: `skills/` com *junction* em `.claude/skills/`, ou direto em
`.claude/skills/` onde `.claude/` e versionado) — fora de `docs/` de proposito: o helper trata tudo
sob `docs/` como documentacao (publica na reprovacao, nao conta como codigo), e isto e codigo (DESIGN
secao 14). Edite sempre o arquivo versionado. Uma worktree do pipeline tambem contem uma copia da
skill, na versao daquele branch: as sessoes de etapa usam a da arvore principal, cujo caminho
absoluto o helper injeta no prompt.

**Fonte e copias:** a fonte e `C:\projects\retrobatnew\source\skills\pipeline-correcao-bugs`; os
outros repos tem COPIA versionada. Na copia, so `projeto.json` e `projeto.md` se editam; motor,
etapas, `SKILL.md` e `DESIGN.md` se mudam na fonte e vao para as copias com
`python <fonte>\scripts\sync_copias.py --commit` (`--check` so relata). O `preflight` de uma copia
avisa quando ela difere da fonte (DESIGN 22.8, A2).

## Fluxo

```
1 PLANNING (4 por vez, wt-planning compartilhada, read-only no codigo)
   |  plan-done -> corrigir | sem-codigo | outro-projeto | bloqueado (os 3 ultimos: documentado)
   v  (o ultimo plan-done) helper commita + integra os docs do planning
2 ELENCAR: onda = menor complexidade restante + cada seguinte cujos arquivos sejam disjuntos da
   uniao da onda (max 4). Proxima onda so quando TODOS os bugs da onda atual terminam.
   v
3 DEV (wt-<n> + bugfix/<slug> por bug) -- claim/park para arquivo fora da reserva;
   espera circular (A espera B que espera A) -> quem pediu por ultimo e ADIADO para a proxima onda
   |  enqueue-test
   v
4 TESTE: fase offline (paralela) -> slot-request -> fila E2E exclusiva -> sync -> controle
   positivo (--at-base) -> deploy -> T2/T3/T4
   |-- reprovado: doc + relatorio -> dev (ate 3 devolucoes; depois: so docs integrados, open)
   '-- aprovado: doc -> retest, publish (rebase + push ff no fluxo principal), sessoes encerradas
   v  (ultima onda terminou)
5 FINALIZACAO: docs deduplicados -> final-sync-main (arvore principal = origin) -> final-deploy
   (ambiente de teste = remoto, se o projeto tem deploy) -> cleanup -> briefing -> final-done (PORTAO: mede C1-C5; `concluido` ou
   `concluido-com-pendencias`, este so com decisao do dono em aberto)
```

Modelo: Opus 5.5 em todas. Planning e finalizacao com effort `medium` + `ultrathink`; dev e teste
com o effort/ultrathink que o planning daquele bug decidiu. `ultrathink` vale por mensagem, entao o
helper o repete em toda mensagem de retomada. Modelo, effort e permissoes sao os do nascimento da
sessao: a retomada vai sem flags (com flag o CLI abre uma copia — DESIGN secao 19).

## Modo `preflight` (e Passo 0 de `iniciar`)

`H preflight`: CLI, o manual do projeto, os itens `preflight` do `projeto.json` (build, runtime,
ferramentas do projeto), e spawn + listagem + stop/resume de uma sessao de teste em
`<pasta do pipeline>\lanes\wt-planning`, e o trust do repositorio (o de uma worktree git e o do repo
principal; a raiz confiavel NAO basta — DESIGN secao 15). VERMELHO -> pare e diga ao dono o que
fazer. Caso conhecido: **"Workspace not trusted"** -> o dono roda o `claude.exe` num terminal na
arvore principal (o `projeto.md` da o caminho), aceita e sai. Aceite unico. Nunca contorne editando `~/.claude.json`.

O preflight tambem confere o **rodizio de contas** (linhas `contas:`; secao "Rodizio de contas"
abaixo). Com o rodizio ligado, valida cada conta com um `claude -p` barato (~5 s cada, pelo token no
env; nao troca a conta ativa nem toca o arquivo de credenciais) e marca INVALIDA a que der erro de
autenticacao. VERMELHO: `CLAUDE_CONFIG_DIR` definido, arquivo de credenciais ausente ou ilegivel,
`.token` que nao decifra, ou todas as contas invalidas. AVISO: nenhuma conta, 1 conta, rodizio
pausado, conta invalida ou esgotada, token vencendo, erro de troca, e o vigia morto sem devolver o
`/login` (o dono roda `accounts restore`).

A sessao de teste e **encerrada** (`claude stop`) no fim do preflight, inclusive em erro: viva, com
cwd na lane, ela trava a pasta no Windows e o `cleanup` deixa pasta vazia presa (bug
`pipeline-daemon-claude-bg-orfao-trava-pasta-da-lane_2026-10-02`). A conversa continua no
gerenciador (`claude logs`). Pasta de lane presa: a linha de comando de processo NAO mostra cwd —
`claude agents --json` mostra (`cwd` de cada sessao); nao culpe o daemon pelo `--spawned-by`.

## Modo `iniciar` (padrao)

1. **Execucao ativa?** Se `H status` mostra bug fora de `retest`/`documentado`/`open-falhou`, ou a
   finalizacao rodando, nao crie outra: mostre o status e ofereca `reconcile`.
2. **Arvore principal suja ou divergente:** o `preflight` imprime `[AVISO] arvore principal: ...`
   (commits locais nao publicados, commits atras do origin, arquivos reais nao commitados, skill
   diferente da do origin). Havendo qualquer `[AVISO]`, mostre-os ao dono e pergunte
   (AskUserQuestion) se segue assim. Diga o que cada um implica:
   - commits locais: o pipeline parte do fluxo principal do remoto e nao os ve (doc que so existe
     neles fica fora); publicar antes e um `git push` do branch (comando no `projeto.md`), que nao
     mexe na arvore de trabalho;
   - atras do origin / skill diferente: **a skill que roda e a da arvore principal**; correcao da
     skill que so esta no origin nao vale nesta execucao;
   - arquivos nao commitados: a finalizacao commita os de `docs/` (um commit por arquivo) e so
     publica codigo se compilar; o que sobrar fecha a execucao como `concluido-com-pendencias`.
   - `[AVISO] contas: ...`: diga o que muda (sem rodizio, a execucao para no limite de uso e espera
     o dono; com rodizio, o aviso fixo da maquina inteira na conta do pipeline). Conta invalida ou
     token vencendo: o dono troca o token **no PowerShell dele** antes de iniciar, se quiser.
3. **Lista de bugs** (so exclusoes mecanicas; diagnostico e do planning). Para cada
   `docs/bugs/open/*.md` da arvore principal exceto `README.md` (ignore `.txt`/`.json`; nas subpastas
   tambem, se o `projeto.md` disser que os bugs moram nelas, e o `doc` guarda a subpasta), exclua com
   motivo (`<repo>` = arvore principal, `<base>` = fluxo principal, os dois no `projeto.md`):
   - ausente na base: `git -C <repo> cat-file -e <base>:docs/bugs/open/<doc>` falha;
   - sujo na arvore principal (`git -C <repo> status --porcelain -- <doc>` nao vazio): outra sessao
     esta nele;
   - ja tem `## Planejamento` ou `## Bloqueio` de execucao anterior com veredito diferente de
     `corrigir` e nada mudou desde entao.

   **`iniciar tasks`** (so com `tarefas` no `projeto.json`; sem, diga ao dono e pare): a lista sao as
   tasks, nao os bugs. Para cada arquivo do TOPO da `tarefas.pasta` NA BASE cujo nome casa
   `tarefas.arquivo` (`git -C <repo> ls-tree --name-only <base>:<pasta>`; subpastas sao evidencia e
   ficam fora), leia o campo `tarefas.campo_status` em `<base>`: entra se estiver em `tarefas.abertas`;
   em `tarefas.em_andamento` fica EXCLUIDA com o motivo "ha sessao escrevendo codigo nela" (o dono a
   inclui pelo nome, se quiser); as outras exclusoes acima valem igual. O item vai com
   `"tipo": "task"`. Uma execucao pode misturar bug e task, se o dono pedir.
4. Grave `<pasta do pipeline>\bugs-<AAAAMMDD-HHMM>.json`:
   `{"bugs": [{"slug": "<arquivo sem extensao>", "doc": "docs/bugs/open/<arquivo>.md", "title": "...",
   "tipo": "bug | task (padrao bug)"}], "excluded": [{"doc": "...", "reason": "..."}]}`. Mostre a lista, os excluidos com motivo e o
   custo: cada bug corrigivel = 3 sessoes Opus (planning, dev, teste), mais retomadas. Pergunte se
   inicia, a menos que tenha sido chamado com `auto`.
5. `H init --bugs <arquivo>` e `H start`. Relate as sessoes de planning abertas e como acompanhar:
   - `claude agents` no terminal (`claude attach <id>` entra numa sessao);
   - `/pipeline-correcao-bugs status` aqui; ondas em `<pasta do pipeline>\runs\<execucao>-ondas.md`;
   - `/pipeline-correcao-bugs reconcile` quando algo parecer parado (nunca agendado).
   Se o E2E do projeto toma teclado e tela (o `projeto.md` diz), avise: a maquina deve ficar ociosa
   nas janelas de teste.

## Vigia interno (sem agendamento)

Toda transicao que uma sessao chama no helper roda tambem o `tick`, que:
- reentrega mensagem que nao pode ser entregue (sessao alvo ocupada, CLI falhou);
- encerra (`claude stop`) as sessoes de bugs que ja terminaram;
- cutuca **ate 2 vezes** uma etapa cuja sessao ficou ociosa por mais de 1 h sem chamar a transicao;
- despacha o slot de teste e abre a proxima onda.

Ele nunca mexe na sessao de quem chamou. Enquanto alguma sessao do pipeline trabalha, o resto se
destrava sozinho; so quando TUDO para e que precisa do dono (`status`/`reconcile`).

Sessao parada por **limite de uso** da conta nao e "ociosa": o `tick` le o transcript antes de
cutucar. Com o rodizio ligado, ele nao a cutuca (quem retoma e o vigia de cota); sem rodizio, adia
a cutucada ate 2 min depois do reset (o `reconcile --fix` cutuca na hora).

## Rodizio de contas (limite de uso)

Desenho: DESIGN secao 20 (e o documento que o `projeto.md` cita). Aqui so o que o maestro e o dono
precisam saber.

- **So no projeto com `"rodizio_contas": true` no `projeto.json`** (DESIGN 22.6). Desligado, o
  helper nunca escreve na guarda de contas nem no arquivo de credenciais: a execucao para no limite
  de uso e espera o reset, os `accounts add/remove/activate/validate/restore` recusam, e o
  `preflight`/`status`/`reconcile` dizem "rodizio desligado neste projeto". O resto desta secao vale
  so com ele ligado.

- **Ligado** = 2 ou mais contas cadastradas e sem `accounts restore`. Com 0 ou 1 conta, ou pausado,
  o pipeline roda sem rodizio: uma execucao que bate o limite para e espera o reset.
- **Cadastro: so o dono, num PowerShell comum, fora de sessao do Claude.** `H accounts add --label X
  [--email Y]` le o token do `claude setup-token` sem eco, pelo stdin (nunca por argumento).
  `add`, `remove`, `activate`, `restore` e `validate` recusam rodar dentro de uma sessao; aqui so
  roda `H accounts list`. **Nunca peca o token no chat nem monte comando com ele**: o dono digita no
  shell dele.
- **Como a conta troca:** o helper grava a conta ativa no bloco `claudeAiOauth` de
  `~/.claude/.credentials.json` (o resto do arquivo, inclusive o login dos MCP, fica). Antes, o
  `/login` do dono vai cifrado para `~/.claude-accounts\login.bak`; no fim da execucao ele volta
  sozinho.
- **Efeito na maquina inteira (aceito pelo dono):** durante a execucao, **toda sessao desta
  maquina usa a conta ativa** do pipeline, inclusive as interativas ja abertas (na requisicao
  seguinte), e elas ficam **sem os conectores do claude.ai** (`/mcp` vazio) ate o `/login` voltar.
  Um `/login` manual e desfeito na conferencia seguinte. Para o dono usar a conta dele no meio da
  execucao: `accounts restore` (devolve o `/login` e pausa o rodizio); `accounts activate --label X`
  religa.
- **Vigia de cota (`quota-watch`):** processo interno, aberto pelo proprio helper (`start`, `tick`,
  `reconcile --fix`), um por maquina, com log em `<pasta do pipeline>\runs\<execucao>-cota.log`. Le o
  transcript das sessoes, gira para a proxima conta disponivel e retoma a sessao parada com a
  mensagem `RETOMADA APOS LIMITE DE USO` (o mesmo sessionId).
- **Todas esgotadas:** o arquivo ja passa para a conta que volta primeiro, e o vigia dorme ate o
  reset + 2 min e retoma tudo. Na espera, as sessoes interativas do dono tambem ficam sem cota;
  `accounts restore` resolve.
- **Todas invalidas:** o `/login` volta sozinho. O dono gera token novo (`claude setup-token`) e roda
  `accounts add --label X`; a passada seguinte grava a conta e retoma.
- **Vigia morto** (reboot, kill): volta numa transicao de qualquer sessao ou com `reconcile --fix`.
  Com todas as sessoes paradas, so o `reconcile --fix` o religa (nao ha tarefa no Agendador).
  Conta do rodizio no arquivo, sem execucao aberta e sem vigia: `reconcile` e `preflight` avisam.
  Se o aviso diz "desde o `accounts activate` de HH:MM", **nao e vigia morto**: o dono armou o
  rodizio para a execucao que vai abrir (o vigia so sobe no `start`); siga com `init` + `start`, e o
  `status` mostra "armado por `accounts activate`". Sem essa marca, o aviso da as duas leituras: vigia
  morto -> o dono roda `accounts restore` num PowerShell comum; activate dele -> siga. Nunca mande
  `accounts restore` sem perguntar: ele pausa o rodizio.
- **`accounts remove` da ativa** gira para a proxima na hora, e recusa se nenhuma outra estiver
  disponivel.
- **"precisa do dono" no `status`:**
  - erro de autenticacao que a validacao nao confirma, ou arquivo de credenciais disputado, 3 vezes
    seguidas na etapa: o vigia para de retomar aquela etapa. O dono resolve a causa (token novo;
    processo que regrava o arquivo) e retoma a sessao a mao (`claude attach <id>` e uma mensagem).
    Quando ela responde, o contador zera. **Nao edite o ledger**;
  - "o /login devolvido nao respondeu": o dono faz `/login`;
  - "erro de troca": a gravacao do arquivo falhou; o vigia tenta de novo a cada passada. Se ficar,
    conte ao dono.

## Modo `status`

`H status` e `H reconcile` (sem `--fix`, so relata). Resuma:
- etapa e onda de cada bug;
- quem segura o slot, e a fila;
- quem espera arquivo de quem;
- mensagens pendentes e Etapa 2 travada, se houver;
- o que parou e ja esgotou as cutucadas;
- terminados, por desfecho.

## Modo `reconcile`

`H reconcile --fix`: o mesmo vigia com tolerancia de 45 min e **sem o teto de cutucadas** (o dono
pediu), mais a nova tentativa da Etapa 2 se a integracao dos docs do planning falhou. Se a mesma
etapa parar de novo depois disso, nao insista: `claude attach`, leia onde travou e conte ao dono.

## Limites

- **A arvore principal JAMAIS e apagada, limpa, resetada ou
  reescrita pelo pipeline, de maneira alguma** — nem no `cleanup`, nem para "destravar" algo, nem a
  pedido de uma sessao de etapa. Ela e compartilhada com o dono e outras sessoes e tem trabalho nao
  commitado de terceiros. O helper impoe isso em codigo (`guard_wt`, `guard_branch` e
  `refuse_main_tree`, saida 13). **Unica excecao (decisao do dono, 2026-10-03):** o `final-sync-main`
  da finalizacao, que so faz o que nao destroi trabalho — commit por pathspec do que outras sessoes
  deixaram, `merge --ff-only` e `reset --keep` (aborta inteiro se um arquivo modificado estiver no
  caminho). `reset --hard`, `checkout`, `clean`, `stash` e `rebase` continuam saida 13 ate dentro dele. **Saida 13 nunca se contorna**: rodar o comando na mao, mexer no
  helper para passar, ou editar o ledger e proibido; pare e conte ao dono.

- Fim automatico e `retest/`. `done/` so com prova de cliente/publicacao, decidido pelo dono.
- Bug novo aberto durante a execucao **nao** entra nela; fica para a proxima.
- Severidade e registrada, mas nao ordena (decisao do dono em 2026-10-02; pode entrar depois).
- Nunca editar `state.json` a mao. Estado errado -> corrigir o `pipeline.py` e registrar no `DESIGN.md`.
