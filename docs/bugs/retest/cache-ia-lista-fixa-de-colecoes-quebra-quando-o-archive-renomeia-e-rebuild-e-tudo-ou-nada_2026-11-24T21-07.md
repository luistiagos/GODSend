# Bug: cache IA — lista fixa de coleções em `IACollections` quebra a plataforma inteira quando o Internet Archive renomeia ou divide uma coleção, e o rebuild é tudo-ou-nada

- **Detectado em:** 2026-11-24 21:07 (análise do fix da 2.12.132)
- **Origem:** `xbox-360-companion/cache` — `src/server/app/config.go::IACollections`, `src/server/services/cache/ia.go::Build`, `LoadCacheFromDisk` e `LiveSearchIA`
- **Errors (serviço):** 14764, 14765, 14566 (consequência, ver bug de origem)
- **Classe:** fail (resiliência)
- **Severidade:** **P2 — Médio** hoje: com a lista corrigida na 2.12.132 não há falha ativa. Na próxima renomeação vira **P1** de novo: todos os títulos das letras afetadas param de baixar e ninguém é avisado.
- **Complexidade:** **média**: lógica nova no serviço Go `services/cache/ia.go` (descoberta por `advancedsearch`, rebuild parcial, espera entre tentativas). Não toca pipeline nem UI
- **Versões:** observado na 2.12.131; o comportamento continua na 2.12.132 (só a lista mudou)
- **Reincidência:** primeira vez registrada como defeito de resiliência. Origem: [pipeline-original-xbox-colecoes-ia-…](../retest/pipeline-original-xbox-colecoes-ia-c-d-m-n-o-s-t-divididas-em-part1-part2-e-o-app-ainda-busca-o-nome-antigo_2026-11-24T21-30.md)

## Sintoma

Em 2026-11 o Internet Archive dividiu `microsoft_xbox_{c,d,m,n,o,s,t}` em `_part1`/`_part2`. A lista fixa no binário continuou apontando para os ids antigos (`{}`/404) até sair uma versão nova do app. Todo título dessas letras falhou com `IA search failed: not found in Internet Archive`, e o cache do Original Xbox nunca mais se reconstruiu.

Há sinais de que a divisão ainda está em andamento: os itens novos têm `created` de 2026-11-23/24. As letras que ainda são coleção única (`a b e f g h i j k l p q r u v w x y z`, e várias do Xbox 360) podem ser as próximas.

## Causa raiz

1. **Lista fixa:** `config.go::IACollections` é um `map[string][]string` compilado no binário. Coleção renomeada só volta a funcionar quando sai uma versão nova e o cliente atualiza.
2. **Rebuild tudo-ou-nada:** `ia.go::Build` põe em `failedCollections` toda coleção com erro (após 5 tentativas) ou sem arquivos. Se a lista não estiver vazia, chama `preserveExistingCache` e **não publica nada**: uma coleção 404 em 34 descarta as outras 33.
3. **Rebuild a cada abertura (efeito da 2.12.132):** `LoadCacheFromDisk` devolve `false` quando falta no cache alguma coleção configurada, e `main.go` dispara `Build`. Se uma coleção configurada sumir de novo, o rebuild falha (item 2), o cache em disco não muda, e **toda abertura do app** refaz as requisições de metadata de todas as coleções sem nunca concluir. Coleção que sumiu responde `{}` com HTTP 200 (medido em `microsoft_xbox_c`), então não entra no retry. Uma coleção com erro de rede gasta 4 retries com espera de 3+8+20+40 s.
4. **`LiveSearchIA` engole o erro:** um `DoIAMetaFetch` com falha faz `continue`, e coleção vazia (`{}`) passa como normal (`ia.go`, laço `for _, coll := range candidates`). Se todas as candidatas da letra estão mortas, o resultado é `no match`, que `FindEntry` traduz para `not found in Internet Archive`, sem dizer que a coleção sumiu.

## Como reproduzir

1. Em teste, `app.IACollections["x"] = {"ok", "morta"}` com `FetchCollectionEntriesFn` devolvendo erro para `"morta"`: `Build("x")` não publica as entradas de `"ok"`. É o comportamento coberto hoje por `TestIABuildPreservesCompleteCacheWhenOneCollectionFails`, que o fixa como correto.
2. No real: trocar um id por um inexistente (`microsoft_xbox_a_naoexiste`) e abrir o app sem `cache/xbox.json`. O catálogo do Original Xbox fica em erro e os títulos com `A` dão "not found".

## Resolução proposta (decidir com o dono)

1. **Descoberta das coleções:** no `Build`, para plataformas com padrão Redump (`microsoft_xbox_`, `microsoft_xbox360_`), consultar `advancedsearch.php?q=identifier:<prefixo>*&fl[]=identifier` e usar o resultado (filtrado pelo prefixo e pelo padrão `_<letra>`, `_<letra>_partN`, `_numberssymbols`). A lista da config vira fallback para quando a busca falhar. Excluir ids que não são de jogo, como `microsoft_xbox_devkit_hdds` (que aparece na busca de hoje).
2. **Rebuild parcial:** publicar as coleções que responderam e manter, para as que falharam, as entradas antigas do cache, se houver, em vez de descartar tudo. Não deixar o teste do item 1 de "Como reproduzir" inverter a garantia que ele protege hoje: entrada nova parcial não pode apagar entrada antiga boa.
3. **Sem tempestade de rebuild:** se o rebuild falhar pela mesma coleção, não repetir a cada abertura. Por exemplo, gravar no cache a lista de coleções ausentes e o horário da tentativa, com espera mínima entre tentativas.

## Testes Automatizados

- Unitário: `Build` com uma coleção falhando publica as demais e preserva as entradas antigas da que falhou.
- Unitário: descoberta com `advancedsearch` simulado (`httptest`) devolvendo `_c_part1`/`_c_part2` substitui `_c` da config.
- Já existe: `TestRemoteIACollectionsExist` (`GODSEND_REMOTE_CATALOG_AUDIT=1`) detecta coleção configurada que sumiu.

## Critérios para fechar

- [x] Dono decidiu entre descoberta dinâmica e só rebuild parcial (2026-11-25: as três frentes)
- [ ] (reteste) Coleção renomeada no IA não exige versão nova do app para voltar a baixar (ou, no mínimo, não derruba as demais coleções da plataforma)
- [ ] (reteste) Rebuild com coleção ausente não se repete a cada abertura
- [x] Testes unitários acima verdes

## Análise da correção (2026-11-25, sessão de fix)

**Decisão do dono (2026-11-25):** as três frentes — descoberta dinâmica por `advancedsearch`, rebuild parcial e espera entre tentativas.

### Símbolos abertos

- `app/config.go::IACollections` — `map[string][]string` global, lido sem lock por `ia.go` e `interfaces/http/handlers.go` (só `len(...)` para o total do progresso e `range`/`ok` sobre as **chaves**). Mutá-lo em runtime seria corrida de dados: a lista descoberta fica num registro próprio com mutex, e a config vira fallback.
- `services/cache/ia.go::Build` — busca todas as coleções em paralelo; qualquer erro ou coleção vazia vai para `failedCollections` e, se houver uma, chama `preserveExistingCache` e não publica nada (tudo-ou-nada). Resultados chegam em ordem não determinística pelo canal.
- `ia.go::LoadCacheFromDisk` — descarta entradas de coleção fora de `IACollections[platform]` e devolve `false` quando falta coleção configurada; `main.go` então chama `Build` a cada abertura. Não lê `BuildTime`.
- `ia.go::replaceMemoryCache` — apaga do `GameEntryMap` as entradas cujo `CollectionID` está em `IACollections[platform]`. Se a lista efetiva mudar (`_r` → `_r_part1`), as entradas da coleção aposentada não seriam apagadas: a posse tem que cobrir lista antiga, nova e o padrão da plataforma.
- `ia.go::LiveSearchIA` — estreita por letra (`_<l>`, `_<l>_part`, `_numberssymbols`) sobre `IACollections[platform]`. O item 4 da causa raiz já foi corrigido na 2.12.135 (`errIACollectionUnavailable`).
- `ia.go::DoIAMetaFetch` / `FetchIACollectionEntries` — 404 e 200 `{}` viram `errIACollectionGone` (sem retry); 5xx/rede tentam 4 vezes.
- `models/types.go::PlatformCache` — `Games`, `GameEntries`, `BuildTime`. Sem campo para a lista de coleções.
- `main.go` — no boot, `LoadCacheFromDisk` por plataforma; `false` → `go Build(p)` com atraso escalonado.
- Testes: `refresh_safety_test.go::TestIABuildPreservesCompleteCacheWhenOneCollectionFails` fixa o tudo-ou-nada como correto (vai ser reescrito para a garantia nova: entrada antiga da coleção que falhou não some); `ia_collections_test.go` (`withIACollections`, `writeIADiskCache`); `ia_gone_test.go` (`fakeIAMetadata`, `captureTelemetry`, `newIATestApp`).

### Medições (2026-11-25)

- `curl "https://archive.org/advancedsearch.php?q=identifier%3Amicrosoft_xbox_*&fl%5B%5D=identifier&rows=300&output=json"` → `numFound: 36`: as 34 coleções da config + `microsoft_xbox_devkit_hdds` + `Microsoft_XBOX_360_Remote_Recovery_Software_Archive` (não são jogo).
- Mesma busca com `microsoft_xbox360_*` → `numFound: 52`. Além das 38 da config: `microsoft_xbox360_digital_part1..7` (plataforma `digital`), `microsoft_xbox360_title-updates`, `microsoft_xbox360_TRAD_BR_2026_romsbrasil_parte1..5` e **`microsoft_xbox360_r_part1` ao lado de `microsoft_xbox360_r`**: a divisão do R do Xbox 360 está em andamento agora.

### Hipóteses descartadas

- **Trocar a lista pela busca inteira:** perderia letra quando o índice do IA estiver atrasado ou incompleto, e com `_r` e `_r_part1` coexistindo, escolher só as partes cortaria metade da letra R. Fica: por letra, a união do que a busca achou; letra que a busca não achou usa a config.
- **Mutar `app.IACollections` com o resultado:** leitura sem lock em handlers e em `ia.go`; corrida de dados.
- **Filtrar por prefixo simples (`microsoft_xbox360_`):** traria `digital`, `title-updates` e `TRAD_BR`. Fica o padrão estrito `^<prefixo>(numberssymbols|[a-z])(_part\d+)?$`.
- **Preservar entradas antigas também de coleção sumida (404/`{}`/vazia):** as URLs delas são 404; preservar manteria no catálogo jogos que não baixam. Só erro transitório (rede/5xx) preserva.
- **Rebuild por idade do cache (ex.: 7 dias):** detectaria renomeação com até uma semana de atraso. Fica uma descoberta por abertura (1 requisição) comparada com a lista gravada no cache.

### Correção planejada

1. **Descoberta** (`ia.go`): `discoverIACollections(platform)` só para `xbox` e `xbox360`; busca `advancedsearch`, filtra pelo padrão estrito, agrupa por letra e mescla com a config por letra. Falha da busca → config. Resultado num registro com mutex (`IACollectionsFor`), gravado em `PlatformCache.Collections` e restaurado pelo `LoadCacheFromDisk`.
2. **Rebuild parcial** (`Build`): publica as coleções que responderam; coleção com erro transitório mantém as entradas antigas do cache em memória; coleção sumida perde as suas. Títulos repetidos entre coleções da mesma letra (divisão em andamento) entram uma vez, com preferência para `_partN`, em ordem determinística.
3. **Sem tempestade** (`Build`/`LoadCacheFromDisk`): build incompleto grava `cache/<plataforma>.attempt.json` (coleções que falharam + horário); sucesso completo apaga. `LoadCacheFromDisk` com coleção faltando que está no registro de tentativa recente (< `IARebuildRetryInterval` = 6 h) devolve `true`.
4. **Renomeação sem versão nova** (`main.go` + `ia.go::RebuildIfCollectionsChanged`): com cache válido carregado, uma descoberta em segundo plano; lista diferente da gravada → `Build` (respeitando a espera do item 3).

## Tasks

| # | task | commit | estado |
|---|---|---|---|
| T1 | descoberta + rebuild parcial + espera + checagem no boot (`ia.go`, `ia_discovery.go`, `models/types.go`, `handlers.go`, `main.go`) com testes | (este commit, 2.12.136) | implementada |

### T1 — testes que provam

- `services/cache/ia_discovery_test.go` (novo): busca simulada (`httptest`) com `_c_part1`/`_c_part2` substitui `_c`; `_r` + `_r_part1` ficam os dois; `devkit_hdds`/`digital`/`TRAD_BR` excluídos; letra ausente na busca mantém a config; busca com erro → config.
- `refresh_safety_test.go`: coleção com erro transitório preserva as entradas antigas dela e publica as demais; coleção sumida perde as suas; título repetido entre `_r` e `_r_part1` entra uma vez apontando para a parte.
- `ia_collections_test.go`: tentativa recente com a mesma coleção faltando não pede rebuild; tentativa vencida pede; build completo apaga o registro.
- Suítes: `go test ./services/cache/ ./interfaces/http/ .` e `npm run build:server`.

## Correção aplicada (2.12.136) — aguardando reteste

Implementado como planejado, sem desvio de desenho. Detalhes que só apareceram no código:

- **Arquivos:** `src/server/services/cache/ia.go` (`Build` → `build(platform, colls)`, `LoadCacheFromDisk`, `replaceMemoryCache`, `LiveSearchIA`, `saveCacheToDisk`), `src/server/services/cache/ia_discovery.go` (novo: `discoverIACollections`, `mergeDiscoveredCollections`, `iaCollectionLetter`, `CollectionsFor`, `RebuildIfCollectionsChanged`, registro `cache/<plataforma>.attempt.json`), `src/server/app/app.go` (`IAEffectiveCollections` + mutex, inicialização preguiçosa no setter), `src/server/models/types.go` (`PlatformCache.Collections`), `src/server/interfaces/http/handlers.go` (total do progresso pela lista em uso), `src/server/main.go` (`go iaSvc.RebuildIfCollectionsChanged(p)` quando o cache carregou válido).
- **Coleção vazia (`no downloadable archives`)** é tratada como sumida: perde as entradas antigas, como 404 e `{}`.
- **Build sem nenhum jogo** (todas falharam e não havia entrada antiga) continua em `preserveExistingCache`, e agora também grava o registro de tentativa.
- **Cache antigo sem `collections`** (anterior à 2.12.136) usa a config; a primeira abertura com a 2.12.136 faz a descoberta, vê a lista diferente no Xbox 360 (`_r_part1`) e reconstrói uma vez.
- **Limite conhecido:** se o índice do IA listar só `_r_part1` de uma letra enquanto `_r` ainda tiver títulos que não foram para a parte, `_r` sai da lista e esses títulos somem até a próxima descoberta. Hoje o índice lista os dois.

### Testes executados (2026-11-25)

- `go test ./services/cache/` → ok. Novos: `ia_discovery_test.go` (`TestIACollectionLetterAcceptsOnlyThePlatformGameSets`, `TestDiscoverIACollectionsReplacesRenamedAndKeepsLettersTheSearchMissed`, `TestDiscoverIACollectionsFailsOnHTTPErrorAndOnNoMatch`, `TestIABuildUsesDiscoveredCollectionsAndPersistsThem`, `TestIABuildFallsBackToConfigWhenDiscoveryFails`, `TestRebuildIfCollectionsChanged` com 5 subcasos, `TestLoadCacheFromDiskWaitsAfterAFailedRebuildOnTheSameList` com 4 subcasos); `refresh_safety_test.go` (`TestIABuildKeepsOldEntriesOfTransientlyFailedCollection` substitui `TestIABuildPreservesCompleteCacheWhenOneCollectionFails`, `TestIABuildDropsEntriesOfGoneCollectionAndPublishesTheRest`, `TestIABuildListsTitleOnceWhileALetterIsBeingSplit`, `TestIABuildCompleteClearsIncompleteRecord`).
- Mutações, uma por vez, com o arquivo restaurado depois: espera desligada → reprova `TestLoadCacheFromDiskWaitsAfterAFailedRebuildOnTheSameList`; preservação das entradas da coleção com erro transitório desligada → reprova `TestIABuildKeepsOldEntriesOfTransientlyFailedCollection`; ordem `_partN` antes de `_x` invertida → reprova `TestIABuildListsTitleOnceWhileALetterIsBeingSplit`.
- `go test ./...` (backend inteiro) → todos `ok`. `go vet ./services/cache/ ./interfaces/http/ .` → limpo. `npm run build:server` → os três binários Windows verificados.
- Descoberta contra o archive.org real (teste temporário, apagado): `xbox` → 34 coleções, igual à config; `xbox360` → 39, a config mais `microsoft_xbox360_r_part1`.

### Reteste

1. Abrir a 2.12.136 com o `cache/xbox360.json` de uma versão anterior: o log deve ter `collection list changed on archive.org (38 -> 39); rebuilding` e, no fim, `xbox360 complete`; o `cache/xbox360.json` passa a ter `"collections"` com `microsoft_xbox360_r_part1`.
2. Reabrir: sem rebuild do IA (só `Loaded xbox360 from disk`).
3. Telemetria nos dias seguintes: nenhum `not found in Internet Archive` em título de letra dividida.
