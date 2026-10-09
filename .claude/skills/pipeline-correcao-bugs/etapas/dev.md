# Etapa 3 — Desenvolvimento (sessao `bugNN-dev-*`)

Voce implementa a correcao planejada na secao `## Planejamento` do doc, faz o compile-check e
manda para teste. Esta sessao pode ser **retomada** pelo pipeline: com uma reprovacao do teste
(comece pelo Passo 5) ou porque um arquivo que voce esperava foi liberado.

O prompt traz a arvore principal, a pasta do pipeline e o **manual do projeto** (`projeto.md`): o
que este roteiro chama de "o manual" e o especifico do projeto (build, gerados, commit).

**Retomada por limite de uso:** se a mensagem do pipeline comecar com `RETOMADA APOS LIMITE DE USO`,
siga o que ela diz; nao e reprovacao nem cutucada. A sessao pode ter voltado na mesma conta ou em
outra: isso nao muda o seu roteiro.

## Regras

- Diretorio: `<pasta do pipeline>\lanes\wt-<n>`, worktree **so deste bug**, no branch
  `bugfix/<slug>` criado do fluxo principal. Nunca escreva na arvore principal nem rode nela git
  que escreve (reset, checkout, clean, stash, commit...). Saida 13 do helper = trava da arvore
  principal: **nunca contorne**, pare e relate.
- **Nao faca deploy nem rode o app**: o ambiente de teste e do slot de teste. Testes offline
  (scripts, validacao de JSON/XML, leitura de log) sao permitidos.
- **Edite so arquivos reservados** (o prompt lista). Precisa de outro: `python <helper> claim --bug
  <slug> --file <caminho, como o manual manda>` ANTES de editar. Saida 8 = o arquivo e de outro bug
  da onda: **commite o que ja fez** (mesmo incompleto) e rode `python <helper> park --bug <slug> --on
  <dono> --file <arquivo>`; termine o turno. O pipeline te retoma quando o dono terminar (ai rode
  `sync --bug <slug>` antes de editar o arquivo). Saida 12 = os dois bugs esperavam um ao outro:
  voce foi **adiado** para a proxima onda, com a reserva ampliada e o trabalho em
  `bugfix/<slug>-wip-adiado`; termine o turno.
- `sync` recusa (saida 2) se houver mudanca nao commitada: o helper nunca descarta edicao sua, so os
  arquivos gerados pelo build (lista no manual).
- Abriu doc em outro projeto (Passo 6 do `planning.md`)? Registre:
  `python <helper> register-external --bug <slug> --file <caminho absoluto>`.
- O planejamento e o handoff: nao refaca a pesquisa. Se o codigo desmentir o plano, **corrija o
  doc** (nota datada na secao Planejamento) e siga a versao corrigida.
- Regras do dono valem integralmente: abrir todo simbolo antes de escrever codigo sobre ele;
  invariantes das leituras obrigatorias do manual.
- **Nunca commite arquivo gerado pelo build** (o manual lista; o build na worktree os regenera com
  o caminho dela). Use `git add <caminhos>`, nunca `git add -A`/`.`.

## Passos

1. Leia o doc do bug (Planejamento inteiro), o manual e as leituras obrigatorias que ele lista.
2. Implemente as Tarefas, com os arquivos que a correcao arrasta (manual, secao Dev; todos tem que
   estar reservados).
3. Compile-check: `python <helper> build --bug <slug>`, com as flags que o manual indica. O build
   pode ser serializado entre worktrees; esperar e normal.
4. Doc: `## Correcao (pipeline <execucao>, rodada N)` com o que mudou (`arquivo::simbolo`), por que,
   e ajustes ao Plano de teste. **Rastreabilidade:** o assunto do commit segue o manual (secao Dev)
   e cita `(bug: <slug>)`; comentario no codigo, quando explicar o fix, cita `[[<slug>]]` — nunca o
   caminho `docs/bugs/open/...`, que deixa de existir quando o doc muda de pasta. Commite:
   `git add <arquivos do fix> docs/bugs/... && git commit -m "..."`. **Se o prompt traz "Assunto de
   todo commit de codigo: `<id>: ...`"**, esse prefixo vale em todo commit que mexe em codigo (e o
   vinculo com a task; o `enqueue-test` recusa com saida 2 sem ele).
5. **Retomada por reprovacao:** a falha esta documentada no doc (secao do teste) e no relatorio da
   mensagem. Corrija so o pertinente a este bug; achado nao relacionado vira bug doc novo (regra do
   Passo 5 do `planning.md`, commitado aqui). Anote `### Rodada N — reprovada: <motivo>; correcao:
   <o que mudou>`, rode o build e commite.
6. `python <helper> enqueue-test --bug <slug>` e o ULTIMO comando: ele abre (ou retoma) a sessao de
   teste deste bug. Saida 9 = o branch mexe em arquivo nao reservado: `claim` e repita. Termine o
   turno.

## Bloqueio (descobriu que nao da para corrigir aqui)

Escreva `## Bloqueio` no doc (motivo, o que foi tentado, o que destrava: telemetria, hardware,
ambiente, cliente), commite, e rode `python <helper> blocked --bug <slug> --note "<motivo curto>"`.
O helper guarda o codigo em `bugfix/<slug>-wip`, integra **so os docs** no fluxo principal e deixa o
doc em `open/`. Nao reverta codigo na mao.
