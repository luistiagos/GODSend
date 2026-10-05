# Bug: a varredura de jogos instalados roda síncrona no processo principal e congela a janela ("Não está respondendo") a cada ~15 s com um HD externo cheio — e o congelamento produz o falso "O Windows ainda está reconhecendo seu pendrive ou HD"

- **Detectado em:** 2026-10-05 17:25 (chamado #133 do painel, sessão `272077621866729@lid`, telefone `556496012345`)
- **Origem:** conversa de suporte + reports de telemetria `9324` e `9325` (`xbox-360-companion/electron-main`, `tools:badavatar-list-drives`) + leitura de `src/electron-app/services/localGameScannerService.ts` (`scanUsbAndLocalGames`, `scanDriveRoot`, `parseGameFolder`, `getDirectorySizeBytes`), `src/electron-app/ipc/browseHandlers.ts` (handler `browse:get-installed-games`), `src/electron-app/renderer/App.tsx` (`refreshUsbGamesCount`), `src/electron-app/renderer/components/HomePage.tsx` (`checkPreparedDevice`) e `src/electron-app/infrastructure/windowsUsbDeviceService.ts` (`runPowerShell`)
- **Classe:** falha funcional (a janela para de responder; o fluxo de gravação em HD não anda)
- **Severidade:** **P1 — Alto** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): para quem tem um HD externo com biblioteca grande, o app fica congelado ~77% do tempo e o caminho de gravação local fica bloqueado. Custo medido neste chamado: ~1h40 de tentativas, três reinícios do app, o cliente culpou o próprio computador e desistiu do Companion. O alcance (quantos clientes) **não está medido** — ver "O que falta medir"
- **Complexidade:** média — tirar a varredura do processo principal (ou torná-la assíncrona e incremental) e parar de disparar varredura completa por contador de tela
- **Versões:** observado na **v2.12.106** (a mais recente em 2026-10-03; `current=2.12.106, latest=2.12.106` no log). O arquivo do scanner não muda desde `a1058cf` (2026-09-09); HEAD lido: `9b24e64` (2026-10-05)
- **Reincidência:** a **mensagem** é a mesma da família fechada em [`enumeracao-usb-timeout-e-dispositivo-mudou-desde-a-selecao_2026-09-08T00-00.md`](../closed/enumeracao-usb-timeout-e-dispositivo-mudou-desde-a-selecao_2026-09-08T00-00.md); a **causa** aqui é outra e aquelas correções (cache da lista, instância única, `fresh: false` no mount) não a alcançam

## Sintoma, na ordem que o cliente viveu

Horários em UTC, como estão no banco e no log (Brasil = UTC−3). Console RGH com Aurora; HD
externo em `D:` já com conteúdo (o print `[129782]` mostra, na raiz, `_xbox-downloader`,
`EMULADORES` e `Xbox Games 360`, entre outros).

1. 15:16 — o agente manda baixar o Companion para gravar os jogos no HD (`[129708]`).
2. 15:33 — *"Vou baixar aqui e já te falo, só um segundo"* (`[129720]`).
3. 16:35 — *"Está demorando bastante, será que tem outra forma?"* com print da faixa de erro
   **"O Windows ainda está reconhecendo seu pendrive ou HD. Aguarde alguns instantes e clique
   no botão 'Atualizar'..."** (`[129768]`). O HD estava montado e legível: às 17:11 o cliente
   confirma *"Letra d"* (`[129780]`) e manda o Explorer aberto em `D:` (`[129782]`).
4. 17:09 — *"Não rodou mesmo, tem outra forma?"* (`[129778]`).
5. 17:15 — *"Acho que o problema aqui é computador, está travando com o Xbox companion"*
   (`[129784]`) e, 28 s depois, print da janela com **"(Não está respondendo)"** na barra de
   título, parada no passo de escolha do console, com o botão em **"Verificando pendrive..."**
   (`[129786]`).
6. 17:19 — *"Acho que é o computador mesmo, fica muito lento"* (`[129789]`).
7. 2026-10-04 16:53 — no dia seguinte, nova tentativa: *"Ele só fica travando, não roda"*
   (`[130659]`). O cliente abandona o Companion.

## Evidência

### 1. Os dois reports de telemetria são desta máquina, nesta janela de tempo

| report | hora (UTC) | versão | mensagem |
|---|---|---|---|
| `9324` | 2026-10-03 15:44:27 | ElectronApp v2.12.106, win32/x64/10.0.19045 | `O Windows ainda está reconhecendo seu pendrive ou HD...` |
| `9325` | 2026-10-03 17:22:53 | idem | idem |

Os dois logs anexos vêm do mesmo host (`hostname: TERMINAL759`, `userData=C:\Users\Unifar\Downloads\godsend-data`).
A ligação com o cliente é por **correlação temporal**, não por identificador (a telemetria não
carrega telefone): o app sobe às 15:40:55, 7 min depois do "vou baixar"; a faixa de erro do print
das 16:35:16 tem linha correspondente às 16:34:29; e os três reinícios do app no log (17:14:10,
17:19:08, 17:22:31) batem com as orientações de fechar/reabrir que o agente deu às 17:15 e 17:19.
Nenhum outro report do Companion com essa mensagem existe naquela janela.

### 2. O processo principal fica mudo 70–105 s, em ciclos, enquanto o `D:` está presente

O log anexo do `9325` registra `lista enviada à interface` (handler `tools:badavatar-list-drives`)
a cada 5 s — é o polling da Home. Medindo o intervalo entre linhas consecutivas do processo
`pid=8692`, de 16:25:35 a 17:01:06:

- **20 lacunas de 70 a 105 s** (102, 86, 97, 89, 88, 70, 71, 72, 74, 71, 105, 89, 73, 74, 75,
  88, 88, 88, 71, 71), somando **1 642 s de 2 131 s — 77% da sessão**;
- entre uma lacuna e a seguinte, **14 a 21 s** de polling normal (3 a 5 linhas);
- **nenhuma lacuna** de 16:42:00 a 16:44:32, exatamente o trecho em que a enumeração devolve
  `0 unidade(s): nenhuma` (o cliente desconectou o HD). As lacunas voltam quando o `D:` volta.

E a confirmação direta: na sessão seguinte (`pid=10080`), o log fica mudo de **17:14:22 a
17:16:25** (123 s). O print com "(Não está respondendo)" (`[129786]`) é das **17:15:37** —
dentro dessa lacuna.

### 3. As três falhas de enumeração do meio da sessão são a primeira linha depois de uma lacuna

| `enumeracao fisica falhou` | lacuna que termina nela |
|---|---|
| 16:34:29.799 | 16:33:01 → 16:34:29 (88 s) |
| 16:48:00.854 | 16:46:31 → 16:48:00 (89 s) |
| 16:57:49.242 | 16:56:21 → 16:57:49 (88 s) |

Três de três. Nas três, 86 ms a poucos segundos depois, a lista volta com `D:\:permitida` — o
Windows nunca deixou de reconhecer o disco.

## Causa raiz

**Provado pelo código (call-site) e coerente com o log:**

1. `App.tsx::refreshUsbGamesCount` chama `browseGetInstalledGames()` no mount e depois em
   `setInterval(..., 7000)`, **em qualquer tela**, só para alimentar um contador. A Home chama o
   mesmo canal a cada varredura de 5 s quando `canSkipPreparation(detectedState)`
   (`HomePage.tsx::checkPreparedDevice`).
2. O handler `browse:get-installed-games` (`browseHandlers.ts`) chama `scanUsbAndLocalGames()`,
   que roda **no processo principal do Electron**.
3. `scanUsbAndLocalGames` é `async` só no nome: depois do único `await listFat32UsbDrives()`,
   tudo é `fs.*Sync` — `existsSync`, `readdirSync`, `statSync`, `openSync`/`readSync`
   (`scanDriveRoot` → `scanGamesDirectory`/`scanContentDirectory` → `parseGameFolder`). Para
   **cada** pasta aceita como jogo, `parseGameFolder` chama `getDirectorySizeBytes(fullPath)`,
   que desce até `MAX_SIZE_SCAN_DEPTH = 16` fazendo um `statSync` **por arquivo**. Jogo em XEX
   tem milhares de arquivos; num HD mecânico por USB isso são dezenas de segundos de I/O
   bloqueante, durante os quais o processo principal não atende IPC, não pinta e não bombeia
   mensagens — o Windows marca a janela como "Não está respondendo".
4. O cache é por tempo: `SCAN_CACHE_TTL_MS = 15_000`. Terminada uma varredura, o resultado vale
   15 s; a primeira chamada depois disso **refaz a varredura inteira**. É o ciclo do log:
   14–21 s respondendo, 70–105 s congelado, de novo. O `inFlightScanPromise` não ajuda — ele
   evita varreduras concorrentes, não a repetição.

**Mecanismo do falso timeout — coerente com o código, não reproduzido:** `runPowerShell`
arma `setTimeout(timeoutMs)` e resolve no evento `close` do filho. Com o loop de eventos
bloqueado por mais que o timeout (5/7/12 s contra 70–105 s de bloqueio), ao destravar a fase de
timers roda antes da de I/O: o timer já venceu, o `close` (que já aconteceu) ainda não foi
entregue, e a promise rejeita com `USB_ENUMERATION_TIMEOUT` — a mensagem "O Windows ainda está
reconhecendo...". A evidência 3 (três de três falhas coladas no fim de uma lacuna, com a lista
voltando em seguida) é o que sustenta isso; falta reproduzir.

## O que falta medir

- **Qual pasta do disco do cliente custa os 70–105 s.** O scanner não loga nada (nem duração,
  nem quantas pastas/arquivos). Hipótese não verificada: `Xbox Games 360` não está em
  `candidateFolderNames`, então cai no laço de pastas da raiz de `scanDriveRoot`; se alguma
  subpasta direta tem `default.xex`, `hasDefaultXex` devolve `true` e `parseGameFolder` trata a
  **biblioteca inteira como um jogo**, medindo o tamanho de tudo. Só o conteúdo real do disco
  confirma.
- **Alcance.** Na telemetria há 12 reports dessa mensagem na v2.12.106 entre 2026-10-01 e
  2026-10-05 (e 7 na v2.12.101), todos `open`. Quantos têm o mesmo desenho de lacunas no log
  anexo não foi contado — é a triagem que separa este bug do resto da família.
- **Os dois timeouts de partida** (15:41:09 no `9324`, 17:22:49 no `9325`) acontecem segundos
  depois do `app ready`, quando a primeira varredura do `refreshUsbGamesCount` já pode estar
  rodando. Coerente, não provado: o log do `9324` tem 35 linhas e nenhuma do scanner.

## Escopo — o que NÃO é este bug

- **Não é** a contenção de `powershell.exe` entre várias instâncias (fechado, v2.12.95): os logs
  mostram uma instância por vez (`second-instance event received` aparece e é tratado).
- **Não é** o polling da lista de unidades reenumerando o disco (fechado, v2.12.98/99): a lista
  sai do cache em 5 s cravados entre as lacunas.
- **Não é** "PC lento", que foi a conclusão do cliente e que o agente de WhatsApp endossou
  (`[129790]`: *"PC lento faz o Companion travar mesmo"*). A máquina respondia ao Explorer e ao
  navegador no mesmo minuto.
- O lado do **agente** neste chamado (dizer que arquivos `Data0000…` não são formato de Xbox) é
  outro bug, em `digitalstoregamesproject`:
  `docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-10-05-agente-xbox-diz-que-jogo-em-god-data0000-nao-e-formato-da-aurora.md`.
  Os dois sobrevivem sozinhos: corrigir o agente não descongela o app, e vice-versa.

## Tarefas propostas

1. **Instrumentar antes de mexer:** logar em `APP_USB`/`BROWSE` a duração de cada
   `scanUsbAndLocalGames` e a contagem de pastas e de `statSync`. Sem isso o próximo caso chega
   de novo só com lacunas.
2. **Tirar a varredura do processo principal** (worker thread ou `fs.promises` com cessão do
   loop entre pastas).
3. **Contador de tela não dispara varredura completa:** `refreshUsbGamesCount` (7 s) e o ramo de
   `checkPreparedDevice` não precisam de tamanho em bytes; separar "quantos jogos" de "quanto
   ocupa" e calcular o tamanho sob demanda, na tela que o mostra.
4. **Invalidar o cache por mudança de volume / fim de gravação** (já existe
   `invalidateInstalledGamesCache`), não por TTL de 15 s.
5. **`runPowerShell`:** não declarar timeout se o filho já terminou — conferir o estado do
   processo antes de rejeitar, para que um loop bloqueado não vire "o Windows ainda está
   reconhecendo".
6. Depois do item 1 no ar, reler os logs dos 19 reports abertos dessa mensagem e medir o alcance.
