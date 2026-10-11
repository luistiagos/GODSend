# Bug: download chunked do Internet Archive que chegou a 100% é perdido se o app fechar durante o hash final; na volta ele recomeça do zero e trunca o arquivo completo

- **Detectado em:** 2026-10-07 21:48 (chamado #157 do painel, sessão `255490944716923@lid`, telefone `5511964233557`; telemetria `9541`, host `DESKTOP-1HAMO38`)
- **Origem:** conversa de suporte + log anexo do report `9541` + leitura de `src/server/infrastructure/download/ia.go` (`DownloadWithProgress`, `IADownloadChunkedParallel`, `markDownloadCompleted`, `reusableCompletedDownload`), `infrastructure/download/resume.go` (`loadResumeMarker`, `finishedSingleResume`, `removeDownloadResume`), `services/pipeline/pipeline.go::ProcessGameWithErr`, `services/pipeline/workspace.go::resolveLocalSourceArchive` e `interfaces/http/queue_resume.go` (`ResumeQueuedJobs`, `relaunchGame`)
- **Classe:** falha funcional (retomada) + UI sem sinal de vida
- **Severidade:** **P2 - Médio**: não corrompe nada, mas joga fora um download inteiro. Neste caso foram **7,6 GB e 46 min** (21:09 → 21:55 UTC, a ~2,8 MB/s). O cliente desistiu do PES e cancelou a fila
- **Complexidade:** baixa: a janela fica entre duas linhas do mesmo pacote (`ia.go:525` e `ia.go:205`). O conserto é a mesma promoção que já existe para o modo single (`ia.go:180-190`)
- **Versões:** 2.12.107
- **Reincidência:** primeira vez. Não é [[backend-pipeline-arquivo-corrompido-reaproveitado-do-cache_2026-09-12T12-24]] (lá o cache era reaproveitado demais; aqui ele some)

## Sintoma, na ordem que o cliente viveu

Horas em UTC (cliente em UTC-3; o `BACKEND_OUT` imprime a hora local entre colchetes).

1. 21:09:51 [134397]: *"Pronto, adicionei a fila"*. Era PES 2015 com destino Pendrive (USB), modo local GOD.
   A fonte foi o Internet Archive (HF não tem o jogo): **7.615 MB em 1.904 segmentos**.
2. 21:14:58 [134399]: *"Já baixei o jogo e coloquei o pendrive no Xbox dnv"*. O download estava em **8,2%**.
   Esse erro de leitura é do cliente e do agente de suporte, e tem doc próprio (ver Escopo).
3. 21:30:38 [134415]: *"No caso esse aí já veio no aurora, oque eu baixei foi o pes"*. O download
   continuava em segundo plano.
4. 21:55:20: o log mostra o último progresso, **99,8% (7598,1/7614,8 MB)**. Depois disso o backend
   fica **5 min 44 s sem escrever nenhuma linha**.
5. 22:01:04: o cliente fecha o app (`application before-quit`, `stop requested (kill)`, backend com `SIGTERM`).
6. 22:07:15 e 22:12:20: o app reabre e `QUEUE RESUME` relança o PES.
7. 22:14:35: `Chunked download: 7615 MB, 1904 segments`. Em 22:14:36 o progresso está em
   **0.0% (0.0/7614.8 MB)**, sem a linha `DOWNLOAD RESUME [...] MB ja confirmados` nem
   `DOWNLOAD CACHE [...] reutilizando`.
8. 22:14:44: o cliente cancela o PES, as duas partes de Red Dead e o GTA 5
   (`QUEUE: removed job`). Depois baixa jogos menores (GTA SA HD, Farming Simulator 15), que
   terminam normalmente.

## Evidência

### Log `9541` (`python telemetria.py logs 9541`, filtrado por `Download \[PES`, `QUEUE`, `RESUME`, `LIFECYCLE`)

```
21:09:28.553Z pid=4108 [PES 2015 ...] Chunked download: 7615 MB, 1904 segments (~4 MiB each), up to 16 parallel HTTP
21:55:20.637Z pid=4108 Download [PES 2015 ...]: 99.8% (7598.1/7614.8 MB) @ 2.8 MB/s (chunked HTTP)
   (nenhuma linha BACKEND_OUT ate o fechamento; so APP_USB e APP_BROWSE)
22:01:04.429Z pid=4108 APP_LIFECYCLE application before-quit
22:01:04.744Z pid=4108 BACKEND_END reason=process_exit exitCode=null signal=SIGTERM
22:07:15.311Z pid=1244 QUEUE RESUME: retomando "PES 2015 ..." da sessao anterior
22:07:15.565Z pid=1244 IA Download: PES 2015 ... -> ....zip
22:07:18.715Z pid=1244 APP_LIFECYCLE application before-quit          (fechado 3 s depois, antes de qualquer escrita)
22:12:20.760Z pid=9420 QUEUE RESUME: retomando "PES 2015 ..." da sessao anterior
22:14:34.356Z pid=9420 IA Download: PES 2015 ... -> ....zip
22:14:35.895Z pid=9420 [PES 2015 ...] Chunked download: 7615 MB, 1904 segments ...
22:14:36.427Z pid=9420 Download [PES 2015 ...]: 0.0% (0.0/7614.8 MB) @ 0.0 MB/s (chunked HTTP)
22:14:44.640Z pid=9420 QUEUE: removed job "PES 2015 ..."
```

O que cada trecho prova:

- **O download terminou e não travou.** O ticker de `IADownloadChunkedParallel` escreve uma linha a
  cada 15 s enquanto o laço vive (`ia.go:413-416`). Ele só sai em três casos: por estagnação
  (`DownloadStallTimeout` = **45 s**, `app/config.go:56`, que loga `Download chunked estagnado`),
  por cancelamento ou por `progressDone`, que fecha depois de `wg.Wait()` quando todos os
  segmentos terminam (`ia.go:508-509`). Não há linha de estagnação e o PES não foi cancelado
  antes de 22:14. Faltavam 16,7 MB (cerca de 6 s a 2,8 MB/s), então o download terminou por volta de 21:55:26.
- **Na volta, nenhum marcador existia.** Entre `IA Download` e `Chunked download` passaram
  **1,54 s**, contando a sonda HTTP (`IAProbeDownload`). Se o `.complete` existisse,
  `reusableCompletedDownload` teria calculado o SHA-256 dos 7,6 GB antes de responder
  (`ia.go:57`), o que leva minutos nesta máquina, não 1,5 s. Se o `.xbox-companion-resume.json`
  existisse e fosse válido, `IADownloadChunkedParallel` teria logado
  `DOWNLOAD RESUME [...] confirmados` (`ia.go:363-365`).
- **O arquivo estava no lugar certo para ser reaproveitado.** O job é local
  (`REGISTER: Local D:\ ... mode=local install=god`, 21:09:25). Por isso `archivePath` é o
  `.source.zip` dentro de `Ready/<jogo>` (`pipeline.go:193-197`, `resolveLocalSourceArchive`), e
  esse arquivo não é apagado na limpeza do `Temp` (`Removed 0.00 GB of stale processing data`).
  A conexão local foi restaurada da fila persistida: `QUEUE RESUME: destino local ... nao confere`
  em 22:07:15 só aparece com `conn.Mode == "local"` (`queue_resume.go:46-55`).

### A janela no código

`IADownloadChunkedParallel`, caminho de sucesso (`ia.go:525-526`):

```go
removeDownloadResume(dest)   // apaga o mapa de segmentos
return nil
```

E quem chamou, `DownloadWithProgress` (`ia.go:203-209`):

```go
downloadErr = s.IADownloadChunkedParallel(urlStr, dest, name, ref, size)
if downloadErr == nil {
    if err := markDownloadCompleted(dest, urlStr); err != nil {   // sha256File(dest) inteiro, ia.go:87
```

Entre o `removeDownloadResume` e o `os.Rename` do `.complete` (`ia.go:116`), o arquivo de 7,6 GB
está **íntegro e sem nenhum dos dois marcadores**. Nesta máquina a janela é longa: `sha256File`
lê o arquivo inteiro do disco, e a mesma máquina leva 25-35 s para uma
`varredura de jogos instalados` com 0 jogos (21:58-22:00). Os 5 min 44 s sem log cabem nela.

Ao reabrir:

1. `reusableCompletedDownload` devolve `false` porque não há `.complete` (`ia.go:45-48`).
2. `finishedSingleResume` devolve `false` porque só aceita `marker.Mode == "single"` e o marcador nem existe (`resume.go:70-82`).
   **É exatamente a promoção que o comentário de `ia.go:180-182` descreve, mas só para o modo single.**
3. `loadResumeMarker` devolve `false` (`resume.go:30-33`).
4. `os.Create(dest)` + `Truncate(totalSize)` (`ia.go:306-311`) zera o arquivo completo e recomeça.

E a UI fica parada enquanto isso: o último `LogStatus` do ticker é o de ~100%. Nada é publicado
entre o fim do download e o `LogStatus(... "Extracting ISO...")` de `pipeline.go:283`. Para o
cliente, a fila mostra um download "parado no fim" por minutos, e fechar o app é a reação natural.

## Causa raiz

A ordem dos dois marcadores em `ia.go`: o marcador de retomada é apagado **antes** de o marcador
de conclusão existir, e o marcador de conclusão só é gravado depois de um hash do arquivo
inteiro. A promoção que fecha essa janela (`finishedSingleResume`, `ia.go:183-190`) só cobre o
modo single. Isso está provado pelo código. Que o fechamento deste cliente caiu exatamente
dentro do hash está provado por exclusão: não houve estagnação, cancelamento nem marcador na volta.
Não há log que diga "hash em andamento". Esse log é parte da correção.

## Escopo — o que NÃO é este bug

- **O cliente tirar o pendrive com 8%** e o agente aceitar "já baixei": é do agente de suporte,
  em `digitalstoregamesproject` (`docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-10-07-agente-xbox-aceita-ja-baixei-sem-conferir-a-fila-e-manda-para-manage-paths.md`).
  O pipeline aguentou a remoção: o download continuou no PC.
- **A janela branca ao reabrir** (21:48 UTC): [[electron-main-janela-branca-ao-reabrir-com-o-app-ja-aberto-sem-telemetria-do-renderer_2026-10-07T21-48]].
- **Falta de progresso na extração:** [[backend-pipeline-extracao-sem-progresso-parece-travada_2026-09-26T11-24]]
  (fechado). Aqui o silêncio é **antes** da extração.

## Tarefas propostas

| # | task | arquivo/símbolo | prova |
|---|---|---|---|
| T1 | gravar o `.complete` **antes** de apagar o mapa de segmentos, ou promover na volta um chunked com todos os `Completed[i] == true` (o equivalente chunked de `finishedSingleResume`). O mapa já tem o hash de cada segmento, então a promoção pode validar por segmento | `ia.go::DownloadWithProgress`, `IADownloadChunkedParallel`, `resume.go` | teste em `ia_test.go`: download chunked completo, marcador `.complete` ausente e mapa com todos os segmentos `true` → `DownloadWithProgress` não faz nenhuma requisição de faixa e devolve `nil`; e o mesmo com o mapa **já removido** falha hoje (vermelho antes do fix) |
| T2 | publicar status durante o hash final (`LogStatus(name, "Processing", "Conferindo o arquivo baixado...")` + `Logf`) para a fila não ficar parada em 100% | `ia.go::markDownloadCompleted` ou o chamador | teste do status emitido; conferir no log de uma máquina real |
| T3 | (opcional) avisar ao fechar o app com download/conferência em andamento | `electron-app` (`before-quit`) | prova manual com fila ativa |

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** corrigir — a janela sem marcador entre `removeDownloadResume` e `markDownloadCompleted` fica toda em `src/server/infrastructure/download`, e um teste Go com `httptest` prova a correção sem rede nem disco real.
**Complexidade:** alta — pelo critério do `docs/bugs/open/README.md`, mexe no pipeline de download (retomada durável). A estimativa "baixa" no topo do doc media só o tamanho do diff.
**Severidade:** medio — nenhum dado ou save se perde e há contorno (baixar de novo), mas um download inteiro vai fora (7,6 GB / 46 min neste caso). Só acontece a quem fecha o app durante o hash final, que hoje fica silencioso.
**Arquivos a alterar (reserva da onda):**
- `src/server/infrastructure/download/ia.go` — `DownloadWithProgress` passa a ser o único lugar que apaga o mapa de retomada no sucesso, sempre DEPOIS do `.complete`; promove o chunked integral; publica o status "Conferindo". As folhas `IADownloadChunkedParallel` e `iaDownloadSingleAttempt` deixam de apagar o mapa no sucesso
- `src/server/infrastructure/download/resume.go` — a promoção (`finishedSingleResume`) passa a aceitar também o modo chunked com todos os `Completed` true
- `src/server/infrastructure/download/ia_test.go` — testes novos (lista abaixo)

### Causa raiz (símbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `ia.go::DownloadWithProgress` (l.170-221) — devolve `error`. Ordem: `SetQueueJobDownload` → `reusableCompletedDownload` (reaproveita) → `finishedSingleResume` (promove, só modo single) → remove `.complete` → chunked (`IAProbeDownload` + `IADownloadChunkedParallel`, depois `markDownloadCompleted`) ou single (`IADownloadSingle`, depois `markDownloadCompleted`). Se `markDownloadCompleted` falha → `return fmt.Errorf("persistir conclusao do download: %w")` e nenhum dos dois marcadores fica no disco.
- `ia.go::IADownloadChunkedParallel` (l.283-527) — no sucesso: `out.Close()`, depois **`removeDownloadResume(dest)` (l.525)** e `return nil`. Em erro só apaga arquivo e mapa em `ErrJobCancelled` (l.519-522); nos outros erros mantém os dois (retomada). Com mapa válido (`loadResumeMarker` ok e tamanhos batendo) refaz o hash de cada segmento `Completed` (l.320-337), enfileira só os que faltam e, com 0 jobs, passa direto pelo `wg.Wait()` e devolve `nil`. Sem mapa: `os.Create` + `Truncate` (l.306-311), ou seja, zera o arquivo.
- `ia.go::iaDownloadSingleAttempt` (l.661-809) — **também apaga o mapa no sucesso (l.807), antes de o chamador gravar o `.complete`**. `finishedSingleResume` cobre só uma morte entre `out.Sync()` (l.776) e a l.807, intervalo de microssegundos. **O modo single tem a mesma janela durante o hash.** Isso vale para arquivo < `IAParallelThreshold` = 32 MB (`app/config.go:43`) e para IA sem Range. O fix cobre os dois modos.
- `ia.go::markDownloadCompleted` (l.82-120) — faz `sha256File(dest)` do arquivo inteiro e grava o `.complete` (tmp + `Sync` + `Rename`). Em erro devolve o erro sem gravar nada.
- `ia.go::reusableCompletedDownload` (l.44-58) — exige `.complete` com URL, tamanho e SHA-256 batendo (refaz o hash inteiro).
- `resume.go::finishedSingleResume` (l.70-82) — exige `Mode == "single"`, URL, `TotalSize > 0` e `st.Size() == TotalSize`. Não confere conteúdo: o hash do `.complete` sai do arquivo como ele está, e a extração invalida depois um arquivo ruim por `InvalidateCompletedDownload`.
- `resume.go::loadResumeMarker` (l.30-51) — no chunked exige versão, modo, URL, `TotalSize`, `SegmentSize` e `st.Size() == totalSize`.
- `app/config.go::protectedScratchPaths` (l.319-328) — protege `job.Scratch` e os DOIS marcadores de todo job ainda na fila. Manter o mapa até o `.complete` não esbarra na limpeza do `Temp`.
- `app/app.go::LogStatus` (l.138-158) — grava `models.GameStatus{State, Message}` em `a.JobQueue` e persiste só quando o estado muda: mensagem de progresso com o mesmo `"Processing"` não reescreve a fila. `Logf` (l.133) imprime `[hh:mm:ss] ...` no stdout, que é o console da Home e o `BACKEND_OUT` da telemetria.
- Call-sites de `DownloadWithProgress`, que provam que o fix chega ao fluxo do cliente: `services/pipeline/pipeline.go:199` (IA, o caso do PES; no modo local `archivePath` é o `.source.zip` em `Ready/`, l.193-197), `digital.go:175,323`, `huggingface.go:52`, `rom.go:66`. `IADownloadChunkedParallel` e `IADownloadSingle` só são chamados por `DownloadWithProgress` (l.203, l.212) e pelos testes (`ia_test.go:128,162`), então tirar o `removeDownloadResume` das folhas não muda outro caminho. `edgeemu.go` tem chunked próprio, sem marcador nenhum, e fica fora.

### Provas (comando literal -> resultado)

- `grep -rn "removeDownloadResume\|markDownloadCompleted\|finishedSingleResume" --include=*.go src/server | grep -v _test` → `removeDownloadResume` no sucesso das duas folhas (`ia.go:525` chunked, `ia.go:807` single), antes do `markDownloadCompleted` do chamador (`ia.go:205`, `ia.go:216`). A promoção só existe para single (`ia.go:183`).
- `grep -rn "IADownloadChunkedParallel\|IADownloadSingle(" --include=*.go src/server` → só `ia.go:203`, `ia.go:212` e `ia_test.go`.
- `grep -rn "DownloadResumeSuffix\|DownloadCompleteSuffix" --include=*.go src/server | grep -v _test` → fora de `download/`, só `app/config.go:326-327` (proteção da limpeza) e a definição em `queue_store.go:23-24`. Nenhum outro leitor depende de o mapa sumir no fim do download.
- Log `9541` (seção Evidência deste doc): 1,54 s entre `IA Download` e `Chunked download` na volta, e progresso em `0.0%` sem `DOWNLOAD RESUME`. Bate com nenhum marcador no disco, que é o estado da janela.

### Hipóteses descartadas (e por quê)

- **O download travou em 99,8%:** o ticker loga a cada 15 s enquanto o laço vive. A estagnação (45 s) teria logado `Download chunked estagnado`, e não logou. Faltavam ~6 s de transferência.
- **A limpeza do Temp apagou o arquivo ou o mapa:** o job era local, então o arquivo fica em `Ready/` (`resolveLocalSourceArchive`), e `protectedScratchPaths` protege os dois marcadores de job na fila. O log mostra `Removed 0.00 GB`.
- **Mapa inválido (URL ou tamanho mudou):** daria o mesmo resultado (recomeçar), mas o mapa nem podia existir: `ia.go:525` já tinha rodado, porque `progressDone` só fecha depois de todos os segmentos. Também não houve `DOWNLOAD RESUME` nem reparo de segmento.
- **Gravar o `.complete` sem o hash, para encurtar a janela:** quebra o contrato de `reusableCompletedDownload`, que confere o SHA-256. A ordem certa é manter o mapa até o `.complete` existir.
- **Só manter o mapa e deixar a retomada chunked normal resolver (sem promoção):** funciona, mas faz `IAProbeDownload` (rede), refaz o hash de todos os segmentos antes do hash inteiro (duas leituras de 7,6 GB) e falha sem internet. A promoção antes do probe evita as duas coisas e é a mesma que o single já tem. A retomada normal fica como rede de segurança quando a promoção falhar.

### Tarefas

- [ ] **T1** `ia.go::IADownloadChunkedParallel` e `ia.go::iaDownloadSingleAttempt` — tirar o `removeDownloadResume(dest)` do caminho de SUCESSO (l.525 e l.807). Os de cancelamento e de servidor que alterou o arquivo ficam. Em `ia.go::DownloadWithProgress`, apagar o mapa só depois de `markDownloadCompleted` devolver `nil`, nos dois caminhos (chunked e single). Se `markDownloadCompleted` falhar, o mapa fica e a próxima tentativa promove ou retoma. O comentário cita `[[pipeline-download-chunked-concluido-perdido-ao-fechar-durante-o-hash-final-recomeca-do-zero_2026-10-07T21-48]]`. Testes:
  - `TestChunkedDownloadKeepsResumeMapUntilCompletionMarker` (vermelho na base): `IADownloadChunkedParallel` completo (httptest com Range, `iaSegmentSize = 8`). Depois do retorno, o mapa ainda existe com todos os `Completed` true. Na base ele sumiu.
  - `TestSingleDownloadKeepsResumeMapUntilCompletionMarker` (vermelho na base): o mesmo para `IADownloadSingle`.
  - `TestDownloadWithProgressClearsResumeMapAfterCompletionMarker` (verde nos dois): depois de `DownloadWithProgress` com sucesso, o `.complete` existe e é reaproveitável, e o mapa não existe.
- [ ] **T2** `resume.go::finishedSingleResume` (renomear para algo como `finishedResume`, a critério do dev) — aceitar `Mode == "chunked"` quando `st.Size() == TotalSize`, `len(Completed) > 0`, `len(SegmentHashes) == len(Completed)` e TODOS os `Completed` true. O single continua como está. `DownloadWithProgress` já faz `markDownloadCompleted` + `removeDownloadResume` nesse ramo (l.183-190): é trocar a chamada e ajustar o comentário. Testes:
  - `TestDownloadPromotesFullChunkedResumeWithoutRequest` (vermelho na base): arquivo integral, mapa chunked todo `true`, sem `.complete`, e um servidor httptest que conta requisições e responde 500. `DownloadWithProgress` devolve `nil`, faz **0 requisições** (nem o probe) e deixa `reusableCompletedDownload` true. Na base: probe 500 → single → erro HTTP 500.
  - `TestDownloadDoesNotPromotePartialChunkedResume`: mapa com um `Completed` false → não promove e baixa SÓ o segmento que falta (conferido pelo Range pedido).
- [ ] **T3** `ia.go::DownloadWithProgress` — antes de cada `markDownloadCompleted` (promoção, chunked, single): `s.App.LogStatus(name, "Processing", "Conferindo o arquivo baixado...")` e `s.App.Logf("DOWNLOAD VERIFY [%s]: conferindo %.1f MB antes de liberar", ...)`. Depois do hash, `DOWNLOAD VERIFY [%s]: concluido em %s` com a duração, para o próximo log mostrar onde o tempo foi. Um helper local (ex.: `s.finalizeDownload(dest, urlStr, name)` = status + hash + `.complete` + `removeDownloadResume`) evita repetir isso três vezes. Teste `TestDownloadWithProgressReportsFinalVerification`: depois de um download com sucesso, `a.JobQueue.Load(name)` traz um `models.GameStatus` com "Conferindo" na `Message` (é o último status que `DownloadWithProgress` publica).
- [ ] CHANGELOG `## [Unreleased]` → `### Fixed`, sem subir versão (manual, seção Dev).
- **Fora do escopo:** a T3 original deste doc (aviso no `before-quit` do Electron). Com T1+T2, fechar o app durante o hash deixa de custar o download, e o aviso seria UX nova noutro módulo.

### Plano de teste

- **Offline (sem slot):** `go test -count=1 ./infrastructure/download/` em `src/server`, com os 6 testes acima. Os três marcados "vermelho na base" têm de falhar com o código da base. Para provar isso, rode os testes novos numa worktree/cópia da base, sem stash. Os existentes `TestChunkedDownloadReusesCheckpointedSegments`, `TestDownloadWithProgressReusesOnlyVerifiedCompletedFile` e `TestDownloadPromotesDurableFullSingleResumeWithoutRequest` continuam verdes.
- **T2 reprodução como o usuário (E2E, no slot):** app da lane (`npm start`) com um job local gravando numa PASTA da máquina. O destino "Pendrive (USB)" do Catálogo só lista pendrive/HD (`BrowsePage.tsx::buildDestinations`), e disco real é proibido. Por isso o job é registrado por `GET http://127.0.0.1:<serverPort>/register?game=<nome exato do catálogo>&platform=xbox360&mode=local&local_root=<pasta vazia na evidência>&install_type=god` (`handlers.go::handleRegister`; `PrepareLocalDevice` só grava o arquivo de identidade na pasta). É o mesmo `mode=local install=god` do cliente. O resto do caminho é o do cliente, pela UI e pelo ciclo de vida do app:
  1. Escolha um jogo do Internet Archive **≥ 1 GB** que não esteja no HF. Esse tamanho passa do limiar chunked (32 MB) e deixa o hash longo o bastante para dar tempo de fechar o app dentro dele. Acompanhe o download na Fila/Home (`Chunked download: ... segments` no console do backend).
  2. Gatilho do fechamento: um watcher em PowerShell (poll de 50 ms) na pasta `Ready/<jogo>` (raiz de runtime da lane, ou `godsend-temp/ready` no volume de `bestFixedVolume`) ou no stdout do backend:
     - **com o fix:** a linha `DOWNLOAD VERIFY [<jogo>]: conferindo`, ou "Conferindo o arquivo baixado..." na Fila;
     - **na base (controle positivo):** `<arquivo>.source.zip.xbox-companion-resume.json` some sem que `.xbox-companion-complete.json` exista.
     Nesse instante, feche o app pela janela (X → `before-quit`, como o cliente). Se o fechamento não couber no hash, use `Stop-Process` no PID do `godsend-windows-x64` que VOCÊ abriu. Anote qual dos dois usou.
  3. Antes de reabrir, confira no disco: o `.source.zip` tem o tamanho integral. Com o fix, o mapa existe (todo `true`) e não há `.complete`. Na base, não há nenhum dos dois.
  4. Reabra (`npm start`) → `QUEUE RESUME: retomando "<jogo>"`.
  - **SINAL do sintoma (base):** `Chunked download: ...` seguido de `Download [<jogo>]: 0.0%`, com o arquivo recriado.
  - **Correto (fix):** `DOWNLOAD RESUME [<jogo>]: promovendo arquivo integral sincronizado`, depois `DOWNLOAD VERIFY` e, logo em seguida, `Extracting ISO...` na Fila, sem `Chunked download` nem requisição nova. O job chega a `Ready` com o GOD na pasta de evidência.
  - **Evidência:** prints da Fila (`page.screenshot` do Playwright), trecho do log do backend e `dir` de `Ready/<jogo>` antes e depois de reabrir.
- **Controle positivo:** os passos 1-4 com o código da base e o gatilho "mapa sumiu"; o esperado é recomeçar do 0,0%. Pode acontecer de o hash da máquina de teste ser rápido demais para o watcher (SSD lê 1 GB em ~1 s). Nesse caso o controle positivo fica com os testes offline vermelhos na base (`PromotesFullChunkedResume` e `KeepsResumeMap`), escrito na evidência. Do lado do fix, o estado do passo 3 também pode ser montado à mão: pare o backend depois de 100% e antes de `Extracting ISO`, apague o `.complete` e mantenha o mapa todo `true`. A volta tem de promover.
- **T3 regressão direcionada:** `go test -count=1 ./...` em `src/server` (linha de base: 9 pacotes ok) e `npm --prefix src/electron-app run test:safety` (258/0). Fluxos vizinhos que o fix toca:
  - (a) download interrompido no MEIO continua retomando com `DOWNLOAD RESUME [...] MB ja confirmados` (fechar a ~30% e reabrir);
  - (b) download concluído continua reaproveitado (`DOWNLOAD CACHE [...]: reutilizando`) num `/queue/retry` ou retomada depois do download;
  - (c) cancelar no meio continua apagando o arquivo e o mapa (`QUEUE: removed job`, e a pasta sem `.source.zip` nem `.xbox-companion-resume.json`);
  - (d) jogo < 32 MB (single) termina sem deixar `.xbox-companion-resume.json` órfão;
  - (e) arquivo corrompido na extração continua invalidando o cache (`DOWNLOAD CACHE [...]: arquivo local invalidado`), coberto pelos testes do pipeline.

### Sessões seguintes

- dev: effort high, ultrathink sim — mexe na consistência de marcadores duráveis do pipeline de download (o manual pede `high`). O diff é pequeno, mas a ordem marcador/arquivo e o caminho de erro de cada passo pedem raciocínio, não digitação.
- teste: effort medium, ultrathink não — o teste offline é direto. A parte sutil é o gatilho do E2E (pegar a janela do hash), e a receita já diz o que fazer se a janela for curta demais.
