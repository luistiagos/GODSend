# Bug: Gerenciador FTP descarta o motivo do backend ao listar, enviar e mover jogo

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
- [ ] Reprodução confirmada
- [ ] `tools:ftp-list`, `tools:ftp-upload` e `xbox:move-game` devolvem `error` com o `message` do `jsonError`
- [ ] Teste unitário dos três handlers com a resposta de `jsonError`
