# Bug: `npm run build:server:win:ia32` sozinho falha no verify, exigindo o `godsend.exe` x64

- **Detectado em:** 2026-10-07 22:50 (build do portátil ia32 numa worktree limpa, sessão que fez a T3 do bug do 32 bits); registrado em 2026-10-10
- **Origem:** achado lateral do pipeline em release-companion-32-bits-nao-publicado-e-atualizador-trocaria-pelo-x64_2026-10-07T23-30 (`scripts/build-server.js`, chamada final a `scripts/verify-go-binaries.js`)
- **Errors (serviço):** N/A (build local)
- **Classe:** fail (build)
- **Versões:** visto na 2.12.109; código atual (`d7bd9ad`) igual
- **Reincidência:** primeira vez
- **Severidade:** P3 — só quebra o build ia32 isolado numa árvore sem `dist/godsend.exe`; o `build-and-upload.ps1` usa `build:server` (todas as arquiteturas) e não é afetado.

## Sintoma

Numa árvore limpa (sem `dist/godsend.exe`), `npm run build:server:win:ia32` compila
`dist/godsend-windows-ia32.exe` e depois falha no `verify` cobrando o `godsend.exe` x64
(registrado em "Execução da T3" do doc
[release-companion-32-bits...](release-companion-32-bits-nao-publicado-e-atualizador-trocaria-pelo-x64_2026-10-07T23-30.md)).
Quem chama: `build:win:ia32` (`package.json`) e `build-portable-local.ps1 -Arch ia32`
(`Invoke-Step ... "build:server:win:ia32"`).

## Causa raiz

- `scripts/build-server.js`: com `--ia32`, `buildX64` é falso e só o ia32 é compilado; mas a última
  instrução roda **sempre** `verify-go-binaries.js windows-all`.
- `scripts/verify-go-binaries.js::expand("windows-all")` começa a lista com `"windows"` incondicionalmente
  (`const list = ["windows"]`, alvo `godsend.exe` PE32+); `windows-x64`/`windows-ia32` só entram se o
  arquivo existir. Logo, sem `godsend.exe`, o verify falha mesmo com o ia32 correto.

## Como reproduzir

Árvore sem `dist/godsend.exe` → `npm run build:server:win:ia32` → exit != 0 no verify.

## Resolução (a planejar)

Verificar só o que foi construído: passar ao verify as chaves das arquiteturas escolhidas
(`windows`/`windows-x64` quando `buildX64`, `windows-ia32` quando `buildIa32`). Não investigado além disso.

## Critérios para fechar

- [ ] `build:server:win:ia32` numa árvore sem `dist/godsend.exe` sai 0 e verifica o PE32 do ia32
- [ ] `build:server` (todas) continua verificando o `godsend.exe` x64
