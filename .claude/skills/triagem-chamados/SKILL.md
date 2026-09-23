---
name: triagem-chamados
description: >-
  Investiga um ou mais CHAMADOS de suporte (o "#N" do painel admin de chamados) lendo a
  conversa inteira de WhatsApp daquele cliente, decide o que e bug e o que nao e, roteia cada
  achado para o projeto dono (retrobatnew, ARMSX2-fork, PS2Companion, Downloader-XBOX360,
  digitalstoregamesproject), deduplica contra os bugs ja registrados e abre bug doc so para o
  que for genuinamente novo. Use quando o usuario disser "veja o chamado 29", "analise os
  chamados 29 e 46", "esse cliente reclamou, e bug?", ou passar um numero de chamado / um lid
  de sessao de WhatsApp. Nao confundir com `triagem-bugs-prod`, que le a telemetria de
  exceptions; esta le CONVERSA COM CLIENTE.
---

# Triagem de chamados de suporte — conversa de cliente vira bug doc

Voce investiga **chamados de suporte** (`wpp_support_ticket`) e as **conversas de WhatsApp**
que os originaram. O produto final e:

1. um **veredito por achado** — bug / nao-bug / duplicado;
2. **bug docs** no repositorio do **projeto dono de cada achado** (podem ser varios projetos
   no mesmo chamado);
3. quando o achado ja esta registrado, **evidencia anexada ao doc existente**, nunca um doc novo;
4. um **relatorio ao usuario** dizendo o que foi aberto, o que foi anexado e **o que foi
   descartado e por que**.

Assuma que voce comeca **sem contexto previo** — tudo que precisa esta aqui.

> **Esta skill e identica nos 5 projetos.** A copia que voce carregou **nao** restringe onde o
> bug e gravado: um chamado costuma render achados em mais de um repositorio. Roteie pelo
> Passo 4, nao pelo diretorio em que a sessao abriu.

> **Irma, nao a mesma:** `triagem-bugs-prod` parte de **exceptions/telemetria** (`/admin/errors`).
> Esta parte de **conversa com cliente**. As duas podem apontar para o mesmo defeito — o Passo 5
> cobre isso.

## Entrada do invocador

- **Um ou mais numeros de chamado** (`29`, `29 46 51`) → investigue exatamente esses.
- **Um `lid` de sessao** (`108649888370692@lid`) ou **um telefone** → use
  `chamado.py conversa-lid` e siga do Passo 3.
- **Nada** → rode `chamado.py abertos` e **pergunte ao usuario quais investigar**. Nao varra
  todos por conta propria: cada chamado e uma conversa de centenas de mensagens.

## Ambiente

| O que | Onde |
|---|---|
| Chamados e conversa (API) | `POST https://digitalstoregames.pythonanywhere.com/diag/query` — **so `SELECT`**, LIMIT 500, Bearer token |
| Token (`DIAG_TOKEN`) | env `DIAG_API_TOKEN` ou a constante nos `diag_*.py` da raiz de `C:\projects\digitalstoregamesproject\digitalstoregamesbackend` |
| Painel dos chamados (UI) | `ddigitaladmfrontend/src/pages/SupportTickets.jsx` |
| Temporarios | o **scratchpad desta sessao** — fora de pasta versionada e **fora de pasta compartilhada** (ver o aviso do atalho) |
| Interprete | `python` (nao `python3`) |

> **Esta maquina NAO acessa o MySQL de producao direto** (timeout 10060) e o pytest trava no
> bootstrap. Tudo passa pelo `/diag/query`. Nao tente conectar no banco.

## Atalho: o cliente ja esta escrito

`scripts/chamado.py` (ao lado deste arquivo) implementa os Passos 1-3 e a medicao do 3c.
**Copie-o para o scratchpad DESTA sessao e rode de la** (`$SP` = o scratchpad da sessao):

```bash
cp .claude/skills/triagem-chamados/scripts/chamado.py "$SP/chamado.py"
python "$SP/chamado.py" abertos
python "$SP/chamado.py" ticket 29 46
python "$SP/chamado.py" conversa 29
python "$SP/chamado.py" promessas 29
python "$SP/chamado.py" sql "SELECT ..."
```

Os artefatos saem em `<pasta do script>/saida-chamados/`.

> ⚠️ **Nao copie para uma pasta compartilhada** (o `Temp` do Windows, por exemplo). Toda sessao
> usaria o mesmo nome de arquivo: uma sessao paralela ja sobrescreveu o cliente da skill irma por
> um script de CLI diferente, e o comando virou **saida vazia com exit 0** — que parece sucesso.
> Se ainda assim usar pasta compartilhada, `ls -la` + **leia o arquivo antes de rodar** (mtime
> recente de outra sessao = CLI diferente), e **nunca aceite `exit 0` sem saida como sucesso**:
> confirme o efeito por outra via.

Ele ja resolve o token em runtime, o join por alias, a paginacao de 500 em 500 e o UTF-8.
O trabalho que **so voce faz** e o dos Passos 3 a 7.

> **Pre-requisito de permissao.** O script le o token do `.env`/`diag_*.py`. Em *auto mode* o
> classificador pode bloquear isso como *Credential Exploration*. Se levar o bloqueio, **pare e
> avise o usuario** — ele libera em `.claude/settings.json` (ex.:
> `Bash(python <scratchpad>/chamado.py *)`) ou roda fora do auto mode. Nao tente
> contornar, e **nunca imprima o token**.

---

## Passo 1 — Ficha e linha do tempo do chamado

`chamado.py ticket <ids>`. O que ler na ficha (`wpp_support_ticket`):

| campo | para que serve |
|---|---|
| `lid`, `telefone`, `email` | chaves da conversa (Passo 2) |
| `origem_agente` | **qual produto** o cliente comprou → ponto de partida do roteamento (Passo 4) |
| `pacote_json` | o produto exato (`Sistema Multigames`, `RetroSystem PS2`, ...) |
| `aberto_em`, `status`, `status_em`, `fechado_em` | janela da investigacao |
| `ultima_msg_cliente_em` x `ultima_msg_operador_em` | **se o cliente esta sem resposta agora** — isto vai no relatorio final |
| `msg_abertura` | a frase que disparou a escalada |
| `compras_status`, `acesso_entregue`, `reembolso` | separa problema tecnico de problema de entrega/cobranca |
| `resumo_status` | `desligado` = nao ha resumo automatico; voce e o resumo |

⚠️ A tabela de eventos e `wpp_support_ticket_event` e as colunas sao
**`ticket_id`, `tipo`, `de`, `para`, `motivo`, `autor`, `criado_em`**. Nao existe coluna `lid`
nem `evento` — `SELECT *` primeiro, sempre.

Eventos que importam: `aberto`, `reescalada`, `status`, `agente_trocado`,
**`devolvido_ao_bot`** (o `motivo` diz por que a escalada foi desfeita) e `nao_tocar`.

## Passo 2 — Baixar a conversa INTEIRA

`chamado.py conversa <id>`. Nao leia so a janela do chamado: o defeito costuma comecar dias
antes (na pre-venda, na instalacao) e o chamado e o **ultimo** capitulo.

Como o join funciona (e por que nao e obvio): a conversa vive em `Wpp_proccess`, casando
`main_phone`/`alt_phone` **por prefixo** com o `lid` e com as **variantes BR do telefone**
(com e sem o 9o digito). E o que `wppdao.list_proccess_by_lid` faz via `_conversation_aliases`.

**Semantica de `role` — o unico item que, lido errado, inverte o diagnostico:**

| `role` | quem e |
|---|---|
| `customer` | o cliente |
| **`user`** | **o OPERADOR HUMANO** (o dono/suporte digitando) — nao e o cliente |
| `bot`, `<X>_AGENT`, `OWNER_CONSULT` | o agente de IA |

**Linhas internas:** `msg_id` comecando em `internal_consult_` ou `silent_handoff_`
**nunca foram enviadas** — sao notas internas, e o proprio webhook as pula ao remontar o
historico. O dump do script as marca `[INTERNA]`. Tratar uma delas como "texto interno vazou
para o cliente" e um falso positivo classico.

### 2c — Medir a promessa de atendimento humano

`chamado.py promessas <id>` cruza cada "ja estou chamando o suporte / o atendente ja vai
responder" com a **proxima** mensagem `role = 'user'`. E a medida objetiva de uma classe de
bug recorrente; se houver promessa sem humano, o numero vai para o doc.

---

## Passo 3 — Ler a conversa e listar CANDIDATOS

Leia a conversa inteira em ordem. Para cada trecho em que o cliente relata algo que nao
funcionou, ou em que o operador humano **corrige o agente**, registre um candidato com:
**id(s) da mensagem, data/hora, citacao literal curta**.

Varra as duas colunas — a maioria dos chamados tem as duas:

**Lado do PRODUTO** (o app fez algo errado)

- mensagem de erro, tela preta, travamento, crash, jogo que nao abre;
- funcao que nao responde (controle, download, atualizacao, save);
- print do cliente que contradiz o que o app deveria mostrar;
- **sintoma que sobrevive a um remedio** ("apaguei e baixei de novo e continua") — isso
  descarta corrupcao/download e aponta para codigo ou acervo;
- **ponto fixo e reproduzivel** ("sempre no mesmo lugar") — vale mais que qualquer suposicao.

**Lado do AGENTE** (a IA respondeu errado)

- nomeia **item de tela que nao existe** (menu, botao, opcao) — o mais comum;
- manda o caminho do **app antigo** / material desatualizado;
- afirma **fato sobre o produto** sem lastro (o que esta incluso, o que o app "espera");
- **promete atendente** e volta a responder sozinho;
- vaza raciocinio, marcacao de ferramenta, outro idioma, ou repete a mesma mensagem;
- **responde como se fosse o operador humano** depois de o humano ter assumido;
- o cliente diz literalmente "nao tem essa opcao" **mais de uma vez** e o agente insiste.

Tambem registre o que o **operador humano** fez de errado (ex.: mandou rebaixar o pacote
inteiro quando havia caminho barato). Isso raramente e bug de codigo, mas quase sempre indica
**falta de informacao na tela ou no guia** — que e bug.

---

## Passo 4 — Rotear cada candidato ao projeto dono

Um chamado produz achados em **mais de um repositorio**. Decida por candidato, nunca por chamado.

| O achado e sobre | Repositorio | Pasta de bugs |
|---|---|---|
| App de PC **Retro Game System / RGS** — EmulationStation, `emulatorLauncher`, emuladores, cores, catalogo de ROMs, BIOS, atualizacao do app, empacotamento | `C:\projects\retrobatnew` | `source/docs/bugs/{open,retest,done}/` — ⚠️ **em `source/`, nao na raiz** |
| App **Android RetroSystem PS2** (fork do ARMSX2) | `D:\projects\play2\ARMSX2-fork` | `docs/bugs/open/armsx2-fork/` (linha antiga: `.../legado-version1/`) |
| **PS2Companion** — preparar HD/pendrive de PS2, OPL | `D:\projects\PS2Companion` | `docs/bugs/{open,close}/` |
| **Downloader XBOX360** — `xbox-360-companion`, BadAvatar, Aurora, DashLaunch, preparo de HDD/USB | `C:\projects\Downloader-XBOX360-XEX-HDD-Games` | `docs/bugs/{open,closed}/` |
| **Agente de WhatsApp** — prompts, KB/guias, roteamento, handoff, resumo de chamado, painel, area de membros, pagamentos, remarketing | `C:\projects\digitalstoregamesproject` | `docs/modules/<modulo>/[areas/<area>/]bugs/` |

**Regra que decide os casos de fronteira:** o bug do **produto** mora no repo do produto; so o
que e do **agente/plataforma** vai para `digitalstoregamesproject`. Motivo mecanico:
`tools/gen_status.py` (`REPOS`) so varre o repo raiz e os sub-repos listados — `retrobatnew`,
`PS2Companion` e `ARMSX2-fork` **nao estao la**, entao um doc deles naquele repo ficaria
`backlog` para sempre, que e como se ensina a ignorar o painel.

**Quando o mesmo episodio rende os dois lados, abra os dois docs e cruze-os por link** — ex.:
"o controle sai trocado" (produto) e "o guia nao cobre o caso e o agente inventou um menu"
(agente). Cada um sobrevive sozinho; diga isso no doc.

Se aparecer um produto que nao esta na tabela, **pergunte ao usuario** onde fica a raiz dele —
uma vez, nao por achado.

---

## Passo 5 — Deduplicar **POR CONTEUDO**, nunca por nome de arquivo

**Este passo ja falhou e custou dois bug docs duplicados. Nao pule nem encurte.**

Os corpora de bug sao grandes e os nomes de arquivo sao descritivos **da causa**, nao do
sintoma. Procurar `syphon` no nome nao acha
`psx-pal-50hz-em-tela-60hz-judder-syphon-filter`; procurar `mapeamento` no nome nao acha
`joystick-generico-ids-crus-de-es-input-tratados-como-ids-de-gamepad-sdl` — cujo **titulo**,
dentro do arquivo, e literalmente "joystick generico mapeado no ES nao responde **(ou responde
trocado)** dentro do jogo".

Para **cada** candidato, e em **todas** as pastas de estado do projeto dono:

```bash
# 1) pelo SINTOMA, no conteudo (o que o cliente disse)
grep -rli "trocad\|nao responde\|tela preta\|travand" <pasta>/{open,retest,done}/

# 2) pelo COMPONENTE / simbolo
grep -rli "Dolphin\|es_input\|gamecontrollerdb\|GuiInputConfig" <pasta>/

# 3) pelo NOME PROPRIO (jogo, console, emulador, modelo de aparelho)
grep -rli "syphon\|mali-g57\|beetle" <pasta>/

# 4) pelo numero do chamado, para achar evidencia ja anexada antes
grep -rli "chamado #29\|108649888370692" <pasta>/
```

Tres desfechos, e **so um deles cria arquivo**:

- **Novo** (nada equivalente em nenhuma pasta) → cria (Passo 7).
- **Ja aberto** (`open/`, ou `backlog`/`implementada` no dsg) → **NAO duplique.** Anexe uma
  secao de evidencia ao doc existente, com data, ids das mensagens e o numero do chamado.
- **Em `retest/`/`done`/`fechada`** → **NAO duplique.** Anexe como **confirmacao de campo**.
  Leia antes o que aquele doc diz que **falta** — quase sempre e exatamente o que voce tem em
  maos ("falta confirmar com o pad fisico do usuario", "falta confirmacao do cliente").
  - **Um resultado negativo nao reprova o fix automaticamente.** Se havia **outra falha ativa**
    durante a medicao, ela contamina o teste: registre como **inconclusiva**, diga qual era a
    outra falha e **deixe o doc onde esta**. Essa regra e explicita no
    `retrobatnew/source/docs/bugs/README.md` ("Nunca valide nem refute uma hipotese com outra
    falha ativa") e vale para todos os projetos.

---

## Passo 6 — Confirmar no codigo ANTES de escrever causa raiz

**Nao escreva causa raiz sobre simbolo que voce nao abriu.** Nome plausivel nao e verificacao;
`grep` que mostra a linha nao e verificacao. Abra a funcao inteira (assinatura, retorno,
variaveis em escopo), os simbolos que ela referencia, o import e o **comportamento em erro**
(`except`/`catch`/`finally`) — a diferenca entre `try/finally` e `catch: return 1` decide se ha
bug ou nao.

Se nao der para provar, escreva **passada 1**: `## Sintoma` + `## Evidencia`, e uma secao
`## Hipoteses — nenhuma verificada` com o que falta medir. Causa inferida do relato vira ancora
errada para voce e para a proxima sessao.

### Checagens que economizam um doc inteiro (todas ja produziram falso positivo)

| Suspeita | Como confirmar antes de escrever |
|---|---|
| "o agente inventou o rotulo do menu" | Confira o rotulo REAL: `dist/retrosystem/emulationstation/locale/lang/pt_BR/LC_MESSAGES/emulationstation2.po` (pares `msgid`→`msgstr`) **e** o `.cpp` que desenha a tela, em `source/emulationstation-source/es-app/src/guis/`. ⚠️ `msgid` longo e **quebrado em varias linhas** no `.po` — `grep` por uma frase inteira nao acha; procure um pedaco |
| "o agente inventou a tecla" | `source/docs/funcionamentos/superficie-de-usuario.md` tem a tabela real (`a`=120=**X** confirmar, `b`=122=**Z** voltar) |
| "a opcao existe, o cliente e que nao achou" | Veja se a configuracao **empacotada** esconde: `dist/retrosystem/emulators/retroarch/retroarch.cfg` (`menu_show_advanced_settings`, `quick_menu_show_*`) |
| "a atualizacao esta quebrada" | Confira se havia versao nova: `curl -sL https://huggingface.co/datasets/luisluis123/versions/resolve/main/rgs/<edicao>/latest.json` e o historico em `https://huggingface.co/api/datasets/luisluis123/versions/commits/main?limit=100&p=N` (datas em **UTC**; Brasil = UTC-3) |
| "texto interno vazou para o cliente" | Olhe o `msg_id`: `internal_consult_*`/`silent_handoff_*` **nao foi enviado** |
| "o guia manda o caminho antigo" | `git log -- mysite/templates/prompts/<arquivo>` — o guia pode ter sido corrigido **depois** da conversa. Compare a data do commit com a data da mensagem |
| "o agente prometeu e ninguem veio" | `chamado.py promessas` da o numero; o `motivo` do evento `devolvido_ao_bot` da o mecanismo |

### Anti-exemplos reais (apareceram como bug e nao eram)

Na rodada do chamado #29, **6 candidatos** morreram nesta etapa: a mensagem
"Nenhuma atualizacao disponivel" estava **certa** (nao havia versao nova); as teclas X/Z, os
menus `ATUALIZACOES & TRANSFERENCIAS`, `AJUSTES DE CONTROLE` e `MAPEAMENTO DO CONTROLE` estavam
**corretos**; o "vazamento" de consulta interna era linha `internal_consult_`; e o guia que
mandava o app antigo **ja tinha sido corrigido** dias antes da conversa. Cada um desses teria
virado um doc errado.

---

## Passo 7 — Gravar

Um arquivo por **causa raiz**, no repositorio roteado no Passo 4, no formato daquele projeto.
Em todo doc, sempre: **numero do chamado, `lid` da sessao, ids das mensagens citadas** — e a
citacao literal do cliente, na lingua dele.

### `retrobatnew` · `ARMSX2-fork` · `PS2Companion` · `Downloader-XBOX360`

Nome: `<componente>-<sintoma-curto>_<AAAA-MM-DD>.md` (no XBOX360 e no ARMSX2 o timestamp vai
ate o minuto: `_2026-09-22T19-14`). Cabecalho em bullets, corpo em secoes:

```markdown
# Bug: <titulo que ja diz o defeito, nao o sintoma vago>

- **Detectado em:** AAAA-MM-DD HH:MM (chamado #N do painel, sessao `<lid>`)
- **Origem:** conversa de suporte + leitura do fonte de <arquivo::simbolo>
- **Classe:** crash / falha funcional / diagnostico / conteudo-acervo
- **Severidade:** <e o custo medido: tempo perdido, reinstalacao, pedido de reembolso>
- **Complexidade:** baixa / media / alta — <justificativa curta>
- **Reincidencia:** primeira vez / recorrencia de [[doc-existente]]

## Sintoma, na ordem que o cliente viveu
## Evidencia            <- ids de Wpp_proccess + citacao literal + o que prova cada coisa
## Causa raiz           <- so se provada; senao "## Hipoteses — nenhuma verificada"
## Escopo — o que NAO e este bug
## Tarefas propostas / Proximos passos
```

- No **XBOX360**, a severidade e a matriz P0-P3 de `docs/agents/skills/bug-triage.md`.
- No **ARMSX2-fork**, todo commit exige task em `docs/task/TASK-NNNN-*.md` e o doc leva as
  secoes `Feature:` / `Tasks que o resolvem:`; rode `python scripts/check_traceability.py`.
- No **retrobatnew**, links entre bugs sao `[[nome-do-arquivo-sem-extensao]]`.

### `digitalstoregamesproject`

Caminho: `docs/modules/<modulo>/[areas/<area>/]bugs/AAAA-MM-DD-slug-descritivo.md`.
Modulos: `chatbot-whatsapp`, `area-membros`, `pagamentos`, `lojas-produtos`, `remarketing`,
`telemetria`, `infra-deploy`, `engenharia`. Areas de `chatbot-whatsapp`: `prompt-kb`
(guias/KB/alucinacao), `estado-handoff` (escalada, pino humano), `roteamento`,
`entrega-posvenda`, `ingestao`, `midia`, `outros`.

```markdown
# Bug: <titulo>

Data: AAAA-MM-DD
Area: `<arquivo::simbolo>`, `<AGENTE>`

## Sintoma
## Evidencia
## Causa raiz          <- so na 2a passada, provada pelo call-site
## Tasks
| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | passada 1 — sintoma e evidencia do chamado #N | -- | backlog | -- | -- |
```

- **`## Tasks` com no minimo `T1` e obrigatoria.** Voce escreve `#` e `task`; `commit`,
  `estado` e `modelo` ficam `--` (o gerador preenche a partir do `[Tn]` do commit).
- **Nao digite `Status:` nem `Commits:`** — `tools/gen_status.py` deriva os dois.
- **Nao rode `tools/gen_status.py`** por iniciativa propria: ele reescreve o repo inteiro e
  costuma haver trabalho nao commitado de outra sessao na arvore.
- 🔴 **Moratoria de prompts:** mudar `mysite/templates/prompts/*` exige **(1)** este bug doc,
  **(2)** um caso de eval em `digitalstoregamesbackend/tests/evals/cases/` e **(3)** aprovacao
  explicita do dono. Abrir o doc e a etapa 1 — **nao edite prompt nesta skill.** Deixe a task
  de prompt como `backlog` com o aviso da moratoria escrito no doc.

---

## Passo 8 — Relatorio ao usuario, e o que NAO fazer

Entregue, em texto:

1. **O que virou doc** — caminho de cada arquivo e uma linha do que ele contem.
2. **O que foi anexado a doc existente** — qual doc, e por que nao virou doc novo.
3. **O que foi DESCARTADO e por que** — com a prova. Isto vale tanto quanto o resto: evita que
   a proxima sessao reabra o mesmo falso positivo.
4. **Se o cliente esta sem resposta agora** (`ultima_msg_cliente_em` > `ultima_msg_operador_em`
   e o chamado nao fechado): diga ha quantos dias, cite a ultima pergunta dele e, se voce
   descobriu a resposta durante a investigacao, escreva-a em uma frase.

**Nao faca, sem o usuario pedir:**

- **commitar** — os repositorios costumam ter trabalho nao commitado de outras sessoes; ofereca
  commitar so os seus caminhos;
- **fechar o chamado** no painel — quem fecha chamado e gente, e o chamado so fecha quando o
  cliente foi atendido (diferente de `triagem-bugs-prod`, onde fechar o erro e obrigatorio);
- **responder ao cliente** no WhatsApp;
- **editar prompt** (ver moratoria) ou **corrigir o codigo** — esta skill abre bug, nao fecha.

## Armadilhas medidas

| Armadilha | O que acontece |
|---|---|
| Console cp1252 | `UnicodeEncodeError` ao imprimir acento/emoji vindo do banco. O `chamado.py` ja reconfigura o stdout; em script proprio, escreva com `io.open(..., encoding='utf-8')` |
| `REGEXP_SUBSTR` | **nao existe** neste MySQL. Use `LIKE`/`REGEXP` |
| LIMIT 500 | o `/diag/query` corta em 500 linhas **sem avisar**. Pagine por `id > <ultimo>` |
| `role='user'` | e o **operador humano**, nao o cliente. Ler ao contrario inverte o diagnostico |
| Contar mensagens de agente | linhas `internal_consult_*`/`silent_handoff_*` nunca foram enviadas — filtre |
| Datas da HuggingFace | vem em **UTC**; o cliente e UTC-3. Uma versao "de 16/09 18:04" e 15:04 no relato dele |
| Buscar bug por nome de arquivo | o nome descreve a **causa**, o cliente descreve o **sintoma**. Sempre `grep -rli` no **conteudo** |
