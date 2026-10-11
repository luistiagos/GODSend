# Bug: "ISO para XEX" / "ISO para GOD" mostram sucesso (check verde) quando o backend responde erro

- **Detectado em:** 2026-10-11 13:49 (teste local), no controle positivo do bug
  [backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio-...](../retest/backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio-e-extrai-iso-incompleta-sem-erro_2026-10-09T20-20.md)
  (pipeline 20261010-2242)
- **Origem:** `xbox-360-companion/electron-main` (`src/electron-app/ipc/toolsHandlers.ts`: `tools:iso2xex`, `tools:iso2god`, `tools:probe-iso`)
- **Errors (serviço):** N/A (local)
- **Classe:** ux / fail silencioso
- **Severidade:** **P2 - Medio**: o usuário vê sucesso numa conversão que não aconteceu e não recebe o motivo
- **Versões:** 2.12.110 (`origin/main` @ 2e886d2)
- **Reincidência:** mesma classe do bug fechado
  [electron-browse-queue-game-erro-desconhecido-sem-motivo_2026-09-05T12-00](../closed/electron-browse-queue-game-erro-desconhecido-sem-motivo_2026-09-05T12-00.md)
  (`jsonError` responde `{"state":"Error","message":...}`), que foi corrigido só no `browse:queue-game`

## Sintoma

Tela "ISO para XEX", ISO cujo probe falha (`B.iso`, sem `default.xex` legível para o backend da base): a linha
mostra **check verde**, sem "Saída: ..." e sem erro em vermelho; o botão vira "Extrair 0 ISOs para XEX".
Nada foi extraído. A rota respondeu, no mesmo momento:

```
POST /tools/iso2xex -> 500 {"message":"Probe failed: no game executable (default.xex / default.xbe) found in ISO root","state":"Error"}
```

Print: `C:\projects\.bugfix-xbox360\evidencia\20261011-1340-backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio\base-3-result.png`
(e `base-result.json`, campos `body` e `iso2xexB`).

## Causa raiz

- `src/server/interfaces/http/middleware.go::jsonError` escreve `{"state":"Error","message":...}` (sem `error`, sem `ok`).
- `src/electron-app/ipc/toolsHandlers.ts`: `tools:iso2xex` e `tools:iso2god` fazem
  `if (r.error && !r.ok) return { ok: false, ... }; return { ok: true, ...r };` — `r.error` é sempre `undefined`
  numa resposta do `jsonError`, então todo erro do backend vira `ok: true`. `tools:probe-iso`
  (`if (r.error && !r.titleId)`) tem o mesmo defeito (a linha mostra "Desconhecido —" em vez do motivo).
- `renderer/components/ISO2XEXPage.tsx::handleExtract` (e o equivalente do `ISO2GODPage.tsx`) marca
  `state: "done"` quando `r.ok`.

## Como reproduzir

1. Qualquer ISO que o backend recuse (ex.: arquivo `.iso` qualquer sem a assinatura XDVDFS).
2. Ferramentas -> "ISO para XEX" -> "Adicionar ISOs" -> "Pasta de saída" -> "Extrair 1 ISO para XEX".
3. Esperado: erro em vermelho com o `message` do backend. Observado: check verde, pasta vazia.

## Correção sugerida

Nos três handlers, tratar `r.state === "Error"` (ou a falta de `ok`/`titleId`) como falha e devolver
`error: r.message || r.error`. Teste unitário em `tests/unit/` com `backendPost` falso respondendo o formato
do `jsonError`.

## Critérios para fechar
- [ ] ISO recusada mostra erro em vermelho com o motivo nas duas telas (XEX e GOD)
- [ ] Teste unitário dos handlers com a resposta de `jsonError`
