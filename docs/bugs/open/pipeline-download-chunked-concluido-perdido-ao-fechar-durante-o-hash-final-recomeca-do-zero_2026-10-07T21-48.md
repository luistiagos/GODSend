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
