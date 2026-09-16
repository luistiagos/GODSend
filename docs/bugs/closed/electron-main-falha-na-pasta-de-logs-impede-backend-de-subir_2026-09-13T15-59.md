# Bug: falha ao criar a pasta de logs derruba a inicialização do backend

- **Detectado em:** 2026-09-13 15:59 (telemetria de produção)
- **Status:** **Resolvido** (v2.12.95)
- **Origem:** telemetria `xbox-360-companion/electron-main` (`bootstrap.ts::uncaughtException`) e `xbox-360-companion/electron-renderer` (`main.tsx::unhandledrejection`)
- **Errors (serviço):** 6275 + 6274 (máquina 1, 2026-09-13 15:59:15); 6642 + 6643 (máquina 2, 2026-09-15 01:13:19) — 4 reports, 2 incidentes
- **Classe:** crash (diálogo "GODsend crashed"; o backend não é iniciado)
- **Versões:** ElectronApp v2.12.81; o trecho está igual no código atual (v2.12.93)
- **Reincidência:** 2 máquinas diferentes em 2 dias

## Sintoma

```
Error: ENOENT: no such file or directory, mkdir 'C:\Users\<user>\Downloads\godsend-data\logs'
    at mkdirSync (node:fs:1350:26)
    at ensureLogDir (...\resources\app.asar\infrastructure\serverLog.js:61:18)
    at getLogInfo   (...\resources\app.asar\infrastructure\serverLog.js:144:5)
    at startGodsend (...\resources\app.asar\services\backendClient.js:85:69)
    at WebContents.<anonymous> (...\resources\app.asar\app\bootstrap.js:172:46)
    at Object.onceWrapper (node:events:631:26)
```

No mesmo segundo, a interface recebe o espelho do mesmo erro:

```
Error: Error invoking remote method 'logs:get-info': Error: ENOENT: no such file or directory, mkdir '...\godsend-data\logs'
```

## Causa raiz

Uma pasta **opcional** — a de logs — é tratada como obrigatória no caminho que sobe o
backend.

- `serverLog.ts:58-60` — `ensureLogDir()` é um `fs.mkdirSync` puro, que lança.
- As funções de **gravação** protegem a chamada: `appendLine` (`serverLog.ts:62-79`) e
  `appendBackendSessionStart` envolvem tudo em `try/catch` e só fazem `console.error`.
- `getLogInfo()` (`serverLog.ts:158-164`) **não** protege: chama `ensureLogDir()` e deixa a
  exceção subir.
- `startGodsend()` chama `getLogInfo()` só para montar uma linha informativa
  (`backendClient.ts:108`: `[INFO] Server logs: ...`), **antes** do `spawn` do backend
  (`backendClient.ts:136`).
- `startGodsend()` roda dentro de `webContents.once("did-finish-load")`
  (`bootstrap.ts:180-181`), sem `try/catch`, então a exceção vira `uncaughtException`
  (`bootstrap.ts:25`) e o backend **nunca é iniciado**. O handler ainda tenta
  `getLogInfo().currentLogFile` (`bootstrap.ts:43`) para citar o arquivo no diálogo — que
  lança de novo, e só não piora porque está num `try/catch`.
- `logs:get-info` (`configHandlers.ts:70`) repassa a mesma exceção para o renderer.

Ou seja: não conseguir **escrever log** impede o app de **funcionar**.

### Por que a pasta falhou (ambiente, não confirmado)

A falha é transitória: o mesmo processo já tinha chamado `getLogInfo()` com sucesso
segundos antes, no `app ready` (`bootstrap.ts:169`) — senão o erro teria saído de lá, não
do `did-finish-load`. `mkdirSync(..., { recursive: true })` só dá `ENOENT` numa pasta que
já existe se algum componente do caminho sumiu naquele instante (pasta `Downloads`
redirecionada para um volume que caiu, sincronização em nuvem, limpeza de terceiros). 25 s
depois do incidente da máquina 1, um backend recusou `D:\godsend-temp` com
`The device is not ready` (6276, ver
[`backend-volume-temp-autoselecionado-indisponivel-derruba-backend`](../open/backend-volume-temp-autoselecionado-indisponivel-derruba-backend_2026-09-13T15-59.md)).
Esse report não traz log nem usuário, então não dá para afirmar que é a mesma máquina — só
que a coincidência de minuto é compatível com um volume instável.

A causa ambiental não muda o defeito: a pasta de logs pode falhar, e o app não deveria cair
por isso.

## Como reproduzir

1. Apontar o `userData` para uma pasta cujo pai possa ser removido (ou fazer `logsDirectory()`
   devolver um caminho em drive inexistente, ex.: `Q:\x\logs`).
2. Abrir o app e, entre o `app ready` e o `did-finish-load`, remover o pai.
3. Observado: diálogo "GODsend crashed", nenhum `APP_BACKEND spawned`. Esperado: backend
   sobe; logs só não são gravados.

## Correção (v2.12.95)

1. **`getLogInfo()` virou getter puro** (`serverLog.ts`): não chama mais `ensureLogDir()`,
   só monta e devolve `logsDirectory` e `currentLogFile`. Nenhum I/O, logo não lança. Criar
   a pasta continua sendo trabalho de quem grava — `appendLine`,
   `appendBackendSessionStart`, `appendBackendSessionEnd` e `openLogsFolder` já envolviam o
   `mkdir` em `try/catch`. Isso fecha, de uma vez, os quatro chamadores que estavam
   desprotegidos: `backendClient.ts` (a linha `[INFO] Server logs:`), `bootstrap.ts` no
   `app ready`, `bootstrap.ts:43` dentro do próprio handler de crash, e o handler IPC
   `logs:get-info` (`configHandlers.ts`), que repassava a exceção ao renderer — de onde
   saía o `unhandledrejection` de `App.tsx:108`, que não tem `.catch`.
2. **`backendClient.ts:108` deixou de depender de I/O** como consequência do item 1: a linha
   de `[INFO]` agora só lê caminhos em memória. Nenhuma mudança no arquivo.
3. **Subir o backend ganhou um ponto de entrada protegido** (`backendClient.ts`):
   `startGodsendSafely()` grava a exceção no log (`appendAppEvent`), reporta à telemetria e
   mostra `[ERROR] Could not start the backend: ...` no painel de saída, em vez de virar
   `uncaughtException` com o backend parado. `startGodsend()` deixou de ser exportado.
   O `did-finish-load` não era o único chamador desprotegido: `restartGodsendIfRunning()`
   chamava `startGodsend()` dentro de um `setTimeout` — exceção em callback de timer também
   é `uncaughtException` fatal —, e as 16 opções de `configHandlers.ts` que reiniciam o
   backend passam por ali; os handlers IPC `godsend:start` e `godsend:restart` tinham o
   mesmo furo, ali virando `unhandledrejection` no renderer. Os quatro passam pelo guard.
4. **Teste:** `src/electron-app/tests/unit/serverLogResilience.test.cjs` — com
   `fs.mkdirSync` e `fs.appendFileSync` lançando `ENOENT`, `getLogInfo()` devolve os dois
   caminhos, nenhuma das seis funções de gravação lança, e `openLogsFolder()` devolve
   `{ ok: false, error }`. Verificado que o teste falha contra o código anterior.

### O que continua aberto

A causa **ambiental** — por que a pasta `godsend-data` sumiu naquele instante — não foi
diagnosticada e não é diagnosticável pelos reports existentes. O app apenas deixou de cair
por causa dela: o backend sobe e os logs daquela sessão simplesmente não são gravados. Se o
volume continuar instável, o sintoma visível passa a ser o do bug vizinho
([`backend-volume-temp-autoselecionado-indisponivel-derruba-backend`](../open/backend-volume-temp-autoselecionado-indisponivel-derruba-backend_2026-09-13T15-59.md)),
que trata do `Temp` e segue aberto.

## Próximos passos (originais)

1. `getLogInfo()` não deve lançar: devolver os caminhos e deixar a criação para quem grava
   (que já é tolerante). Se preferir manter o `mkdir`, envolver em `try/catch`.
2. `backendClient.ts:108` não deve depender de I/O para imprimir uma linha de `[INFO]`.
3. `startGodsend()` no `did-finish-load` com `try/catch` que reporte e mostre erro na
   interface, em vez de `uncaughtException` com o backend parado.
4. Teste unitário: com `fs.mkdirSync` lançando `ENOENT`, `getLogInfo()` retorna e
   `appendLine` não lança.
