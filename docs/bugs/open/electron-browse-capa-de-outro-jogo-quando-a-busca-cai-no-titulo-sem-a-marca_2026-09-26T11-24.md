# Bug: o catálogo mostra a capa de outro jogo quando a busca de capa cai no título sem a marca ("LEGO The Lord of the Rings" aparece com a capa de "War in the North")

- **Detectado em:** 2026-09-26 11:24 (chamado #85 do painel, sessão `232224620290076@lid`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/services/coverArtService.ts::generateSearchCandidates` e `src/electron-app/ipc/browseHandlers.ts` (`browse:fetch-cover`) + reprodução contra a API real do XboxUnity
- **Classe:** falha funcional (UI do catálogo)
- **Severidade:** **P3 - Baixo** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)). O download segue o título, não a capa, então nada é gravado errado. A capa só induz a escolha: no #85 o cliente queria o War in the North e quase baixou o LEGO (5,58 GB) por causa dela. Não é P2 porque o app entrega exatamente o que o cliente seleciona
- **Complexidade:** baixa — a decisão está numa função, e o comportamento é reproduzível sem console
- **Reincidência:** primeira vez. As correções de capa anteriores (`CHANGELOG.md`, "Resolução e Busca de Capas de Jogos Populares") trataram numerais e a franquia GTA, não a remoção de marca

## Sintoma, na ordem que o cliente viveu

`[109329]` 15/09 01:20:58, com o catálogo do Companion aberto:

> *"Uma coisa que percebi o jogo ta com o nome como LEGO the lord of the ring, e a capa ta o jogo guerra do norte (o que quero ) eu considero o jogo da foto ou o que ta escrito"*

O agente respondeu certo (`[109330]`): vale o título, não a capa. O cliente procurou pelo nome e baixou
o War in the North, que rodou no console (`[109809]`).

## Evidência

**A cadeia, aberta no código:**

1. O card do catálogo pede a capa pelo nome exibido: `BrowsePage.tsx:1119` (`LocalGameCard`) e
   `:1002` (`VersionSelectDialog`) → `browse:fetch-cover`.
2. `browseHandlers.ts:192` gera os candidatos com `generateSearchCandidates(gameName)`, e o laço de
   `:197-208` usa **o primeiro candidato para o qual o XboxUnity devolve alguma capa** (`break`).
3. Em `coverArtService.ts`, para `LEGO The Lord of the Rings (USA, Europe) (En,Fr,...)`:
   - `cleanTitleForSearch` (`:303-309`) → `LEGO The Lord of the Rings`;
   - a busca de TitleID local por nome normalizado (`:342-346`) procura `lego the lord of the rings`. Os
     datasets empacotados (`cache/title_id_datasets/gist_title_ids.json` e `xboxdb_browse_pairs.json`,
     que vão para `resources/cache` pelo `extraResources`) só têm **`LEGO Lord of the Rings`** (`5752081D`),
     sem o "The". Nenhum TitleID é achado;
   - `stripBrands` (`:467-473`) acrescenta como último candidato `The Lord of the Rings`.
4. `fetchXboxUnityCoverWithMeta` (`:505-533`) filtra com `isValidUnityCoverMatch` (`:483-503`), que só
   tem guardas de numeral e de GTA. Não há guarda para o termo que foi removido da busca.
5. `browseHandlers.ts:241` grava a capa em disco com a chave do título (`saveCoverToDisk`), então a capa
   errada persiste entre sessões.

**Reproduzido contra o XboxUnity real** (`http://xboxunity.net/api/Covers/<termo>`, 2026-09-26):

| termo buscado | resposta |
|---|---|
| `LEGO The Lord of the Rings` | **0 itens** |
| `The Lord of the Rings` (o candidato sem a marca) | 15 itens, **todos** `575207EF` *The Lord of the Rings: War in the North*; o primeiro oficial tem rating 5 |
| `lego lord of the rings` | 20 itens, todos `5752081D` *LEGO Lord of the Rings* (o certo) |

A entrada de HuggingFace, com o nome `lego lord of the rings`, não sofre o problema: o nome normalizado
bate com o dataset e o TitleID certo vai para o topo dos candidatos. O defeito aparece na entrada cujo
nome tem o artigo, `LEGO The Lord of the Rings (USA, Europe) (...)` (`cache/xbox360.json`), que é o nome que o
cliente leu.

**A tela de jogos instalados herda o erro.** `UsbGamesPage.tsx:89-93` pede a capa pelo nome e só tenta o
TitleID da pasta se o nome falhar. Como o nome "acerta" com a capa errada, o TitleID certo (`5752081D`) nunca
é consultado.

## Alcance

Um script reproduz `generateSearchCandidates` (datasets empacotados, numerais e `stripBrands`) e a etapa
XboxUnity de `browse:fetch-cover` para os 53 nomes de catálogo que começam com "LEGO" (`cache/xbox360.json` +
`cache/hf_xbox360.json`), consultando a API real em 2026-09-26. Os 53 nomes são **42 títulos distintos**
depois de `cleanTitleForSearch`. A medição rodou com **0 erros de rede**.

| desfecho | títulos |
|---|---|
| TitleID achado no dataset local → capa certa | 15 |
| XboxUnity respondeu ao nome com a marca → capa certa | 1 |
| **XboxUnity respondeu só ao nome sem a marca → capa de outro jogo** | **2** |
| XboxUnity não respondeu a nenhum candidato → a cascata segue para Microsoft Store e Wikipedia (não medido) | 24 |

| título do catálogo | candidato que respondeu | capa exibida |
|---|---|---|
| `LEGO The Lord of the Rings` | `The Lord of the Rings` | The Lord of the Rings: War in the North (`575207EF`) |
| `LEGO Marvel Avengers` | `Marvel Avengers` | Marvel Avengers: Battle for Earth (`555308AD`) |

As 24 que caem nas etapas seguintes também passam pelo candidato sem a marca (`browseHandlers.ts:212-227`
percorre a mesma lista). Se a Microsoft Store ou a Wikipedia devolverem outro jogo, o erro é o mesmo, mas isso
não foi medido.

A mesma lista de marcas também remove "Disney", "Marvel", "Tom Clancy's", "EA Sports", "Peter Jackson's",
"Sid Meier's" e "James Bond". Esses prefixos não foram medidos.

## Causa raiz

`generateSearchCandidates` acrescenta o título **sem a marca** como candidato de busca textual, e
`browse:fetch-cover` aceita a primeira resposta do XboxUnity sem conferir que ela ainda é o mesmo jogo. Quando
o título completo não tem TitleID local nem resposta no XboxUnity, o título sem a marca é um nome de
franquia, e a API devolve o jogo mais conhecido dela.

## Escopo — o que NÃO é este bug

- **Não é** download errado: o arquivo baixado segue o título do catálogo (o cliente baixou o War in the North
  pelo nome e ele rodou).
- **Não é** o "LEGO Lord of the Rings" de HuggingFace, cuja capa é resolvida pelo TitleID certo.
- **Não é** a correção de GTA/numerais já existente (`isValidUnityCoverMatch`, guardas de `v/5`, `iv/4` etc.).

## Tarefas propostas / Próximos passos

1. **Não aceitar a capa vinda do candidato sem marca quando o jogo devolvido não traz a marca.** Em
   `isValidUnityCoverMatch` (ou no laço de `browse:fetch-cover`), se o candidato veio de `stripBrands`,
   exigir que o `name` devolvido contenha a marca removida. Teste unitário com os dois casos medidos acima,
   usando a resposta do XboxUnity gravada como fixture.
2. **Normalizar o artigo na busca de TitleID local** (`the`, `a`), para que `LEGO The Lord of the Rings`
   case com `LEGO Lord of the Rings` e o TitleID certo vá para o topo dos candidatos.
3. **`UsbGamesPage`: preferir o TitleID da pasta ao nome**, quando houver. É o dado exato; o nome é palpite.
4. **Purgar do cache em disco as capas gravadas com chave afetada**, como `purgeCorruptedLegacyCoverCache`
   já faz para GTA, senão a capa errada continua para quem já abriu o catálogo.
5. Estender a medição aos outros prefixos de `stripBrands` antes de fechar.
