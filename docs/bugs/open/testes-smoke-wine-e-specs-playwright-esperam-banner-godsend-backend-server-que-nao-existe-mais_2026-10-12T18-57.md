# Bug: smoke test do wine e dois specs Playwright esperam o banner "GODSend Backend Server", que o backend nao imprime desde a 2.12.25

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

- [ ] Os tres consumidores esperam o texto que o backend imprime
- [ ] Um dos specs Playwright passa a detectar o backend pronto
