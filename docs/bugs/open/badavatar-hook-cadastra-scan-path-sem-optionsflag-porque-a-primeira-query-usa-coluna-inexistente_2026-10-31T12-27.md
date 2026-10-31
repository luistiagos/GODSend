# Bug: o hook `XboxCompanionReady.lua` nunca grava o `OptionsFlag = 1` dos scan paths, porque a primeira query de `insertScanPath` usa uma coluna que não existe

- **Detectado em:** 2026-10-31 12:27, lendo o binário da Aurora durante a passada 2 do bug [[badavatar-primeiro-boot-da-aurora-fica-mais-de-2-horas-varrendo-title-updates-do-hd-interno_2026-10-30T21-43]] ("Achado fora do escopo")
- **Origem:** leitura de código + `Aurora/default.xex` do pacote (0.7b Rev1655); nenhum relato de cliente
- **Classe:** defeito latente (query que sempre falha e cai no fallback)
- **Severidade:** **P3 — Baixo, provisório**: o cadastro dos scan paths funciona pela segunda query; não se sabe se a falta da opção muda algo visível
- **Complexidade:** desconhecida até saber o que o `OptionsFlag = 1` faz na Aurora
- **Reincidência:** primeira vez registrada

## Sintoma

Nenhum sintoma visível conhecido. O hook pretende cadastrar `\games` e `\Content\0000000000000000` com `optionsflags = 1`,
mas essa gravação nunca acontece: o cadastro sai sem a opção.

## Evidência

- `src/electron-app/infrastructure/readyToPlayConfiguration.ts::generateAuroraReadyToPlayFilterLua`, função Lua
  `insertScanPath` (linha 105 do TS na 2.12.121): a primeira de três queries é
  `INSERT INTO scanpaths (path, deviceid, depth, scriptdata, optionsflags) VALUES (..., '', 1);`. Se ela falha, o hook
  tenta `(path, deviceid, depth, scriptdata)` e depois `(path, deviceid, depth)`.
- Nome da coluna no binário da Aurora: `OptionsFlag`, no singular, string em `0x1483b8` do `default.xex` decifrado (como
  decifrar: seção "Como reproduzir a leitura do binário" do bug do #301). O SQLite não diferencia maiúsculas de minúsculas
  em nome de coluna, mas `optionsflags` ≠ `optionsflag` por causa do `s` final.
- No teste executado da 2.12.121 (`src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs`), com o esquema falso
  `ScanPaths (..., OptionsFlag INTEGER)`, a primeira query falha e a linha entra pela segunda. **O esquema falso foi escrito
  por mim a partir da string do binário; não é o banco real de um console.**
- Não observado: o `CREATE TABLE ScanPaths` real e o `settings`/`content.db` de um console. Não se sabe o que o bit `1` de
  `OptionsFlag` significa.

## Critérios para fechar

- [ ] (a definir na passada 2)
