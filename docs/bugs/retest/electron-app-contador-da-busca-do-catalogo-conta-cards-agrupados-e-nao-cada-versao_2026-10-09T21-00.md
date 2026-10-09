# Bug: o contador "Filtrar N títulos…" do catálogo conta os cards agrupados, não cada versão do jogo

- **Detectado em:** 2026-10-09, relato do dono
- **Origem:** `src/electron-app/renderer/components/BrowsePage.tsx` (barra de busca do catálogo)
- **Errors (serviço):** N/A (local)
- **Classe:** ux
- **Versões:** 2.12.110 e anteriores
- **Reincidência:** não

## Sintoma

A barra de busca do catálogo mostra "Filtrar 2731 títulos…". O dono perguntou se o número conta os jogos
agrupados ou cada jogo, porque um título com várias regiões (EU, JP, USA) aparece num card só e o usuário
escolhe a região depois de clicar. O número conta os cards agrupados. O dono quer que ele conte sempre o total,
sem considerar o agrupamento.

## Causa raiz

- `BrowsePage.tsx::groupedGames` junta os nomes do catálogo pela chave `getComparisonKey(getBaseTitle(nome))`.
  `getBaseTitle` tira todo grupo `(...)` e `[...]`, então "X (USA)", "X (Europe)" e "X (Japan)" viram um único
  `CatalogGameItem`. Cada região vira um item em `releases`, e cada disco um item em `release.discs`.
- `uniqueBaseTitles` é `Array.from(groupedGames.values())`, ou seja, um item por card.
- O placeholder usava `uniqueBaseTitles.length`, por isso um jogo com três regiões contava 1.

## Hipóteses descartadas

- **Contar `games.length`, o total de nomes brutos do catálogo:** descartado. Um lançamento de vários discos
  tem uma linha por disco, e um jogo de 2 discos contaria 2, mas é um único download e uma única escolha na tela.

## Correção aplicada

- Novo `totalReleases` (`useMemo`) em `BrowsePage.tsx`, que soma `item.releases.length` de todos os grupos. O
  placeholder passa a usar esse valor. Cada região ou versão conta 1, e um lançamento de vários discos conta 1.
- A lista de cards, o agrupamento e o filtro não mudam.
- O `CHANGELOG.md` registra a mudança em `[Unreleased]`.

## Testes executados

- `npx tsc --noEmit -p .` em `src/electron-app`: sem erros.
- `npx tsc --noEmit -p renderer/tsconfig.json`: sem erros.
- Contagem medida no backend que está rodando (`127.0.0.1:8082`), Xbox 360, aplicando o mesmo
  `getBaseTitle`/`getComparisonKey` do `BrowsePage.tsx` sobre `/browse` e o agrupamento de discos de `/browse/releases`:

  | Provedores no `/browse` (`priority`) | Nomes brutos | Cards agrupados (contagem antiga) | Versões (contagem nova) |
  |---|---|---|---|
  | `huggingface,ia,minerva` (padrão) | 3114 | 2731 | 3027 |
  | `ia,minerva` | 2194 | 1957 | **2107** |

- O app aberto pelo dono mostrou **"Filtrar 2107 títulos…"**. Esse é o valor novo com `ia,minerva`, em que a
  contagem antiga daria 1957. Ou seja, o app já usava a correção (o bundle `renderer-dist/assets/index-7G1dg0Nx.js`
  contém `releases.length,0`). O dono achou que nada tinha mudado porque o número caiu em relação aos 2731 do
  primeiro print. Ele caiu porque, nessa carga, o catálogo do HuggingFace não entrou na lista. Com os três
  provedores, o valor esperado é 3027.
- Falta: recarregar o catálogo do Xbox 360 com os três provedores e conferir **3027**.
