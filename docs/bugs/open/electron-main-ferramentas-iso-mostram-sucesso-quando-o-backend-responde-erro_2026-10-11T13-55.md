# Bug: "ISO para XEX" / "ISO para GOD" mostram sucesso (check verde) quando o backend responde erro

- **Detectado em:** 2026-10-11 13:49 (teste local), no controle positivo do bug
  [backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio-...](../retest/backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio-e-extrai-iso-incompleta-sem-erro_2026-10-09T20-20.md)
  (pipeline 20261010-2242)
- **Origem:** `xbox-360-companion/electron-main` (`src/electron-app/ipc/toolsHandlers.ts`: `tools:iso2xex`, `tools:iso2god`, `tools:probe-iso`)
- **Errors (serviço):** N/A (local)
- **Classe:** ux / fail silencioso
- **Severidade:** **P2 - Medio**: o usuário vê sucesso numa conversão que não aconteceu e não recebe o motivo
- **Versões:** 2.12.110 (`origin/main` @ 2e886d2)
- **Reincidência:** mesma classe do bug fechado
  [electron-browse-queue-game-erro-desconhecido-sem-motivo_2026-09-05T12-00](../closed/electron-browse-queue-game-erro-desconhecido-sem-motivo_2026-09-05T12-00.md)
  (`jsonError` responde `{"state":"Error","message":...}`), que foi corrigido só no `browse:queue-game`

## Sintoma

Tela "ISO para XEX", ISO cujo probe falha (`B.iso`, sem `default.xex` legível para o backend da base): a linha
mostra **check verde**, sem "Saída: ..." e sem erro em vermelho; o botão vira "Extrair 0 ISOs para XEX".
Nada foi extraído. A rota respondeu, no mesmo momento:

```
POST /tools/iso2xex -> 500 {"message":"Probe failed: no game executable (default.xex / default.xbe) found in ISO root","state":"Error"}
```

Print: `C:\projects\.bugfix-xbox360\evidencia\20261011-1340-backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio\base-3-result.png`
(e `base-result.json`, campos `body` e `iso2xexB`).

## Causa raiz

- `src/server/interfaces/http/middleware.go::jsonError` escreve `{"state":"Error","message":...}` (sem `error`, sem `ok`).
- `src/electron-app/ipc/toolsHandlers.ts`: `tools:iso2xex` e `tools:iso2god` fazem
  `if (r.error && !r.ok) return { ok: false, ... }; return { ok: true, ...r };` — `r.error` é sempre `undefined`
  numa resposta do `jsonError`, então todo erro do backend vira `ok: true`. `tools:probe-iso`
  (`if (r.error && !r.titleId)`) tem o mesmo defeito (a linha mostra "Desconhecido —" em vez do motivo).
- `renderer/components/ISO2XEXPage.tsx::handleExtract` (e o equivalente do `ISO2GODPage.tsx`) marca
  `state: "done"` quando `r.ok`.

## Como reproduzir

1. Qualquer ISO que o backend recuse (ex.: arquivo `.iso` qualquer sem a assinatura XDVDFS).
2. Ferramentas -> "ISO para XEX" -> "Adicionar ISOs" -> "Pasta de saída" -> "Extrair 1 ISO para XEX".
3. Esperado: erro em vermelho com o `message` do backend. Observado: check verde, pasta vazia.

## Correção sugerida

Nos três handlers, tratar `r.state === "Error"` (ou a falta de `ok`/`titleId`) como falha e devolver
`error: r.message || r.error`. Teste unitário em `tests/unit/` com `backendPost` falso respondendo o formato
do `jsonError`.

## Critérios para fechar
- [ ] ISO recusada mostra erro em vermelho com o motivo nas duas telas (XEX e GOD)
- [ ] Teste unitário dos handlers com a resposta de `jsonError`

## Planejamento (pipeline 20261012-1854, 2026-10-12)

**Veredito:** corrigir — os três handlers `tools:*` de ISO em `toolsHandlers.ts` só tratam como falha uma resposta com `error`, e o `jsonError` do backend nunca manda `error`; a correção é só no Electron main.
**Complexidade:** baixa — validação cuja regra já existe (o formato do `jsonError` já é tratado por `normalizeBackendResp` no mesmo arquivo e por `backendFailureReason`); só faltava aplicá-la nos três handlers de ISO. Nenhuma rota, canal IPC ou tela nova.
**Severidade:** medio — falha num subconjunto (só ISO que o backend recusa), mas o usuário vê sucesso falso (check verde, "Extrair 0 ISOs") e não recebe o motivo; nada é perdido nem gravado errado.
**Arquivos a alterar (reserva da onda):**
- `src/electron-app/ipc/toolsHandlers.ts` — `tools:probe-iso`, `tools:iso2god`, `tools:iso2xex` passam a tratar como falha a resposta sem sucesso explícito, com o `message` do backend como `error`
- `src/electron-app/tests/unit/toolsHandlers.test.cjs` — teste novo dos três handlers (`backendPost` falso)

(`CHANGELOG.md` também muda, fora da reserva conforme o manual. Sem doc-sync: nenhuma rota, IPC, serviço, pasta ou env var nova. O renderer **não** muda: ver Hipóteses descartadas.)

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `src/server/interfaces/http/middleware.go::jsonError` — escreve status 4xx/5xx + `{"state":"Error","message":<msg>}`. Não há `error` nem `ok` no corpo.
- `src/server/interfaces/http/handlers_tools.go::handleToolsProbeISO` — sucesso: 200 + `{titleId, mediaId, discNumber, discCount, isOriginalXbox, displayName}` (sem `ok`, sem `state`). Erro (método, corpo sem `isoPath`, `utils.ProbeISODiscInfo` falha): `jsonError` 405/400/500 (`"Probe failed: ..."`).
- `handlers_tools.go::handleToolsISO2GOD` / `handleToolsISO2XEX` — sucesso: 200 + `{ok:true, titleId, displayName, outputDir}`. Erro (probe, `mkdir`, `RunIso2GodNative` / `ExtractXEXFolderFromISO`): `jsonError` 500 (`"Probe failed: ..."`, `"ISO2GOD failed: ..."`, `"ISO2XEX failed: ..."`). Pânico: `RecoverMiddleware` também responde por `jsonError(500, "Internal server error")`.
- `src/electron-app/infrastructure/backendHttp.ts::backendPost` — resolve com o JSON parseado do corpo **sem olhar o status HTTP**; corpo não-JSON vira `{ error: <texto cru> }` (pode ser `""`); rejeita só em erro de rede/timeout.
- `src/electron-app/ipc/toolsHandlers.ts` (linhas 81-109):
  - `tools:iso2god` / `tools:iso2xex`: `if (r.error && !r.ok) return { ok: false, error: r.error }; return { ok: true, ...r };`. Com o corpo do `jsonError`, `r.error` é `undefined` → cai no `return { ok: true, ...r }` (o spread traz `state:"Error"` e `message`, mas `ok:true` vem antes e o `r` não tem `ok` para sobrescrever) → **sucesso falso**. O `catch` só pega rejeição de rede.
  - `tools:probe-iso`: `if (r.error && !r.titleId) ...` — mesmo defeito: devolve `{ ok:true, state:"Error", message }` e o renderer guarda isso como `info` → a linha mostra `Desconhecido — ` (sem titleId).
  - No mesmo arquivo, `normalizeBackendResp` (linha 182, usado pelos `tools:ftp-delete/mkdir/rename/copy`) já entende `{state:"Error", message}`, mas exige `state === "ok"` para sucesso — as rotas de ISO não mandam `state` no sucesso, então **não dá para reutilizá-lo como está** (todo sucesso viraria `"Unknown error"`).
- `src/electron-app/renderer/components/ISO2XEXPage.tsx::handleExtract` e `ISO2GODPage.tsx::handleConvert` — `if (r.ok)` marca `state:"done"` com `outputDir: r.outputDir` (undefined → sem linha "Saída"); senão `state:"error"` com `error: r.error || "Falha na extração"/"Falha na conversão"`, mostrado em vermelho por `IsoRow`. **Já fazem a coisa certa quando recebem `ok:false` com `error`**: o defeito é só no handler.
- `ISO2XEXPage.tsx::handleSelectISOs` / `ISO2GODPage.tsx::handleSelectISOs` — probe: `info: result.ok ? result : null`. Com o handler corrigido, probe recusado → `info: null` → a linha deixa de mostrar "Desconhecido —" (não mostra o motivo até a extração, que mostra).
- Call-sites (prova de fluxo): `preload.ts:120-122` (`toolsProbeIso`, `toolsIso2God`, `toolsIso2Xex` → `ipcRenderer.invoke("tools:probe-iso"|"tools:iso2god"|"tools:iso2xex")`); únicos consumidores no renderer: `ISO2XEXPage.tsx` e `ISO2GODPage.tsx` (grep em `src/electron-app` sem `node_modules`).

### Provas (comando literal -> resultado)

- Controle positivo do bug irmão (execução 20261010-2242), `C:\projects\.bugfix-xbox360\evidencia\20261011-1340-backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio\base-result.json`:
  `python -c "import json;d=json.load(open('base-result.json',encoding='utf-8-sig'));print(d['iso2xexB'])"` ->
  `{'status': 500, 'body': '{"message":"Probe failed: no game executable (default.xex / default.xbe) found in ISO root","state":"Error"}\n'}`; o campo `body` (texto da tela no mesmo instante) traz `B.iso` / `Desconhecido –` / `Extrair 0 ISOs para XEX`, sem "Saída" e sem erro vermelho para `B.iso`.
- O mesmo `B.iso` **não serve mais de controle**: com o fix do xdvdfs (já no `origin/main`), `fix-result.json` e `god-result.json` dão `iso2xexB = {'status': 200, 'body': '{"displayName":"Halo 3","ok":true,...}'}`. O teste precisa de uma ISO que qualquer backend recuse (ver Plano de teste).
- `grep -n "func jsonError" -A4 src/server/interfaces/http/middleware.go` -> `json.NewEncoder(w).Encode(map[string]string{"state": "Error", "message": message})`.
- `git ls-files src/electron-app/renderer-dist | head -3` -> 3 arquivos rastreados (`assets/index-*.css`, `index-*.js`, `tray-*.ico`): o `renderer-dist` é versionado (o manual diz gitignored; não é). Motivo extra para não tocar o renderer.

### Hipoteses descartadas (e por que)

- **Reusar `normalizeBackendResp`** (mesmo arquivo): exige `state === "ok"` para sucesso; `/tools/probe-iso` e `/tools/iso2*` não mandam `state` no sucesso → todo sucesso viraria falha "Unknown error".
- **Reusar `infrastructure/backendFailure.ts::backendFailureReason`**: recebe `{status, body}` cru; `backendPost` já perdeu o status e parseou o corpo. Remontar `{status:200, body: JSON.stringify(r)}` é gambiarra e erra o caso não-JSON vazio (`{error:""}` → `error` falsy → status 200 → tratado como sucesso). Trocar o transporte para um `backendPostWithStatus` mexe em `backendHttp.ts` (compartilhado por muitos handlers) por um ganho que a checagem explícita do sucesso já dá.
- **Mudar o backend Go para mandar `error`/`ok:false`**: `jsonError` é usado por todas as rotas; outros clientes (Android, Aurora) leem `state`/`message`. O contrato do Go é o documentado no `AGENTS.md` (`backendFailure.ts`: "três formas de falha"); o defeito é o cliente não segui-lo.
- **Mostrar o motivo do probe já na seleção** (mudar `handleSelectISOs` nas duas páginas para guardar `error` quando o probe falha): melhoria de UX fora do critério de fechamento (o motivo aparece em vermelho na extração), e arrasta `ISO2XEXPage.tsx` + `ISO2GODPage.tsx` + o `renderer-dist` versionado (conflito com qualquer outra lane que mexa no renderer). Com o handler corrigido, a linha enganosa "Desconhecido —" já some.
- **"Tratar `r.state === "Error"`" (a correção sugerida no doc) como único critério**: frágil; corpo não-JSON (`{error:""}`) ou resposta inesperada sem `ok` continuaria virando sucesso. Melhor exigir o sinal positivo de sucesso de cada rota (`ok === true` / `titleId`).

### Tarefas

- [ ] `src/electron-app/ipc/toolsHandlers.ts` — handlers `tools:iso2god` e `tools:iso2xex`: sucesso só quando `r && r.ok === true`; senão `return { ok: false, error: String(r?.message || r?.error || "o servidor local não confirmou a conversão") }` (texto do fallback livre, não vazio). `tools:probe-iso`: sucesso só quando `r && r.titleId`; senão o mesmo formato de falha com `r.message || r.error`. Manter o `catch` como está. Comentário citando `[[electron-main-ferramentas-iso-mostram-sucesso-quando-o-backend-responde-erro_2026-10-11T13-55]]` e o formato do `jsonError`. — prova: o teste abaixo.
- [ ] `src/electron-app/tests/unit/toolsHandlers.test.cjs` (novo) — carregar `ipc/toolsHandlers.js` (gerado pelo `tsc` do `test:safety`) com o padrão de `tests/unit/browseHandlers.test.cjs` (`Module` + `require` com mocks). Mockar **também `electron`** (`{ dialog:{}, BrowserWindow:{}, shell:{} }`: este arquivo importa valores do electron, o `browseHandlers` só tipo), `../services/settingsService` (`getConfiguredXboxIP`), `../services/backendClient` (`addOutputLine`), `../infrastructure/backendHttp` (`backendPost` falso, `backendGet`), `../app/window` (`getMainWindow`), `../services/autoSyncService` (`doAuroraLibrarySync`). Casos, para cada um dos 3 canais:
  1. `{state:"Error", message:"Probe failed: X"}` → `ok:false`, `error` contém `Probe failed: X` (o caso do bug; falha sem o fix);
  2. `{error:""}` (corpo não-JSON vazio) → `ok:false` com `error` não vazio;
  3. sucesso real (`{ok:true, titleId, displayName, outputDir}` para iso2*; `{titleId:"4D5307E6", displayName:"Halo 3", ...}` para probe) → `ok:true` e os campos preservados (`outputDir`, `titleId`);
  4. `backendPost` rejeitando `new Error("ECONNREFUSED")` → `ok:false`, `error` com `ECONNREFUSED`.
  Antes de commitar, provar que o caso 1 FALHA com o handler antigo (reverter o handler localmente e rodar o teste).
- [ ] `CHANGELOG.md` — `## [Unreleased]` / `### Fixed`, com o porquê, `ipc/toolsHandlers.ts::tools:iso2xex|iso2god|probe-iso` e o link do doc.

### Plano de teste

- **Offline (sem slot):** `npm --prefix src/electron-app run test:safety` (roda `tsc` + `renderer:typecheck` + `node --test tests/unit/*.test.cjs`): o `toolsHandlers.test.cjs` novo passa; com o handler antigo, o caso 1 falha (registrar a saída das duas rodadas).
- **T2 reproducao como o usuario (E2E, no slot):** app da lane em modo dev (Playwright `_electron.launch` sobre `src/electron-app` da lane; partir dos scripts `t2.js` e `t3god.js` da evidência `C:\projects\.bugfix-xbox360\evidencia\20261011-1340-backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio\scripts\`, copiados para a evidência nova). Estado de partida: `config.json` do userData copiado para a evidência; pasta de saída local vazia `<evidencia>\out-<label>`; duas ISOs: `A.iso` daquela evidência (válida, controle de sucesso) e **`Z.iso` = 1 MiB de zeros** (`python -c "open(r'<evidencia>\isos\Z.iso','wb').write(bytes(1<<20))"`), que o backend recusa em `ProbeISODiscInfo` (sem partição/volume XDVDFS) — **não usar o `B.iso` antigo**, que o backend atual já extrai. Ações: Ferramentas → "ISO para XEX" → "Adicionar ISOs" (as duas, pelo dialog mockado como no `t2.js`) → "Pasta de saída" → "Extrair 2 ISOs para XEX"; depois o mesmo em "ISO para GOD" → "Converter 2 ISOs para GOD". Sinais com o fix: linha `Z.iso` com ícone de alerta e texto vermelho começando com `Probe failed:`; sem "Saída:" para `Z.iso`; botão continua contando `Z.iso` como pendente ("Extrair 1 ISO para XEX" / "Converter 1 ISO para GOD"); nenhuma pasta nova em `out-<label>` para `Z.iso`; linha `A.iso` com check verde e "Saída: ..." (pasta criada). Complemento (não substituto): `POST /tools/iso2xex` com `Z.iso` → 500 `{"state":"Error","message":"Probe failed: ..."}`. Screenshot da janela (`page.screenshot`) nas duas telas.
- **Controle positivo:** o mesmo T2 com o código da base (sem o fix): `Z.iso` com check verde, sem "Saída", sem texto vermelho, botão "Extrair 2 ISOs para XEX" → "Extrair 0 ISOs para XEX" (GOD: "Converter 0 ISOs para GOD") (mesmo sinal da evidência 20261011-1340 `base-3-result.png`). Como não há `deploy --at-base` neste projeto, o controle sai de reverter só `toolsHandlers.ts` na lane (ou rodar antes do commit do fix) — registrar qual SHA/estado foi usado.
- **T3 regressao direcionada:** (a) conversão de ISO válida continua com sucesso e "Saída" nas duas telas (`A.iso` no T2); (b) os canais FTP do mesmo arquivo não mudam (`tools:ftp-delete/mkdir/rename/copy` usam `normalizeBackendResp`, intocado) — coberto pelo `test:safety`; (c) bateria do manual: `go test -count=1 ./...` em `src/server` e `npm --prefix src/electron-app run test:safety`, sem `fail` novo contra a linha de base (Go 9 `ok`; `test:safety` 258 pass + os testes novos).
- **T4:** logs do app dev (`%APPDATA%\xbox-360-companion-electron\logs\`) e console do backend na Home: as linhas `[TOOLS] ISO2XEX/ISO2GOD` de `A.iso`; nenhum erro novo atribuível ao fix.

### Sessoes seguintes

- dev: effort low, ultrathink nao — troca mecânica e localizada em 3 handlers de um arquivo, mais um teste no padrão já existente (`browseHandlers.test.cjs`); a análise do formato de cada rota está acima.
- teste: effort medium, ultrathink nao — reaproveita os scripts Playwright da evidência irmã; o único ponto de atenção é usar uma ISO que o backend atual recuse (`Z.iso` de zeros) e fazer o controle positivo revertendo só o handler.

**Achado lateral (doc próprio):** [electron-main-gerenciador-ftp-descarta-o-motivo-do-backend-ao-listar-enviar-e-mover-jogo_2026-10-12T19-00](electron-main-gerenciador-ftp-descarta-o-motivo-do-backend-ao-listar-enviar-e-mover-jogo_2026-10-12T19-00.md) — `tools:ftp-list`, `tools:ftp-upload` e `xbox:move-game` repassam o corpo cru do `jsonError`; fora do escopo deste fix.
