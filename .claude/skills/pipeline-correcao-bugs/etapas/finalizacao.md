# Etapa 5 — Finalizacao (sessao `pipeline-finalizacao-*`)

Todas as ondas terminaram. Voce **entrega o estado organizado**: tudo integrado, a arvore principal
igual ao remoto, o ambiente de teste rodando o codigo integrado (se o projeto tem `deploy`), nada
sobrando, e um briefing que o dono entende. O `final-done` e um **portao**: ele mede tudo isso e
recusa enquanto faltar algo que e trabalho seu. **Todo git passa pelo helper**: nada de
`git commit/push/pull/worktree/rm` na mao.

O prompt traz a arvore principal, a pasta do pipeline e o **manual do projeto** (`projeto.md`); a
secao "Finalizacao" dele diz o build/deploy concreto e o formato do link do briefing.

A arvore principal JAMAIS e removida, limpa, resetada (`--hard`) ou reescrita. A unica coisa que o
pipeline faz nela e o `final-sync-main` (passo 3), que so commita, avanca por fast-forward ou
`reset --keep` — nunca descarta arquivo modificado. Qualquer outra escrita o helper recusa com
saida 13, e **saida 13 nunca se contorna**: pare e conte ao dono.

**Retomada por limite de uso:** se a mensagem do pipeline comecar com `RETOMADA APOS LIMITE DE USO`,
siga o que ela diz; nao e reprovacao nem cutucada. A sessao pode ter voltado na mesma conta ou em
outra: isso nao muda o seu roteiro.

**Pendencia do dono e so DECISAO.** Pull, apagar pasta, parar sessao, mover doc, refazer deploy sao
trabalho seu, e o portao nao deixa fechar com eles em aberto. Decisao do dono e o que o helper marca
como `PENDENCIA DO DONO` / `[DONO ]`: conflito, codigo de outra sessao que nao compila, arquivo que
outra sessao esta editando agora, arquivo modificado da pasta da propria skill (o build do projeto
nao o valida; so quem edita sabe quando terminou), pasta de origem desconhecida.

1. **Estado:** `python <helper> status` e `python <helper> reconcile`. Esperado:
   - todo bug em `retest`, `documentado` ou `open-falhou`;
   - slot livre, fila vazia;
   - nenhuma `MENSAGEM PENDENTE`, nenhuma `ETAPA 2 TRAVADA`;
   - nenhuma sessao do pipeline `busy` em `claude agents`.

   Fora disso: `python <helper> reconcile --fix`, ou resolva a causa que ele mostrar.
2. **Docs:**
   - Os bugs laterais desta execucao estao nos `new_docs` dos planos e em
     `git log -- docs/bugs/open` da execucao.
   - Duplicata (dois planners abrindo o mesmo bug) e doc a acertar: `python <helper> final-prepare`
     (a `wt-planning` vai para o fluxo principal atual). Edite **so** em `docs/` ali, junte as
     duplicatas num doc so com links, e rode
     `python <helper> final-docs --message "docs(bugs): ..."` (commit + integracao; o prefixo e o
     do manual, se ele der outro).
   - Docs de outro projeto: `python <helper> commit-external` (commit com pathspec, sem push).
3. **Arvore principal igual ao remoto:** `python <helper> final-sync-main` (em BACKGROUND: pode
   compilar). Ele:
   - commita o trabalho que outras sessoes deixaram sem commit: cada arquivo de `docs/` num commit;
     o codigo, num commit so, que **so e publicado se o build do projeto sair 0** numa lane. O que
     esta na pasta da propria skill **nunca** entra nesse commit: vira `PENDENCIA DO DONO` (o build
     nao testa o helper, e uma edicao pela metade dele ja foi publicada assim);
   - publica os commits locais (rebase numa lane, nunca na arvore principal) e iguala a arvore ao
     remoto. Os arquivos gerados de build modificados nela ficam como estao.

   Saida 0 = igual ao remoto, sem sobra. Saida 7 = ficou `PENDENCIA DO DONO`: copie cada linha para
   o briefing, com o motivo. Nao tente resolver na mao o que ele deixou como pendencia.
4. **Ambiente de teste com o codigo integrado:** `python <helper> final-deploy` (em BACKGROUND). Faz
   build e deploy do fluxo principal de uma lane e grava no ledger o SHA e o MD5 dos artefatos que
   ficaram no destino. Saida 11 = processo do app de outra pessoa rodando: `env-wait` e repita.
   Dispensado (o portao diz) quando nenhum bug chegou a etapa de teste, e sai 0 sem fazer nada num
   projeto sem `deploy`. Se depois deste passo algo publicar **codigo** (um `final-sync-main` de
   novo, por exemplo), repita-o.
5. **Limpeza:** `python <helper> cleanup`. Ele remove as worktrees de `<pasta do pipeline>\lanes\` —
   as do ledger e as que sobraram de execucoes antigas — e apaga os branches `bugfix/<slug>` de bug
   terminado. **Recusa sem apagar nada** se:
   - algum bug nao terminou;
   - um commit de `retest` nao esta no fluxo principal do remoto;
   - uma worktree tem mudanca nao commitada;
   - uma worktree tem commit que so existe nela;
   - uma sessao (background ou interativa) que NAO esta ociosa (trabalhando ou esperando o dono) tem
     cwd numa lane. A sessao de teste do ultimo bug costuma estar terminando o turno: espere e repita.

   Sessao `--bg` **ociosa** com cwd numa lane (com ou sem `.git`) ele encerra (`claude stop`) antes de
   remover: viva, ela trava a pasta no Windows. Sessao **interativa** ociosa (terminal/IDE do dono) ele
   nao alcanca (`claude stop` so para background): imprime `AVISO` com o id e segue. Pasta sem `.git`
   e com arquivo dentro que ele nao conhece **nao e apagada**: vira pendencia do dono. Nao mate o
   `daemon run` que cita a lane no `--spawned-by`: ele nao segura pasta nenhuma.

   Os branches `bugfix/*-wip` ficam (tentativas de bugs que ficaram em open), e as sobras guardadas
   ficam em stash (`pipeline-sobra <slug>`). **Cada um tem que estar citado no briefing, pelo nome,
   com o bug e o motivo** — o portao confere.
6. **Briefing** em `<pasta do pipeline>\runs\<execucao>-briefing.md`, numa pagina. Rode
   `python <helper> final-check` antes de escrever: ele mostra o que o portao ve.
   - por bug (cite o slug): veredito, estado final, commit, **onde esta o doc** (link relativo da
     pasta `runs\` ate `docs/bugs/retest/<doc>.md` na arvore principal — o manual da o formato — que
     tem que existir la);
   - corrigidos (`retest`), com o que falta para `done/` (publicacao, prova do cliente);
   - ficaram em `open`: motivo (3 devolucoes, bloqueio, sem-codigo, outro-projeto), o que destrava, e
     o `-wip`/stash que guarda a tentativa;
   - adiados por ciclo de espera e o que aconteceu com eles;
   - bugs novos abertos (aqui e no outro projeto);
   - o que o `final-sync-main` commitou de outras sessoes (SHAs) e todo `AVISO`/erro que o helper
     imprimiu nesta etapa, **literal**, mesmo que uma segunda tentativa tenha passado.

   Nao escreva secao de estado (remoto, arvore principal, ambiente de teste) nem de pendencias do
   dono: o `final-done` grava no fim do briefing o bloco "Estado verificado pelo helper", com o que
   ele mediu.
7. `python <helper> final-done --note "<resumo de uma linha>"`. Ele imprime C1–C5:
   - `[FALTA]` = trabalho seu: resolva (o texto diz qual comando) e rode de novo. Sai 2;
     `[FALTA]` que nenhum comando do helper resolve (estado ou caminho errado no ledger) e bug do
     helper: **NAO edite o `state.json`** (SKILL.md, Limites). Pare, registre no briefing e abra (ou
     atualize) o doc do bug do pipeline; sem `final-done` ate o helper ser corrigido;
   - `[DONO ]` = decisao do dono: fecha como `concluido-com-pendencias`;
   - tudo `[OK   ]` = `concluido`.

   Depois dele, termine o turno: o helper encerra esta sessao sozinho quando ela ficar ociosa.
