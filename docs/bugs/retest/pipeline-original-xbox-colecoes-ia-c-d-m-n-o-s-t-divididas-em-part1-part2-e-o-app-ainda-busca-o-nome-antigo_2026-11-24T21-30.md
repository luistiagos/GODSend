# Bug: Original Xbox — 7 coleções do Internet Archive (C, D, M, N, O, S, T) viraram `_part1`/`_part2` e o app ainda procura os nomes antigos; todo jogo dessas letras falha com "Não foi possível baixar o jogo pela internet agora"

- **Detectado em:** 2026-11-24 21:30 (chamado #437 do painel, sessão `190989276864706@lid`)
- **Origem:** conversa de suporte + erros de telemetria 14764 e 14765 (`xbox-360-companion/pipeline`) + leitura de `src/server/app/config.go::IACollections`, `src/server/services/cache/ia.go::FindEntry` / `LiveSearchIA` / `preserveExistingCache` e `src/server/services/pipeline/pipeline.go::ProcessGameWithErr`
- **Classe:** falha funcional (o acervo mudou de endereço)
- **Severidade:** **P1 — Alto** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): bloqueia o download de **todo** título do Original Xbox que começa com C, D, M, N, O, S ou T. São **1.425 arquivos `.zip`** nas 14 coleções novas, cerca de metade do catálogo Original Xbox. O fallback (Minerva) também falhou no caso do cliente: 52 peers e 0 seeders
- **Complexidade:** **baixa** — trocar 7 ids em `IACollections["xbox"]`. A busca por letra de `LiveSearchIA` já aceita `_<letra>_part` (`ia.go:390`)
- **Reincidência:** primeira vez registrada. O erro 14566 (2026-11-22 17:29 UTC, *Crash Bandicoot - The Wrath of Cortex (USA)*) já é este defeito

## Sintoma, na ordem que o cliente viveu

Horários em UTC, ids `[n]` = `Wpp_proccess.id`.

1. `[197277]` 18:44 — "Pia não tá baixando os jogos".
2. `[197282]` 18:44 — print da Fila: *"Crash Nitro Kart (USA) Erro — Não foi possível baixar o jogo pela internet agora. Verifique se sua internet está funcionando, pause VPN ou antivírus…"*.
3. `[197321]` 18:48 — print da janela do jogo: *Crash Nitro Kart (USA)*, "Original Xbox · Catálogo Online", destino Pendrive `D: — BADAVATAR · 116.4 GB livres`. Ou seja, destino e espaço estão certos.
4. `[197347]` 18:52 — "Escolhi outro jogo e agora tá baixando."
5. `[197361]` 19:11 — "Todos os crash de corrida esta dando erro".

O agente mandou conferir a internet, VPN e antivírus três vezes (`[197283]`, `[197318]`, `[197324]`). Nenhuma dessas é a causa, e a mensagem do app leva a esse caminho errado.

## Evidência

**Telemetria (o cliente não manda conta, `account_id` nulo; casa pelo título e pela hora, minutos antes do print):**

| erro | hora (UTC) | mensagem |
|---|---|---|
| 14764 | 2026-11-24 18:38:29 | `Download falhou em todas as fontes para Crash Nitro Kart (USA) (xbox): ia: IA search failed: not found in Internet Archive: Crash Nitro Kart (USA)` |
| 14765 | 2026-11-24 18:39:53 | idem para `Crash Tag Team Racing (USA) (xbox)` |
| 14566 | 2026-11-22 17:29:23 | idem para `Crash Bandicoot - The Wrath of Cortex (USA)` (outro cliente) |

Logs anexos do 14764 (`telemetria.py logs 14764`), um por fonte:
- `huggingface: plataforma xbox nao suportada no HuggingFace`
- `ia: IA search failed: not found in Internet Archive: Crash Nitro Kart (USA)`
- `minerva: Minerva torrent failed: Minerva sem fontes ativas (peers: 52, seeders: 0) por 45s`

**Internet Archive (medido em 2026-11-24 ~21:00 UTC):**
- `curl https://archive.org/metadata/microsoft_xbox_c` → `{}`; `https://archive.org/details/microsoft_xbox_c` → **HTTP 404**.
- Das 91 coleções de `IACollections`, só estas 7 não existem mais: `microsoft_xbox_c`, `_d`, `_m`, `_n`, `_o`, `_s`, `_t`. Todas as de Xbox 360, XBLA, DLC, XBLIG, digital e games respondem.
- `advancedsearch.php?q=identifier:microsoft_xbox_*` lista `microsoft_xbox_{c,d,m,n,o,s,t}_part1` e `_part2`.
- `microsoft_xbox_c_part2` contém `Crash Nitro Kart (USA).zip`, `Crash Tag Team Racing (USA).zip` e `Crash Bandicoot - The Wrath of Cortex (USA).zip`, os três títulos que falharam.
- Arquivos `.zip` por coleção nova: c 106+77, d 77+78, m 108+102, n 96+78, o 117+125, s 137+144, t 86+94 = **1.425**.
- O campo `created` dos itens novos vai de 2026-11-23 21:42 a 2026-11-24 21:00 UTC. Pode ser só a data em que o item foi realocado no servidor. Não prova quando a divisão aconteceu, mas o erro 14566 mostra que `_c` já sumiu antes de 2026-11-22 17:29.

## Causa raiz

1. `config.go:111-122`: `IACollections["xbox"]` fixa `microsoft_xbox_c`, `_d`, `_m`, `_n`, `_o`, `_s`, `_t` (lista sem mudança desde `e2b9995`, 2026-04-15).
2. `ia.go::FindEntry` procura primeiro no `GameEntryMap`. Se não acha nem por *fuzzy*, chama `LiveSearchIA`. Esta reduz as coleções pela primeira letra (`_c` ou `_c_part`) e restam só as que estão na config, ou seja `microsoft_xbox_c`. O `DoIAMetaFetch` falha, o erro é engolido com `continue` (`ia.go:405-406`) e a função devolve `no match`. `FindEntry` traduz isso para `not found in Internet Archive`.
3. A reconstrução do cache (`ia.go:286-316`) trata **qualquer** coleção com falha como reconstrução incompleta e chama `preserveExistingCache`. Com 7 de 27 coleções fora, o cache do Original Xbox **nunca mais se reconstrói**: fica o cache antigo em disco, se houver, ou nenhum.
4. `pipeline.go:184-188` devolve `IA search failed`, e as demais fontes também falham (HF não suporta `xbox`, Minerva sem seeders). A UI mostra a mensagem genérica de internet/VPN/antivírus.

**Não verificado:** um cliente que ainda tem o cache antigo em disco tem entradas apontando para `microsoft_xbox_c/...`. Nesse caso o erro deve ser outro (download HTTP 404 em vez de "not found"). O cliente do #437 caiu no "not found", então o `GameEntryMap` dele não tinha a entrada.

## Escopo — o que NÃO é este bug

- Não é internet, VPN nem antivírus do cliente: outro jogo baixou em seguida, no mesmo PC (`[197347]`).
- Não é espaço nem destino: o print mostra 116,4 GB livres e o pendrive certo.
- Não é "jogos de corrida" (palpite do agente em `[197362]`): o que une os títulos que falham é a **letra inicial**.
- Os erros `not found` mais antigos (Midnight Club II em 2026-09-20, EA FC 26, PES 2026 Bomba Patch, CoD Ghosts Japan, Cabela's) são anteriores à divisão. São títulos que de fato não estão no IA e não entram aqui.
- A mensagem genérica que manda o cliente olhar internet, VPN e antivírus quando a falha é "título não encontrado em nenhuma fonte" é um defeito de diagnóstico à parte. Fica registrado como achado para outro doc, fora do escopo deste.

## Tarefas propostas / Próximos passos

1. **`config.go::IACollections["xbox"]`**: trocar os 7 ids por `_part1` e `_part2`. Teste: um teste unitário que valida que cada letra de `a` a `z` resolve para ao menos uma coleção em `LiveSearchIA`. Prova de campo: baixar *Crash Nitro Kart (USA)* como Original Xbox e ver a tarefa chegar a "Pronto".
2. **Resiliência (decidir com o dono):** a divisão parece estar em andamento (itens com `created` de hoje). Outras letras podem virar `_partN` depois. Opções:
   - descobrir as coleções pela busca `identifier:microsoft_xbox_<letra>*` em vez de fixar a lista;
   - ou, no mínimo, não descartar a reconstrução inteira por uma coleção 404 (`ia.go:313-316`): usar as que responderam e avisar quais sumiram.
3. **Alerta:** uma coleção configurada que responde `{}` ou 404 deveria ir para a telemetria como erro próprio ("coleção IA sumiu"), e não aparecer só como N erros de "not found" por título.
4. Seguir o checklist do `CLAUDE.md`: version bump nos 4 arquivos + `CHANGELOG.md`.

## Análise da correção (2026-11-24, sessão de fix)

### Símbolos abertos

- `app/config.go::IACollections["xbox"]` — lista fixa; 7 ids mortos (`_c _d _m _n _o _s _t`).
- `cache/ia.go::LiveSearchIA` — estreita por `_<letra>` **ou** `_<letra>_part`; com `_part1/_part2` na config a letra `c` resolve para as duas. Em erro de `DoIAMetaFetch` faz `continue` (engole).
- `cache/ia.go::Build` — qualquer coleção com erro ou vazia → `preserveExistingCache` (não publica nada).
- `cache/ia.go::LoadCacheFromDisk` — aceita **qualquer** cache em disco com `len(games) > 0`; não confere se as coleções das entradas batem com a config.
- `main.go:97-112` — se `LoadCacheFromDisk` devolve `true`, **não chama `Build`**. Cache em disco nunca é reconstruído na inicialização.
- `cache/ia.go::replaceMemoryCache` — só remove do `GameEntryMap` entradas de coleções que estão na config atual; entrada de `microsoft_xbox_c` (fora da config) ficaria para sempre.
- `electron-app/infrastructure/fileSystem.ts::prepareWritableRuntime` — copia `resources/cache/*` para a pasta de dados **só se o arquivo não existir** (`copyDirectoryContentsIfMissing`). Atualizar o `cache/xbox.json` do repositório não chega a quem já instalou.

### Medições

- `advancedsearch.php?q=identifier:microsoft_xbox_*` (agora): as 7 antigas sumiram; existem `_{c,d,m,n,o,s,t}_part{1,2}`. Nenhuma outra letra mudou.
- `curl archive.org/metadata/<id>` nas 34 coleções da config nova: todas respondem com arquivos (`c_part1` 106, `c_part2` 77, … `z` 8).
- `cache/xbox.json` empacotado (build_time 2026-04-03): 1.093 jogos, **só 20 das 27 coleções** — nenhuma entrada de C, D, M, N, O, S, T. Ou seja, quem instala do zero recebe um catálogo IA do Original Xbox sem essas letras e, como o cache carrega, nunca o reconstrói.
- Demais caches empacotados (`xbox360`, `digital`, `xbla`, `dlc`, `xblig`, `games`): o conjunto de `collection_id` bate exatamente com a config. O teste de completude abaixo só dispara rebuild para `xbox`.

### Hipóteses descartadas

- *Só trocar os ids basta para todo cliente:* não. Basta para o caminho `LiveSearchIA` (cliente sem a entrada, caso do #437). Mas um cliente com cache em disco que tenha entradas `microsoft_xbox_c/...` continuaria baixando de URL 404, porque o cache carrega e nunca reconstrói.
- *Regenerar o `cache/xbox.json` do repositório:* não chega a quem já instalou (copy-if-missing). Desnecessário com a checagem de completude, que faz o próprio app reconstruir.
- *Descartar o cache inteiro quando está desatualizado:* se o rebuild falhar (IA instável), o catálogo do Original Xbox ficaria vazio. Melhor carregar o que está válido e mandar reconstruir.

### Tarefas

1. `config.go::IACollections["xbox"]`: 7 ids → 14 `_part1/_part2`.
2. `ia.go::LoadCacheFromDisk` (plataformas não-`hf_`): descartar entradas cuja coleção não está na config; se alguma foi descartada ou alguma coleção da config não tem entrada, carregar o restante e devolver `false` (o chamador em `main.go` dispara `Build`).
   Teste: `TestLoadCacheFromDiskDropsRetiredCollectionsAndAsksRebuild` + `TestLoadCacheFromDiskAcceptsCompleteCache`.
3. Teste de rede opt-in (`GODSEND_REMOTE_CATALOG_AUDIT=1`): toda coleção de `IACollections` responde com arquivos. É o teste que teria pego a divisão.
4. Fora deste bug (listar ao dono): descoberta dinâmica das coleções, alerta de "coleção sumiu" na telemetria, mensagem genérica de internet/VPN para "não encontrado".

## Correção aplicada (2.12.132) — aguardando reteste

- Feito: tarefas 1, 2 e 3 da seção acima (`config.go`, `ia.go::LoadCacheFromDisk`, `ia_collections_test.go`). AGENTS.md (`cache/`) e CHANGELOG atualizados.
- Provas na máquina de dev (2026-11-24):
  - `go test ./services/cache/ ./app/` verde; `GODSEND_REMOTE_CATALOG_AUDIT=1 go test ./services/cache/ -run TestRemoteIACollectionsExist` verde (todas as coleções de `IACollections` respondem com arquivos).
  - Teste temporário (apagado): `FindEntry(..., "xbox")` com cache frio devolve `microsoft_xbox_c_part2` para os 3 títulos do #437/14566. `LoadCacheFromDisk("xbox")` sobre o `cache/xbox.json` do repositório devolve `false` (14 coleções faltando), então a inicialização reconstrói.
  - `GET` com o `IAHTTPClient` autenticado do app em `microsoft_xbox_c_part2/Crash Nitro Kart (USA).zip` com `Range: bytes=0-1023` → **206** (`0-1023/6548029041`), igual a `microsoft_xbox_a`. Anônimo dá 401 nas duas, então não é diferença das coleções novas.
- **Reteste de campo:** com a 2.12.132, baixar *Crash Nitro Kart (USA)* como Original Xbox e ver a tarefa chegar a "Pronto". No log da primeira abertura deve aparecer `CACHE [xbox]: disk cache is stale ... rebuilding` e, depois, `CACHE: xbox complete — N games` com N > 1.093.
- Fora deste bug, registrados como bugs próprios em `docs/bugs/open/`:
  - [lista fixa de coleções / rebuild tudo-ou-nada](../open/cache-ia-lista-fixa-de-colecoes-quebra-quando-o-archive-renomeia-e-rebuild-e-tudo-ou-nada_2026-11-24T21-07.md)
  - [coleção que some não gera alerta na telemetria](../open/telemetria-colecao-ia-que-some-nao-gera-alerta-proprio-so-erros-por-titulo_2026-11-24T21-07.md)
  - ["não encontrado" mostra mensagem de internet/VPN/antivírus](../open/pipeline-jogo-nao-encontrado-em-nenhuma-fonte-mostra-mensagem-de-internet-vpn-antivirus_2026-11-24T21-07.md)
