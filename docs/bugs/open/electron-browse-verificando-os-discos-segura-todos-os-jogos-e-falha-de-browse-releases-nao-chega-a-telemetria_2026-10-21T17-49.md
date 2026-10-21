# Bug: "Verificando os discos deste jogo…" fica girando em todos os jogos e o cliente não consegue adicionar à fila; a falha não chega à telemetria

- **Detectado em:** 2026-10-21 17:49 (análise da sessão de WhatsApp `32822140117221@lid`, telefone `5513974048946`)
- **Origem:** `xbox-360-companion/electron-renderer` + `electron-main` —
  `src/electron-app/renderer/components/BrowsePage.tsx::loadDiscMembership` → IPC `browse:get-release-groups`
  (`src/electron-app/ipc/browseHandlers.ts`) → `GET /browse/releases` (`src/server/interfaces/http/handlers.go::handleBrowseReleases`)
- **Errors (serviço):** nenhum (ver Evidência: a falha desse IPC só vai para o log local)
- **Classe:** ux / fail
- **Severidade:** **P2 — Médio** (provisória): bloqueia o botão "Adicionar à fila" de todos os jogos enquanto dura; não
  se sabe ainda se para sozinho em 120 s ou se o cliente ficou preso.
- **Complexidade:** média (handler Go + IPC + estado da tela)
- **Versões:** cliente provavelmente na 2.12.110 (versão não aparece na conversa); o código atual tem o mesmo fluxo.
- **Reincidência:** primeira vez registrado.

## Sintoma

Horários em UTC. O cliente tinha acabado de preparar um HD novo (Seagate, *"D: — BADAVATAR · 880.4 GB livres"*) — ver
[[badavatar-hd-preparado-em-modo-bloqueado-acusado-como-rgh-depois-de-usado-no-console_2026-10-21T17-49]].

1. **21/10 19:46:11** ([150485]): *"Não aparece mais o arquivo pra baixar"* + print do jogo "0-D Beat Drop", destino
   "Pendrive (USB)", e o botão azul *"Verificando os discos deste jogo..."*.
2. **21/10 19:48:18** ([150489]): *"Não vai"* + print de outro jogo ("007 Blood Stone") com a mesma mensagem.
3. O cliente não voltou a escrever depois disso (última mensagem é do agente, [150490], 19:48:37).

## Evidência

- Conversa lida inteira pela skill `sessao-whatsapp`; ids acima são de `Wpp_proccess`.
- **O que o código faz hoje** (observado, não é causa provada):
  - `BrowsePage.tsx:679` mostra o texto enquanto `discInfoState === "loading"`; o botão fica desabilitado
    (`disabled={… || discInfoState !== "ready" …}`, linha 673).
  - O estado é **um só para o catálogo inteiro**: `loadDiscMembership` roda uma vez por carga do catálogo
    (`loadGames`, linha 1328, sem `await`), não por jogo. Por isso todo jogo aberto mostra o mesmo spinner.
  - O IPC `browse:get-release-groups` usa `backendGet`, com timeout de 120 s (`infrastructure/backendHttp.ts:55`). Ao
    estourar ou falhar, devolve `{ ok: false }` e a tela vai para "Discos não verificados" com botão de tentar de novo.
  - Na falha, o handler só chama `appendAppEvent("BROWSE", …)` (`browseHandlers.ts:100-103`) — **sem `reportError`**,
    ao contrário do `browse:get-games` logo acima, que reporta. Por isso não há linha na telemetria para medir.
- Consulta à telemetria no período (`errors` com `project LIKE '%xbox%'`, 20/10 20:00 → 21/10 20:30): 33 linhas, nenhuma
  de `browse:get-release-groups` — esperado, dado o item acima.

## Causa raiz

_Pendente (passada 2)._ Perguntas a responder com prova: por que `/browse/releases` demorou (o `companionCatalog`
estava esperando o cache do catálogo, a varredura de unidades, outra coisa?) e se a tela chegou a sair do "loading" em
120 s.

## Como reproduzir

_Pendente._

## Critérios para fechar

- [ ] Reprodução confirmada e compreendida
- [ ] Causa raiz isolada e corrigida
- [ ] Falha de `browse:get-release-groups` reportada à telemetria
- [ ] Teste automatizado cobrindo o caso
