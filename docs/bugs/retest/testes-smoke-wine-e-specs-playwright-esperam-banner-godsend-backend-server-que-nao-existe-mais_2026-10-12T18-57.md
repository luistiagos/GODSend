# Bug: smoke test do wine e dois specs Playwright esperam o banner "GODSend Backend Server", que o backend nao imprime desde a 2.12.25

## Status

- **Corrigido e testado:** 2026-11-09 (v2.12.127).
- **Onde:** `scripts/verify-go-binaries.js::smokeTestWindowsExe` (regex `/(?:Xbox 360 Companion|GODSend) Backend Server v/`), `src/electron-app/tests/icon-banner-fix.spec.ts:56` e `src/electron-app/tests/export-aurora-db.spec.ts:72` (`text.includes("Xbox 360 Companion Backend Server") || text.includes("GODSend Backend Server")`). Teste unitário: `src/electron-app/tests/unit/verifyGoBinaries.test.cjs`.
- **Evidência:**
  - **T2 (Playwright `_electron` E2E com backend Go real v2.12.127):** ao iniciar o Electron e o backend `dist/godsend-windows-x64.exe`, o predicado atualizado detectou imediatamente `[INFO] Xbox 360 Companion Backend Server v2.12.127` no buffer de saída do backend (`godsend:get-buffer`).
  - **T3 (regressão):** `npm --prefix src/electron-app run test:safety` 398 pass / 0 fail; `go test -count=1 ./...` em `src/server` rc 0.
  - **T4 (logs):** sem erros novos.
- **Falta para `closed/`:** publicação da release (`build-and-upload.ps1`, do dono).

- **Detectado em:** 2026-10-12 18:57 (leitura de codigo)
- **Origem:** achado lateral do pipeline em pipeline-report-de-telemetria-do-backend-nao-carrega-versao-do-app_2026-10-10T23-30 — `scripts/verify-go-binaries.js::smokeTestWindowsExe`, `src/electron-app/tests/icon-banner-fix.spec.ts`, `src/electron-app/tests/export-aurora-db.spec.ts`
- **Errors (servico):** N/A (local)
- **Classe:** fail (harness de teste)
- **Severidade:** P3 — Baixo: nada quebra para o usuario; os testes afetados falham sempre ou nunca rodam
- **Complexidade:** baixa — trocar o texto esperado
- **Versoes:** codigo atual (v2.12.110); o banner mudou no rebrand `2bfaca3` (2.12.25)
- **Reincidencia:** primeira vez

## Sintoma

O backend imprime `[INFO] Xbox 360 Companion Backend Server v...` e o quadro `Xbox 360 Companion Server v...`
(`src/server/main.go::main`). Tres esperas ainda procuram o texto antigo:

- `scripts/verify-go-binaries.js:157` — `/GODSend Backend Server v/`: com wine instalado, o smoke test termina em
  `timeout — banner never printed` mesmo com o binario saudavel (sem wine ele e pulado, por isso passa despercebido).
- `src/electron-app/tests/icon-banner-fix.spec.ts:56` e `src/electron-app/tests/export-aurora-db.spec.ts:72` —
  `text.includes("GODSend Backend Server")`: `backendReady` nunca vira `true` e o spec falha em "Backend should start".

## Causa raiz

O rebrand (`2bfaca3`, "rebrand to Xbox 360 Companion and bump version to 2.12.25") trocou o banner do backend e nao
atualizou os consumidores do texto.

## Como reproduzir

`grep -rn "GODSend Backend Server" scripts src/electron-app/tests` -> 3 linhas; `grep -n "Backend Server" src/server/main.go`
-> so `Xbox 360 Companion Backend Server`.

## Resolucao

A definir no planejamento (ex.: esperar `Backend Server v` ou `Xbox 360 Companion Backend Server`).

## Criterios para fechar

- [x] Os tres consumidores esperam o texto que o backend imprime
- [x] Um dos specs Playwright passa a detectar o backend pronto

## Correção aplicada (2.12.127)

- `scripts/verify-go-binaries.js:157`: atualizado para a regex `/(?:Xbox 360 Companion|GODSend) Backend Server v/`, reconhecendo o banner atual e preservando compatibilidade com binários históricos.
- `src/electron-app/tests/icon-banner-fix.spec.ts:56`: atualizado para `text.includes("Xbox 360 Companion Backend Server") || text.includes("GODSend Backend Server")`.
- `src/electron-app/tests/export-aurora-db.spec.ts:72`: atualizado para `text.includes("Xbox 360 Companion Backend Server") || text.includes("GODSend Backend Server")`.
- `src/electron-app/tests/unit/verifyGoBinaries.test.cjs`: teste unitário adicionado comprovando que a regex reconhece tanto `[INFO] Xbox 360 Companion Backend Server v2.12.127` quanto o banner legado do GODSend.

## Testes executados

- `node --test src/electron-app/tests/unit/verifyGoBinaries.test.cjs`: verde (5/5 testes).
