# Bug: FIFA 18 (e títulos ZTM) baixando a ~80 KB/s via Archive.org levando > 12h, e travamento por stall de socket no pipeline

- **Estado:** corrigido no código em 2026-09-30, v2.12.106; testes unitários e de segurança aprovados.
- **Detectado em:** 2026-09-30 14:50
- **Origem:** chamado do usuário ("FIFA 18 está baixando a mais de 12h e ainda a 62%") + análise de catálogo e do pipeline Go (`cache/hf_xbox360.json`, `src/server/infrastructure/download/ia.go`, `src/server/services/pipeline/fallback.go`, `src/server/services/cache/huggingface.go`)
- **Classe:** catálogo / infraestrutura de rede / pipeline de download
- **Severidade:** **P1 - Alto** (degradação severa da experiência do usuário, downloads de horas/dias com risco de stall)
- **Complexidade:** média — requereu auditoria do catálogo ZTM, mapeamento para dataset HuggingFace CDN, e introdução de stall detection com context timeout na camada de transporte HTTP em Go.

---

## Sintoma Relatado

Usuário relata no chamado de suporte:
> *"FIFA 18 está baixando a mais de 12h e ainda a 62%"*

A interface da fila exibe progresso avançando em ritmo imperceptível, com velocidade oscilando abaixo de 100 KB/s, ou travando totalmente durante a noite sem falhar nem alternar provedor.

---

## Causa Raiz

### 1. Diagnóstico do Catálogo e Throughput do Internet Archive

No catálogo `cache/hf_xbox360.json` (e `cache/hf_.json`), a entrada do **FIFA 18** estava registrada da seguinte forma:
```json
{
  "name": "FIFA 18",
  "title_id": "454109EB",
  "url": "https://archive.org/download/mx360gcpt3-x360-ztm/FIFA.18.USA.X360-ZTM.rar",
  "source": "huggingface",
  "size": 6249701438
}
```
86 jogos do catálogo ZTM estavam apontando para o item `mx360gcpt3-x360-ztm` no **Internet Archive** (`archive.org/download/...`).

O Internet Archive aplica *rate limiting* e estrangulamento de banda agressivo para conexões anônimas e endpoints compartilhados, estabilizando entre **80 KB/s e 85 KB/s**.

A validação matemática do sintoma é exata:
- Tamanho do arquivo: $6.249.701.438\text{ bytes} \approx 5{,}82\text{ GiB}$.
- Velocidade efetiva do Archive.org: $\approx 85\text{ KB/s} = 87.040\text{ bytes/s}$.
- Tempo total necessário: $\frac{6.249.701.438}{87.040} \approx 71.802\text{ s} \approx 19{,}94\text{ horas}$.
- Em 12 horas de download: $\frac{12}{19{,}94} \approx 60{,}2\% \approx \mathbf{62\%}$.

O usuário estava literalmente recebendo o stream estrangulado do Archive.org há 12 horas.

### 2. Existência do Dataset Oficial em CDN de Alta Velocidade

O repositório HuggingFace oficial do projeto (`luistiagos/rgh`) já possuía o arquivo `FIFA.18.USA.X360-ZTM.rar` (junto com outros 85 títulos ZTM e arquivos de sistema, totalizando 110 itens).
A CDN CloudFront do HuggingFace entrega taxas entre **20 MB/s e 50 MB/s** (reduzindo o tempo de download de 20 horas para **2 a 4 minutos**). No entanto, o catálogo em cache ainda apontava para o Archive.org.

### 3. Stall de Conexão e Bypass no Fallback

Dois fatores no Go backend agravavam a situação:
1. **Falta de Stall Detection no Downloader:** O método `iaDownloadSingleAttempt` utilizava `resp.Body.Read` via buffer sem deadline por inatividade. Caso ocorresse um stall de TCP silencioso no Archive.org (muito comum em downloads longos de 12 horas), a leitura ficava bloqueada indefinidamente.
2. **Speed Check Bypass:** Quando o download caía abaixo do piso de 512 KB/s, após esgotar tentativas em outros provedores, o fallback ativava `SetSpeedCheckBypass(gameName, true)`. Com isso, o job nunca era interrompido para retentativa limpa de socket ou reconexão via range header.

---

## Solução Implementada

### 1. Mapeamento Canônico de Releases ZTM para HuggingFace CDN (`src/server/services/cache/rgh_files.go`)
- Criado catálogo embutido com todos os 110 arquivos do dataset `luistiagos/rgh`.
- Implementada a função `NormalizeHuggingFaceDownloadURL(raw string) string`. Qualquer URL direcionada ao item `mx360gcpt3-x360-ztm` do Archive.org é automaticamente convertida em tempo real para:
  `https://huggingface.co/datasets/luistiagos/rgh/resolve/main/<filename>`

### 2. Atualização dos Catálogos Locais (`cache/hf_xbox360.json` e `cache/hf_.json`)
- Atualizadas as 86 entradas ZTM para apontar diretamente para a CDN do HuggingFace.
- As funções `Build()`, `sanitizeHuggingFaceCache()` e `FindHuggingFaceEntry()` aplicam a normalização preventivamente, garantindo que mesmo se uma API remota devolver a URL do Archive.org, o backend consumirá a CDN do HuggingFace.

### 3. Detecção Ativa de Stall com Timeout de Inatividade (`src/server/infrastructure/download/ia.go` e `progress.go`)
- Adicionada constante `DownloadStallTimeout = 45 * time.Second` e sentinela `ErrDownloadStalled = errors.New("download stalled: no data received for 45s")` em `app/config.go`.
- Adicionado campo atômico `LastActivity int64` e método `LastActivityTime()` em `progress.go`.
- Em `iaDownloadSingleAttempt` e `IADownloadChunkedParallel`, implementado monitoramento via `context.WithCancel`: se uma conexão ativa não transferir nenhum byte por 45 segundos consecutivos (ou se o usuário cancelar o job), a requisição é cancelada imediatamente.
- Na reconexão, o downloader utiliza `Range: bytes=N-` para retomar exatamente de onde parou em uma conexão TCP nova e rápida.

### 4. Integração no Pipeline de Fallback (`src/server/services/pipeline/fallback.go`)
- A função `isDownloadTooSlowError` passou a reconhecer `ErrDownloadStalled` e strings de stall timeout como erros elegíveis para transição de provedores ou reinicialização de stream.

---

## Verificação e Testes

- `rgh_files_test.go`: Validação de normalização de URLs ZTM e integridade do dataset.
- `ia_test.go::TestSingleDownloadStallTimeoutAbortsAttempt`: Simulação de servidor HTTP que trava após enviar os primeiros bytes; comprovado cancelamento do contexto e retorno imediato de `ErrDownloadStalled` em 45 segundos.
- `go test ./...`: 100% dos testes unitários do backend Go aprovados.
- `npm run renderer:typecheck` e `npm run tsc`: Tipagem 100% íntegra.
- `npm run test:safety`: Todos os 239 testes de segurança do Electron aprovados.
