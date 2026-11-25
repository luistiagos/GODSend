# Bug: telemetria — coleção do Internet Archive que some não gera alerta próprio; o defeito só aparece como N erros "not found" por título, e levou dias para ser percebido

- **Detectado em:** 2026-11-24 21:07 (análise do fix da 2.12.132)
- **Origem:** `xbox-360-companion/cache` — `src/server/services/cache/ia.go::Build`, `preserveExistingCache`, `LiveSearchIA`; `src/server/infrastructure/telemetry/telemetry.go::Report`
- **Errors (serviço):** 14566 (2026-11-22 17:29 UTC), 14764 e 14765 (2026-11-24 18:38/18:39 UTC). Os três têm a mesma causa e chegaram como erros separados, um por título
- **Classe:** ux (observabilidade)
- **Severidade:** **P2 — Médio**: não bloqueia nada sozinho, mas foi o que deixou um P1 (metade do catálogo Original Xbox sem download) passar despercebido de 2026-11-22 até um cliente abrir chamado em 2026-11-24
- **Complexidade:** **média**: chamada nova de `telemetry.Report` em `services/cache/ia.go::Build` e erro novo em `LiveSearchIA`. Este último muda a mensagem de `FindEntry` e conversa com o bug da mensagem de internet/VPN
- **Versões:** 2.12.131 e 2.12.132
- **Reincidência:** primeira vez. Origem: [pipeline-original-xbox-colecoes-ia-…](../retest/pipeline-original-xbox-colecoes-ia-c-d-m-n-o-s-t-divididas-em-part1-part2-e-o-app-ainda-busca-o-nome-antigo_2026-11-24T21-30.md)

## Sintoma

O sinal de que `microsoft_xbox_c` (e mais 6 coleções) tinha sumido existia em toda máquina de cliente, mas só no log local:

- `Build`: `CACHE WARN [xbox]: microsoft_xbox_c returned no downloadable archives` e `INTERNET ARCHIVE CACHE ERROR [xbox]: incomplete rebuild: 7/27 collection(s) failed (...)`. O `archive.org/metadata/<id>` de coleção inexistente responde **HTTP 200 com `{}`**, não 404 (só `/details/<id>` dá 404). Para `DoIAMetaFetch`, isso é sucesso com zero arquivos;
- `LiveSearchIA`: nada. A coleção morta devolve lista vazia sem erro, e o laço segue como se o título só não estivesse nela.

Na telemetria chegou só a ponta: `Download falhou em todas as fontes para <título> (xbox): ia: IA search failed: not found in Internet Archive: <título>`, um erro por título. Esse texto se confunde com os "not found" legítimos (títulos que nunca estiveram no IA: Midnight Club II, EA FC 26, PES 2026 Bomba Patch, CoD Ghosts Japan, Cabela's), e a triagem não tem como saber que é uma coleção inteira fora do ar.

## Causa raiz

1. Nenhum ponto do pacote `services/cache` chama `telemetry.Report` (`grep -rn telemetry.Report src/server/services/cache/` não encontra nada). `Build` e `preserveExistingCache` só usam `s.App.Logf`.
2. `LiveSearchIA` (`ia.go`, laço `for _, coll := range candidates`) faz `continue` quando `DoIAMetaFetch` falha e trata como normal a coleção que volta vazia (o caso `{}`). A diferença entre "coleção sumiu" e "título não está na coleção" se perde ali.
3. O único reporte é o de `fallback.go::ProcessGameWithFallback` (`telemetry.Report("pipeline", "fallback.go", ...)`), que só conhece o erro final por título.

## Como reproduzir

1. Configurar um id inexistente em `IACollections` (por exemplo `microsoft_xbox_a` → `microsoft_xbox_a_naoexiste`) e abrir o app sem cache em disco, com telemetria ligada.
2. O log mostra `CACHE WARN ... HTTP 404` e `incomplete rebuild`, mas nenhum erro chega ao painel até alguém tentar baixar um título com `A`. Aí chega um `not found` por título.

## Resolução proposta

1. **`Build`:** quando uma coleção falhar com HTTP 404, ou com 200 mas sem `files` (o caso `{}`), chamar `telemetry.Report("cache", "ia.go", "Build", "Coleção IA sumiu: <id> (<plataforma>): <erro>", "", logs, false)`. Mensagem estável por coleção: `telemetry.Report` deduplica por `component|message` na sessão, e no painel vira **um** erro por coleção, não um por título. Não reportar timeout/5xx (instabilidade do IA, que já tem retry).
2. **`LiveSearchIA`:** se todas as coleções candidatas falharam ou vieram sem arquivos, devolver esse erro (`coleção IA indisponível: <ids>`) em vez de `no match`, para o reporte do fallback dizer a causa certa. Cuidado: hoje `FindEntry` troca qualquer erro de `LiveSearchIA` por `not found in Internet Archive`. Mudar isso também afeta a mensagem ao usuário (ver o bug da mensagem genérica de internet/VPN).

## Testes Automatizados

- Unitário: `Build` com `FetchCollectionEntriesFn` devolvendo `HTTP 404` para uma coleção chama o reporter (com um hook de teste para `telemetry.Report` ou um endpoint `httptest`) com a mensagem `Coleção IA sumiu: <id>`.
- Unitário: `LiveSearchIA` com todas as candidatas falhando devolve erro que cita a coleção, não `no match`.

## Critérios para fechar

- [ ] Coleção configurada que responde 404/`{}` gera um erro próprio na telemetria, identificável pelo id da coleção
- [ ] Erro por título de coleção morta é distinguível de "título que não existe no IA"
- [ ] Testes unitários acima verdes
