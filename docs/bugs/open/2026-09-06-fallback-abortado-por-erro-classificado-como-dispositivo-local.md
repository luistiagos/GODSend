# Bug aberto: erro de rede/disco do PC e classificado como "falha no dispositivo local" e aborta o fallback

Data: 2026-09-06
Status: parcialmente corrigido na v2.12.73 — itens 1, 2, 4 e 5 fechados; 3, 6 e 7 seguem abertos
Area: pipeline de fallback, classificacao de erro local, telemetria
Commits: v2.12.73

## Estado por defeito

| # | Defeito | Estado |
|---|---|---|
| 1 | Classificacao culpa o destino, nao o sitio da falha | corrigido para as fases `download-*` (`ErrLocalStaging`) |
| 2 | Erro de rede vira hardware local e mata o fallback | corrigido (`isNetworkError`) |
| 3 | Assimetria: modo FTP segue na cadeia com disco cheio, modo local aborta | **aberto** |
| 8 | `extract-*` e `convert-god` tambem rodam no `TempDir` do PC mas ainda dizem "dispositivo local" | **aberto** — ver nota abaixo |
| 4 | Telemetria nao cobre este caminho | corrigido (`haltOnLocalStorageFailure`) |
| 5 | "O download concluido foi preservado" na fase de download | corrigido |
| 6 | `%v` achata o erro original e quebra `errors.Is` para sentinelas futuras | **aberto** (latente, nao morde hoje) |
| 7 | `archivePath` do modo local ignora o volume mais folgado | **aberto** — ver nota abaixo |

Sobre o item 7: mover o `archivePath` para `TempDir` **quebraria a retomada**. Os sufixos de
arquivo (`.rar`, `_hf.7z`, ...) estao em `suffixes` mas **nao** em `resumableStages`
(`workspace.go:82-99`), entao em `TempDir` o `cleanupGameScratch` apaga o arquivo entre
tentativas de provedor. E exatamente por isso que o modo local o coloca em
`ToolsDir/Ready/<nome>/`, fora dos `scratchRoots`. Corrigir isso exige acrescentar os
sufixos de arquivo a `resumableStages` ou dar ao `gameDir` um volume proprio — nao e a
troca de uma linha que parece ser.

Sobre o item 8: `outputRoot()` devolve `s.App.TempDir` incondicionalmente
(`workspace.go:18-20`), entao extracao e conversao GOD tambem falham no disco do PC — e a
conversao GOD e o passo que mais consome disco. Alargar o
`strings.HasPrefix(phase, "download-")` de `classifyLocalStorageFailure` nao basta sozinho:
`stage_checkpoint.go:287,296` constroem `ErrLocalDelivery` direto, sem passar pelo
classificador, entao um `os.MkdirAll` com disco cheio (via classify) e a falha identica
vinda de `action()` seguiriam caminhos diferentes.

Sobre a armadilha do item 2, que quase entrou: o filtro de rede tem de testar os **tipos
concretos** (`*net.OpError`, `*net.DNSError`, `*url.Error`), nunca a interface `net.Error`.
No Windows `syscall.Errno` declara `Timeout()`/`Temporary()`, entao um `*os.PathError` de
disco cheio tambem satisfaz `net.Error` — a versao por interface desligaria a classificacao
de armazenamento inteira. `TestIsNetworkErrorSeparatesDiskFromSocket` trava isso.

## Sintoma

Print do usuario, na fila:

```
Army of Two 2 The 40th Day   Erro
Falha no dispositivo local. O download concluido foi preservado para nova tentativa:
HuggingFace download failed: fa...
```

O texto cortado no print e o recorte da foto, nao truncamento da UI: `QueuePage.tsx:111`
ja renderiza mensagens de erro com `whitespace-pre-wrap break-words` desde 7170b4e. O `fa`
final e o comeco de `falha no dispositivo local`, o texto de `ErrLocalDelivery`.

## Caminho exato

1. Ordem padrao de provedores: `["huggingface", "ia", "minerva"]` (`handlers.go:153`).
   HuggingFace e o primeiro.
2. `huggingface.go:52` passa **todo** erro de download por
   `classifyLocalStorageFailure(xboxConn, "download-http", err)`.
3. `local_resilient.go:181` marca como `ErrLocalDelivery` quando duas coisas valem:
   `connection.Mode == "local"` **e** o texto do erro contem um dos ~30 fragmentos de
   `isLikelyLocalStorageError` / `isLikelyLocalDeviceError`.
4. `fallback.go:140-142` ve `ErrLocalDelivery`, escreve o status e **retorna**.

O `return` do passo 4 e o defeito central: ele descarta `ia` e `minerva` e sai **antes** do
`telemetry.Report` que 7170b4e adicionou no fim de `ProcessGameWithFallback`. O mesmo vale
para o gemeo em `fallback.go:172-175`.

## Por que o titulo do print importa

`cache/hf_xbox360.json` mapeia exatamente esse titulo para:

```
"hf_xbox360 army of two 2 the 40th day": {
  "collection_id": "5.22 GiB",
  "filename": "https://archive.org/download/mx360gcxpt1-x360-ztm/Army.of.Two.2.The.40th.Day.EUR.X360-ZTM.rar"
}
```

Ou seja: o catalogo "HuggingFace" e 80% archive.org (1345 links archive.org contra 343
huggingface.co). `validHuggingFaceDownloadURL` (`huggingface.go:131`) so valida esquema e
extensao, nunca o host. Consequencias:

- `isIA` em `ia.go:597` da **true**, entao o download usa o caminho chunked paralelo, nao o
  single-stream. A label "HuggingFace" na mensagem de erro aponta para a fonte errada.
- `IADownloadChunkedParallel` chama `ensureDownloadSpace(dest, 5.22 GiB)` logo na entrada.

## Causa mais provavel: disco cheio no drive do app

`ensureDownloadSpace` (`ia.go:123-144`) mede o volume de `dest` e falha com
`"espaco insuficiente no armazenamento temporario ..."` — e `espaco insuficiente` esta na
lista de fragmentos. Com `Mode == "local"`, isso vira `ErrLocalDelivery`.

E `dest`, em modo local, e o pior lugar possivel:

| modo | archivePath | volume |
|---|---|---|
| normal/FTP | `TempDir/<nome>_hf.rar` | volume fixo mais folgado (`bestFixedVolume`, `config.go:404-411`) |
| local (pendrive) | `gameDir/.source_hf.rar` = `ToolsDir/Ready/<nome>/` | **sempre o drive do executavel**, nunca realocado |

`huggingface.go:44-47` e `pipeline.go:179-183` fazem essa troca de caminho de forma
identica — o defeito e sistemico, nao especifico do HuggingFace. Note que `outputRoot()`
(`workspace.go:18`) devolve `TempDir`: a extracao e a conversao GOD vao para o volume
folgado, mas o download de varios GB que as alimenta nao vai. Um usuario com `C:` apertado
e `D:` grande fica protegido em modo FTP e quebra em modo pendrive.

## Causa alternativa: erro de socket lido como hardware local

O casamento e `strings.Contains` sobre a mensagem ja concatenada, sem nenhuma nocao de onde
a falha ocorreu. Fragmentos como `input/output error`, `i/o device error` e sobretudo
`network name is no longer available` (`local_resilient.go:118-133`) sao alcancaveis a
partir de um socket HTTPS no Windows: uma leitura TLS abortada aparece como
`wsarecv: The specified network name is no longer available.` (ERROR_NETNAME_DELETED), e
`iaDownloadSingleAttempt` a devolve como `request failed: %w` (`ia.go:647`). Uma queda de
conexao com o provedor passa entao a abortar a cadeia inteira — justamente a falha que
outro provedor resolveria.

Sem o log da maquina do usuario nao da para dizer qual dos dois fragmentos casou. Ambos
produzem o mesmo texto na tela e nenhum dos dois chega na telemetria.

## Defeitos a corrigir

1. **A classificacao usa o destino, nao o local da falha.** Na fase `download-http` nada
   tocou o pendrive ainda; o unico recurso local em jogo e o disco do PC. Mesmo assim o
   erro e reportado como "falha no dispositivo local" e tratado como defeito de destino,
   mandando o usuario conferir o hardware errado.
2. **Erro de rede vira hardware local** e mata o fallback (ver acima).
3. **Assimetria entre modos.** Em modo FTP o mesmo "disco cheio" nao e marcado, cai no
   `recordError` e a cadeia segue para `ia` e `minerva` — enchendo o mesmo disco mais duas
   vezes. So o modo local aborta. Nenhum dos dois comportamentos foi decidido de proposito.
4. **A telemetria nao cobre este caminho**, que e exatamente o que 7170b4e queria resolver.
   Por isso so existe uma foto de tela e nenhum log.
5. **Texto errado.** "O download concluido foi preservado" na fase `download-http`: nada
   concluiu. O arquivo parcial de fato sobrevive (nenhum cleanup roda nesse `return`, e
   `loadSingleResume` retoma depois), mas chamar isso de "concluido" faz a mensagem parecer
   uma falha posterior a um download bem-sucedido.
6. **Latente:** `classifyLocalStorageFailure` re-embrulha com `%v` (`local_resilient.go:185`),
   achatando o erro original em texto. Sentinelas abaixo dele deixam de ser detectaveis por
   `errors.Is`. Hoje nao morde — `ErrJobCancelled` ("tarefa cancelada pelo usuario") e
   `ErrDownloadTooSlow` ("download muito lento...") nao casam nenhum fragmento — mas e uma
   armadilha para qualquer sentinela futura.

## Direcao sugerida

- Restringir `classifyLocalStorageFailure` nas fases de download a erros que comprovadamente
  vieram do filesystem (`errors.Is(err, syscall.ENOSPC)`, `os.IsPermission`, ...) em vez de
  adivinhar pelo texto; ou passar o sitio da falha explicitamente.
- Checar as sentinelas de rede (`net.Error`, `*url.Error`) antes, e deixar erro de rede cair
  para o proximo provedor.
- Mover o `telemetry.Report` para que os `return` de `ErrLocalDelivery` tambem reportem.
- Usar `TempDir` (volume folgado) tambem para o `archivePath` do modo local, ou ao menos
  medir o espaco antes de fixar o caminho em `ToolsDir/Ready`.
- Corrigir o texto da mensagem para a fase de download.

## Reproducao

Modo local (pendrive), deixar no drive do executavel menos que 5.3 GB livres, e enfileirar
"Army of Two 2 The 40th Day" com a ordem padrao de provedores. Esperado: cair para `ia` e
`minerva`. Observado: a fila para no primeiro provedor com "Falha no dispositivo local".
