# Bug: `docs/READY-TO-PLAY-AURORA.md` afirma que há teste de "sintaxe Lua 5.1 do arquivo gerado", e esse teste não existe

## Status

- **Corrigido e testado:** 2026-10-31 (v2.12.122) e revalidado em 2026-11-09 (v2.12.127).
- **Onde:** `src/electron-app/package.json` (`luaparse: ^0.3.1`), `src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs` (`hook gerado e Lua 5.1 valido`), `docs/READY-TO-PLAY-AURORA.md` e `AGENTS.md`.
- **Evidência:**
  - **T2 / Controle positivo:** `node --test src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs` (12/12 verdes); enxerto de `local x = 7 // 2` no hook reprova o teste `hook gerado e Lua 5.1 valido` enquanto o `fengari` 5.3 aceitaria.
  - **T3 (regressão):** `npm --prefix src/electron-app run test:safety` 398 pass / 0 fail.
- **Falta para `closed/`:** publicação da release (`build-and-upload.ps1`, do dono).

- **Detectado em:** 2026-10-31 12:27, ao implementar a T1 do bug [[badavatar-primeiro-boot-da-aurora-fica-mais-de-2-horas-varrendo-title-updates-do-hd-interno_2026-10-30T21-43]]
- **Origem:** leitura do doc e dos testes; nenhum relato de cliente
- **Classe:** documentação que afirma uma garantia inexistente (cobertura de teste)
- **Severidade:** **P3 — provisório**: um erro de sintaxe 5.1 no hook deixaria as pastas de jogos sem cadastro em todo
  pendrive preparado (risco "grave" da tabela de risco do bug do #301), e o doc leva a crer que isso é pego antes de publicar
- **Complexidade:** desconhecida
- **Reincidência:** primeira vez registrada

## Sintoma

Quem lê a seção "Validação automatizada" do `docs/READY-TO-PLAY-AURORA.md` entende que o hook
`XboxCompanionReady.lua` gerado tem a sintaxe conferida contra Lua 5.1 (a versão da Aurora). Nenhum teste faz isso.

## Evidência

- `docs/READY-TO-PLAY-AURORA.md`, linha 194 (na 2.12.121): `- sintaxe Lua 5.1 do arquivo gerado;`. A linha está no doc
  desde o commit `978e128` (2026-08-18).
- `src/electron-app/tests/unit/`: a busca por `5.1`, `luac`, `luaparse` e `fengari` só acha
  `fat32FormatGuard.test.cjs` (PowerShell 5.1, outro assunto) e `readyToPlayConfiguration.test.cjs`.
- `readyToPlayConfiguration.test.cjs`, desde a 2.12.121, **executa** o hook com `fengari` 0.1.4, que é Lua **5.3**
  (`_VERSION` devolve `Lua 5.3`, conferido em 2026-10-31). Código só válido na 5.3 (`//`, operadores de bit, `goto`,
  `utf8.*`) passaria nesse teste e quebraria na Aurora.
- `git log --all -S"luaparse"` só acha o commit da 2.12.121 (onde o nome aparece em doc); não há `luac` em script nem em
  teste do repositório.

## Causa raiz

A linha 194 do `docs/READY-TO-PLAY-AURORA.md` entrou no `978e128` sem teste correspondente, e nenhum teste foi criado depois.
Conferido em 2026-10-31:

- `src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs` é o único teste que lê o hook
  (`infrastructure/readyToPlayConfiguration.ts::generateAuroraReadyToPlayFilterLua`). Até a 2.12.120 ele só fazia
  `assert.match` sobre o texto (linhas 32–55: `FileSystem.GetDrives(false)`, `INSERT INTO scanpaths`, `Aurora.Restart()`...),
  o que não confere sintaxe. A 2.12.121 passou a carregar o Lua no fengari (`require("fengari")`, linha 13), que é 5.3.
- Não há Lua nativo na máquina: `which luac lua luac5.1 lua5.1` não acha nenhum. `src/electron-app/package.json` só tem
  `fengari` entre as devDependencies ligadas a Lua.
- A Aurora é Lua 5.1 (`AGENTS.md:12`, `CONTRIBUTING.md:61`: "no `goto`, no bitwise operators, no `table.move`").

## Hipóteses descartadas

- **O teste do fengari já cobre a sintaxe.** Não cobre: o fengari aceita a sintaxe 5.3. No scratchpad, `luaparse` 0.3.1 em
  modo `5.3` aceita `local a = 7 // 2`, `1 & 2`, `~1`, `1 << 2` e `goto x ::x::`, e o fengari carrega o mesmo.
- **Só corrigir o texto do doc.** Resolve a mentira mas deixa o risco que a severidade descreve: o fengari 5.3 dá falsa
  confiança justamente para o código novo do hook. O bug do #301 (linhas 195–196) já previa `luaparse` para a sintaxe 5.1.
- **Varrer o texto do hook por tokens 5.3 (`//`, `&`, `goto`) com regex.** Frágil: `//` e `~` aparecem dentro de strings e
  comentários (`~=` é 5.1 válido). Um parser não tem esse problema.
- **Baixar um `luac` 5.1 para o teste.** Binário nativo por plataforma, fora do `npm install`; não roda no CI sem passo extra.

## Correção planejada

- `src/electron-app/package.json`: devDependency `luaparse` 0.3.1 (MIT, sem dependências, JS puro).
- `src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs`: teste novo que faz
  `luaparse.parse(generateAuroraReadyToPlayFilterLua(), { luaVersion: "5.1" })` e, para provar que o modo 5.1 está valendo,
  confere que o mesmo parser recusa `//`, `&`, `~`, `<<` e `goto` em 5.1 (e aceita em 5.3). Prova: o teste fica verde com o
  hook atual (`hook 5.1: ok`, 211 linhas, conferido no scratchpad) e fica vermelho se uma linha `local x = 7 // 2` for
  enxertada no hook.
- `docs/READY-TO-PLAY-AURORA.md:194`: dizer o que o teste confere e o que não confere — só sintaxe; função de biblioteca só da
  5.2+ (`table.unpack`, `utf8.*`, `string.pack`) não é pega por ele, e o fengari a aceitaria. Hoje o hook não usa nenhuma
  (grep no texto gerado por `table.unpack|utf8\.|math.type|math.tointeger|string.pack|unpack|loadstring|setfenv|load(|table.move|//|goto`: nenhuma linha).
- `AGENTS.md` (item do `readyToPlayConfiguration.ts`): citar o `luaparse` ao lado do fengari.
- Versão 2.12.122 nos quatro lugares + `CHANGELOG.md`.

## Tasks

| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | teste de sintaxe Lua 5.1 do hook com `luaparse` e doc corrigido | -- | -- | -- | -- |

## Critérios para fechar

- [x] `node --test tests/unit/readyToPlayConfiguration.test.cjs` verde com o teste novo
- [x] o teste novo fica vermelho com `local x = 7 // 2` enxertado no hook (conferido e revertido)
- [x] `docs/READY-TO-PLAY-AURORA.md` descreve o que o teste confere e o limite dele

## Correção aplicada (2.12.122)

Como planejado, sem desvio:

- `src/electron-app/package.json`: devDependency `luaparse` `^0.3.1` (`package-lock.json` +11 linhas, só o pacote).
- `src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs`: teste `hook gerado e Lua 5.1 valido`, logo depois dos
  testes de texto do hook. `luaparse` lança `SyntaxError`, que é o que o teste espera para os trechos só-5.3.
- `docs/READY-TO-PLAY-AURORA.md` (linha da "Validação automatizada"), `AGENTS.md` (item do `readyToPlayConfiguration.ts`),
  versão 2.12.122 nos quatro lugares e `CHANGELOG.md`.

Fica de fora (não é este bug): conferir que o hook só chama funções da biblioteca 5.1. Hoje ele não usa nenhuma só-5.2+
(grep da passada 2), mas nada impede uma futura.

## Testes executados

- `node --test tests/unit/readyToPlayConfiguration.test.cjs`: 12 testes, 12 verdes.
- Enxerto de `"local x = 7 // 2",` no começo do hook em `infrastructure/readyToPlayConfiguration.js` (compilado): só
  `hook gerado e Lua 5.1 valido` falha; os 6 cenários que executam o hook no fengari ficam verdes. Revertido com
  `npm run tsc` (`grep -c "7 // 2"` no `.js` = 0).
- `node --test tests/unit/*.test.cjs`: 368 testes, 368 verdes (367 da 2.12.121 + o novo).
