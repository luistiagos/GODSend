# Bug: telemetria — coleção do Internet Archive que some não gera alerta próprio; o defeito só aparece como N erros "not found" por título, e levou dias para ser percebido

- **Detectado em:** 2026-11-24 21:07 (análise do fix da 2.12.132)
- **Origem:** `xbox-360-companion/cache` — `src/server/services/cache/ia.go::Build`, `preserveExistingCache`, `LiveSearchIA`; `src/server/infrastructure/telemetry/telemetry.go::Report`
- **Errors (serviço):** 14566 (2026-11-22 17:29 UTC), 14764 e 14765 (2026-11-24 18:38/18:39 UTC). Os três têm a mesma causa e chegaram como erros separados, um por título
- **Classe:** ux (observabilidade)
- **Severidade:** **P2 — Médio**: não bloqueia nada sozinho, mas foi o que deixou um P1 (metade do catálogo Original Xbox sem download) passar despercebido de 2026-11-22 até um cliente abrir chamado em 2026-11-24
- **Complexidade:** **média**: chamada nova de `telemetry.Report` em `services/cache/ia.go::Build` e erro novo em `LiveSearchIA`. Este último muda a mensagem de `FindEntry` e conversa com o bug da mensagem de internet/VPN
- **Versões:** 2.12.131 e 2.12.132
- **Reincidência:** primeira vez. Origem: [pipeline-original-xbox-colecoes-ia-…](pipeline-original-xbox-colecoes-ia-c-d-m-n-o-s-t-divididas-em-part1-part2-e-o-app-ainda-busca-o-nome-antigo_2026-11-24T21-30.md)

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

## Análise para a correção (2026-11-24)

Símbolos abertos:
- `services/cache/ia.go::DoIAMetaFetch`: status != 200 vira `fmt.Errorf("%s: HTTP %d")`; `{}` decodifica com `Files` vazio e volta `nil, nil`, ou seja, sucesso sem arquivos.
- `ia.go::FetchIACollectionEntries`: repete qualquer erro 4 vezes (3+8+20+40 s), inclusive o 404, e embrulha com `%w`. `FetchCollectionEntriesFn` (gancho de teste) substitui a função inteira.
- `ia.go::Build`: erro → `failedCollections`; `len(entries)==0` → `failedCollections`; depois chama `preserveExistingCache`, que só faz `Logf`.
- `ia.go::FindEntry`: troca **qualquer** erro de `LiveSearchIA` por `not found in Internet Archive: <título>`. É chamada por `pipeline.go:184` e `digital.go:161/315`, que prefixam `IA search failed: %w`, e por `handlers_content.go:215/227` (só testam `err == nil`).
- `infrastructure/telemetry/telemetry.go::Report`: deduplica por `component|message` na sessão; `enabled` começa `true` e o endpoint padrão é o de produção. Por isso o teste precisa trocar o reporter: um teste que chamasse o `Report` de verdade mandaria erro para o painel.
- `app/user_error.go::FormatErrorForUser` não casa `not found in internet archive` (é o bug da mensagem de internet/VPN). Por isso a correção **mantém** o prefixo `not found in Internet Archive`: quando aquele bug mapear o prefixo, a coleção morta cai na mesma mensagem ao usuário ("não está disponível neste catálogo no momento"), o que é verdade.
- Testes que já usam `Build`: `refresh_safety_test.go` devolve `errors.New("provider unavailable")`, que não é 404 e não dispara o reporte. `ia_collections_test.go::TestRemoteIACollectionsExist` e `catalog_remote_audit_test.go` (opt-in, rede) continuam falhando para `{}` com a correção, só que agora via `err` em vez de `len==0`.

Descartado:
- Detectar 404 por `strings.HasSuffix(err, "HTTP 404")`: frágil. Melhor um sentinela (`errIACollectionGone`, texto `HTTP 404`) embrulhado com `%w`, porque o texto do log não muda e `errors.Is` atravessa o embrulho de `FetchIACollectionEntries`.
- Reportar também em `LiveSearchIA`: o motivo já segue na mensagem por título (fallback.go), e `Build` reporta a coleção uma vez por sessão. Um segundo reporte seria ruído.
- Reportar timeout/5xx: é instabilidade do IA e já tem retry (fica de fora, como a resolução pede).

Tasks:
1. `DoIAMetaFetch`: 404 e `{}` (sem `files`) devolvem erro com `errIACollectionGone`.
2. `FetchIACollectionEntries`: não repetir `errIACollectionGone`. Sem isso, transformar `{}` em erro somaria ~71 s de espera ao rebuild.
3. `Build`: coleção com `errIACollectionGone` ou sem arquivos chama `reportTelemetry("cache", "ia.go", "Build", "Coleção IA sumiu: <id> (<plataforma>): <motivo>", ...)`, com `var reportTelemetry = telemetry.Report` trocável no teste.
4. `LiveSearchIA`: se todas as candidatas falharam ou vieram vazias, devolve `coleção IA indisponível: <ids>`. `FindEntry` passa a anexar esse motivo: `not found in Internet Archive: <título> (coleção IA indisponível: <ids>)`.
5. Testes em `services/cache/ia_gone_test.go`: `Build` com 404 reporta e com erro genérico não reporta; `DoIAMetaFetch` com `{}` dá `errIACollectionGone` (pelo `httptest`); `LiveSearchIA` com todas as candidatas mortas cita a coleção.

## Testes Automatizados

- Unitário: `Build` com `FetchCollectionEntriesFn` devolvendo `HTTP 404` para uma coleção chama o reporter (com um hook de teste para `telemetry.Report` ou um endpoint `httptest`) com a mensagem `Coleção IA sumiu: <id>`.
- Unitário: `LiveSearchIA` com todas as candidatas falhando devolve erro que cita a coleção, não `no match`.

## Critérios para fechar

- [x] Coleção configurada que responde 404/`{}` gera um erro próprio na telemetria, identificável pelo id da coleção
- [x] Erro por título de coleção morta é distinguível de "título que não existe no IA"
- [x] Testes unitários acima verdes

## Correção aplicada (2.12.135): aguardando reteste

- Feito: tarefas 1 a 5 da análise, todas em `src/server/services/cache/ia.go`:
  - `DoIAMetaFetch` devolve `errIACollectionGone` para 404 e para `{}`.
  - `FetchIACollectionEntries` não repete esse erro.
  - `Build` chama `reportGoneCollection`, que manda `Coleção IA sumiu: <id> (<plataforma>): <motivo>` com componente `cache`.
  - `LiveSearchIA` devolve `errIACollectionUnavailable` quando todas as candidatas estão mortas, e `FindEntry` anexa o motivo: `not found in Internet Archive: <título> (coleção IA indisponível: <ids>)`.
  - Testes em `ia_gone_test.go`. AGENTS.md (`cache/`) e CHANGELOG atualizados.
- Provas na máquina de dev (2026-11-24): `go test ./... -count=1` em `src/server` deu verde, incluindo os 4 testes novos (`TestDoIAMetaFetchMarksMissingCollectionAsGone`, `TestIABuildReportsGoneCollectionOnce`, `TestFindEntryNamesUnavailableCollection`, `TestFindEntryTitleMissingFromLiveCollectionStaysNotFound`). Os testes trocam `reportTelemetry` e `iaMetadataBaseURL`, então nada chega ao painel nem ao archive.org.
- Mensagem ao usuário: não muda. `FormatErrorForUser` continua sem casar `not found in internet archive`; isso fica com o bug da [mensagem de internet/VPN](../open/pipeline-jogo-nao-encontrado-em-nenhuma-fonte-mostra-mensagem-de-internet-vpn-antivirus_2026-11-24T21-07.md), e o prefixo foi mantido para aquele fix cobrir os dois casos.
- **Reteste de campo:** quando o IA renomear ou apagar outra coleção configurada, a telemetria deve mostrar **um** erro `xbox-360-companion/cache` `Coleção IA sumiu: <id>` por coleção e sessão. Os erros por título devem trazer `(coleção IA indisponível: <id>)` no fim.
