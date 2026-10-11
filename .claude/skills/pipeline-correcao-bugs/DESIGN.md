# Pipeline de correcao de bugs — registro de analise e decisoes

Gravado em 2026-10-02, antes de escrever o codigo da skill (regra "duas etapas"). Se a
implementacao desmentir algo daqui, corrigir ESTE arquivo.

## 1. Pedido original (resumo)

Triar todos os bugs de `source/docs/bugs/open/`, dizer quais podem ser corrigidos em paralelo,
ordenar por complexidade crescente e, para cada bug, encadear sessoes visiveis no gerenciador de
sessoes: **analise -> desenvolvimento -> testes**. Teste reprovado volta para a sessao de dev (pai),
que corrige e reenvia. Teste verde -> commit, push, doc para `retest/`. Achado lateral -> bug doc
novo. Bug impossivel de concluir (telemetria, hardware, ambiente) -> fica em `open/` documentado.
Testes nao rodam em paralelo: fila, um por vez, porque cada um sobe o app E2E.

## 2. Fatos verificados (comando literal -> resultado)

| Fato | Como foi provado |
|---|---|
| Sessao em background visivel no gerenciador existe no CLI | `claude --help`: `--bg` ("`claude agents` lists them"), `-n/--name` ("shown in ... /resume picker"), `--resume <id>` com `--bg` "continues that session in the background under the same ID, or starts a copy ... when the session is already running". **O help omite:** qualquer flag no resume tambem abre copia (secao 19) |
| Listagem programatica das sessoes | `claude agents --json --all` -> array com `pid, cwd, kind, startedAt, sessionId, name, status` (`status` visto: `idle`, `busy`) |
| `claude` NAO esta no PATH | `Get-Command claude` vazio; binario real em `%USERPROFILE%\.vscode\extensions\anthropic.claude-code-<versao>-win32-x64\resources\native-binary\claude.exe` (versao muda a cada update -> resolver por glob, nunca cravar) |
| CLI recusa `C:\projects\retrobatnew` | `claude --bg ...` -> `Workspace not trusted. Run claude in C:\projects\retrobatnew once and accept the trust prompt`. `~/.claude.json` nao tem entrada para o projeto. **Acao do dono, uma vez.** Nao contornar editando `~/.claude.json` |
| Arvore principal e compartilhada e suja | `git -C source status --short | wc -l` = 98; outras sessoes `interactive` no mesmo cwd em `claude agents --json` |
| Arvore principal a frente do origin | `git status -sb` -> `## versao3...origin/versao3 [ahead 12]` |
| `.vcxproj` versionados tem caminho ABSOLUTO | `grep -c 'C:\\projects' es-app/emulationstation.vcxproj` = 238, `es-core.vcxproj` = 266. Build do ES por essa `.sln` numa worktree compilaria o fonte da arvore PRINCIPAL |
| `deploy.ps1` reconfigura o CMake in-source | `deploy.ps1::Invoke-CMakeConfigure` roda `cmake -S $ES_DIR -B $ES_DIR`; descarta o cache se `CMAKE_HOME_DIRECTORY` nao bater com `$ES_DIR`. Numa worktree ele regenera os `.vcxproj` com o caminho DA worktree -> correto para compilar, mas deixa `.vcxproj/.filters/.slnx` sujos (nunca commitar) |
| `deploy.ps1` so conhece `$ROOT\source` | 16 ocorrencias de `$ROOT\source` / `$PSScriptRoot\source` (linhas 66-77, 243-244, 410, 422, 546, 638). Nao ha como apontar para uma worktree sem editar |
| `deploy.ps1` toca muito alem dos exes | copia para `emulationstation\`, `resources\`, `.emulationstation\`, `system\templates\`, e `RetroGameSystem.exe`/`RGS*.exe` na raiz da instalacao. Backup/restore do `dist/` apos o teste NAO e viavel de forma confiavel |
| Build do ES e sensivel a memoria | `deploy.ps1::Invoke-ESBuild` usa `/m:1` + toolchain x64 "to avoid the documented C1060 'out of heap space' / OOM gotchas". Dois builds de ES em paralelo = risco real |
| Modo `full` da suite toma a maquina | `source/docs/tests/README.md` §2: SendInput real, ES em foreground, "roda 1 teste por vez", "nao mexa no mouse/teclado" |
| Bateria completa leva horas | §4 receita D: "horas, re-baixa ~21 GB". Receita B (lote leve, window) ~15 min; A (smoke) ~2 min |
| `tests/` nao esta no git | o repo comeca em `source/`; `tests/` fica na raiz `C:\projects\retrobatnew\tests` (fora das worktrees) |
| Bugs abertos raramente tem complexidade preenchida | varredura do campo `**Complexidade:**` em `open/*.md` em 2026-10-02: 8 de 18 vazios ou "nao avaliada"; `open/` tem tambem `.txt`/`.json` que nao sao bugs |
| Prova exigida pelo dono | memoria `feedback_e2e_proof_every_fix`: launch real + UI do ES + **controle positivo**; evidencia em `tests/runs/<ts>-<slug>/` |
| Fim do ciclo automatico e `retest/` | memoria `feedback_bug_corrigido_e_testado_vai_para_retest`; `done/` so com prova de cliente/publicacao |
| `dist/` compartilhado | memoria `dist-runtime-shared-between-sessions`: matar so o proprio PID, editar settings cirurgicamente |
| Ferramentas disponiveis | Python 3.14.7, `retrobat-tests.exe` no PATH do usuario, git 2.55, 1.2 TB livres em C: |

> **As secoes 3 a 6 sao a REVISAO 1** (raias + analise/dev/teste/teste-final). O desenho vigente
> e o da secao 8; o que segue fica como historico das decisoes.

## 3. Avaliacao do pipeline proposto

O esqueleto esta certo e bate com as regras do proprio dono: corte de sessao na fronteira
analise -> implementacao, handoff pelo doc (nao pelo chat), teste independente de quem corrigiu,
fila exclusiva para E2E. O que muda e onde o desenho proposto quebraria na pratica:

1. **Cadeia de sessoes sem estado externo morre calada.** Se cada sessao so "abre a proxima", uma
   sessao que trava (prompt de permissao, erro de API, contexto estourado, esqueceu de chamar o
   proximo passo) para o bug inteiro e ninguem percebe. -> **Toda transicao passa por um script
   deterministico (`scripts/pipeline.py`) que grava um ledger** (`.bugfix-pipeline/state.json`).
   A topologia continua a pedida (analise abre dev, dev abre teste, teste devolve ao dev), mas
   quem abre e o script, e um `reconcile` acha e reanima o que parou.
2. **Paralelismo nao e decidido pela complexidade, e por conflito.** Dois bugs no mesmo arquivo /
   subsistema corrigidos em paralelo geram rebase com conflito e um teste que valida a combinacao
   errada. -> o maestro agrupa por **superficie tocada** (arquivo/subsistema provavel) em
   **raias**; dentro da raia e sequencial, entre raias e paralelo. Complexidade so ordena.
3. **Paralelo exige isolamento de arvore.** A arvore principal esta suja, 12 commits a frente e
   usada por outras sessoes. -> cada raia tem uma **git worktree persistente**
   (`.bugfix-pipeline/lanes/lane-N`, dentro da raiz para herdar CLAUDE.md/skills), reaproveitada
   entre bugs para o build do ES ser incremental. O pipeline **nunca** escreve na arvore principal.
4. **A fila de teste tem que ser uma fila de MERGE.** O que se testa tem que ser o que vai para o
   push. Com raias paralelas, testar o branch antes do rebase valida um estado que nunca existira.
   -> dentro do slot exclusivo: rebase na base -> build -> deploy no `dist` -> testes -> push. O
   slot cobre tambem o deploy (deploy fora do slot trocaria o binario sob o teste de outra raia).
5. **"Todos os testes" por bug, em fila serial, nao fecha.** A bateria "do zero" leva horas; com 10
   bugs a fila levaria dias. -> testes em niveis (ver `etapas/testes.md`): por bug, build + prova
   E2E especifica com controle positivo + regressao direcionada (receitas A/B, suite `normal`
   filtrada). A bateria larga roda **uma vez no fim da execucao** (etapa `teste-final`).
6. **Loop dev <-> teste precisa de teto.** -> 3 rodadas; na 4a o bug fica em `open/` com o
   historico das tentativas (bloqueio "nao convergiu").
7. **Bloqueio deve ser detectado o mais cedo possivel.** Bug que depende de GPU AMD, telemetria ou
   cliente nao deve gastar sessao de dev. -> a analise pode encerrar o bug como `bloqueado`
   direto, sem abrir dev.
8. **Achado lateral nao entra na execucao corrente.** Senao o pipeline se alimenta sem fim. ->
   bug doc novo (deduplicado contra `open/` e `retest/`), commitado no branch, e fica para a
   proxima execucao.
9. **Teto de paralelismo.** Uma maquina, build do ES com risco de OOM, custo por sessao. -> padrao
   **3 raias**; build do ES serializado por lock proprio entre raias.
10. **Teste E2E precisa da maquina ociosa.** -> rodar quando o PC estiver livre; a etapa de teste
    confere processos `emulationstation` alheios antes de comecar e aborta o slot (sem reprovar o
    bug) se o ambiente estiver ocupado.

## 4. Hipoteses descartadas

- **Subagente (`Agent`) em vez de sessao `--bg`**: nao aparece no gerenciador de sessoes
  (requisito do dono) e nao pode abrir outro subagente. Descartado.
- **Todas as raias na arvore principal**: conflito entre raias e com as sessoes humanas. Descartado.
- **Worktree nova por bug**: cada uma paga um build do ES do zero (1,3 GB). Descartado em favor de
  worktree persistente por raia.
- **Backup/restore do `dist/` depois de cada teste**: `deploy.ps1` toca dezenas de caminhos;
  restauracao parcial deixaria um runtime incoerente. Descartado: o `dist/` fica com o ultimo build
  integrado (base + fixes ja publicados), que e o estado mais novo e coerente.
- **Base = `versao3` local**: publicaria no push os commits locais de outras sessoes sem
  consentimento. Descartado como padrao; a base e `origin/versao3`, e o maestro **pergunta** ao
  dono, se a arvore principal estiver a frente, se publica esses commits antes de comecar.
- **`SendMessage` para o teste avisar o dev**: entregaria a mensagem, mas nao ha garantia
  verificada de que acorda uma sessao `--bg` ociosa. Usado `claude --bg --resume <id>` pelo script,
  que o `--help` documenta. Validar os dois no `preflight`.
- **Lock do slot de teste por mutex nomeado**: o teste dura horas em varios processos; mutex morre
  com o processo. O slot e um campo no ledger (protegido por lock de arquivo), com deteccao de
  dono morto via `claude agents --json`.

## 5. Pendencias antes da primeira execucao real

1. Dono roda `claude` uma vez em `C:\projects\retrobatnew` e aceita o trust.
2. `python .claude/skills/pipeline-correcao-bugs/scripts/pipeline.py preflight` verde (spawn,
   listagem, resume, permissao, worktree, build do ES numa worktree).
3. Primeiro build do ES numa raia: medir tempo e confirmar que o exe sai em
   `lane-N\emulationstation-source\bin\x64\Release\` e nao na arvore principal.

## 6. O que foi feito

- `deploy.ps1`: parametros `-SourceRoot` (default `$ROOT\source`, comportamento antigo intacto) e
  `-BuildOnly` (para depois do build, sem deploy).
- Skill: `SKILL.md` (maestro), `etapas/{analise,dev,teste,teste-final}.md`,
  `scripts/pipeline.py` (ledger, raias, fila, spawn com stop+resume, reconcile, `deploy --at-base`
  para o controle positivo, `final-deploy`).
- Provado em 2026-10-02: `deploy.ps1` passa no parser do PowerShell (0 erros, CRLF preservado);
  `pipeline.py preflight --skip-spawn` VERDE; simulacao do ledger com git/claude falsos
  (fila, slot exclusivo, reprovacao -> dev, backoff de ambiente, teto de rodadas, bloqueio exige doc
  publicado, reconcile despacha, teste-final) VERDE.
- **NAO provado ainda** (depende do trust, item 5.1): spawn/resume real, sessao `--bg` abrindo outra
  sessao `--bg`, `claude stop <sessionId>` aceitar o id longo, build do ES numa raia.

## 7. Revisao 2 — proposta do dono em `source/docs/pipeline-automatico.md` (2026-10-02)

Proposta: Planning paralelo (read-only) -> Elencar por complexidade com conjuntos de arquivos
disjuntos -> Dev em paralelo NA MESMA ARVORE (sem worktree/branch) -> Testes pontuais (fila quando
nao paralelizaveis) -> Finalizacao. Opus 5.5, effort medium + ultrathink em todas as etapas.

### Fatos adicionais verificados
| Fato | Prova |
|---|---|
| Arquivo disjunto nao isola o build: tudo do launcher vira 1 binario | `emulatorLauncher.csproj` formato antigo (sem `Project Sdk=`), `<Compile Include=` x320; `EmulatorLauncher.Common.csproj` x133. ES = 1 `emulationstation.exe` |
| Arquivos "quentes" que o planning nao preve | `git log --since=2026-09-01 --name-only`: `catalog_manifest_full.txt` 15 commits, `emulatorLauncher.csproj` 8, `Resources.resx` 6, `Resources.pt-BR.resx` 6. Todo `.cs` novo edita o csproj; toda string nova ao usuario edita os 2 resx |
| Rota de bug para o outro projeto ja existe | `source/skills/triagem-chamados/SKILL.md` Passo 4 (produto -> repo do produto; agente/plataforma -> `digitalstoregamesproject/docs/modules/<modulo>/[areas/<area>/]bugs/AAAA-MM-DD-slug.md`) |
| Commit local no digitalstoregamesproject vai ao ar | memoria `backend-repo-local-commits-go-live-via-other-sessions-deploy`: `git commit -- <paths>`, nunca `deploy-all.ps1` |
| `ultrathink` vale por turno, nao por sessao | o harness anota "requesting deeper reasoning on THIS turn" quando a palavra aparece na mensagem; mensagem de retomada sem a palavra roda sem ela |

### Conclusao
Aceitar da proposta: planning paralelo read-only com conjunto de arquivos declarado, ordenacao por
complexidade com selecao de disjuntos (repetida dinamicamente), testes pontuais, Etapa 5, roteamento
entre projetos, modelo/effort por etapa. NAO aceitar sem decisao do dono: dev paralelo na mesma
arvore, porque disjuncao de arquivos evita conflito de TEXTO mas nao de BUILD/TESTE (o teste de A
compila e roda a edicao pela metade de B), e a arvore principal e compartilhada com sessoes humanas
(98 sujos, 12 a frente). Opcoes registradas na resposta ao dono: (A) worktree por raia — com
conjuntos disjuntos o rebase nunca conflita; (B) dev na arvore principal com reserva de arquivos
+ UMA arvore de integracao usada so pela fila de teste (patch dos arquivos do bug aplicado sobre
HEAD limpo); (C) arvore unica pura, segura so serializando dev+teste. Pendente: escolha do dono.

### Decisao do dono (2026-10-02): selecao por ONDAS, sem severidade
- Onda = gulosa sobre os bugs restantes ordenados por complexidade crescente: pega o de menor
  complexidade; percorre os demais na ordem e inclui cada um cujo conjunto de arquivos seja
  disjunto da UNIAO dos ja incluidos na onda.
- A onda seguinte so comeca quando TODOS os bugs da onda atual terminam (retest, ou open
  documentado apos o teto de 3 rodadas / bloqueio). Recalcula sobre os que sobraram.
- Exemplo do dono: 5 bugs; onda 1 = {1, 3}; terminados 1 e 3, onda 2 = menor complexidade
  restante + os disjuntos dele.
- Bug que termina em open nao volta em onda posterior da mesma execucao.
- Severidade fora da ordem por enquanto (pode entrar depois).
- Consequencia aceita: a onda espera o bug mais lento dela.
- Arquivo nao previsto no planning, ja reservado por outro bug da MESMA onda: o bug espera o outro
  terminar (reserva de arquivo), nao edita em paralelo.

## 8. Desenho vigente (revisao 3, 2026-10-02)

Decisoes do dono nesta conversa, em ordem:
1. Cinco etapas de `source/docs/pipeline-automatico.md` (Planning, Elencar, Desenvolvimento,
   Testes pontuais, Finalizacao).
2. Elencar por ONDAS (secao 7, "Decisao do dono"), severidade fora da ordem.
3. **Worktree por bug** (opcao A da secao 7): "com nossa regra de arquivos distintos em paralelo,
   provavelmente nao teremos muitos conflitos". A **sessao de testes integra no fluxo principal**.
4. Criterio de teste em paralelo (headless, mesmo deploy, sem config compartilhada, emulador
   diferente) aceito. Consequencia: com um build por bug, dois bugs nunca compartilham deploy, entao
   o E2E e sempre exclusivo; o paralelo e a fase OFFLINE do teste (sem slot).
5. Effort/ultrathink: planning (e finalizacao) com Opus 5.5 `medium` + `ultrathink`; **o planning
   decide** effort/ultrathink de dev e teste daquele bug (campos `effort`/`ultrathink` do JSON).
6. Planning **4 por vez** (janela deslizante: terminou um, entra o proximo, nunca mais que 4). Onda
   com no maximo 4 bugs (`--max-dev 4`).

Escolhas minhas dentro disso (corrigir aqui se o dono discordar):
- "Ate 3x" = 3 DEVOLUCOES ao dev (ate 4 rodadas de teste); a 4a reprovacao deixa o bug em open.
- Integracao = rebase + push fast-forward (o repo nao tem merge commit: `git log --merges` = 0).
- O doc vai para `retest/` no MESMO commit/push do fix (o dono escreveu "push e depois mover").
- Bug que fica em open: o helper integra so os docs; o codigo fica em `bugfix/<slug>-wip` (local).
- Planners nao rodam git que escreve: dividem a `wt-planning`; o helper commita os docs de todos
  ao abrir a Etapa 2. Docs no `digitalstoregamesproject` sao commitados pelo helper com pathspec,
  sem push/deploy.
- Reserva de arquivos: a lista do planning e a reserva; arquivo fora dela exige `claim`; ocupado ->
  `park` ate o dono terminar; `enqueue-test` recusa branch que mexe em arquivo nao reservado.

Provas (2026-10-02):
- `scripts/sim_pipeline.py` (ledger com git/claude falsos), 30 verificacoes VERDE: janela de 4
  no planning, plano invalido recusado, onda do exemplo do dono ({a,c} e depois {b,d}), caminho
  `source/...` normalizado, effort/ultrathink do planning chegando a dev e teste, claim/park,
  enqueue com arquivo nao reservado recusado, fase offline sem slot, fila E2E (exit 10) e retomada
  com SLOT CONCEDIDO, 3 devolucoes e open na 4a, backoff de ambiente, reconcile, finalizacao.
- `scripts/git_pipeline.py` (funcoes git REAIS contra origin bare), VERDE: worktree por bug,
  integracao linear sem merge commit, recusa quando o fluxo andou com codigo depois do sync (exit 3),
  recusa de `.vcxproj` gerado (exit 5), open integra so docs e preserva `-wip`.
- **NAO provado** (depende do trust): spawn/resume real, sessao `--bg` abrindo outra `--bg`,
  `claude stop <sessionId>` aceitar o id longo, `--effort`/`--model` aceitos no `--resume`, build do
  ES numa worktree.

### Ajustes de 2026-10-02 (apos a revisao 3)
- **So roda a pedido do dono**: `disable-model-invocation: true` no frontmatter (campo confirmado
  no binario do Claude Code 2.1.285, ao lado de `user-invocable`/`allowed-tools`); nada agendado
  (`/loop`/cron removidos das sugestoes). Iniciada, as etapas encadeiam sozinhas.
- **Teste como o usuario, no dist**: o `dist\retrosystem` e UM so e compartilhado; a worktree guarda
  so fonte+build do bug, e o `deploy -SourceRoot <worktree>` copia esse build para o dist. T2 e o
  caminho do usuario pela UI do ES no app do dist (planning descreve estado de partida, acoes e
  sinal); launcher `-noninteractive` direto e complemento. Exclusividade = o slot.
- **Sem lixo**: fim de bug apaga `bugfix/<slug>` e `-docs` e devolve a worktree ao fluxo principal
  (`clean_wt`); a PASTA fica ate a finalizacao para o build do ES ser incremental entre ondas.
  `cleanup` (finalizacao) remove todas as worktrees, recusando se algo nao foi integrado. Ficam so
  os `-wip`. Custo: cada execucao nova paga o primeiro build do ES em cada worktree (tempo ainda
  nao medido). Provado em `scripts/git_pipeline.py` (VERDE).
- **Arvore principal intocavel (pedido explicito do dono)**: `source/` JAMAIS e apagada, limpa,
  resetada ou reescrita pelo pipeline. Imposto em codigo, em duas camadas independentes:
  `guard_wt` (antes de toda funcao destrutiva: alvo nao pode ser a principal, nem conter, nem estar
  dentro dela; tem que estar sob `.bugfix-pipeline\lanes`; `.git` tem que ser ARQUIVO; o git nao
  pode lista-la como worktree principal) e `refuse_main_tree` (dentro de `run()`, vale para
  QUALQUER git do helper: subcomando que escreve com cwd na principal, ou `worktree remove/move`
  com alvo fora das lanes, sai 13). `guard_branch` so deixa apagar `bugfix/*` (nunca `-wip` nem o
  fluxo principal). `cleanup` confere ao final que `source/.git` continua pasta. Provado em
  `scripts/git_pipeline.py`: 11 recusas (exit 13), inclusive git sem cwd, subpasta, ledger
  adulterado apontando para a principal, e arvore principal intacta depois (mesmo HEAD, mesmo sujo
  de terceiros, rascunho preservado).

## 9. Revisao de pontas soltas (2026-10-02, a pedido do dono)

Defeitos achados relendo o `pipeline.py` inteiro — nenhum aparecia nos testes porque os stubs os
escondiam. Todos corrigidos e cobertos por teste:

| # | Defeito | Consequencia | Correcao |
|---|---|---|---|
| 1 | `finish_bug` dava `claude stop` em TODAS as sessoes do bug, inclusive a que chamava o helper | o processo do helper morria antes do `save`: onda nunca avancava | `stop_sessions(except_stage=)` + `save` antes de efeito externo; o `tick` encerra o chamador depois |
| 2 | `--add-dir <DSG>` era o ultimo parametro antes do prompt (opcao variadica) | o CLI engoliria o prompt como diretorio | ordem fixa: variadicas primeiro, `--effort` por ultimo |
| 3 | `sync`/`publish`/`--at-base`/limpeza faziam `git checkout -- .` | apagava edicao nao commitada de dev retomado | `discard_generated` (so gerados; recusa saida 2) e `preserve_leftovers` (stash `pipeline-sobra`) |
| 4 | `test-done fail` exigia o slot, e zerava o slot de qualquer um | reprovacao offline impossivel; slot de outro bug roubado | offline permitido sem slot; so libera o slot se for do bug |
| 5 | parser do `git status --porcelain` sobre saida com `strip()` | 1a letra do 1o caminho cortada (`mulationstation-source/...`): gerado tratado como real e vice-versa (afetava `enqueue-test` e `cleanup` desde a revisao 1) | `--porcelain=v1 -z` com saida crua |
| 6 | `GENERATED` casava qualquer `.sln` | os 5 `.sln` mantidos a mao (launcher, RetroBat, RGS*) seriam descartados como lixo | padrao restrito a `emulationstation-source/` (`git ls-files` conferido) |
| 7 | espera circular (A espera B, B espera A) | os dois parados para sempre | `park --file` detecta ciclo -> `defer_bug`: sai da onda com reserva ampliada, codigo em `-wip`, volta numa onda seguinte (saida 12) |
| 8 | `slot-request` com slot livre mas fila so com bug em backoff | quem pedia ficava parado para sempre | concede se nao ha ninguem PRONTO na frente |
| 9 | `elencar` so publicava se a arvore estava suja | depois de uma falha, o commit ja existia e o push era pulado: docs nunca chegavam ao origin | idempotente por `rev-list base..HEAD`; falha vira `elencar_erro` + comando `elencar` |
| 10 | sem agendamento, nada destravava sessao parada; spawn em sessao busy abortava a transicao no meio | pipeline preso ate o dono; git feito sem ledger | `tick` em toda transicao (reentrega pendencia, encerra sessao de bug terminado, cutuca ate 2x) e `queue_pending` |
| 11 | doc no `digitalstoregamesproject` aberto por dev/teste nao era rastreado; finalizacao mandava git na mao | doc nunca commitado; branch/worktree fora da trava | `register-external`, `commit-external`, `final-prepare`/`final-docs` |
| 12 | caminho absoluto no plano passava; comparacao de arquivo sensivel a maiusculas | reserva furada no NTFS | recusa absoluto; `fk()` minusculo em ondas, claim, owner, enqueue |
| 13 | variaveis `CLAUDE*` da sessao chamadora herdadas pela sessao nova (`CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_EFFORT`, socket) | sessao nova poderia se confundir com a chamadora / ignorar o effort | `clean_env()` em todo `claude` |
| 14 | `cleanup` nao via commit que so existia na worktree (ex.: docs do planning nao integrados) | commit perdido ao remover a worktree | recusa se HEAD fora do origin e sem branch |
| 15 | espera de ambiente dependia de `reconcile` manual | bug em backoff esquecido | `env-wait` (ate 9 min por chamada, ~2 h no total) dentro da sessao de teste, segurando o slot |

Descartado na revisao: limite de 260 caracteres de caminho (maior caminho do build = 137 + 21 da
worktree = 158); recusa de "sessao dentro de sessao" (a string nao existe no binario 2.1.285);
build deixando arquivo nao rastreado (o `.gitignore` cobre: so 7 `??` na arvore principal, todos de
outras sessoes).

Provas: `scripts/sim_pipeline.py` 45 verificacoes VERDE; `scripts/git_pipeline.py` 34 verificacoes
VERDE (git real, origin bare); `pipeline.py preflight --skip-spawn` VERDE; `deploy.ps1` 0 erros
de parser, CRLF preservado.

## 10. Pendente (lista unica e atual — substitui as secoes 5 e 8 "NAO provado")

1. **Dono:** rodar `claude` uma vez em `C:\projects\retrobatnew` e aceitar o trust.
2. `python ...\scripts\pipeline.py preflight` (com spawn) VERDE. Ele prova, de dentro de uma sessao
   (o caso real): spawn com `--model claude-opus-5-5 --effort low`, sessao no gerenciador,
   `claude stop <sessionId longo>` + `--resume` com `--model/--effort` continuando a MESMA sessao.
3. Nao provado nem pelo preflight: (a) a regra `--allowedTools 'Bash(python "<helper>":*)'` de fato
   dispensar o prompt de permissao (se nao casar, so volta a perguntar); (b) `deploy.ps1
   -SourceRoot <worktree>` compilar o ES numa worktree e o exe sair DENTRO dela — medir o tempo do
   primeiro build; (c) uma execucao real ponta a ponta com 1 bug de complexidade baixa.
4. Decisoes do dono ainda abertas (atualizado 2026-10-02: a skill foi versionada em `source/skills`
   e o `deploy.ps1` em `source/scripts/deploy.ps1`, com shim na raiz): a skill e o `deploy.ps1` vivem na raiz, FORA do git (a raiz nao
   e repositorio — mesmo risco que o CLAUDE.md do projeto descreve); `source/docs/pipeline-automatico.md`
   (nao rastreado) descreve a proposta original e diverge do desenho final (worktrees; doc para
   retest no mesmo push).

## 11. Resposta a revisao externa (`source/docs/revisao-skill-pipeline-correcao-bugs_2026-10-02.md`)

Revisao feita sobre `pipeline.py` SHA-256 `0638C764...AE50D` = exatamente a versao entao vigente
(conferido com `sha256sum` antes de corrigir). Os seis achados procedem; cada reproducao da revisao
virou teste permanente (marcado `[revisao N]` nos dois scripts).

| # | Veredito | Correcao | Regressao |
|---|---|---|---|
| 1 stash falho + reset | procede (stash com `check=False` sem conferencia) | `preserve_leftovers` confere saida, contagem de stashes e que a sobra saiu; senao `PreserveFailed` ANTES do reset. `checkout_fresh` sai 15 sem resetar; `clean_wt` deixa a worktree intacta e `blocked`; `next_wave` pula worktree bloqueada | `git_pipeline.py`: `refs/stash.lock` injetado -> exit 15, modificado e nao rastreado intactos; caminho normal recuperavel |
| 2 `-wip` sobrescrito | procede | SHA da tentativa gravado no ledger (`wip_sha`, com `save`) na 1a chamada; toda repeticao reaponta o `-wip` para ele; docs lidos do SHA com `--no-renames` | falha injetada na 1a publicacao + repeticao: SHA e conteudo do `-wip` preservados, so docs no origin |
| 3 `reconcile` com efeitos | procede | `tick(report=True)` virou leitura pura (nem spawn, nem stop, nem mutacao de `st`); pendencia obsoleta (destinatario fora da etapa) descartada em vez de reentregue | `sim_pipeline.py`: snapshot do estado identico, zero spawn/stop; com efeito: obsoleta descartada, valida entregue |
| 4 gerados reais fora do padrao | procede, e MAIOR que o relatado: a arvore principal suja de agora mostra o build alterando os 4 arquivos do pugixml e `.dll/.pdb/*.cache` versionados em `bin|obj/(Debug|Release)/` dos tres RGS | `GENERATED` ampliado so com esses caminhos de saida (fonte, `CMakeLists.txt`, `EmulationStationLauncher.cs` continuam reais); `--at-base` tenta SEMPRE voltar ao branch e, se nao conseguir, sai 16 explicito sem descartar nada | classificacao dos 6 caminhos citados + 2 de fonte; limpeza falha -> volta ao branch mesmo assim; volta impossivel -> exit 16, nada descartado |
| 5 reprovado em `retest/` | procede | `normalize_doc_open` devolve o doc para `open/` com nota de reprovacao no topo; chamado no `test-done fail` (volta ao dev) e no `publish_docs_only`, que ainda recusa (TRAVA) se sobrar algo em `retest/` | origin termina com `open/a.md` marcado e sem `retest/a.md` |
| 6 finalizacao nao retomada | procede (`None == None`) | chamador ausente agora e o sentinela `NOBODY`, distinto do `slug=None` da finalizacao; finalizacao `rodando` sem sessao registrada e reaberta | `tick(force=True)` reentrega a pendencia, registra a sessao e limpa a pendencia; sem pendencia tambem reabre |

Achado colateral (desta resposta): o `git_pipeline.py` nao isolava `P.STATE` e, com o `save` novo do
achado 2, tentaria gravar no ledger REAL `C:\projects\retrobatnew\.bugfix-pipeline\state.json` (so
nao gravou porque a pasta nao existe). Isolado, com `assert` de que STATE e SRC estao no temporario.

Limite que continua valendo (como a revisao diz): o efeito do achado 4 num build COMPLETO numa
worktree nao foi reproduzido — continua no item 3(b) da secao 10.

## 12. Revisao de prontidao para execucao autonoma (2026-10-02) e mudanca de local

**Veredito: ainda NAO pronta para rodar sozinha.** O codigo e os roteiros estao coerentes e testados
(sim 51, git 53, preflight sem spawn VERDE), mas o que so a maquina real prova ainda nao foi provado.

Corrigido nesta revisao (o que impediria a execucao autonoma):

| Problema | Prova | Correcao |
|---|---|---|
| `emulationstation-source/win32-libs/` (158 MB: SDL2, SDL2_mixer, curl, FreeImage, freetype, libvlc, rapidjson) e IGNORADA pelo git: nao existe numa worktree, e o `CMakeLists.txt` (linhas 36-53) entao BAIXA as libs do GitHub `origin/master` | `git check-ignore -v` -> `emulationstation-source/.gitignore:29`; `du -sh` 158M | `provision_wt()` COPIA para cada worktree (junction poderia apagar a da arvore principal ao remover a worktree). Teste: copiada, e o `cleanup` nao toca a da principal |
| CLAUDE.md da raiz manda "trabalhe sempre em source/" e "rode o build sem perguntar" (deploy.ps1 padrao = arvore principal + deploy no dist); o global manda "propor corte de sessao ao dono" | leitura dos dois CLAUDE.md | bloco PRECEDENCIA em todo prompt de etapa; `--disallowedTools AskUserQuestion EnterPlanMode` |
| build/deploy do helper e bateria de teste passam de 10 min (timeout de comando em primeiro plano) | 1o build do ES = full, `/m:1`; receita B ~15 min | prompt manda rodar em background e esperar a notificacao |
| vigia daria `stop`+`resume` numa sessao esperando PERMISSAO (descarta o pedido) | so `idle`/`busy` foram vistos | `RESUMABLE`: status desconhecido = "precisa do dono", nunca `stop` |
| nao se sabia se sessao `--bg` enxerga a area de trabalho (SendInput/foco do E2E) | — | `preflight` passa a medir: sessao Windows e `UserInteractive` da sessao em background vs a do dono, e os status vistos |

Conferido e sem problema: `emulatorlauncher/libs` (HintPath `..\libs\`) e versionado (20 arquivos);
o `packages.config` do RetroBat nao tem `HintPath` para `packages/`; `scripts/build.properties` e
ignorado mas so o empacotamento (`montaversao.py`, `publicar_edicao.py`) o usa.

**Mudanca de local (pedido do dono):** a skill mora versionada em `source/docs/skills/
pipeline-correcao-bugs/` (commit `37b87d5`, local, sem push). `.claude/skills/pipeline-correcao-bugs`
virou *junction* para la, para o Claude Code encontra-la. O helper acha a raiz por `find_root()`
(1o ancestral com `deploy.ps1` + `source/`), igual pelos dois caminhos (conferido). Nao registrada no
`docs/README.md` porque esse arquivo tem alteracao nao commitada de outra sessao.

## 13. O que falta para rodar sozinha (em ordem; substitui a secao 10)

1. **Dono:** `claude` uma vez em `C:\projects\retrobatnew`, aceitar o trust.
2. `/pipeline-correcao-bugs preflight` VERDE, incluindo os itens novos: sessao em background na
   area de trabalho do dono, comando executado no modo `auto` sem ficar esperando permissao, status
   conhecidos.
3. Medir o 1o build do ES numa worktree (`build --bug`): sai em `wt-N\emulationstation-source\bin\
   x64\Release\` e quanto tempo leva.
4. **[FEITO 2026-10-02, secao 17]** **Execucao piloto ACOMPANHADA** com 1 bug de complexidade baixa (lista de bugs com um item so),
   olhando `claude agents`, ate `retest` ou `open`. So depois disso, execucao com todos os bugs.
5. Riscos aceitos, sem bloqueio: nao ha teto de custo global (`--max-budget-usd` so existe com `-p`;
   o limite e estrutural: 4 planning, ondas de 4, 3 devolucoes, 2 cutucadas); a regra
   `--allowedTools 'Bash(python "<helper>":*)'` nao foi provada (se nao casar, a sessao pede
   permissao e o vigia relata); `deploy.ps1` (com `-SourceRoot`/`-BuildOnly`) continua FORA do git,
   na raiz.

**Preflight real em 2026-10-02** (`H preflight`): VERMELHO so no spawn — `Workspace not trusted. Run
claude in C:\projects\retrobatnew\.bugfix-pipeline\lanes once and accept the trust prompt`. CLI,
`deploy.ps1`, `dist`, `retrobat-tests` e `claude agents --json` OK. O item 1 continua pendente.

## 14. Revalidacao do Codex, achados 7 e 8 (2026-10-02) e mudanca para `source/skills/`

Relatorio: `source/docs/revisao-skill-pipeline-correcao-bugs_2026-10-02.md`, secao "Revalidacao
independente".

### Achado 8 — codigo da skill tratado como documentacao

Simbolos abertos (todos classificam por prefixo `docs/` relativo ao repo):
- `publish_head` (l. 922): base que andou so em `docs/` nao invalida a T2;
- `publish_docs_only` (l. 982): `git diff ... -- docs` = o que vai para o origin num bug reprovado;
- `cmd_enqueue_test` (l. 1207): sem arquivo fora de `docs/` -> "nenhum commit de codigo";
- `cmd_final_docs` (l. 1489): a finalizacao so publica `docs/`;
- `planning_done`/integracao dos docs do planning (l. 586-587): `git add -- docs`.

Com a skill em `source/docs/skills/`, os cinco tratam `pipeline.py`, `SKILL.md` e `etapas/*.md`
(que mudam o comportamento) como documentacao.

**Decisao do dono:** tirar a skill de `docs/`: `source/skills/pipeline-correcao-bugs/`. Resolve os
cinco sem mexer na classificacao. Descartado: lista de excecao `docs/skills/` dentro do helper (cinco
lugares para manter em sincronia, e o proximo prefixo esquecido repete o bug). Conferido: nenhuma
etapa (`etapas/*.md`) escreve na skill; `skills/` nao e ignorado pelo `.gitignore`; a pasta estava limpa
no git. Caminhos derivados (`SKILL`, `ETAPAS`, `find_root`) saem de `__file__`, nao mudam.
A junction `.claude/skills/pipeline-correcao-bugs` e recriada apontando para o novo lugar.

### Achado 7 — falha ao publicar na ultima reprovacao trava o bug

`cmd_test_done` (l. 1340) zerava `test_slot` ANTES do ramo. Na ultima reprovacao,
`publish_docs_only` grava o ledger (`save` do `wip_sha`, l. 978) e so depois publica: falha ali
deixava no disco `teste-e2e` + slot vazio. Repetir `test-done` -> `require_slot` recusa (saida 2);
`slot-request` -> "nao em 'teste'". `finish_bug` (l. 726) ja libera o slot sozinho, entao a liberacao
antecipada so e necessaria nos ramos que NAO terminam o bug (`ambiente`, reprovacao com devolucao).

**Correcao:** na ultima reprovacao, o slot fica com o bug ate `finish_bug`. Falha na publicacao ->
ledger com o bug ainda dono do slot -> o mesmo `test-done --result fail` refaz (o `publish_docs_only`
e idempotente desde o achado 2).

### Tasks e provas

| Task | Onde | Prova |
|---|---|---|
| mover a skill | `git mv docs/skills/pipeline-correcao-bugs skills/`; junction; caminhos em `SKILL.md` e comentarios do `pipeline.py` | `git_pipeline.py`: o `SKILL` real nao fica sob `docs/`; tentativa reprovada com arquivo em `skills/` nao o publica |
| achado 7 | `pipeline.py::cmd_test_done` | `git_pipeline.py`: `cmd_test_done` com ledger em disco, 1a publicacao falha -> ledger com slot do bug; repeticao -> `open-falhou`, slot livre, `-wip` preservado, docs no origin |
| regressao | `sim_pipeline.py`, `git_pipeline.py` | 104 checks anteriores verdes |

### Feito (2026-10-02)

- Skill em `source/skills/pipeline-correcao-bugs/` (`git mv`); junction `.claude/skills/pipeline-correcao-bugs`
  recriada (`mklink /J`) apontando para la; `H` no `SKILL.md` atualizado.
- `cmd_test_done`: `final = fail e returns >= max_returns`; a liberacao antecipada do slot pula `final`.
- Testes novos: `git_pipeline.py` `[revalidacao 7]` (4 checks, ledger em disco, `cmd_test_done` publico,
  fila com `q` andando) e `[revalidacao 8]` (local da skill; script da skill numa tentativa reprovada nao
  vai ao origin); `sim_pipeline.py` `[revalidacao 8]` (so o script da skill no branch: sem reserva -> 9,
  reservado -> entra em teste).
- Resultado: `python -B source\skills\pipeline-correcao-bugs\scripts\sim_pipeline.py` -> 53 OK, VERDE;
  `git_pipeline.py` -> 60 OK, VERDE (113 no total). **Controle positivo:** com a liberacao antecipada
  restaurada, `[revalidacao 7] ledger em disco: bug ainda DONO do slot` FALHA. `preflight --skip-spawn`
  VERDE pelo caminho novo e pela junction.
- Nao feito, de proposito: as reproducoes do Codex para `publish_head` (base que anda em `skills/`) e
  `cmd_final_docs` nao ganharam teste proprio — ficam corretas pelo mesmo motivo (prefixo `docs/`), e o
  check de local da skill e o que impede a regressao. O relatorio do Codex
  (`docs/revisao-skill-...md`, nao versionado, de outra ferramenta) ainda aponta links para `skills/`
  relativos a `docs/`; nao foi editado.

### Proximo passo (passagem de bastao)

Igual a secao 13, a partir do item 1: o dono aceita o trust (`claude` em `C:\projects\retrobatnew`; se
o erro voltar, tambem em `.bugfix-pipeline\lanes`), depois `/pipeline-correcao-bugs preflight` com spawn
real ate VERDE; entao itens 3 e 4. Antes do piloto (`iniciar`): ha 15+ commits locais nao publicados em
`versao3` — o Passo 2 do `iniciar` pergunta se publica.

**2o preflight real (2026-10-02, depois do dono dizer que aceitou o trust):** VERMELHO de novo, mesmo
ponto (`Workspace not trusted ... .bugfix-pipeline\lanes`); o resto OK, 16 commits locais. Leitura
(sem editar) de `~/.claude.json` -> `projects` tem 5 entradas e **nenhuma** com `retrobat` no caminho:
o aceite nao ficou gravado. Hipoteses: aceite feito pela extensao do VS Code (que nao usa esse dialogo)
em vez do `claude` no terminal; ou sobrescrito por outro processo do Claude que regravou o arquivo com
a copia antiga. Proximo passo: o dono roda `claude` num terminal comum em `C:\projects\retrobatnew` e
tambem em `C:\projects\retrobatnew\.bugfix-pipeline\lanes`, aceita, sai, e confere
`python -c "import json,os;print([k for k in json.load(open(os.path.expanduser('~/.claude.json'))).get('projects',{}) if 'retrobat' in k])"`
antes de repetir o preflight. Itens 3 e 4 nao iniciados.

**Causa real:** o dono so usava a extensao do VS Code; `claude` nao estava no PATH, entao o trust
nunca tinha sido aceito no terminal. Rodado pelo binario, o aceite gravou `C:/projects/retrobatnew`
(`hasTrustDialogAccepted: True`) e, em entrada separada, `.bugfix-pipeline/lanes` (o dono aceitou nas duas; NAO e heranca de subpasta, ver secao 15). O
`claude_exe()` agora resolve `~\.local\bin\claude.exe` (2.1.288, mesmo da extensao).

**3o preflight real (2026-10-02): VERDE**, todos os itens: spawn em `lanes`, sessao aparece no
`claude agents`, stop+resume continua a MESMA sessao (sem copia), status vistos so `idle`, comando
executado no modo `auto` sem pedir permissao, sessao em background na area de trabalho do dono
(sessao Windows 1 = 1, `UserInteractive=True`). Item 2 da secao 13 fechado.

**Item 3 medido (2026-10-02):** pelo MESMO codigo do helper (`ensure_wt` -> `provision_wt` ->
`deploy_ps1(path, ["-BuildOnly"])`, com o lock `es-build`), sem ledger (o `build --bug` exige `init`),
worktree `lanes\wt-1` destacada em `origin/versao3`:
- worktree + copia da `win32-libs`: **18 s**; 1o build completo (launcher + CMake + ES `/m:1`): **222 s**,
  saida 0, `wt-1\emulationstation-source\bin\x64\Release\emulationstation.exe` (8.776.192 bytes);
- `dirty_split(wt-1)` depois do build: **0 reais, 75 gerados** (`*.vcxproj(.filters)`, `.slnx` etc.):
  o `GENERATED` cobre tudo o que um build COMPLETO numa worktree suja. Fecha o limite do achado 4
  (secao 11). A `wt-1` fica com o build quente: a 1a onda a reaproveita (`ensure_wt` + `checkout_fresh`).

## 15. Piloto: o trust de uma worktree e o do repositorio principal, e o preflight testava a pasta errada (2026-10-02)

Piloto iniciado (`bugs-20261002-1828.json`, so `autoperf-gpu-amd-dedicada-...`; 20 excluidos "fora do
piloto"; antes, `git push origin versao3` aprovado pelo dono, `25d5943..c6a1c2f`). `H init` + `H start`:
`wt-planning` criada e provisionada, mas o spawn do planning saiu 1 — `Workspace not trusted. Run claude
in ...\lanes\wt-planning once`. A mensagem ficou PENDENTE no ledger (o vigia reentrega).

**Fatos:**
- `~/.claude.json` (lido, nunca editado) -> `projects` com `retrobat`: `C:/projects/retrobatnew` e
  `C:/projects/retrobatnew/.bugfix-pipeline/lanes`, entradas separadas. Trust e por caminho exato: nem
  subpasta herda (o 3o preflight passou porque o dono aceitou TAMBEM em `lanes`).
- `cmd_preflight` fazia o spawn com `cwd=WTS` (`lanes`), mas nenhuma sessao de etapa roda la:
  `spawn()` usa `planning_wt(st)` (`lanes\wt-planning`) para planning e `wt_path` (`lanes\wt-N`) para
  dev/teste; so a finalizacao usa `ROOT`. Logo o VERDE nao provava o caso real (falso positivo).
- Nomes de worktree sao fixos: `wt-planning` e `wt-1..wt-{max_dev}` (`next_wave`: `k` comeca em 1;
  passa de `max_dev` so se uma worktree ficar `blocked`). O `cleanup` remove as pastas, mas o trust e
  por CAMINHO e continua valendo quando a worktree e recriada: aceite unico.
- `git worktree add` aceita pasta EXISTENTE e VAZIA (provado num repo temporario): da para criar as
  pastas `wt-2..wt-4` antes de existirem como worktree, para o dono aceitar o trust nelas.
- CLI 2.1.288 `--help`: nenhuma opcao de trust para `--bg` (`-p` pula o dialogo, mas sessao `-p` nao
  aparece no gerenciador nem aceita `resume` de mensagens; descartado).

**Descartado:** editar `~/.claude.json` (proibido pela skill); sessoes nascendo em `lanes` e fazendo
`cd` para a worktree (git root, CLAUDE.md e cwd do Bash viram os de `lanes`; caminho relativo errado
escreve fora da worktree); `-p` (acima).

**Tasks:**
| Task | Onde | Prova |
|---|---|---|
| preflight confere o trust de TODAS as pastas onde as sessoes nascem | `pipeline.py`: `LANES`, `untrusted_lanes()`, `cmd_preflight` (cria as pastas vazias que faltam e lista as nao confiaveis com o comando para o dono) | `sim_pipeline.py [piloto trust]`: `.claude.json` falso com so `lanes` -> as 5 pastas apontadas; com as 5 (caixa/barra diferentes) -> nenhuma |
| dono aceita o trust em `wt-planning`, `wt-1..wt-4` | maquina | `H preflight` VERDE com o check novo |
| retomar o piloto | `H reconcile --fix` reentrega a mensagem pendente do planning | sessao `bug01-planning-...` no `claude agents` |

**Feito (2026-10-02):** `lanes()`/`untrusted_lanes()` + check novo no `cmd_preflight` (cria as pastas
vazias que faltam; so le o `~/.claude.json`); o spawn do preflight nasce em `wt-planning`, nao mais em
`lanes`; texto do preflight no `SKILL.md`. `sim_pipeline.py` `[piloto trust]` (4 checks) -> 57 OK,
`git_pipeline.py` 60 OK. **Controle positivo:** sem o `.lower()` na comparacao, `[piloto trust] as 5
confiaveis (caixa/barra diferentes)` FALHA. `H preflight --skip-spawn` real: VERMELHO listando as 5.

**Estado do piloto (passagem de bastao):** execucao `20261002-1828` ATIVA, bug em `planning` sem
sessao, mensagem pendente no ledger. Proximo passo: dono aceita o trust nas 5 pastas -> `H preflight`
(com spawn) VERDE -> `H reconcile --fix` reentrega o planning -> acompanhar no `claude agents` ate
`retest`/`open`.

**CORRECAO da analise acima (2026-10-02, depois do dono aceitar nas 5 pastas):** a regra "pasta
exata, nem subpasta herda" estava ERRADA. `~/.claude.json` depois do aceite: `C:/projects/retrobatnew`
True, `C:/projects/retrobatnew/source` **True (entrada nova)**, `.../lanes` False, `.../lanes/wt-2` False;
**nenhuma** entrada para `wt-planning`/`wt-1`. Mesmo assim o spawn em `wt-planning` (worktree real)
passou. Regra que explica os 4 pontos medidos:
- numa **worktree git** o trust e o do **repositorio principal** (`source`): aceitar dentro de
  `wt-planning`/`wt-1` gravou `source`; antes, sem `source`, `wt-planning` falhou mesmo com a raiz
  `C:/projects/retrobatnew` confiavel (a raiz NAO vale para o repo git abaixo dela);
- **pasta comum** (`lanes`, `wt-2` vazia, nao-git) herda da raiz: o 3o preflight passou em `lanes`
  embora a entrada propria seja False.
Consequencia: o check certo e UM so, `source` confiavel (todas as worktrees sao do mesmo repo), e o
spawn do preflight numa pasta `wt-*` ainda VAZIA nao prova nada (ela herda da raiz). O check das 5
pastas foi trocado por esse; as pastas vazias `wt-2..wt-4` nao sao mais criadas (as que ja existem
sao inofensivas: `git worktree add` aceita pasta vazia).
Feito: `worktrees_trusted()` (so `source`) no lugar de `lanes()`/`untrusted_lanes()`; `sim_pipeline.py`
`[piloto trust]` reescrito (4 checks; controle positivo sem `.lower()` FALHA); SKILL.md atualizado.
`H preflight` real com spawn: **VERDE**, incluindo o check novo. Proximo: `H reconcile --fix` retoma o piloto.

## 16. Piloto: transicao interrompida deixa a etapa sem sessao (2026-10-02)

**Fato:** dev (`78f27498`) commitou `e34582f` em `wt-1` (launcher compilado, 5 testes de tier verdes
contra o exe da worktree) e chamou `enqueue-test`. Na transcricao (`~/.claude/projects/
C--projects-retrobatnew--bugfix-pipeline-lanes-wt-1/78f27498-*.jsonl`) a chamada termina em "The user
doesn't want to proceed with this tool use ... [Request interrupted by user for tool use]" — no mesmo
minuto o dono perguntava como entrar numa sessao (`claude attach`); Esc dentro do attach interrompe a
ferramenta. Ledger: bug em `teste` (18:48:41, `rodada 1`), `sessions` SEM `teste`, `pending_spawns` vazio.

**Causa:** `cmd_enqueue_test` faz `save(st)` com o estado novo ANTES do `spawn`; o processo morto entre
os dois deixa a etapa sem sessao e sem pendencia. O mesmo vale para `next_wave` (dev) e
`start_plannings` (planning). `tick` (l. ~843) so trata isso como "parado": espera `grace_min` (60 min,
45 no reconcile), abre a sessao com a mensagem de CUTUCADA ("esta etapa parou..."), e so roda se alguma
sessao chamar o helper — com um bug so, ninguem chama. A finalizacao ja tinha o tratamento certo
(achado 6: "sem sessao registrada -> abrir").

**Descartado:** salvar so depois do spawn (spawn de 30-60 s dentro do lock, e processo morto DEPOIS do
spawn e antes do save abriria sessao duplicada na proxima tentativa); editar o ledger (proibido).

**Task:** `tick`: etapa de bug sem sessao registrada (`sessions[stage]` sem `id`) e sem pendencia para
ela -> abrir JA, sem esperar `grace_min` e sem gastar cutucada, com a mensagem de INICIO da etapa
(`START_MSG`; teste com o numero da rodada). Prova: `sim_pipeline.py [piloto sessao perdida]` — bug em
`teste` sem sessao: `report` so anota; com efeito abre `teste` com "Rodada de teste 1" sem cutucada;
com pendencia para a etapa nao abre duas. Depois: `H reconcile --fix` retoma o piloto.

**Feito (2026-10-02):** `START_MSG` + ramo novo no `tick` ("sem sessao registrada -> abrir ja"); o
`sst` deixou de tolerar `rec` nulo porque esse caso agora sai antes. `sim_pipeline.py [piloto sessao
perdida]` (4 checks) -> 61 OK; `git_pipeline.py` 60 OK. **Controle positivo:** com o comportamento
antigo (ramo desligado, `sst ... if rec else None`), `[piloto sessao perdida] reconcile so relata` FALHA.

**Achado em seguida (2026-10-02 18:5x): o ramo novo abriu uma sessao DUPLICADA.** O spawn interrompido
TINHA aberto a sessao de teste (`effc8967`, nome `bug01-teste-...`); so o registro no ledger se perdeu.
Ela fez a fase offline e pediu o slot (`teste -> teste-e2e`, 18:49:58). O `reconcile --fix` viu
`sessions` sem `teste` e abriu a `5613fdf7`. O slot e do BUG, nao da sessao: as duas poderiam fazer
deploy no `dist`. `5613fdf7` parada pelo maestro (fase offline), `effc8967` segue no E2E.
-> **Correcao:** antes de abrir, ADOTAR sessao viva com o nome da etapa (`bugNN-<etapa>-<slug[:38]>`)
iniciada depois da ultima transicao do bug; so abrir se nao houver. O ledger do piloto fica com
`teste = 5613fdf7` (a parada): inofensivo, o `test-done` e por `--bug`, e o vigia pula o bug de quem chama.

**Achado 2: `claude stop <sessionId>` nunca parou nada.** `claude stop 5613fdf7-98b8-...` ->
"No job matching"; `claude stop 5613fdf7` -> "stopped". `claude agents --json` traz `id` (job curto,
`5613fdf7`) separado de `sessionId`. Os tres `stop` do helper (`resume_cmd`, `stop_sessions`, `tick`)
passam o `sessionId` com `check=False`: falham calados, e `stop_sessions`/`tick` ainda gravam
`stopped`. O preflight "stop + resume = mesma sessao" passou porque o `--resume` de sessao ociosa
continuou a mesma mesmo sem o stop. -> **Correcao:** `job_id()` = `id` do `claude agents` para o
`sessionId` (fallback: 8 primeiros caracteres), usado nos tres.

Provas: `sim_pipeline.py [piloto sessao perdida]` ganha "sessao viva com o nome -> adota, nao abre";
`[piloto stop]`: `stop_sessions`/`resume_cmd` chamam `stop <id curto>`.

**Feito (2026-10-02):** `job_id()` nos tres `stop`; `resume_cmd` com status None resume direto; `tick`
adota a sessao orfa pelo nome antes de abrir. `sim_pipeline.py` -> 65 OK (`[piloto sessao perdida]` 5,
`[piloto stop]` 3); `git_pipeline.py` 60 OK. **Controles positivos:** adocao desligada -> "ADOTA, nao abre
outra" FALHA; `stop` com o sessionId -> "[piloto stop] stop_sessions para pelo id curto" FALHA.
Commit local, sem push: `versao3` local diverge do origin (`c756f6e`, doc do planning publicado pelo
pipeline) e a arvore principal tem trabalho de outras sessoes; reconciliar depois do piloto.

## 17. Resultado do piloto acompanhado (execucao `20261002-1828`, 2026-10-02)

| Etapa | Inicio -> fim | Resultado |
|---|---|---|
| planning (`d97d7a08`) | 18:41:55 -> 18:46:04 | `corrigir`, media/baixo, 3 arquivos; doc publicado `c756f6e` |
| Etapa 2 | 18:46:11 | onda 1 = o bug, `wt-1` (build quente reaproveitado) |
| dev (`78f27498`) | 18:46:19 -> 18:48:41 | `e34582f`, compile-check do launcher, 5 testes de tier contra o exe da worktree |
| teste (`effc8967`, orfa adotada a mao) | 18:48:41 -> 19:04:04 | T2 E2E aprovado com controle positivo na base; `retest`, `6cd6366` no origin |
| finalizacao (`d2426956`) | 19:04:10 -> concluido | briefing `runs/20261002-1828-briefing.md`, `cleanup` ok (2a tentativa: `wt-1` presa pelo cwd da sessao de teste ociosa) |

Total ~23 min para 1 bug de complexidade media. Problemas do pipeline achados no piloto e corrigidos
(secoes 15 e 16): trust de worktree, etapa sem sessao apos transicao interrompida, sessao duplicada,
`stop` por sessionId. Bug novo achado pelo teste (fora do pipeline, `deploy.ps1` fora do git):
`docs/bugs/open/deploy-ps1-src-sobrescrito-pelo-laco-vc-runtime-quebra-portao-win7_2026-10-02.md` —
conferido pelo maestro: `deploy.ps1:507` `$src = $null` no escopo do script sobrescreve `$SRC`
(PowerShell nao diferencia caixa) e a l. 557 chama `$SRC\scripts\win7_imports.py`. **Todo
`pipeline.py deploy` sai 1 ate isso ser corrigido** (a sessao de teste contornou conferindo hash).

Sobras limpas pelo maestro: `claude stop effc8967` e `d2426956` (o `stop_sessions` nao para o chamador;
a `effc8967` nao estava no ledger); pastas vazias `lanes\wt-1..wt-4` removidas.

**Antes da execucao com todos os bugs:** (1) corrigir o `deploy.ps1` (bug acima); (2) publicar os
commits locais da skill (`2d67e2d`, `ecaab11` + este) — a arvore principal esta `ahead/behind` do
origin e tem trabalho staged de outra sessao, entao `pull`/`merge` nela esta fora de questao;
(3) `preflight` VERDE de novo.

## 18. A finalizacao passa a ENTREGAR o estado organizado (2026-10-03)

Bug: `docs/bugs/.../pipeline-finalizacao-nao-entrega-estado-organizado-arvore-principal-dist-sobras_2026-10-02.md`
(analise completa la: causa por criterio, evidencias, hipoteses descartadas). O piloto fechou como
`concluido` com a arvore principal 11 commits atras, o `dist/` sem o fix, sessao e pasta vivas e o
briefing mandando o dono fazer pull e apagar pasta. Causa: `cmd_final_done` so conferia `.git` de
lane, e o roteiro repassava ao dono o que o helper proibia ou nao sabia fazer.

### Decisoes do dono (2026-10-03)

1. A finalizacao **sincroniza a arvore principal e commita o trabalho de terceiros** — revoga, so para
   isto, o "nunca escreve na arvore principal". Doc: um commit por arquivo.
2. Codigo de terceiro nao commitado: **publica se compilar** (`-BuildOnly` numa lane); senao fica em
   commit local e vira pendencia.
3. Inicio com a arvore suja/divergente: o preflight **avisa** e o maestro pergunta; nao bloqueia.
4. `-wip` e stash `pipeline-sobra`: **mantidos**, e obrigatoriamente citados no briefing.
5. `dist/`: a finalizacao faz o **build + deploy final de uma lane**.

### Como (e por que assim)

- **A excecao da trava e uma janela, nao um afrouxamento.** `refuse_main_tree` so libera, dentro de
  `main_sync_window()` (aberta apenas em `sync_main`), `add`, `commit`, `merge --ff-only` e
  `reset --keep`. Os quatro tem em comum nao sobrescrever arquivo modificado: os dois ultimos abortam
  inteiros se um arquivo sujo difere entre HEAD e o alvo.
- **O rebase dos commits locais e feito numa lane.** `git rebase` exige arvore limpa, e a arvore
  principal quase nunca esta (gerados de build). Rebasear na lane e depois mover a arvore principal
  com `reset --keep` dispensa descartar os gerados — que teria um risco proprio:
  `rgs-*/bin/Release/EmulatorLauncher.Common.dll` e rastreada e o `deploy.ps1` a copia para o `dist/`.
- **Duplicado recommitado por outro caminho** (E4 do bug): `git cherry` marca `-`; como nao ha commit
  local sem equivalente no origin, `reset --keep` iguala sem republicar nada.
- **O codigo de terceiro e o ULTIMO commit.** Se nao compila, publica-se o prefixo so-docs
  e ele fica local. Arquivo novo fora de `docs/` e arquivo mexido ha menos de 10 min nao sao
  commitados (origem desconhecida; outra sessao editando agora).
- **Arquivo modificado na pasta da propria skill tambem nao e commitado** (vira `PENDENCIA DO DONO`;
  bug `pipeline-final-sync-main-publica-codigo-da-skill-em-edicao-por-outra-sessao_2026-10-09`, 2026-10-10). O portao "publica se
  compilar" e o build do PROJETO, que nao importa nem testa o helper: para esse codigo ele passa sempre,
  e o helper e o que a propria execucao roda e o que o `sync_copias.py` replica nas copias. A idade do
  arquivo nao prova que a edicao terminou (a B2 ficou ~34 min sem commit e saiu pela metade em
  `a361a1b`); rodar os testes da skill como portao tambem nao (a bateria antiga passaria com a B2 pela
  metade). Quem sabe que terminou e quem edita: ele commita. A pasta e a de `skill_rel()` (`skills/...`
  aqui, `.claude/skills/...` nas copias). Commit LOCAL da skill continua publicado (decisao 1): commitar
  e ato deliberado.
- **C3 e provado por cadeia, nao por inspecao do binario:** commit de cada `retest` e ancestral do SHA
  deployado; entre esse SHA e o origin so mudou `docs/`; MD5 atual do `dist/` = MD5 gravado logo depois
  do deploy (e conferido contra a saida do build da lane).
- **O portao separa `mecanico` de `dono`.** Mecanico recusa (saida 2): e trabalho da finalizacao.
  `dono` fecha como `concluido-com-pendencias`. O resultado do `final-sync-main` so vale como `dono`
  enquanto HEAD e origin sao os mesmos de quando ele rodou; se algo andou, volta a ser mecanico.
- **O bloco "Estado verificado pelo helper" e escrito pelo helper** no briefing: erro e `AVISO` nao
  dependem mais de a sessao copiar (no piloto, um `cleanup` que saiu 255 virou "removidas").
- **Quem encerra a sessao da finalizacao** e um processo destacado (`stop-final`) que o `final-done`
  dispara: a sessao e quem chama o helper, entao nao pode ser parada de dentro.

### Limites conhecidos

- "Smoke" do `dist/` no fim nao e automatizado (a etapa de teste ja rodou o E2E de cada bug).
- Copia de sessao aberta por `--resume` com cwd fora das lanes e nome diferente nao e achada pelo
  `cleanup`; o `stop-final` so cobre as da finalizacao. Desde a secao 19 a retomada nao abre mais copia;
  o limite so vale para as abertas por execucao anterior a ela.
- "Compila" e so `deploy.ps1 -BuildOnly`: nao prova que o codigo de terceiro funciona, e nao valida
  Python. A pasta da skill saiu do commit automatico (acima); o resto que o build nao toca (`scripts/*.py`,
  `tests/`) continua publicado so pelo build — generalizar pediria uma lista por projeto no `projeto.json`
  e reabriria a decisao 2.

## 19. Retomada: sem flags e com a sessao parada; o ledger segue o id impresso (2026-10-03)

Bug: `source/docs/bugs/.../pipeline-resume-com-flags-abre-copia-e-ledger-perde-a-sessao_2026-10-02.md`
(medicoes e evidencias la).

**Fato medido (CLI 2.1.288):** `claude --bg --resume <id> "<prompt>"` so continua a mesma sessao com
ela **parada** e **sem flag nenhuma**; ela acorda com as opcoes com que nasceu (`-n`, `--add-dir`,
`--allowedTools`, `--disallowedTools`, `--permission-mode`, `--effort`, `--model`). Qualquer flag, mesmo
identica a salva, abre uma copia (`--session-id <novo> --fork-session`), com id novo e as vezes titulo
gerado. Sessao viva tambem abre copia, e essa nasce **sem** as flags. Isto desmente o "stop + resume
com `--model/--effort` continua a MESMA sessao" das secoes 10 e 14: o check do preflight procurava a
copia pelo nome e a renomeada passava.

**O que quebrava:** o `spawn` passava as flags em toda retomada e registrava a original (parada). O
vigia via `status None`, cutucava e abria outra copia; `stop_sessions` parava a original e a copia
ficava viva na lane. Na execucao `20261003-1400`: 4 de 4 retomadas de planning perderam a sessao.

**Como ficou:**

- `resume_cmd(exe, session_id, prompt)`: `stop`, espera o `status` sumir (senao `Busy`, e a mensagem
  vira pendencia), e retoma sem flags.
- `spawn`: as flags so no nascimento. A sessao registrada e a do id que o CLI imprimiu (`bg_id`); se
  ainda assim vier copia, o ledger a segue (`copy_of` guarda a original) e sai `AVISO`.
- `preflight`: retoma sem flags e compara o id impresso com o da sonda.
- Consequencia aceita: effort e modelo de uma sessao sao os do nascimento. Mudar o plano de um bug
  depois que a sessao de dev/teste existe nao muda o effort dela.

Provas: `sim_pipeline.py [resume]` (9 casos); `spawn` real abrindo e retomando numa pasta de scratch
(antes: copia renomeada, ledger na original, copia viva depois do `stop_sessions`; depois: mesmo id,
uma sessao so, nenhuma viva); `preflight` real VERDE.

## 20. Limite de uso da conta: rodizio automatico entre contas (2026-10-04; implementado ate a F8 em 2026-10-06)

Spec, design, fatos medidos, matriz de cenarios e fases: **`source/docs/backlog/rodizio-automatico-de-contas-no-pipeline.md`**.
Aqui so o que muda o entendimento do pipeline; nao duplicar regra do backlog.

**O que mudou desde o plano (2026-10-05/06):**

- **O mecanismo de troca nao e o env.** A Fase 0 mediu que uma sessao `--bg` ignora o
  `CLAUDE_CODE_OAUTH_TOKEN` de quem chama e usa a conta do `/login`. O dono escolheu (D7) trocar o
  bloco `claudeAiOauth` de `~/.claude/.credentials.json`: sessoes `--bg` novas ou retomadas, e ate
  as interativas ja abertas, usam a conta do arquivo na requisicao seguinte, sem reciclar o daemon.
  Preco aceito: durante a execucao a maquina inteira fica na conta do pipeline, sem os conectores do
  claude.ai; o `/login` do dono vai para `login.bak` (DPAPI) e volta no fim.
- **O `tick` deixou de ser o unico vigia.** Ele le o transcript antes de cutucar: sessao parada por
  limite nao gasta cutucada. Com o rodizio ligado (2+ contas, sem pausa), quem retoma e o vigia de
  cota `quota-watch`, um processo destacado por maquina aberto pelo proprio helper (`start`, `tick`,
  `reconcile --fix`). Ele gira a conta, entrega as pendencias e retoma as sessoes com a mensagem
  `RETOMADA APOS LIMITE DE USO` (as `etapas/*.md` dizem que ela nao e reprovacao).
- **Portao no `spawn`:** sem conta disponivel, toda chamada ao CLI vira pendencia "aguardando cota".
  Nenhum chamador abre sessao numa conta esgotada.
- **Todas esgotadas:** o vigia dorme ate o menor reset + 2 min, com o arquivo ja na conta que volta
  primeiro. A tarefa avulsa do Agendador (reserva para vigia morto) **ainda nao entrou**: espera a
  medicao do `schtasks` sem elevacao pelo dono. Ate la, vigia morto com tudo parado volta so pelo
  `reconcile --fix`.
- **Preflight** confere o rodizio (validacao barata de cada conta, `CLAUDE_CONFIG_DIR`, arquivo de
  credenciais) e mostra o aviso da maquina inteira.
- **Sem contas, com 1 conta ou pausado, o pipeline roda como antes**, exceto que a cutucada de
  sessao parada por limite espera o reset + 2 min.
- **Falta:** a tarefa avulsa (F7), as provas reais com contas do dono (F2, F3, S46, preflight com 4
  contas) e o E2E real (F9).

**Plano original (2026-10-04), mantido como historico:**

- **Fato medido:** quando a conta esgota, a sessao grava uma mensagem `assistant` sintetica com
  `quotaLimits.status == "rejected"` e `resetsAt` no transcript. Em 2026-10-03, 8 sessoes de
  planning pararam em 14 s. O `agents --json` mostra so `idle`, igual a uma sessao travada.
- **Consequencia para o desenho atual:** o `tick` gasta as 2 cutucadas numa sessao sem cota, e
  nada roda quando todas param. O "vigia sem agendamento" desta skill nao cobre o limite de uso.
- **Decisoes do dono:** rodizio entre 4 contas, uma por vez; vigia de cota em processo destacado
  aberto pelo `start`; com as 4 esgotadas, acordar sozinho no reset (tarefa avulsa no Agendador so
  como reserva). Extra usage recusado pelo custo.
- **Bloqueio:** a Fase 0 do backlog, com o dono presente, mede se o token de `claude setup-token`
  chega a uma sessao `--bg` (as sessoes sao filhas do daemon, nao de quem chama). Nada de codigo
  antes dela.

## 21. C4 aceita doc movido ADIANTE por outra sessao; ledger nunca se edita a mao (2026-10-08)

Bug `pipeline-portao-c4-recusa-doc-documentado-movido-por-outra-sessao-finalizacao-edita-ledger_2026-10-08`.
Na execucao `20261007-0220`, um bug `documentado` (doc em `open/`) teve a correcao aplicada por outra
sessao na arvore principal, que moveu o doc para `retest/` (`234fcb1`). O C4 do `final_report` so
procurava o caminho do ledger (`b["doc"]`, gravado uma vez e nunca reescrito) e recusou; como nenhum
comando resolve isso, a finalizacao editou o `state.json` a mao.

- **Regra de direcao:** o C4 procura o mesmo nome de arquivo na pasta esperada pelo estado (`retest/`
  para `retest`, `open/` para os demais) e nas ADIANTE dela no ciclo `open -> retest -> done`. Achado
  fora da esperada -> item `C4 ok` com a nota "doc movido por fora do pipeline para ...", e a
  conferencia da arvore principal usa o caminho achado. Para tras nao vale: `retest` com doc ainda em
  `open/` continua `mecanico` (e trabalho do `final-docs`).
- **Sem transicao para reescrever `doc`:** seria mais um passo que a finalizacao teria de lembrar, e o
  `final_report` e so leitura; achar o doc sozinho elimina o passo.
- **Roteiro:** `[FALTA]` sem comando que o resolva e bug do helper: parar e registrar, nunca editar o
  ledger (`etapas/finalizacao.md`, passo 7). Prova: `git_pipeline.py`, casos `d`/`e` do bloco `[finalizacao]`.

## 22. Replicacao para outros projetos: motor generico + `projeto.json` (2026-10-09, ANALISE)

Pedido do dono: replicar a skill em `C:\projects\Downloader-XBOX360-XEX-HDD-Games`,
`C:\projects\lemuroid\Lemuroid`, `D:\projects\PS2Companion` e `D:\projects\play2\ARMSX2-forkv2`.
Decisoes do dono (2026-10-09): **motor generico + config por projeto** (as 5 etapas valem em todos);
**copia versionada em cada repo**, o retrobatnew e a fonte; Lemuroid usa **`docs/bugs`** (nao
`documentacao/bugs`). Esta secao e o registro da etapa analitica; nenhum codigo foi alterado ainda.

### 22.1 O que e do RetroBat no motor (`scripts/pipeline.py`, lido inteiro em 2026-10-09)

| simbolo | o que amarra ao RetroBat |
|---|---|
| `find_root` / `ROOT` / `SRC` | raiz = ancestral com `deploy.ps1` + `source/`; `SRC = ROOT/"source"` |
| `PIPE` | `ROOT/.bugfix-pipeline` (fora do repo; lanes FORA de `SRC`, senao `guard_wt` recusa) |
| `DEPLOY`, `deploy_ps1`, `cmd_build` (`--skip-es/--skip-el`), `cmd_deploy`, `cmd_final_deploy` | `deploy.ps1 -SourceRoot <wt> [-BuildOnly]`, lock `es-build` |
| `DIST_ES`, `DEPLOYED`, `md5_of` no C3 do `final_report` | MD5 de `emulationstation.exe`/`emulatorLauncher.exe` no dist x saida do build da lane |
| `GENERATED` | regex dos gerados do CMake/MSBuild; usado em `dirty_split`, `discard_generated`, `preserve_leftovers`, `publish_head` (saida 5), `sync_main` |
| `WT_IGNORED_INPUTS` / `provision_wt` | copia `emulationstation-source/win32-libs` para cada worktree |
| `foreign_processes` (`env-wait`, `final-deploy`) | processos `emulationstation/emulatorLauncher/retroarch` + qualquer um dentro de `dist` |
| `cmd_preflight` | confere `deploy.ps1`, `dist/retrosystem`, `retrobat-tests` no PATH e a sessao Windows interativa (requisito do E2E por SendInput) |
| `stage_prompt` | texto "RetroBatNew", `C:\projects\retrobatnew\source`, "deploy.ps1 nem MSBuild" |
| `cmd_init --base` | padrao `origin/versao3`; `st["branch"] = base.split("/",1)[1]`; todo `fetch`/`push` usa o remoto literal `origin` |
| `commit_external`, `elencar`, `publish_docs_only`, `cmd_test_done` | assuntos de commit `docs(bugs): ...` fixos |
| `cmd_cleanup`, `sync_main` | `(SRC/".git").is_dir()` (saida 14) e `SRC/".git"/rebase-merge...`: supoem que `SRC` e o checkout PRINCIPAL do repo |
| `guard_wt` | 1a linha do `worktree list` == `p` -> trava; supoe o mesmo |
| `etapas/*.md` | ES, `dist\retrosystem`, `emulatorLauncher -noninteractive`, `retrobat-tests`, `.csproj`/`.resx`/`CMakeLists.txt`, `tests\runs`, `origin/versao3` |

Generico e intocado: ledger, ondas, reservas/`claim`/`park`, slot e fila, `tick`, spawn/resume,
rodizio de contas, `cleanup`, portao C1-C5 (menos C3), `sync_main` (menos o build e o `.git`).

### 22.2 Fatos dos quatro projetos (comando -> resultado)

| projeto | stack | git | base (`git rev-parse --abbrev-ref @{u}`) | `docs/bugs/open` |
|---|---|---|---|---|
| Downloader-XBOX360 | Go (`src/server`) + Electron/React (`src/electron-app`) + Android + Lua | checkout principal; remoto `origin` | `origin/main` | 15 docs |
| Lemuroid | Android/Gradle (`gradlew`), submodulo `lemuroid-cores` | checkout principal; `origin` | `origin/version9` | 8 docs (+8 em `documentacao/bugs/open`, fora por decisao do dono) |
| PS2Companion | Go (`src/server`) + Electron (`src/electron-app`) | checkout principal; `origin` | **sem upstream**: a arvore esta em `docs/bug-ntfs-preparo-verificacao`; `origin/HEAD -> origin/master` | 4 docs (2 nao commitados) |
| ARMSX2-forkv2 | C++/CMake (NDK) + Android/Gradle | **e uma WORKTREE** de `D:\projects\play2\ARMSX2` (`git rev-parse --git-common-dir` = `D:/projects/play2/ARMSX2/.git`); remotos `fork`, `origin` (ARMSX2Plus), `upstream` | `origin/armsx2forkv2` | 3 docs |

- **Build** (lido nos guias de cada projeto):
  - Downloader: `npm run build:server` (go build); em `src/electron-app`, `npm run test:safety`
    (tsc + typecheck + `node --test tests/unit`). E2E: Playwright (`npx playwright test` em
    `src/electron-app`; `docs/agents/skills/playwright-testing.md`).
  - Lemuroid: `gradlew :lemuroid-app:assembleFreeBundleDebug`; instala no aparelho com
    `build_and_install_connected.ps1` (adb). `local.properties`, `build.properties` e `release.jks`
    sao gitignored (`git check-ignore -v`).
  - PS2Companion: `npm run build:server` (go build para `dist/`); Electron em `src/electron-app`.
    Sem pasta de testes, sem `AGENTS.md`, sem `docs/README.md`.
  - ARMSX2: nativo `cmake ... && ninja -j 4 emucore_4k` (CLAUDE.md "Build": 13 min 45 s medidos;
    `-j 4` obrigatorio por OOM); APK `platforms/android/gradlew.bat :app:assembleGithubRelease`.
    As dependencias do shaderc (264 MB, gitignored) **nao acompanham um worktree novo**.
- **Rastreabilidade do ARMSX2** (`CLAUDE.md`, `scripts/check_traceability.py`): todo commit em
  `platforms/android/app/src/`, `pcsx2/`, `common/`, `scripts/` ou arquivo de build exige uma task em
  `docs/task/` e o assunto `TASK-NNNN: ...`; fora disso, so `chore:` (`ALLOWED_SUBJECT_PREFIXES`).
  O assunto `docs(bugs): ...` que o helper escreve **reprova na CI** de la.
- **Onde a skill pode morar:** Downloader, Lemuroid e PS2Companion versionam `.claude/`
  (`git ls-files .claude` lista `skills/triagem-chamados/SKILL.md` em Downloader e PS2Companion, e
  `settings.json` em Lemuroid). No ARMSX2, `.claude/` e gitignored (`.gitignore:187`) e as skills
  moram em `docs/skill/`, com junction em `.claude/skills/`. `docs/` NAO serve para esta skill
  (secao 14: o helper trata `docs/` como documentacao).
- **O rodizio de contas esta LIGADO na maquina:** `~/.claude-accounts/accounts.json` tem 4 contas,
  sem `paused` (lido em 2026-10-09). O lock `accounts` e o `quota-watch` moram em `PIPE` (um por
  projeto), mas a guarda de contas e o arquivo de credenciais sao da maquina.
- **Testes da skill antes de mexer:** `python sim_pipeline.py` -> `SIMULACAO VERDE` (275 OK);
  `python git_pipeline.py` -> `GIT VERDE` (138 OK).

### 22.3 Hipoteses descartadas

- **Copiar a pasta e trocar constantes em cada repo:** cinco motores de 4.000 linhas divergem na
  primeira correcao (o caso do `source/docs/CLAUDE.md` 48 linhas atrasado). O motor fica IDENTICO
  nos cinco; o que muda mora em `projeto.json` + `projeto.md`, que a sincronizacao nunca sobrescreve.
- **Junction de cada repo para o retrobatnew:** decisao do dono (copia versionada).
- **Skill em `docs/skill/` no ARMSX2 (onde moram as outras de la):** secao 14.
- **Lanes dentro do repo (`<repo>/.bugfix-pipeline`):** o `guard_wt` recusa caminho dentro de
  `SRC`, e com razao. `PIPE` fica FORA do repo: `<pai do repo>/.bugfix-pipeline-<nome do repo>`
  (padrao); o retrobatnew mantem `C:\projects\retrobatnew\.bugfix-pipeline` pelo `projeto.json`.
- **Rodizio de contas por projeto, em paralelo:** dois vigias (um por `PIPE`) disputariam o arquivo
  de credenciais sem lock comum, e o vigia de um projeto que termina devolve o `/login` (passo 1 do
  `watch_pass`) com a execucao do outro ainda rodando. Ate existir coordenacao da maquina (lock e
  registro em `~/.claude-accounts`), o rodizio fica **so no retrobatnew** (`"rodizio_contas": true`).
  Nos outros, `rotation_on` e falso: no limite de uso, a execucao espera o reset (o comportamento
  sem rodizio, ja testado). **Decisao do dono pendente** se quiser rodizio nos outros.
- **E2E generico:** nao existe. O que e comum e o SLOT (recurso exclusivo) e o roteiro de prova
  (controle positivo na base, fix, regressao, logs). O "como" (app do `dist`, aparelho Android via
  adb, Playwright) e do projeto e vai para o `projeto.md`.

### 22.4 Desenho

`projeto.json`, ao lado do `SKILL.md` (a sincronizacao nunca o sobrescreve):

```json
{"nome": "RetroBatNew", "pipe_dir": "<relativo a pasta da skill>", "remoto": "origin",
 "base": "origin/versao3", "rodizio_contas": true, "commit_docs": "docs(bugs)",
 "build": {"cmd": ["..."], "lock": "es-build", "flags": {"--skip-es": ["..."]}},
 "deploy": {"cmd": ["..."], "artefatos": {"<instalado, relativo a root>": "<saida do build, relativa a wt>"}},
 "gerados": ["<regex>"], "entradas_ignoradas": ["<relativo ao repo>"], "provisionar": [["..."]],
 "e2e": {"processos": ["..."], "pastas": ["..."], "desktop": true},
 "preflight": [{"cmd": ["..."], "msg": "..."}], "proibido_na_sessao": "deploy.ps1 nem MSBuild"}
```

- `{wt}` e `{root}` sao trocados no `cmd`.
- `projeto.md` e o manual do projeto que as etapas citam: onde rodar o build, como e o caminho do
  usuario, onde fica a evidencia, que arquivo arrasta outro e a regra de commit. O helper injeta o
  caminho dele no prompt. As `etapas/*.md` ficam genericas e mandam ler o `projeto.md` nos pontos
  especificos. O conteudo RetroBat das etapas vai **literal** para o `projeto.md` do retrobatnew.
- `SRC` = `git rev-parse --show-toplevel` da pasta da skill; o `.git` do repo vem de
  `git rev-parse --git-dir` (o ARMSX2-forkv2 e worktree: `SRC/.git` e arquivo). A trava "1a linha
  do `worktree list`" vira "o caminho e `SRC`", que e o que ela quer dizer.
- `git fetch origin`/`push origin` -> `fetch`/`push <remoto>`.
- `scripts/sync_copias.py` no retrobatnew: copia o motor, as etapas, o `SKILL.md` e o `DESIGN.md`
  para os quatro repos, nunca o `projeto.json`/`projeto.md`; `--check` diz quem diverge. O
  `preflight` avisa quando a copia local difere da fonte (se a fonte existir na maquina).

### 22.5 Tasks (cada uma com a prova)

1. **T1 `projeto.json` no motor** (`pipeline.py`: `find_root`/`ROOT`/`SRC`/`PIPE`, `DEPLOY`,
   `DIST_ES`, `DEPLOYED`, `GENERATED`, `WT_IGNORED_INPUTS`, `foreign_processes`, `stage_prompt`,
   `deploy_ps1` -> build/deploy da config, `cmd_build`, `cmd_deploy`, `cmd_final_deploy`, C3 do
   `final_report`, `cmd_preflight`, `cmd_init --base`, remoto, assuntos de commit, `.git` por
   `rev-parse`, `rotation_on` com `rodizio_contas`). O `projeto.json` do retrobatnew reproduz
   exatamente o comportamento de hoje. **Prova:** `sim_pipeline.py` e `git_pipeline.py` verdes sem
   mudar assert de comportamento, mais casos novos com a config de outro projeto (sem deploy nem
   artefatos, sem gerados, base `origin/main`, remoto `fork`, `SRC` sendo worktree).
2. **T2 etapas genericas + `projeto.md` do retrobatnew**, com o conteudo RetroBat literal. **Prova:**
   leitura lado a lado (nenhuma regra perdida) e nenhum `retrobat`/`versao3`/`retrosystem` em `etapas/`.
3. **T3 `scripts/sync_copias.py`** + aviso no `preflight`. **Prova:** `--check` aponta a divergencia
   plantada numa copia temporaria.
4. **T4 instalar nos quatro repos** (`projeto.json` + `projeto.md` de cada um, com build/deploy/E2E
   de 22.2; junction no ARMSX2) e `preflight --skip-spawn` em cada um. **Prova:** a saida do
   preflight. Em cada repo, commit so dos arquivos da skill (no ARMSX2, `chore:`, em `skills/`, fora
   dos `GUARDED_PREFIXES`).
5. **T5 preflight completo (com spawn) num projeto novo, com o dono:** abre sessao `--bg` e pede o
   trust do repo. **Nao** iniciar execucao real sem o dono.

### 22.6 T1 — registro antes da edicao (2026-10-09)

Lidos inteiros: `find_root`..`GENERATED`, `refuse_main_tree`, `dirty_split`, `norm`, `stage_prompt`,
`spawn`, `spawn_account`, `guard_wt`, `provision_wt`, `ensure_wt`, `checkout_fresh`, `commit_external`,
`elencar`, `foreign_processes`, `publish_head`, `publish_docs_only`, `worktrees_trusted`,
`preflight_accounts`, `cmd_preflight`, `cmd_init`, `cmd_sync`, `deploy_ps1`, `cmd_build`, `cmd_deploy`,
`cmd_cleanup`, `cmd_env_wait`, `sync_main`, `cmd_final_deploy`, `final_report`, `schedule_quota_watch`,
`watch_pass` (passo 1), `gate_now`, `account_for_spawn`, `quota_status`, `cmd_reconcile`, `cmd_accounts`,
`main`; e o cabecalho dos dois testes (`git_pipeline.py` inteiro; `sim_pipeline.py` 1-45 e 396-505).

- **Os testes trocam os globais do modulo** (`P.SRC = ...`, `P.DIST_ES = ...`, `P.deploy_ps1 = fake`).
  Logo os globais FICAM (`ROOT`, `SRC`, `PIPE`, `DIST_ES`, `DEPLOYED`, `GENERATED`...) e passam a ser
  preenchidos por `configure(cfg, skill)` na importacao, a partir do `projeto.json`. Os casos de outro
  projeto chamam `configure` com outra config.
- **Achado que muda a T1:** com `rotation_on` falso o vigia (`watch_pass`, passo 1) chama `restore_login`,
  que devolve o /login no arquivo de credenciais **da maquina** se `applied` (gravado pela execucao do
  retrobatnew) estiver ligado. So pôr `rodizio_contas` dentro de `rotation_on` faria um projeto sem
  rodizio desfazer o rodizio de uma execucao do retrobatnew em curso. Portanto `rodizio_contas: false` =
  **o helper nunca escreve na guarda de contas nem no arquivo de credenciais**: `rotation_on` falso,
  `gate_now` sem portao (nem por `accounts.json` ilegivel), `quota-watch` sai na hora, `restore_login`
  devolve "nada", `init` nao apaga a marca `armed`, `accounts add/remove/activate/validate/restore`
  recusam (saida 2), `preflight`/`status`/`reconcile` dizem "rodizio desligado neste projeto".
- **Desvios do esboco de 22.4** (decididos aqui):
  - caminhos do `projeto.json` sao relativos a `raiz` (`"raiz": ".."` no retrobatnew; padrao `.` = o
    repo), nao a pasta da skill;
  - `deploy.destino` + `deploy.artefatos` {nome: saida relativa a wt} em vez de {instalado: saida}: o
    ledger grava `final.deploy.files` por NOME (`emulatorLauncher.exe`) e um ledger aberto na troca tem de
    continuar valido;
  - `deploy_ps1(path, extra)` vira `project_cmd(path, "build"|"deploy", flags)`; o fake dos testes passa a
    registrar o `kind` (o assert continua o mesmo: "so o build rodou na lane").
  - `--skip-es/--skip-el` viram as `build.flags` do projeto (argparse montado a partir delas).
  - `provisionar` (comandos) fica fora: `entradas_ignoradas` (copia) cobre o shaderc do ARMSX2.
  - `guard_wt` MANTEM a trava "1a linha do `worktree list`": no ARMSX2-forkv2 ela protege o checkout
    principal `D:\projects\play2\ARMSX2`, que nao e `SRC`.
- **Sem deploy no projeto:** `deploy` recusa (saida 2, o teste roda da worktree, pelo `projeto.md`),
  `final-deploy` sai 0 sem fazer nada, C3 = ok "projeto sem deploy". Sem `e2e`: `foreign_processes` = [].
- **Prova (T1):** `sim_pipeline.py` e `git_pipeline.py` verdes; caso novo `git_pipeline.py` com config de
  outro projeto (repo cuja raiz e WORKTREE, remoto `fork`, base `fork/main`, sem deploy/gerados).

**T1 FEITA (2026-10-09).** `projeto.json` do retrobatnew criado; o motor le tudo dele (`configure`).
O `.git` da arvore principal virou `git_dir()` (resolvido na hora: os testes trocam `P.SRC`, e um global
calculado na importacao apontaria para o repo real). Resultado:
- `python sim_pipeline.py` -> `SIMULACAO VERDE`, 275 OK (igual a antes; nenhum assert mudou).
- `python git_pipeline.py` -> `GIT VERDE`, 156 OK = os 138 de antes + 18 `[outro projeto]` (recontado em
  2026-10-09 com `grep -c "^OK"`; o registro original dizia 157/19, conta errada: os 18 declarados rodam). Os fakes de
  `deploy_ps1` viraram `project_cmd(path, kind, extra=())` e os 2 asserts que conferem o que rodou na lane
  passaram a comparar o `kind` (`"build"`/`"deploy"`) em vez de `["-BuildOnly"]`/`[]`: mesma afirmacao.
  Controle positivo: `[outro projeto] sync_main ve o rebase da worktree` falha no codigo antigo
  (`SRC/.git/rebase-merge`, e numa worktree `.git` e arquivo).
- Ponta a ponta: `python skills/pipeline-correcao-bugs/scripts/pipeline.py preflight --skip-spawn` no
  retrobatnew -> `PREFLIGHT VERDE`, os 4 itens `preflight` do `projeto.json` em `[OK]` e o rodizio validando
  as 4 contas como antes.
- Ficou para a T2: `SKILL.md` e `etapas/*.md` ainda citam `deploy.ps1`, `--skip-es/--skip-el` etc. (o
  comportamento do retrobatnew nao mudou, entao continuam corretos para ele).

Pendencias de decisao do dono: rodizio nos outros projetos (22.3); base do PS2Companion
(`origin/master`, mas a arvore esta noutro branch, e o `final-sync-main` vai recusar ate ela voltar
para `master`); no ARMSX2, como o dev cria a task `docs/task/TASK-NNNN` que cada fix exige
(proposta: o dev cria a task no proprio branch, com a regra no `projeto.md`).

### 22.7 Decisoes do dono e corte em duas sessoes (2026-10-09)

Respostas do dono as pendencias de 22.6:
1. **Rodizio nos outros projetos:** sem resposta. Vale o padrao (`"rodizio_contas": false` fora do
   retrobatnew, motivo em 22.3); nao ligar sem o dono.
2. **PS2Companion:** base `origin/master`. Antes, "arrumar a bagunca": levar o branch atual para o
   `master` (merge) e deixar a arvore em `master`.
3. **ARMSX2:** a propria sessao de **planning** cuida da task que o fix exige: primeiro procura em
   `docs/task/` uma task que ja cubra o bug; se nao houver, cria. E um requisito NOVO: **modo tasks** — a
   skill tambem roda sobre tasks ja abertas (em vez de bugs), planejando e resolvendo cada uma como faz com
   os bugs. E do motor (generico), nao so do ARMSX2.

Estado no corte (2026-10-09 ~03:00):
- T1 feita (`0264702`; contagem da prova corrigida em `e5dc91e`; `origin/versao3..HEAD` vazio).
- **T2 em andamento noutra sessao:** sem commit em `SKILL.md`, `etapas/*.md`, `scripts/pipeline.py`
  (`MANUAL = projeto.md` no prompt e no preflight) e `projeto.md` novo (editados 02:27-02:32).
- T3, T4 e T5 nao comecaram.

**Regra para as sessoes que dividem `C:\projects\retrobatnew\source`:** `git commit -- <arquivo>` grava o
arquivo INTEIRO, inclusive o hunk de outra sessao. Antes de editar `pipeline.py`, `SKILL.md`, `etapas/` ou
este `DESIGN.md`, rodar `git -C C:\projects\retrobatnew\source status --short -- skills/pipeline-correcao-bugs/`;
arquivo com mudanca que nao e sua NAO se edita (esperar o commit da outra sessao ou perguntar ao dono).
Editou: commit na hora. Cada sessao escreve so na sua subsecao (A = 22.8, B = 22.9).

| passo | sessao | depende de |
|---|---|---|
| A1 arrumar o PS2Companion e levar para `master` | A | nada (comecar ja) |
| A2 = T3 `sync_copias.py` + aviso no preflight | A | T2 commitada |
| A3 = T4 do PS2Companion | A | A1, A2 |
| B1 analise: modo tasks + task no planning do ARMSX2 | B | nada (comecar ja) |
| B2 modo tasks no motor + testes | B | B1; T2 commitada; `pipeline.py` sem hunk alheio (A2 tambem o edita) |
| B3 = T4 do ARMSX2 | B | B2, A2 |
| T5 preflight com spawn | dono | A3 / B3 |

### 22.8 Sessao A — PS2Companion

Abrir em `D:\projects\PS2Companion`, com `C:\projects\retrobatnew\source` como diretorio adicional.

**A1 — fatos medidos em 2026-10-09 ~03:00 (re-medir antes de agir: a arvore e compartilhada):**
- `git branch -vv`: atual `docs/bug-ntfs-preparo-verificacao` @ `49f6f93`, sem upstream; `master` @
  `ab53358` = `origin/master` + 2 nao publicados.
- `git rev-list --left-right --count origin/master...HEAD` -> `0 5`: o branch contem o `master` inteiro mais
  3 commits (`388ac6a` docs(bugs) verificacao do NTFS; `fea549f` `*`; `49f6f93` copia da skill
  triagem-chamados). O merge em `master` e **fast-forward**.
- **`fea549f`, assunto `*`** (Luis Tiago, 2026-10-04 22:49; `git show --stat fea549f`): cria
  `catalog_manifest_ps2.txt` na RAIZ (12.180 linhas) e `catalog_manifest_ps2.txt.bak_20261004_035813`
  (12.466 linhas) e APAGA `.../interfaces/http/data/catalog_manifest_ps2.txt` (286 linhas). Parece o nucleo da
  bagunca: arquivo de dados movido para a raiz e backup versionado. **Nao aberto:** quem le esse arquivo
  (`go:embed`? caminho lido em runtime?) e se o build e o servidor funcionam sem ele.
- `git status`: 2 docs de bug NAO rastreados em `docs/bugs/open/` (2026-10-07, `...formatar-fat32-acima-de-32gb...`
  e `...opl-do-cartao-lista-so-5-de-17-jogos...`). Sao de outra sessao: nunca apagar (o checkout os leva
  junto). Perguntar ao dono se commita (recomendo commitar como estao, `docs(bugs):`).
- Uma worktree so; stash vazio.

**A1 — o que fazer:**
1. Re-medir com os comandos acima.
2. Achar quem le `catalog_manifest_ps2.txt` (arquivo:linha em `src/server`), rodar `npm run build:server` no
   estado atual, e decidir com o dono a correcao do `fea549f` (provavel: arquivo de volta ao lugar, sem a
   copia na raiz e sem o `.bak`) em commit NOVO. Nunca reescrever historia.
3. `git checkout master` e `git merge --ff-only docs/bug-ntfs-preparo-verificacao` (merge autorizado pelo
   dono em 2026-10-09); build verde.
4. Push de `master` para `origin`: mostrar ao dono `git log --oneline origin/master..master` e confirmar.
5. `git branch -d docs/bug-ntfs-preparo-verificacao` (`-d` so apaga o que ja esta no `master`).

**A1 — analise (2026-10-09, sessao A, antes da edicao):**
- Re-medido: igual ao registro acima (`0 5`, mesmos 3 commits, os 2 docs nao rastreados, 1 worktree, stash vazio).
- **O registro acima leu errado o `--stat`** (deteccao de renomeacao): `git show --name-status fea549f` da
  `A catalog_manifest_ps2.txt` (raiz), `M src/server/interfaces/http/data/catalog_manifest_ps2.txt`,
  `A .../data/catalog_manifest_ps2.txt.bak_20261004_035813`. O arquivo embutido NAO foi apagado.
- Leitor unico: `src/server/interfaces/http/handlers.go:441` `//go:embed data/catalog_manifest_ps2.txt` ->
  `catalogManifestBytes` -> `parseManifestCatalog`. `grep -rn catalog_manifest` (go/js/ts/json/ps1/py/md, sem
  `node_modules`) nao acha mais ninguem; nada empacota a copia da raiz.
- `md5sum`: raiz == `data/catalog_manifest_ps2.txt` (`426e2a4b...`); `.bak` == `git show fea549f^:.../data/catalog_manifest_ps2.txt`
  (`ef461643...`). Ou seja: a raiz e duplicata e o `.bak` e a versao anterior que o git ja guarda.
- A mudanca real do `fea549f` e o manifesto perder 286 linhas, todas `ps2/... (Japan) (Taikenban...).iso`
  (demos): curadoria intencional, fica.
- `npm run build:server` no estado atual: verde.
- **Correcao:** commit novo `chore: remove copia duplicada e backup do catalog_manifest_ps2` com `git rm` da raiz e
  do `.bak`; o arquivo embutido fica. Prova: `npm run build:server` verde depois.
- Os 2 docs nao rastreados ficam como estao (nao sao desta sessao); commitar so com o ok do dono.

**Prova A1:** em `master`, nenhum rastreado modificado, `git rev-list --left-right --count origin/master...master`
= `0 0`, `npm run build:server` verde.

**A2 = T3** (22.5, item 3). Destino das copias: PS2Companion `.claude/skills/pipeline-correcao-bugs/` (la `.claude/`
e versionado, como a `triagem-chamados`); ARMSX2-forkv2 `skills/pipeline-correcao-bugs/` (22.5, item 4);
Downloader e Lemuroid a decidir na T4 deles. Antes de fixar `.claude/`, abrir em `pipeline.py` como o helper
separa documentacao de codigo (secao 14). Decidir se `sim_pipeline.py`/`git_pipeline.py` vao junto.

**A1 FEITA (2026-10-09):** `master` em fast-forward ate `49f6f93` + `e439825` (`chore: remove copia duplicada e
backup do catalog_manifest_ps2`); `npm run build:server` verde (rc 0); branch `docs/bug-ntfs-preparo-verificacao`
apagado com `-d`. `git rev-list --left-right --count origin/master...master` = `0 6`: **push pendente do ok do
dono** (sai junto com a A3). Os 2 docs nao rastreados continuam nao rastreados.

**A2 — analise (2026-10-09, antes da edicao):**
- Secao 14: o motor separa documentacao pelo prefixo `docs/` relativo ao repo (`publish_head`, `publish_docs_only`,
  `cmd_enqueue_test`, `cmd_final_docs`, integracao dos docs do planning). `.claude/skills/...` (PS2Companion) e
  `skills/...` (ARMSX2) ficam fora de `docs/`: a copia e tratada como codigo, como na fonte. Destino `.claude/`
  confirmado.
- `pipeline.py::configure` (56-95): `SKILL` = pasta da skill por `__file__` resolvido; `SRC` = `--show-toplevel` dela.
  `cmd_preflight` (2139): o aviso entra depois de `[OK] manual do projeto`, no estilo `[AVISO]` (nao e VERMELHO).
- Testes vao junto: nao tem caminho do retrobatnew (`grep -i "retrobat\|C:\\\\\|versao3"` so acha um caminho de
  exemplo dentro do repo temporario); importam o `pipeline.py` vizinho, que le o `projeto.json` local. O `DESIGN.md`
  copiado cita os dois; sem eles a copia ficaria incoerente.
- **Desenho:**
  - Em `pipeline.py` (motor, vai para toda copia): `FONTE` (pasta da skill no retrobatnew), `SYNCED` (`SKILL.md`,
    `DESIGN.md`, `etapas/*.md`, `scripts/{pipeline,sim_pipeline,git_pipeline}.py`), `copy_diff(src, dst)` ->
    `[(caminho, 'falta'|'sobra'|'difere')]` com fim de linha normalizado (autocrlf de outro repo nao e divergencia), e
    `copy_warning()` usado pelo `preflight`: se `FONTE` existe e nao e a propria `SKILL`, `[AVISO]` com o que difere e o
    comando de sincronizar. Uma lista so, lida pelo helper e pelo sincronizador.
  - `scripts/sync_copias.py` (so na fonte; nao esta em `SYNCED`): `DESTINOS` = PS2Companion `.claude/skills/...`,
    ARMSX2-forkv2 `skills/...`; destino sem `projeto.json` = "nao instalado (T4 pendente)", pulado (a T4 cria o
    `projeto.json` antes). `--check` so relata (saida 1 se diverge); sem flag copia e apaga sobra; `--commit` grava
    no repo do destino (`git add`/`git rm` dos arquivos sincronizados e `git commit -- <eles>`, assunto `chore: ...`,
    que passa no `ALLOWED_SUBJECT_PREFIXES` do ARMSX2); `--destino <pasta>` troca a lista. **Nunca sobrescreve** arquivo
    rastreado com mudanca nao commitada no destino (arvore compartilhada): recusa com saida 2 e nao copia nada.
- **Prova:** casos `[copias]` no `git_pipeline.py`: destino vazio -> `--check` saida 1 com `falta`; sync `--commit` ->
  copia igual, `projeto.json` intacto, assunto `chore:`; divergencia plantada em `etapas/dev.md` -> `--check` aponta
  `difere` e o sync recusa (saida 2) sem tocar; CRLF nao conta; `sobra` apagada; `copy_warning` com `FONTE` trocada.

**A2 FEITA (2026-10-09).** Como desenhado acima; `SKILL.md` ganhou "Fonte e copias" (na copia so `projeto.json`/
`projeto.md` se editam) e o "Onde a skill mora" deixou de supor `skills/` + junction (o PS2Companion usa
`.claude/skills/` direto). Prova:
- `python git_pipeline.py` -> `GIT VERDE`, 169 OK = 156 + 13 `[copias]`; `python sim_pipeline.py` -> `SIMULACAO VERDE`, 275 OK.
- Controle positivo: com `out.append((rel, "difere"))` trocado por `pass` no `copy_diff`, falha
  `[copias] --check aponta a divergencia plantada`; restaurado.
- `pipeline.py preflight --skip-spawn` no retrobatnew -> `PREFLIGHT VERDE`, sem linha de copia (e a fonte).
- `sync_copias.py --check` real -> os dois destinos `sem projeto.json (... T4 pendente), pulado`, rc 0.

**A3 = T4 do PS2Companion:** `projeto.json` com `nome` PS2Companion, `remoto` origin, `base` `origin/master`,
`rodizio_contas` false, `commit_docs` `docs(bugs)` (assunto que o repo ja usa), `build` `npm run build:server`
(medir numa worktree se falta algo nao rastreado, como `node_modules` -> `entradas_ignoradas`), `deploy`/`e2e`
conforme o `projeto.md`; PIPE padrao `D:\projects\.bugfix-pipeline-PS2Companion`. O dificil e o `projeto.md`:
o repo nao tem testes, `AGENTS.md` nem `docs/README.md`, e a etapa de teste exige prova ponta a ponta do jeito
que o cliente usa (Electron + servidor Go). **Prova:** `pipeline.py preflight --skip-spawn` verde no
PS2Companion; commit so dos arquivos da skill.

**A3 — analise (2026-10-09, antes da edicao):**
- **O registro acima errou "o repo nao tem testes":** `git ls-files` acha `src/server/**/*_test.go` e
  `src/electron-app/tests/unit/*.test.cjs` (9), rodados por `npm --prefix src/electron-app run test:safety`
  (`tsc` + `renderer:typecheck` + `node --test`). Sem `AGENTS.md`/`docs/README.md`, confirmado.
- `pipeline.py::project_cmd` (2502) roda o `cmd` com `cwd=ROOT` (= a arvore principal no PS2Companion): o build
  tem de entrar em `{wt}` sozinho. `npm run build:server` = `cd src/server && go build -o ../../dist/godsend-backend.exe`.
- **Medido numa worktree nova de `master`** (`git worktree add --detach`, removida depois): `go build` verde em 8 s
  sem nada copiado; `npm --prefix src/electron-app run tsc` sem `node_modules` -> rc 1 ("'tsc' nao e reconhecido").
  Copiado `src/electron-app/node_modules` (565 MB, 55 s; `entradas_ignoradas`, uma vez por lane): `tsc`, `renderer:typecheck`
  e `test:safety` verdes (34 pass, 0 fail). Nenhum arquivo RASTREADO mudou depois do build (`git status` limpo):
  `gerados` vazio (`dist/`, `renderer-dist/` e os `.js` do `tsc` sao gitignored).
- `go test ./...` (em `src/server`): `infrastructure/torrent` falha SEMPRE, inclusive na arvore principal
  (`torrent.test.exe: Access is denied`, cara de antivirus no binario de teste); `infrastructure/helpers` falhou 1 vez
  em 3 (`TempDir RemoveAll cleanup ... directory is not empty`). Linha de base do T3: "sem fail novo" fora desses dois.
- App em modo dev (`infrastructure/fileSystem.ts::getBackendExePath`): nao empacotado, o backend e `<repo>/dist/godsend-backend.exe`
  com `<repo>` = 3 niveis acima do `.js` -> rodando de uma lane, usa o backend DA LANE. `main.ts:7`
  `requestSingleInstanceLock` + `appDataPath.ts`: `userData` dev = `%APPDATA%\<app.getName()>`, um so para todas
  as lanes -> o slot e exclusivo de fato. Processo que marca ambiente ocupado: `godsend-backend` (dev e instalado).
  Sem `deploy` no `projeto.json`: o teste roda da lane (`npm start` dela), como o `teste.md` preve.
- Ciclo de pastas: o PS2Companion usa `docs/bugs/open` -> `docs/bugs/close`; motor (`final_report` C4, ciclo
  `("open","retest","done")`) e `teste.md` (Passo 8: `git mv ... docs/bugs/retest/` + `## Status` pedido no
  `docs/bugs/retest/README.md`) usam `retest/`. O planning cita o criterio de complexidade de
  `docs/bugs/open/README.md`. Nenhum dos dois READMEs existe la. Decisao: criar `docs/bugs/retest/README.md` e
  `docs/bugs/open/README.md` no PS2Companion; `close/` faz o papel de `done/` (manual diz). Doc movido para
  `close/` DURANTE uma execucao nao e reconhecido pelo C4 (fica `mecanico`): raro, aceito.
- Midia real: o cliente usa pendrive/HD + console. **Decisao do dono (2026-10-09):** o unico disco que o pipeline
  pode preparar/formatar/gravar e o USB `USB DISK 2.0`, serial `247700023090` (14,5 GB; hoje `E:` FAT32 `BADAVATAR`,
  lido com `Get-Disk`). Console nao se automatiza: o que so o PS2 prova fica como "falta para close".
- Outras decisoes do dono no mesmo dia: push do `master` autorizado; os 2 docs de 07/10 commitados como estavam (`767cac3`).
- **Fazer:** no PS2Companion, `.claude/skills/pipeline-correcao-bugs/{projeto.json,projeto.md}`, `docs/bugs/open/README.md`,
  `docs/bugs/retest/README.md`; `sync_copias.py --commit` (depois de commitar o resto, a copia num commit proprio);
  `preflight --skip-spawn`. **Prova:** preflight VERDE la e `sync_copias.py --check` -> igual a fonte.

**A3 FEITA, menos o trust (2026-10-09).** PS2Companion `master` publicado (`adc3684..d5ad456`; `origin/master...master` =
`0 0`, arvore limpa): `f9e84da` (`projeto.json`, `projeto.md`, `docs/bugs/{open,retest}/README.md`) e `d5ad456` (copia
da fonte em `811732d`). O `sync_copias.py --commit` RECUSOU a primeira vez (fonte com `git_pipeline.py` nao commitado
da sessao B): a copia saiu de uma worktree temporaria da fonte no `HEAD` (`--fonte`), removida depois.
`preflight --skip-spawn` rodado da copia, em `D:\projects\PS2Companion`:
- `[OK]` manual, os 3 itens `preflight` do `projeto.json` (go, npm, `node_modules`), `master`, `claude agents`,
  "rodizio de contas desligado neste projeto";
- `[FALHA] trust aceito no repositorio D:\projects\PS2Companion` -> **acao do dono**: rodar o `claude.exe` num terminal
  la, aceitar e sair (editar `~/.claude.json` para contornar e proibido, SKILL.md). Com isso o preflight fica VERDE;
- `[AVISO] copia da skill difere da fonte`: no momento da medida, so os arquivos que a sessao B estava editando
  (B2). Proximo `sync_copias.py --commit` depois do commit da B2 os leva. O aviso funciona como desenhado.
- Pendente: T5 (preflight com spawn, com o dono) depois do trust.

### 22.9 Sessao B — ARMSX2-forkv2 (task no planning + modo tasks)

Abrir em `D:\projects\play2\ARMSX2-forkv2`, com `C:\projects\retrobatnew\source` como diretorio adicional. O
motor se edita SO na fonte (retrobatnew); o ARMSX2 recebe a copia na B3.

**Fatos (2026-10-09):**
- Repo: worktree de `D:\projects\play2\ARMSX2`; base `origin/armsx2forkv2`; remotos `fork`, `origin`, `upstream` (22.2).
- `docs/task/`: 141 entradas = `TASK-NNNN-<slug>.md` + `README.md` + 4 subpastas
  (`TASK-0216-`, `TASK-0218-`, `TASK-0224-validar-no-aparelho/`, `_TASK-0090-medicoes/`). O ESTADO e um campo no
  arquivo, nao uma pasta: `- **Status:** aberta | em andamento | concluída | revertida` (`TASK_STATUSES`,
  `scripts/check_traceability.py:41`). Outros campos (TASK-0227): `Criada em`, `Concluída em`, `Feature`,
  `Bugs que resolve` (link `../bugs/open/armsx2-fork/<doc>.md`), `Commit` ("o vinculo e o prefixo `TASK-0227:`
  no assunto"), `Revertida por`, `Publicado em`.
- `check_traceability.py`: `concluída` exige commit alcancavel no ramo com assunto `TASK-NNNN: ...` (~420-431);
  fora dos `GUARDED_PREFIXES` (linha 49) so passa `ALLOWED_SUBJECT_PREFIXES = ("chore:",)` (linha 61). O motor
  monta `f"{COMMIT_DOCS}: ..."` (`pipeline.py:2879`), logo `"commit_docs": "chore"`; conferir os outros
  lugares que montam assunto.
- Bugs do ARMSX2 moram em SUBPASTAS: `docs/bugs/open/armsx2-fork/` e `docs/bugs/open/legado-version1/`.
- Motor: item = `st["bugs"][slug]`; estados `pendente -> planning -> planejado -> ...`, terminais
  `TERMINAL = ("retest", "documentado", "open-falhou")` (`pipeline.py:39`); `commit_external` (1508),
  `elencar` (1526), `finish_bug` (1671), `publish_docs_only` (1978); o C4 do `final_report` confere o ciclo
  de PASTA `("open", "retest", "done")` (~3084-3088). **Nao aberto:** como `cmd_init` descobre os bugs (grep
  de `docs/bugs` so acha a 2879) e se acha doc em subpasta.

**B1 — analise (gravar aqui ANTES de editar codigo):**
1. Task do bug (decisao 3): no planning, procurar task cujo `Bugs que resolve` aponte para o doc; se nao
   houver, criar `TASK-NNNN`. Numero livre: lanes de planning em paralelo e sessoes humanas do ARMSX2 tambem
   criam tasks, entao ha colisao; decidir quem numera (helper com lock?). Commit do dev: `TASK-NNNN: ...`.
   Quem muda o `Status` e os campos `Commit`/`Concluída em`, e quando (`concluída` so passa na CI com o
   commit alcancavel, ou seja, depois do publish).
2. Modo tasks (generico): como se escolhe (`init --tipo tasks`? `itens` no `projeto.json`?); o que conta como
   aberta (`aberta`, `em andamento`?); o que a etapa de teste prova numa task (sem sintoma: o `Objetivo` e os
   criterios do doc); estado terminal e C4 por CAMPO, nao por pasta; dependencias entre tasks nas ondas; ledger
   aberto continua valido (`st["bugs"]`).
3. Tasks em subpasta e `_TASK-0090-medicoes/`: entram ou nao.

Saida de B1: tasks de B2 com arquivo/simbolo e o teste de cada uma, gravadas aqui.

**B1 FEITA (2026-10-09) — registro antes da edicao.**

Lidos inteiros no motor: `configure`, `cmd_init`, `start_plannings`, `validate_plan`, `commit_external`, `elencar`,
`compute_wave`, `next_wave`, `finish_bug`, `defer_bug`, `stage_prompt`, `publish_head`, `normalize_doc_open`,
`publish_docs_only`, `cmd_enqueue_test`, `cmd_publish`, `cmd_test_done`, `cmd_blocked`, `cmd_final_docs`, `sync_main`,
`final_report`; `SKILL.md`, as 4 etapas, `projeto.json`; os dois testes. No ARMSX2: `docs/task/README.md`, TASK-0227,
`scripts/check_traceability.py` inteiro, `scripts/hooks/pre-push`, `docs/bugs/open/README.md` e `retest/README.md`.

Fatos (comando -> resultado):
- **O `init` nao descobre item nenhum:** le o JSON `--bugs` que o maestro monta (`SKILL.md`, iniciar 3-4). A pergunta
  "acha doc em subpasta?" e do maestro, nao do motor; o motor guarda `doc` como veio.
- **O motor supoe `/open/` -> `/retest/` em 5 lugares** (`grep -n "/open/" pipeline.py`): `normalize_doc_open`
  (1961), `publish_docs_only` (2005), `cmd_test_done` pass (2551), C4 (3087-3089). Num doc de task (`docs/task/...`,
  sem `/open/`) o `replace` devolve o PROPRIO caminho: `normalize_doc_open` faria `git rm` do doc da task, a TRAVA do
  `publish_docs_only` dispararia sempre, e o `test-done pass` passaria sem conferir nada. Toda essa logica tem de
  ramificar pelo tipo do item.
- **`retest/` do ARMSX2 e PLANO:** `Get-ChildItem docs/bugs/retest` -> so `README.md`; os bugs moram em
  `open/armsx2-fork/` (3 + 5 em `waiting/`) e `open/legado-version1/` (6); `done/` tambem e plano (55 docs). O
  `replace` geraria `retest/armsx2-fork/x.md`. Config nova: `"retest_sem_subpasta": true`.
- **Gancho ativo:** `git -C D:\projects\play2\ARMSX2-forkv2 config core.hooksPath` -> `scripts/hooks`; config do repo
  comum, logo vale nas lanes. O `pre-push` roda `check_traceability.py --commits <remoto>..<local>` (o script usa a
  arvore onde esta: a lane). Recusa = `git push` sai !=0 sem `[rejected]` na saida; hoje `publish_head` trata
  toda falha de push como corrida (3 tentativas, saida 6, "push rejeitado 3 vezes"): mensagem errada e 2 rodadas
  inuteis.
- **O que o validador exige** (`check_traceability.py`): assunto `TASK-NNNN:` (`COMMIT_TASK_RE`, 45) com o arquivo
  da task existindo (`check_commits`, 465); senao so `chore:` literal (61) e fora dos `GUARDED_PREFIXES` (49):
  `chore(terceiros):` e `docs:` do `sync_main` (2879-2883) REPROVAM, assim como `docs(bugs):`. `concluída` exige
  commit `TASK-NNNN:` alcancavel de HEAD (`check_task_has_commit`, 406). Task -> bug: o link de `Bugs que resolve`
  tem de existir (357) e o bug tem de conter o id (359); bug -> task pelo campo `Tasks que o resolvem` (494). Task
  concluida OU com commit sem linha no indice `docs/task/README.md` reprova (`check_index`, 684); `--fix` insere a
  linha com os hashes de HEAD (`fill_index`).
- **Numero da task:** `TASK-NNNN-<slug>.md`, unico NO RAMO, faixa do `armsx2forkv2` a partir de 0200, contiguidade
  nao exigida (README). Ultima hoje: TASK-0227. O validador NAO detecta dois arquivos com o mesmo numero
  (`tasks[tid] = ...` sobrescreve, 298).
- **Subpastas de `docs/task/`:** `TASK-0216-validar-no-aparelho/`, `TASK-0218-...`, `TASK-0224-...`,
  `_TASK-0090-medicoes/` guardam evidencia (`.apk`, `.so`, `.sh`, `.py`); o validador so le arquivo do topo que casa
  `^TASK-(\d{4})-.+\.md$` (`md_files`, 227). **Nao entram** (item 3).

Decisoes (item 1 e 2 de B1):
1. **Tipo do item no ledger:** `st["bugs"][slug]["tipo"]` = `"bug"` (padrao; ledger antigo sem a chave = bug) ou
   `"task"`, vindo do JSON do maestro. A chave `st["bugs"]` fica (ledger aberto continua valido). Estado terminal de
   task aprovada continua `retest` (= `concluída`; nao ha pasta). Branch continua `bugfix/<slug>` (C1 e `cleanup`
   procuram `bugfix/*`).
2. **Bloco `tarefas` no `projeto.json`** (ausente = comportamento de hoje): `pasta`, `arquivo` (regex com o numero
   no grupo 1), `id` (`"TASK-{n:04d}"`), `minimo` (200), `campo_status`, `abertas` (`["aberta"]`), `concluida`,
   `bug_exige_task`. Assunto do commit da task = `<id>:`.
3. **Numeracao: o helper reserva** (`task-reserve --bug <slug>`, lock `tarefas`, idempotente por item): numero =
   1 + maior entre (a) `ls-tree <base> <pasta>`, (b) arquivos da `pasta` em TODA arvore de `git worktree list`
   (principal, lanes, o checkout `D:\projects\play2\ARMSX2`: pega task nao commitada de sessao humana), (c) assuntos
   `<id>:` de `git log --all`, (d) reservas do ledger; nunca abaixo de `minimo`. Colisao com sessao humana que crie
   arquivo DEPOIS da reserva continua possivel (ela nao usa o lock): o `plan-done` e o `test-done pass` recusam
   numero repetido na arvore (saida 2).
4. **Planning** (bug com `bug_exige_task` e veredito `corrigir`): procura task da `pasta` cujo texto cite o nome do
   doc do bug e cujo status esteja em `abertas` ou seja `em andamento`; se nao houver, `task-reserve` e cria o
   arquivo pelo template do manual. Plano ganha `"task": "<caminho>"`. `validate_plan` confere: arquivo existe na
   wt-planning e casa `arquivo`; task nova = numero reservado para ESTE item; status != `concluida`; a task cita o
   nome do doc do bug e o bug cita o id. Item `task`: o proprio doc e a task (campo opcional).
5. **Quem muda o Status:** a sessao de TESTE, no Passo 8 (aprovado): `concluída` + `Concluída em`, no mesmo push do
   fix (o commit `<id>:` do dev ja esta em HEAD, entao o gancho aceita). O helper confere no `test-done pass`: Status
   `concluida` em `HEAD:<task>` e commit `<id>:` em `synced_base..HEAD`. O `enqueue-test` exige ao menos um commit
   `<id>:` no branch (o dev usou o assunto certo). Reprovacao depois do Passo 8: o helper devolve o Status ao valor do
   planning (`normalize_task_status`, irmao do `normalize_doc_open`) com nota no topo; a TRAVA do `publish_docs_only`
   passa a recusar task `concluída` num item que fica em open.
6. **Indice `docs/task/README.md`:** editado em cada branch, dois itens da onda conflitariam no rebase do publish
   (saida 4 -> volta ao dev sem culpa). Fica com um passo novo e generico `antes_do_push` do `projeto.json`, rodado
   pelo `publish_head` DEPOIS do rebase e DENTRO do lock `push` (sequencial: sem conflito): o cmd (no ARMSX2,
   `check_traceability.py --fix`) e commitado com o assunto configurado se so mexeu em `docs/`; mexeu fora -> saida
   17; push recusado por corrida -> o commit dele e desfeito antes do novo rebase.
7. **Push recusado sem `[rejected]`** (gancho, pre-receive, rede): saida **17** na hora, com a saida do git. So
   `[rejected]` (corrida) repete.
8. **Assuntos do `sync_main` configuraveis:** `commit_docs_outros` (padrao `docs`) e `commit_terceiros` (padrao
   `chore(terceiros)`); no ARMSX2 os dois `chore`. O codigo de terceiro em caminho guardado continua recusado pelo
   gancho -> saida 17 -> pendencia do dono (correto: precisa de task).
9. **Modo tasks no maestro:** `iniciar tasks` lista os arquivos do topo da `pasta` NA BASE com status em `abertas`
   (`em andamento` fica excluido com motivo: ha sessao escrevendo codigo; o dono inclui pelo nome). O teste de uma
   task prova o `Objetivo` e o `Como validar` dela; controle positivo = a validacao falha na base, ou o motivo de
   nao haver.
10. **Dependencias:** plano ganha `depende_de` (slugs DESTA execucao; desconhecido = plano invalido). `compute_wave`
    so escolhe item cujas dependencias estao em `retest`. Dependencia terminada fora de `retest`, ou ciclo (nada
    escolhivel com item `planejado` sobrando), -> `open-falhou` com o motivo; sem isso `next_wave` abriria a
    finalizacao com item `planejado` no ledger.
11. **C4 por campo:** item task: doc no base e, em `retest`, Status `concluida` (senao mecanico); bug com task em
    `retest`: idem para a task. Pastas do ciclo por `stage_path` (respeita `retest_sem_subpasta`).

Hipoteses descartadas:
- **Rodar `check_traceability.py` dentro do helper:** e regra do ARMSX2; o gancho ja roda no push e o motor so
  precisa dizer a verdade quando ele recusa (saida 17).
- **`init --tipo tasks` para a execucao toda:** o tipo e do ITEM; uma execucao pode misturar bug e task.
- **O planning numerar sozinho (maior + 1):** 4 planners em paralelo na mesma wt-planning pegam o mesmo numero.
- **Pasta `retest/` para task:** o ARMSX2 nao move task de pasta; o estado e o campo.
- **`--fix` do indice na sessao de teste:** conflito de rebase entre itens da mesma onda (decisao 6).
- **Hash da task escrito no proprio commit:** o README proibe (o hash so existe depois do commit).

**Tasks de B2** (arquivo `scripts/pipeline.py`, salvo indicado; prova em `git_pipeline.py` [tasks] com repo real e
config ARMSX2-like, ou `sim_pipeline.py` [tasks] para ondas):
- B2.1 `configure`: `TAREFAS`, `RETEST_FLAT`, `COMMIT_DOCS_OUTROS`, `COMMIT_TERCEIROS`, `ANTES_DO_PUSH`; `retest_path`,
  `stage_path`, `task_field`. Prova: suite atual verde (padroes = hoje); `retest_path` plano e com subpasta.
- B2.2 `cmd_init` grava `tipo`; `stage_prompt` diz Task/Doc da task e a task do bug com o assunto. Prova: [tasks]
  init com item task.
- B2.3 `cmd_task_reserve` + `task_numbers`. Prova: numero = maior de base/arvores/log/ledger + 1, nunca < minimo;
  idempotente; arquivo nao commitado na arvore principal e reserva de outro item contam.
- B2.4 `validate_plan` (`task`, `depende_de`). Prova: task existente reaproveitada; task nova com numero de outro
  item recusada; `concluída` recusada; sem link cruzado recusada; numero repetido recusado.
- B2.5 `cmd_enqueue_test`: commit `<id>:`. Prova: branch sem o assunto -> saida 2.
- B2.6 `cmd_test_done` pass por tipo; `normalize_task_status`; `publish_docs_only` e `normalize_doc_open` por tipo.
  Prova: pass recusado com Status != concluida ou sem commit `<id>:`; task item sem pasta retest passa; reprovacao
  devolve o Status e o doc da task NAO e apagado.
- B2.7 `publish_head`: `antes_do_push` + saida 17. Prova: gancho pre-push real que recusa `docs(bugs):` -> 17 sem
  repetir; `antes_do_push` commita `chore:` so em docs e o push passa.
- B2.8 `sync_main` assuntos configuraveis. Prova: commit de terceiro com `chore:` na config ARMSX2-like.
- B2.9 `compute_wave`/`next_wave` com `depende_de`. Prova (sim): dependente espera; dependencia reprovada e ciclo ->
  `open-falhou`, e a finalizacao so abre depois.
- B2.10 C4 por tipo. Prova: task em retest com Status aberta -> mecanico; concluida -> ok.
- B2.11 `SKILL.md` e `etapas/*.md` (genericos; o grep da T2 continua sem ocorrencia).

**B2 — implementacao** em `C:\projects\retrobatnew\source\skills\pipeline-correcao-bugs\`, so com `pipeline.py`
sem hunk alheio. **Prova:** `python sim_pipeline.py` e `python git_pipeline.py` verdes sem mudar assert
existente, mais casos novos: task existente reaproveitada; task criada sem colisao de numero; `concluída` so com
commit alcancavel; assunto `TASK-NNNN:`; commit de docs `chore:`.

**B2 — ajustes decididos na leitura, antes da edicao (2026-10-09, sessao B):**
- Pre-condicao conferida: `git status --short -- skills/pipeline-correcao-bugs/` estava SUJO as 11:52 (A2 da
  sessao A: `pipeline.py`, `git_pipeline.py`, `sync_copias.py`); esperei o commit `a2e2724` (11:59) sem editar.
- **O gancho do ARMSX2 nao confere so o range:** `check_traceability.py --commits <r>` roda TODA a checagem da arvore
  (formato e campos obrigatorios da task, `# TASK-NNNN:` no titulo, links task<->bug, indice) e mais os commits.
  Logo a task que o planning cria tem de estar completa no formato do repo ja no commit do `elencar` (template no
  `projeto.md` da B3). `python scripts/check_traceability.py` na arvore do ARMSX2-forkv2 hoje -> `OK -- 132 task(s)`
  (rc 0): o pipeline parte de uma base verde.
- Campo lido como o validador le: `^-\s+\*\*<campo>:\*\*\s*(.*)$` (`field`, linha 105), com acento (`concluída`).
- Bloco `tarefas` ganha `em_andamento` (`["em andamento"]`: reaproveitavel pelo planning, fora do `iniciar tasks`) e
  `campo_concluida_em` (opcional; volta a `—` na reprovacao). `id` define o prefixo do assunto (`TASK-`).
- `task-reserve` usa o lock `state` (ja serializa todo o ledger, onde a reserva mora), nao um lock `tarefas` a parte.
- `normalize_task_status` so devolve o Status se a BASE nao tem a task `concluída` (uma sessao humana pode ter
  concluido por fora; reverter seria apagar o trabalho dela), e a TRAVA do `publish_docs_only` idem.
- Arquivo de task reescrito por bytes (preserva o fim de linha; `write_text` no Windows grava CRLF).
- Corrida no push = linha `! [rejected]` na saida do git; `[remote rejected]` (pre-receive) e gancho local -> 17.
  Recusado com commit do `antes_do_push`: `reset --keep HEAD~1` antes de repetir ou de sair.

**B2 FEITA (2026-10-09, sessao B).** B2.1-B2.10 em `scripts/pipeline.py`; B2.11 em `81666e6`; testes em `a10f2f2`
(`git_pipeline.py`) e `d788ecc` (`sim_pipeline.py`).
- **O codigo foi para o origin por outro caminho:** com a edicao ainda sem commit, a finalizacao da execucao
  `20261009-1144` (rodando no retrobatnew) fez `final-sync-main` e publicou o `pipeline.py` como codigo de terceiros
  (`a361a1b`, `chore(terceiros): ...`, 12:34; o build compilou). Era o desenho do `sync_main` de entao, e a
  regra "editou: commit na hora" vale tambem contra a propria finalizacao. Tratado como defeito depois: bug
  `pipeline-final-sync-main-publica-codigo-da-skill-em-edicao-por-outra-sessao_2026-10-09` — desde 2026-10-10 o `sync_main` deixa o
  arquivo modificado da pasta da skill como pendencia do dono (secao 18, "Como"). `git diff a361a1b -- .../pipeline.py` = vazio:
  o commit contem exatamente a B2. Historia publicada nao foi reescrita.
- Simbolos novos: `stage_path`, `retest_path`, `task_field`/`set_task_field`/`task_status`, `item_kind`, `task_of`,
  `task_number`/`task_id`/`task_commits`, `task_plan_errors`, `task_numbers`, `cmd_task_reserve` (`task-reserve --bug`),
  `task_concluded_at`, `task_done_errors`, `normalize_task_status`, `fail_dependents`, `PUSH_RACE`, `before_push`.
  Mudados: `configure`, `cmd_init`, `stage_prompt`, `validate_plan`, `cmd_enqueue_test`, `normalize_doc_open`,
  `publish_docs_only`, `cmd_test_done`, `publish_head`, `sync_main`, `compute_wave`, `next_wave`, C4 do `final_report`.
- **Prova:** `python sim_pipeline.py` -> `SIMULACAO VERDE`, 280 OK = 275 + 5 `[tasks]`; `python git_pipeline.py` ->
  `GIT VERDE`, 202 OK = 169 + 33 `[tasks]` (`grep -c "^OK"`). Nenhum assert existente mudou. Os `[tasks]` do git rodam
  com repo real, gancho `pre-push` real (recusa assunto fora de `TASK-NNNN:`/`chore:`; finge uma corrida uma vez) e
  `antes_do_push` que escreve o indice. `preflight --skip-spawn` no retrobatnew -> `PREFLIGHT VERDE`.
- **Controle positivo (codigo estragado de proposito, restaurado por bytes):** gancho tratado como corrida -> falha (o
  FAIL sai dentro da saida capturada; rc 1); `task_done_errors` vazio -> falha; `normalize_task_status` desligado ->
  falha; C4 sem a task -> falha; onda sem `depende_de`, sem `fail_dependents`, ciclo sem `open-falhou` -> falham.
  **Nao pegou:** tirar o `if others` do `task_plan_errors` nao muda nada, porque o ramo seguinte ("task nova sem
  reserva deste item") recusa o mesmo caso. O `others` so da a mensagem mais clara; o comportamento esta coberto.

**B3 = T4 do ARMSX2:** `projeto.json` (`base` `origin/armsx2forkv2`, `remoto` origin, `rodizio_contas` false,
`commit_docs` `chore`, build `cmake ... && ninja -j 4 emucore_4k` (13 min 45 s; `-j 4` por OOM),
`entradas_ignoradas` com as dependencias do shaderc (264 MB, nao vem com worktree nova), `e2e` = aparelho via
adb) + `projeto.md` com a regra da task; skill em `skills/pipeline-correcao-bugs/`, junction em `.claude/skills/`
(gitignored); commit `chore:`. **Prova:** `preflight --skip-spawn` verde no ARMSX2-forkv2.

**B3 — registro antes da edicao (2026-10-09, sessao B).** Lidos no ARMSX2-forkv2: `CLAUDE.md` secao Build, `docs/task/README.md`
(nome, Status, template), `docs/skill/README.md` (junction), `scripts/hooks/pre-push`, `scripts/check_traceability.py`
(`main`, `field`, `check_commits`, `check_bugs`, `check_index`, `fill_index`); no motor, `preflight_project`, `provision_wt`
e `sync_copias.py` inteiro.
- Build (CLAUDE.md, medido em 2026-08-26: config 120,7 s + build 825 s): `cmake -G Ninja ... -S platforms/android/app/src/main/cpp
  -B <build>` e `ninja -j 4 emucore_4k`, com o cmake/ninja `D:/DevCaches/Android/Sdk/cmake/3.31.6/bin` (nenhum dos dois no PATH:
  `which cmake ninja` -> nao acha). Pasta de build da lane: `{wt}/build-pipeline` — `git check-ignore -v build-pipeline/x` ->
  `.gitignore:33:/build*`, entao nao suja a worktree (o `enqueue-test` recusaria `??`).
- `entradas_ignoradas`: as 7 pastas de `platforms/android/app/src/main/cpp/3rdparty/shaderc/third_party/` (`abseil_cpp effcee glslang
  googletest re2 spirv-headers spirv-tools`), todas ignoradas (`git check-ignore -q` em cada uma -> ignorada) e presentes na
  arvore principal: o `provision_wt` as copia (264 MB por lane, uma vez).
- `core.hooksPath = scripts/hooks` e RELATIVO: numa lane resolve para o `scripts/hooks` da propria lane (mesmo ramo). O
  gancho roda a checagem INTEIRA; `--fix` tambem (sai 1 com qualquer problema na arvore): no `antes_do_push`, isso e saida 17
  com o relatorio, o mesmo que o gancho daria.
- E2E: aparelho Android por adb (`adb` no PATH; `adb devices` hoje -> nenhum aparelho). Nao ha processo local a vigiar:
  `e2e` vazio (o slot ja serializa o aparelho). Receita de instalacao no aparelho de teste (APK de qual flavor, com que
  `applicationId` para nao sobrescrever um instalado de cliente) **nao esta escrita no repo**: fica como pendencia do dono no
  `projeto.md`, e a T5 nao roda sem ela.
- Arvore principal com 3 modificados + 3 `.bak` nao rastreados de outra sessao (`catalog_*`): nao sao desta sessao, ficam.
  Commits da B3 so com pathspec dos arquivos da skill.

**B3 FEITA, menos o trust (2026-10-09, sessao B).** No ARMSX2-forkv2: `59e404e41a` (`projeto.json` + `projeto.md`) e
`6c15fe5045` (`sync_copias.py --commit --destino ...`: 9 arquivos, "copiada da fonte (c6b136a)"); junction
`.claude/skills/pipeline-correcao-bugs` -> `skills/pipeline-correcao-bugs` (`.claude/` ignorado: `check-ignore` ok).
Corrigido no `projeto.md` antes do commit, por leitura: so ha um `strings.xml` (`res/values/`), e `legado-version1/` e da
linha antiga (so entra a pedido do dono).
- **Prova:** `python skills/pipeline-correcao-bugs/scripts/pipeline.py preflight --skip-spawn` no ARMSX2-forkv2 -> todos os itens
  do projeto `[OK]` (cmake 3.31.6, NDK, shaderc, `core.hooksPath`, rastreabilidade verde, adb, "copia da skill igual a fonte",
  rodizio desligado) e **`[FALHA] trust aceito no repositorio`**: `PREFLIGHT VERMELHO` so por isso. O trust e do dono (SKILL.md:
  nunca contornar editando `~/.claude.json`).
- `python scripts/check_traceability.py --commits origin/armsx2forkv2..HEAD` -> `OK -- ... 3 commit(s)`. **Push nao feito:**
  o terceiro commit local (`dc1c2593c0 TASK-0227: ...`) e de outra sessao e iria junto; a publicacao e do dono.
- **Nao provado (fica para a T5, com o dono):** o `build` do `projeto.json` numa lane (configure + `ninja -j 4`, ~16 min na
  primeira vez) e a receita de E2E no aparelho (pendencia escrita no `projeto.md`, secao Teste).

**Proximo (passagem de bastao):** o dono aceita o trust em `D:\projects\play2\ARMSX2-forkv2`, publica (ou manda publicar) o
`armsx2forkv2` com os 3 commits, e responde a pendencia de E2E do `projeto.md`; depois a T5 (preflight com spawn) e um
`build --bug` numa lane real. Abertura da proxima sessao: "Leia `C:\projects\retrobatnew\source\skills\pipeline-correcao-bugs\DESIGN.md`,
secao 22.9, 'B3 FEITA' e 'Proximo', e faca a T5 do ARMSX2."

### 22.10 T2 — etapas genericas + `projeto.md` do retrobatnew (2026-10-09)

**T2 FEITA:** `e69154f` (publicado em `origin/versao3`). Esta secao nasceu como "22.7", em paralelo com a 22.7 das
decisoes do dono; renumerada para nao haver duas.

Lidos inteiros: `etapas/{planning,dev,teste,finalizacao}.md`, `SKILL.md`; no motor, `configure`,
`stage_tuning`, `stage_prompt` e o inicio de `cmd_preflight`. (Registro escrito DEPOIS da edicao, fora da
ordem da regra "analitica antes da operacional"; o conteudo e o que guiou a edicao.)

**Desenho aplicado:**
- O helper injeta no prompt de toda etapa tres linhas novas: `Manual do projeto: <skill>/projeto.md`
  (global `MANUAL`, preenchido no `configure`), `Arvore principal: <SRC>` e `pasta do pipeline: <PIPE>`.
  As etapas falam em "a arvore principal", "`<pasta do pipeline>`", "o fluxo principal" (ja estava no
  prompt) e "o manual, secao X", nunca em caminho.
- `projeto.md` tem secoes de nome fixo, que as etapas citam: **Caminhos, Leituras obrigatorias, O app e o
  runtime, Planning, Bug de outro projeto, Dev, Teste (E2E), Finalizacao, Maestro**. O `projeto.md` dos
  outros repos (T4) precisa das mesmas secoes; renomear uma = atualizar as etapas.
- `preflight` ganhou `[OK]/[FALHA] manual do projeto` (sem `projeto.md`, VERMELHO).
- O texto de precedencia do prompt citava "o 'trabalhe sempre em source/' do CLAUDE.md da raiz"; virou
  "regra de CLAUDE.md/AGENTS.md que mande trabalhar na arvore principal".
- `SKILL.md` (o maestro, que tambem vai para as copias) ficou generico: `H`, ledger, lista de bugs
  (`git -C <repo> ... <base>`), trust e push citam o `projeto.md`; a secao do rodizio abre dizendo que so
  vale com `"rodizio_contas": true` e o que acontece desligado (o comportamento da T1).
- `teste.md` cobre projeto sem `deploy` (o helper recusa com saida 2 -> caminho do manual) e
  `finalizacao.md` diz que `final-deploy` sai 0 sem deploy. O prefixo `docs(bugs)` ficou nas etapas com
  "ou o do manual" (o motor usa o `commit_docs` do `projeto.json`).

**Hipotese descartada:** deixar exemplos RetroBat nas etapas como "ex.:" — a copia sincronizada (T3) os
levaria para os outros repos, e a prova exige zero ocorrencias.

**Leitura lado a lado (onde foi parar cada trecho especifico removido):**
- planning: worktree/arvore/`reports\` -> prompt + Caminhos; `docs/README.md` e READMEs de bugs -> Leituras
  obrigatorias; exemplos de `sem-codigo`/`bloqueado` (acervo, GPU AMD, Windows 7), exemplo de arquivo,
  arrastes (`.csproj` com os 320 `.cs`, `.resx` + pt-BR, `CMakeLists.txt`, `catalog_manifest_*.txt`),
  "launcher/ES" do effort e a receita da T2 (`dist\retrosystem`, ROM/BIOS/janela, UI do ES,
  `emulatorLauncher -noninteractive` so como complemento) -> Planning; rota do `digitalstoregamesproject`
  (triagem-chamados Passo 4, `docs/modules/...`, nao commitar e por que) -> Bug de outro projeto.
- dev: "relativo a `source/`" -> Caminhos; gerados do CMake, arrastes e `fix(<area>): ... (bug: <slug>)` ->
  Dev; `--skip-es/--skip-el` e o lock do build do ES -> O app e o runtime.
- teste: "onde o teste roda" + diagrama, prova pela UI do ES, regra de dois testes no slot
  (`es_settings.cfg`, `autoperf-rules.json`, PCSX2), o que o `env-wait` procura, foco/SendInput como
  ambiente, `emulatorLauncher.log`/`es_log.txt`, `tests\runs`, a tabela T2/T3/T4 (`es_driver.py`,
  `retrobat-tests`, receita A/B, `CrashDumps/`) e as regras do `dist/` compartilhado -> Teste (E2E).
- finalizacao: `deploy.ps1 -BuildOnly` do `final-sync-main`, `final-deploy` com MD5 dos dois `.exe`, saida
  11, caminho do briefing e o link `../../source/docs/...`, `deploy-all.ps1` -> Finalizacao.
- SKILL.md: helper, ledger, junction -> Caminhos; trust, `git -C source push origin versao3`, doc do
  rodizio -> Maestro. **Unica regra perdida na 1a passada:** "o E2E toma teclado e tela: a maquina deve
  ficar ociosa" (iniciar, passo 5) -> acrescentada em Maestro.

**Prova:**
- `grep -rn -i "retrobat\|versao3\|retrosystem" etapas/` -> nenhuma linha (rc=1); idem para `C:\`,
  `deploy.ps1`, `digitalstore`, `emulationstation`, `emulatorLauncher`, `ES`, `csproj`, `resx`, `CMake`,
  `SendInput`.
- `python sim_pipeline.py` -> `SIMULACAO VERDE`, 275 OK; `python git_pipeline.py` -> `GIT VERDE`, 156 OK.
  Os mesmos numeros do codigo da T1: rodei o `git_pipeline.py` com o `pipeline.py` do commit `0264702` no
  lugar e deu 156 tambem (bate com a recontagem de 22.6).
- Prompt da finalizacao renderizado com o `pipeline.py` real: as 3 linhas novas com
  `...\pipeline-correcao-bugs\projeto.md`, `C:\projects\retrobatnew\source` e
  `C:\projects\retrobatnew\.bugfix-pipeline`.
- `python skills/pipeline-correcao-bugs/scripts/pipeline.py preflight --skip-spawn` -> `PREFLIGHT VERDE`, com
  `[OK] manual do projeto ...\projeto.md` e os 4 itens do `projeto.json` em `[OK]`.

**Proximo** (plano da 22.7): T3 = A2 da sessao A (22.8); T4 = A3 (PS2Companion) e B3 (ARMSX2-forkv2), cada uma
com um `projeto.md` que tenha as secoes acima; Downloader e Lemuroid sem sessao definida.

### 22.11 Passagem de bastao (2026-10-09 13:30) — proxima: sessao C, T4 do Downloader; depois D, T4 do Lemuroid

Escrito pela sessao da T2 (22.10), que fecha aqui. **Estado medido as 13:26:**
- Feitas: T1, T2, A1, A2 (= T3, `sync_copias.py`), A3 (= T4 do PS2Companion; falta o trust do dono). B1 feita; **B2 em
  andamento** (testes `[tasks]` commitados em `a10f2f2`, so local; `pipeline.py` com mudanca nao commitada da sessao B);
  B3 pendente; T5 com o dono.
- Arvore principal: 0 atras do `origin/versao3`; a frente, 3 commits de A/B (`811732d`, `a10f2f2`, `76083e9`) e 2 desta
  sessao (o bug abaixo e este registro). **Nao publicados de proposito:** `a10f2f2` traz testes da B2 sem a implementacao
  inteira; quem publica e a sessao B ou o `final-sync-main` da proxima finalizacao.
- Execucao `20261009-1144`: 2 bugs em `retest`, `final` vazio. A finalizacao dela commitou e publicou a B2 pela metade
  (`a361a1b`, 12:34): bug `docs/bugs/open/pipeline-final-sync-main-publica-codigo-da-skill-em-edicao-por-outra-sessao_2026-10-09.md`.
- Downloader e Lemuroid: sem sessao, fora de `DESTINOS` (`scripts/sync_copias.py`), sem `projeto.json`.

**Sessao C = Downloader; depois sessao D = Lemuroid, mesmos passos.** Uma por vez (as duas editam `DESTINOS` e esta
secao); cada uma escreve so na sua subsecao (22.11.C / 22.11.D, abaixo desta).
1. Ler 22.2 (fatos, medidos na manha de 2026-10-09), 22.4 (desenho), 22.7 (regra das sessoes paralelas), 22.8 A2/A3
   (o `sync_copias.py`; o PS2Companion e o modelo: `D:\projects\PS2Companion\.claude\skills\pipeline-correcao-bugs\`
   `projeto.json`/`projeto.md`) e 22.10 (as secoes que todo `projeto.md` tem de ter: as etapas as citam pelo nome).
2. Re-medir no repo: `git branch -vv`, `git status --short`, `git rev-parse --abbrev-ref @{u}`, `git ls-files .claude`,
   `ls docs/bugs/open docs/bugs/retest`. Gravar na subsecao ANTES de editar (regra analitica -> operacional).
3. Destino `<repo>\.claude\skills\pipeline-correcao-bugs\` (os dois versionam `.claude/`, como o PS2Companion; conferir
   `git check-ignore -v` nesse caminho). As etapas leem `docs/bugs/open/README.md` (template) e
   `docs/bugs/retest/README.md` (secao `## Status`): se faltarem, criar como a A3 fez no PS2Companion.
4. `projeto.json` + `projeto.md`. Build medido NUMA WORKTREE do repo: o que faltar por ser ignorado pelo git vira
   `entradas_ignoradas`. `rodizio_contas: false` (22.7 item 1).
   - Downloader: base `origin/main`; `npm run build:server` (go build); `npm run test:safety` em `src/electron-app`; E2E
     Playwright (`npx playwright test` em `src/electron-app`; `docs/agents/skills/playwright-testing.md`).
   - Lemuroid: base `origin/version9`; bugs em `docs/bugs` (decisao do dono; `documentacao/bugs` fica fora);
     `gradlew :lemuroid-app:assembleFreeBundleDebug`; `local.properties`, `build.properties` e `release.jks` sao
     ignorados (candidatos a `entradas_ignoradas`); o submodulo `lemuroid-cores` vem VAZIO numa worktree nova e o motor
     nao tem passo de provisionar (22.6 deixou fora): medir antes de decidir; E2E no aparelho (adb,
     `build_and_install_connected.ps1`).
5. Na fonte, `scripts/sync_copias.py`: acrescentar o repo em `DESTINOS` (dict nome -> `Path` da copia, linhas 25-28) e
   commitar na hora; `python sync_copias.py --check` (aponta `falta`), depois `--commit`. Com mudanca nao commitada nos
   arquivos sincronizados da fonte (a B2), o `--commit` recusa: usar `--fonte` com uma worktree temporaria da fonte no
   `HEAD`, como a A3 (22.8), e remove-la no fim.
6. Rodar `python <repo>\.claude\skills\pipeline-correcao-bugs\scripts\pipeline.py preflight --skip-spawn` no repo.
   Esperado: verde menos `[FALHA] trust` (acao do dono, como no PS2Companion) e `[AVISO] copia difere` enquanto a B2
   nao commitar.
7. Commit so dos arquivos da skill (e dos README de bugs, se criados), por pathspec. Push so com ok do dono (mostrar
   `git log --oneline origin/<base>..`).

**Prova:** a saida do passo 6 e `sync_copias.py --check` com `[OK]` para o repo, registradas na subsecao.

**Cuidados:**
- Nao editar `pipeline.py`, `git_pipeline.py`, `SKILL.md` nem `etapas/` da fonte enquanto a B2 tiver mudanca nao
  commitada neles (22.7).
- Com execucao do pipeline viva (`C:\projects\retrobatnew\.bugfix-pipeline\state.json` com `final` vazio), as sessoes
  dela rodam o helper da arvore principal, e o `final-sync-main` leva arquivo de terceiros parado ha mais de 10 min (bug
  acima): commitar cedo, nunca deixar nada pela metade na arvore principal.
- Antes de commitar no Downloader, ver se o repo tem deploy que publica o branch inteiro ou faz `git add .` (o caso do
  `deploy-all.ps1` do digitalstoregamesproject, memoria do dono): se tiver, commit local = publicado em breve.

**Frase de abertura (sessao C):** abrir o Claude Code em `C:\projects\Downloader-XBOX360-XEX-HDD-Games`, com
`C:\projects\retrobatnew\source` e `D:\projects\PS2Companion` como diretorios adicionais, e dizer: "Leia
`C:\projects\retrobatnew\source\skills\pipeline-correcao-bugs\DESIGN.md`, secao 22.11, e faca a T4 do Downloader a
partir do passo 1." Sessao D: o mesmo em `C:\projects\lemuroid\Lemuroid`, "T4 do Lemuroid", depois de a C fechar.

#### 22.11.C Sessao C — T4 do Downloader (2026-10-09)

Aberta em `C:\projects\retrobatnew` (nao no Downloader, como a frase de abertura pedia): tudo por caminho absoluto.

**Passo 2 — medido as 13:40, antes de editar:**
- `git branch -vv`: `main` @ `1ce5e27` `[origin/main: ahead 22]`. Os 22 sao de OUTRA sessao em curso (fix FAT32 65.536
  entradas, ultimo commit 13:37). `origin/main` = `002d3c8` (assunto `*`).
- `git status --short`: `M .godsend.lock`, `M pending_queue/0b51dd86eaf970cde0c9ce9a.json`, 5 `M` em
  `src/android-app/.gradle/...` e `M docs/bugs/open/pipeline-gravacao-local-fragmenta-...md` (da sessao do FAT32).
- `git rev-parse --abbrev-ref @{u}` -> `origin/main`. Remotos `origin` (luistiagos/GODSend) e `upstream` (ghostyshell).
- `git ls-files .claude`: `CLAUDE.md`, `settings.json`, 6 skills `.md` soltas e `skills/triagem-chamados/` -> `.claude/` e
  versionado. `git check-ignore -v .claude/skills/pipeline-correcao-bugs/projeto.json` -> rc 1 (nao ignorado).
- `docs/bugs/`: `open/` (17 docs) e **`closed/`** (nao `close/` nem `done/`); sem `retest/`, sem README em nenhuma das duas.
  Template, severidade P0-P3 e ciclo `open -> closed` estao em `docs/agents/skills/bug-triage.md` (secao 3).
- Deploy que publica sozinho: `grep -n "git "` em `build-and-upload.ps1`, `upload-*.ps1`, `build-portable-local.ps1`,
  `scripts/*.ps1` -> nada. Commit local NAO vai ao ar sozinho.

**Passo 4 — build medido na lane real** (`git worktree add --detach C:\projects\.bugfix-xbox360\lanes\wt-planning origin/main`):
- **Caminho longo derruba a lane padrao.** O repo rastreia 425 arquivos de `src/android-app/app/build/` e 91 de
  `src/android-app/.gradle/`; o maior caminho rastreado tem 203 caracteres (`git ls-files | awk '{print length($0)}'`) e
  `core.longpaths` nao esta ligado. A 1a tentativa (worktree no scratchpad, prefixo ~100) falhou com `Filename too long`.
  O PIPE padrao (`C:\projects\.bugfix-pipeline-Downloader-XBOX360-XEX-HDD-Games`) da prefixo de lane de 80 caracteres
  (`...\lanes\wt-planning\`, o nome de lane mais longo) -> 283 > 259. **`pipe_dir` = `../.bugfix-xbox360`**: prefixo 46 ->
  249. Nao liguei `core.longpaths` (config do repo, de todos; nao precisa).
- `npm run build:server` na lane, sem nada copiado: rc 0 em 16 s; gera `dist/godsend{,-windows-x64,-windows-ia32}.exe` e
  BAIXA da rede `dist/tools/` (aria2c, fat32format; `scripts/download-*.js` pulam se ja existe). `dist/tools` (21 MB,
  gitignored) vira `entradas_ignoradas`: build sem rede e sem depender de mirror.
- `npm --prefix src/electron-app run tsc` sem `node_modules` -> rc 1 (`'tsc' nao e reconhecido`).
  `src/electron-app/node_modules` (1023 MB) copiado com `shutil.copytree(symlinks=True)` (o `provision_wt`): 25 s, maior
  caminho na lane 177. Depois `npm --prefix src/electron-app run test:safety`: rc 0, 52 s, **258 pass, 0 fail**.
- `go test -count=1 ./...` em `src/server` na lane: rc 0, 13 s, 9 pacotes `ok`, nenhum `FAIL` (linha de base do T3 limpa).
- `git status --short` na lane depois de build + testes: vazio -> nenhum gerado RASTREADO pelo build.
- `src/electron-app/assets/badavatar-1.1/` (726 MB, gitignored; `.gitignore`: "reimportavel com `npm run payload:update`") e
  o pacote que o preparo do pendrive grava. Sem ele o E2E de BadAvatar nao roda na lane -> `entradas_ignoradas`.
  Disco C com 1,1 TB livre: ~1,8 GB por lane e aceitavel.

**O app no E2E** (lido: `electron-app/infrastructure/fileSystem.ts::getGodsendExePath`/`getBundledRoot`/`getRepoRoot`,
`services/appDataPath.ts::getPlatformDefaultUserData`, `main.ts:7-9`):
- Modo dev (`npm start` = `renderer:build` + `tsc` + `electron .`): backend = `<lane>/dist/godsend-windows-x64.exe` (1o
  candidato) -> processo `godsend-windows-x64`. O instalado chama `godsend-backend`. Medido agora: PID 26108
  `godsend-windows-x64` rodando da arvore principal (outra sessao/o dono).
- `userData` dev = `%APPDATA%\xbox-360-companion-electron` (existe; `config.json` so com `lastUpdateCheck`, `serverPort`),
  um para todas as lanes, com `requestSingleInstanceLock` -> slot exclusivo de fato. O instalado usa
  `%APPDATA%\Xbox 360 Companion` (outra pasta).
- Raiz de runtime dev = raiz da arvore (`getBundledRoot` -> `getRepoRoot` = 3 niveis acima do `.js`): o app da lane grava
  `.godsend.lock`, `pending_queue/`, `cache/`, `Temp/`, `Ready/` NA LANE. `.godsend.lock`, `pending_queue/*.json` e
  `cache/*.json` sao RASTREADOS (por isso aparecem `M` na arvore principal).
- **Consequencia para o motor:** `.godsend.lock`, `pending_queue/`, `pending_ftp/` e `src/android-app/(.gradle|app/build|build)/`
  vao em `gerados`. Sem isso, o `final-sync-main` commitaria esse estado de runtime/IDE como `chore(terceiros)` e o
  publicaria; e um teste que roda o app na lane deixaria a lane suja (`discard_generated` recusa). `cache/` NAO entra:
  `cache/covers` e os `cache/*.json` sao dados que o produto versiona de proposito (nao conferido se algum fix os edita).

**Hipoteses descartadas:**
- PIPE padrao: caminho longo (acima).
- Ligar `core.longpaths` no repo: resolve o git, mas muda config compartilhada e nao e necessario com PIPE curto.
- Junction para `node_modules` em vez de copia: o motor so copia (`provision_wt`); 25 s por lane e aceitavel.
- `electron` em `e2e.processos`: o PS2Companion tambem roda `electron.exe` em modo dev; o nome generico faria o slot de um
  projeto esperar o do outro. Os nomes do backend bastam (todo app dev sobe o backend).
- Subir versao em cada fix (regra do `CLAUDE.md` do repo): lanes paralelas teriam conflito nos 4 arquivos de versao.

**Decisoes do dono (2026-10-09, nesta sessao):**
1. Fix do pipeline: **so a entrada no `CHANGELOG.md` `[Unreleased]`**; a subida de versao fica para o `chore(release)` do dono.
2. Disco de teste: **nenhum por enquanto**. Teste que precisa de disco real -> "falta para close".
3. Push: **de tudo** (inclui os 22 commits da outra sessao).

**Fazer:** no Downloader, `.claude/skills/pipeline-correcao-bugs/{projeto.json,projeto.md}`, `docs/bugs/open/README.md`,
`docs/bugs/retest/README.md` (com `## Status`; `closed/` faz o papel de `done/`); na fonte, `DESTINOS` += Downloader;
`sync_copias.py --check` (falta) e `--commit`; `preflight --skip-spawn`. Remover a worktree de medida e `C:\projects\.bugfix-xbox360`.

**Decisao do dono a mais (no meio da operacional):** eu tinha dito "conflito raro" no CHANGELOG; nao e (toda lane insere
logo abaixo de `## [Unreleased]`). Escolha do dono: **`.gitattributes` com `CHANGELOG.md merge=union`** no Downloader.
Provado num repo temporario: duas branches inserindo no mesmo ponto -> `git rebase` com CONFLITO sem o atributo, `ok` com
ele, as duas linhas presentes.

**T4 do Downloader FEITA, menos o trust (2026-10-09 ~14:30).** Downloader `main` publicado (`002d3c8..bab1af8`;
`origin/main...main` = `0 0`), levando tambem os 24 commits de outras sessoes que estavam so locais (autorizado pelo dono):
- `d5afe34` `projeto.json`, `projeto.md` (as 9 secoes de 22.10), `docs/bugs/{open,retest}/README.md`, `.gitattributes`;
- `bab1af8` copia da fonte em `36ebcba` (`sync_copias.py --commit --destino <Downloader>`; a fonte estava limpa, sem `--fonte`).
  `--check --destino <Downloader>` -> `[OK] ... igual a fonte`, rc 0.
- Fonte: `36ebcba` (`DESTINOS` += Downloader). As copias do PS2Companion (7 `difere`) e do ARMSX2 (`DESIGN.md`) ficaram
  como estavam: nao sao desta sessao; o proximo `sync_copias.py --commit` sem `--destino` as leva.
- `preflight --skip-spawn` rodado da copia, em `C:\projects\Downloader-XBOX360-XEX-HDD-Games`: `[OK]` claude.exe, projeto
  (lanes em `C:\projects\.bugfix-xbox360\lanes`), manual, "copia da skill igual a fonte", os 5 itens do `projeto.json`, `main`,
  `claude agents`, "rodizio de contas desligado"; `[AVISO]` 26 commits locais e "a skill difere da de origin/main" (antes do
  push); `[AVISO]` 3 arquivos reais nao commitados (`backendHttp.ts`, `backendClient.ts`, `backendReadiness.ts`: outra sessao).
  **Controle positivo dos `gerados`:** os 7 `M` de runtime/Gradle (`.godsend.lock`, `pending_queue/...`, `.gradle/...`) NAO
  aparecem entre os "reais". `[FALHA] trust` -> **acao do dono** (`claude.exe` num terminal no repo, aceitar, sair).
- Worktree de medida removida (`git worktree list` so com a principal) e `C:\projects\.bugfix-xbox360` apagada (`Test-Path` False).

**Pendencias do dono (Downloader):** trust; T5 (preflight com spawn). Fora de escopo, sem doc: o repo rastreia estado de
runtime/IDE (`.godsend.lock`, `pending_queue/*.json`, 516 arquivos de `src/android-app/{.gradle,app/build}`) — tirar do indice e
por no `.gitignore` e decisao dele; o pipeline ja os ignora por `gerados`.

**Proxima: sessao D = Lemuroid**, passos 1-7 da 22.11, escrevendo em 22.11.D. Dois achados daqui que valem la: medir o
maior caminho rastreado (`git ls-files | awk '{print length($0)}' | sort -n | tail -1`) contra o prefixo da lane
(`<pipe_dir>\lanes\wt-planning\`) e escolher `pipe_dir` curto se passar de 259; e conferir que arquivos de runtime/IDE
rastreados ficam em `gerados`. Frase de abertura: "Leia `C:\projects\retrobatnew\source\skills\pipeline-correcao-bugs\DESIGN.md`,
secao 22.11 (e a 22.11.C), e faca a T4 do Lemuroid a partir do passo 1."

#### 22.11.D Sessao D — T4 do Lemuroid (2026-10-09)

Aberta em `C:\projects\retrobatnew` (nao no Lemuroid): tudo por caminho absoluto. Fonte da skill limpa e em
`origin/versao3` (`0 0`); a B2 ja esta commitada (`20a26f5`), entao a regra de 22.7 nao segura nada aqui.

**Passo 2 — medido as ~16:00, antes de editar:**
- `git branch -vv`: `version9` @ `9a6461a` `[origin/version9]`, nem a frente nem atras. Remoto unico `origin`
  (luistiagos/retrosystemlemuroid). Uma worktree so.
- `git status --short`: 9 `M` de OUTRA sessao em curso (fix da busca presa ao sistema: `MainActivity.kt`, `MainViewModel.kt`,
  `SearchScreen.kt`, `StreamingRomsManager.kt`, `strings.xml` x2, `catalog_manifest.txt` x2, `prj.md`) e o doc dela movido
  `open -> done` em `docs/bugs` E em `documentacao/bugs` (sem commit). Nao tocar.
- `git ls-files .claude`: `settings.json` e **`settings.local.json`** -> `.claude/` versionado. `git check-ignore -v
  .claude/skills/pipeline-correcao-bugs/projeto.json` -> rc 1 (nao ignorado).
- `docs/bugs/`: `open/` (8), `retest/` (2), `done/` (85), mais 2 soltos na raiz; **sem README** em nenhuma pasta. O ciclo
  ja e `open -> retest -> done` (o do motor).
- **`documentacao/bugs/` e ESPELHO de `docs/bugs/`:** mesmos nomes em `open/`, `retest/` e `done/` (85 = 85, `Get-FileHash`
  igual em todos os `done/`); o `CLAUDE.md` do repo ainda manda `[BUG]` para `documentacao/bugs`. **Corrigido na operacional:**
  nao e mantido a mao — na arvore principal `docs` e uma JUNCTION para `documentacao` (`Get-Item docs` -> `LinkType=Junction`,
  criada 2026-09-17). O git rastreia as duas arvores (`ls-files`: 99 em `docs/bugs`, 96 em `documentacao/bugs`) e todo commit de
  doc de bug leva os dois caminhos (`9a6461a`, `27320f1`: 2 arquivos cada). Nas lanes nao ha junction (o git checa `docs/` como
  pasta). Visto ao commitar os README: as copias `?? documentacao/bugs/{open,retest}/README.md` surgiram sozinhas.
- Assunto de commit de docs no repo: `docs(bug)` (12 nas ultimas 400; `docs(bugs)` 2) -> `commit_docs: "docs(bug)"`.
- Deploy que publica sozinho: `grep "git (add|commit|push)"` em `*.ps1/*.bat/*.sh/*.py` -> nada. Commit local NAO vai ao ar.

**Passo 4 — build medido na lane real** (`git worktree add --detach C:\projects\lemuroid\.bugfix-pipeline-Lemuroid\lanes\wt-planning
origin/version9`, PIPE padrao; 19 s, 27.972 arquivos):
- **Caminho longo nao derruba a lane:** maior rastreado 170 (`lemuroid-cores`: 111) + prefixo 65 = 235. A saida do Gradle tem
  caminho RELATIVO de 256 (`lemuroid-app/build/intermediates/classes/.../InstalledGamesScreenKt$...$items$default$4.class`; na
  arvore principal ja ha absolutos de 286): na lane deu 321 e o build passou, porque o Windows tem `LongPathsEnabled=1` e o JDK
  respeita. `core.longpaths` nao esta ligado em nenhum nivel do git. PIPE curto nao resolveria (256 sozinho ja passa de 259).
- **Submodulo `lemuroid-cores` vem VAZIO** (`git submodule status` -> `-55d29c2`; pasta existe com 0 entradas). Controle: sem ele,
  `gradlew :lemuroid-app:assembleFreeBundleDebug` -> rc 1 em 69 s, `Could not resolve project :bundled-cores`.
  `settings.gradle.kts:22` aponta `:bundled-cores` para `lemuroid-cores/bundled-cores`; `lemuroid-app/build.gradle.kts:482/550` le
  `lemuroid-cores/<core>/src/main/jniLibs/...` e `lemuroid-cores` inteiro (verificador de cores). Precisa do submodulo todo.
- `entradas_ignoradas` NAO serve para ele: `provision_wt` so copia se o destino nao existe (a pasta vazia existe) e copiaria o
  `.git` dele (la e PASTA, submodulo antigo); `lemuroid-cores/bundled-cores` na arvore principal tem 12,7 GB (quase tudo `build/`).
- **Povoar a partir do clone local, sem rede:** `git -C <lane> -c protocol.file.allow=always -c
  submodule.lemuroid-cores.url=C:/projects/lemuroid/Lemuroid/lemuroid-cores submodule update --init lemuroid-cores` -> rc 0 em 16 s,
  `55d29c2` checado, gitdir em `.git/worktrees/wt-planning/modules/lemuroid-cores` (415 MB), `remote.origin` do clone = o caminho
  local. A url da config COMUM continua `https://github.com/...` (o `-c` so vale no comando). `git status` da lane: vazio.
- Com o submodulo: `assembleFreeBundleDebug` rc 0 em 257 s (169 tasks, 72 do build cache de `C:\Users\luist\.gradle`);
  APKs `lemuroid-app/build/outputs/apk/freeBundle/debug/lemuroid-app-free-bundle-{arm64-v8a,armeabi-v7a}-debug.apk`.
  `git status --untracked-files=all` na lane E no submodulo depois do build: vazio -> nada rastreado e gerado pelo build.
- Sem `local.properties` (gitignored) o build passa: `ANDROID_HOME`/`JAVA_HOME` estao no ambiente do usuario. `build.properties`
  so tem segredos de upload (`HF_TOKEN`, `R2_*`, `CF_*`): nunca copiar. `release.jks` so no release. `entradas_ignoradas` = [].
- `gradlew :lemuroid-app:testFreeBundleDebugUnitTest` na lane: rc 0 em 32 s; XML: 10 suites, 54 testes, 0 falhas, 0 erros,
  1 pulado (linha de base do T3).
- `gradlew ktlintCheck` na lane: **rc 1 na base**, ao contrario do `CLAUDE.md` do repo ("passa"): `Color.kt` (src/debug) com
  linhas em branco no fim (conferido no arquivo da lane, linhas 68-78) e `ktlintKotlinScriptCheck` em `lemuroid-app/build.gradle.kts`
  (`function-signature`). Os relatorios citam caminho da ARVORE PRINCIPAL: o resultado veio do build cache compartilhado.
- **Remover a lane:** `git worktree remove --force` -> rc 255 `failed to delete ...: Filename too long` (o git sem `core.longpaths`
  nao apaga os 321); desregistra a worktree, apaga o `.git` dela e o `.git/worktrees/wt-planning` (com o modulo do submodulo), e
  deixa 40.747 arquivos. E o ramo do `cmd_cleanup` (3034-3040): `.git` ausente -> sem `die`; sobra -> `shutil.rmtree(...,
  ignore_errors=True)`. Simulado com o mesmo `rmtree` (Python 3.14, longPathAware): 15 s, pasta apagada, 0 sobras. Sem
  `--force` o git recusaria (`working trees containing submodules cannot be moved or removed`, provado num repo temporario); o
  motor ja usa `--force`.

**O app no E2E** (lidos: `build_and_install_connected.ps1`, `lemuroid-app/build.gradle.kts` 73/191-219, `TelemetryReporter.kt`):
- Debug = `applicationId app.retrogamesystem.debug`, `versionNameSuffix -DEBUG`, assinado com o `debug.keystore` do repo: convive
  com o app de cliente `app.retrogamesystem` sem conflito de assinatura. O instalado no A12 hoje: `1.17.25-DEBUG`, versionCode 256,
  `lastUpdateTime 2026-10-09 15:17` (outra sessao instalou hoje) -> o aparelho e disputado por sessoes fora do pipeline.
- Aparelho `RX8R90G1D6E` (SM-A127M, Android 13, `arm64-v8a,armeabi-v7a,armeabi`), com `sha256sum`/`pidof` no `/system/bin`.
  `run-as app.retrogamesystem.debug` funciona (lido `shared_prefs/`, sem escrever).
- **O debug manda telemetria para PRODUCAO** (`TelemetryReporter.DEFAULT_ENDPOINT` = `.../logErr`, projeto `retrogamesystem/...`,
  com `app=<versao>-DEBUG` e o modelo no contexto). Kill-switch: `shared_prefs/telemetry_prefs.xml`, boolean
  `telemetry_error_reporting` (ausente = ligado), lido no `init`. O manual manda desligar no slot e devolver no fim (a escrita
  nao foi medida aqui: e estado do aparelho do dono).
- Sem `deploy`: o controle positivo e checkout destacado da base na lane -> `build` do helper (compila o checkout atual,
  `project_cmd`) -> guardar o APK -> voltar ao branch do bug -> `build` de novo.

**Hipoteses descartadas:**
- `entradas_ignoradas: ["lemuroid-cores"]` ou `[".../bundled-cores"]`: acima (destino existe; 12,7 GB; `.git` pasta).
- `git submodule update --init` com a url do GitHub: rede e um clone de 415 MB por lane; o clone local e de 16 s e e exatamente o
  commit do ponteiro. Se um ponteiro novo nao existir no clone local, o build falha com o erro do git (visivel), nao compila errado.
- Passo de provisionar no motor (22.6 deixou fora): o `build.cmd` ja roda em toda lane antes de qualquer coisa que precise do
  submodulo, e o `submodule update` e no-op quando ja esta no commit. Sem mudanca no motor nesta T4.
- Ligar `core.longpaths` no repo para o `worktree remove` passar: config de todos, e o fallback do `cleanup` ja cobre.
- PIPE curto: nao muda nada (a saida do Gradle sozinha tem 256).
- `ktlintCheck` no `build`: vermelho na base, travaria todo fix. Vai no T3 como "nenhum apontamento novo nos arquivos do fix".
- Copiar o espelho `documentacao/bugs` nas etapas: o motor trata so `docs/` como documentacao (secao 14); um `git mv` em
  `documentacao/` contaria como CODIGO (reserva, `publish_docs_only`, `final-sync-main`).
- AVD (`lemu_api25_2gb` etc.) como aparelho: exige `-PdevAbi=x86_64` e nao prova bug de ARM/core (pitfalls 6a/6b do `CLAUDE.md`).

**Decisoes do dono (2026-10-09, nesta sessao):**
1. Aparelho do E2E: **o Galaxy A12 conectado** (`RX8R90G1D6E`). Sem ele no `adb devices` -> `test-done --result ambiente`.
2. Espelho `documentacao/bugs`: **o pipeline ignora**; o briefing da finalizacao lista os docs que mudaram para o dono replicar.
   (A pergunta descreveu o espelho como mantido a mao; com a junction a decisao continua valendo e fica mais barata: no
   disco o arquivo ja esta la, falta so commitar o caminho `documentacao/` que fica sujo na arvore principal.)

**Desenho (config):**
- `build.cmd`: `submodule update --init` do clone local (acima) + `gradlew :lemuroid-app:assembleFreeBundleDebug
  :lemuroid-app:testFreeBundleDebugUnitTest` (APK do teste + unidade numa chamada; ~5 min a frio, lock `lemuroid-build`, 31 GB de
  RAM e `-Xmx5120m` por daemon -> um por vez e o certo).
- `gerados`: `^lemuroid-cores$` (o ponteiro do submodulo: o pipeline NUNCA o commita, nem o `final-sync-main` como terceiros —
  e o caso do pitfall 15 do `CLAUDE.md`, ponteiro voltando dois meses num `git add -A`; fix de core e `bloqueado`) e
  `^\.claude/settings\.local\.json$` (rastreado; permissoes locais de sessao nao vao ao ar como `chore(terceiros)`).
- `e2e: {}` (aparelho, como o ARMSX2); `preflight`: `JAVA_HOME` com `java.exe`, `adb` no PATH, o A12 no `adb devices`,
  `lemuroid-cores/bundled-cores` povoado na arvore principal.

**Fazer:** no Lemuroid, `.claude/skills/pipeline-correcao-bugs/{projeto.json,projeto.md}` (as 9 secoes de 22.10) e
`docs/bugs/{open,retest}/README.md`; na fonte, `DESTINOS` += Lemuroid e commit; `sync_copias.py --check` (falta) e `--commit
--destino <Lemuroid>`; `preflight --skip-spawn`. Worktree de medida e `C:\projects\lemuroid\.bugfix-pipeline-Lemuroid` ja removidas.

**T4 do Lemuroid FEITA, menos o trust (2026-10-09 ~17:00).** Lemuroid `version9` publicado (`9a6461a..bc0303e`;
`origin/version9...version9` = `0 0`), so com commits desta sessao (os arquivos sem commit da outra sessao ficaram):
- `1350581` `projeto.json`, `projeto.md` (as 9 secoes de 22.10), `docs/bugs/{open,retest}/README.md`;
- `e59bc9c` as mesmas README em `documentacao/bugs/` (a junction as criou no disco; o repo commita os dois caminhos) e o
  manual explicando a junction;
- `bc0303e` copia da fonte em `a4db189` (`sync_copias.py --commit --destino <Lemuroid>`, fonte limpa, sem `--fonte`).
  `--check --destino <Lemuroid>` -> `[OK] ... igual a fonte`, rc 0.
- Fonte: `10bda8c` (registro antes da edicao) e `a4db189` (`DESTINOS` += Lemuroid; correcao da junction neste registro).
- **Prova do `build.cmd` exato** (script que repete o `project_cmd`: placeholders trocados, `cwd=ROOT`, lane nova
  `...\lanes\wt-1` criada como o `ensure_wt`): rc 0 em 59 s com cache quente; `Submodule path 'lemuroid-cores': checked out
  '55d29c2...'`; 2 APKs; 10 suites de teste; `git status` da lane vazio; url comum intacta; remocao como o `cmd_cleanup`
  (`worktree remove --force` rc 255 `Filename too long` + `rmtree`) sem sobra.
- **Controle dos `gerados`** (o `GENERATED` montado pelo `configure` da copia): `lemuroid-cores` e `.claude/settings.local.json`
  casam; `.claude/settings.json`, `lemuroid-cores-x/a.kt`, um `.kt` do app e um doc de `docs/bugs` nao. A linha de submodulo sujo
  no `porcelain` e ` M <caminho>` sem barra (provado num repo temporario, com commit novo e com conteudo sujo).
- `preflight --skip-spawn` rodado da copia, em `C:\projects\lemuroid\Lemuroid`, depois do push: `[OK]` claude.exe, projeto (lanes
  em `C:\projects\lemuroid\.bugfix-pipeline-Lemuroid\lanes`), manual, "copia da skill igual a fonte", os 4 itens do `projeto.json`
  (JAVA_HOME, adb, A12 `RX8R90G1D6E`, submodulo), `version9`, `claude agents`, "rodizio de contas desligado"; `[AVISO]` 14 arquivos
  reais nao commitados (a outra sessao, fix da busca); `[FALHA] trust` -> **acao do dono** (`claude.exe` num terminal no repo,
  aceitar, sair). Antes do push havia tambem `[AVISO]` 3 commits locais e "a skill difere da de origin/version9"; sumiram.
- A pasta do pipeline que o preflight cria (so `lanes\` vazia) foi apagada; `git worktree list` so com a principal.

**Pendencias do dono (Lemuroid):** trust; T5 (preflight com spawn). Nao medido aqui: a ESCRITA do kill-switch de telemetria por
`run-as` (o manual manda; a 1a execucao confirma ou cai no "anote a janela de horario"). Fora de escopo, sem doc:
1. `gradlew ktlintCheck` vermelho em `origin/version9`, contra o "passa" do `CLAUDE.md` do repo (`Color.kt` de `src/debug`;
   `function-signature` em `lemuroid-app/build.gradle.kts`).
2. A tabela de rotas do Passo 4 da `triagem-chamados` (`source/skills/triagem-chamados/SKILL.md`) nao tem o Lemuroid/RetroSystem
   Android: um chamado desse produto nao tem destino escrito. **Virou bug** (pedido do dono):
   `source/docs/bugs/open/skill-triagem-chamados-sem-rota-para-lemuroid_2026-10-09.md` (`625b142`, passada 1).
3. ~~O `CLAUDE.md` do Lemuroid ainda manda `[BUG]` para `documentacao/bugs`~~ **corrigido a pedido do dono** (`35636b8`, publicado):
   o workflow manda para `docs/bugs` (`open -> retest -> done`, citando os README) e os 17 links "Detalhes em" apontam para
   `docs/bugs` (todos conferidos com `git ls-files`; o do TV box MXQ estava em `open/` e o doc ja esta em `done/`).
   **Depois, a pedido do dono, `documentacao/` saiu do repo:** junction removida, `docs/` virou pasta real, `documentacao/`
   fora do indice e as 84 referencias em 53 arquivos trocadas por `docs/` (Lemuroid
   `docs/bugs/done/2026-10-09-documentacao-duplicada-junction-docs.md`). O que este registro diz acima sobre a junction e o
   "commit dos dois caminhos" vale ate 2026-10-09 ~20:40; o manual do pipeline do Lemuroid ja nao tem a secao do espelho.
   Continua: `.claude/settings.local.json` rastreado.

**Proxima:** T5 com o dono nos projetos com trust aceito (22.5 item 5; nenhuma execucao real sem ele). A T4 dos quatro repos
esta feita.
