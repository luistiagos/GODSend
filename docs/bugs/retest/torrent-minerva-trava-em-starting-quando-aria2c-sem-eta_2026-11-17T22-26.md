# Bug: Download Minerva fica preso em `Torrenting (Minerva): starting...` sem timeout quando o `aria2c` nao emite linha com `ETA:`

- **Detectado em:** 2026-11-17 22:26 (triagem do chamado `#225` do painel, sessao `207184944206018@lid`, `jhsilva2004@gmail.com`)
- **Origem:** `xbox-360-companion/pipeline` — `src/server/infrastructure/torrent/torrent.go::DownloadViaTorrent`
- **Errors (serviço):** N/A para o travamento (nenhum erro e emitido porque o processo `aria2c` nao aborta; versao do cliente provada na `v2.12.129` pelo erro `14018` em `2026-11-16T16:49:25`, `C:\Users\jhsil\Downloads\godsend-data`)
- **Classe:** fail (travamento silencioso da fila de download)
- **Severidade:** **P1 — Alto** (bloqueia indefinidamente a fila para titulos exclusivos do Minerva — como jogos de Xbox Classico presentes apenas em `cache/minerva_xbox.json` — sem exibir progresso, sem timeout e sem retornar erro)
- **Complexidade:** média (`src/server/infrastructure/torrent/torrent.go` — parser da saida do `aria2c`, deteccao de estagnacao/0 B/s fora de `summaryRe` e teste unitario)
- **Versões:** `v2.12.129` (versao mais recente publicada na data do relato; `2.12.130` saiu apenas em `2026-11-18T00:49Z`)
- **Reincidência:** segunda ocorrência registrada — primeiro relato em `#225` (`Midnight Club 3 - DUB Edition (USA)`, `Need for Speed - Underground 2 (USA)`), seguido por novo relato de cliente com `Tony Hawk's Pro Skater 4 (Europe)` e outros títulos `Tony Hawk` travando por mais de 30 minutos em `Torrenting (Minerva): starting... (6501 MB)`.

## Sintoma, na ordem que o cliente viveu (UTC)

1. **2026-11-15 03:33 (`[182294]`):** cliente enviou print da Fila de tarefas do Xbox 360 Companion com `Midnight Club 3 - DUB Edition (USA)` em `"Processando"` e status `"Torrenting (Minerva): starting... (5580 MB)"`: *"To quase 10 minutos com essa tela assim"*.
2. **2026-11-16 15:22–15:25 (`[184589]`, `[184590]`, `[184597]`):** cliente enviou dois novos prints da Fila mostrando `"Midnight Club 3 - DUB Edition (USA)"` em `"Torrenting (Minerva): starting... (5580 MB)"` e `"Need for Speed - Underground 2 (USA)"` em `"Torrenting (Minerva): starting... (5939 MB)"`, relatando (`[184597]`): *"mas está a 20 minutos essa tela"*.
3. **2026-11-20:** novo cliente enviou print da Fila com `Tony Hawk's Pro Skater 4 (Europe)` em `"Processando"` e `"Torrenting (Minerva): starting... (6501 MB)"` há mais de 30 minutos, relatando o mesmo travamento em outros títulos da série `Tony Hawk`.
4. Em todos os relatos, a barra nao avancou de `starting...`, nenhuma porcentagem apareceu e nenhum erro ou timeout foi disparado.

## Evidência

- **Conversa / prints (`Wpp_proccess`, sessao `207184944206018@lid`):** `[182294]` (15/11 03:33 UTC), `[184589]`, `[184590]`, `[184597]` (16/11 15:22–15:25 UTC).
- **Versao do cliente:** `errors.id = 14018` (`2026-11-16T16:49:25`, 1h23 apos `[184590]`), `user_agent = "pipeline v2.12.129"`, caminho `C:\Users\jhsil\Downloads\godsend-data\runtime\Temp\...`.
- **Origem no catalogo:** busca em `cache/` confirma que `Midnight Club 3 - DUB Edition (USA)`, `Need for Speed - Underground 2 (USA)` e os títulos de Xbox Clássico de `Tony Hawk` (`Tony Hawk's Pro Skater 4 (Europe)`, etc.) existem apenas em `cache/minerva_xbox.json` (ausentes de `cache/xbox.json` e HuggingFace). Além disso, no `cache/minerva_xbox.json`, os nomes de `Tony Hawk` carregam entidade HTML (`"Tony Hawk&#39;s Pro Skater 4 (Europe).zip"`).
- **Reprodução real com `aria2c.exe 1.37.0` contra o `.torrent` real do Minerva (`Redump - Microsoft - Xbox.torrent`, `file-index=2430`, `Tony Hawk's Pro Skater 4 (Europe).zip`):** o `aria2c` emitiu repetidamente `[#bef21c 0B/6.3GiB(0%) CN:50 SD:0 DL:0B]` (50 peers conectados em outros jogos do mega-torrent, mas `SD:0` / `0B/s` para o arquivo selecionado) e confirmou o nome real em disco com apóstrofo literal (`Tony Hawk's Pro Skater 4 (Europe).zip`).

## Causa raiz

Verificado diretamente em `src/server/infrastructure/torrent/torrent.go::DownloadViaTorrent` (linhas 403, 497 e 537–595):

1. Na linha 403, antes de iniciar o processo `aria2c`, a funcao registra o status inicial:
   ```go
   s.App.LogStatus(gameName, "Processing", fmt.Sprintf("Torrenting (Minerva): starting... (%.0f MB)", float64(fileSize)/1048576))
   ```
2. A expressao regular de leitura de progresso na linha 497 **exige** ambos os campos `DL:` e `ETA:`:
   ```go
   summaryRe := regexp.MustCompile(`\[#\S+\s+([\d.]+\S+)/([\d.]+\S+)\((\d+)%\)[^\]]*DL:([\d.]+\S+)[^\]]*ETA:(\S+)\]`)
   ```
3. Tanto a atualizacao do status exibido ao usuario (`s.App.LogStatus`, linha 555) quanto o detector de velocidade baixa (`lowSpeedStart` com `app.LowSpeedGracePeriod` de 45 s + `app.LowSpeedSustainedDuration` de 20 s, linhas 561–580) rodam **exclusivamente** dentro de `if m := summaryRe.FindStringSubmatch(line); m != nil`.
4. Quando o `aria2c` esta com taxa `0B/s` (sem seeders/peers, buscando trackers/DHT ou estagnado antes de receber o primeiro bloco), ele imprime linhas de resumo **sem `ETA:`** (ex.: `[#abc123 0B/5580MiB(0%) CN:0 DL:0B]`) ou nao emite nenhuma linha casavel. Como `summaryRe` nunca casa:
   - `s.App.LogStatus` nunca e atualizado, deixando a UI presa em `Torrenting (Minerva): starting...`;
   - `lowSpeedStart` nunca e iniciado, entao `ErrDownloadTooSlow` nunca dispara;
   - `cmd.Wait()` (linha 593) bloqueia indefinidamente sem um watchdog de estagnacao/zero-bytes (ao contrario do downloader HTTP/IA, que possui `DownloadStallTimeout` de 45 s), e o cancelamento pela fila só era verificado quando `aria2c` emitia alguma linha no `stdout`.
5. **Defeito adicional descoberto em títulos com entidade HTML (`Tony Hawk&#39;s ...`):**
   - Na busca pós-download (`filepath.Walk`, linha 622) e na verificação de cache local (`cachedFile`, linha 395), `DownloadViaTorrent` comparava o arquivo em disco diretamente contra `entry.FileName` (`"Tony Hawk&#39;s ..."`), sem decodificar entidades HTML nem usar o `matchedTorrentBase` do `.torrent` (`"Tony Hawk's ..."`). Mesmo quando o download concluía, o arquivo baixado não era encontrado nem reutilizado.

## Escopo — o que NAO e este bug

- As ocorrencias anteriores da mesma sessao `#225` (`O diário transacional não pertence ao plano de escrita informado` em `[147297]`/`[147320]`, e disco `C:` cheio na extracao do FIFA 18 em `[148584]`/`[149825]`): ambas ocorreram na `v2.12.110` (19–21/10) e ja estao corrigidas em `docs/bugs/retest/` (`badavatar-repreparo-sem-formatar-falha-diario-transacional-nao-pertence-ao-plano_2026-10-20T21-27.md` e `pipeline-extracao-enche-o-disco-do-pc-no-meio-sem-conferir-espaco-antes_2026-10-20T01-45.md`).
- Falhas de `lookup huggingface.co: no such host` em `[150896]`/`[150900]`/`[150906]`/`[165808]`: oscilacao de internet do cliente confirmada pelo proprio em `[150908]`.
- Resposta do `XBOX360_AGENT` tratando 20 min em `starting...` como normal (`[184592]`, `[184598]`): lado `dsg` listado no relatorio de triagem.

## Como reproduzir

1. Enfileirar um jogo exclusivo do Minerva sem peers ativos (ou simular em teste unitario a saida do `aria2c` emitindo `[#123456 0B/5580MiB(0%) CN:0 DL:0B]` a cada 3 s por mais de `LowSpeedGracePeriod + LowSpeedSustainedDuration`).
2. Observar que `summaryRe` nao casa, o status permanece em `"Torrenting (Minerva): starting..."` e o download nunca retorna `ErrDownloadTooSlow` nem `ErrDownloadStalled`.

## Resolução (v2.12.131 / Unreleased)

1. **Parser de progresso sem `ETA:` obrigatório (`parseAria2cSummary` e `formatAria2cStatus` em `src/server/infrastructure/torrent/torrent.go`)**:
   - Captura linhas de progresso do `aria2c` com ou sem `ETA:`, incluindo contadores `CN:` e `SD:` (ex.: `[#bef21c 0B/6.3GiB(0%) CN:50 SD:0 DL:0B]`).
   - Atualiza `JobQueue` imediatamente com porcentagem, velocidade, peers e seeders (`Torrenting (Minerva): 0% @ 0B/s (peers: 50, seeders: 0 — aguardando dados...)`), deduplicando repetições idênticas do `aria2c` e eliminando a tela congelada em `starting...`.
2. **Watchdog independente de estagnação e cancelamento (`DownloadViaTorrent`)**:
   - Executa `aria2c` via `exec.CommandContext` com ticker periódico independente de saída no `stdout`, detectando cancelamento (`app.ErrJobCancelled`) mesmo se o processo estiver silencioso e encerrando o watchdog antes de `cmd.Wait()`.
   - Rastreia a última atividade real de dados (`DLBytesPerSec > 0` ou crescimento de `DownloadedBytes`), só desarma o watchdog quando `sum.Pct >= 100` (evitando falso positivo de arredondamento em 99%), e encerra com erro detalhado envolvendo `app.ErrDownloadStalled` (`Minerva sem fontes ativas (peers: N, seeders: M) por 45s`) após `app.DownloadStallTimeout` — inclusive quando `IsSpeedCheckBypassed` está ativo.
   - Mantém `IsSpeedCheckBypassed` válido apenas para velocidade baixa positiva (`ErrDownloadTooSlow`), e em `fallback.go` deixa de recolocar `ErrDownloadStalled` em `slowProviders` para não reiniciar um torrent morto em `0 B/s` por mais 45 s; em `user_error.go`, traduz `"minerva sem fontes ativas"` para orientação clara em português sobre ausência de seeders ativos (sem culpar a internet/VPN do usuário).
3. **Resolução de nomes com entidades HTML (`&#39;`, `&amp;`, etc.) no cache e pós-download**:
   - `DownloadViaTorrent` preserva `matchedTorrentBase` do `.torrent` para checar o cache em `destDir` e localizar o arquivo baixado no `filepath.Walk` (ignorando `.aria2` e aceitando `torrentBasenameMatches`).

## Testes Automatizados

- `src/server/infrastructure/torrent/torrent_test.go`: `TestParseAria2cSummary`, `TestDownloadViaTorrentStallsWhenAria2cOmitsETA`, `TestDownloadViaTorrentRounded99PercentStillStalls`, `TestDownloadViaTorrentStallsWhenAria2cSilent`, `TestDownloadViaTorrentStallsEvenWithSpeedCheckBypass`, `TestDownloadViaTorrentCancelsWhileAria2cSilent`, `TestDownloadViaTorrentFindsDownloadedFileWithHTMLEntityAndReusesCache`, `TestDownloadViaTorrentSlowSpeedAndBypass`.
- `src/server/services/pipeline/fallback_test.go`: `TestIsDownloadTooSlowErrorNilSafe` (comprova que `ErrDownloadStalled` não entra em `isDownloadTooSlowError` e casa em `isDownloadStalledError`).
- `src/server/app/user_error_test.go`: `TestFormatErrorForUserTranslatesTechnicalErrors/minerva_zero_seeders_stall`.

## Critérios para fechar

- [x] Parser de progresso do `aria2c` trata linhas de resumo sem `ETA:` (ex.: `DL:0B`) e exibe estado real na fila
- [x] Watchdog de estagnacao inicial encerra tentativa Minerva travada em `0 B/s` dentro do prazo esperado
- [x] Teste unitario automatizado cobrindo o caso sem `ETA:` e sem progresso
- [x] `go test -count=1 ./...` aprovado em `src/server`
- [ ] Versão publicada e validada em campo (aguardando reteste para mover para `closed/`)
