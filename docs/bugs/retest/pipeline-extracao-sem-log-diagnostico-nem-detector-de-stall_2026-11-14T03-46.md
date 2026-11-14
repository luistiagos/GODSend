# Bug: extração de arquivos não emite diagnóstico em `BACKEND_OUT` nem detecta travamento (`stall`), deixando suporte e telemetria cegos

- **Detectado em:** 2026-11-14 03:46 (investigação do Chamado `#371`, `+55 69 9979-3860`, `DESKTOP-H1NAROL`, `v2.12.128`, `errors` `13720`/`13721`/`13726`)
- **Origem:** `src/server/services/pipeline/extraction_progress.go` (`archiveExtractionProgress`), `src/server/services/pipeline/stage_checkpoint.go` (`extractArchiveResilient`, `extractISOResilient`), `src/server/utils/archive_progress.go` (`archiveProgress`, `extractionProgressWriter`), `src/server/utils/iso2god.go` (`ExtractArchiveWithProgress`, `extractRarFilter`, `drainRAR`, `extractFileAtomically`)
- **Errors (serviço):** `13720` (`2026-11-12T22:51:59Z`), `13721` (`2026-11-12T23:00:04Z`), `13726` (`2026-11-12T23:45:52Z`) — os logs enviados não contêm **nenhuma** linha da etapa de extração apesar de o processo ter ficado ~1h20 nela
- **Classe:** falha de observabilidade / resiliência
- **Severidade:** P2 - Médio — quando a extração degrada ou congela sem erro do SO, não há log no `BACKEND_OUT`, não há detecção de stall e a UI omite o volume de trabalho real, induzindo diagnósticos errados
- **Complexidade:** alta — `src/server/services/pipeline/` e `src/server/utils/` (instrumentação da extração e telemetria sem afetar throughput de disco)
- **Versões:** observado em `v2.12.128`; presente no código atual
- **Reincidência:** primeira vez documentada para a etapa de extração (download HTTP já possui log periódico e `Download speed threshold monitoring`)

## Sintoma

No Chamado `#371` (`DESKTOP-H1NAROL`, `v2.12.128`), após o download do `GTA 5` (`14700.1 MB`) concluir e ser verificado às `2026-11-12T21:28:01Z` (`DOWNLOAD VERIFY [GTA 5]: concluido em 3m18.189s`), o cliente ficou ~1h20 na etapa de extração (`[178387]` `21:50` `5448.6 MiB` → `[178408]` `21:59` `5458.0 MiB`, `~17.7 KiB/s` → `[178585]` `22:41` `5458.0 MiB`, `0 B/s` por 42 min) antes de fechar o programa às `22:48:20Z`.

Ao inspecionar os logs completos em `error_logs` (`err_13720_seq0.txt` linhas `1059–1601`):

1. **Silêncio absoluto em `BACKEND_OUT`:** depois de `DOWNLOAD VERIFY [GTA 5]: concluido em 3m18.189s`, não existe **nenhuma** linha informando que a extração começou, em qual caminho/volume (`D:\godsend-temp\proc`) está extraindo, quanto espaço livre havia em `D:`, qual arquivo interno estava sendo extraído aos `5458.0 MiB` nem a velocidade da extração.
2. **Sem detecção de stall / falha silenciosa:** o backend nunca disparou alerta nem registrou stall mesmo com a taxa caindo para `0 B/s` por mais de 40 minutos.
3. **Erro de diagnóstico no suporte e na UI:** como a mensagem exibida ao usuário era apenas `Extraindo arquivos: 5465.3 MiB; 8 arquivos concluidos` (sem o drive real escolhido por `bestFixedVolume()`), o agente de atendimento assumiu três vezes que o app estava enchendo `C:` (`[178599]`, `[179642]`, `[179646]`) e mandou o cliente liberar até 80 GB em `C:` e mover o executável para `E:\Companion`, quando na verdade a sessão inteira estava rodando em **`D:\godsend-temp`**.

## Causa raiz

Confirmada no código atual:

1. `archiveExtractionProgress` (`src/server/services/pipeline/extraction_progress.go:10-29`) chama apenas `s.App.LogStatus(gameName, "Processing", message)`, que atualiza `JobQueue` em memória (`src/server/app/app.go:138-158`) sem emitir nada para `stdout` (`BACKEND_OUT` / `server.log`) e sem informar o drive de trabalho.
2. `extractArchiveResilient` / `extractISOResilient` (`src/server/services/pipeline/stage_checkpoint.go:309-344`) e `utils.ExtractArchiveWithProgress` (`src/server/utils/iso2god.go:833-857`) não registram no início da etapa `archivePath`, `destDir`, volume e `freeSpaceBytes` do volume de extração, nem qual entrada (`h.Name` / `f.Name`) está aberta no momento.
3. `archiveProgress` (`src/server/utils/archive_progress.go:18-47`) só conta `Bytes` e `Files`, sem rastrear throughput, janela de stall (`0 B/s` por `N` minutos) ou separação entre bloqueio na leitura/descompressão (`src.Read`) e bloqueio na escrita/flush (`out.Write`/`out.Sync`), e não há goroutine/relatório de erro em telemetria quando a extração fica parada sem progresso.

## Como reproduzir

1. Executar qualquer pipeline com extração (`.rar`, `.zip` ou `.7z`) e inspecionar `BACKEND_OUT` / `logs`.
2. Observar que, entre `DOWNLOAD VERIFY ... concluido` (ou início da extração) e a conclusão/erro da fase, nenhuma linha de progresso, arquivo atual, volume efetivo ou taxa é gravada no log.
3. Simular leitura/escrita travando (`Write` ou `Read` bloqueado após `X` MiB): a interface permanece indefinidamente em `Extraindo arquivos: ...` sem qualquer aviso, erro ou log diagnóstico.

## Resolução (Unreleased)

1. **`src/server/utils/archive_progress.go` & `src/server/utils/iso2god.go` (`ExtractionProgress`, `ExtractionTracker`, `ContextWithExtractionTracker`, `extractZipEntry`, `extract7zEntry`, `drainRAR`, `extractFileAtomically`):**
   - `ExtractionProgress` passa a expor `CurrentFile`, `CurrentFileBytes`, `CurrentFileSize` e `ActiveOp` (`read`, `write`, `sync`, `rename`, `crc-reuse`, `rar-next`, `rar-skip`), todos protegidos por mutex em `archiveProgress`.
   - `ContextWithExtractionTracker` anexa um `ExtractionTracker` thread-safe ao contexto para que o monitor consulte `Snapshot()` mesmo quando `io.Reader` ou `io.Writer` estiver travado sem disparar callbacks.
2. **`src/server/services/pipeline/extraction_progress.go` & `src/server/services/pipeline/stage_checkpoint.go` (`runMonitoredExtraction`, `startExtractionMonitor`, `archiveExtractionProgressForDir`):**
   - `extractArchiveResilient` e `extractISOResilient` passam a registrar `EXTRACT START` (origem, tamanho, `destDir`, volume efetivo e espaço livre) e `EXTRACT END` (duração, volume/espaço livre restante, MiB/arquivos e último arquivo/operação em caso de interrupção) em `App.Logf` (`BACKEND_OUT`).
   - `startExtractionMonitor` emite heartbeat periódico em `App.Logf` (padrão `30s`) com taxa em `MiB/s`, arquivos concluídos, entrada atual, operação de I/O (`op=`) e espaço livre no volume.
   - Se `Bytes` e `Files` ficarem estagnados por `extractionStallTimeout` (padrão `5m`), emite `EXTRACT STALL`, atualiza a mensagem curta em `JobQueue` mantendo estado `"Processing"` e envia uma única telemetria acionável por episódio distinguindo `read` vs `write`/`sync`, **sem apagar nem invalidar** o arquivo baixado.
   - `archiveExtractionProgressForDir` inclui o drive/volume efetivo na mensagem curta da fila (ex.: `Extraindo arquivos (D:): ...`), preservando o parsing de `(N%)` da `QueuePage` e mantendo o `.rar` sem inventar porcentagem.

## Testes Automatizados

- `src/server/utils/archive_progress_test.go`:
  - `TestExtractionTrackerReportsCurrentFileAndActiveOp`: valida o estado final e os callbacks do `ExtractionTracker` via `ContextWithExtractionTracker`.
  - `TestExtractionTrackerReflectsBlockedReadAndWriteOps`: trava propositalmente `io.Reader` e `io.Writer` em `extractFileAtomically` e confirma que `tracker.Snapshot()` aponta exatamente `ActiveOp` (`read` vs `write`) e `CurrentFile`.
- `src/server/services/pipeline/extraction_progress_test.go`:
  - `TestExtractionProgressMessageIncludesVolumeWhenAvailable`: valida inclusão de `(D:)` sem quebrar `%` (ZIP) nem introduzir `%` (RAR).
  - `TestExtractionLogsStartHeartbeatAndVolumeFreeSpace`: valida emissão de `EXTRACT START`, `EXTRACT PROGRESS` (heartbeat periódico) e `EXTRACT END` com volume e espaço livre sem falsos alertas de stall.
  - `TestExtractionStallDetectorReportsOpAndPreservesDownloadedArchive`: simula stall em `read` e `write`, confirma log `EXTRACT STALL`, deduplicação de telemetria (`1` reporte por episódio), manutenção do estado `"Processing"` e preservação integral do arquivo baixado (sem criar `.corrupt-redownloaded`).
- Validação completa em `src/server`: `go test -count=1 ./...` verde (todos os 12 pacotes com testes aprovados).

## Critérios para fechar

- [x] Logs de início, volume/espaço livre, entrada atual e heartbeat periódico emitidos no `BACKEND_OUT`
- [x] Detecção de stall testada em teste unitário (reader/writer travado sem progresso)
- [x] Teste garantindo que o código de extração mantém o mesmo comportamento funcional e não apaga download íntegro em caso de diagnóstico de stall
- [x] Validação completa da suíte Go (`go test -count=1 ./...`)
