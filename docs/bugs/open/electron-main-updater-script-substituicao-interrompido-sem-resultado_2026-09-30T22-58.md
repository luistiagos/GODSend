# Bug: Script PowerShell de substituição do auto-updater é interrompido sem registrar resultado após o fechamento do Electron

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
