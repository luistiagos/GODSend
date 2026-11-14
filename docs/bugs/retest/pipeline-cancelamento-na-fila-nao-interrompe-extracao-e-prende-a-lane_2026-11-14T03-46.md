# Bug: cancelar jogo na fila não interrompe extração em andamento e mantém a lane única (`gameProcessingMu`) travada

- **Detectado em:** 2026-11-14 03:46 (investigação do Chamado `#371`, `+55 69 9979-3860`, máquina `DESKTOP-H1NAROL` / `v2.12.128` + inspeção do código atual)
- **Origem:** `src/server/services/pipeline/stage_checkpoint.go` (`runDirectoryStage`, `extractArchiveResilient`, `extractISOResilient`), `src/server/utils/iso2god.go` (`ExtractArchiveWithProgress`, `ExtractISOWithProgress`, `extractZipFilter`, `extract7zFilter`, `extractRarFilter`, `drainRAR`, `extractFileAtomically`), `src/server/utils/archive_progress.go` (`extractionProgressWriter`), `src/server/interfaces/http/handlers.go` (`handleQueueRemove`), `src/server/app/app.go` (`AcquireGameJob`, `ReleaseGameJob`, `IsGameJobCancelled`)
- **Errors (serviço):** N/A — sem erro emitido; descoberto via Chamado `#371` + revisão do pipeline de extração
- **Classe:** falha funcional / vazamento de trabalho e bloqueio da fila
- **Severidade:** P1 - Alto — ao cancelar uma extração grande ou lenta/travada na UI, a tarefa some da fila, mas a goroutine continua lendo/escrevendo em disco e segurando o mutex `gameProcessingMu` até terminar ou falhar, bloqueando o próximo jogo ou uma nova tentativa do mesmo título
- **Complexidade:** alta — pipeline de extração e coordenação da lane única (`src/server/services/pipeline/` + `src/server/utils/` + `src/server/app/`)
- **Versões:** observado em `v2.12.128`; presente no código atual
- **Reincidência:** primeira vez documentada neste ponto do pipeline (o download HTTP/torrent já verifica `IsGameJobCancelled`, mas a fase de extração não)

## Sintoma

Quando o usuário remove/cancela uma tarefa em andamento durante a etapa de extração (`Extraindo arquivos: ...`):

1. A API `/queue/remove` marca o jogo como cancelado (`CancelGameJob` + `SuppressedJobs`), remove a entrada de `JobQueue` e tenta apagar `GetReadyDir()/<jogo>` imediatamente (`handlers.go:1107-1118`).
2. Na interface, o item desaparece da Fila, porém a extração em curso dentro de `ExtractArchiveWithProgress` / `ExtractISOWithProgress` não é abortada: continua descompactando gigabytes no `TempDir`, mantendo o arquivo `.source*` aberto (no Windows impede a exclusão completa) e segurando `a.gameProcessingMu` (`AcquireGameJob`).
3. Qualquer outro jogo enfileirado (ou o mesmo jogo reiniciado pelo usuário, como ocorreu repetidamente no Chamado `#371` com `GTA 5`) fica bloqueado atrás de `AcquireGameJob` (`Aguardando a tarefa anterior liberar o armazenamento temporario...`) até a extração já cancelada terminar ou o backend ser fechado à força.

## Causa raiz

Confirmada no código atual:

1. **`runDirectoryStage` só consulta `IsGameJobCancelled` fora do `action()`** (`src/server/services/pipeline/stage_checkpoint.go:260-273`):
   - A única checagem fica no topo do loop `for attempt := 0; attempt < 4`. Uma vez dentro de `action()` (`utils.ExtractArchiveWithProgress` ou `utils.ExtractISOWithProgress`), nenhum cancelamento é propagado.
2. **`ExtractArchiveWithProgress`, `extractZipFilter`, `extract7zFilter`, `drainRAR` e `extractFileAtomically` não aceitam cancelamento** (`src/server/utils/iso2god.go:833-1157`):
   - `extractFileAtomically` (`iso2god.go:1131`) executa `io.CopyBuffer(writer, src, make([]byte, 1024*1024))` sem `context.Context` nem callback `shouldCancel`.
   - `extractionProgressWriter.Write` (`src/server/utils/archive_progress.go:56-60`) é chamado a cada bloco gravado e nunca verifica se o job foi cancelado para interromper a cópia.
3. **Concorrência com `handleQueueRemove`** (`src/server/interfaces/http/handlers.go:1107-1118`):
   - `handleQueueRemove` chama `os.RemoveAll(filepath.Join(d.App.GetReadyDir(), safeName))` imediatamente sem esperar a goroutine liberar o arquivo fonte aberto em `extractRarFilter`/`extractZipFilter`/`extract7zFilter`. Enquanto o fluxo antigo não sai, `ReleaseGameJob` (`app.go:291-295`) não é chamado e `gameProcessingMu` permanece travado.

## Como reproduzir

1. Iniciar extração de um arquivo `.rar`, `.zip` ou `.7z` grande (vários GB) pela rota `ProcessHuggingFaceGame` / `ProcessGame` / `ProcessLocalISO`.
2. Assim que entrar em `Extraindo arquivos: ...`, chamar `GET/POST /queue/remove?game=<jogo>`.
3. Enfileirar um segundo jogo em seguida e observar que o segundo jogo fica preso em `Queued` (`Aguardando a tarefa anterior liberar o armazenamento temporario...`) enquanto a extração cancelada continua escrevendo em `TempDir` até o último byte do arquivo.

## Resolução (Unreleased)

1. **`src/server/utils/archive_progress.go` (`archiveProgress`, `newArchiveProgressWithContext`, `extractionProgressWriter`, `cancelReader`):**
   - `archiveProgress` agora carrega `ctx context.Context` e expõe `cancelled()`.
   - `extractionProgressWriter.Write` e o novo `cancelReader.Read` consultam `cancelled()` em toda leitura/escrita durante a extração.
2. **`src/server/utils/iso2god.go` (`ExtractArchiveWithContext`, `ExtractISOWithContext`, `RunIso2GodNativeWithContext`, `ExtractXEXFolderFromISOWithContext`, `ExtractXDVDFSContentToDirWithContext`, `extractZipFilter`, `extract7zFilter`, `drainRAR`, `extractFileAtomically`, `writeGODPartWithContext`, `xdvdfsExtractRecursive`, `xdvdfsExtractFile`):**
   - Adicionadas variantes com `context.Context` preservando as assinaturas legadas como wrappers com `context.Background()`.
   - `extractZipFilter`, `extract7zFilter` e `drainRAR` verificam `progress.cancelled()` a cada entrada; `RunIso2GodNativeWithContext`/`writeGODPartWithContext` e `xdvdfsExtractRecursive`/`xdvdfsExtractFile` verificam `ctx.Err()` entre partições/subpartições GOD e arquivos/blocos XDVDFS.
   - `extractFileAtomically` verifica cancelamento inclusive na reutilização com CRC32, envolve sempre o destino com `extractionProgressWriter` (mesmo sem callback) e a origem com `cancelReader`, checa cancelamento e erros de cópia **antes** de `out.Sync()`, fecha `out` e remove `.xbox-companion-part` sem promover o arquivo parcial ao abortar (`xdvdfsExtractFile` segue o mesmo descarte sem `out.Sync()`).
3. **`src/server/services/pipeline/stage_checkpoint.go` (`jobCancelContext`, `isStageCancelled`, `runDirectoryStageWithContext`, `hashStageFileWithContext`, `buildStageCheckpointWithContext`, `validStageCheckpointWithContext`, `extractArchiveResilient`, `extractISOResilient`, `extractXEXResilient`, `extractContentResilient`, `convertGODResilient`), `archive_cache.go` e `rom.go`:**
   - `runDirectoryStageWithContext` deriva `jobCancelContext(gameName)` (acompanhando `IsGameJobCancelled` com polling de 15 ms), passa o contexto para `ExtractArchiveWithContext`, `ExtractISOWithContext`, `ExtractXEXFolderFromISOWithContext`, `ExtractXDVDFSContentToDirWithContext`, `RunIso2GodNativeWithContext` e hashing SHA-256 de checkpoint (`hashStageFileWithContext`), retornando `app.ErrJobCancelled` antes de `waitForLocalDevice`, retentativas ou `classifyLocalStorageFailure`.
   - `invalidateDownloadedArchiveOnCorruptExtract` e `isArchiveIntegrityError` ignoram cancelamentos (`app.ErrJobCancelled` / `context.Canceled`) e `rom.go` evita registrar status `"Error"` ao cancelar.

## Testes Automatizados

- `src/server/utils/archive_progress_test.go`:
  - `TestExtractFileAtomicallyCancelsMidCopyAndRemovesPartial`: cancela `context.Context` no meio de uma cópia chunked de 4 MiB, garante retorno `context.Canceled` antes do fim e ausência de arquivo final ou `.xbox-companion-part`.
  - `TestExtractArchiveAndISOWithContextCancelAcrossFormats`: valida cancelamento via `ExtractArchiveWithContext` e `ExtractISOWithContext` em `.zip`, `.7z` e `.rar`.
  - `TestXDVDFSExtractFileCancelsMidCopyAndRemovesPartial`: cancela `xdvdfsExtractFile` no meio da cópia e valida retorno `context.Canceled` e remoção de `.xbox-companion-part`.
  - `TestISOHelpersWithCancelledContextReturnImmediately`: valida retorno imediato de `context.Canceled` em `RunIso2GodNativeWithContext`, `ExtractXEXFolderFromISOWithContext` e `ExtractXDVDFSContentToDirWithContext`.
- `src/server/services/pipeline/extraction_progress_test.go`:
  - `TestResilientExtractionCancelsQuicklyAndReleasesProcessingLane`: valida `extractArchiveResilient` e `extractISOResilient` com `CancelGameJob`, dispositivo local ausente e segundo job aguardando `AcquireGameJob` (`gameProcessingMu`), além de confirmar que `invalidateDownloadedArchiveOnCorruptExtract` preserva `app.ErrJobCancelled` sem criar marcador de arquivo corrompido.
  - `TestStageCheckpointHashAbortsOnContextCancel`: valida aborto de `hashStageFileWithContext` com contexto cancelado.
- Validação completa em `src/server`: `go test -count=1 ./...` verde (todos os 12 pacotes com testes aprovados; 4 pacotes sem testes).

## Critérios para fechar

- [x] Reprodução confirmada em teste automatizado (sem o fix, o cancelamento espera o fim da extração)
- [x] Causa raiz isolada e corrigida para `.zip`, `.7z` e `.rar` (e `ExtractISOWithProgress`)
- [x] Teste automatizado cobrindo cancelamento no meio de um arquivo grande e liberação imediata da lane
- [x] Validação completa da suíte Go (`go test -count=1 ./...`)
