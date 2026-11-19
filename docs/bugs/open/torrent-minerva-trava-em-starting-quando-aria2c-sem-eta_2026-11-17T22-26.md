# Bug: Download Minerva fica preso em `Torrenting (Minerva): starting...` sem timeout quando o `aria2c` nao emite linha com `ETA:`

- **Detectado em:** 2026-11-17 22:26 (triagem do chamado `#225` do painel, sessao `207184944206018@lid`, `jhsilva2004@gmail.com`)
- **Origem:** `xbox-360-companion/pipeline` — `src/server/infrastructure/torrent/torrent.go::DownloadViaTorrent`
- **Errors (serviço):** N/A para o travamento (nenhum erro e emitido porque o processo `aria2c` nao aborta; versao do cliente provada na `v2.12.129` pelo erro `14018` em `2026-11-16T16:49:25`, `C:\Users\jhsil\Downloads\godsend-data`)
- **Classe:** fail (travamento silencioso da fila de download)
- **Severidade:** **P1 — Alto** (bloqueia indefinidamente a fila para titulos exclusivos do Minerva — como jogos de Xbox Classico presentes apenas em `cache/minerva_xbox.json` — sem exibir progresso, sem timeout e sem retornar erro)
- **Complexidade:** média (`src/server/infrastructure/torrent/torrent.go` — parser da saida do `aria2c`, deteccao de estagnacao/0 B/s fora de `summaryRe` e teste unitario)
- **Versões:** `v2.12.129` (versao mais recente publicada na data do relato; `2.12.130` saiu apenas em `2026-11-18T00:49Z`)
- **Reincidência:** primeira vez registrado

## Sintoma, na ordem que o cliente viveu (UTC)

1. **2026-11-15 03:33 (`[182294]`):** cliente enviou print da Fila de tarefas do Xbox 360 Companion com `Midnight Club 3 - DUB Edition (USA)` em `"Processando"` e status `"Torrenting (Minerva): starting... (5580 MB)"`: *"To quase 10 minutos com essa tela assim"*.
2. **2026-11-16 15:22–15:25 (`[184589]`, `[184590]`, `[184597]`):** cliente enviou dois novos prints da Fila mostrando `"Midnight Club 3 - DUB Edition (USA)"` em `"Torrenting (Minerva): starting... (5580 MB)"` e `"Need for Speed - Underground 2 (USA)"` em `"Torrenting (Minerva): starting... (5939 MB)"`, relatando (`[184597]`): *"mas está a 20 minutos essa tela"*.
3. Em ambos os dias, a barra nao avancou de `starting...`, nenhuma porcentagem apareceu e nenhum erro ou timeout foi disparado em mais de 20 minutos.

## Evidência

- **Conversa / prints (`Wpp_proccess`, sessao `207184944206018@lid`):** `[182294]` (15/11 03:33 UTC), `[184589]`, `[184590]`, `[184597]` (16/11 15:22–15:25 UTC).
- **Versao do cliente:** `errors.id = 14018` (`2026-11-16T16:49:25`, 1h23 apos `[184590]`), `user_agent = "pipeline v2.12.129"`, caminho `C:\Users\jhsil\Downloads\godsend-data\runtime\Temp\...`.
- **Origem no catalogo:** busca em `cache/` confirma que `Midnight Club 3 - DUB Edition (USA)` e `Need for Speed - Underground 2 (USA)` existem apenas em `cache/minerva_xbox.json` (ausentes de `cache/xbox.json` e HuggingFace).

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
   - `cmd.Wait()` (linha 593) bloqueia indefinidamente sem um watchdog de estagnacao/zero-bytes (ao contrario do downloader HTTP/IA, que possui `DownloadStallTimeout` de 45 s).

## Escopo — o que NAO e este bug

- As ocorrencias anteriores da mesma sessao `#225` (`O diário transacional não pertence ao plano de escrita informado` em `[147297]`/`[147320]`, e disco `C:` cheio na extracao do FIFA 18 em `[148584]`/`[149825]`): ambas ocorreram na `v2.12.110` (19–21/10) e ja estao corrigidas em `docs/bugs/retest/` (`badavatar-repreparo-sem-formatar-falha-diario-transacional-nao-pertence-ao-plano_2026-10-20T21-27.md` e `pipeline-extracao-enche-o-disco-do-pc-no-meio-sem-conferir-espaco-antes_2026-10-20T01-45.md`).
- Falhas de `lookup huggingface.co: no such host` em `[150896]`/`[150900]`/`[150906]`/`[165808]`: oscilacao de internet do cliente confirmada pelo proprio em `[150908]`.
- Resposta do `XBOX360_AGENT` tratando 20 min em `starting...` como normal (`[184592]`, `[184598]`): lado `dsg` listado no relatorio de triagem.

## Como reproduzir

1. Enfileirar um jogo exclusivo do Minerva sem peers ativos (ou simular em teste unitario a saida do `aria2c` emitindo `[#123456 0B/5580MiB(0%) CN:0 DL:0B]` a cada 3 s por mais de `LowSpeedGracePeriod + LowSpeedSustainedDuration`).
2. Observar que `summaryRe` nao casa, o status permanece em `"Torrenting (Minerva): starting..."` e o download nunca retorna `ErrDownloadTooSlow` nem `ErrDownloadStalled`.

## Resolução (vX.Y.Z)

*(Pendente — proposto abaixo)*

1. Tornar o `ETA:` opcional no parser de resumo do `aria2c` (ex.: capturar linhas com `DL:0B` / `CN:N` mesmo sem `ETA:`), atualizando o status na fila (incluindo conexoes/peers quando `0 B/s`) e permitindo que `lowSpeedStart` / detector de estagnacao dispare apos a janela de carencia.
2. Adicionar watchdog independente de progresso/tempo sem bytes recebidos em `DownloadViaTorrent` (respeitando `cancel` e `IsSpeedCheckBypassed` conforme politica do pipeline), para nao depender apenas da emissao de linhas `summaryRe` pelo `aria2c`.

## Testes Automatizados

*(Pendente — adicionar teste unitario em `src/server/infrastructure/torrent/` simulando saida do `aria2c` sem `ETA:` e/ou silenciosa e comprovando aborto limpo por estagnacao/velocidade baixa)*

## Critérios para fechar

- [ ] Parser de progresso do `aria2c` trata linhas de resumo sem `ETA:` (ex.: `DL:0B`) e exibe estado real na fila
- [ ] Watchdog de estagnacao inicial encerra tentativa Minerva travada em `0 B/s` dentro do prazo esperado
- [ ] Teste unitario automatizado cobrindo o caso sem `ETA:` e sem progresso
- [ ] `go test -count=1 ./...` aprovado em `src/server`
