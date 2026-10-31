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

## Causa raiz (passada 2, 2026-10-31)

O `1` nunca teve motivo, e a Aurora não dá significado ao bit `1` de `OptionsFlag` em nenhum ponto que dê para provar.
Corrigir o nome da coluna passaria a gravar um valor desconhecido em todo console; o defeito real é só a query morta.

- **Origem do `1`:** `git log -S"optionsflags"` → a query entrou em `978e128` (2026-08-18, mensagem `*`), sem doc nem
  teste. Nada no repositório explica o valor (`grep -rni optionsflag` só acha o hook, o teste e os dois docs de bug).
- **O usuário não tem como ligar a opção:** a tela `ScanPathConfigUI` da skin (`Aurora/Skins/Default.xzp`, strings
  UTF-16 em `0x1eccb`–`0x1f37f`) tem só `Path`, `Depth` (`ScanDepthSlider`) e `Script Data` (rádios `Custom`,
  `Homebrew`, `Emulators`, `Applications`, `[None]`). Não há controle que vire `OptionsFlag`.
- **Como a Aurora usa a coluna** (imagem decifrada do `default.xex`, offset = VA − `0x82000000`):
  - `823e3248` lê `SELECT Id, Path, Depth, DeviceId, ScriptData, OptionsFlag FROM Config.ScanPaths`; `823e36e8` grava
    `INSERT INTO Config.ScanPaths (Path, DeviceId, Depth, ScriptData, OptionsFlag)`, com `OptionsFlag` vindo de
    `lwz r5, 168(r30)` (`823e37b8`): o campo `+168` da estrutura do scan path.
  - O único teste desse campo no fim de uma varredura (`82315d0c`, logo depois de `Finished ScanPath: %s%s`) é
    `lwz r11,168(r29)` + `rlwinm. r11,r11,0,0,0` (`0x556b0001`) = máscara **`0x80000000`**, não `1`.
  - Varredura de toda palavra com opcode 32/36 (`lwz`/`stw`) e deslocamento `168` seguida, em até 3 instruções, de
    `andi.`/`rlwinm`/`cmpwi`/`cmplwi` sobre o mesmo registrador: 166 ocorrências no binário (o
    deslocamento `168` é comum a muitas estruturas). Das que ficam nas funções do ContentManager, `82316e90` monta
    `0x00040001` (`lis 0x0004; ori 1`) e testa `0x00040000` — não consegui provar que é a mesma estrutura.
- **Banco SQLite:** coluna `INTEGER` sem `DEFAULT` (`CREATE TABLE IF NOT EXISTS Config.ScanPaths`, `0x1482fc`); a linha
  inserida pela segunda query fica com `NULL`, que a Aurora lê como `0`. É o que todo console recebe desde 2026-08-18,
  sem relato ligado a isso.

## Hipóteses descartadas

- **Trocar `optionsflags` por `OptionsFlag` e manter o `1`.** Mudaria o que vai para todo console com base num valor sem
  origem e sem significado provado. O comportamento em produção há dois meses é `NULL`.
- **O `1` vem de alguma opção da tela de scan path.** A tela não tem opção além de Path, Depth e Script Data.
- **O bit testado no fim da varredura é o `1`.** É `0x80000000` (`rlwinm` com MB=ME=0).

## Correção planejada

- `src/electron-app/infrastructure/readyToPlayConfiguration.ts::generateAuroraReadyToPlayFilterLua`, função Lua
  `insertScanPath`: tirar a primeira query (a de `optionsflags`). A de `(path, deviceid, depth, scriptdata)` passa a ser
  a primeira e acerta no esquema da Aurora; a de `(path, deviceid, depth)` fica como está. Nada muda no que é gravado.
- Teste em `src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs`: num pendrive novo, todo `INSERT INTO
  scanpaths` executado acerta na primeira tentativa (nenhum `Sql.Execute` de cadastro falha) e a coluna `OptionsFlag`
  fica `NULL`. Prova inversa: com a query antiga de volta, o teste falha.

## Tasks

| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | tirar a query de `optionsflags` de `insertScanPath` + teste executado | -- | -- | -- | -- |

## Critérios para fechar

- [ ] T1: o hook não manda mais a query que sempre falha, e o teste executado prova que o cadastro acerta na primeira
  query sem mudar o que é gravado
