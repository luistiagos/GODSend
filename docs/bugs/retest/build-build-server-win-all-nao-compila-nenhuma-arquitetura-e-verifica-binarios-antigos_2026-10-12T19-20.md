# Bug: `npm run build:server:win:all` não compila nenhuma arquitetura e verifica os binários antigos de `dist/`

## Status

- **Corrigido em:** 2026-10-13, no mesmo commit do bug de origem (`205b514`, `scripts/build-server.js`: `--all` nas
  condições de `buildX64`/`buildIa32`).
- **Evidência:** controle positivo na base, `--all` não compila nada (`ctrl-base-all.log`); com o fix, `--all` compila
  amd64 e 386 e verifica os três com mtimes novos (`t2c-fix-all.log`, `t2c-mtimes.txt`), em `C:\projects\.bugfix-xbox360\evidencia\20261013-0512-build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30`.
  T3 no Status do bug de origem.
- **Falta para `closed/`:** versão publicada (do dono) e o próximo `build-portable-local.ps1 -Arch all` do dono.

- **Detectado em:** 2026-10-12 19:20 (leitura de código no planning, execução 20261012-1854)
- **Origem:** achado lateral do pipeline em build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30 (`scripts/build-server.js`, cálculo de `buildX64`/`buildIa32`)
- **Errors (serviço):** N/A (build local)
- **Classe:** fail (build)
- **Versões:** código em `cab6830`
- **Reincidência:** primeira vez
- **Severidade:** P3 — só o `build:server:win:all` (chamado por `build-portable-local.ps1 -Arch all`); o `build-and-upload.ps1` usa `build:server` sem argumento e compila as duas arquiteturas.

## Sintoma

`package.json` declara `"build:server:win:all": "node scripts/build-server.js --all"`. Com `--all`, nenhum
`go build` roda: o script só baixa as ferramentas e chama o verify. Numa árvore limpa o verify falha
(`godsend.exe missing`); numa árvore com binários de um build anterior, o verify passa sobre eles e o
`build-portable-local.ps1 -Arch all` empacota um backend **velho** sem aviso.

## Causa raiz

`scripts/build-server.js`: `buildX64` e `buildIa32` aceitam `"all"`, mas não `"--all"`
(as outras arquiteturas aceitam as duas formas: `"x64"`/`"--x64"`, `"ia32"`/`"--ia32"`). Com
`argv = ["--all"]`, `argv.length !== 0` e nenhum `includes` casa, então os dois ficam `false`.

## Como reproduzir

Prova offline da lógica (mesmas expressões do script, sem compilar):

```
node -e '<expressões de buildX64/buildIa32 copiadas do script>' -- --all
-> ["--all"] x64=false ia32=false
```

(com `--x64` -> x64=true; `--ia32` -> ia32=true; sem argumento -> os dois true.)

## Resolução (a planejar)

Aceitar `"--all"` nas duas condições. Planejado para ser corrigido no MESMO commit do bug de origem
(mesmas linhas de `scripts/build-server.js`; o fix de origem passa ao verify só as arquiteturas
compiladas e, sem este ajuste, `--all` chamaria o verify sem alvo e sairia 2). Ver a seção
Planejamento de [build-build-server-ia32-sozinho...](build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30.md).

## Critérios para fechar

- [ ] `node scripts/build-server.js --all` compila `godsend-windows-x64.exe`, `godsend.exe` e `godsend-windows-ia32.exe` (timestamps novos) e verifica os três
