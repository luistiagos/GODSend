# Bug: Crash no processo Main por bloqueio de arquivo (`EBUSY`) ao sincronizar cache inicial

- **Detectado em:** 2026-08-19 02:30 (telemetria de produção)
- **Status:** **Resolvido** (v2.12.43)
- **Origem:** telemetria `xbox-360-companion/electron-main` (`bootstrap.ts::uncaughtException`)
- **Errors (serviço):** 1426 (1 ocorrência)
- **Classe:** crash
- **Reincidência:** primeira vez (versão v2.12.38)

## Sintoma

Durante a inicialização do aplicativo ou na preparação do diretório de runtime gravável (`prepareWritableRuntime`), o processo Main do Electron falhava abruptamente com uma exceção não capturada:

```
EBUSY: resource busy or locked, copyfile 'C:\Users\<user>\AppData\Local\Temp\<hash>\resources\cache\digital.json' -> 'C:\Users\<user>\Downloads\godsend-data\runtime\cache\digital.json'
```

Isso impedia que o aplicativo completasse o boot e acionava o diálogo fatal de `bootstrap.ts`.

## Causa raiz

No arquivo [`src/electron-app/infrastructure/fileSystem.ts`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/infrastructure/fileSystem.ts), a função `copyFileIfMissing` era chamada por `prepareWritableRuntime` para semear os arquivos de cache pré-empacotados (`cache/` contendo `digital.json`, `xbox360.json`, etc.) para a pasta de dados do usuário (`runtime/cache/`):

1. **Ausência de tratamento defensivo de exceções em `fs.copyFileSync`:**
   A chamada `fs.copyFileSync` não estava envolvida em bloco `try / catch`. No Windows, se o arquivo de destino estivesse sendo lido simultaneamente pelo backend Go (`godsend-backend.exe`), por uma instância anterior em fechamento, por indexadores do sistema de arquivos ou por antivírus, o Windows bloqueava o handle de escrita com erro `EBUSY` / `EPERM` / `EACCES`. Como a exceção não era tratada, ela subia para o `process.on("uncaughtException")` em `bootstrap.ts`, abortando a aplicação.

2. **Race condition entre verificação e escrita:**
   A verificação `!fs.existsSync(targetPath)` seguida diretamente de `fs.copyFileSync` criava uma janela de concorrência onde múltiplos processos ou threads (ou o backend em inicialização) abriam ou criavam o arquivo entre a checagem e a tentativa de cópia.

## Resolução Implementada

1. **Tratamento defensivo e retentativas em `fileSystem.ts`:**
   - Em [`src/electron-app/infrastructure/fileSystem.ts`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/infrastructure/fileSystem.ts), `copyFileIfMissing` e `copyDirectoryContentsIfMissing` foram envolvidas em blocos defensivos `try / catch`.
   - Implementado loop de retentativa com backoff (até 3 tentativas) para lidar com bloqueios transitórios de arquivos (`EBUSY`, `EPERM`, `EACCES`, `EEXIST`).
   - Se o arquivo de destino já existir ou for bloqueado por estar em uso ativo, a operação é tratada de forma não-fatal e registrada no log via `appendAppEvent("RUNTIME", ...)`, permitindo que a inicialização do app prossiga normalmente sem acionar o modal de crash.
   - `ensureDirectory` protegido contra exceções de criação simultânea.

2. **Proteção em `appDataPath.ts`:**
   - Em [`src/electron-app/services/appDataPath.ts`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/services/appDataPath.ts), `copyDirRecursive` e `migrateAppData` foram protegidas com blocos `try / catch` individuais em todas as operações de leitura, escrita e remoção de arquivos/pastas.

3. **Fallback seguro em `serverLog.ts`:**
   - Em [`src/electron-app/infrastructure/serverLog.ts`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/infrastructure/serverLog.ts), `logsDirectory()` passou a verificar `app?.getPath` de forma defensiva, provendo fallback para `%APPDATA%` quando executado fora do contexto do Electron (ex: testes unitários e scripts CLI).

4. **Testes Unitários Automatizados:**
   - Criado [`src/electron-app/tests/unit/fileSystem.test.cjs`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/tests/unit/fileSystem.test.cjs) com 4 testes validando criação recursiva, idempotência, cópia de diretórios aninhados e recuperação de erros de arquivos bloqueados (`EBUSY`).

5. **Version Bump:** Atualizado para `v2.12.43` em todos os arquivos de build e documentado no `CHANGELOG.md`.
