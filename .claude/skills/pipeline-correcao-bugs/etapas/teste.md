# Etapa 4 — Testes (sessao `bugNN-teste-*`)

Teste **pontual**: provar que a correcao corrigiu este bug sem criar outro. Nao e a suite inteira.
O que conta como prova e a regra do dono: **ponta a ponta** (o app real, pelo caminho do usuario
quando o fix toca menu/fluxo) **com controle positivo**. "Conferido por leitura" nao aprova.

O prompt traz a arvore principal, a pasta do pipeline e o **manual do projeto** (`projeto.md`): o
que este roteiro chama de "o manual" e o especifico do projeto. **Leia a secao "Teste (E2E)" do
manual antes do Passo 1**: onde o app roda, como o build chega la, a tabela T2/T3/T4 concreta, onde
fica a evidencia e as regras do ambiente compartilhado.

Esta sessao e retomada (a) quando o slot E2E fica seu e (b) numa rodada nova, depois que o dev
corrigiu o que voce reprovou. Rodada nova = refazer **todos** os passos desde o Passo 1.

Diretorio: a worktree do bug (`wt-<n>`, branch `bugfix/<slug>`). Nunca escreva na arvore principal
nem rode nela git que escreve. Saida 13 do helper = trava da arvore principal: **nunca contorne**,
pare e relate.

**Onde o teste roda: como o usuario.** A worktree guarda so o FONTE e o build deste bug. Com
`deploy` no projeto, ele leva esse build para o ambiente unico de teste, e cada bug o usa por vez (o
slot); sem `deploy`, o teste roda a partir da worktree, ainda dentro do slot. O manual diz qual e o
caso.

**Retomada por limite de uso:** se a mensagem do pipeline comecar com `RETOMADA APOS LIMITE DE USO`,
siga o que ela diz; nao e reprovacao nem cutucada. A sessao pode ter voltado na mesma conta ou em
outra: isso nao muda o seu roteiro.

## Passo 1 — Fase offline (sem slot, roda em paralelo com outros bugs)

- Confira que a diff (`git diff <base>...HEAD`) implementa as Tarefas do Planejamento e so toca
  arquivos reservados.
- Rode a parte **Offline** do Plano de teste (scripts, validacao de JSON/XML/manifest, testes que
  nao usam o ambiente de teste nem abrem o app).
- Falhou aqui -> Passo 7 (reprovado), sem pedir slot.

## Passo 2 — Pedir o slot E2E

`python <helper> slot-request --bug <slug>`.

- `SLOT CONCEDIDO` -> Passo 3.
- Saida 10 (`NA FILA`) -> termine o turno. O pipeline retoma esta sessao com "SLOT CONCEDIDO".

O E2E e sempre exclusivo: cada bug tem o PROPRIO build, e o ambiente de teste so comporta um por
vez. Quando dois testes seus podem rodar juntos dentro do slot, o manual diz.

## Passo 3 — Ambiente

`python <helper> env-wait --minutes 9`. Ele procura os processos do app que o projeto declara (em
qualquer lugar) e qualquer processo rodando de dentro das pastas do ambiente de teste.

- `AMBIENTE LIVRE` -> Passo 4.
- Saida 11 (`OCUPADO: ...`) = outra sessao, ou o dono, esta usando. **Nao mate.** Repita o
  `env-wait` (cada chamada espera ate 9 min) por ate ~2 h. Continuou ocupado: rode
  `python <helper> test-done --bug <slug> --result ambiente --note "<o que estava aberto>"` e
  termine. O bug volta a fila com 30 min de espera, sem contar como reprovacao.

Falha do ambiente sem relacao com o bug (o manual da os casos) tambem e ambiente, nao reprovacao.

## Passo 4 — Integrar e controle positivo

1. `python <helper> sync --bug <slug>` (rebase no fluxo principal). Saida 4 = conflito: Passo 7
   com a lista de arquivos em conflito.
2. `python <helper> deploy --bug <slug> --at-base` (ambiente SEM o fix) e rode a **T2**: o SINAL do
   sintoma TEM que aparecer. Nao apareceu -> o teste nao detecta o bug: Passo 7 com "T2 nao
   reproduz na base: <o que foi observado>". Controle impossivel e justificado no doc -> registre e
   siga. Projeto sem `deploy` (o helper recusa com saida 2): rode a T2 na base pelo caminho que o
   manual da.

## Passo 5 — Deploy do fix e testes

`python <helper> deploy --bug <slug>` (ou o caminho sem deploy do manual); confira, como o manual
manda, que o binario em execucao e o recem-construido. Evidencia onde o manual manda (o scratchpad
e descartavel).

| Nivel | O que | Criterio |
|---|---|---|
| T2 | **o usuario de novo**: o mesmo caminho do controle positivo, no app, pela UI, agora com o fix | sinal do sintoma AUSENTE e comportamento correto PRESENTE |
| T3 | regressao direcionada do Plano de teste | sem `fail` novo |
| T4 | logs da janela de teste | sem erro novo atribuivel ao fix |

As ferramentas e os logs de cada nivel estao na tabela do manual. Ambiente compartilhado: descarte
evidencia contaminada por uso alheio (filtre pela hora e pelo PID do SEU launch), mate so os PIDs
que voce abriu, e em config compartilhada insira/remova SO as suas linhas.

## Passo 6 — Classificar

Falha **pertinente**: sintoma persiste, regressao num caminho que o fix tocou, build quebrado,
conflito. **Nao pertinente**: a mesma falha acontece na base — prove com `deploy --at-base` e so o
teste que falhou. Nao pertinente vira bug doc novo e nao reprova este bug:
- deste projeto: `docs/bugs/open/` nesta worktree, commitado;
- outro projeto: Passo 6 do `planning.md`, sem commitar la, e registre com
  `python <helper> register-external --bug <slug> --file <caminho absoluto>`.

## Passo 7 — Reprovado

1. No doc do bug: `### Teste rodada N — reprovado` com o teste que falhou, esperado x observado,
   caminho da evidencia e o motivo. E o registro que fica em `open/` se esta for a ultima rodada.
   Se o doc ja estava em `retest/` (a reprovacao veio depois do Passo 8.1: base nova, conflito),
   edite-o onde estiver e **nao o mova a mao**: o `test-done --result fail` o devolve para `open/`
   com uma nota de reprovacao no topo, e a integracao so-docs recusa um bug reprovado em `retest/`.
   O mesmo vale para o campo de estado de uma task ja marcada concluida: nao o reverta a mao.
2. Commite o doc e os bugs laterais (`git add docs/bugs/... && git commit -m "docs(bugs): teste
   rodada N de <slug> reprovado"`; se o manual der outro prefixo para commit de docs, use o dele).
3. Relatorio em `<pasta do pipeline>\reports\<slug>-r<N>.md` (mesmo conteudo, mais o que voce NAO
   conseguiu testar).
4. `python <helper> test-done --bug <slug> --result fail --report <relatorio>`. O helper libera o
   slot e: se ainda ha devolucao (ate 3), retoma a sessao de dev com o relatorio; se nao, integra
   **so os docs** no fluxo principal, guarda o codigo em `bugfix/<slug>-wip` e deixa o bug em
   `open/`. Termine o turno.

## Passo 8 — Aprovado: integrar no fluxo principal

1. `git mv docs/bugs/open/<doc> docs/bugs/retest/` e escreva no topo a secao `## Status` pedida em
   `docs/bugs/retest/README.md`: o que foi corrigido, commits, evidencia de cada T, o que falta para
   `done/`. Confirme o fix NOS ARQUIVOS (`git diff <base>..HEAD`) antes de mover.
   **Com task** (o prompt cita "Doc da task" ou "Task deste bug"): no cabecalho da task, o campo de
   estado vai para o valor de concluida e a data de conclusao e preenchida (nomes e valores no
   manual). Item task nao muda de pasta: so o campo muda. O helper confere os dois no `test-done
   pass` (saida 2 se faltar) e, numa reprovacao depois disto, devolve o campo sozinho.
2. Commite `docs(bugs): <slug> corrigido e testado -> retest` (ou o prefixo do manual), com os bugs
   laterais. O doc vai para `retest/` no MESMO push do fix: se a sessao cair no meio, nao fica fix
   publicado com doc em `open/`.
3. `python <helper> publish --bug <slug>`: rebase + push fast-forward no fluxo principal (historico
   linear, sem merge commit), sob lock.
   - Saida 3 = o fluxo principal recebeu codigo depois do seu sync: volte ao Passo 4 e refaca 4–6
     (no maximo 2 vezes; na 3a, reprove explicando).
   - Saida 4 (conflito) ou 5 (arquivo gerado no commit): Passo 7 para o dev.
   - Saida 17 (push RECUSADO sem ser corrida: gancho do repo, regra de assunto de commit, rede): a
     saida do git esta no erro. Regra de commit violada pelo branch -> Passo 7 para o dev, citando
     a saida; rede/ambiente -> `test-done --result ambiente`. Nunca contorne o gancho.
4. `python <helper> test-done --bug <slug> --result pass --note "<resumo>"`. O helper encerra as
   sessoes deste bug (planning, dev, teste: `claude stop`, a conversa continua no gerenciador).
