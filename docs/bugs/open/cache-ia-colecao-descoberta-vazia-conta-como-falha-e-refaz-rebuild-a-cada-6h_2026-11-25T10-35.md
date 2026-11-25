# Bug: cache IA — coleção descoberta no archive.org mas vazia conta como falha, refaz o rebuild do Xbox 360 a cada 6 h e manda alerta falso de "coleção sumiu" à telemetria

- **Detectado em:** 2026-11-25 10:35 (conferência da 2.12.136 rodada nesta máquina)
- **Origem:** `xbox-360-companion/cache` — `src/server/services/cache/ia.go::build` e `LoadCacheFromDisk`, `src/server/services/cache/ia_discovery.go::discoverIACollections`
- **Classe:** fail (resiliência) + ruído de telemetria
- **Severidade:** **P3 — Baixo.** Os downloads não quebram: a letra R continua vindo de `microsoft_xbox360_r`. O custo é um rebuild completo do Xbox 360 a cada 6 h em cada usuário e um alerta falso por rebuild.
- **Complexidade:** **baixa**: Go, `services/cache/`, mais uma linha de filtro no `package.json` do Electron
- **Versões:** 2.12.136 (introduzido pela correção do bug de origem)
- **Reincidência:** não. É um defeito da correção de [cache-ia-lista-fixa-de-colecoes-…](../retest/cache-ia-lista-fixa-de-colecoes-quebra-quando-o-archive-renomeia-e-rebuild-e-tudo-ou-nada_2026-11-24T21-07.md) (commit `2b713ee`), que fica reprovada no passo 1 do reteste até esta correção sair.

## Sintoma

O backend da 2.12.136 rodou nesta máquina em 2026-11-25 01:47 (a partir da raiz do repositório) e reconstruiu os caches:

- `cache/xbox.json`: 34 coleções, completo.
- `cache/xbox360.json`: 39 coleções, 3.249 jogos (o mesmo número do HEAD), 129 da letra R, todos com `collection_id = microsoft_xbox360_r`.
- `cache/xbox360.attempt.json` foi gravado com `"failed": ["microsoft_xbox360_r_part1"]`: o rebuild ficou registrado como incompleto.

## Causa raiz

`microsoft_xbox360_r_part1` existe, mas está **vazia**. O índice do `advancedsearch` a devolve, então `discoverIACollections` a inclui na lista. Os únicos arquivos dela hoje:

```
curl -s https://archive.org/metadata/microsoft_xbox360_r_part1
→ 200; files: history/files/Radirgy Noa Massive (Japan) (En,Ja).zip.~1~, history/files/___ia_thumb.jpg.~1~,
  _archive.torrent, _files.xml, _meta.sqlite, _meta.xml  → 0 arquivo .zip/.rar/.7z
```

O único `.zip` que ela teve foi apagado (está em `history/`). **Corrige o relato anterior:** a R **não** está sendo dividida com conteúdo, e o título repetido **não** aponta para a `_part1`.

Encadeamento, aberto no código:

1. `ia.go::DoIAMetaFetch`: `meta.Files` tem 6 arquivos, então não cai em `errIACollectionGone`. Devolve `entries` vazio e `err == nil`.
2. `ia.go::build`: quando `len(r.entries) == 0`, faz `failedCollections = append(...)` e chama `reportGoneCollection(platform, id, "no downloadable archives")`. Esse método manda `reportTelemetry("cache","ia.go","Build","Coleção IA sumiu: …")`. Como `failedCollections` não fica vazio, o build cai em `recordIncompleteBuild`.
3. `ia.go::LoadCacheFromDisk`: a lista persistida (`pc.Collections`, 39) tem `r_part1`, e nenhuma entrada do cache é dessa coleção. Por isso `missing = [r_part1]`. Com tentativa recente na mesma lista, só registra no log. **Passadas as 6 h (`IARebuildRetryInterval`), devolve `false`** e `main.go` chama `Build("xbox360")` de novo. O ciclo se repete enquanto o IA não puser jogos na `_part1`.
4. `ia_discovery.go::RebuildIfCollectionsChanged` não piora: a lista descoberta (39) é igual à persistida.

**Agravante, empacotamento:** `src/electron-app/package.json` → `extraResources` copia `../../cache` para `cache` com o filtro `["**/*", "!**/*.iso", "!**/*.ISO"]`. Um `*.attempt.json` gerado numa execução local entra no instalador.

## Hipóteses descartadas

- **Tirar a coleção vazia de dentro de `discoverIACollections`.** A descoberta não sabe se uma coleção está vazia: isso exigiria um metadata por coleção na busca, e quem já faz esse fetch é o `build`.
- **Só tirar a coleção vazia da lista persistida.** Na abertura seguinte, `RebuildIfCollectionsChanged` acha 39 contra 38 persistidas e reconstrói **a cada abertura**, sem a espera de 6 h. É pior que hoje.
- **Tratar a coleção vazia como erro transitório.** Mantém o registro de tentativa incompleta e o ciclo de 6 h. Só troca o alerta por outro.

## Correção planejada

### T1 — coleção vazia que só a descoberta trouxe não conta como falha

- **Regra:** se a coleção veio vazia (0 arquivos de jogo, sem erro) e **não está em `app.IACollections[platform]`**, ela fica na lista persistida, para que `RebuildIfCollectionsChanged` continue vendo a lista igual, mas:
  - não entra em `failedCollections`, para não gravar o registro de tentativa;
  - não chama `reportGoneCollection`;
  - não conta como `missing` em `LoadCacheFromDisk`.
- **Como marcar:** novo campo `PlatformCache.EmptyCollections []string json:"empty_collections,omitempty"` em `models/types.go`, gravado por `saveCacheToDisk`. `LoadCacheFromDisk` trata as coleções desse campo como cobertas. Antes de escrever, abrir a assinatura de `saveCacheToDisk` em `ia.go` e todos os chamadores (`grep -n saveCacheToDisk`).
- **Coleção configurada que vier vazia** continua como hoje (falha + telemetria): é aí que o alerta tem valor.
- **Quando o IA encher a `_part1`:** a lista descoberta não muda, então não há rebuild automático. Os títulos continuam vindo da `_r` sem rótulo. Quando a `_r` sair do índice, a lista muda e o rebuild acontece. Aceitável; registrar no doc se a implementação confirmar.
- **Testes novos em `ia_discovery_test.go`:**
  - `build` com uma coleção extra vazia → sem `cache/<p>.attempt.json`, `FetchCollectionEntriesFn` sem telemetria (conferir como `reportTelemetry` é dublado nos testes de `refresh_safety_test.go`), cache gravado com `empty_collections`.
  - Recarga desse cache → `LoadCacheFromDisk` devolve `true`, mesmo depois de 6 h.
  - Coleção **configurada** vazia → continua falha (o teste existente `TestIABuildDropsEntriesOfGoneCollectionAndPublishesTheRest` deve continuar verde).
- **Mutação:** tirar a condição "não está na config" → o teste da coleção configurada vazia reprova.

### T2 — `*.attempt.json` fora do instalador

- `src/electron-app/package.json`: no `extraResources` de `../../cache`, acrescentar `"!**/*.attempt.json"` ao filtro.
- Opcional: `.gitignore` com `cache/*.attempt.json`. **O `.gitignore` deste repo pode ter mudança de outra sessão: diff antes e commit só do trecho.**
- **Prova:** `npm run build` do Electron, ou só conferir o filtro com `node -e` lendo o JSON, porque um build completo é caro. No mínimo: `git grep attempt.json src/electron-app/package.json`.

## Passagem de bastão (próxima sessão)

**Estado em 2026-11-25 10:35:**

- `origin/main` = `2b713ee` (2.12.136).
- Na árvore de trabalho, **sem commit e de OUTRA sessão** (não tocar, não commitar):
  - 19 arquivos do Electron (Browse, fila, `preparedUsbDetection`, `renderer-dist`);
  - `CHANGELOG.md` com a entrada dela em `[Unreleased]`;
  - `AGENTS.md`, `docs/*.md`;
  - as **linhas de versão em 2.12.134**: `package.json`, `src/electron-app/package.json`, `aurora-scripts/main.lua`, `src/server/main.go`.
- `cache/xbox.json` e `cache/xbox360.json` foram regravados pela execução local das 01:47. São rastreados e o instalador os leva como semente. Não são desta correção: não commitar sem o dono decidir.
- `cache/xbox360.attempt.json` está não rastreado. Pode apagar depois da T2: é da execução local.

**Próximos passos exatos:**

1. Ler este doc e abrir `ia.go::build`, `ia.go::LoadCacheFromDisk`, `ia.go::saveCacheToDisk`, `models/types.go::PlatformCache` e `ia_discovery.go`.
2. T1 com os testes acima, `go test ./...` e `go vet` em `src/server`, mais as mutações.
3. T2.
4. Versão **2.12.137** nos 4 lugares, mais a entrada no `CHANGELOG.md`, commitada **por índice privado** (`GIT_INDEX_FILE` + `git hash-object -w` + `git update-index --cacheinfo` + `git commit-tree`/`update-ref`), partindo do conteúdo do HEAD de cada arquivo. Assim a 2.12.134 e o `[Unreleased]` da outra sessão continuam intactos na árvore. Mesmo procedimento do commit `2b713ee`.
5. `npm run build:server`, commit citando este doc, push.
6. Atualizar a seção "Reteste" do doc de origem: passo 1 com `xbox360 complete` e sem `xbox360.attempt.json` quando só a `_part1` estiver vazia.

## Tasks

| # | task | commit | estado | modelo | revisor |
|---|---|---|---|---|---|
| T1 | coleção vazia só da descoberta não conta como falha, não alerta e não é `missing` | -- | backlog | -- | -- |
| T2 | `*.attempt.json` fora do `extraResources` do instalador | -- | backlog | -- | -- |
