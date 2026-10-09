# Bug: em "Jogos Instalados" a capa de um mod é a do jogo base, diferente da do catálogo e da Biblioteca Local

- **Detectado em:** 2026-10-09, relato do dono
- **Origem:** a investigar (resolução de capa da tela Jogos Instalados x catálogo / Biblioteca Local)
- **Errors (serviço):** N/A (local)
- **Classe:** ux
- **Versões:** a conferir
- **Reincidência:** a conferir

## Sintoma

Relato do dono: "No xboxcompanion as covers divergem. Por exemplo para o jogo EA FC 26 Legacy Edition é uma
cover no catálogo e na biblioteca local após instalado, porém outra completamente diferente em Jogos Instalados.
Em jogos instalados a cover é do FIFA 17. O EA FC 26 Legacy Edition é um mod do FIFA 17 e tem sua própria capa,
a qual não aparece em jogos instalados."

Complemento do dono: "isto deve ocorrer também para outros mods" — o caso do EA FC 26 é um exemplo; a correção
tem de valer para qualquer release cujo TitleID seja o de outro jogo.

## Evidência

1. Pasta instalada `E:\Games\EA FC 26 Legacy Edition - 454109F4\` (mesmo job documentado em
   `pipeline-jogo-com-gravacao-interrompida-aparece-como-instalado-e-baixado_2026-10-09T19-30.md`): o nome
   da release é "EA FC 26 Legacy Edition", mas o TitleID gravado no nome da pasta é `454109F4`.
2. Relato do dono (sem print desta vez): catálogo e Biblioteca Local mostram a capa própria do mod; Jogos
   Instalados mostra a capa do FIFA 17.

## Causa raiz

As três telas pedem a capa ao mesmo IPC, `browse:fetch-cover` (`src/electron-app/ipc/browseHandlers.ts`), mas
com **chaves diferentes**:

- Catálogo e Biblioteca Local: `renderer/components/BrowsePage.tsx::LocalGameCard` e `::openGame` chamam
  `browseFetchCover(name)` — o nome da release ("EA FC 26 Legacy Edition").
- Jogos Instalados: `renderer/components/UsbGamesPage.tsx::InstalledGameCard` chama
  `browseFetchCover(game.titleId)` **primeiro** e só cai para `game.name` se não vier imagem.

No handler, o passo 0 é `coverArtService.ts::fetchCustomCover(base)`, que procura a chave em
`CUSTOM_COVER_URLS` (embutido + `cache/custom_covers.json`). Essa tabela é indexada **pelo nome normalizado**
(`normalizeTitleKey`) — é onde vivem as capas próprias de mods/traduções. Com a chave `454109F4` o passo 0
não acha nada, e os passos 1-3 (XboxUnity → catálogo Xbox pelo TitleID) devolvem a capa do jogo base, FIFA 17.
Como veio imagem, o fallback por nome nunca roda. O cache (memória `browseCoverCache` + disco) guarda o
resultado sob a chave `454109F4`, então fica assim para sempre.

Vale para **qualquer mod**: todo mod roda com o TitleID do jogo base (é o executável dele), e
`cache/custom_covers.json` tem hoje 386 chaves (`python -c "import json;print(len(json.load(open('cache/custom_covers.json',encoding='utf-8'))))"`
→ `386`: traduções PT-BR, dublagens, mods como "007 Goldeneye Classico", "Alien Isolation + Dublagem PT BR + DLC").
Todos esses caem na capa do jogo base em Jogos Instalados.

`localCoverUrl` (arquivo `cover.jpg`/`folder.jpg`... na pasta do jogo, `localGameScannerService.ts::findLocalCoverDataUrl`)
tem precedência sobre os dois e não está envolvido: `E:\Games\EA FC 26 Legacy Edition - 454109F4\` não tem
nenhum desses arquivos (`ls` da pasta).

## Hipóteses descartadas

- **Trocar a ordem para nome primeiro, TitleID depois**: igualaria as telas, mas pioraria jogos comuns. O nome
  em Jogos Instalados vem da pasta e pode ser nome de cena ou placeholder; o TitleID é a chave exata para
  jogo não modificado. O que diferencia o mod é ter capa própria cadastrada, não o nome.
- **Gravar a capa do mod na pasta do jogo** (para cair em `localCoverUrl`): exige mexer no pipeline de
  instalação e não corrige jogos já instalados.

## Correção planejada

1. `services/coverArtService.ts`: exportar `hasCustomCover(name)` — mesma consulta de `fetchCustomCover`
   (chave normalizada ou bruta, também por `baseTitleForCover`), sem baixar nada.
2. `ipc/browseHandlers.ts`: extrair o corpo de `browse:fetch-cover` para uma função local `fetchCover(gameName)`
   (comportamento idêntico) e criar `browse:fetch-installed-cover({ name, titleId })`:
   nome com capa própria → `fetchCover(name)`; senão `fetchCover(titleId)`; sem imagem → `fetchCover(name)`.
3. `preload.ts`: expor `browseFetchInstalledCover`.
4. `UsbGamesPage.tsx::InstalledGameCard`: usar o novo IPC no lugar das duas chamadas.

Limitação aceita: nome de pasta cortado em 42 caracteres (FATX) pode não bater com a chave do mod; aí o
comportamento é o de hoje (capa do jogo base).

Prova: teste em `tests/unit/browseHandlers.test.cjs` — `{ name: "EA FC 26 Legacy Edition", titleId: "454109F4" }`
devolve a capa custom e nunca consulta o TitleID; `{ name: "Halo 3", titleId: "4D5307E6" }` (sem capa própria)
consulta o TitleID primeiro. Mais `npm run test:safety` e conferência na UI de Jogos Instalados.

## Tasks
| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | Jogos Instalados usa a capa própria do mod (por nome) antes da capa do TitleID | -- | -- | -- | -- |
