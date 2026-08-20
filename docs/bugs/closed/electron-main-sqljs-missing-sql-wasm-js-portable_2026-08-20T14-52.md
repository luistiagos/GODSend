# Bug: Falha de inicialização no Electron Portable por ausência de `sql-wasm.js` desempacotado

- **Detectado em:** 2026-08-20 14:52 (telemetria de produção)
- **Status:** **Resolvido** (v2.12.42)
- **Origem:** telemetria `xbox-360-companion/electron-main` (`bootstrap.ts::uncaughtException`)
- **Errors (serviço):** 975, 1004, 1065, 1105, 1443, 1501 (6 ocorrências)
- **Classe:** crash
- **Reincidência:** recorrente (6 ocorrências em produção, versões v2.12.28, v2.12.38 e v2.12.40)

## Sintoma

O executável portátil (`xbox-360-companion-Portable-*.exe`) falha durante o processo de inicialização ou ao acessar o serviço de biblioteca Aurora (`auroraLibraryService`), lançando uma exceção não tratada fatal no processo Main do Electron:

```
ENOENT: no such file or directory, open 'C:\Users\<user>\AppData\Local\Temp\<hash>\resources\app.asar.unpacked\node_modules\sql.js\dist\sql-wasm.js'
```

O aplicativo exibe o diálogo de crash fatal em `bootstrap.ts` e fecha abruptamente.

## Causa raiz

A causa raiz estava na configuração de empacotamento do `electron-builder` combinada com a resolução de módulos do Node.js:

1. **Desempacotamento indevido de scripts JS (`package.json`):**
   No arquivo [`src/electron-app/package.json`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/package.json#L85-L87):
   ```json
   "asarUnpack": [
     "**/node_modules/sql.js/dist/**"
   ]
   ```
   A regra `**/node_modules/sql.js/dist/**` extraía todos os arquivos da pasta `dist/` do `sql.js` para fora do `app.asar` (em `app.asar.unpacked/`). Isso incluía o entrypoint JavaScript do pacote (`sql-wasm.js` e `sql-wasm-browser.js`).

2. **Resolução de `require("sql.js")` em executáveis portáteis:**
   No arquivo [`src/electron-app/infrastructure/sqlHelper.ts`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/infrastructure/sqlHelper.ts#L4):
   ```ts
   import initSqlJs, { SqlJsStatic, Database } from "sql.js";
   ```
   Quando o Node.js carrega `sql.js`, o `package.json` do `sql.js` aponta seu `main` para `./dist/sql-wasm.js`. Como o `sql-wasm.js` havia sido movido para `app.asar.unpacked`, o runtime tentava acessá-lo no caminho `%TEMP%\<hash>\resources\app.asar.unpacked\node_modules\sql.js\dist\sql-wasm.js`.
   No modo portátil (`portable` do electron-builder), a descompactação temporária do executável 7z/NSIS para `%TEMP%` nem sempre extrai ou preserva a estrutura de diretórios `app.asar.unpacked`, ou ocorre concorrência na extração do diretório unpacked antes da chamada do módulo, gerando `ENOENT`.

3. **Inconsistência entre WASM e JS:**
   Apenas o arquivo binário compilado WebAssembly (`sql-wasm.wasm`) necessita ser lido do sistema de arquivos ou carregado como buffer. O arquivo JavaScript (`sql-wasm.js`) deve permanecer embutido com segurança dentro do `app.asar`.

## Resolução Implementada

1. **Restrição do `asarUnpack`:**
   Em [`src/electron-app/package.json`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/package.json#L85-L87), o `asarUnpack` foi restrito estritamente a `"**/node_modules/sql.js/dist/*.wasm"`. Com isso, `sql-wasm.js` permanece empacotado no `app.asar` e sua resolução via `require("sql.js")` funciona de forma atômica e confiável tanto no instalador padrão quanto no executável portátil.

2. **Fallback defensivo para localização do binário WASM:**
   Em [`src/electron-app/infrastructure/sqlHelper.ts`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/infrastructure/sqlHelper.ts), foi criada a função `resolveWasmBinaryPath()` que busca o arquivo `sql-wasm.wasm` em cascata através de múltiplos locais de execução:
   - Relativo ao caminho resolvido de `sql.js` (dentro de `node_modules` ou `app.asar`);
   - Em `app.asar.unpacked/node_modules/sql.js/dist/sql-wasm.wasm` via `process.resourcesPath`;
   - No diretório do app (`app.getAppPath()`);
   - Relativo ao `__dirname` do módulo compilado;
   - Na pasta de `assets` de recursos.
   Caso o arquivo seja encontrado, seu buffer é lido via `fs.readFileSync` e passado diretamente para `initSqlJs({ wasmBinary })`, contornando quaisquer limitações de streaming de arquivos WASM em executáveis portáteis.

3. **Testes Unitários Automatizados:**
   - Adicionado [`src/electron-app/tests/unit/sqlHelper.test.cjs`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/tests/unit/sqlHelper.test.cjs) para testar a inicialização do `sql.js`, queries DDL/DML e conversão de `FILETIME`.
   - Adicionado [`src/electron-app/tests/unit/auroraLibraryService.test.cjs`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/tests/unit/auroraLibraryService.test.cjs) para validar o parsing ponta a ponta dos bancos `content.db` e `settings.db` do Aurora.

4. **Versão:** Bump para `v2.12.42` em todos os 4 pontos obrigatórios e documentado no `CHANGELOG.md`.
