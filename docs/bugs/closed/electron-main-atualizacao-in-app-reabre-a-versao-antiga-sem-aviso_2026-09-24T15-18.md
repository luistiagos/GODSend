# Bug: a atualização in-app nunca chega à versão nova — o script desiste de sobrescrever o `.exe` e reabre a versão antiga, sem log nem aviso

- **Detectado em:** 2026-09-24 15:18 (chamado #72 do painel, sessão `192582088962070@lid`)
- **Origem:** conversa de suporte + telemetria (cauda do log anexa a 22 reports que trazem eventos `APP_UPDATE`) + leitura de `services/autoUpdateService.ts::applyUpdateAndRestart`, `ipc/updateHandlers.ts` (`update:apply`), `renderer/components/AppUpdateModal.tsx::handleApplyAndRestart` e do template da biblioteca `app-builder-lib/templates/nsis/portable.nsi`
- **Classe:** falha funcional (atualização) + diagnóstico (a falha é invisível: não há mensagem, linha de log nem report de telemetria)
- **Severidade:** **P1 — Alto** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): bloqueio total do canal de atualização. **Nenhuma** das 11 aplicações com desfecho observável chegou à versão nova (8 máquinas, 05/09–23/09). Quem depende do botão fica preso em versões com bugs já corrigidos (2.12.43, 2.12.58, 2.12.67, 2.12.78, 2.12.81, 2.12.97). O cliente do #72 abriu chamado por causa disso.
- **Complexidade:** **baixa** para T1 (o renderer passa a ler `ok`); **média** para T2/T3 (substituir o launcher portable exige esperar o processo dele terminar e conferir o resultado)
- **Versões:** todas desde o "In-App Auto and Manual Update System" (CHANGELOG); observado de 2.12.43 a 2.12.97. O código atual (2.12.99) é o mesmo.
- **Reincidência:** primeira vez. **Não é** [[renderer-onopenupdatemodal-not-defined_2026-09-09T03-15]] nem [[electron-renderer-settingspage-onopenupdatemodal-referenceerror_2026-09-06T04-37]]: lá o botão de Configurações quebrava antes de o modal abrir. Aqui o modal abre, baixa, confere o SHA-256 e falha no último passo.

## Sintoma, na ordem que o cliente viveu

1. Abriu o Xbox Companion e apareceu **Atualização Disponível** (a v2.12.99 foi publicada em 23/09).
2. **Atualizar agora** → barra de download → *"Atualização pronta para instalação!"* → **Reiniciar e Atualizar**.
3. Nada muda: *"Ele baixa e depois fala q precisa fechar e reiniciar para instalar nova versao. Dou ok e nada acontece"* (`[121448]`).
4. Seguiu o contorno do agente (fechar pela bandeja, reiniciar o PC, rodar o `.exe` de novo): *"Continua pedindo a mesma coisa"* (`[121457]`). A frase virou a abertura do chamado #72.
5. Passou a procurar um caminho sem o app: *"Consigo instalar jogos sem ser pelo aplicativo?"* (`[121461]`).

Não há como ligar a conversa de WhatsApp à máquina do cliente na telemetria. O mecanismo abaixo foi medido nas máquinas de outros usuários, e o sintoma é o mesmo.

## Evidência

### 1. A conversa (`Wpp_proccess`, horários UTC; BRT = UTC-3)

| id | dttime | role | mensagem |
|---|---|---|---|
| 121421 | 24/09 16:40:14 | customer | *"nao estou conseguindo atualizar o Xbox companion"* |
| 121442 | 24/09 17:18:24 | customer | *"Baixa a atualização mas nao consigo atualizar"* |
| 121448 | 24/09 17:22:21 | customer | *"Ele baixa e depois fala q precisa fechar e reiniciar para instalar nova versao. Dou ok e nada acontece"* |
| 121450 | 24/09 17:22:43 | XBOX360_AGENT | *"Isso costuma acontecer quando o Xbox Companion ainda fica rodando em segundo plano [...] clique na setinha perto do relógio do Windows [...]"* |
| 121457 | 24/09 17:25:15 | customer | *"Continua pedindo a mesma coisa"* → handoff, chamado #72 aberto às 17:25:38 |
| 121461 | 24/09 17:28:56 | customer | *"Consigo instalar jogos sem ser pelo aplicativo?"* |

### 2. Telemetria: nenhuma atualização aplicada chegou à versão nova

Os eventos `APP_UPDATE` não geram report próprio. Eles só aparecem porque vão junto na cauda do
`godsend-server-<data>.log`, anexada a reports de outros erros (quase todos de USB). Consulta:
`error_logs.content LIKE '%Download complete & verified%'` → 22 logs.

**Como identificar a build que abriu depois:** até a 2.12.94 cada build portable extrai para
`%TEMP%\<ksuid da build>`, e a linha `ELECTRON_UI [INFO] Starting: ...\<ksuid>\godsend-backend.exe`
mostra qual build subiu. Correspondência conferida por um `Check result: current=` do mesmo pid:
`3ICSxc3…` = 2.12.43 · `3Im4eQ96…` = 2.12.58 · `3ItVd4…` = 2.12.67 · `3IzDm0Tx…` = 2.12.78 ·
`3J602Upb…` = 2.12.81.

As máquinas estão anonimizadas (o log traz o nome da conta do Windows).

| máq. | errors | data | de → para | "Applying update" (UTC) | o que abriu depois | desfecho |
|---|---|---|---|---|---|---|
| M1 | 4660 | 05/09 | 2.12.58 → 2.12.67 | 15:33:33 | pid 25716 (já vivo antes) checa às 15:37:34 `current=2.12.58` | falhou |
| M2 | 5196 | 07/09 | 2.12.43 → 2.12.78 | 22:49:50 | **`update:apply error: spawn EPERM`** às 22:50:00; às 23:06 e 23:08 `current=2.12.43` | falhou (outro modo, ver §4) |
| M3 | 5637 | 10/09 | 2.12.78 → 2.12.81 | 11:17:12 | 11:28:15 sobe de `3IzDm0Tx…` (2.12.78) | falhou |
| M4 | 5994 | 12/09 | 2.12.67 → 2.12.81 | 00:19:59 | **13 s depois** (00:20:12) sobe de `3ItVd4…`; 00:27:59 `current=2.12.67` | falhou |
| M5 | 6211 | 13/09 | 2.12.67 → 2.12.81 | 05:34:09 | outras instâncias vivas (14404, 15340); 05:37:15 sobe de `3ItVd4…`; 07:09:45 `current=2.12.67` | falhou |
| M6 | 7003 | 16/09 | 2.12.81 → 2.12.97 | 20:08:17 | **16 s depois** (20:08:33) sobe de `3J602Upb…` (2.12.81) | falhou |
| M6 | 7295 → 7619 | 18/09 | 2.12.97 → 2.12.98 | 12:54:14 | em 20/09 12:52:04 `current=2.12.97` | falhou |
| M6 | 7666 → 8339 | 20/09 | 2.12.97 → 2.12.98 | 16:30:40 | em 23/09 13:37:12 `current=2.12.97` | falhou |
| M7 | 7334 | 18/09 | 2.12.81 → 2.12.98 | 18:49:14 | 18:51:35 sobe de `3J602Upb…`; 18:52:42 `current=2.12.81` | falhou |
| M7 | 7346/7347 | 18/09 | 2.12.81 → 2.12.98 | 18:59:50 | 20:39 **cinco** instâncias de `3J602Upb…`; 20:52:31 `current=2.12.81` | falhou |
| M8 | 7612–7616 | 20/09 | 2.12.78 → 2.12.98 | 16:11:05 | sobem `3J602Upb…` (2.12.81) e `3IzDm0Tx…` (2.12.78), lado a lado | falhou |

Fora da conta: M6 em 23/09 (2.12.97 → 2.12.99, "Applying" às 13:39:35, sem `Check result` posterior
na cauda) e uma máquina em 22/09 que baixou mas não aplicou. **Resultado: 11 de 11 falharam, e
nenhum sucesso aparece em nenhum dos 22 logs.** A amostra é enviesada (só entra quem teve outro erro
reportado), mas nela a taxa de falha é total.

O download e o manifesto estão íntegros. Todas as tentativas registram `Download complete & verified`,
e o hash de M6 em 23/09 (`816b73af…`) é o `sha256` que o `version.json` público anuncia para a 2.12.99.

### 3. O que o código faz depois de "Reiniciar e Atualizar"

`autoUpdateService.ts:416-449`:

```ts
let targetExecutable = process.env.PORTABLE_EXECUTABLE_FILE || "";
if (!targetExecutable) {
  if (app.isPackaged && process.platform === "win32") {
    targetExecutable = process.execPath;
  }
}
...
      Start-Sleep -Milliseconds 1500
      ...
      while ($attempts -lt 20) {
        try {
          Copy-Item -LiteralPath $source -Destination $target -Force
          break
        } catch {
          Start-Sleep -Milliseconds 500
          $attempts++
        }
      }
      Start-Process -FilePath $target
...
    app.quit();
```

- **O alvo é o launcher portable em execução.** O arquivo distribuído como `xboxcompanion.exe` é o
  build **portable** (`build-and-upload.ps1` copia `xbox-360-companion-Portable-<ver>.exe` com esse
  nome; o `hfUrl` do `version.json` público aponta para `...-Portable-2.12.99.exe`). No template da
  biblioteca (`app-builder-lib/templates/nsis/portable.nsi`), o launcher grava
  `PORTABLE_EXECUTABLE_FILE = $EXEPATH` (ele mesmo), roda o app com `ExecWait` e **só depois** faz
  `RMDir /r $INSTDIR`. A pasta extraída tem 1,3 GB e 770 arquivos (`dist/win-unpacked`, medido
  localmente). Ou seja: o `.exe` que o script tenta sobrescrever continua em execução até o
  Electron fechar **e** a limpeza terminar.
- **O orçamento é fixo e conta a partir do pedido de saída**, não do fim do launcher: 1,5 s + 20 × 500 ms
  ≈ 11,5 s. Nada espera o PID do launcher.
- **`Start-Process -FilePath $target` roda incondicionalmente.** Se as 20 cópias falharam, ele reabre o
  `.exe` **antigo**. O script não grava log, código de saída nem marcador. O app antigo volta sem saber
  de nada e oferece a mesma atualização de novo — é o *"continua pedindo a mesma coisa"*.
- **Medido nesta máquina** (PowerShell 5.1.26100, laço copiado do código, destino aberto por outro
  processo durante 30 s): 20 `IOException` capturadas em intervalos de ~510 ms, `attempts=20`, e o
  destino **continua com o conteúdo antigo**. O retry funciona como está escrito: ele desiste e segue
  em silêncio. (Descartada a hipótese de que o `catch` não pegasse o erro do `Copy-Item`: ele pega.)

### 4. O modal ignora a falha que o IPC devolve

`ipc/updateHandlers.ts:70-78` nunca lança: em erro devolve `{ ok: false, error }`.
`AppUpdateModal.tsx:119-128`:

```tsx
async function handleApplyAndRestart() {
  setIsApplying(true);
  try {
    await window.godsendApi.applyUpdateAndRestart(downloadedFilePath);
  } catch (err: any) { ... setModalState("error"); }
}
```

O retorno é descartado. Em M2 (`spawn EPERM`, o PowerShell barrado na máquina), o app não fecha, o
modal fica em **"Reiniciando..."** com os dois botões desabilitados, e o erro só existe no log local.
É o outro caminho literal do *"dou ok e nada acontece"*.

## Causa raiz

**Provado no código:**

1. O script de substituição relança o alvo **quer a cópia tenha dado certo, quer não**, e não deixa
   rastro. Qualquer falha de cópia vira "o app reabriu na mesma versão".
2. O renderer descarta `{ ok: false }` do `update:apply`. Qualquer falha **antes** do `app.quit()` vira
   um spinner eterno.

**Provado na telemetria:** em 11 de 11 aplicações observadas, a build que voltou foi a antiga.

## Hipóteses — nenhuma verificada (quem segura o alvo durante os ~11,5 s)

- **H1 — o próprio launcher.** `ExecWait` + `RMDir /r` de 1,3 GB (template acima). Compatível com
  M3, M4 e M6-16/09, que não tinham outra instância viva no trecho de log. Falta medir: com o portable
  real, rodar o fluxo e registrar (Process Monitor ou log do script) quando o launcher termina em
  relação às tentativas de cópia.
- **H2 — outras instâncias do app** (antes da trava de instância única da 2.12.95): M1, M5, M7 e M8
  tinham outros pids vivos, alguns de **outra build**, cada um preso ao seu launcher.
- **H3 — a partir da 2.12.95 (`unpackDirName: true` → `$PLUGINSDIR\app`), o app às vezes não é
  aberto pelo launcher.** Em M6 na 2.12.97, o `userData` está em `AppData\Roaming` (e não em
  `<pasta do exe>\godsend-data`), e o backend sai de `Temp\nsvEF9C.tmp\app\` — **o mesmo caminho em
  20/09 e em 23/09**. O template sempre define `PORTABLE_EXECUTABLE_DIR` antes do `ExecWait`, então
  esse processo não veio do launcher (atalho ou fixação na barra de tarefas apontando para o exe
  extraído?). Nesse estado, `PORTABLE_EXECUTABLE_FILE` está vazio e o alvo vira `process.execPath`: o
  **exe interno** numa pasta temporária, não o arquivo que o usuário abre.

## Escopo — o que NÃO é este bug

- O `ReferenceError: onOpenUpdateModal` (fechado): lá o modal nem abria.
- Download ou integridade: todas as tentativas terminam em `Download complete & verified`.
- Manifesto: o `version.json` anuncia 2.12.99 com o hash que o app baixou.
- O lado do **agente de WhatsApp**: o guia manda "instalar clicando em Avançar/Instalar" num arquivo
  que é portable e não tem nenhuma seção sobre atualizar o app. Está no repositório do agente:
  `digitalstoregamesproject/docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-09-24-guia-xbox360-descreve-instalador-que-nao-existe-e-nao-cobre-atualizacao-do-companion.md`.
  Os dois sobrevivem sozinhos: consertar o updater não corrige o guia, e vice-versa.

## Tarefas propostas

- **T1 — o modal lê o `ok`.** Em `ok: false`, ir para o estado de erro com a mensagem e um caminho
  manual (link do `xboxcompanion.exe` + "feche pelo ícone da bandeja → **Quit** e abra o arquivo novo").
  Teste: `update:apply` devolvendo `{ ok: false }` leva o modal a `error`.
- **T2 — esperar o launcher, não o relógio.** Passar ao script o PID do launcher (no portable, o pai
  do processo principal do Electron; **confirmar** antes de usar) e fazer `Wait-Process` nele antes de
  copiar, com timeout maior. Se a cópia falhar no fim: **não** relançar o antigo em silêncio. Gravar o
  desfecho em `<userData>/logs/` e relançar com um argumento que faça o app avisar "não foi possível
  aplicar; baixe manualmente".
- **T3 — tornar a falha mensurável.** Antes do `app.quit()`, gravar a versão que está sendo aplicada. No
  boot seguinte, se `app.getVersion()` for menor, reportar à telemetria (`update aplicado mas a versão não
  mudou`). Hoje esse defeito tem **zero** reports: só apareceu de carona em logs de erro de USB.
- **T4 — alvo inválido.** Build empacotada no Windows, sem `PORTABLE_EXECUTABLE_FILE` e com `execPath`
  dentro de `os.tmpdir()`: não sobrescrever. Abrir a pasta do arquivo baixado e orientar.
- **T5 — testes.** Hoje nada cobre `applyUpdateAndRestart` (`tests/unit/autoUpdate.test.cjs` só testa
  semver, SHA-256 e throttle). Cobrir: o script espera o PID, não relança sem cópia confirmada, e o
  renderer trata `ok: false`.
- **Doc-sync ao corrigir:** `docs/ATUALIZACAO-AUTOMATICA.md` descreve "substituição atômica" — é um
  `Copy-Item` sobre o executável em uso, com relançamento incondicional.

## Resolução (v2.12.100)

- **T1** — `AppUpdateModal.handleApplyAndRestart` lê `ok`; em `ok: false` vai para `error` com a
  mensagem, os passos manuais e o botão **Mostrar arquivo baixado** (`update:show-downloaded-file`).
  `applyUpdateAndRestart` ficou assíncrona e só chama `app.quit()` depois do evento `spawn` do
  PowerShell: o `spawn EPERM` de M2 agora chega ao modal em vez de travar em "Reiniciando...".
- **T2** — `buildReplaceScript` espera o pid do Electron **e todo processo cujo `Path` é o alvo**
  (até 180 s) antes de copiar. Não usei `process.ppid`: a checagem por caminho confirma o launcher
  sem supor quem é o pai, e cobre H2 (outras instâncias abertas do mesmo arquivo). O relançamento
  continua incondicional **de propósito** — deixar o usuário sem app é pior —, mas o script grava
  `update-result.txt` (`ok` / `copy-failed: <erro>`), e o app antigo agora sabe ler isso (T3).
- **T3** — antes de fechar, o app grava `<userData>/update-pending.json`. No boot,
  `checkPendingUpdateResult()` consome o marcador; se `app.getVersion()` não chegou à versão de
  destino, grava `APP_UPDATE` no log, chama `reportError(... "update aplicado mas a versão não
  mudou ...")` e `App.tsx` abre o modal em erro com o motivo.
- **T4** — `resolveReplaceTarget` recusa `execPath` dentro de `os.tmpdir()` quando não há
  `PORTABLE_EXECUTABLE_FILE` (H3), com mensagem que leva ao caminho manual.
- **T5** — `tests/unit/autoUpdate.test.cjs`: alvo, marcador, e o script rodando de verdade no
  PowerShell. O teste do launcher usa um `PING.EXE` copiado para o caminho do alvo, vivo por ~14 s,
  e `waitPid` apontando para um pid morto (só a checagem por caminho pode segurar a cópia).
  **Conferido vermelho→verde:** o script antigo, no mesmo cenário, termina com `attempts=20` e o
  alvo inalterado — a reprodução do campo. **Não coberto por teste:** o modal tratando `ok: false`
  (o renderer não tem harness de componente; coberto por typecheck e leitura).
- **Limite conhecido:** quem está em ≤ 2.12.99 aplica a 2.12.100 com o script **antigo** e cai no
  mesmo defeito uma última vez. Essa migração precisa do caminho manual (e do guia do agente de
  WhatsApp, bug registrado no repositório do agente).
- **Não verificado:** H1 com o portable real (Process Monitor). O teste reproduz o mecanismo, não a
  duração exata do `RMDir /r` em campo; o teto de 180 s é margem, e se estourar o desfecho agora é
  visível na telemetria.
