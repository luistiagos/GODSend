# Bug (investigação): arquivo baixado corrompido é reaproveitado do cache a cada nova tentativa

- **Detectado em:** 2026-09-12 12:24 (telemetria de produção)
- **Origem:** telemetria `xbox-360-companion/pipeline` (`fallback.go::ProcessGameWithFallback`)
- **Errors (serviço):** 5774, 5798, 6002, 6086 (`Lego Batman 1`, 4 ocorrências entre 2026-09-11 01:48 e 2026-09-12 12:24); 6197 (`Incredible Hulk`, 2026-09-13)
- **Status:** fechado em 2026-09-16 (v2.12.94 + v2.12.97)
- **Classe:** fail — **investigação**: o defeito de código está confirmado; falta confirmar que foi ele que prendeu estes dois jogos
- **Versões:** `pipeline` não manda versão; o trecho citado está igual no código atual (v2.12.93)
- **Reincidência:** 4 execuções do mesmo jogo, erro idêntico

## Sintoma

A mensagem da telemetria esconde a causa — ela usa só `lastErr` (`fallback.go:230`), que
é o Minerva:

```
Download falhou em todas as fontes para Lego Batman 1 (xbox360): jogo nao encontrado no catalogo
```

A causa real está no log anexo, e é **a mesma nas quatro tentativas, em dois dias**:

```
huggingface: Extract failed: rardecode: bad file checksum
ia: IA search failed: not found in Internet Archive: Lego Batman 1
minerva: jogo nao encontrado no catalogo
```

(A fila mostra os três erros — `fallback.go:219` junta `providerErrors`. Só o título da
telemetria engana.)

## Causa raiz (defeito confirmado no código)

Uma vez que o arquivo foi baixado por inteiro, nada o invalida quando a extração prova que
ele está corrompido.

1. **O marcador de conclusão atesta o próprio arquivo, não a origem.** `markDownloadCompleted`
   (`infrastructure/download/ia.go:82`) grava `{URL, Size, SHA256}` com o SHA-256
   calculado **do arquivo em disco** ao fim do download. `reusableCompletedDownload`
   (`ia.go:44-58`) aceita o cache se URL, tamanho e esse hash baterem. Bytes errados que
   chegaram no download geram um hash que bate consigo mesmo para sempre.
2. **`DownloadWithProgress` devolve o cache sem baixar.** `ia.go:161-166`: se
   `reusableCompletedDownload`, loga `DOWNLOAD CACHE ... reutilizando arquivo completo` e
   retorna `nil`.
3. **No modo pendrive o arquivo sobrevive à falha.** `services/pipeline/huggingface.go:45-56`:
   em modo `local` o `archivePath` é `Ready/<jogo>/.source_hf<ext>` e o
   `defer os.Remove(archivePath)` só é registrado **fora** do modo local. `Ready/` não está em
   `scratchRoots`, então `cleanupGameScratch` no fim do fallback (`fallback.go:216`) também não
   o apaga.
4. **Nenhum caminho de erro de extração limpa arquivo ou marcador.** `Extract failed` volta
   direto em `huggingface.go:60-62`. O único `os.Remove(completedMarkerPath(...))` do
   repositório está em `ia.go:178`, e só roda quando o cache **não** foi reaproveitado.

Com 1–4, um RAR que chegou corrompido uma vez fica corrompido em todas as tentativas
seguintes, sem novo download, com o mesmo `rardecode: bad file checksum`. É exatamente o
padrão do `Lego Batman 1`.

## O que ainda não está provado

- **O modo do job.** A telemetria não diz se era `local`. Fora do modo local o `defer` apaga
  o arquivo e a tentativa seguinte baixaria de novo — nesse caso as 4 falhas iguais apontam
  para o **arquivo de origem** corrompido no catálogo, não para o cache.
- **Se a origem está boa.** Baixar `Lego Batman 1` do HuggingFace numa máquina limpa e testar
  o RAR decide entre as duas leituras. Se a origem estiver corrompida, a entrada do catálogo
  precisa sair/ser trocada — e o defeito acima continua existindo para outros jogos.
- Uma forma conhecida de corromper o arquivo no download é a concorrência de dois backends
  no mesmo `GODSEND_HOME`, descrita em
  [`electron-main-multiplas-instancias-sem-single-instance-lock`](electron-main-multiplas-instancias-sem-single-instance-lock_2026-09-15T14-44.md)
  (lá, o GTA 5 da mesma máquina deu `not a valid 7-zip file`). Não há como ligar estes dois
  jogos a uma máquina: o log não traz caminho.

## Como reproduzir o defeito de código

1. Modo pendrive. Enfileirar um jogo de HuggingFace pequeno em `.rar`.
2. Deixar o download terminar; antes da extração, sobrescrever alguns bytes do meio de
   `Ready/<jogo>/.source_hf.rar` **e** regravar o marcador com o SHA-256 novo (simula bytes
   errados vindos da rede).
3. Ver `Extract failed: rardecode: bad file checksum`. Tentar de novo: o log mostra
   `DOWNLOAD CACHE [<jogo>]: reutilizando arquivo completo` e a mesma falha, sem nenhum
   request HTTP.

## Próximos passos

1. Em erro de integridade na extração (`rardecode: bad file checksum`,
   `not a valid 7-zip file`, CRC do zip), apagar o arquivo **e** o marcador de conclusão
   antes de devolver o erro, para a próxima tentativa baixar de novo. Não fazer isso para
   disco cheio ou erro de I/O local — ali o arquivo está bom.
2. Limitar a uma rebaixada por job: se o arquivo novo falhar igual, a origem está ruim;
   dizer isso na mensagem em vez de repetir.
3. Baixar `Lego Batman 1` e `Incredible Hulk` do HuggingFace numa máquina limpa e testar os
   arquivos (ver "O que ainda não está provado").
4. Opcional: o título da telemetria (`fallback.go:230`) usar o primeiro erro que não seja
   "não encontrado no catálogo", para a próxima triagem não agrupar pela mensagem errada.

## Resolução

Fechado em duas etapas.

**v2.12.94** — criou `services/pipeline/archive_cache.go`:
`isArchiveIntegrityError()` reconhece o erro de integridade,
`invalidateDownloadedArchiveOnCorruptExtract()` apaga arquivo + marcador de conclusão +
checkpoint de resume (via `Download.InvalidateCompletedDownload`, em `ia.go`), e o marcador
`.corrupt-redownloaded` limita a uma rebaixada — atende aos passos 1 e 2. Ligado em
HuggingFace, IA genérico, IA digital e Redump/ISO.

**v2.12.97** — ligou os cinco pontos de extração que tinham ficado de fora, onde o defeito
continuava inteiro:

- `rom.go:86` — defeito idêntico ao descrito acima: em modo local o ZIP do EdgeEmu é
  `Ready/<jogo>/.source_rom.zip`, baixado por `DownloadWithProgress` e retido sem
  `defer os.Remove`. Um `zip: checksum error` voltava direto.
- `minerva.go` (XEX, ISO, genérico, digital) — cache **mais** fraco que o de HTTP:
  `DownloadViaTorrent` reaproveita `destDir/<arquivo>` só com `os.Stat` batendo o tamanho
  (`torrent.go:396`), e `cleanupTorrentScratchAfterRun` preserva o `torrentDir` em modo
  local enquanto o job não chega a `Ready`.

**Passo 4** (opcional, feito): o título do `telemetry.Report` em `fallback.go` usava
`lastErr`; passa a usar o primeiro erro que não é ausência de catálogo, com o nome do
provedor. Era ele que fazia esta triagem agrupar quatro falhas do HuggingFace sob a mensagem
do Minerva.

Verificado por `go build ./...`, `go vet`, a suíte completa do backend e
`TestExtractionErrorClassificationsDoNotOverlap`, que trava a invariante de que a correção
depende: as classificações de integridade e de armazenamento não podem se sobrepor em
nenhuma direção.

## Pendência

O **passo 3 continua aberto** e não é de código: ninguém baixou `Lego Batman 1` nem
`Incredible Hulk` do HuggingFace numa máquina limpa para testar o RAR. Enquanto isso não for
feito, não está provado que foi o cache que prendeu **estes dois jogos** — a leitura
alternativa (arquivo de origem corrompido no catálogo) segue de pé. A diferença agora é
observável: com a correção, uma origem ruim produz a mensagem *"arquivo baixado novamente
continua invalido. A origem pode estar corrompida no catalogo"* em vez de repetir a falha
idêntica sem rebaixar.
