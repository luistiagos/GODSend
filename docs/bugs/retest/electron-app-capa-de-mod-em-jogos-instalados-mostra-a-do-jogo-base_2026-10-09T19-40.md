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

## Correção aplicada

Conforme o plano, sem desvio (commit `37a9385`, T1):

- `coverArtService.ts::hasCustomCover` — consulta `CUSTOM_COVER_URLS` pelo nome (e pelo título-base), sem baixar.
- `browseHandlers.ts`: corpo de `browse:fetch-cover` virou a função local `fetchCover` (mesmo comportamento);
  novo `browse:fetch-installed-cover({ name, titleId })`: capa própria por nome → TitleID → nome.
- `preload.ts::browseFetchInstalledCover` e `UsbGamesPage.tsx::InstalledGameCard` passam a usá-lo.

O cache de capa continua por chave: a entrada antiga `454109F4` (FIFA 17) segue existindo, mas a tela não a
consulta mais para nome com capa própria — não é preciso limpar o cache do cliente.

## Testes executados

- `node --test tests/unit/browseHandlers.test.cjs tests/unit/coverArtService.test.cjs` → 23/23. Os novos:
  mod devolve a capa custom e a **única** chave consultada é o nome; jogo sem capa própria consulta só o
  TitleID; TitleID sem capa cai para o nome; `hasCustomCover("454109F4") === false`.
- Controle negativo: com a condição `hasCustomCover` trocada por `false` no `ipc/browseHandlers.js` compilado,
  o teste do mod falha (`pass 8 / fail 1`); recompilado, volta a passar.
- `npm run test:safety` (tsc + typecheck do renderer + unit) → 295/295. Uma execução anterior deu 3 falhas em
  `localGameScannerService` porque outra sessão commitou `d27d796` no scanner durante a corrida; repetida, 0 falhas.
- Rede real, handlers reais registrados no Electron, cache de capa vazio (`APPDATA` temporário), hash SHA-1 do dataUrl:

  | chamada | hash |
  |---|---|
  | `fetch-cover("EA FC 26 Legacy Edition")` (catálogo / Biblioteca Local) | `557b78e5c4ea` |
  | `fetch-cover("454109F4")` (o que Jogos Instalados mostrava) | `2fdd4489c3dc` |
  | `fetch-installed-cover({EA FC 26 Legacy Edition, 454109F4})` (novo) | `557b78e5c4ea` |
  | `fetch-installed-cover({Halo 3, 4D5307E6})` / `fetch-cover("4D5307E6")` | `7864637d18c2` / `7864637d18c2` |

Pendente para o `done/`: o dono abrir Jogos Instalados num build com o commit e ver a capa do mod no card
`E:\Games\EA FC 26 Legacy Edition - 454109F4`.
