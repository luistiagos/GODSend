# Bug: DLCs instaladas pelo Companion nao aparecem/ativam no jogo (launch.ini sem contpatch, pipeline para no 1o STFS e scanner exibe pasta 00000002 como jogo duplicado de 0.1 MB)

- **Detectado em:** 2026-11-18 10:00 (chamado #393 do painel, `elberoliveiradossantos@gmail.com`, `MPOrder #188701945791`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/infrastructure/readyToPlayConfiguration.ts::generateReadyToPlayLaunchIni`, `src/server/services/pipeline/digital.go::ProcessDigitalWithErr`, `src/server/services/pipeline/minerva.go::ProcessMinervaDigitalWithErr` e `src/electron-app/services/localGameScannerService.ts::parseContentTitleFolder`
- **Errors (serviço):** N/A (falha silenciosa de entrega/ativacao no console e UX enganosa na lista de jogos instalados)
- **Classe:** fail / ux
- **Severidade:** **P1 — Alto** (matriz de `bug-triage.md`: bloqueia entrega/funcionamento da plataforma `DLC` no Xbox 360 preparado pelo app)
- **Complexidade:** **media** (`docs/bugs/open/README.md` — ajuste em `readyToPlayConfiguration.ts` com bump de `READY_TO_PLAY_CONFIGURATION_VERSION`, ajuste no pipeline Go de `digital.go`/`minerva.go` e filtro no scanner `localGameScannerService.ts`)
- **Versões:** observado em `2026-11-16`/`2026-11-17` (antes da `v2.12.130`); todos os pontos de codigo permanecem identicos no `HEAD` atual (`v2.12.130`)
- **Reincidência:** primeira vez registrado

## Sintoma

No chamado `#393` (`2026-11-16` a `2026-11-17`), o cliente instalou `Call of Duty: Black Ops II` (`7.50 GB`, XEX em `E:\games`, unidade preparada `E: (BADAVATAR)`) pelo Xbox 360 Companion e depois baixou DLCs separadas pela aba `DLC` do catalogo (`[184883]`, `[184888]`, `[185425]`):

1. Na tela **Jogos Instalados** do Companion (`[185427]`, `2026-11-16T23:26Z`), passaram a aparecer **dois** cards de `Call of Duty: Black Ops II` com `415608C3 E: (BADAVATAR)`: um com `7.50 GB` (o jogo) e outro com **`0.1 MB`**.
2. No Xbox 360, ao abrir o modo Zombies de `Call of Duty: Black Ops II`, continuava aparecendo apenas a fase padrao, sem nenhuma DLC:
   - `[185413]`: *"Não tem nada só tem uma fase"*
   - `[185781]`: *"A DLS do jogo não tá vindo e se eu baixo ela não fica no jogo"*
   - `[185787]`: *"Só um"*

## Evidência

- **Conversa (`Wpp_proccess`, chamado `#393`):** `[184880]`, `[184883]`, `[184885]`, `[184888]`, `[185408]`, `[185413]`, `[185415]`, `[185425]`, `[185427]`, `[185781]`, `[185787]`.
- **Codigo lido (`HEAD` `v2.12.130`):**
  - `src/electron-app/infrastructure/readyToPlayConfiguration.ts::generateReadyToPlayLaunchIni` (L15-29) e `src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs` (L17-22).
  - `src/electron-app/assets/badavatar-1.3/apps/dash_launch_v3.21/info_launch.ini` (L105-115).
  - `src/server/services/pipeline/digital.go::ProcessDigitalWithErr` (L301-398, walk L341-358).
  - `src/server/services/pipeline/minerva.go::ProcessMinervaDigitalWithErr` (L278-366, walk L309-326).
  - `src/electron-app/services/localGameScannerService.ts::scanContentDirectory` / `parseContentTitleFolder` (L41-49, L515-615, L754-858).
  - `cache/minerva_dlc.json`, `cache/dlc.json` e `cache/digital.json` (entradas de `Call of Duty - Black Ops II`).

## Causa raiz

Tres defeitos no fluxo de DLCs do `HEAD` (`v2.12.130`):

1. **`launch.ini` gerado pelo app nao habilita `contpatch` / `licpatch` (nem `xblapatch`):**
   `generateReadyToPlayLaunchIni()` (`readyToPlayConfiguration.ts:15-29`) gera `launch.ini` (gravado no preparo BadAvatar e RGH por `fixedBadAvatarPreparationService.ts:722`) apenas com:
   ```ini
   [Settings]
   noupdater = true
   liveblock = true
   livestrong = false
   ```
   Conforme a propria documentacao do DashLaunch embarcada no repo (`info_launch.ini:105-115`), `contpatch` (*"header license bits will be patched for addon content (00000002 type content)"*), `xblapatch` (`000D0000`) e `licpatch` tem padrao **`FALSE`** quando ausentes. Sem `contpatch = true` (e `licpatch = true`), pacotes `LIVE`/`PIRS` de DLC em `Content/0000000000000000/<TitleID>/00000002/` permanecem bloqueados pelo checagem de licenca no console.
2. **Pipeline de DLC/Digital para no primeiro container STFS e mistura passes/TUs sem aviso:**
   `ProcessDigitalWithErr` (`digital.go:341-358`) e `ProcessMinervaDigitalWithErr` (`minerva.go:309-326`) percorrem `extDir` com `filepath.Walk` e retornam `io.EOF` ao encontrar o **primeiro** arquivo com header Xbox valido (`helpers.ParseXboxHeader`). Se o pacote baixado contiver multiplos arquivos de DLC (ex.: `Call of Duty Black Ops II (World) (415608C3) (Addon).zip` em `minerva_dlc.json`/`digital.json`), apenas o primeiro container e copiado. Alem disso, a aba `DLC` (`BrowsePage.tsx:21`) lista itens como `Call of Duty - Black Ops II - Season Pass (World) (Addon)` (entitlement ~0.1 MB sem arquivos de mapa) e `Call of Duty - Black Ops II - TU 18 (World) (Addon)` sem distinguir tipo ou tamanho real.
3. **Scanner local exibe pastas apenas-DLC (`00000002`) como card duplicado de jogo (`0.1 MB`):**
   `localGameScannerService.ts` inclui `"00000002"` (`Digital Game / Extracted Content / DLC`, L44) em `KNOWN_CONTENT_TYPES` e `parseContentTitleFolder` (L544-615) transforma qualquer `Content/0000000000000000/<TID>/00000002/` em um card `format: "god"` em **Jogos Instalados**, sem verificar se e um pacote jogavel (`00007000` / `000D0000`) nem deduplicar por `titleId` contra `games/` (`seenPaths` em `scanUsbAndLocalGames`, L769, compara apenas caminhos). Isso produziu o segundo card `Call of Duty: Black Ops II` de `0.1 MB` no print `[185427]`.

*Nota sobre lacuna de observacao:* nao ha logs locais do PC nem listagem da arvore `E:\Content` do cliente do chamado `#393`; nao e possivel confirmar qual item exato da lista `DLC` ele selecionou (ex.: `Season Pass` de ~0.1 MB vs pack de mapas vs `(415608C3) (Addon)`), mas todos os tres defeitos acima existem no codigo atual.

## Como reproduzir

1. Preparar um pendrive via Companion (`fixedBadAvatarPreparationService.ts` -> `generateReadyToPlayLaunchIni`) e inspecionar `launch.ini` na raiz: `contpatch = true` e `licpatch = true` estao ausentes.
2. Enfileirar pela aba **DLC** para o pendrive um pacote com multiplos containers STFS ou o item `Call of Duty - Black Ops II - Season Pass (World) (Addon)` (`0.1 MB`), ja tendo o jogo base em `games/`.
3. Abrir **Jogos Instalados** (`scanUsbAndLocalGames`): o mesmo `TitleID` `415608C3` aparece duplicado (card do jogo base + card `"god"` de `0.1 MB` vindo de `Content/0000000000000000/415608C3/00000002/`).
4. Testar DLCs `00000002` `LIVE`/`PIRS` no console com o `launch.ini` gerado: sem `contpatch = true`, o jogo nao reconhece/desbloqueia as DLCs.

## Escopo — o que NAO e este bug

- O erro paralelo do mesmo chamado `#393` com `pes 2018_2023 _ atualização patch onfire v4.2 março 2023.zip` (`[185160]`–`[185393]`) ja foi resolvido no commit `4444a1c` (`v2.12.130`), que bloqueou esse arquivo em `knownBadHuggingFaceFiles` e o removeu de `hf_xbox360.json`.

## Resolução (v2.12.131 / Unreleased)

1. **`readyToPlayConfiguration.ts` (`generateReadyToPlayLaunchIni`):** adicionados `contpatch = true`, `xblapatch = true` e `licpatch = true` em `[Settings]` do `launch.ini`, com bump obrigatório de `READY_TO_PLAY_CONFIGURATION_VERSION` de `"5"` para `"6"`.
2. **`digital.go` / `minerva.go` (`collectDigitalContentPackages`, `deliverDigitalContent`, `ProcessDigitalWithErr`, `ProcessMinervaDigitalWithErr`):** removida a interrupção prematura com `io.EOF` no primeiro STFS válido. Todo container STFS válido em `extDir` agora é coletado com seu próprio `TitleID` e `typeDir` (`00000002` para DLCs, `000B0000` para Title Updates, etc.) e instalado no destino (FTP com progresso agregado, dispositivo local com verificação prévia de espaço combinado em `ensureDigitalContentFitsLocal`, ou empacotado via `type=content` no modo manual quando há múltiplos arquivos).
3. **`localGameScannerService.ts` (`parseContentTitleFolder`):** introduzido `PLAYABLE_CONTENT_TYPES` (`00007000`, `000D0000`, `00005000`, `00004000`, `00080000`, `00020000`) para que `scanContentDirectory` exija pelo menos uma subpasta de título jogável, impedindo que pastas apenas de DLC (`00000002`), Title Update (`000B0000`), saves (`00000001`) ou cookies (`00040000`) apareçam como card duplicado de jogo `"god"` (ex.: `0.1 MB`).

## Testes Automatizados

- `src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs`: atualizado para `v6` e adicionado teste garantindo `contpatch = true`, `xblapatch = true` e `licpatch = true` em `[Settings]`.
- `src/electron-app/tests/unit/localGameScannerService.test.cjs`: ajustado o teste do marcador `.xbox-companion-installing` em `Content/` para incluir pasta `00007000` e adicionado teste comprovando que pastas apenas de `00000002` (DLC), `000B0000` (TU) e `00040000` não são listadas como jogos, preservando `000D0000` (XBLA).
- `src/server/services/pipeline/digital_content_test.go`: adicionados testes cobrindo coleta multi-STFS (`00000002` + `000B0000`), entrega local completa via `extractArchiveResilient` + `deliverDigitalContent`, empacotamento manual (`type=raw` para 1 pacote vs `type=content` zipado para múltiplos) e checagem de espaço combinado antes da gravação.

## Critérios para fechar

- [x] `generateReadyToPlayLaunchIni` inclui `contpatch = true`, `xblapatch = true` e `licpatch = true` com bump de `READY_TO_PLAY_CONFIGURATION_VERSION` (`"6"`)
- [x] `ProcessDigitalWithErr` e `ProcessMinervaDigitalWithErr` instalam todos os arquivos STFS validos do pacote (sem descartar apos o 1o)
- [x] `scanContentDirectory` nao cria card duplicado de jogo `"god"` para pastas apenas de DLC/TU (`00000002` / `000B0000`)
- [x] `npm run test:safety --prefix src/electron-app` e `go -C src/server test -count=1 ./...` aprovados
- [ ] Validação em console real com DLC `LIVE`/`PIRS` (movido para `docs/bugs/retest/`)
