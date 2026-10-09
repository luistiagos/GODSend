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
- Falta: abrir o catálogo no app e conferir que o número ficou **maior** que 2731 (contraprova: um jogo com
  várias regiões, ao ser filtrado, tem tantas versões quantas o número passou a somar).
