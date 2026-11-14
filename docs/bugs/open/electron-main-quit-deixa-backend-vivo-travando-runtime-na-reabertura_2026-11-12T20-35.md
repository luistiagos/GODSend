# Bug: fechar o aplicativo pelo tray (`Quit`) deixa `godsend-backend.exe` travando `GODSEND_HOME` na reabertura e sobe a UI sem backend

- **Detectado em:** 2026-11-12 20:35 (sessão WhatsApp `556999793860` + telemetria `13719`, sem chamado formal em `wpp_support_ticket`)
- **Origem:** telemetria (`13719`, `13721`) + leitura de `src/electron-app/app/bootstrap.ts` (`before-quit`), `src/electron-app/services/backendClient.ts` (`stopGodsend`) e `src/server/app/homelock.go`
- **Errors (serviço):** `13719` (`2026-11-12T22:51:44`, `backend v2.12.128`, `SetupPaths failed: data directory C:\Users\pcfor\AppData\Roaming\xbox-360-companion-electron\runtime is locked by another instance of godsend (pid 11072)`)
- **Classe:** falha funcional / vazamento de processo filho
- **Severidade:** P2 - Médio — o Electron abre sem backend ativo e todas as chamadas HTTP locais ao servidor Go falham até o processo antigo terminar de encerrar ou ser morto
- **Complexidade:** média — coordenação de encerramento síncrono/assíncrono do processo filho (`backendClient.ts` / `bootstrap.ts` no Windows)
- **Reincidência:** primeira vez documentada neste sintoma

## Sintoma, na ordem que o cliente viveu

Às `22:48:20 UTC` (`19:48 BRT`), seguindo orientação do suporte para fechar o aplicativo pelo tray (**Quit**) enquanto o GTA 5 estava travado na extração, o cliente encerrou o Electron (`pid=10260`). Três minutos depois, às `22:51:39 UTC`, abriu o aplicativo novamente (`pid=10312`). O Electron abriu a janela, tentou subir o `godsend-backend.exe` (`pid=1352`), mas o backend caiu imediatamente com erro fatal de lock porque o backend da sessão encerrada havia 3m20s (`pid=11072`) ainda estava rodando e segurando `runtime`:

```text
SetupPaths failed: data directory C:\Users\pcfor\AppData\Roaming\xbox-360-companion-electron\runtime is locked by another instance of godsend (pid 11072)
```

A instância `pid=10312` permaneceu aberta por ~8 minutos sem backend ativo até o cliente fechá-la novamente às `22:59:42Z`; na reabertura seguinte (`pid=7868`, `22:59:45Z`), `pid=11072` já havia saído e o backend `pid=4328` subiu normalmente.

## Evidência

1. **Log contínuo em `error_logs` (`error_id=13721`) + erro `13719` (`ElectronApp v2.12.128`, `DESKTOP-H1NAROL`):**
   - `2026-11-12T22:48:20.837Z pid=10260 APP_LIFECYCLE application before-quit`
   - `2026-11-12T22:48:20.839Z pid=10260 APP_BACKEND stop requested (kill)`
   - `2026-11-12T22:48:20.841Z pid=10260 ELECTRON_UI [INFO] Stopping process...` *(sem linha `BACKEND_END` antes do Electron encerrar)*
   - `2026-11-12T22:51:39.098Z pid=10312 APP_LIFECYCLE app ready ...`
   - `2026-11-12T22:51:40.620Z pid=10312 APP_BACKEND spawned pid=1352`
   - `2026-11-12T22:51:40.907Z pid=10312 BACKEND_OUT [FATAL] Setup failed: data directory C:\Users\pcfor\AppData\Roaming\xbox-360-companion-electron\runtime is locked by another instance of godsend (pid 11072)`
   - `2026-11-12T22:51:41.666Z pid=10312 BACKEND_END reason=process_exit exitCode=1 signal=none`

## Causa raiz

Confirmada no fonte:

- `src/electron-app/app/bootstrap.ts` (`before-quit`, L236-240) apenas chama `stopGodsend()` sem impedir nem aguardar o término efetivo do processo filho antes da saída do Electron.
- `src/electron-app/services/backendClient.ts::stopGodsend` (L229-234) chama apenas `godsendProcess.kill()` de forma fire-and-forget, sem aguardar `close`/confirmação de saída nem encerrar subprocessos filhos no Windows. Se o `godsend-backend.exe` demorar para sair (ou se houver subárvore/I/O ativo em curso), o Electron termina primeiro enquanto `pid=11072` continua segurando o lock de `GODSEND_HOME` (`src/server/app/homelock.go:45`), fazendo o próximo `godsend-backend.exe` abortar no `SetupPaths` logo após a reabertura.

## Escopo — o que NÃO é este bug

- **Não é erro do lock de `homelock.go`:** o lock cumpriu seu papel ao impedir duas instâncias do backend compartilhando `GODSEND_HOME` e `scratch`. O defeito é o encerramento pelo Electron sair sem garantir que o backend anterior terminou antes de liberar o processo principal.

## Tarefas propostas / Proximos passos

1. No `before-quit` (`bootstrap.ts`) + `stopGodsend` (`backendClient.ts`), interceptar a primeira passagem de saída (`event.preventDefault()` enquanto o backend ainda está vivo), aguardar a saída do `godsendProcess` por um prazo curto (e aplicar `taskkill /F /T /PID` no Windows em fallback se não fechar), só então concluir `app.quit()`.
2. Garantir em teste unitário/integração de lifecycle que, após `Quit` e reabertura imediata, o antigo PID já encerrou ou há retry breve de inicialização do backend antes de declarar falha permanente.

