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

- [ ] Dono decidiu entre descoberta dinâmica e só rebuild parcial
- [ ] Coleção renomeada no IA não exige versão nova do app para voltar a baixar (ou, no mínimo, não derruba as demais coleções da plataforma)
- [ ] Rebuild com coleção ausente não se repete a cada abertura
- [ ] Testes unitários acima verdes
