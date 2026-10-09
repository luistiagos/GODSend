# Etapa 1 — Planning (sessao `bugNN-planning-*`)

Voce diagnostica e planeja UM bug. **Nao altera codigo.** Ate 4 sessoes de planning rodam ao mesmo
tempo; o que voce grava e a entrada mecanica da Etapa 2 (ondas) e o handoff para o dev, que comeca
do zero e le so o doc.

O prompt traz a arvore principal, a pasta do pipeline e o **manual do projeto** (`projeto.md`): o
que este roteiro chama de "o manual" e o especifico do projeto (app, build, exemplos, outro projeto).

**Retomada por limite de uso:** se a mensagem do pipeline comecar com `RETOMADA APOS LIMITE DE USO`,
siga o que ela diz; nao e reprovacao nem cutucada. A sessao pode ter voltado na mesma conta ou em
outra: isso nao muda o seu roteiro.

## Onde voce esta, e o que nao pode fazer

- Diretorio: `<pasta do pipeline>\lanes\wt-planning`, uma worktree do repo no fluxo principal,
  **compartilhada pelos planners em paralelo**.
- Voce so ESCREVE: o doc do seu bug e docs de bugs novos que abrir. Nenhum outro arquivo.
- **Nenhum git que escreve** (`add`, `commit`, `checkout`, `stash`, `reset`, `mv`): a worktree e de
  todos os planners, e o helper commita e integra os docs de todos ao abrir a Etapa 2.
- **Nao rode o app nem faca deploy**: o ambiente de teste e compartilhado e pertence ao slot de
  teste. A reproducao vira receita no Plano de teste; quem executa e a sessao de teste.
- Nunca escreva na arvore principal, e nunca rode nela git que escreve. Saida 13 do helper = trava
  da arvore principal: **nunca contorne**, pare e relate.

## Passos

1. Leia o manual, as leituras obrigatorias que ele lista (regras de manutencao, template e criterio
   de complexidade) e o doc do bug inteiro, mais os bugs que ele cita.
2. Investigue pelas regras do dono: abra todo simbolo que vai citar (funcao inteira, retorno,
   caminho de erro); prove participacao num fluxo pelo call-site, nunca pelo nome.
3. Veredito:
   - `corrigir` — ha correcao neste repo, provavel de testar aqui;
   - `sem-codigo` — e deste projeto mas nao envolve codigo (exemplos no manual): diga a acao e quem
     a faz;
   - `outro-projeto` — nao ha nada a corrigir aqui; o conserto e de outro projeto (qual, no manual):
     abra o bug la (Passo 6) e documente aqui;
   - `bloqueado` — depende de telemetria inexistente, hardware, ambiente ou do cliente (exemplos no
     manual): diga o que destrava.
4. Grave no doc, sem apagar o historico, a secao abaixo (o planejamento habitual do projeto mais os
   campos que o pipeline consome):

   ```markdown
   ## Planejamento (pipeline <execucao>, <data>)

   **Veredito:** corrigir | sem-codigo | outro-projeto | bloqueado — <uma frase>
   **Complexidade:** baixa | media | alta — <criterio do docs/bugs/open/README.md>
   **Severidade:** critico | alto | medio | baixo — <por que>
   **Arquivos a alterar (reserva da onda):**
   - `<caminho relativo ao repo>` — o que muda

   ### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)
   ### Provas (comando literal -> resultado)
   ### Hipoteses descartadas (e por que)
   ### Tarefas
   - [ ] `arquivo::simbolo` — o que mudar — teste que prova
   ### Plano de teste
   - **Offline (sem slot):** o que da para provar sem o ambiente de teste nem o app.
   - **T2 reproducao como o usuario (E2E, no slot):** o caminho que o USUARIO fez quando achou o
     bug, no app como o usuario o roda: estado de partida, cada acao na UI e o SINAL objetivo do
     sintoma (linha de log, exit code, caixa de erro, screenshot, arquivo). O que isso e neste
     projeto (onde o app roda, o que chamar direto so como complemento, nunca substituto) esta no
     manual, secao Planning. So bug sem caminho de usuario (harness, build, empacotamento) dispensa
     a UI, com o motivo escrito.
   - **Controle positivo:** como o sintoma aparece SEM o fix (`deploy --at-base`), ou por que nao ha.
   - **T3 regressao direcionada:** fluxos vizinhos que o fix pode quebrar e a receita.
   ### Sessoes seguintes
   - dev: effort <nivel>, ultrathink <sim/nao> — <por que>
   - teste: effort <nivel>, ultrathink <sim/nao> — <por que>
   ```

   **Severidade:** `critico` = o app nao abre, perde dados/saves, ou atinge todo usuario; `alto` =
   sistema ou fluxo principal inutilizavel sem contorno; `medio` = falha com contorno, ou so num
   subconjunto; `baixo` = cosmetico ou raro.

   **A lista de arquivos e uma RESERVA.** Arquivo fora dela, se outro bug da onda o tiver, faz o
   dev esperar o outro bug terminar. Liste tambem os que a correcao arrasta (o manual diz quais
   neste projeto: arquivo de projeto, recursos de texto, lista de build, catalogo). Caminhos como o
   manual manda (secao Caminhos).

   **Effort/ultrathink das sessoes seguintes** e decisao sua, pelo bug: `low`/`medium` para troca
   mecanica e localizada; `high` para logica com varios caminhos (exemplo no manual); `xhigh`/`max`
   para concorrencia nativa, deadlock, causa raiz ainda ambigua. `ultrathink` quando o trabalho e de
   raciocinio (nao de digitacao). Teste costuma pedir menos que dev, salvo quando classificar a
   falha e sutil.
   **Item task** (o prompt diz `Task:` e "Doc da task"): o item desta execucao e uma TASK ja aberta do
   projeto, nao um bug. Nao ha sintoma: o que se planeja e o `Objetivo` e o `Como validar` dela (ou o
   equivalente do modelo de task do manual). Grave a secao acima na propria task; o veredito, os
   arquivos e o Plano de teste valem do mesmo jeito (a T2 prova o objetivo pelo caminho do usuario).

   **Task do bug** (o prompt diz "Este projeto exige TASK"): com veredito `corrigir`, o fix precisa de
   uma task do projeto (pasta, nome e modelo no manual). Primeiro procure uma aberta (ou em andamento)
   que ja cite o doc deste bug; nao havendo, rode `python <helper> task-reserve --bug <slug>` (ele da
   o numero, unico entre os planners em paralelo e as sessoes humanas) e crie a task com ESSE numero,
   no modelo do manual, citando o doc do bug; acrescente o id da task no doc do bug. O caminho dela
   vai em `task` no JSON do Passo 7. Nunca escolha o numero sozinho.

   **Dependencia:** se este item so pode ser corrigido depois de outro DESTA execucao (o fix dele
   muda o que este toca), ponha o slug em `depende_de`. O item so entra numa onda depois que a
   dependencia passar; se ela nao passar, este fica em open com o motivo.
5. Bug novo deste projeto achado no caminho: procure duplicata em `docs/bugs/{open,retest,done}`
   **e** nos arquivos novos ainda nao commitados desta worktree (`git status --porcelain docs`, que
   so le), porque outro planner pode ter acabado de abrir o mesmo. Novo -> doc em `docs/bugs/open/`
   no template, com `- **Origem:** achado lateral do pipeline em <slug>`. Ja existe -> acrescente a
   evidencia. Nao o investigue alem do necessario para registrar.
6. Bug de outro projeto: rota, formato e regra de commit estao no manual, secao "Bug de outro
   projeto". Escreva o arquivo e **nao commite** la (o helper commita com pathspec). Cruze os dois
   docs por link.
7. Grave `<pasta do pipeline>\reports\<slug>-plan.json`:

   ```json
   {"verdict": "corrigir", "complexity": "media", "severity": "alto",
    "files": ["<caminho relativo ao repo>"],
    "effort": {"dev": "high", "teste": "medium"},
    "ultrathink": {"dev": true, "teste": false},
    "new_docs": ["docs/bugs/open/<lateral>.md"],
    "external_docs": ["<caminho absoluto do doc no outro projeto>"],
    "task": "<caminho da task, relativo ao repo; so na Task do bug>",
    "depende_de": ["<slug de outro item desta execucao>"],
    "summary": "<uma frase>"}
   ```

   `files`, `effort` e `ultrathink` so sao exigidos com `verdict: corrigir`; `task`, so quando o
   projeto exige task para bug; `depende_de` e opcional.
8. `python <helper> plan-done --bug <slug> --json <arquivo>` e o ULTIMO comando. Saida 2 (plano
   invalido): corrija o JSON e repita. Qualquer outra saida: nao tente de novo nem contorne; relate
   o erro e termine (o plano ja pode ter sido gravado; quem cuida e o `status`/`reconcile`). Saida
   0: termine o turno.
