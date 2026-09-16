# Bug: o app abre várias instâncias ao mesmo tempo, e elas brigam por USB, fila, scratch e binários

- **Detectado em:** 2026-09-15 14:44 (telemetria de produção)
- **Origem:** telemetria `xbox-360-companion/electron-main` (`badAvatarHandlers.ts::tools:badavatar-list-drives`) e `xbox-360-companion/pipeline` (`fallback.go::ProcessGameWithFallback`)
- **Errors (serviço):** ver tabela "IDs por sintoma" abaixo — 153 + 8 + 2 + 7 + 7 + 4 (+3 compatíveis) = 184
- **Classe:** fail (funcional recorrente; nenhum crash)
- **Versões:** ElectronApp v2.12.78 (8 reports) e **v2.12.81** (145 reports) — a v2.12.81 **já contém** a correção de [`enumeracao-usb-timeout-e-dispositivo-mudou-desde-a-selecao`](../closed/enumeracao-usb-timeout-e-dispositivo-mudou-desde-a-selecao_2026-09-08T00-00.md) (v2.12.79)
- **Reincidência:** primeira vez como causa própria; é a razão pela qual o timeout de USB continuou chegando depois do fix da v2.12.79
- **Código atual (v2.12.93):** nenhuma das três causas abaixo foi corrigida — `requestSingleInstanceLock` não aparece em lugar nenhum de `src/electron-app`

## Sintoma

O mais visível é a mensagem de sempre, na tela do pendrive:

```
O Windows demorou demais para listar os dispositivos USB. Remova e conecte o
pendrive novamente, aguarde alguns segundos e tente atualizar a lista.
```

153 reports em 5 dias. Mas o log que vai anexo em cada report (`seq=0`, tail do
`godsend-server-<data>.log`) mostra outra coisa: **vários processos do app escrevendo no
mesmo arquivo de log ao mesmo tempo**. `serverLog.ts:66` grava `process.pid` do main do
Electron em toda linha, então cada `pid=` diferente é uma instância diferente do app.

Amostra de 16 reports espalhados pelos 5 dias, pico de instâncias com intervalo de vida
sobreposto (limite inferior — o log anexo é só a cauda):

| error | versão | máquina | pids no log | pico simultâneo |
|---|---|---|---:|---:|
| 5696 | v2.12.78 | A | 7 | 3 |
| 5707 | v2.12.81 | B | 12 | 9 |
| 5718 | v2.12.81 | B | 19 | 14 |
| 5741 | v2.12.78 | C | 5 | 4 |
| 5813 | v2.12.81 | D | 11 | 10 |
| 5941 | v2.12.81 | B | 2 | **1** |
| 6016 | v2.12.81 | C | 7 | 7 |
| 6241 | v2.12.81 | E | 7 | 4 |
| 6252 | v2.12.81 | E | 16 | 15 |
| 6518 | v2.12.81 | F | 3 | 2 |
| 6575 | v2.12.81 | ? | 10 | 9 |
| 6606 | v2.12.81 | ? | 17 | 17 |
| 6635 | v2.12.81 | ? | 1 | **1** |
| 6657 | v2.12.81 | G | 7 | 7 |
| 6751 | v2.12.81 | H | 5 | 4 |
| 5877 | v2.12.81 | ? | 3 | 2 |

**14 de 16** com duas ou mais instâncias vivas juntas, em pelo menos 8 máquinas. Cada
instância nova sobe **outro backend Go**, que cai numa porta nova porque a anterior está
ocupada (6754):

```
14:19:35.748Z pid=4196  APP_BACKEND spawned pid=9784
14:19:36.301Z pid=4196  APP_CONFIG  serverPort=8097 (auto, requested port in use)
14:34:49.152Z pid=424   APP_BACKEND spawned pid=22984
14:34:50.130Z pid=424   APP_CONFIG  serverPort=8098 (auto, requested port in use)
14:35:09.576Z pid=18932 APP_BACKEND spawned pid=14520
14:35:10.298Z pid=18932 APP_CONFIG  serverPort=8099 (auto, requested port in use)
```

## Causa raiz

### 1. Não existe trava de instância única

`src/electron-app` não chama `app.requestSingleInstanceLock()` nem trata `second-instance`.
Três coisas no código atual fazem o usuário abrir o `.exe` de novo com o app ainda vivo:

- **Fechar a janela não fecha o app.** `app/window.ts:100-103`: no `close`, se não
  `isQuitting`, `preventDefault()` + `hide()`. O processo, o backend e o polling seguem
  vivos na bandeja. O usuário abre o `.exe` de novo e ganha a instância 2.
- **O portátil não mostra nada enquanto extrai.** O template
  `app-builder-lib/templates/nsis/portable.nsi` roda `SetSilent silent` quando não há
  `SPLASH_IMAGE`, e `package.json` não define splash. Centenas de MB descompactando em
  `%TEMP%` sem nenhum sinal na tela é convite a clicar de novo.
- A prova de que as instâncias extras estão **escondidas**: no 6754 o `pid=8684` lista USB
  exatamente a cada ~60 s (`13:00:00`, `13:00:58`, `13:01:58`, `13:02:58`…), que é o
  throttling de timers do Chromium para janela oculta — o `setInterval` de 5 s em
  `HomePage.tsx:155` rodando em segundo plano.

### 2. N instâncias = N sondas PowerShell de USB em paralelo

Cada instância com a `HomePage` montada chama `tools:badavatar-list-drives` a cada 5 s
(`HomePage.tsx:155`). Cada chamada grava um `.ps1` em `%TEMP%` e sobe um `powershell.exe`
(`windowsUsbDeviceService.ts:23-44`), mais a sonda de integridade de até 3 s. O guard
`preparedCheckInFlight` é por componente, então não evita nada entre instâncias. Com 10 a
17 instâncias vivas, os `powershell.exe` competem entre si e estouram o teto de 5 s do
script nativo — é o timeout que chega na telemetria. O fix da v2.12.79 tirou o Storage
Management do caminho, mas não tinha como cobrir isso.

Os 7 `ENOSPC: no space left on device, write` (5820…5877) são a mesma chamada falhando no
`writeFileSync` do `.ps1` em `%TEMP%` com o `C:` cheio, numa máquina com **11** instâncias
simultâneas. O disco cheio é ambiente; as 11 instâncias, não.

### 3. N backends retomam os mesmos jobs no mesmo `GODSEND_HOME`

Todas as instâncias apontam para o mesmo `userData` (`...\godsend-data`) e portanto para o
mesmo `GODSEND_HOME`, a mesma fila persistida e o mesmo scratch.

- `main.go:170`: todo backend faz `go deps.ResumeQueuedJobs()` no boot, que relança **todo**
  job não terminado da fila persistida (`queue_resume.go:165-199`).
- `queueStoreMu` (`queue_store.go:48`) é um `sync.Mutex` **em memória**; não protege nada
  entre processos.
- `markScratchOwner` (`config.go:373-378`) **sobrescreve** o `.godsend-owner.pid` com o pid
  do backend mais novo. Quando esse sai, o próximo a subir vê dono morto e
  `cleanupStaleScratchDir` (`config.go:340-370`) apaga o scratch do backend mais antigo, que
  continua trabalhando.

Resultado: dois ou mais backends escrevendo nos mesmos `_hf_ext\...\*.xbox-companion-part`,
no mesmo `.xbox-companion-resume.json` e no mesmo destino. Os três pontos de escrita
(`local_resilient.go:354-420`, `iso2god.go:1040-1073`, `iso2god.go:1482-1526`) fazem
`Sync()` + `Close()` **antes** do `os.Rename`, então a violação de compartilhamento não
é do próprio handle — é o outro backend com o mesmo arquivo aberto:

```
huggingface: Gravação local: falha no dispositivo local: gravar audio_misc.rpf:
rename D:\Games\GTA 5 (7.61) - 545408A7\sfx\audio_misc.rpf.xbox-companion-part
       D:\Games\GTA 5 (7.61) - 545408A7\sfx\audio_misc.rpf:
The process cannot access the file because it is being used by another process.
```

As máquinas batem: a máquina G (6754, 6657: 4 a 7 instâncias) é a mesma de 6658, 6728 e
6729 (o mesmo `GTA 5 (7.61)` no scratch dela, 2026-09-15); 6666 e 6685 são o mesmo release
gravando em `D:\`, que é o pendrive listado no log da máquina G, mas o caminho não traz o
usuário — provável, não comprovado. A máquina C (5741, 6016: 4 a 7 instâncias) é a mesma de
5831 e 5837.

### 4. Uma instância que abre ou fecha apaga os binários das outras

`src/electron-app/package.json:135` usa `"unpackDirName": false`. No
`app-builder-lib/out/targets/nsis/NsisTarget.js:254-255` isso vira um **ksuid fixo gerado no
build**, ou seja, todo usuário daquela versão extrai em `%TEMP%\<o mesmo nome>` (a v2.12.81 é
`3J602Upb4WFILC7PYfdF9CPrYZx`, visto nos logs de máquinas diferentes). E o `portable.nsi`
faz `RMDir /r $INSTDIR` **antes** de extrair e **de novo** depois do `ExecWait`.

Com duas instâncias da mesma versão, abrir ou fechar uma apaga do diretório tudo o que não
está travado pela outra — `aria2c.exe` só fica travado enquanto baixa:

```
minerva: Minerva torrent failed: aria2c start: fork/exec
  C:\Users\<user>\AppData\Local\Temp\3J602Upb4WFILC7PYfdF9CPrYZx\aria2c.exe:
  The system cannot find the file specified.
minerva: Minerva torrent failed: aria2c not found — bundled binary missing and not in PATH.
```

## IDs por sintoma

| Sintoma | IDs | Relação |
|---|---|---|
| Timeout ao listar USB | 5696–5700, 5702–5711, 5713–5722, 5724–5726, 5737, 5738, 5741, 5764, 5772, 5782–5785, 5810–5814, 5816, 5817, 5910, 5911, 5935–5942, 5958, 5978, 5979, 5981, 6012–6019, 6021, 6080, 6153, 6178, 6238–6253, 6257, 6258, 6280, 6281, 6502, 6506, 6515, 6516, 6518, 6565–6576, 6583, 6585–6592, 6601, 6602, 6606–6611, 6613–6615, 6631, 6635, 6645–6647, 6650–6653, 6655–6657, 6673, 6674, 6683, 6684, 6745–6754 (153) | causa 2 |
| Timeout ao listar USB — chegaram **durante** a triagem de 2026-09-15 | 6766, 6768, 6778–6781 (6) | causa 2; pico de 1 a 8 instâncias |
| `Não foi possível enumerar os dispositivos USB.` — `powershell.exe` saiu com código ≠ 0 e stderr vazio (`windowsUsbDeviceService.ts:81`) | 6777, 6782 (2) | causa 2; os dois logs têm **8** instâncias simultâneas e dezenas de `enumeração nativa falhou` de pids diferentes no mesmo segundo |
| Timeout ao listar USB — segunda rodada, 2026-09-15 18:29–19:00 | 6785, 6793 (2) | causa 2; 4 instâncias simultâneas em cada log, 3 e 4 backends com `serverPort=... (auto, requested port in use)` |
| `ENOSPC` ao listar USB (C: cheio + 11 instâncias) | 5820–5825, 5877 (7) | causa 2, agravada |
| `rename ... being used by another process` / scratch perdido | 6658, 6666, 6685, 6728, 6729, 5831, 5837 (7) | causa 3 |
| `aria2c` apagado do diretório de extração | 6531, 6539, 6544, 6545 (4) | causa 4 |
| Compatíveis, não comprovados | 5743 (`aria2c unusable: exit status 1`, v2.12.78), 6654 (GTA 5 `not a valid 7-zip file`, máquina G) | causas 4 e 3 |
| Compatível, não comprovado | 6798 (timeout de USB, v2.12.81) | causa 1: quatro `app ready` de pids diferentes **no mesmo milissegundo** (19:10:12.73x), nenhum deles sobe backend nem escreve outra linha; o quinto lançamento, 4 min depois, é o que reporta — sozinho no log, backend na porta 8080 sem conflito. Máquina lenta (44 s entre `app ready` e `Starting` do backend) e a sonda que estoura (19:15:31–36) começa junto com o fim do carregamento de caches do próprio backend. Não há sonda concorrente visível, então pode ser só a máquina |

5837 também aparece com disco cheio na conversão GOD; o `rename` do checkpoint de resume é
o primeiro provedor.

## Como reproduzir

1. Build portátil. Abrir o `.exe`, esperar a janela, **fechar no X** (vai para a bandeja).
2. Abrir o `.exe` de novo. Repetir 5 a 10 vezes.
3. Com um pendrive conectado, ficar na Home: o log do dia mostra vários `pid=` e, com
   instâncias suficientes, `enumeração nativa falhou: O Windows demorou demais...`.
4. Para a causa 3: enfileirar um jogo grande, fechar no X, abrir de novo. Os dois backends
   logam `QUEUE RESUME: retomando "<jogo>"` e disputam os mesmos arquivos.
5. Para a causa 4: com duas instâncias abertas e um job Minerva na fila da primeira, sair da
   segunda pela bandeja. `%TEMP%\<unpackDir>\aria2c.exe` some.

## Resolução (v2.12.95)

- **Electron Single Instance Lock (`src/electron-app/main.ts`, `app/bootstrap.ts`, `app/window.ts`)**:
  - `main.ts` agora chama `app.requestSingleInstanceLock()` logo após fixar `userData`. Instâncias subsequentes chamam `app.quit()` imediatamente sem registrar esquemas, sem carregar o bootstrap e sem subir backend.
  - O manipulador do evento `second-instance` em `bootstrap.ts` invoca `focusMainWindow()` (`window.ts`), que restaura a janela caso minimizada, exibe-a caso oculta na bandeja (`close-to-tray`) e dá foco no primeiro plano.
- **Backend GODSEND_HOME Lock (`src/server/app/homelock.go`, `homelock_windows.go`, `homelock_other.go`, `config.go`)**:
  - `*App.AcquireHomeLock()` estabelece trava exclusiva de arquivo (`LockFileEx` no Windows com `LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY` no offset 4096, e `syscall.Flock` no POSIX) sobre `.godsend.lock` em `GODSEND_HOME`. O kernel do sistema operacional libera o lock automaticamente caso o processo seja terminado ou sofra crash.
  - `SetupPaths()` invoca `AcquireHomeLock()` antes de qualquer limpeza de scratch ou criação de arquivos de fila; se o diretório estiver travado por outro backend, recusa a inicialização com mensagem clara indicando o PID proprietário.
  - `ResumeQueuedJobs()` e a rotina de retentativa de FTP em `main.go` agora checam `a.HasHomeLock()` antes de restaurar trabalhos.
- **Proteção do dono de scratch (`src/server/app/config.go::markScratchOwner`)**:
  - `markScratchOwner` confere se `.godsend-owner.pid` já existe e se o PID registrado corresponde a um processo em execução (`processIsRunning(pid)` e `pid != os.Getpid()`). Nesses casos, a posse não é sobrescrita, impedindo que encerramentos posteriores limpem o scratch de um processo ativo via `cleanupStaleScratchDir`.
- **Isolamento da extração do executável portátil (`src/electron-app/package.json`)**:
  - Alvo `portable` configurado com `"unpackDirName": true`. Evita o bug do electron-builder onde `false` definia uma pasta fixa em `%TEMP%`, garantindo que cada execução descompacte em `$PLUGINSDIR\app` isolado e autolimpante.
- **Testes**:
  - `homelock_test.go` cobre aquisição, detecção de conflito com PID no erro, liberação/re-aquisição e preservação do dono de scratch.
  - `singleInstance.test.cjs` cobre restauração/foco de janela oculta/minimizada, contrato de saída em segunda instância e configuração do portátil.

