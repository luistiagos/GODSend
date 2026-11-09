# Bug: Gerenciador FTP descarta o motivo do backend ao listar, enviar e mover jogo

## Status

- **Corrigido e testado:** 2026-11-09 (v2.12.127).
- **Onde:** `src/electron-app/ipc/toolsHandlers.ts` (`normalizeBackendResp` aplicado a `tools:ftp-list`, `tools:ftp-upload` e `xbox:move-game`), `src/electron-app/renderer/components/FTPManagerPage.tsx` (`handleUploadFiles`, `handleUploadFolder`, `handleDelete`, `handleDeleteSelected`, `handleMkdir`). Teste unitário: `src/electron-app/tests/unit/toolsHandlers.test.cjs` (22 casos).
- **Evidência:**
  - **T2 (UI + IPC E2E com backend Go real v2.12.127 via Playwright `_electron`):** configurado `xboxIp: "127.0.0.1"` sem servidor FTP; clique em **Ferramentas → Gerenciador FTP** exibiu o erro real do backend (`FTP connect to 127.0.0.1 failed: dial tcp 127.0.0.1:21: connectex: No connection could be made because the target machine actively refused it.`) em vez do genérico `"Falha ao listar a pasta"`. Chamadas IPC `tools:ftp-upload` e `xbox:move-game` preservaram integralmente o `message` do `jsonError` (`"ip, local_paths, and remote_path required"` e `"source and destination drive are the same"`).
  - **T3 (regressão):** `go test -count=1 ./...` em `src/server` rc 0; `npm --prefix src/electron-app run test:safety` 398 pass / 0 fail (`toolsHandlers.test.cjs` 22/22).
  - **T4 (logs):** sem erros novos atribuíveis ao fix no console do backend/Electron.
- **Falta para `closed/`:** versão publicada (`build-and-upload.ps1`, do dono) e prova em console real via FTP.

- **Detectado em:** 2026-10-12 19:00 (leitura de código, pipeline 20261012-1854)
- **Origem:** achado lateral do pipeline em electron-main-ferramentas-iso-mostram-sucesso-quando-o-backend-responde-erro_2026-10-11T13-55 — `xbox-360-companion/electron-main` (`src/electron-app/ipc/toolsHandlers.ts`: `tools:ftp-list`, `tools:ftp-upload`, `xbox:move-game`)
- **Errors (serviço):** N/A (local)
- **Classe:** ux
- **Severidade:** **P3 - Baixo**: a falha aparece, mas com texto genérico (ou nenhum) em vez do motivo do backend
- **Versões:** `origin/main` @ cab6830 (verificação só no código; não reproduzido)
- **Reincidência:** mesma classe de [electron-main-ferramentas-iso-mostram-sucesso-quando-o-backend-responde-erro_2026-10-11T13-55](electron-main-ferramentas-iso-mostram-sucesso-quando-o-backend-responde-erro_2026-10-11T13-55.md) e do fechado [electron-browse-queue-game-erro-desconhecido-sem-motivo_2026-09-05T12-00](../closed/electron-browse-queue-game-erro-desconhecido-sem-motivo_2026-09-05T12-00.md)

## Sintoma

Esperado pela leitura do código (não reproduzido): com o FTP do console inacessível, o Gerenciador FTP mostra
"Falha ao listar a pasta" em vez do erro do backend (ex.: conexão recusada); falha ao enviar arquivos não aparece.

## Causa raiz

- `src/server/interfaces/http/middleware.go::jsonError` responde `{"state":"Error","message":...}` (sem `ok`/`error`);
  `handlers_ftp_manager.go::handleFTPList` usa-o com 502 quando o FTP falha, `handleFTPUpload` e
  `handleFTPMoveGame` com 400 na validação.
- `src/electron-app/ipc/toolsHandlers.ts`: `tools:ftp-list` e `tools:ftp-upload` fazem `return r` (corpo cru);
  `xbox:move-game` faz `if (!r.ok) return r`. Nenhum converte `message` em `error`.
- `renderer/components/FTPManagerPage.tsx` (linhas 148-157): `setError(r.error || "Falha ao listar a pasta")` →
  o motivo se perde; o envio (`toolsFtpUpload`, linha ~196) nem olha o retorno.

## Como reproduzir

1. Configurar um IP de Xbox inexistente/sem FTP.
2. Ferramentas → FTP → abrir a pasta raiz.
3. Esperado: o erro do backend (`message`). Observado (previsto): "Falha ao listar a pasta".

## Critérios para fechar
- [x] Reprodução confirmada
- [x] `tools:ftp-list`, `tools:ftp-upload` e `xbox:move-game` devolvem `error` com o `message` do `jsonError`
- [x] Teste unitário dos três handlers com a resposta de `jsonError`

## Correção aplicada (2.12.127)

- `src/electron-app/ipc/toolsHandlers.ts`:
  - `normalizeBackendResp` aplicado às saídas de `tools:ftp-list`, `tools:ftp-upload` e `xbox:move-game`.
  - Se o backend retornar `jsonError` (`{"state":"Error","message":"..."}`), `normalizeBackendResp` normaliza para `{ ok: false, error: String(message), ...r }`, garantindo que o renderer receba a mensagem real de erro.
  - Se o backend retornar sucesso (`{"ok": true, ...}` ou `{"state":"ok"}`), a resposta é mantida íntegra com `{ ok: true, ... }`.
- `src/electron-app/renderer/components/FTPManagerPage.tsx`:
  - `handleUploadFiles` e `handleUploadFolder` passam a verificar a resposta de `toolsFtpUpload` e setar `setError(res.error || ...)` caso `!res.ok`.
  - `handleDelete` e `handleMkdir` também setam `setError(r.error || ...)` caso `!r.ok`.
- Versão bumpada para 2.12.127 nos quatro locais obrigatórios e documentada em `CHANGELOG.md`.

## Testes executados

- `npm run tsc --prefix src/electron-app` compilado com sucesso sem erros de tipagem.
- `node --test src/electron-app/tests/unit/toolsHandlers.test.cjs`: 22/22 testes aprovados, incluindo testes de rejeição e sucesso para `tools:ftp-list`, `tools:ftp-upload` e `xbox:move-game` com `jsonError` simulado.
