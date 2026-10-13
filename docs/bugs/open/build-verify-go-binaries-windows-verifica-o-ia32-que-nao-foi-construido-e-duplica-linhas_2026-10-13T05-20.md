# Bug: `verify-go-binaries.js windows` também verifica o ia32 (e repete linhas), então `build:server:win:x64` confere um binário que não construiu

- **Detectado em:** 2026-10-13 05:12 (T2-b do teste de build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30, execução 20261012-1854)
- **Origem:** achado lateral do pipeline (`scripts/verify-go-binaries.js::expand`)
- **Errors (serviço):** N/A (build local)
- **Classe:** fail (build) — cosmético na maior parte
- **Versões:** 2.12.110 (`origin/main` 73f3e5d) e a base anterior ao fix acima: o comportamento com `--x64` é o mesmo
- **Reincidência:** primeira vez
- **Severidade:** P4 — nenhum build quebra hoje; só verifica um `godsend-windows-ia32.exe` antigo num build x64
  (e falharia o build x64 se esse ia32 velho estivesse corrompido) e repete linhas `[verify]` no log.

## Sintoma

Com `dist/godsend-windows-ia32.exe` presente (de um build anterior), `node scripts/build-server.js --x64`
compila só o x64, mas o log do verify mostra:

```
[verify] ✓ godsend.exe (16.1 MB) — Windows PE32+ (MZ)
[verify] ✓ godsend-windows-x64.exe (16.1 MB) — Windows PE32+ (x64)
[verify] ✓ godsend-windows-ia32.exe (15.6 MB) — Windows PE32 (ia32/386)
[verify] ✓ godsend-windows-x64.exe (16.1 MB) — Windows PE32+ (x64)
```

e o `build:server` (todas) mostra 5 linhas em vez de 3 (x64 e ia32 duas vezes).
Evidência: `C:\projects\.bugfix-xbox360\evidencia\20261013-0512-build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30\t2b-fix-x64.log`
e `t2c-fix-all.log`.

## Causa raiz

`scripts/verify-go-binaries.js::expand` trata `"windows"` igual a `"windows-all"`: devolve `["windows"]` mais
`"windows-x64"`/`"windows-ia32"` se os arquivos existirem. Não há como pedir só o `godsend.exe`.
`scripts/build-server.js` (depois do fix do bug de origem) passa `windows` + `windows-x64` (+ `windows-ia32`),
então o x64 aparece duas vezes e o ia32 entra mesmo num build `--x64`. Com a base (`windows-all`) o `--x64`
também verificava o ia32: não é regressão daquele fix.

## Como reproduzir

Árvore com os três `.exe` em `dist/` -> `node scripts/build-server.js --x64` -> o log lista o ia32.

## Resolução (a planejar)

`expand("windows")` devolver só `["windows"]` (o `godsend.exe`), mantendo o `windows-all` como está; conferir os
outros chamadores de `windows` antes (`grep verify-go-binaries`). Alternativa: deduplicar `targets` em `main`.

## Critérios para fechar

- [ ] `build-server.js --x64` não lista `godsend-windows-ia32.exe`
- [ ] `build:server` (todas) lista cada binário uma vez só
