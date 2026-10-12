# Bug: Script PowerShell de substituição do auto-updater é interrompido sem registrar resultado após o fechamento do Electron

## Status

- **Corrigido e testado:** 2026-10-12 01:08 (pipeline 20261010-2242, teste rodada 1), branch sobre `origin/main` @ `8e5f3af`.
- **Commits:** `e2d9756` (fix: `fix(update): troca do .exe disparada por cmd.exe + start, com carimbo started`), `31cd6eb` (entrada do `CHANGELOG.md`), `0606a86` (docs).
- **Onde:** `src/electron-app/services/autoUpdateService.ts::buildReplaceLaunch` (novo: `cmd.exe` destacado → `start "" /min` do PowerShell com `-ExecutionPolicy Bypass -WindowStyle Hidden -File`, `cwd` = `userData`), `::startReplaceScript` (novo: grava `<userData>/update-replace.ps1` com BOM e dispara), `::applyUpdateAndRestart` (usa o `startReplaceScript`), `::buildReplaceScript` (carimbo `started` antes da espera), `::consumePendingUpdate` (motivos "não chegou a rodar" / "começou mas não terminou"; apaga o `.ps1`). Testes em `src/electron-app/tests/unit/autoUpdate.test.cjs`; doc-sync em `AGENTS.md`, `docs/features.md`, `docs/ATUALIZACAO-AUTOMATICA.md`.
- **Evidência:** `C:\projects\.bugfix-xbox360\evidencia\20261012-0105-electron-main-updater-script-substituicao-interrompido-sem-resultado_2026-09-30T22-58\` (`e2e-update.cjs`, `base-run.log`, `fix-run.log`, `*-home.png`, `fake-base\`/`fake-fix\` com o `godsend-data\logs\` de cada execução).
  - **Offline:** `node --test tests/unit/autoUpdate.test.cjs` → 15/15; vermelho→verde do teste `disparo da troca sobrevive ao processo que o lançou saindo na hora` refeito pelo teste: com a linha do `spawn` do `.js` compilado trocada pelo disparo antigo (`detached` direto no PowerShell, `-Command`) → `✖ ... resultado: ""` após 30 s; restaurado → `✔ (1919 ms)`.
  - **Controle positivo (sem o fix):** não há `deploy --at-base`; o app da lane foi aberto (Playwright `_electron.launch`, `userData` isolado via `PORTABLE_EXECUTABLE_FILE/DIR` = `fake-base\`) com o `services/autoUpdateService.js` compilado tendo o disparo da base restaurado (o bloco `spawn(powerShellExe(), ["-NoProfile","-WindowStyle","Hidden","-Command",psScript], {detached:true, stdio:"ignore"})`; o resto do app é o mesmo). Ação do botão **Reiniciar e Atualizar** (`window.godsendApi.applyUpdateAndRestart(<fonte>, "2.12.110")`): log `APP_UPDATE Replace script started: ...fake-base\xboxcompanion.exe -> v2.12.110` → `APP_LIFECYCLE application before-quit`, o app fecha, `update-result.txt` **ausente** após 30 s, SHA-256 do alvo **intacto** (`e4224d18…`). É a assinatura exata dos reports 8758/8839 (nesta rodada o disparo antigo não deu `spawn EPERM`, deu o modo do campo).
  - **T2 (com o fix):** mesma receita em `fake-fix\` com o `.js` do build do helper: mesmo log `Replace script started` → `before-quit`, o app fecha, em ~3 s `update-result.txt` = `ok`, `update-replace.ps1` presente, SHA-256 do alvo = o da fonte (`23240ef9…`, trocado). Backend em execução conferido: `godsend-windows-x64` com `Path` `C:\projects\.bugfix-xbox360\lanes\wt-1\dist\godsend-windows-x64.exe`. Nenhum processo da troca sobrou depois.
  - **T3:** `go test -count=1 ./...` em `src/server` → rc 0, 9 pacotes `ok`; `node --test tests/unit/*.test.cjs` (o `tsc`/`renderer:typecheck` do `test:safety` rodou no `build` do helper, rc 0) → 325 pass / 0 fail.
  - **T4:** logs do app nas duas execuções: só o `console error` de CSP da fonte do Google Fonts, igual na base e no fix — nada atribuível ao fix.
- **Falta para `closed/`:** subir a versão + `build-and-upload.ps1` (dono); a troca com o `xboxcompanion.exe` portable real (launcher NSIS + `RMDir /r` da pasta extraída — é onde o `cwd` = `userData` importa) e numa máquina sem Kaspersky; não medido se aparece flash de janela minimizada do PowerShell; confirmação em produção: depois da versão publicada, reports desse tipo devem sumir ou trazer "começou mas não terminou" (a migração a partir da versão antiga ainda roda o disparo antigo uma última vez).

- **Detectado em:** 2026-09-30 20:00 (telemetria de produção, triagem de 2026-09-30)
- **Origem:** `xbox-360-companion/electron-main` (`services/autoUpdateService.ts::applyUpdateAndRestart`, `buildReplaceScript`)
- **Errors (serviço):** 8758, 8759, 8839 (3 ocorrências em 2 máquinas distintas)
- **Classe:** fail (falha funcional de atualização em segundo plano)
- **Severidade:** **P1 — Alto** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): impede a migração automática de usuários para builds recentes no Windows
- **Complexidade:** **média** — requer isolamento de ciclo de vida e desvinculação de Job Object/process group no Windows para garantir que o script de substituição continue rodando até o fim após `app.quit()`
- **Versões:** observado em v2.12.101 e v2.12.103 (tentando atualizar para v2.12.104 e v2.12.105)
- **Reincidência:** recorrente pós-fix v2.12.101 de [[electron-main-atualizacao-in-app-reabre-a-versao-antiga-sem-aviso_2026-09-24T15-18.md]]

---

## Sintoma

O usuário clica em **Reiniciar e Atualizar** no modal de atualização. O aplicativo fecha, mas ao ser reaberto pelo usuário, continua na versão antiga com a mensagem de telemetria registrada no boot pelo gancho `checkPendingUpdateResult()`:

```
update aplicado mas a versão não mudou: 2.12.101 -> 2.12.105, abriu 2.12.101; o script de substituição não registrou resultado (não rodou ou foi interrompido)
```

O arquivo `<userData>/update-result.txt` **nunca é criado**, e o arquivo executável alvo (`target`) permanece intacto com o binário da versão antiga.

### Evidência na Telemetria

1. **ID 8758 e 8759 (2026-09-27):**
   - Máquina do usuário `davip` (Windows 10 / build 19045).
   - Tentativa de atualizar de `2.12.103` para `2.12.104`.
   - Alvo: `C:\Users\davip\Downloads\xboxcompanion.exe`.
   - Log:
     ```
     2026-09-27T13:59:21.076Z  pid=8160  APP_UPDATE  Download complete & verified: ...\xboxcompanion-update.exe
     2026-09-27T13:59:43.837Z  pid=8160  APP_UPDATE  Applying update from ...\xboxcompanion-update.exe...
     2026-09-27T13:59:44.033Z  pid=8160  APP_UPDATE  Replace script started: C:\Users\davip\Downloads\xboxcompanion.exe -> v2.12.104
     2026-09-27T14:01:00.556Z  pid=14052 APP_UPDATE  update aplicado mas a versão não mudou: 2.12.103 -> 2.12.104, abriu 2.12.103; o script de substituição não registrou resultado (não rodou ou foi interrompido)
     ```

2. **ID 8839 (2026-09-28):**
   - Máquina do usuário `User` (Windows 11 / build 26200).
   - Tentativa de atualizar de `2.12.101` para `2.12.105`.
   - Alvo: `C:\Users\User\Downloads\xboxcompanion (2).exe`.
   - Log:
     ```
     2026-09-28T19:53:15.247Z  pid=6176  APP_UPDATE  Download complete & verified: ...\xboxcompanion-update.exe
     2026-09-28T19:53:17.859Z  pid=6176  APP_UPDATE  Applying update from ...\xboxcompanion-update.exe...
     2026-09-28T19:53:17.914Z  pid=6176  APP_UPDATE  Replace script started: C:\Users\User\Downloads\xboxcompanion (2).exe -> v2.12.105
     2026-09-28T19:53:17.915Z  pid=6176  APP_LIFECYCLE application before-quit
     ...
     2026-09-28T19:59:18.381Z  pid=3168  APP_UPDATE  update aplicado mas a versão não mudou: 2.12.101 -> 2.12.105, abriu 2.12.101; o script de substituição não registrou resultado (não rodou ou foi interrompido)
     ```

---

## Causa Raiz

Em [`autoUpdateService.ts:588-598`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/services/autoUpdateService.ts#L588-L598):

```ts
const child = spawn(powerShellExe(), ["-NoProfile", "-WindowStyle", "Hidden", "-Command", psScript], {
  detached: true,
  stdio: "ignore",
});
await new Promise<void>((resolve, reject) => {
  child.once("spawn", resolve);
  child.once("error", reject);
});
child.unref();
...
app.quit();
```

Embora `detached: true` defina a flag Win32 `CREATE_NEW_PROCESS_GROUP`, **não desvincula o processo do Job Object** do processo pai no Windows:

1. **Associação ao Windows Job Object do Launcher Portable:**
   O pacote portátil distribuído é compilado pelo NSIS (`portable.nsi`). Quando o usuário clica no executável portátil, o launcher NSIS descompacta a aplicação para `%TEMP%\nsXXXX.tmp\app` e executa `ExecWait`. Quando o Electron chama `app.quit()`, o processo Electron termina, fazendo o `ExecWait` retornar no launcher. O launcher NSIS então executa imediatamente `RMDir /r /REBOOTOK` e encerra a si próprio. Se o launcher ou o shell do Windows (ex.: lançado a partir do navegador Chrome/Edge via Downloads) tiver sido criado dentro de um Job Object com `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, o encerramento do processo raiz acarreta o extermínio imediato de todos os processos descendentes na árvore pelo kernel do Windows, incluindo o PowerShell.

2. **Gap no Teste Automatizado (`autoUpdate.test.cjs`):**
   O teste de unidade existente em [`tests/unit/autoUpdate.test.cjs:104`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/tests/unit/autoUpdate.test.cjs#L104) executa o script via:
   ```javascript
   spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", buildReplaceScript(opts)])
   ```
   Como o teste rodava com `spawnSync`, o processo Node pai permanecia vivo durante toda a duração da execução do PowerShell. O teste nunca reproduziu o ciclo de vida real em que o processo pai fecha com `app.quit()` imediatamente após o evento `spawn`.

3. **Ausência de `-ExecutionPolicy Bypass` e parâmetros de script inline:**
   O PowerShell é invocado sem `-ExecutionPolicy Bypass`. Em ambientes com restrições de script ou proteções ASR (Attack Surface Reduction) do Windows Defender, a execução de comandos complexos de manipulação de processos e sobrescrita de binários pode ser bloqueada quando executada em background desanexado.

---

## Como Reproduzir

1. Gerar o pacote portátil ou simular um processo pai com término imediato:
2. Criar um processo simulado `fake-launcher.exe` que faça spawn de um processo filho e depois feche.
3. Chamar `buildReplaceScript` via `spawn(powerShellExe(), ..., { detached: true, stdio: "ignore" })` e invocar `process.exit(0)` imediatamente no pai.
4. Observar que em ambientes Windows padrão (especialmente sem terminal interativo associado ou sob Job Objects), o script PowerShell não sobrevive ao encerramento abrupto da árvore de processos.

---

## Resolução Proposta

1. **Criação de Script Externo Desacoplado via Arquivo Temporário (`.cmd` / `.bat` ou `.ps1`):**
   Em vez de passar um bloco de script de 30 linhas como argumento `-Command` para o `powershell.exe`, gravar o script em um arquivo `.bat` ou `.cmd` temporário em `%TEMP%\godsend-update\replace.cmd`.

2. **Desacoplamento Completo do Processo via `cmd.exe /c start ""`:**
   Utilizar a semântica nativa do `start` do shell do Windows (`cmd.exe /c start "" /b ...` ou `wscript.exe` / executável auxiliar), que instrui o Windows Explorer / shell a criar uma sessão de processo verdadeiramente independente e desvinculada do Job Object da árvore do launcher portable:
   ```ts
   const runner = spawn("cmd.exe", ["/c", "start", '""', "/b", powerShellExe(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
     detached: true,
     stdio: "ignore",
     windowsHide: true,
   });
   ```

3. **Adição de Logging Intermediário no Script:**
   Garantir que a primeira instrução do script de substituição grave `started` ou um timestamp em `update-result.txt` antes mesmo de entrar no loop de espera do processo, permitindo que a telemetria distinga entre "o script nem chegou a iniciar" vs "o script rodou mas foi interrompido durante a espera".

4. **Teste de Unidade Assíncrono com Encerramento de Processo:**
   Adicionar teste no `tests/unit/autoUpdate.test.cjs` validando que um subprocesso lançado desanexado com o novo método conclui a cópia e escreve `update-result.txt` mesmo após o encerramento do processo que o disparou.

---

## Critérios para Fechar

- [ ] Script de substituição gravado em arquivo dedicado e invocado com `-ExecutionPolicy Bypass` e desvinculação completa via `cmd.exe /c start`
- [ ] Gravação de log de progresso inicial (`started`) no `update-result.txt`
- [ ] Teste unitário comprovando a sobrevivência do script de substituição após o encerramento imediato do processo pai
- [ ] Validação de substituição completa no Windows com o executável portable real
- [ ] Registro de encerramento no `CHANGELOG.md` e movimentação para `docs/bugs/closed/`

---

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** corrigir — o PowerShell de substituição é criado com `DETACHED_PROCESS` (`spawn(..., { detached: true })`) e, nesta máquina de teste, um PowerShell criado assim **nunca chega a iniciar o engine**: o `spawn` dispara, o app fecha e nada mais acontece. Trocar o disparo por um `cmd.exe` destacado que faz `start` do PowerShell (que então ganha console próprio) com o script em arquivo `-File` resolveu sob Electron real com `app.quit()`. A causa "Job Object" das seções acima **não se sustenta** (ver Hipóteses descartadas).
**Complexidade:** media — lógica nova num serviço do Electron (`services/autoUpdateService.ts`), sem rota, IPC nem UI nova (critério "Media" do `docs/bugs/open/README.md`).
**Severidade:** medio — o canal de atualização falha só num subconjunto de máquinas (2 máquinas em 3 reports; o código anterior à 2.12.101, com o mesmo `detached`, rodava o script em outras máquinas) e há contorno: o modal de erro já mostra os passos da atualização manual e o botão **Mostrar arquivo baixado**.
**Arquivos a alterar (reserva da onda):**
- `src/electron-app/services/autoUpdateService.ts` — `applyUpdateAndRestart` (disparo via `cmd.exe` + `start` + `-File`), `buildReplaceScript` (carimbo `started` na primeira linha), `consumePendingUpdate` (motivo para `started` e limpeza do `.ps1`), helper exportado novo para montar a linha de comando
- `src/electron-app/tests/unit/autoUpdate.test.cjs` — testes do disparo com o pai saindo na hora, do carimbo `started` e do motivo novo
- `docs/ATUALIZACAO-AUTOMATICA.md` — seção 4.3 ("Dispara o PowerShell desanexado") e o desenho do script
- `docs/features.md` — linha 180 ("hands the swap to a detached PowerShell script")
- `AGENTS.md` — linha do `autoUpdateService.ts` (linha 81): invariante "nunca criar o PowerShell da troca com `detached: true`"

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `src/electron-app/services/autoUpdateService.ts::applyUpdateAndRestart` (l. 600-664) — grava `update-pending.json`, monta o script com `buildReplaceScript` e faz `spawn(powerShellExe(), ["-NoProfile", "-WindowStyle", "Hidden", "-Command", psScript], { detached: true, stdio: "ignore" })`; espera o evento `spawn`, `unref()`, loga `Replace script started` e chama `app.quit()`. Em erro **síncrono ou assíncrono** do `spawn` (EPERM/ENOENT): apaga o marcador e relança → `ipc/updateHandlers.ts` (`update:apply`, l. 73-80) devolve `{ ok:false, error }` e loga `update:apply error: ...`. **O evento `spawn` só prova que o `CreateProcess` deu certo, não que o script rodou**: é exatamente o buraco do campo.
- `services/autoUpdateService.ts::buildReplaceScript` (l. 512-544) — espera o `waitPid` e todo processo cujo `Path` é o alvo (até 180 s), copia (20 × 500 ms), grava `ok` / `copy-failed: <erro>` em `update-result.txt` e **sempre** faz `Start-Process $target`. Nenhum carimbo antes do laço: se o processo não roda ou morre, nada fica escrito. Em erro do `Set-Content`: engolido (`try {} catch {}`).
- `services/autoUpdateService.ts::consumePendingUpdate` (l. 550-576) — no boot lê e apaga marcador e resultado; resultado vazio vira o texto `o script de substituição não registrou resultado (não rodou ou foi interrompido)` (a mensagem dos 3 reports). Chamado por `checkPendingUpdateResult` (l. 579), que roda em `app/bootstrap.ts:180`, no `app ready`, antes da janela.
- `infrastructure/windowsSystemExecutables.ts::powerShellExe` / `system32Exe` — caminho absoluto em `System32` (precedente de `system32Exe("cmd.exe", "cmd.exe")` em `services/driveRepairService.ts:203`).
- `src/electron-app/build/portable.nsi` (seção `-launch`) — o launcher cria o Electron com `kernel32::CreateProcess(..., i 0 /*flags*/ ...)`, sem Job Object e sem `CREATE_BREAKAWAY_FROM_JOB`; espera o processo e faz `RMDir /r $INSTDIR`. Nada nele mata descendentes.
- `app/bootstrap.ts` (`before-quit`, l. 224) — só `setIsQuitting(true)` + `stopGodsend()`, que faz `godsendProcess.kill()` (só o backend; `services/backendClient.ts:229-234`). Nenhum `taskkill /T` no repo (grep) que pudesse levar o PowerShell junto.

**Mecanismo:** nesta máquina (Windows 11 build 26200.9550 — a mesma build da máquina do 8839 — com Kaspersky ativo), PowerShell 5.1 criado com `DETACHED_PROCESS` sai com código 0 em ~0,9 s **sem iniciar o engine** (não há evento 400 no log `Windows PowerShell`), qualquer que seja a forma: `-Command`, `-NonInteractive`, `stdio: "pipe"`, `-File` com `-ExecutionPolicy Bypass`. Outros executáveis de console destacados rodam normalmente (`PING.EXE` 2 s, `cmd /c exit /b 5` → 5, `cmd /c copy` copia). Não isolei se a causa é o Windows ou o antivírus (não há outra máquina); o indício do campo (antes da 2.12.101 o script destacado relançava o app ~13-16 s depois em M4/M6, ver o bug fechado) diz que depende da máquina — coerente com só 2 máquinas reportando. O conserto não depende de saber qual: o PowerShell deixa de ser criado com `DETACHED_PROCESS`.

Nos 3 reports o app **não voltou sozinho** (o script relança o alvo sempre, até na falha), e o boot que reportou foi o do usuário reabrindo à mão: 76 s depois (8758) e 6 min depois (8839). 6 min passa do pior caso do script vivo (180 s de espera + 20 × 0,5 s de cópia ≈ 3,2 min, e ele grava resultado antes de relançar): no 8839 o script não estava rodando.

**Achado lateral do mesmo disparo (nesta máquina):** com `-WindowStyle Hidden` **e** o script inline de ~1,5 KB, o `CreateProcess` é negado (`spawn EPERM`, síncrono), com ou sem `detached`; sem `-WindowStyle Hidden`, ou com um comando curto, não. É o modo M2 do bug fechado (`update:apply error: spawn EPERM`). Com o script em arquivo (`-File`) e `-WindowStyle Hidden` o disparo passa. O fix abaixo cobre os dois modos.

### Provas (comando literal -> resultado)

Harness descartável no scratch da sessão (fora do repo): `svc.js` = `psQuote` + `buildReplaceScript` copiados de `autoUpdateService.ts` sem tipos; `run2.js` copia `System32\PING.EXE` para `<dir>\xboxcompanion.exe` (alvo) e `whoami.exe` para `<dir>\xboxcompanion-update.exe` (fonte), faz o `spawn` do modo pedido com `waitPid: process.pid, waitSeconds: 60`, e no evento `spawn` faz `unref()` + `require("electron").app.quit()` — o mesmo ciclo de vida de `applyUpdateAndRestart`. Electron real da lane: `env -u ELECTRON_RUN_AS_NODE src/electron-app/node_modules/electron/dist/electron.exe run2.js <dir> <modo>` (Electron 42.4.1); resultado lido 15-20 s depois.

| modo (sob Electron real, pai sai no `spawn`) | disparo | `update-result.txt` | alvo |
|---|---|---|---|
| `detached-nohide`: `spawn(ps, ["-NoProfile","-Command",script], {detached:true, stdio:"ignore"})` | `spawn` ok, child pid 40828 | **ausente** | **não substituído** — a assinatura dos 3 reports |
| `current` (o código de produção: `+ "-WindowStyle","Hidden"`) | `spawn EPERM` síncrono (o harness não trata → Electron pendura, `timeout` rc 124) | ausente | não substituído — o modo M2 |
| `attached`: `spawn(ps, ["-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File",ps1], {stdio:"ignore", windowsHide:true})` | ok | **ausente** | não substituído — morre com o Electron |
| `start`: `spawn(cmd, ["/d","/s","/c", '"start "" /min "<ps>" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "<ps1>""'], {detached:true, stdio:"ignore", windowsHide:true, windowsVerbatimArguments:true})` | ok | **`ok`** | **substituído** |
| `start-b` (a proposta literal do doc: `start "" /b ... -File`) | ok | `ok` | substituído |
| `start` com `<dir>` = `...\el3-João-nb` (caminho com acento; `.ps1` gravado em UTF-8 **com BOM**) | ok | `ok` | substituído |

Isolando o PowerShell destacado (Node 24.19, `node sp9.js` / `sp4.js` / `sp8.js`; arquivo marcador escrito pelo próprio comando):

```
det_ignore      exit 0  833ms file false     (detached, -Command "Set-Content ...; exit 3")
det_pipe        exit 0  827ms file false     (detached, stdio pipe: nada no stderr)
det_ignore_noni exit 0  950ms file false     (detached, -NonInteractive -NoLogo)
det_file_bypass exit 0  982ms file false     (detached, -ExecutionPolicy Bypass -File s9.ps1)
att_hide_ignore exit 3 1154ms file true      (sem detached, windowsHide)
ping_det        exit 0 2087ms                (PING.EXE -n 3 destacado roda inteiro)
cmd_exit5_det   exit 5   93ms                (cmd destacado roda)
copy_det        exit 0   52ms  copied-det.exe existe
```

```
Get-WinEvent -LogName 'Windows PowerShell' | ? Id -eq 400   # "Engine state is Available"
-> um único evento 400 na rodada, o de m9-att_hide_ignore; nenhum dos 4 destacados iniciou o engine
```

```
node sp7.js a_hidden_pipe          -> throw EPERM   (-WindowStyle Hidden + script inteiro, sem detached)
node sp7.js a_pipe / a_ignore      -> exit 1        (script inteiro sem Hidden: roda; 1 = pasta de teste inexistente)
node sp7.js a_short_hidden_ignore  -> exit 3        (Hidden + "exit 3": roda)
spawnSync(ps, ["-NoProfile","-NonInteractive","-Command",script])  -> roda (é o que o teste atual usa)
```

```
IsProcessInJob(<pwsh da sessão>)                                 -> False
Get-CimInstance root/SecurityCenter2 AntiVirusProduct           -> Kaspersky (266240), Windows Defender (393472)
cmd /c ver                                                       -> 10.0.26200.9550
git show 978e128:src/electron-app/services/autoUpdateService.ts  -> o código anterior à 2.12.101 já usava detached:true + -WindowStyle Hidden
```

Sem acesso à telemetria nesta sessão (o token exige ler o `.env` do backend, o que não fiz); os logs dos 3 reports são os transcritos acima neste doc.

### Hipoteses descartadas (e por que)

- **Job Object com `KILL_ON_JOB_CLOSE` matando o PowerShell quando o launcher sai** (a "Causa Raiz" original deste doc): o `portable.nsi` cria o Electron com `CreateProcess` sem job; o libuv só põe no job dele (kill-on-close) os filhos **não** destacados — e o teste `attached` confirma que esses morrem, enquanto o destacado nem chega a rodar; o processo da sessão não está em job (`IsProcessInJob` = False). E mesmo que houvesse job, `cmd /c start` não sai dele (sem `CREATE_BREAKAWAY_FROM_JOB` o filho herda o job): a proposta do doc funciona por outro motivo — dá ao PowerShell um console, que o `DETACHED_PROCESS` tira.
- **Falta de `-ExecutionPolicy Bypass`**: a política não se aplica a `-Command`; e `-File` + `Bypass` destacado também não rodou (`det_file_bypass`). O `Bypass` entra no fix só porque o script passa a ser `-File`.
- **`spawn` sem `detached`** (deixar o PowerShell com console herdado): morre junto com o Electron (modo `attached`: sem resultado), pelo job do libuv. Por isso o intermediário `cmd.exe` destacado.
- **O usuário reabriu o app antes de o script terminar** (a espera de até 180 s ainda corria, e o launcher novo, rodando do próprio alvo, segura a cópia): explicaria o 8758 (76 s) **se** o script estivesse vivo, mas não o 8839 (6 min > ~3,2 min de pior caso). Fica como risco residual: o carimbo `started` (Tarefa 2) passa a separar esse caso ("começou e não terminou") de "nem começou".
- **Reuso do PID do Electron prolongando a espera**: limitado pelos mesmos 180 s; não explica 6 min sem resultado.
- **`Set-Content` do resultado falhando em silêncio**: com a cópia ok o app voltaria na versão nova; com a cópia falhando o script relançaria o app sozinho — e nos 3 reports o app não voltou sozinho.
- **Algo no `before-quit` matando a árvore**: só `stopGodsend()` → `godsendProcess.kill()` do backend; nenhum `taskkill /T` no repo.

### Tarefas

- [ ] **T1** `src/electron-app/services/autoUpdateService.ts::applyUpdateAndRestart` (+ helper exportado novo, ex. `buildReplaceLaunch({ cmd, powerShell, scriptFile })` → `{ file, args }`) — gravar o script em `<userData>/update-replace.ps1` em **UTF-8 com BOM** (o PowerShell 5.1 lê `.ps1` sem BOM na página ANSI; o caminho do alvo pode ter acento) e disparar `spawn(system32Exe("cmd.exe", "cmd.exe"), ["/d", "/s", "/c", '"start "" /min "<powerShellExe()>" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "<ps1>""'], { detached: true, stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true })`. Manter: esperar `spawn`/`error`, `unref()`, apagar o marcador e relançar em erro, `app.quit()` só depois. Comentário no código com `[[electron-main-updater-script-substituicao-interrompido-sem-resultado_2026-09-30T22-58]]` dizendo **por que** não `detached` direto no PowerShell. — teste: T4(a) e T4(d).
- [ ] **T2** `services/autoUpdateService.ts::buildReplaceScript` — primeira instrução grava `started` em `$resultFile` (`try { Set-Content ... 'started' } catch {}`), antes do laço de espera; o desfecho final sobrescreve. — teste: T4(b).
- [ ] **T3** `services/autoUpdateService.ts::consumePendingUpdate` — resultado `started` vira motivo próprio (ex.: `o script de substituição começou mas não terminou (interrompido, ou o app foi reaberto antes de ele acabar)`); resultado vazio vira `o script de substituição não chegou a rodar`; apagar também `update-replace.ps1`. Os dois testes atuais de `consumePendingUpdate` continuam valendo (o segundo usa `/não registrou resultado/`: ajustar a regex junto se o texto mudar). — teste: T4(c).
- [ ] **T4** `src/electron-app/tests/unit/autoUpdate.test.cjs` (`skip` fora de win32):
  (a) **o disparo sobrevive ao pai saindo na hora**: um `node -e` filho faz exatamente o `spawn` de `buildReplaceLaunch` e `process.exit(0)` no evento `spawn`; o teste espera até ~30 s por `update-result.txt` = `ok` e alvo == fonte (PING como alvo parado, whoami como fonte, como no teste do launcher). Conferir vermelho→verde trocando, só localmente, pelo `spawn` antigo (`detached` direto no PowerShell): nesta máquina fica sem resultado;
  (b) **carimbo**: script com `waitPid` = um processo vivo (ex. `PING -n 6`) e `waitSeconds` curto, disparado por `spawn` assíncrono; ler `update-result.txt` durante a espera → `started`; no fim → `ok`;
  (c) `consumePendingUpdate` com resultado `started` → o motivo novo; vazio → o outro;
  (d) `buildReplaceLaunch` monta `-File "<ps1>"`, `-ExecutionPolicy Bypass`, `start "" /min`, e **não** contém `-Command`.
- [ ] **T5** doc-sync: `docs/ATUALIZACAO-AUTOMATICA.md` (4.3: "Dispara o PowerShell desanexado" → `cmd.exe` destacado + `start` + `-File`, o carimbo `started`), `docs/features.md:180`, `AGENTS.md:81` (invariante: nunca criar o PowerShell da troca com `detached: true` — no campo ele não roda; nem sem `detached` — morre com o Electron). `CHANGELOG.md` `[Unreleased]` / `### Fixed` (não sobe versão).

### Plano de teste

- **Offline (sem slot):** `npm --prefix src/electron-app run test:safety` com os testes novos da T4 (a)-(d) passando; (a) é a prova central: o script disparado pelo caminho novo conclui a troca com o pai já morto. Registrar o vermelho→verde de (a) (spawn antigo vs novo) nesta máquina.
- **T2 reproducao como o usuario (E2E, no slot):** o caminho do cliente é **Reiniciar e Atualizar** no modal de atualização (`renderer/components/AppUpdateModal.tsx:134` → `window.godsendApi.applyUpdateAndRestart(downloadedFilePath, updateInfo?.latestVersion)` → IPC `update:apply`). No modo dev ele não é alcançável inteiro pela UI: o modal só chega a "downloaded" se o `version.json` público anunciar versão maior que a da lane, e então baixaria e relançaria um portable real (que disputa a porta e o slot). Por isso a ação do botão é disparada pela mesma chamada que ele faz, via Playwright, e o resto é o app real:
  1. `EV=C:\projects\.bugfix-xbox360\evidencia\<AAAAMMDD-HHMM>-electron-main-updater-script-substituicao-interrompido-sem-resultado_2026-09-30T22-58`; criar `EV\fake\` com `xboxcompanion.exe` (cópia de `C:\Windows\System32\PING.EXE`, o "launcher" antigo) e `xboxcompanion-update.exe` (cópia de `whoami.exe`, a "versão nova", que sai sozinha ao ser relançada). Guardar o SHA-256 dos dois.
  2. Abrir o app da lane com Playwright `_electron.launch` sobre o `main.js` da lane (`src/electron-app/playwright.config.ts`) com `env: { ...process.env, PORTABLE_EXECUTABLE_FILE: "EV\\fake\\xboxcompanion.exe", PORTABLE_EXECUTABLE_DIR: "EV\\fake" }`. Com isso o alvo é o exe falso (`resolveReplaceTarget` usa `portableFile`) e o `userData` vira `EV\fake\godsend-data` (`services/appDataPath.ts::getDefaultAppDataDir`): o `config.json` do dono em `%APPDATA%\xbox-360-companion-electron` não é tocado. Conferir no log `APP_LIFECYCLE app ready userData=...EV\fake\godsend-data`.
  3. Na Home, com a janela visível, `page.evaluate(() => window.godsendApi.applyUpdateAndRestart("<EV>\\fake\\xboxcompanion-update.exe", "<versão da lane, 2.12.110>"))`. Usar a **versão da própria lane** como destino: se o app for reaberto com esse `userData`, `consumePendingUpdate` não acusa falha e nada vai para a telemetria de produção.
  4. **Sinal (com o fix):** log `APP_UPDATE Replace script started: ...EV\fake\xboxcompanion.exe -> v2.12.110`; o processo Electron sai; em até 30 s `EV\fake\godsend-data\update-result.txt` = `ok` e o SHA-256 de `EV\fake\xboxcompanion.exe` = o de `xboxcompanion-update.exe`; nenhuma janela de console visível (no máximo um flash minimizado). Copiar `update-result.txt`, os hashes e o log `%...%\EV\fake\godsend-data\logs\` para a evidência. Apagar `EV\fake\godsend-data\update-pending.json` se sobrar.
- **Controle positivo:** não há `deploy --at-base` neste projeto; rodar a mesma receita numa lane no commit base (sem o fix). **Nesta máquina** o sintoma aparece no modo M2: o `update:apply` devolve `{ ok:false, error:"spawn EPERM" }`, o log tem `APP_UPDATE update:apply error: spawn EPERM`, o app não fecha e o alvo fica igual. A assinatura exata do campo ("Replace script started", app fecha, sem `update-result.txt`, alvo intacto, nada relançado) não sai pelo app nesta máquina por causa do EPERM; ela é reproduzida pelo harness offline (modo `detached-nohide` da tabela de Provas: `spawn(ps, ["-NoProfile","-Command",script], {detached:true, stdio:"ignore"})` + `app.quit()` no `spawn` → sem resultado, alvo intacto). Com o fix, os dois modos somem.
- **T3 regressao direcionada:** `go test -count=1 ./...` em `src/server` e `npm --prefix src/electron-app run test:safety` (linha de base 258 pass / 0 fail); em especial os testes atuais `script de substituição espera o launcher ...` e `... grava copy-failed ...` (eles rodam o script por `spawnSync -Command` e continuam válidos: o conteúdo do script só ganha o carimbo `started`), `consumePendingUpdate: ...` e `resolveReplaceTarget: ...`. Vizinhos: o ramo não-Windows/dev de `applyUpdateAndRestart` (sem alvo: `spawn(updateFile)`) fica igual; falha de `spawn` do `cmd.exe` continua chegando ao modal como `{ ok:false }` (ler o `catch`); o boot com marcador + `ok` e versão nova continua silencioso.
- **Falta para close (fora do alcance do slot):** a troca com o `xboxcompanion.exe` portable real (launcher NSIS + `RMDir /r` de 1,3 GB) e numa máquina sem Kaspersky; e a confirmação em produção: depois de publicada a versão com o fix, reports desse tipo devem trazer `começou mas não terminou` ou sumir — a migração da versão antiga para a nova ainda roda o script **antigo** uma última vez (mesmo limite do bug fechado).

### Nota do dev (2026-10-11, antes da primeira edição)

- **`cwd` do disparo = `userData`**, não o herdado. `build/portable.nsi` faz `SetOutPath $INSTDIR` (l. 109) e cria o Electron com `CreateProcess(..., lpCurrentDirectory = 0)` (l. 144): o cwd do Electron é a pasta extraída, que o launcher apaga com `RMDir /r $INSTDIR` (l. 185) depois do Electron sair. O `cmd.exe`/PowerShell herdariam esse cwd e, vivos durante a espera do script, impediriam a remoção da própria pasta (o mesmo cuidado do comentário da l. 217, "nothing may hold the temp folder"). Antes o PowerShell nem rodava nas máquinas afetadas; com o fix ele roda justo nessa janela.
- **Forma do helper:** `buildReplaceLaunch(scriptFile)` → `{ file, args, options }` (puro, teste (d)) e `startReplaceScript(scriptFile, script)` (grava o `.ps1` com BOM, faz o `spawn`, espera `spawn`/`error`, `unref`). `applyUpdateAndRestart` chama o segundo; o filho do teste (a) chama o MESMO `startReplaceScript` e sai no `spawn`, então o teste cobre a gravação e o disparo reais, não uma cópia.

### Sessoes seguintes

- dev: effort high, ultrathink sim — disparo de processo no Windows com três armadilhas já medidas (DETACHED_PROCESS, job do libuv, EPERM do `-WindowStyle Hidden` + script inline) e aspas do `cmd /s /c start ""`; o teste (a) precisa reproduzir o pai morrendo na hora.
- teste: effort medium, ultrathink nao — receita fechada; o cuidado é isolar o `userData` pelas variáveis de ambiente e não deixar marcador que reporte à telemetria.

---

## Correcao (pipeline 20261010-2242, rodada 1)

**O que mudou (`arquivo::simbolo`):**
- `src/electron-app/services/autoUpdateService.ts::buildReplaceLaunch` (novo, exportado) — `{ file: system32Exe("cmd.exe"), args: ["/d","/s","/c",'"start "" /min "<powerShellExe()>" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "<ps1>""'], options: { detached, stdio:"ignore", windowsHide, windowsVerbatimArguments, cwd: dirname(ps1) } }`. Comentário com `[[slug]]` explica por que nunca `detached` direto no PowerShell (DETACHED_PROCESS não roda o script; sem `detached` morre no job do libuv; `-Command` inline + Hidden = EPERM).
- `::startReplaceScript` (novo, exportado) — grava o script em `<userData>/update-replace.ps1` com BOM (`"﻿"`), faz o `spawn` de `buildReplaceLaunch`, espera `spawn`/`error`, `unref()`.
- `::applyUpdateAndRestart` — o bloco `spawn(powerShellExe(), [... "-Command", psScript], { detached:true })` virou `await startReplaceScript(path.join(dir, REPLACE_SCRIPT_FILE), psScript)`. O resto igual: erro (síncrono ou assíncrono, inclusive falha ao gravar o `.ps1`) apaga o marcador e relança → `{ ok:false }`; `app.quit()` só depois. Ramo não-Windows/dev intocado.
- `::buildReplaceScript` — primeira instrução: `try { Set-Content $resultFile 'started' } catch {}`, antes do laço de espera; o desfecho (`ok`/`copy-failed`) sobrescreve.
- `::consumePendingUpdate` — `started` → `o script de substituição começou mas não terminou (interrompido, ou o app foi reaberto antes de ele acabar)`; vazio → `o script de substituição não chegou a rodar`; apaga também `update-replace.ps1`.
- `tests/unit/autoUpdate.test.cjs` — regex do teste antigo (`/não registrou resultado/` → `/não chegou a rodar/`) e 4 testes novos: `buildReplaceLaunch: ...` (d), `consumePendingUpdate: 'started' ...` (c), `script de substituição grava 'started' antes de esperar o processo` (b), `disparo da troca sobrevive ao processo que o lançou saindo na hora` (a). O fixture de (a)/(b) usa `...\Downloads João\xboxcompanion (2).exe` (acento, espaço, parênteses, como no 8839).
- doc-sync: `AGENTS.md` (linha do `autoUpdateService.ts`: invariante do disparo + carimbo), `docs/features.md` ("When an update does not take"), `docs/ATUALIZACAO-AUTOMATICA.md` (4.3 árvore + parágrafo "Por que `cmd.exe` + `start`", 4.4 motivos, linha do teste na tabela).

**Desvios do plano:** `cwd` = `userData` e a divisão `buildReplaceLaunch` + `startReplaceScript` (nota do dev acima).

**Provas offline (nesta máquina, Windows 11 26200):**
- `python pipeline.py build --bug <slug>` → rc 0 (build-server + `tsc` + `renderer:typecheck`).
- `node --test tests/unit/autoUpdate.test.cjs` (em `src/electron-app`, sobre o `.js` do build do helper) → 15 pass / 0 fail; (a) 2,0 s, (b) 6-7 s.
- `node --test tests/unit/*.test.cjs` (a parte `node --test` do `test:safety`; o `tsc` dele já rodou no build do helper) → 323 pass / 0 fail.
- **Vermelho→verde de (a):** trocando, só no `.js` compilado (gerado, gitignored), a linha do `spawn` de `startReplaceScript` pelo disparo antigo (`spawn(powerShellExe(), ["-NoProfile","-Command",script], { detached:true, stdio:"ignore" })`): `✖ disparo da troca sobrevive ... AssertionError: resultado: ""` após 30 s — nem `started`, a assinatura dos 3 reports. Restaurado o `.js`: `✔ ... (1958ms)`.

**CHANGELOG pendente:** `CHANGELOG.md` está reservado por `pipeline-mkdir-da-pasta-do-jogo-falha-com-caminho-nao-encontrado-e-o-dispositivo-presente_2026-10-04T23-28` (`claim` saiu 8); o `enqueue-test` recusa branch com arquivo não reservado (saída 9). Código e docs commitados; `park` nesse bug. 2026-10-11, retomada 1: `sync` ok (branch sobre `origin/main` @ `c67b4ff`), mas o `claim` saiu 8 de novo, agora com `pipeline-download-chunked-concluido-perdido-ao-fechar-durante-o-hash-final-recomeca-do-zero_2026-10-07T21-48`; `park` nele. Na retomada: `sync`, `claim --file CHANGELOG.md`, acrescentar em `## [Unreleased]` / `### Fixed`:

> - **Atualização in-app fechava o app e não trocava nada, sem resultado gravado (`src/electron-app/services/autoUpdateService.ts::applyUpdateAndRestart`, `::buildReplaceLaunch`, `::startReplaceScript`)**
>   - Caso: reports 8758, 8759, 8839 (2 máquinas, 2.12.101/2.12.103): "Replace script started", o app fecha, não volta sozinho, e no boot seguinte `o script de substituição não registrou resultado`.
>   - Causa: o PowerShell da troca era criado com `detached: true` (`DETACHED_PROCESS`); em algumas máquinas (medido no Windows 11 26200 com Kaspersky) esse PowerShell sai com código 0 sem iniciar o engine. A hipótese de Job Object do launcher foi descartada (o `portable.nsi` não usa job).
>   - Correção: o script vai para `<userData>/update-replace.ps1` (UTF-8 com BOM) e é disparado por um `cmd.exe` destacado que faz `start "" /min` do PowerShell com `-ExecutionPolicy Bypass -WindowStyle Hidden -File`, com `cwd` fora da pasta extraída do portable. O script grava `started` antes de esperar, e o boot passa a dizer "não chegou a rodar" ou "começou mas não terminou". Cobre também o `spawn EPERM` de `-WindowStyle Hidden` com o script inline.
>   - Testes: `tests/unit/autoUpdate.test.cjs` (o disparo conclui a troca com o processo que o lançou já encerrado; falha no disparo antigo).
>   - Bug: [docs/bugs/open/electron-main-updater-script-substituicao-interrompido-sem-resultado_2026-09-30T22-58.md](docs/bugs/open/electron-main-updater-script-substituicao-interrompido-sem-resultado_2026-09-30T22-58.md)

**Retomada 2 (2026-10-12) — CHANGELOG resolvido:** `sync` ok (branch sobre `origin/main` @ `8e5f3af`), `claim --file CHANGELOG.md` ok, entrada acima aplicada em `## [Unreleased]` / `### Fixed`. Depois do rebase: `pipeline.py build` → rc 0; `node --test tests/unit/*.test.cjs` → 325 pass / 0 fail (os 4 testes novos incluídos).

**Ajustes ao Plano de teste:** a receita não muda. Na T2, conferir também que `EV\fake\godsend-data\update-replace.ps1` existe depois do clique. O efeito do `cwd` (não prender a pasta extraída do portable) só aparece com o launcher NSIS real: vai para "falta para close" junto com a troca do portable real.
