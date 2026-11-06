# Bug: "Download falhou em todas as fontes" em série — um comprador acumula 13 títulos que nunca baixam, e a telemetria tem 101 falhas abertas em 25 dias

- **Detectado em:** 2026-11-06 16:40 (análise da sessão de WhatsApp `161091405496378@lid`, chamado **#232**, telefone
  `555184115845`; telemetria `errors`, projeto `xbox-360-companion/pipeline`)
- **Origem:** `xbox-360-companion/pipeline` — `src/server/services/pipeline/fallback.go::ProcessGameWithFallback`
  (cadeia `huggingface -> ia -> minerva`)
- **Errors (serviço):** 11459, 11471, 11759, 12434, 12784 (compatíveis em horário com as fotos do cliente; a tabela
  não identifica a máquina) — e mais 96 do mesmo título de reporte no período, todos `status=open`
- **Classe:** fail
- **Severidade:** **P1 — Alto**. Para cada título afetado a entrega fica bloqueada (o cliente tentou o mesmo jogo
  várias vezes, em dias diferentes), e são justamente os jogos que ele quer jogar. A cadeia de fallback não salva
  nenhum deles.
- **Complexidade:** Alta (pipeline de download/fallback)
- **Versões:** v2.12.110 (23/10), v2.12.117 (27/10), v2.12.123 (01/11 a 06/11)
- **Reincidência:** mesma mensagem final de
  [`docs/bugs/closed/2026-08-09-fallback-huggingface-archive-minerva.md`](../closed/2026-08-09-fallback-huggingface-archive-minerva.md),
  mas **não** a mesma causa: lá a falha real era disco cheio/scratch e match do HF; aqui os erros por provedor são
  `download estagnado sem dados`, `download muito lento` e, em parte, `jogo nao encontrado no catalogo` no HF para
  títulos que o cache do HF tem com outro nome (ver "Evidência").

## Sintoma

Comprador da Plataforma Xbox 360 (tx 63970, 13/10/2026), console bloqueado com BadAvatar, HD externo de 500 GB.
A instalação e os primeiros jogos funcionaram (Max Payne 3, Batman, Bioshock Infinite). Depois disso, na Fila de
tarefas do Companion (prints descritos pela visão, ids de `Wpp_proccess`):

| quando (relógio do banco, UTC) | id | títulos com "Download falhou em todas as fontes" |
|---|---|---|
| 23/10 23:12 | [153215], [153217] | *"Uns 4 jogos tem dado isso"*: **The Orange Box** — `huggingface: jogo nao encontrado no catalogo` / `ia: download estagnado sem dados` / `minerva: download muito lento` |
| 23/10 23:16 | [153223] | **Hitman**, **Forza Motorsport 3** |
| 23/10 23:59 | [153251] | *"Já tentei duas vezes"* — Orange Box de novo: `huggingface: HuggingFace download failed: download estagnado sem dados` |
| 26/10 00:27 | [155325] | **Crysis 3**, **Resident Evil 2 (Revelations)**, **Hitman Absolution**, **The Evil Within** (`huggingface: jogo nao encontrado no catalogo` / `ia: download muito lento` / `ia: download estagnado`) |
| 26/10 00:29 | [155327] | *"Já tentei várias vezes mas não deu e os jogos que eu gosto"* |
| 31/10 00:14 | [161593] | lista à mão acrescenta **Far Cry 4** e **Devil May Cry** |
| 02/11 22:47 | [165585] | **Dead Island**, **Metal Gear Solid V: The Phantom Pain** — *"só os jogos melhores tá dando problema"* |
| 06/11 18:37 | [169183] | **Operation Flashpoint: Dragon Rising** (`huggingface: HuggingFace download failed`) |
| 06/11 18:48 | [169185] | *"Preciso que você consiga arrumar os outros que mandei"* |

Ninguém resolveu: o agente de WhatsApp anotou os nomes e disse que "a equipe está analisando"; o chamado #232 está
aberto sem nenhuma mensagem de operador (isso é do chatbot, registrado no repositório `digitalstoregamesproject`).

## Evidência

1. **Telemetria — o volume não é só deste cliente.** Consulta pelo `/diag/query` (somente leitura):

   ```sql
   SELECT DATE(time) d, COUNT(*) n,
          SUM(message LIKE '%estagnado%') stall, SUM(message LIKE '%muito lento%') slow,
          SUM(message LIKE '%No default.xex%') nopkg
   FROM errors
   WHERE time >= '2026-10-13' AND time < '2026-11-07'
     AND project='xbox-360-companion/pipeline'
     AND message LIKE 'Download falhou em todas as fontes%'
   GROUP BY DATE(time)
   ```

   Resultado: **101** reportes em 25 dias (1 a 10 por dia), dos quais **27** com `estagnado`, **30** com
   `muito lento` e **14** com `No default.xex` (esses 14 são outro defeito, ver
   [`catalogo-homebrew-emuladores-e-patches-xbox360-rgh-nunca-instalam-...`](catalogo-homebrew-emuladores-e-patches-xbox360-rgh-nunca-instalam-no-default-xex-no-pacote-hf_2026-11-06T16-40.md)).
   Todos os 101 estão com `status='open'`: nenhum foi triado.

   O título do reporte guarda só o **primeiro erro que não é ausência de catálogo** (`fallback.go::recordError`,
   linhas 100-116), então `jogo nao encontrado no catalogo` nunca aparece no título — por isso a coluna desse erro
   dá zero na telemetria, embora apareça nos prints do cliente.

2. **Reportes compatíveis com as fotos do cliente:**
   - `11459` 23/10 23:07 v2.12.110 — `Orange Box, The (World) (En,Fr,De)`: `ia: download estagnado sem dados`
   - `11471` 23/10 23:41 v2.12.110 — `Orange Box`: `huggingface: download estagnado sem dados`
   - `12434` 01/11 23:57 v2.12.123 — `Dead Island`: `huggingface: download muito lento`
   - `12784` 06/11 17:30 v2.12.123 — `Operation Flashpoint Dragon Rising`: `huggingface: download muito lento`

3. **Os títulos existem no catálogo local**, inclusive no do HuggingFace (contagem de nomes distintos nos `cache/*.json`
   do repositório):

   | título | hf_xbox360 | xbox360 (IA) | minerva_xbox360 |
   |---|---|---|---|
   | orange box | 4 | 9 | 9 |
   | evil within | 6 | 6 | 12 |
   | forza motorsport 3 | 2 | 24 | 42 |
   | hitman absolution | 2 | 0 | 0 |
   | crysis 3 | 2 | 15 | 24 |
   | far cry 4 | 4 | 9 | 15 |
   | dead island | 8 | 12 | 36 |
   | operation flashpoint | 4 | 12 | 18 |
   | phantom pain | 4 | 6 | 6 |
   | devil may cry | 8 | 21 | 24 |

4. **Nome pedido × nome no HF.** No print de 23/10 o item da fila é `Orange Box, The (World) (En,Fr,De)` e o HF responde
   `jogo nao encontrado no catalogo`; o `hf_xbox360.json` tem `"Orange Box"` e `"HALF LIFE 2 THE ORANGE BOX PT BR ( XBOX 360 RGH )"`.
   O mesmo com `Evil Within, The (USA)` × `"Evil Within"` / `"The Evil Within"`. Quando o cliente escolheu a outra
   variante (`Orange Box`, reporte 11471), o HF achou o jogo e falhou por estagnação.

## Causa raiz (passada 2, 2026-11-06)

**A cadeia de fallback joga fora o download que estava andando na primeira interrupção transitória.** Não é a
lentidão em si: a lentidão já tem tratamento (todas as fontes lentas → retomada "irrestrita", sem checagem de
velocidade, em `fallback.go:235-259`). O que mata o jogo é que essa retomada é **uma tentativa só**, e nenhuma camada
retoma o arquivo parcial depois de uma estagnação de 45 s ou de um reset de stream HTTP/2.

Prova — `error_logs` dos reportes do período (95 dos 101 têm linha de log):

```sql
SELECT e.id, e.user_agent, l.seq, l.content FROM errors e JOIN error_logs l ON l.error_id=e.id
WHERE e.time >= '2026-10-13' AND e.time < '2026-11-07' AND e.project='xbox-360-companion/pipeline'
  AND e.message LIKE 'Download falhou em todas as fontes%' ORDER BY e.id, l.seq
```

- **56** reportes chegaram à retomada irrestrita (`<provedor> (retry)`). Dela, **43** morreram em interrupção de rede
  transitória: **26** `download estagnado sem dados`, **15** `stream error: stream ID N; PROTOCOL_ERROR|INTERNAL_ERROR;
  received from peer`, **2** `read tcp ... forcibly closed`. O resto: 401 do IA (5), `No default.xex` (1, outro bug),
  extração/release incompleta (3), HTTP 500 (1), request (3). Os outros 39 nem chegaram à retomada (nenhuma fonte
  lenta: catálogo, `No default.xex`, 401, `IA service not initialized`) — outros defeitos.
- Os 4 do cliente: 11459 `ia (retry): estagnado`; 11471 `huggingface (retry): interrupted after 259.32 MB: estagnado`;
  12434 `huggingface (retry): read after 524288 bytes: stream error ... PROTOCOL_ERROR`; 12784 `huggingface (retry):
  estagnado`. Em 12434 e 12784 **as três** fontes deram `muito lento` antes: é a linha do cliente, não o provedor.
- Perda grande e explícita: 12457 `interrupted after 6581.99 MB nesta tentativa: estagnado` (retry); 9929 IA
  `interrupted after 4772.18 MB: estagnado` na 1ª passada, depois troca de provedor.

Símbolos abertos:

- `fallback.go::ProcessGameWithFallback` — 1ª passada: estagnação conta como "lento" (`isDownloadTooSlowError` casa
  `estagnado`/`stall`), troca de provedor e, ao trocar, `cleanupGameScratch` (linha 202) apaga o parcial (fora do modo
  local). Retomada irrestrita: `cleanupGameScratch` (242) + **um** `executeProvider(chosen)` (243); falhou →
  `cleanupGameScratch` (261) + "Download falhou em todas as fontes". `SetSpeedCheckBypass` desliga só a checagem de
  velocidade; a de estagnação continua ligada.
- `download/ia.go::DownloadWithProgress` — HF e IA passam por aqui (o catálogo HF aponta muitas vezes para
  `archive.org/download/...`, ver `cache/rgh_files.go::NormalizeHuggingFaceDownloadURL`). archive.org + range →
  `IADownloadChunkedParallel`; senão `IADownloadSingle`. **Nenhum laço de retomada nesta função.**
- `IADownloadChunkedParallel` — monitor: 45 s (`app.DownloadStallTimeout`) sem byte de nenhum worker →
  `ErrDownloadStalled`, devolvido cru, **sem nova tentativa**. Segmentos concluídos ficam no mapa
  (`*.xbox-companion-resume.json`) e uma nova chamada retoma deles (`loadResumeMarker`). Um range que falha 6 vezes
  (`iaDownloadRange`, `IAChunkRetries=5`) derruba o download inteiro — é o `read after N bytes: stream error`.
- `IADownloadSingle` — estagnação ganha **uma** retentativa (`attempt >= 1` → retorna); erro genérico até 5, com
  espera 6..30 s. O parcial e o marcador `single` ficam; nova chamada retoma por `Range` (`loadSingleResume`).
- `download/resume.go` — `loadSingleResume` (tamanho do arquivo = bytes duráveis), `loadResumeMarker`
  (`Completed[]` = segmentos duráveis). É daqui que sai a medida de progresso entre tentativas.
- `pipeline/workspace.go::cleanupGameScratchInternal` — apaga `<nome>.7z|.zip|.rar|.iso|_hf.*` do `TempDir`. No modo
  local o arquivo-fonte fica em `Ready/<nome>/.source*` (`resolveLocalSourceArchive`) e não é apagado.
- `app/config.go` — limiar 512 KB/s (média desde o primeiro byte), carência 45 s, sustentado 20 s;
  `IAHTTPClient` é `http.Client` padrão (HTTP/2 sobre TLS, 16 ranges paralelos multiplexados).

## Hipóteses descartadas

- **H1 (match do HF com artigo invertido) como causa da falha.** Mesmo quando o HF não acha o título, o IA acha e
  baixa (11459: `ia` começou e estagnou). O miss do HF só muda qual fonte baixa; não é o que faz a entrega falhar.
  Fica fora desta correção (melhoria de catálogo, não bloqueio).
- **H2 (limiar de 512 KB/s cedo demais) como causa da falha.** O limiar só decide a ordem: com todas as fontes lentas,
  a retomada irrestrita já desliga a checagem. A morte é depois, na estagnação/reset. Baixar o limiar não salvaria
  nenhum dos 43.
- **H3 (provedores fora do ar).** Os erros vêm depois de dados recebidos (até 6,5 GB). É interrupção transitória, não
  indisponibilidade.
- **Trocar o transporte (HTTP/1.1, menos paralelismo) para evitar o `PROTOCOL_ERROR`.** Plausível (16 streams numa
  conexão HTTP/2 em linha lenta), mas não provado; mudar o transporte sem reprodução é chute. Fica registrado.
- **Não apagar o parcial ao trocar de provedor.** É decisão de espaço em disco (dois arquivos de vários GB); com a
  retomada no lugar, a troca deixa de acontecer por interrupção transitória, que era o caso caro.

## Correção planejada

- **T1 — `download/ia.go::DownloadWithProgress` retoma no lugar enquanto houver progresso.** O corpo atual vira uma
  tentativa; em volta, um laço: depois de um erro **transitório** (estagnação, `stream error`, `read after`,
  `interrupted after`, falha de request, `connection reset`/`forcibly closed`, `unexpected EOF`, HTTP 5xx) e sem
  cancelamento, chama de novo sem apagar nada — retoma do parcial. Para depois de 3 tentativas seguidas sem nenhum
  byte durável novo (medido pelo `resume.go`). `ErrDownloadTooSlow`, cancelamento, 4xx, falta de espaço e checkpoint
  **não** entram no laço (a troca de provedor por lentidão continua igual).
  Efeito: na 1ª passada, estagnação no meio de um download andando deixa de trocar de provedor e perder os GB; na
  retomada irrestrita, a interrupção vira retomada em vez de "falhou em todas as fontes".
- Testes em `download/ia_test.go`, com `httptest`: (a) single que estagna depois de dados → termina íntegro por
  retomada; (b) chunked com range que falha → termina íntegro; (c) servidor que nunca entrega byte → desiste depois de
  3 tentativas sem progresso com `ErrDownloadStalled`; (d) `ErrDownloadTooSlow` não é retentado. Prova inversa: sem
  o laço, (a) e (b) falham.
- Fora desta correção: Minerva/aria2c (torrent tem retomada própria), H1, transporte HTTP/2, os 401 do IA e o
  `IA service not initialized` (9 reportes, a triar à parte).

## Tasks

| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | laço de retomada por progresso em `DownloadWithProgress` + testes (a)-(d) | (este commit) | feito | Opus 5.5 | -- |

## Como reproduzir

Não reproduzido. Ponto de partida: no Companion v2.12.123, enfileirar `Orange Box, The (World) (En,Fr,De)` e
`Orange Box` para um HD e comparar o log do fallback (`=== Fallback Pipeline: ...`) das duas variantes; repetir com
`Operation Flashpoint Dragon Rising` para medir a taxa observada antes do `muito lento`.

## Resolução (v2.12.124)

1. **Retomada no lugar (`download/ia.go::DownloadWithProgress` → `resumeWhileProgressing`)**: o corpo antigo virou
   `downloadWithProgressOnce`; em volta, depois de uma interrupção transitória (`isResumableDownloadInterruption`:
   `ErrDownloadStalled`, `stream error`, `read after`, `interrupted after`, `request failed`/`request:`,
   `connection reset`, `forcibly closed`, `unexpected eof`, `http 5`) e sem cancelamento, espera 10 s
   (`downloadResumeWait`, cancelável) e chama de novo sem apagar nada. Para com 3 tentativas seguidas sem byte durável
   novo (`durableDownloadBytes`: tamanho do arquivo no marcador `single`, soma dos segmentos `Completed` no `chunked`).
2. **O que não mudou**: `ErrDownloadTooSlow`, `ErrJobCancelled`, 4xx, espaço e checkpoint saem na primeira vez, então a
   troca de provedor por lentidão e a retomada irrestrita do `fallback.go` seguem iguais. Minerva (aria2c) não passa
   por aqui.

## Testes Automatizados

`src/server/infrastructure/download/ia_test.go`:

- `TestDownloadWithProgressResumesSingleStreamAcrossRepeatedStalls` (a) — servidor entrega 5 bytes e trava, duas
  vezes; o download termina íntegro em 3 pedidos, cada um com `Range` do offset certo.
- `TestResumeWhileProgressingFinishesChunkedDownloadAfterStall` (b) — segmento 1 trava na 1ª vez; termina íntegro e o
  segmento 0 confirmado não é pedido de novo.
- `TestResumeWhileProgressingGivesUpWithoutProgress` (c) — fonte sem byte: 3 tentativas e `ErrDownloadStalled`.
- `TestResumeWhileProgressingDoesNotRetryNonTransientErrors` (d) — lento, cancelado, 401, 404: 1 tentativa; os três
  textos de produção (`PROTOCOL_ERROR`, `forcibly closed`, `HTTP 500`) são reconhecidos como retomáveis.

Prova inversa: com `resumeWhileProgressing` reduzido a `return attempt()`, (a) falha com `interrupted after 0.00 MB
nesta tentativa: download estagnado` e (b) com `download estagnado sem dados`. `go build ./...` e `go test -count=1
./...` em `src/server`: verdes.

### E2E (2026-11-06, backend real, sem UI)

Backend compilado (`go build`) antes (`e0333c3`) e depois do fix, cada um com `GODSEND_HOME` próprio no scratchpad,
telemetria desligada (`GODSEND_ERROR_REPORTING=0`), catálogo `hf_xbox360.json` com um título apontando para uma fonte
HTTP local. A fonte entrega 1 MB e segura a conexão sem dados (estagnação real de 45 s do app) nos 5 primeiros
pedidos e entrega o resto no 6º. Fila pelo HTTP: `/register?mode=local&local_root=<pasta>&install_type=xex` +
`/trigger?priority=huggingface`. Roteiro: `scratchpad/e2e/run_e2e.py` (fora do repo).

| binário | pedidos | resultado |
|---|---|---|
| antes do fix | 4 (2 na 1ª passada + 2 na retomada irrestrita) | `Error`: `Download falhou em todas as fontes. Erros: huggingface: ... interrupted after 1.00 MB nesta tentativa: download estagnado ...` — a mensagem dos reportes |
| com o fix | 6, cada um com `Range` do offset certo; status "Conexao interrompida; retomando o download de N MB..." | `Ready`, `FALLBACK SUCCESS: huggingface`, `Games/E2E Stall Game/default.xex` byte a byte igual ao do arquivo |

Não coberto pelo E2E: a UI do Electron (o caminho muda só no backend), o modo chunked do archive.org (só nos testes
unitários) e o modo FTP.

## Critérios para fechar

- [x] Causa raiz de cada classe de erro (catálogo, estagnado, lento) provada pelo call-site (passada 2)
- [x] T1: testes (a)-(d) verdes e prova inversa (2.12.124)
- [ ] ~~Teste do match do HF com artigo invertido~~ — H1 descartada como causa; vira melhoria à parte
- [ ] Os títulos do cliente (lista acima) baixam numa versão publicada
- [ ] A taxa de `Download falhou em todas as fontes` na telemetria cai, medida pela mesma consulta da Evidência 1
- [ ] Os 101 reportes `open` triados

## Próximos passos

1. Abrir `cacheService.FindHuggingFaceEntry` e testar H1 com os nomes da Evidência 4.
2. Abrir o detector de lentidão (`isDownloadTooSlowError` e quem o produz) e medir os limiares contra os reportes
   de `muito lento`.
3. Responder o cliente do chamado #232 quando houver versão ou alternativa (o chatbot só anotou os títulos).
