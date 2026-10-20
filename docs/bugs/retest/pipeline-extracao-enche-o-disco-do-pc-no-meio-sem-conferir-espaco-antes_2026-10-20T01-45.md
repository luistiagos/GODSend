# Bug: extração enche o disco do PC no meio do caminho, sem conferir antes se o jogo extraído cabe

- **Detectado em:** 2026-10-20 (foto da tela da Fila enviada por cliente; relógio do PC 01:45)
- **Origem:** `xbox-360-companion/pipeline` — `services/pipeline/stage_checkpoint.go::extractArchiveResilient`,
  `services/pipeline/huggingface.go` (fluxo HF), `utils/iso2god.go::extractArchiveFilter`
- **Errors (serviço):** não consultado (a foto já traz a mensagem inteira)
- **Classe:** ux (falha tardia com mensagem crua; a causa é real — disco cheio — mas o app só descobre depois de baixar tudo)
- **Severidade:** P2 - Médio — o cliente perde o tempo do download e recebe uma mensagem meio em inglês
- **Complexidade:** baixa
- **Versões:** desconhecida (cliente `C:\Users\jhsil\Downloads\godsend-data`)

## Sintoma

Fila do Companion, modo local ("Gravado no dispositivo" no FIFA 19, que deu certo antes):

```
FIFA 18  Erro
Falha no armazenamento de trabalho do PC, onde o jogo e baixado e montado antes de ir para o destino.
Verifique espaco livre e permissoes no disco do aplicativo e tente novamente: Extract failed: falha no
armazenamento de trabalho do PC: fase extract-archive: write C:\Users\jhsil\Downloads\godsend-data\runtime\Temp\
FIFA 18_hf_ext\FIFA.18.USA.X360-ZTM\data3.big.xbox-companion-part: There is not enough space on the disk.
```

O download do HuggingFace terminou; a falha veio no meio da extração, ao gravar `data3.big`.

## Análise (símbolos abertos)

- `infrastructure/download/ia.go::ensureDownloadSpace` — antes do download confere espaço livre para
  `totalSize + downloadSpaceMargin` do **arquivo compactado**. Não sabe nada do tamanho extraído.
- `services/pipeline/huggingface.go` (linhas ~47–64) — `archivePath` em `s.App.TempDir` (ou, em modo local,
  `resolveLocalSourceArchive(gameDir, ...)` em `ReadyDir`, que **não** é apagado); `extDir` em
  `outputRoot(gameName)` = `TempDir`. Com um disco só, compactado e extraído ficam juntos no C:.
  Em erro: `fmt.Errorf("Extract failed: %w", ...)` — daí o prefixo em inglês no meio da mensagem.
- `services/pipeline/stage_checkpoint.go::extractArchiveResilient` → `runDirectoryStage(..., "extract-archive", ...)`
  → `utils.ExtractArchiveWithProgress`. **Nenhuma checagem de espaço antes.** Em erro de disco o
  `classifyLocalStorageFailure` embrulha em `ErrLocalStaging` (fase `extract-`, `hostStagedPhase`).
- `services/pipeline/fallback.go::haltOnLocalStorageFailure` (linha ~108) — monta a mensagem final:
  texto fixo em português + `err.Error()` cru, que repete "falha no armazenamento de trabalho do PC"
  e traz o texto do Windows em inglês.
- `utils/iso2god.go::extractZipFilter` / `extract7zFilter` — **já somam** o tamanho descompactado de todos os
  arquivos (`progress.TotalBytes`) antes de extrair. `extractRarFilter` não (rardecode é streaming; o
  tamanho de cada entrada só aparece em `r.Next()`).
- A extração retoma: arquivo já presente com o tamanho certo é pulado (`iso2god.go` ~1020). O espaço
  necessário é `total descompactado − já extraído`.
- `app/config.go` (~466) — `TempDir` vai sozinho para o disco fixo NTFS/exFAT com mais espaço livre; ficou no C:
  porque o PC não tem disco melhor. Não é bug.
- `infrastructure/helpers/freespace_windows.go::FreeSpaceBytes` e `pipeline/local_install.go::ensureFreeSpace`
  (margem `localSpaceMargin` 64 MB) — helpers existentes para reaproveitar.

## Hipóteses descartadas

- **Seleção errada do disco temporário:** o caminho é `...godsend-data\runtime\Temp`, o padrão; a
  autosseleção só troca se outro disco fixo tiver mais espaço. Sem evidência de outro disco no PC.
- **Arquivo corrompido / permissão:** o erro é `There is not enough space on the disk` (ERROR_DISK_FULL), sem ambiguidade.

## O que fazer

1. **Checagem antes de extrair** — em `utils/iso2god.go`, expor uma função que devolve o tamanho
   descompactado de um .zip/.7z (lendo o índice, como já faz o progresso); para .rar, varrer os headers
   (`rardecode.List` ou `Next()` sem ler dados) ou, se custar caro, pular a checagem (comportamento atual).
   Em `extractArchiveResilient` (e `extractISOResilient`), antes de `runDirectoryStage`, comparar
   `total − já extraído + margem` com `helpers.FreeSpaceBytes` do volume de `destDir`; se não couber,
   devolver erro `ErrLocalStaging` com "o jogo extraído precisa de X GB, há Y GB livres em C:".
   Teste: unitário com zip sintético e `FreeSpaceBytes` injetável (ou função de espaço como variável de pacote),
   esperando o erro antes de qualquer arquivo criado em `destDir`.
2. **Checagem antes do download (opcional, mesmo ganho maior):** quando o catálogo traz tamanho, avisar já
   no início que o PC precisa de ~compactado + extraído. Só se a task 1 não bastar.
3. **Mensagem** — em `fallback.go::haltOnLocalStorageFailure`, quando a causa for disco cheio
   (`isLikelyLocalStorageError` já reconhece os textos), mostrar só a frase em português com o volume e
   os GB, sem o `err.Error()` cru (que vai para o log/telemetria). Teste: unitário da mensagem.
4. Versão em 4 lugares + `CHANGELOG.md` `[Unreleased]`.

## Planejamento das tasks 1 e 3 (sessão de 2026-10-20)

Achados novos (símbolos abertos):

- **O FIFA 18 é `.rar`** (`cache/hf_xbox360.json`: `FIFA.18.USA.X360-ZTM.rar`), e o catálogo HF tem
  1353 `.rar`, 335 `.7z`, 156 `.zip` (`grep -oE '\.(zip|7z|rar)"' cache/hf_xbox360.json | sort | uniq -c`).
  Pular RAR deixaria o caso do bug de fora — **RAR entra na checagem**.
- `rardecode/v2@v2.4.1::List(name, opts...)` (reader.go:774) devolve os `FileHeader` (com `UnPackedSize`,
  `UnKnownSize`, `IsDir`) lendo só os headers, sem descompactar. Serve.
- `utils/iso2god.go::extractFileAtomically` — zip/7z reaproveitam arquivo final com tamanho (e CRC) certo;
  RAR (`drainRAR`, `allowReuse=false`) **regrava** toda entrada: grava o `.xbox-companion-part` com o
  antigo ainda no disco e só depois troca. Para RAR o pico é `soma dos ausentes + maior já presente`.
- `pipeline/stage_checkpoint.go::runDirectoryStage` — pode dar `RemoveAll(destDir)` (fonte divergente)
  **antes** de chamar `action`; por isso a checagem vai **dentro** da `action`, depois da limpeza, e não
  antes de `runDirectoryStage`. Erro de `action` com texto "espaço insuficiente" passa por
  `classifyLocalStorageFailure` → `ErrLocalStaging` (fase `extract-*` é `hostStagedPhase`), em todos os modos.
- `pipeline/local_install.go::ensureFreeSpace` — mensagem fala de "destino/dispositivo"; errada para o
  disco do PC. Não reaproveitada; a nova checagem usa o mesmo `helpers.FreeSpaceBytes` + `localSpaceMargin`
  e, como ela, segue em frente se não conseguir medir.
- `pipeline/fallback.go::haltOnLocalStorageFailure` — ramo `ErrLocalStaging` concatena `err.Error()`; a
  telemetria (`telemetry.Report`) já leva o `err` cru, então tirá-lo da tela não perde diagnóstico.

Tarefas:

1. `utils/iso2god.go::ArchiveSpaceNeeded(archivePath, destDir, wantExt)` — bytes que a extração ainda vai
   gravar (zip/7z: soma das entradas sem arquivo de tamanho certo em `destDir`; rar: idem + maior entrada
   já presente). Erro quando o tamanho não é conhecido (rar `UnKnownSize`, formato desconhecido).
   `pipeline`: `ensureScratchSpace(dir, need)` devolve `*scratchSpaceError{Volume, Need, Free}` (texto em
   português com "espaço insuficiente"); chamado na `action` de `extractArchiveResilient` e
   `extractISOResilient`. `freeSpaceBytes` vira variável de pacote para o teste.
   Teste: `utils` — zip sintético, com e sem arquivo já extraído; `pipeline` — `extractArchiveResilient`
   com espaço falso pequeno → `ErrLocalStaging` + `*scratchSpaceError`, nenhum arquivo do zip em `destDir`.
2. Task 3: em `haltOnLocalStorageFailure`, ramo `ErrLocalStaging`: `*scratchSpaceError` → frase com volume
   e GB; outro disco cheio (fragmentos de espaço de `isLikelyLocalStorageError`, extraídos para uma lista
   compartilhada `diskFullFragments`) → frase com o volume de `TempDir`, sem `err.Error()`.
   Teste: unitário da função de mensagem.

## Correção (2026-10-20, 2.12.112) — tasks 1 e 3

- `utils/iso2god.go::ArchiveSpaceNeeded` — como planejado; rar via `rardecode.List`.
- `pipeline/local_install.go::freeSpaceBytes` (variável), `scratchSpaceError`, `Service.ensureScratchSpace` —
  chamado no começo da `action` de `stage_checkpoint.go::extractArchiveResilient` (`""`) e
  `extractISOResilient` (`".iso"`). Necessário mostrado = descompactado restante + `localSpaceMargin`.
- `pipeline/local_resilient.go::isDiskFullError` — fragmentos de espaço saíram de
  `isLikelyLocalStorageError`, que agora o chama (mesmo conjunto de textos reconhecidos).
- `pipeline/fallback.go::localStagingMessage` — ramo `ErrLocalStaging` de `haltOnLocalStorageFailure`;
  falha que não é de espaço (permissão etc.) mantém o texto antigo com a causa.
- Testes: `go test ./utils ./services/pipeline` verde (`TestArchiveSpaceNeeded`,
  `TestExtractionStopsBeforeWritingWhenPCVolumeIsTooSmall`, `TestExtractionRunsWhenPCVolumeFits`,
  `TestLocalStagingMessageHidesRawDiskFullText`).
- **Task 2 não feita** (opcional pelo próprio doc: só se a task 1 não bastar).
- **Reteste:** num PC com pouco espaço no volume do `TempDir`, pedir um jogo cujo extraído não caiba: a
  tarefa deve parar logo depois do download com "Não há espaço no disco do PC (C:) para extrair o jogo:
  são necessários X GB e há Y GB livres..." e nenhum arquivo do jogo na pasta `_hf_ext`. Liberar espaço e ↻
  deve extrair sem baixar de novo.

## Orientação dada ao cliente

Liberar espaço no C: (≈ 2,5× o tamanho do jogo; FIFA 18 ≈ 15–20 GB) e clicar em ↻ na tarefa — o download
concluído é reaproveitado.
