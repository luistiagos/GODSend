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

## Orientação dada ao cliente

Liberar espaço no C: (≈ 2,5× o tamanho do jogo; FIFA 18 ≈ 15–20 GB) e clicar em ↻ na tarefa — o download
concluído é reaproveitado.
