# Bug: "Erro desconhecido" ao adicionar um jogo à fila (diálogo *Destino do jogo*)

- **Detectado em:** 2026-09-05 (relato de usuário com print de tela)
- **Status:** **Resolvido** (v2.12.70)
- **Origem:** `xbox-360-companion/electron-main` (`ipc/browseHandlers.ts::browse:queue-game`) e `electron-renderer` (`BrowsePage.tsx::handleQueue`)
- **Errors (serviço):** nenhum — ver "Telemetria" abaixo
- **Classe:** fail (o jogo não entra na fila)
- **Reincidência:** primeira vez registrada

## Sintoma

No diálogo *Destino do jogo* (aba **Pendrive (USB)**, unidade `E: — Sem nome · 931.2 GB livres`), ao clicar
em **Adicionar à fila** para *Disney Epic Mickey 2 - The Power of Two (Russia) (En,Pl,Ru,Cs,Ar)*
(Xbox 360 · Catálogo Online), a caixa vermelha exibia apenas:

```
Erro desconhecido
```

O jogo não era adicionado à fila e o usuário não tinha nenhuma pista do motivo nem o que corrigir.

## Causa raiz

Três defeitos no mesmo caminho, que se reforçam:

### 1. A recusa do backend Go era invisível para o cliente

[`src/server/interfaces/http/middleware.go:31-36`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/server/interfaces/http/middleware.go)
— `jsonError()` responde **`{"state":"Error","message":"…"}`** com status 4xx/5xx. É a única forma de erro de
`/register` e `/trigger` (29 chamadas em `handlers.go`).

[`src/electron-app/ipc/browseHandlers.ts`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/ipc/browseHandlers.ts)
testava `if (reg.error)` / `if (trig.error)` — chave que essa resposta **nunca** tem. Código morto na prática.
Passavam batido:

| Rota | Status | Mensagem perdida |
|---|---|---|
| `/register` | 400 | `Missing game parameter` / `Missing local_root parameter for local mode` / `Missing ip parameter` / `Invalid IP address format` |
| `/register` | 409 | `O dispositivo local nao esta pronto ou foi desconectado: <erro do disco>` |
| `/register` `/trigger` | 422 | `UnsupportedMultiDiscReason` (multidisco bloqueado) |
| `/trigger` | 400 | `Unknown ROM system: <id>` |
| qualquer | 500 | `Internal server error` (pânico capturado pelo `RecoverMiddleware`) |

O 409 é o mais provável neste relato: `handleRegister` chama `PrepareLocalDevice(localRoot)`
([`services/pipeline/local_resilient.go:109`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/server/services/pipeline/local_resilient.go)),
que grava o marcador `.xbox-downloader/xbox-companion-device-id` na raiz da unidade escolhida. Em disco
somente leitura, sem permissão, ou desconectado no meio, o erro real ficava só no log do backend.

Mesma cegueira nas respostas **200** de "não achei" (`local_unavailable`, `minerva_unavailable`,
`hf_unavailable`): traziam o motivo em `message` e viravam *"Na fila! Status: hf_unavailable"* — sucesso falso.

### 2. `backendGet()` descartava o código HTTP

[`src/electron-app/infrastructure/backendHttp.ts`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/infrastructure/backendHttp.ts)
resolvia com o corpo cru em `res.on("end")`, sem olhar `res.statusCode`. Nenhum chamador conseguia separar
resposta de recusa. Além disso o timeout rejeitava com o literal `new Error("Timeout")` — sem URL, sem porta.

### 3. Nada garantia que a falha tivesse explicação

- `catch (err) { return { ok: false, error: err.message } }`: `err.message` é `undefined` quando o valor
  lançado não é um `Error` com mensagem, produzindo `{ ok: false, error: undefined }`.
- `QueueDialog` preenchia a lacuna com o literal `result.error || "Erro desconhecido"`.
- `handleQueue` **não tinha `try/catch`**: uma rejeição do IPC nunca chegava a `setQueuing(false)` e o botão
  ficava travado em *"Enfileirando…"* indefinidamente.

## Como reproduzir

1. Selecione **Pendrive (USB)** com uma unidade onde a raiz não aceite escrita (disco protegido, sem
   permissão, ou removido logo após a listagem).
2. Clique em **Adicionar à fila**.
3. Antes: `/register` responde 409, o app ignora e chama `/trigger`, e a caixa mostra sucesso falso
   (*"Na fila! Status: triggered"*) ou, quando a rejeição não carrega mensagem, **"Erro desconhecido"**.

## Resolução implementada

1. **`infrastructure/backendFailure.ts` (novo, sem imports do Electron)** — `backendFailureReason()`
   reconhece as três formas de falha (`state`/`message` com 4xx/5xx, `{"ok":false,"error":…}`, e
   `*_unavailable` com 200) e devolve `null` só para sucesso real; `errorMessage()` garante texto não vazio
   para qualquer valor lançado.
2. **`infrastructure/backendHttp.ts`** — `backendGetWithStatus()` devolve `{ status, body }`; `backendGet()`
   virou atalho para o corpo (15 chamadores inalterados). As rejeições passam a nomear código do erro, URL e
   o limite de 120 s.
3. **`ipc/browseHandlers.ts`** — `browse:queue-game` usa a variante com status, valida cada resposta com
   `backendFailureReason()` e envolve o handler inteiro em `try/catch`, de modo que **nunca rejeita**: toda
   saída é um objeto com `error` não vazio.
4. **`renderer/components/BrowsePage.tsx`** — `handleQueue` ganhou `try/catch/finally` (o botão sempre volta
   ao normal) e o literal `"Erro desconhecido"` saiu. Se ainda assim chegar resposta sem motivo,
   `queueFailureReason()` mostra a resposta recebida e reporta à telemetria
   (`electron-renderer` / `BrowsePage.tsx::handleQueue`).
5. **Testes** — `tests/unit/backendFailure.test.cjs` (6 testes) cobre as recusas do Go, os `*_unavailable`,
   os sucessos reais de `/register` e `/trigger`, e a garantia de que nenhuma falha sai sem explicação.
   Suíte: 140/140.
6. **Version bump** — `v2.12.70` nos quatro arquivos, com entrada no `CHANGELOG.md`.

## Achado colateral: pânico no pipeline sem explicação nem telemetria

Nos logs locais (`%APPDATA%/xbox-360-companion-electron/logs/godsend-server-2026-09-02.log:507`):

```
[22:44:28] PANIC processing Grand Theft Auto 5: runtime error: invalid memory address or nil pointer dereference
[22:44:28] STACK: goroutine 29 [running]:
  godsend/interfaces/http.(*Deps).handleTrigger.func1.1.1()   handlers.go:479
  panic(...)
  godsend/services/pipeline.(*Service).ProcessGameWithFallback(...)   fallback.go:54
  godsend/interfaces/http.(*Deps).handleTrigger.func4()   handlers.go:545
```

É o **mesmo caminho** do relato (`source=unified` → `ProcessGameWithFallback`), mas um bug distinto: o
pânico é assíncrono, ocorre depois de `/trigger` já ter respondido `{"status":"triggered"}`, então não
produz a caixa vermelha — produz um jogo parado em erro na fila.

Dois problemas ali, ambos corrigidos nesta versão:

1. O `recover()` gravava `"Server crashed during processing"`, literal que `QueuePage.tsx` renderiza cru
   (`job.message`) — o usuário via o erro sem o motivo. Agora grava `Erro interno ao processar: <pânico>`.
2. Diferente do `RecoverMiddleware`, esse `recover()` **não** chamava `telemetry.Report` — o pânico ficava
   só no log da máquina. Agora é reportado como `http-server` / `handlers.go::handleTrigger.launcher`.

**Não corrigido:** a causa do nil deref em si. `fallback.go` foi reescrito em 2026-09-03 (commit `33ee4fe`,
90 inserções / 107 remoções), um dia depois deste log, e não dá para afirmar pela evidência disponível se
o deref sobreviveu à reescrita. A linha 54 da versão que rodou (`ece2826`) era o `Logf` logo antes de
`s.HuggingFace.Build(platform)`; a guarda `s.HuggingFace != nil` já existia, e `main.go:62` constrói o
serviço com `IA: iaSvc`, então nem o receptor nem `s.IA` explicam o pânico — o offset `+0x107d` sugere
frame inlined. **Fica em aberto**: com a telemetria agora ativa nesse ponto, a próxima ocorrência traz a
stack completa.

## Telemetria

A busca no serviço (`https://digitalstoregames.pythonanywhere.com/admin/errors`, projeto
`xbox-360-companion/*`) **não pôde ser executada nesta sessão**: a leitura do `JWT_SECRET_KEY` em
`digitalstoregamesbackend/.env` foi barrada pelo classificador de permissões do agente — tanto na execução
direta do script quanto pelo subagente `triagem-bugs-prod`.

Vale notar que, **antes desta correção, este bug era invisível na telemetria por construção**: o handler
devolvia um objeto normalmente (`{ ok: false }`), sem exceção e sem rejeição, e só o
`window.addEventListener("unhandledrejection")` de `renderer/main.tsx` reporta automaticamente. A chamada
explícita a `reportError` adicionada em `queueFailureReason()` fecha essa lacuna a partir da v2.12.70.

## Pendências relacionadas (não corrigidas aqui)

- `aurora-scripts/services.lua::registerForFTP` mostra `"Unexpected server response"` sem extrair a
  `message` do JSON — o mesmo antipadrão, no caminho do Aurora. `triggerDownload`, logo acima, já extrai.
- Restam 11 ocorrências de `|| "Erro desconhecido"` em `LibraryPage.tsx`, `SettingsPage.tsx`,
  `ISO2GODPage.tsx` e `ISO2XEXPage.tsx`, em fluxos diferentes deste relato.
