# Bug: o catálogo mostra a mesma capa para jogos diferentes da mesma franquia ("Air Conflicts Pacific Carriers", "Secret Wars" e "Vietnam" com a capa do Vietnam)

- **Detectado em:** 2026-10-09, relato do dono
- **Origem:** a investigar (resolução de capa do catálogo, `browse:fetch-cover`, e o cache de capas em disco)
- **Errors (serviço):** N/A (local)
- **Classe:** ux
- **Versões:** observado na 2.12.110 (versão do `src/electron-app/package.json` na data)
- **Reincidência:** a conferir. Parente do bug fechado
  `docs/bugs/closed/electron-browse-capa-de-outro-jogo-quando-a-busca-cai-no-titulo-sem-a-marca_2026-09-26T11-24.md`
  (LEGO), que tratou outra rota (remoção de marca)

## Sintoma

Relato do dono: "Estamos com problemas de covers erradas no catálogo, por exemplo o desta imagem que eu anexei,
temos 3 jogos da mesma franquia mas diferentes, e a mesma capa é mostrada. Temos várias ocorrências dessa."

O print (catálogo Xbox 360 do Companion) mostra três cards — *Air Conflicts Pacific Carriers*, *Air Conflicts
Secret Wars* e *Air Conflicts Vietnam* — todos com a capa de *Air Conflicts: Vietnam*.

## Evidência

Coletada em 2026-10-09 na máquina do dono.

**1. Os nomes dos cards são os do catálogo HuggingFace.** `cache/hf_xbox360.json` tem exatamente
`Air Conflicts Pacific Carriers`, `Air Conflicts Secret Wars`, `Air Conflicts Vietnam` (sem região). O
Minerva (`cache/minerva_xbox360.json`) tem os mesmos jogos com outro nome: `Air Conflicts - Pacific Carriers
(Europe)`, `Air Conflicts - Secret Wars (USA)`, `Air Conflicts - Vietnam (USA, Europe)`. Nenhuma entrada de
catálogo traz URL de capa.

**2. Os TitleIDs certos existem no dataset empacotado** (`cache/title_id_datasets/gist_title_ids.json`):
`413307D6` *Air Conflicts: Pacific Carriers*, `4B5907E0` *Air Conflicts: Secret Wars*, `413307D9`
*Air Conflicts: Vietnam*.

**3. O XboxUnity devolve capas distintas e corretas para cada TitleID:**

```
curl -s http://xboxunity.net/api/Covers/413307D6  -> 4 itens, todos 413307D6, 1º boxartfront/4583
curl -s http://xboxunity.net/api/Covers/4B5907E0  -> 1 item,  4B5907E0, boxartfront/4787
curl -s http://xboxunity.net/api/Covers/413307D9  -> 4 itens, todos 413307D9, 1º boxartfront/5669
curl -s "http://xboxunity.net/api/Covers/Air%20Conflicts%20Pacific%20Carriers" -> 0 itens
```

md5 das imagens baixadas: `4583` = `b645a4c3…`, `4787` = `1326aafb…`, `5669` = `2f23739c…` (três imagens
diferentes).

**4. O cache de capas em disco** (`%APPDATA%\Xbox 360 Companion\cache\covers\`) tem as duas famílias de chave:

| arquivo | gravado em | md5 | conteúdo |
|---|---|---|---|
| `air_conflicts_pacific_carriers.jpg` | 2026-09-01 21:54 | `2f23739c…` | **capa do Vietnam** |
| `air_conflicts_secret_wars.jpg` | 2026-09-01 21:54 | `2f23739c…` | **capa do Vietnam** |
| `air_conflicts_vietnam.jpg` | 2026-09-01 21:54 | `2f23739c…` | capa do Vietnam (certa) |
| `air_conflicts_-_pacific_carriers.jpg` | 2026-10-09 20:39 | `b645a4c3…` | capa certa (= XboxUnity 4583) |
| `air_conflicts_-_secret_wars.jpg` | 2026-10-09 20:39 | `1326aafb…` | capa certa (= XboxUnity 4787) |
| `air_conflicts_-_vietnam.jpg` | 2026-10-09 20:39 | `2f23739c…` | capa certa (= XboxUnity 5669) |

As chaves sem `-` (nome HF) foram gravadas em 01/09 e estão erradas; as com `-` (nome Minerva) foram gravadas
hoje e estão certas.

**5. Ocorrências: 73 grupos de arquivos com bytes idênticos sob chaves diferentes** no mesmo cache (619
arquivos). Comando:

```
cd "$APPDATA/Xbox 360 Companion/cache/covers" && md5sum * | awk '{print $1}' | sort | uniq -c | awk '$1>1' | wc -l
-> 73
```

Parte dos grupos é legítima (o mesmo jogo com dois nomes: `gears_of_war` / `gears_of_war_1`,
`aliens_vs_predator` / `aliens_vs__predator`). Parte é visivelmente jogos diferentes com a mesma imagem, por
exemplo:

- 8: `assassins_creed_1`, `_2_goty`, `_3`, `_4_black_flag`, `_brotherhood`, `_ii`, `_revelations`, `_rogue`
- 6: `call_of_duty_-_black_ops`, `_advanced_warfare`, `_black_ops_1`, `_black_ops_2`, `_black_ops_3`, `_ghosts`
- 6: `army_of_two*` (1, 40th day, devil's cartel)
- 5: `minecraft`, `minecraft_-_story_mode_*` (3), `minecraft_-_xbox_360_edition`
- 4: `armored_core_4`, `_5`, `_for_answer`, `_verdict_day`
- 4: `air_conflicts_*` (acima)
- 3: `ace_combat_6_*`, `ace_combat_assault_horizon`; `battlefield_3`, `field___stream`, `field___stream_-_…`

Datas de gravação dos 619 arquivos: 233 em 01/09, 225 em 02/09, 59 em 03/09, o resto espalhado até 09/10.

A classificação de cada grupo (legítimo x errado) e a contagem exata dos errados ficam para a investigação.

## Causa raiz

**O cache de capas em disco do usuário não tem versão nem validade, e é lido antes de qualquer resolução.**
Capas gravadas por uma versão antiga do resolvedor (01–03/09) continuam servidas para sempre, mesmo depois
que o resolvedor passou a achar a capa certa.

A cadeia, aberta no código (2.12.110):

1. O card do catálogo pede a capa pelo nome exibido: `renderer/components/BrowsePage.tsx::LocalGameCard`
   (`:1119`), `openGame` (`:1417`) e `VersionSelectDialog` (`:1002`) → `preload.ts:93` → `browse:fetch-cover`.
2. `ipc/browseHandlers.ts::fetchCover` (`:180`): `base = baseTitleForCover(gameName)`; consulta o mapa em memória
   e **logo em seguida `getCachedCoverFromDisk(base)`** (`:188`). Achou arquivo → devolve, sem nenhuma busca.
   Só sem arquivo roda a cascata (XboxUnity → Microsoft Store → Wikipedia) e grava o resultado com
   `saveCoverToDisk(base, ...)` (`:251`). Em erro: `catch { return { ok: false } }` — card sem capa, nada gravado.
3. `services/coverArtService.ts::getCachedCoverFromDisk` (`:367`): chave = `base` com `[^a-zA-Z0-9_-]` → `_`,
   minúsculas. Procura `<chave>.jpg|.png` em `resources/cache/covers` (empacotado), `%APPDATA%\Xbox 360
   Companion\cache\covers` (`getDiskCoverCacheDir`) e nas pastas do repo. **Nenhuma checagem de data, versão ou
   origem.** O único descarte é `purgeCorruptedLegacyCoverCache` (`:346`): lista fixa de prefixos
   (`LEGACY_CORRUPTED_CACHE_PREFIXES`, só GTA e LEGO), aplicada uma vez por processo.
4. Para `Air Conflicts Pacific Carriers` (nome HF) a chave é `air_conflicts_pacific_carriers` → arquivo de
   01/09 com a imagem do Vietnam.

**Prova de que o resolvedor atual acerta e só o disco está errado** — script
`resolve_dupes.js` (scratchpad da sessão): para cada uma das 186 chaves dos 73 grupos de bytes idênticos,
acha o nome de catálogo que gera a chave e roda o `generateSearchCandidateEntries` + `fetchXboxUnityCoverWithMeta`
compilados da 2.12.110:

| desfecho com o código atual | chaves |
|---|---|
| resolvedor atual devolve **imagem diferente** da gravada em disco (disco velho) | **34** |
| resolvedor atual devolve a mesma imagem (grupo legítimo: mesmo jogo, dois nomes; ou a chave dona da imagem) | 77 |
| XboxUnity sem resposta para nenhum candidato | 63 |
| chave sem nome correspondente no catálogo local | 12 |

As 34 incluem `air_conflicts_pacific_carriers` → `413307D6`, `air_conflicts_secret_wars` → `4B5907E0`,
`armored_core_4/5/for_answer/verdict_day` → 4 TitleIDs distintos, `call_of_duty_black_ops_2/3`, `_ghosts`,
`_advanced_warfare` → 4 TitleIDs distintos, `assassins_creed_ii` / `_4_black_flag`.

Para as 63 sem XboxUnity, `resolve_fallback.js` rodou as etapas 2 e 3 do `fetchCover` atual: **48 ficam sem capa**,
13 recebem uma imagem da Wikipedia **diferente** da do disco, 2 recebem a mesma. Nenhuma reproduz hoje a capa de
franquia. Logo: as capas de franquia vieram de um resolvedor que não existe mais.

**Qual resolvedor gravou?** Não recuperável do git: `saveCoverToDisk` entrou no commit `ece2826`
(2026-09-02 11:35), e os 233 arquivos de 01/09 são anteriores — foram gravados por um build da árvore de trabalho
sem commit. O mecanismo exato importa pouco: qualquer erro de qualquer versão antiga fica congelado no disco do
cliente, e é isso que se corrige.

## Hipóteses descartadas

- **O resolvedor atual escolhe a capa errada** — descartado: os TitleIDs `413307D6`/`4B5907E0`/`413307D9` estão
  em `gist_title_ids.json`, vão para o topo dos candidatos e o XboxUnity devolve 3 imagens distintas (md5 acima);
  as chaves gravadas hoje (`air_conflicts_-_*`, nome Minerva) estão certas.
- **O XboxUnity tem a capa do Vietnam cadastrada no TitleID errado** — descartado: `api/Covers/413307D6` e
  `4B5907E0` devolvem só itens do próprio TitleID, com imagens diferentes da `5669`.
- **O catálogo traz URL de capa errada** — descartado: nenhuma entrada de `hf_xbox360.json`, `games.json` ou
  `minerva_xbox360.json` tem campo de capa; a capa é sempre resolvida pelo nome.
- **As capas empacotadas no instalador (`cache/covers` do repo → `resources/cache/covers`, lido primeiro)** —
  descartado: são 304 capas de mods (pt-br, patches); os 144 grupos repetidos são apelidos do mesmo mod
  (`x` / `x___xbox_360_rgh__`), nenhum par de jogos diferentes, e nenhuma das chaves erradas está lá.
- **Mesmo bug do LEGO (`stripBrands`)** — descartado: "Air Conflicts", "Armored Core", "Call of Duty" não têm
  prefixo de marca; aquele bug fechado também purgou só chaves LEGO/GTA por lista fixa.

## Correção planejada

**T1 — cache de capas versionado (corrige o sintoma em todo cliente).** Em
`services/coverArtService.ts::purgeCorruptedLegacyCoverCache`: trocar a lista fixa de prefixos por uma versão do
cache (`COVER_CACHE_VERSION`) gravada num marcador na pasta do usuário (`getDiskCoverCacheDir()`). Marcador
ausente ou diferente → apagar os `.jpg`/`.png` **só da pasta do usuário** (nunca `resources/cache/covers` nem
`cache/covers` do repo, que são as capas de mod empacotadas), gravar o marcador, limpar `browseCoverCache`.
Comentário no constante: mudança no resolvedor que altere capa já resolvida exige subir a versão.
Custo: na primeira abertura depois da atualização, cada card visível rebusca a capa (lazy, por
`useIntersectionObserver`).
Prova: teste unitário em `tests/unit/coverArtService.test.cjs` com `APPDATA` apontando para pasta temporária:
arquivo velho sem marcador → removido e marcador gravado; com marcador atual → preservado. Prova ponta a ponta:
app real com o cache do dono, os 3 cards Air Conflicts com capas distintas.

**T2 — lookup de TitleID com chave compacta (evita perda de capa causada pelo T1).** Com o disco limpo, 48 das
chaves erradas ficariam sem capa. Medido com `measure_lookup.js`: uma chave extra no `titleToIdMap` —
possessivo colado (`assassin's` → `assassins`), sem espaços, sem sufixo final ` 1`, sem
`GOTY`/`Game of the Year Edition`/`Special Edition`, `WW2` → `WWII` — dá TitleID a **17 das 63** sem XboxUnity
(ex.: `Assassins Creed 1` → `555307D4`, `Assassins_Creed_Rogue` → `555308CE`, `Batman Arkham City GOTY` →
`57520802`, `Call Of Duty Black Ops 1` → `41560855`). Onde: `indexTitleInMap` e `lookupTitleIds` em
`generateSearchCandidateEntries`. Cuidado: 175 de 5121 chaves compactas do dataset têm mais de um TitleID (regiões);
o comportamento atual já adiciona todos os IDs da chave — sem mudança nisso.
Prova: testes unitários com esses nomes → TitleID esperado em `candidates[0]`; e os testes existentes verdes.

## Tasks

| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | cache de capas em disco versionado; versao nova descarta as capas gravadas por resolvedores antigos | -- | -- | -- | -- |
| T2 | lookup de TitleID por chave compacta (possessivo, " 1", GOTY/edicoes, WW2) | -- | -- | -- | -- |

## Correção aplicada

Sem desvio do plano.

- **T1** (`cb80de1`) — `services/coverArtService.ts`: a lista fixa `LEGACY_CORRUPTED_CACHE_PREFIXES` saiu;
  `purgeCorruptedLegacyCoverCache` agora compara `COVER_CACHE_VERSION` (`"2"`) com o marcador
  `.cover-cache-version` na pasta do usuário. Diferente ou ausente → apaga os `.jpg/.jpeg/.png` **só dessa pasta**
  e grava o marcador; se algum arquivo não puder ser apagado (travado), não grava o marcador e tenta de novo no
  próximo início. Comentário no constante: mudança de resolvedor que troque capa já resolvida exige subir a versão.
  `resetCoverCachePurgeForTests` exposto para os testes.
  O arquivo de teste agora aponta `APPDATA` para uma pasta temporária: antes, `npm run test:safety` lia o cache real
  de quem roda a suíte, e com o T1 o apagaria.
- **T2** (`5ed966a`) — `compactTitleKey` (possessivo sem apóstrofo, `’`, `WW2`→`WWII`, sem `GOTY`/`Game of the Year
  Edition`/`Special Edition`, sem ` 1` final, sem `the` inicial, sem espaços, prefixo `~`), indexada em
  `indexTitleInMap` e consultada em `lookupTitleIds` **só quando nenhuma grafia exata casou**.

Efeito para o cliente: na primeira abertura da versão com o T1, o app descarta todas as capas do cache do usuário e
cada card visível rebusca a sua. As capas de mod empacotadas (`resources/cache/covers`) não são tocadas.

## Testes executados

- `node --test tests/unit/coverArtService.test.cjs` → 18/18. Testes novos: capa velha sem marcador é descartada
  (o arquivo exato do caso, `air_conflicts_pacific_carriers.jpg`), capa com marcador atual é servida; nomes
  `Assassins Creed 1`, `Assassin’s Creed [RF]`, `Assassins_Creed_Rogue`, `Batman Arkham City GOTY`,
  `Call Of Duty Black Ops 1`, `Grid 1`… → TitleID certo em `candidates[0]`; os 3 Air Conflicts com TitleIDs
  distintos; grafia exata vence a compacta.
- **Controle negativo** de cada task: com o descarte desligado no JS compilado, o teste do T1 falha (15/16); com
  `compactTitleKey` devolvendo `""`, o teste do T2 falha (17/18). Recompilado e verde de novo.
- `npm run test:safety` (tsc + typecheck do renderer + unit) → **299/299**.
- **Catálogo inteiro (T2)**: 8010 nomes Xbox 360 (`hf_xbox360`, `games`, `minerva_xbox360`, `xbox360`) — com
  TitleID: 4852 sem o T2 → **5147** com o T2 (+295). Amostra revisada à mão, todos o mesmo jogo (`Asuras Wrath` →
  `ASURA'S WRATH`, `Fallout 3 GOTY` → `Fallout 3`, `NHL 14` → `NHL14`, `Cabelas …` → `Cabela's …`). Só 3 nomes
  tiveram o 1º TitleID trocado, todos `Magna Carta 2`: da versão coreana (`4E4D0811`) para a americana
  (`4E4D080B`), o mesmo jogo.
- **Ponta a ponta no app real** (`e2e_covers.js`, scratchpad da sessão): Electron real (`main.js` compilado), via
  Playwright, com `APPDATA` e `PORTABLE_EXECUTABLE_DIR` isolados (não toca a instância aberta do dono), semeado com
  os 3 arquivos velhos copiados do cache do dono. As capas são pedidas por `window.godsendApi.browseFetchCover`, a
  mesma chamada do card:

  | | Pacific Carriers | Secret Wars | Vietnam |
  |---|---|---|---|
  | semeado (cache do dono, 01/09) | `2f23739c` | `2f23739c` | `2f23739c` |
  | **controle** (marcador já na versão 2 = sem descarte = comportamento antigo) | `2f23739c` ✗ | `2f23739c` ✗ | `2f23739c` |
  | **correção** (sem marcador, como o cliente que atualiza) | `b645a4c3` ✓ | `1326aafb` ✓ | `2f23739c` ✓ |

  O controle reproduz o print do dono; com a correção, as três são as do XboxUnity por TitleID (4583, 4787, 5669)
  e o cache é regravado com elas, mais o marcador `2`.
- **Não feito:** o print dos cards no catálogo. Na instância isolada o backend não sobe
  (`ECONNREFUSED 127.0.0.1:8080`, o dono já tem uma instância rodando), então a lista do catálogo não carrega. A
  chamada IPC acima é a mesma que o card faz.

## Pendente para fechar

- Publicar a versão (processo de release do `AGENTS.md`) e o dono abrir o app atualizado: os cards
  `Air Conflicts *`, `Armored Core *`, `Call of Duty *`, `Assassin's Creed *` com capas distintas.
- `verificacao:` — na máquina do dono, depois de abrir a versão nova:
  `cat "$APPDATA/Xbox 360 Companion/cache/covers/.cover-cache-version"` → `2`, e
  `md5sum "$APPDATA/Xbox 360 Companion/cache/covers/air_conflicts_pacific_carriers.jpg"` ≠ `2f23739c…`.
