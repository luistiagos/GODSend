# Bug: BrowsePage oculta erro real de comunicação com o backend ("Não foi possível acessar o servidor. Verifique se o serviço do GODsend está em execução"), engole o erro sem diagnóstico e não emite telemetria

- **Detectado em:** 2026-09-24 21:30 (chamado #73 do painel, sessão `204981760167962@lid`)
- **Origem:** conversa de suporte + telemetria (reports 8504/8505) + leitura do fonte de `BrowsePage.tsx::loadGames`, `browseHandlers.ts::browse:get-games` e `backendHttp.ts::backendGetWithStatus`
- **Classe:** diagnóstico / falha funcional
- **Severidade:** **P1 — Alto** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): bloqueio total da funcionalidade principal de catálogo de jogos e download. O cliente preparou o pendrive com sucesso mas ficou totalmente impossibilitado de baixar jogos; gerou abertura de chamado #73
- **Complexidade:** **baixa** — expor `r.error` na UI do `BrowsePage.tsx`, registrar falha em `app.log` / telemetria e usar `127.0.0.1` em vez de `localhost` no `backendHttp.ts`
- **Versões:** presente na v2.12.98 / v2.12.100; corrigido na **v2.12.101**
- **Reincidência:** primeira vez registrada (análogo ao caso resolvido em [[electron-browse-queue-game-erro-desconhecido-sem-motivo_2026-09-05T12-00]], que tratou o diálogo de enfileiramento mas deixou a listagem inicial desprotegida)

## Sintoma, na ordem que o cliente viveu

1. O cliente concluiu com sucesso a formatação e preparação do pendrive USB no Xbox 360 Companion (`[121810]` *"Ok já finalizado"*, print `[121812]`).
2. Conforme orientado pelo agente, clicou em **"ir para o catálogo de jogos"** / **"Browse & Download"** para baixar o jogo no pendrive recém-preparado.
3. A tela do catálogo não abriu nenhuma lista de jogos. Em vez disso, exibiu o overlay central com ícone de Wi-Fi desconectado e o texto:
   ```
   Não foi possível acessar o servidor.
   Verifique se o serviço do GODsend está em execução.
   [ Tentar de novo ]
   ```
   (Prints enviados em `[121820]`, `[121833]`, `[121849]`).
4. Ao clicar no botão **"Tentar de novo"**, a mesma tela retornou imediatamente.
5. O agente orientou fechar o Avast (que estava ativo na máquina), rodar o Companion como administrador e reiniciar o computador (`[121822]`, `[121836]`).
6. O cliente reiniciou o PC, abriu novamente o Companion como administrador, mas ao tentar acessar o catálogo: *"Apareceu a mesma coisa"* (`[121846]`).
7. Nenhum código de erro (seja `ECONNREFUSED`, `ETIMEDOUT`, `EPERM` ou falha de porta) foi mostrado na tela, impossibilitando suporte e cliente de entender se o processo do Go backend caiu, se a porta foi bloqueada ou se houve recusa de firewall. O caso foi escalado e originou o chamado #73.

## Evidência

### 1. Conversa do chamado #73 (`Wpp_proccess`, sessão `204981760167962@lid`)

| id | dttime | role | mensagem / evidência |
|---|---|---|---|
| 121810 | 24/09 21:13:08 | customer | *"Ok já finalizado"* (pendrive preparado) |
| 121812 | 24/09 21:13:30 | customer | Print da tela de pendrive pronto com BadAvatar + Aurora |
| 121813 | 24/09 21:13:41 | XBOX360_AGENT | *"Agora vamos baixar o jogo. No Companion, procura a opção Browse & Download ou Catálogo..."* |
| 121820 | 24/09 21:19:01 | customer | Print: *"Não foi possível acessar o servidor. Verifique se o serviço do GODsend está em execução."* |
| 121822 | 24/09 21:19:21 | XBOX360_AGENT | *"Esse erro é do serviço de download do Companion, e quase sempre é o antivírus que está bloqueando ele..."* |
| 121833 | 24/09 21:22:44 | customer | Print com o mesmo erro após tentar reabrir |
| 121835 | 24/09 21:23:15 | customer | *"Não foi possível acessar o servidor"* → abertura do chamado #73 |
| 121836 | 24/09 21:23:40 | XBOX360_AGENT | Orientação para reiniciar o computador e executar como administrador |
| 121846 | 24/09 21:30:50 | customer | *"Apareceu a mesma coisa"* |
| 121849 | 24/09 21:31:38 | customer | Print idêntico confirmando persistência do erro |

### 2. Telemetria de produção (banco `errors` / `error_logs`)

No mesmo período (21:29 – 21:35 UTC), a máquina do usuário registrou os reports **8504** e **8505** (`xbox-360-companion/electron-main`):
- `platform`: `win32/x64/10.0.19045` (Windows 10)
- `user_agent`: `ElectronApp v2.12.98`
- `execPath`: `C:\Users\Admin\AppData\Local\Temp\nsq749.tmp\app\Xbox360Companion.exe`
- O backend Go foi iniciado: `ELECTRON_UI [INFO] Starting: C:\Users\Admin\AppData\Local\Temp\nsq749.tmp\app\godsend-backend.exe`, `APP_BACKEND spawned pid=2588`.
- No entanto, a máquina apresentava interferência severa de antivírus (Avast, capturas `[121723]` e `[121736]`), culminando em timeout na listagem USB do Windows (`APP_USB enumeração nativa falhou: O Windows demorou demais para listar os dispositivos USB`).
- Crucialmente: **NÃO existia nenhum registro em `errors` referente à falha do catálogo / browse**. O erro que o usuário viu na tela era 100% invisível na telemetria.

## Causa raiz

Confirmada no código-fonte em três pontos encadeados:

### 1. `BrowsePage.tsx` descartava o erro retornado pelo IPC
Em `src/electron-app/renderer/components/BrowsePage.tsx`:
```typescript
const r = await window.godsendApi.browseGetGames({ platform, source });
if (!r.ok) {
  setStatus("error");
  return;
}
```
O objeto `r` continha `{ ok: false, error: string }`, mas `r.error` era descartado e `status` virava `"error"`, renderizando um texto estático e genérico sem qualquer código de erro ou instrução de diagnóstico.

### 2. `browseHandlers.ts` silenciava o erro sem log nem telemetria
Em `src/electron-app/ipc/browseHandlers.ts`:
O handler `browse:get-games` capturava a exceção de rede mas não registrava nada em `appendAppEvent` e não disparava `reportError`, deixando o suporte e os desenvolvedores cegos perante as falhas do catálogo em clientes com bloqueio de porta/antivírus.

### 3. Fragilidade de conexão loopback com `localhost`
Em `src/electron-app/infrastructure/backendHttp.ts`:
`backendGetWithStatus` conectava em `http://localhost:${port}`. No Windows (Node.js 18+), `localhost` pode resolver primeiro para o endereço IPv6 `::1`, enquanto o servidor Go (`src/server/main.go`) escuta especificamente em `127.0.0.1` (IPv4). Isso gerava `ECONNREFUSED` imediato ou bloqueios de firewall/antivírus local.

## Correção aplicada

1. **Hardening de loopback IPv4 (`infrastructure/backendHttp.ts`)**:
   - Substituição de `localhost` pela constante explícita `127.0.0.1` em todas as rotas HTTP locais (`backendGetWithStatus`, `backendGet`, `backendPost`).
   - Normalização dos objetos de erro de rede e timeout, preservando `code` (`ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`), endereço `127.0.0.1` e porta no erro.
   - Atualização das rotas da fila (`xbox:get-queue`, `xbox:remove-queue-item`, `xbox:retry-queue-item`) em `ipc/browseHandlers.ts` de `localhost` para `127.0.0.1`.

2. **Telemetria e Logging granular (`ipc/browseHandlers.ts`)**:
   - `browse:get-games`: verificação de status HTTP da resposta; detecção de respostas de erro JSON; registro com `appendAppEvent("BROWSE", ...)` e despacho automático de telemetria via `reportError("electron-main", "browseHandlers.ts", "browse:get-games", ...)`.
   - `browse:get-release-groups`: captura e log estruturado via `appendAppEvent("BROWSE", ...)`.

3. **Exibição da Causa Real e Ações de Recuperação (`renderer/components/BrowsePage.tsx`)**:
   - Criação do estado `loadError` preservando a mensagem técnica exata (código de erro, endpoint, porta).
   - Renderização em bloco estilizado monospace (`select-text`) com `role="alert"`.
   - Inclusão de orientações claras sobre antivírus (Avast, Defender) e firewall.
   - Botões de ação direta: **Tentar de novo**, **Reiniciar serviço** (`window.godsendApi.restartProcess`) e **Abrir pasta de logs** (`window.godsendApi.openLogsFolder`).

## Testes Automatizados

1. **`tests/unit/backendHttp.test.cjs` (6 testes, aprovados)**:
   - Valida que `backendGetWithStatus`, `backendGet` e `backendPost` alcançam listener IPv4 em `127.0.0.1`.
   - Confirma que recusa de conexão preserva `ECONNREFUSED`, endereço e porta.
   - Confirma que timeout de 120s mantém o código `ETIMEDOUT` mesmo com `destroy`.
   - Confirma rejeição de conexões truncadas com `ECONNRESET`.

2. **`tests/unit/browseHandlers.test.cjs` (6 testes, aprovados)**:
   - Valida reporte de erro para telemetria e `appendAppEvent` em falha de conexão.
   - Valida recusa de códigos HTTP 4xx/5xx sem transformar corpo em nome de jogos.
   - Valida tratamento de JSON error replies com HTTP 200.
   - Valida integridade do catálogo local e remoto.

3. **`tests/electron/browse-errors-smoke.cjs` (5 cenários Playwright/Chromium, aprovados)**:
   - Cenário 1: Falha do catálogo online exibe diagnóstico detalhado.
   - Cenário 2: Clique em "Tentar de novo" retoma operação normal.
   - Cenário 3: Falha no IPC reporta telemetria e exibe motivo da falha.
   - Cenário 4: Falha da biblioteca local com 0 jogos exibe tela de erro.
   - Cenário 5: Biblioteca local preserva jogos instalados em caso de falha de conexão.

4. **Suíte completa de segurança (`npm run test:safety`)**:
   - `tsc` e `renderer:typecheck` 100% limpos.
   - **233 testes unitários aprovados, 0 falhas**.
   - `npm run renderer:build` executado com sucesso (Vite build limpo).

## Critérios para fechar

- [x] Reprodução confirmada e compreendida (chamado #73 e reports 8504/8505).
- [x] Causa raiz isolada e corrigida em loopback, telemetria e UI.
- [x] Testes unitários e smoke test automatizados cobrindo os cenários de erro.
- [x] Bump de versão para `2.12.101` sincronizado nos 4 arquivos obrigatórios e `CHANGELOG.md`.
