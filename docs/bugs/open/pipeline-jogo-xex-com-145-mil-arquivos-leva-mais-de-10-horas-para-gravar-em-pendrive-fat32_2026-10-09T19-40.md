# Bug: jogo XEX com 145 mil arquivos (EA FC 26 Legacy Edition) leva mais de 10 horas para gravar num pendrive FAT32; proposta: converter para GOD no PC antes de gravar

- **Detectado em:** 2026-10-09 ~19:20 (horario local), em teste do dono na maquina de desenvolvimento
- **Origem:** log `%APPDATA%\xbox-360-companion-electron\logs\godsend-server-2026-10-09.log`, contadores de disco do Windows durante a copia, mtime dos arquivos ja gravados no pendrive, leitura de `src/server/services/pipeline/local_resilient.go` e `src/server/utils/iso2god.go`
- **Classe:** desempenho / gravacao local
- **Severidade:** **P1 - Alto**: o dono considera o tempo inviavel para cliente. A copia comecou 17:40 e as 19:24 estava em 34% (25271/144851 arquivos); projecao de 10 a 16 horas no total
- **Complexidade:** a definir — a rota GOD foi descartada para este jogo (secao "Prova manual do passo 1");
  a alternativa que sobra (gravacao FAT32 mais barata por arquivo) ainda nao foi medida
- **Estado:** prova manual (passo 1) executada em 2026-10-09 ~20:20: **este jogo nao cabe no formato
  XDVDFS/GDFX**, entao nao existe GOD dele que o console leia inteiro. Nada gravado no pendrive, nada
  implementado. Proximo passo na secao "Proxima sessao" (revisada). 2026-10-09 ~21:05: novo passo 1
  analisado e instrumento de medicao pronto; medicao aguardando pendrive de teste (secao "Passo 1")

## Sintoma

Tela do app: `Gravando e verificando... 34% (25271/144851)` depois de horas. O percentual e de
**bytes** (34% de 12,25 GB) e o contador e de **arquivos** (`local_resilient.go::copyTreeLocal`,
`updateProgress`, linha ~627).

## Evidencia (2026-10-09)

- Jogo: `Temp\EA FC 26 Legacy Edition_hf_ext\EA FC 26 Legacy Edition` = **144.851 arquivos, 12,25 GB**.
  Por tamanho: 13.468 < 4 KB, 75.716 < 32 KB, 54.932 < 1 MB, 735 >= 1 MB (5,42 GB).
  Maiores pastas: `data\ui\imgAssets\heads` 36.019 (175 MB), `data\sceneassets\hair` 13.831,
  `faces` 13.147, `sceneassets\heads` 11.542, `hairlod` 7.097, `ui\imgAssets\kits` 7.090, `kit` 7.074.
  Nenhum arquivo >= 4 GB.
- Destino: `E:` FAT32, cluster 8 KB, 15,5 GB, modelo `USB DISK 2.0 USB Device` (pendrive generico USB 2.0).
- Log: `20:40:31Z LOCAL XEX: 144851 arquivos (12.25 GB)`; `21:01:44Z pasta FAT32 ...\data\sceneassets\faces
  esgotou as entradas com espacos fragmentados; regravando a pasta a partir do arquivo 7841/144851`
  (a recuperacao `rebuildSaturatedFATFolder` funcionou; nenhum erro ou retentativa depois).
- Medido em 124 s (`Win32_Process.WriteTransferCount` + `Win32_PerfRawData_PerfDisk_LogicalDisk`):
  **+299 arquivos, 358 KB/s de dados uteis, 39,5 escritas/s no disco, 427 KB/s no disco**.
  Em outra amostra: ~100 escritas/s, disco 96% ocupado (`PercentIdleTime` 3-6%), so 36 arquivos/min.
  godsend usa ~5% de CPU; MsMpEng 0. **O gargalo e o pendrive**, nao o programa.
- Vazao por mtime (lotes de 10 min): arquivos de ~1 MB a **3,3 MB/s** (1957 MB/10 min, de manha);
  arquivos de 60-150 KB a 0,1-0,65 MB/s. Cada arquivo custa ~16 escritas pequenas (FAT x2,
  entrada no `.xbox-downloader/copy-staging`, rename para a pasta final, `out.Sync()` por arquivo);
  `app.CopyBufferSize` = 4 MB, entao o dado em si e 1 escrita.

## Causa raiz

Formato XEX = arvore de arquivos soltos. Em pendrive barato FAT32 o custo e por arquivo
(metadados gravados de forma sincrona em posicoes espalhadas), nao por byte. 145 mil arquivos x
~16 escritas / 40-100 IOPS = horas, independentemente do codigo. Otimizar o pipeline (gravar
direto no nome final, `Sync` em lote) reduz, mas nao muda a ordem de grandeza.

## Hipoteses descartadas

- **Programa travado / laco de retentativa:** descartado — sem `erro transitorio` no log, contagem
  sobe, CPU baixa.
- **Antivirus:** descartado — MsMpEng 0 s de CPU no intervalo.
- **Outro processo escrevendo no E::** descartado — escrita do godsend ~= escrita do disco.
- **Falta de espaco:** 10,16 GB livres com 4,2 GB ja gravados; cabe.
- **Converter para GOD resolve este jogo:** descartado em 2026-10-09 — 4 pastas passam do limite de
  262.140 bytes de tabela de diretorio do XDVDFS/GDFX e 46.319 arquivos ficariam inalcancaveis no console
  (secao "Prova manual do passo 1").

## Correcao proposta: converter XEX -> GOD no PC e gravar so o GOD — DESCARTADA para este jogo

> 2026-10-09: a prova do passo 1 mostrou que este jogo nao pode virar GOD (secao "Prova manual do passo 1").
> O texto abaixo fica como registro e so vale para jogos cujas pastas cabem no formato.

GOD = cabecalho + ~76 blocos grandes (`Data0000`...). Gravacao sequencial a ~3,3 MB/s (medido
neste pendrive) = **~1 h para 12,3 GB**, contra 10+ h; e elimina os limites de pasta do FAT32.

O que existe: `utils/iso2god.go::RunIso2GodNative(isoPath, outDir, resolveDisplayTitle)` converte
**ISO** em GOD; `pipeline.go::finalizeGOD` instala um GOD. Ha so **leitores** de XDVDFS
(`readXDVDFSVolDesc`, `xdvdfsExtractRecursive`...). **Nao existe** construtor de imagem XDVDFS a
partir de pasta — e o que falta (ou gerar o GOD direto da pasta, sem ISO intermediaria).

Riscos que a prova precisa responder:
0. **O jogo cabe no formato XDVDFS/GDFX?** (risco que faltava) — **nao**, ver a secao abaixo.
1. O mod (default.xex modificado) roda como GOD em **RGH** e em **BadUpdate** (o pendrive de teste tem `BadUpdatePayload`)?
2. GOD de **12,25 GB** (maior que um disco XGD2/XGD3) e aceito pelo Aurora/dashboard?
3. O mod nao escreve na propria pasta do jogo (GOD e somente leitura)?

## Prova manual do passo 1 (2026-10-09 ~20:10-20:20): a rota GOD nao serve para este jogo

**Resultado:** o formato de disco do Xbox 360 (XDVDFS/GDFX, o mesmo que vai dentro do GOD) nao consegue
representar 4 pastas deste jogo. Qualquer ISO ou GOD gerado dele tem **46.319 arquivos (32% do jogo) que o
console nao enxerga**. Nada foi gravado no pendrive; a copia XEX em andamento (processo `godsend-windows-x64`
PID 59024, destino `E:`) nao foi tocada.

### Por que: limite do formato, conferido na fonte

Cada pasta e uma tabela de entradas organizada como arvore binaria, e os ponteiros esquerda/direita sao
**u16 contados em DWORDs**: nenhuma entrada pode comecar depois do byte 0xFFFF x 4 = **262.140** da tabela.
- Xenia `src/xenia/vfs/devices/disc_image_device.cc:125-137` (master): `ReadEntry(..., uint16_t entry_ordinal, ...)`,
  `p = buffer + (entry_ordinal * 4)`, segue `node_l`/`node_r` (u16) a partir do ordinal 0.
- extract-xiso `extract-xiso.c:1854-1855` (master): `l_offset = (uint16_t)(... offset / XISO_DWORD_SIZE ...)` —
  **trunca em silencio, sem nenhuma checagem de tamanho**; a listagem `-l` segue a arvore (`:1275`, `:1356`).
- Nosso `utils/iso2god.go::readXDVDFSDirTable`/`parseDirSector` (301-351) le a tabela **em sequencia**, sem
  usar a arvore: enxerga tudo, entao **nao detecta** o estouro e geraria um GOD quebrado sem erro.

### Medicoes

1. Tamanho da tabela de cada pasta (empacotamento do extract-xiso), sobre
   `Temp\EA FC 26 Legacy Edition_hf_ext\EA FC 26 Legacy Edition` (658 pastas, 144.851 arquivos):
   **4 pastas estouram**, somando 74.539 entradas.

   | pasta | entradas | inicio da ultima entrada (limite 262.140) |
   |---|---|---|
   | `data\ui\imgAssets\heads` | 36.019 | 997.592 |
   | `data\sceneassets\faces` | 13.147 | 719.560 |
   | `data\sceneassets\hair` | 13.831 | 527.300 |
   | `data\sceneassets\heads` | 11.542 | 406.268 |
   | `data\sceneassets\hairlod` (a maior que cabe) | 7.097 | 258.276 |

   O calculo bate com as ISOs reais: tabela raiz da `heads.iso` = 997.616 bytes e da `hairlod.iso` = 258.308,
   iguais ao previsto; nas outras quatro a diferenca e de ate 0,3% (a ordem das entradas do extract-xiso muda o
   preenchimento de fim de setor), sem mudar nenhum veredito.

2. ISO real de cada pasta (`extract-xiso -c <pasta> <nome>.iso`, release build-202609111233 Win64), lida de
   volta seguindo a arvore como o Xenia (ordinal 0, u16 x 4) e comparada com a lista da pasta de origem:

   | pasta | origem | alcancaveis pela arvore | **inalcancaveis** | leitor linear (nosso Go) | `extract-xiso -l` |
   |---|---|---|---|---|---|
   | `ui\imgAssets\heads` | 36.019 | 9.344 | **26.675** | 36.019 | **laco infinito** (8.075.056 linhas em 120 s, morto por timeout) |
   | `sceneassets\faces` | 13.147 | 4.992 (+5 nomes lixo) | **8.155** | 13.147 | nao rodado |
   | `sceneassets\hair` | 13.831 | 6.851 (+30 lixo) | **6.980** | 13.831 | nao rodado |
   | `sceneassets\heads` | 11.542 | 7.033 (+35 lixo) | **4.509** | 11.542 | nao rodado |
   | `sceneassets\kit` (controle) | 7.074 | 7.074 | 0 | 7.074 | 7.074 |
   | `sceneassets\hairlod` (controle no limite) | 7.097 | 7.097 | 0 | 7.097 | 7.097 |

   "Nomes lixo" sao entradas lidas em offsets truncados que caem no meio de outra entrada: alem de sumir
   arquivo, o console pode abrir o arquivo errado. O `extract-xiso -c` termina com `rc=0` e
   `sucessfully created heads.iso (36019 files ...)` — nenhuma ferramenta avisa.

### O que nao foi feito, e por que

ISO de 12,25 GB do jogo inteiro, `RunIso2GodNative`, gravacao no pendrive e teste em RGH/BadUpdate: a imagem
sai quebrada por construcao, entao o teste no console so mediria o defeito acima. Custaria ~1 h de gravacao e
apagar a copia XEX parcial do `E:` (8,75 GB livres as 20:07, contra ~12,3 GB do GOD). Os riscos 1-3 continuam
sem resposta, mas so importam para jogos que cabem no formato.

### Achado lateral (registro proprio)

O leitor XDVDFS do projeto para no primeiro arquivo vazio de cada setor. A raiz deste jogo tem `patch.bh` e
`patch.big` com 0 byte, e uma ISO dela vira pasta XEX com 41 de 49 entradas, sem erro. Ver
[backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio-...](backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio-e-extrai-iso-incompleta-sem-erro_2026-10-09T20-20.md).

### Como repetir

Os scripts da prova ficaram so no scratchpad da sessao; a regra cabe aqui:
- Tabela de uma pasta: para cada nome, em ordem `str.upper`, `sz = (14 + len(nome) + 3) & ~3`; se
  `off % 2048 + sz > 2048`, `off` pula para o proximo setor; a entrada comeca em `off`, depois `off += sz`.
  Estoura se o inicio da ultima entrada passa de 262.140.
- Leitura pela arvore: tabela da raiz no setor/tamanho dos bytes 20-27 do setor 32 da ISO; visitar a partir do
  ordinal 0, entrada em `ordinal*4`, `left`/`right` u16 nos bytes 0-3; comparar os nomes visitados com a
  listagem da pasta de origem.

## Passo 1 — analise do codigo e bloqueio da medicao (2026-10-09 ~20:45)

### Simbolos abertos (inteiros)

- `local_resilient.go::copyTreeLocal` (551-730): por arquivo, chama `localFileMatches(dst)` e depois
  `copyLocalEntryFunc`. Na retomada, todo arquivo que ja existe no destino com o tamanho certo e
  **re-hasheado** (origem e destino, SHA-256) — a cada retomada, ~4 GB lidos do pendrive neste jogo. No fim,
  `helpers.FlushVolumeBuffers(root)` e a remocao de `.xbox-companion-installing`.
- `local_resilient.go::copyLocalEntry` (408-503), sequencia por arquivo novo: `Remove(dst+".xbox-companion-part")`,
  `Stat`/`Remove` do staging, 2x `MkdirAll`, `OpenFile(staging, O_TRUNC)`, copia com buffer de 4 MB (hash junto),
  **`out.Sync()`**, `Close`, `Stat(staging)` (confere tamanho), `Remove(dst)`, `Rename(staging, dst)` (ate 5x).
  Em erro: apaga o staging e devolve o erro; `copyTreeLocal` decide (FAT cheio -> `rebuildSaturatedFATFolder`;
  dispositivo trocado -> espera; 3 retentativas).
- `helpers/freespace_windows.go::FlushVolumeBuffers` (71-107): abre `\\.\E:` com GENERIC_READ|WRITE; **se falhar
  (sem admin) devolve `nil` sem flushar**. O app roda sem admin (conferido nesta maquina:
  `IsInRole(Administrator)` = False), entao o flush de volume do fim da copia nao acontece; o que garante a
  gravacao e o `out.Sync()` e o fechamento de cada arquivo (proximo item).
- Politica de remocao do pendrive: nao ha `Classpnp\UserRemovalPolicy` em
  `HKLM\SYSTEM\CurrentControlSet\Enum\USBSTOR\*` -> padrao do Windows, **remocao rapida**.
- **fastfat em remocao rapida** (lido pela sessao `retrobatnew-e4` na amostra do WDK, Windows-driver-samples
  `filesys/fastfat`, branch main — **nao** e o `fastfat.sys` instalado, e eu nao reli): `strucsup.c::FatInitializeVcb`
  liga `VCB_STATE_FLAG_DEFERRED_FLUSH` em midia hotplug sem `WriteCacheEnableOverride`;
  `cleanup.c::FatCommonCleanup`, com essa flag, ja descarrega o arquivo modificado **no fechamento** (e a FAT e a
  pasta-pai se `FCB_STATE_FLUSH_FAT`); `flush.c::FatCommonFlushBuffers` (o `out.Sync()`) faz o mesmo e ainda repassa
  `IRP_MJ_FLUSH_BUFFERS` ao dispositivo. Consequencias: (a) tirar so o `Sync` tende a ganhar pouco — o corte maior
  provavel e o staging (criar e apagar uma entrada em outra pasta por arquivo); (b) em remocao rapida o `Close` ja
  garante a gravacao, entao tirar o `Sync` nao deixa a copia sem garantia — so em "melhor desempenho"
  (`WriteCacheEnableOverride=1`) o `Close` nao descarrega. **So a medicao decide** — por isso o instrumento abaixo
  mede as variantes lado a lado, sem rebuild.

### Hipotese de ganho, a confirmar na medicao

O que sobra para cortar por arquivo, alem do `Sync`: a entrada criada no staging e apagada no rename (gravar
direto no nome final elimina as duas). Gravar direto no destino nao volta a fragmentar a pasta (o problema da
2.12.110 era o **nome temporario ao lado** do destino, com outro numero de entradas); o temporario em staging
existe para a retomada e para o `default.xex` nao aparecer truncado — com o marcador
`.xbox-companion-installing` e `orderEntryPointsLast`, so o ultimo arquivo (`default.xex`) precisa de staging.

### Por que a medicao nao rodou

As 20:40:44 o app do dono (godsend PID 34696) retomou a copia `LOCAL XEX: 144851 arquivos -> E:\Games\EA FC 26
Legacy Edition - 454109F4`. O `E:` e o unico removivel conectado (`Win32_DiskDrive`: `USB DISK 2.0 USB Device`)
e esta ocupado; medir nele agora distorce as duas medicoes e mexe no pendrive do dono sem autorizacao.

**Rechecado em 2026-10-09 21:09 (horario local) — continua bloqueado:** `Win32_DiskDrive` ainda lista so
`USB DISK 2.0 USB Device` como removivel (`E:` FAT32 `BADAVATAR`, 7,51 GB livres); godsend PID 34696 vivo e
gravando (`WriteTransferCount` +7,4 MB e `DiskWritesPerSec` do `E:` +538 em 10 s). Destino com **38.009
arquivos / 6,53 GB** de 144.851; pelas taxas da "Evidencia" (36-150 arq/min) faltam ~12-50 h. Medicao nao
rodada; `E:` nao tocado.

### Instrumento pronto

`src/server/services/pipeline/local_copy_bench_test.go` (`TestFAT32LocalCopyBench`): copia os primeiros N arquivos
de uma pasta de origem para um volume FAT32 com 4 variantes — `atual` (o `copyLocalEntry` real; depois da mudanca,
mede o codigo novo), `sem-sync`, `direto` (nome final, sem staging, sem Sync) e `direto-sync` — e imprime por
variante: tempo, arquivos/min, MB/s, escritas no disco e escritas por arquivo (contador
`Win32_PerfRawData_PerfDisk_LogicalDisk.DiskWritesPerSec` antes/depois). O tempo inclui a **drenagem**: depois do
ultimo arquivo espera o contador ficar parado por 3 s, para a variante sem `Sync` nao ganhar empurrando escrita
para depois do cronometro. Comando (pendrive de teste em `F:`, sem a copia do dono rodando no mesmo dispositivo):

```powershell
cd src/server
$env:GODSEND_FAT32_TEST_DIR='F:\'
$env:GODSEND_BENCH_SRC='C:\projects\Downloader-XBOX360-XEX-HDD-Games\Temp\EA FC 26 Legacy Edition_hf_ext\EA FC 26 Legacy Edition\data\sceneassets\kit'
$env:GODSEND_BENCH_MAX_FILES='1000'
go test ./services/pipeline/ -run TestFAT32LocalCopyBench -v -timeout 6h
```

Os 1.000 primeiros arquivos de `kit` somam 129 MB (~130 KB cada): pelas taxas da "Evidencia" (36-150 arq/min),
7-28 min por variante. `GODSEND_BENCH_VARIANTS=atual,direto` escolhe e ordena as variantes;
`GODSEND_BENCH_DRAIN_MAX` limita a drenagem (padrao 5m).

Validacao do instrumento (2026-10-09 ~21:05, **so prova que roda**): `GODSEND_BENCH_ALLOW_NONFAT=1`, destino
`%TEMP%` (SSD NTFS do sistema), 50 arquivos, `GODSEND_BENCH_DRAIN_MAX=4s`: as 4 variantes completam, a pasta de
teste e apagada, `PASS` em 39,5 s. Os numeros dessa execucao **nao valem** (o disco do sistema nunca fica parado,
entao as escritas contadas incluem as do Windows). Sem as variaveis o teste fica em `SKIP`; `go vet` limpo.

### Reforco da prova GOD (sessao `retrobatnew-e4`)

Limite que nao depende da ordem das entradas nem do empacotador: soma dos tamanhos das entradas
(`(14 + nome + 3) & ~3`) menos a maior, sem padding de setor — `imgAssets\heads` >= 995.468,
`sceneassets\faces` >= 710.208, `hair` >= 520.856, `sceneassets\heads` >= 405.244, contra o limite de 262.140
(`hairlod` 255.028 e `kit` 225.632 cabem). Nenhum gerador de ISO/GOD representa essas 4 pastas, nao so o
extract-xiso.

## Proxima sessao (revisada em 2026-10-09, depois da prova)

O antigo passo 1 (prova manual) foi feito e derrubou a rota GOD para este jogo; o antigo passo 3 vira o
principal.

1. **Gravacao XEX mais barata por arquivo:** em `local_resilient.go::copyLocalEntry`, gravar direto no
   destino e trocar o `out.Sync()` por arquivo por flush em lote. **Estado (2026-10-09 ~21:05):** funcoes
   abertas e instrumento pronto (secao "Passo 1"); **falta so rodar a medicao**, bloqueada por hardware: plugar
   um pendrive de teste (ou o dono autorizar o `E:` depois que a copia dele terminar) e rodar o comando da secao
   "Instrumento pronto". Com os numeros: escolher a variante e so entao editar `copyLocalEntry` (manter staging
   para o `default.xex`, ver "Hipotese de ganho"); a linha `atual`, rodada de novo, mede o codigo novo.
2. **Medir o dispositivo, sem codigo:** o mesmo lote num pendrive USB 3.0 de marca e num HD externo. Se a
   ordem de grandeza mudar, orientar o cliente ("use pendrive USB 3.0 ou HD") pode resolver o caso extremo;
   decisao do dono.
3. **GOD para outros jogos com muitos arquivos (opcional, decisao do dono):** pre-requisitos — (a) corrigir o
   achado lateral do leitor XDVDFS; (b) checar o limite de 262.140 bytes por pasta **antes** de converter e
   cair para XEX quando estourar; (c) so entao a prova no console dos riscos 1-3.

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** bloqueado — a unica correcao que sobra (gravacao XEX mais barata por arquivo em
`copyLocalEntry`) so se escolhe e so se prova medindo num pendrive FAT32 real, e nenhum disco real esta
liberado para o pipeline (manual, secao Teste: decisao do dono de 2026-10-09).
**Complexidade:** alta — pipeline de gravacao (`src/server/services/pipeline/`), criterio do `docs/bugs/open/README.md`.
**Severidade:** medio — atinge so um subconjunto (jogo XEX com ~100 mil+ arquivos em pendrive lento); o jogo
acaba gravado, so que em horas. O doc marca P1 pelo juizo do dono sobre o caso EA FC 26; pela escala do pipeline
(fluxo principal inutilizavel sem contorno = alto) nao e alto: outros jogos gravam normalmente.
**Arquivos a alterar (reserva da onda):** nenhum agora (bloqueado). Quando destravar:
- `src/server/services/pipeline/local_resilient.go` — `copyLocalEntry` (variante escolhida pela medicao).
- `src/server/services/pipeline/local_resilient_test.go` — testes da variante (retomada, `default.xex` em staging).

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

Confirmada na fonte da lane (`d7bd9ad`), sem mudanca desde a analise de 2026-10-09:
- `local_resilient.go::copyLocalEntry` (408-503) — por arquivo novo: `Remove(dst+".xbox-companion-part")`,
  `Stat`/`Remove` do staging (`localStagingPath` = `.xbox-downloader/copy-staging/<CRC32>.TMP`), 2x `MkdirAll`,
  `OpenFile(O_TRUNC)`, copia com buffer `app.CopyBufferSize`, `out.Sync()` (449), `Close`, `Stat` de conferencia,
  ate 5x `Remove(dst)`+`Rename(staging, dst)`. Em erro: apaga o staging e devolve o erro (nao engole).
- `local_resilient.go::copyTreeLocal` (551-730) — por arquivo, `localFileMatches(dst)` (so `Stat` quando o destino
  nao existe; re-hash SHA-256 de origem e destino quando existe com o tamanho certo, i.e. na retomada) e depois
  `copyLocalEntryFunc`. Erro de pasta FAT cheia -> `rebuildSaturatedFATFolder` uma vez por pasta; dispositivo
  trocado -> `waitForLocalDevice`; senao 3 retentativas e erro. No fim `helpers.FlushVolumeBuffers` (no-op sem
  admin) e remove `.xbox-companion-installing`.
- A ordem de grandeza vem do dispositivo (40-100 IOPS de metadado sincrono num pendrive USB 2.0), nao do codigo:
  145 mil arquivos x ~16 escritas. Cortar staging/`Sync` reduz escritas por arquivo, mas o ganho real e
  desconhecido — o fastfat em remocao rapida ja descarrega no `Close` (secao "Passo 1"), entao a variante pode
  ganhar de ~0% a ~50%; nenhuma corta para minutos.

### Provas (comando literal -> resultado)

- `Get-CimInstance Win32_DiskDrive | Select Model,InterfaceType,MediaType` (2026-10-10 ~22:50) -> unico removivel
  continua `USB DISK 2.0 USB Device`; `Get-Volume` -> `E:` FAT32 `BADAVATAR`, 3,0 GB livres. E o pendrive do dono,
  com a copia dele: `E:\Games\EA FC 26 Legacy Edition - 454109F4` existe sem `default.xex` (copia nao terminou;
  `default.xex` e gravado por ultimo). Nenhum `godsend*` rodando. Nao ha pendrive de teste.
- `grep -n "Getenv\|func Test" src/server/services/pipeline/local_copy_bench_test.go` -> o instrumento
  `TestFAT32LocalCopyBench` (commit `f2fdc2f`) le `GODSEND_FAT32_TEST_DIR`, `GODSEND_BENCH_SRC`,
  `GODSEND_BENCH_MAX_FILES`, `GODSEND_BENCH_VARIANTS`, `GODSEND_BENCH_DRAIN_MAX`, `GODSEND_BENCH_ALLOW_NONFAT`;
  sem as duas primeiras fica em `SKIP`. A origem da medicao
  (`Temp\EA FC 26 Legacy Edition_hf_ext\...\data\sceneassets\kit`) ainda existe na arvore principal.

### Hipoteses descartadas (e por que)

- **Corrigir sem medir (gravar direto + tirar `Sync` agora):** descartado. O ganho nao tem prova e o codigo e o
  de maior risco do app (gravacao no pendrive do cliente: retomada, `default.xex` truncado, fragmentacao FAT que a
  2.12.110 resolveu). Trocar a garantia por ganho desconhecido e especulativo; a propria analise diz "so a
  medicao decide".
- **Provar o fix numa pasta local (NTFS/SSD):** nao serve como prova do sintoma — o custo e de metadado sincrono
  em FAT32 USB lento; num SSD a copia ja e rapida com ou sem o fix. Os testes de unidade provam so a
  corretude, nao o ganho.
- **Usar o `E:` do dono:** proibido (manual: nenhum disco real liberado) e ocupado pela copia parcial dele.
- **Rota GOD:** descartada na prova de 2026-10-09 (4 pastas estouram 262.140 bytes da tabela XDVDFS).

### Tarefas (para quando destravar)

- [ ] Medicao (dono, com pendrive de teste em `F:`): comando da secao "Instrumento pronto" — escolhe a variante
  (`atual`, `sem-sync`, `direto`, `direto-sync`) pelo `arquivos/min` com drenagem.
- [ ] `local_resilient.go::copyLocalEntry` — aplicar a variante vencedora para todo arquivo menos os pontos de
  entrada (`orderEntryPointsLast`: `default.xex`, cabecalho GOD), que continuam em staging; manter o marcador
  `.xbox-companion-installing` — teste: `local_resilient_test.go` (retomada com arquivo parcial no nome final e
  re-hash, `default.xex` nunca aparece truncado) + `TestFAT32LocalCopyBench` linha `atual` de novo no pendrive.
- [ ] So se a variante vencedora nao mudar a ordem de grandeza: decisao do dono sobre orientar o cliente
  (pendrive USB 3.0 / HD) — `sem-codigo`.

### Plano de teste

- **Offline (sem slot):** `go test ./services/pipeline/ -run 'Local|FAT' -count=1` (corretude da variante em pasta
  temporaria); `TestFAT32LocalCopyBench` com `GODSEND_BENCH_ALLOW_NONFAT=1` so prova que o instrumento roda.
- **T2 reproducao como o usuario (E2E, no slot):** exige pendrive FAT32 real — Home/Catalogo -> baixar um jogo XEX
  com dezenas de milhares de arquivos (EA FC 26 Legacy Edition) com destino o pendrive; sinal: `Gravando e
  verificando... N% (i/144851)` na Home e arquivos/min pelo mtime no destino. Sem disco liberado, vai inteiro
  para "falta para close". Destino local (pasta) nao reproduz o sintoma.
- **Controle positivo:** o mesmo lote com a linha `atual` do instrumento no codigo de hoje (36-150 arquivos/min
  medidos em 2026-10-09 neste pendrive).
- **T3 regressao direcionada:** gravacao local de jogo XEX pequeno e de GOD (retomada apos cancelar no meio,
  pasta FAT32 grande que antes fragmentava — `local_resilient_fat32_test.go` com `GODSEND_FAT32_TEST_DIR`), e
  `go test -count=1 ./...` em `src/server`.

### Sessoes seguintes

- dev: effort high, ultrathink sim — garantia de gravacao/retomada no pendrive do cliente com varios caminhos de erro.
- teste: effort medium, ultrathink nao — a medicao e mecanica; o que pesa e nao tocar disco sem autorizacao.

**O que destrava:** um pendrive FAT32 de teste liberado pelo dono (ou o `E:` depois que a copia dele terminar e
ele autorizar), e a rodada do instrumento — ~7-28 min por variante com 1.000 arquivos de `kit`.

## Desbloqueio (2026-10-12)

O motivo do veredito `bloqueado` acima ("nenhum disco real liberado") **caiu**: o dono liberou o pendrive de
teste `USB DISK 2.0`, serial `247700023090` (14,5 GB, MBR, hoje FAT32 com rotulo `PS2`), com conteudo
descartavel — pode formatar e gravar. Regra, identificacao pelo serial e lock entre projetos: manual do pipeline
(`.claude/skills/pipeline-correcao-bugs/projeto.md`, secao Teste). A proxima execucao do pipeline deve replanejar
este bug, nao exclui-lo pelo veredito antigo.

- A medicao das variantes de `copyLocalEntry` (~7-28 min por variante com 1.000 arquivos de `kit`) pode rodar
  agora nesse pendrive; a escolha da correcao continua dependendo dela.

## Planejamento (pipeline 20261012-0329, 2026-10-12)

**Veredito:** corrigir — gravar direto no nome final todo arquivo que nao e ponto de entrada (sem staging nem
rename), mantendo `Sync` por arquivo; a medicao que antes bloqueava passa a ser o criterio de aprovacao da sessao
de teste, que tem o slot e o pendrive de teste.
**Complexidade:** alta — pipeline de gravacao (`src/server/services/pipeline/`), criterio do `docs/bugs/open/README.md`.
**Severidade:** medio — so um subconjunto (jogo com dezenas de milhares de arquivos em pendrive lento); o jogo
acaba gravado, em horas. Mesmo juizo do planejamento de 2026-10-10.
**Arquivos a alterar (reserva da onda):**
- `src/server/services/pipeline/local_resilient.go` — `localCopyEntry` (campo novo), `copyLocalEntry` (caminho
  direto), `orderEntryPointsLast`/`copyTreeLocal` (marcam quem vai direto).
- `src/server/services/pipeline/local_resilient_test.go` — testes do caminho direto (retomada, erro no meio).
- `src/server/services/pipeline/local_install_marker_test.go` — ponto de entrada continua em staging, o resto direto.
- `src/server/services/pipeline/local_resilient_fat32_test.go` — `TestFAT32CopyTreeLocalFitsLargeDirectory` le a
  pasta de staging, que deixa de existir quando nenhum arquivo passa por ela.
- `src/server/services/pipeline/local_copy_bench_test.go` — variante `staging` (caminho antigo) ao lado de `atual`.

### Por que corrigir agora, sem a medicao previa

O planejamento de 2026-10-10 descartou "corrigir sem medir" porque trocaria garantia por ganho desconhecido. Este
plano nao troca garantia: escolhe `direto-sync` (mantem `out.Sync()`, `Close`, conferencia de tamanho e o SHA-256
na retomada) e so tira a ida e volta pela staging — criar a entrada em `.xbox-downloader/copy-staging`, apagar o
destino e renomear entre pastas. Os pontos de entrada (`default.xex`, cabecalho GOD) e `copyFileLocal` continuam
no caminho antigo, entao o console nunca ve `default.xex` truncado. A medicao continua decidindo, mas como prova:
o planner nao pode usar o pendrive (ele e do slot de teste) e o dev tambem nao; quem mede e a sessao de teste, com
o caminho antigo e o novo no mesmo binario (variante `staging` x `atual` do bench, mesmo volume, mesma hora). Se o
ganho nao vier, a reprovacao traz os numeros das variantes, que e o que o bloqueio esperava.

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

Reconferido na lane em `c4874fa` (linhas atuais):
- `local_resilient.go::localCopyEntry` (54-59) — `sourcePath`, `relativePath`, `size`, `sha256`; nada diz se o
  arquivo e ponto de entrada.
- `local_resilient.go::copyLocalEntry` (408-503) — sempre: `Remove(dst+legacy)`, `Stat` da staging (promove se
  integra), `Remove(staging)`, limite 4 GB, 2x `MkdirAll`, `OpenFile(staging, O_TRUNC)`, copia + SHA-256, `Sync`,
  `Close`, `Stat` (tamanho), ate 5x `Remove(dst)`+`Rename(staging, dst)`. Em erro: apaga a staging e devolve o
  erro (o chamador classifica). A pasta do jogo recebe a mesma entrada final de qualquer jeito; o extra por arquivo
  e a entrada criada e apagada na staging, o `Remove(dst)` e o rename entre pastas (FAT e duas pastas tocadas).
- `local_resilient.go::copyTreeLocal` (554-747) — chama `copyLocalEntryFunc` por arquivo depois de
  `localFileMatches(dst)` (re-hash de origem e destino quando o destino tem o tamanho certo); erro de pasta FAT
  cheia -> `rebuildSaturatedFATFolder` (apaga so nomes do manifesto); dispositivo trocado -> `waitForLocalDevice`;
  senao 3 retentativas. Marca `.xbox-companion-installing` antes do primeiro arquivo e apaga depois do ultimo.
  Chamado por `local_install.go::InstallGameLocal` (GOD), `InstallContentLocal` e `InstallXEXLocal`.
- `local_resilient.go::orderEntryPointsLast` (771-792) — monta o mapa `entryPoint` (`default.xex` na raiz e cada
  cabecalho GOD dono de uma pasta `<cabecalho>.data`) e os poe no fim; e o lugar natural para marcar quem NAO e
  ponto de entrada (ou `copyTreeLocal` logo depois dele).
- `local_resilient.go::copyFileLocal` (794-847) — copia avulsa (arquivo unico), monta `localCopyEntry` literal e
  chama `copyLocalEntry` direto (nao o `Func`): com campo de valor zero = staging, nao muda.
- `local_copy_bench_test.go::benchVariants` (57-90) — `atual` chama `copyLocalEntry(entry, root, dst, nil)` com a
  entrada crua; `direto`/`direto-sync`/`sem-sync` sao copias independentes do codigo do app.
- Por que nao ha conserto de ordem de grandeza: 145 mil arquivos x escritas de metadado sincronas num pendrive USB
  2.0 de 40-100 IOPS (secao "Evidencia"). O fix reduz escritas por arquivo; orientar o cliente (USB 3.0/HD) segue
  como decisao do dono, `sem-codigo`, em "falta para close".

### Provas (comando literal -> resultado)

- `git log --oneline -1` na lane -> `c4874fa`; `grep -n "^func \|out.Sync\|localStagingPath\|orderEntryPoints"
  local_resilient.go` -> `copyLocalEntry` 408, `out.Sync()` 449, `copyTreeLocal` 554, `orderEntryPointsLast` 771,
  `copyFileLocal` 794.
- `grep -rn "copyTreeLocal(" src/server --include=*.go | grep -v _test` -> 3 chamadores, todos em
  `local_install.go` (GOD 114, Content 126, XEX 139): o fix vale para GOD e Content tambem.
- `Test-Path '...\Temp\EA FC 26 Legacy Edition_hf_ext\...\data\sceneassets\kit'` -> `True`, 7.074 arquivos,
  959 MB: a origem do bench existe na arvore principal (so leitura).
- `Get-Disk | Select Number,FriendlyName,SerialNumber,BusType,Size` -> disco 2 ` USB DISK 2.0`, serial
  `247700023090`, USB, 15,5 GB; `Get-Partition -DiskNumber 2` -> `E:` FAT32; `Get-Volume` -> rotulo `PS2`,
  3,82 GB livres. **Atencao, sessao de teste:** `Get-Disk | Where-Object SerialNumber -eq '247700023090'` (a forma
  do manual) voltou VAZIO nesta maquina; `Get-Disk | Where-Object { $_.SerialNumber.Trim() -eq '247700023090' }`
  achou o disco 2. Use a forma com `Trim()`.
- Lock `C:\projects\.pendrive-teste-247700023090.lock` -> nao existia em 2026-10-12 (esta sessao).

### Hipoteses descartadas (e por que)

- **Tirar o `Sync` ja no primeiro round (`direto`):** a fastfat em remocao rapida ja descarrega no `Close`
  (secao "Passo 1"), entao o ganho esperado e pequeno, e em "melhor desempenho" o `Sync` seria a unica garantia por
  arquivo (o `FlushVolumeBuffers` do fim e no-op sem admin). Fica como rodada 2 condicionada a medicao.
- **Gravar direto tambem o `default.xex`/cabecalho GOD:** quebraria a invariante do `AGENTS.md` (console listar
  jogo que nao inicia, se a copia parar no ultimo arquivo).
- **Direto no nome final volta a fragmentar a pasta FAT32 (2.12.110):** nao — o problema era o nome temporario ao
  lado do destino, com numero de entradas diferente do final. Gravando direto, a pasta so recebe nomes finais.
- **Arquivo parcial no nome final enganar a retomada:** nao — `copyTreeLocal` so pula arquivo cujo tamanho bate
  E cujo SHA-256 bate com a origem (`localFileMatches`); a pasta continua marcada ate o fim.
- **Provar em pasta NTFS local:** prova so a corretude; o custo medido e de metadado em FAT32 USB.
- **Rota GOD para este jogo:** descartada em 2026-10-09 (limite de 262.140 bytes por tabela XDVDFS).

### Tarefas

- [ ] `local_resilient.go::localCopyEntry` — campo `direct bool` (valor zero = staging, o caminho seguro: quem
  monta a entrada sem saber, como `copyFileLocal`, nao muda).
- [ ] `local_resilient.go::orderEntryPointsLast` (ou `copyTreeLocal` logo depois dele) — `direct = true` em toda
  entrada que nao e ponto de entrada — teste: estender
  `local_install_marker_test.go::TestCopyTreeLocalMarksFolderUntilLastFileAndWritesEntryPointsLast` para conferir no
  `copyLocalEntryFunc` falso que `default.xex` e `00007000/ABCDEF` chegam com `direct == false` e os outros 4 com
  `true`.
- [ ] `local_resilient.go::copyLocalEntry` — com `entry.direct`: `Remove(dst+legacy)`; staging de `dst` existente
  = sobra de versao anterior, apagar (nao promover: o arquivo vai ser escrito no lugar); limite 4 GB;
  `MkdirAll(dir(dst))`; `OpenFile(dst, O_CREATE|O_WRONLY|O_TRUNC)` (reescreve no lugar, sem apagar a entrada);
  copia + SHA-256; `Sync`; `Close`; conferencia de tamanho (ou hash com `GODSEND_FULL_VERIFY`). Em erro: devolver o
  erro sem apagar `dst` (a retomada o reescreve no lugar; apagar so abre buraco na pasta). Sem `direct`: codigo
  atual intacto. Comentario cita
  `[[pipeline-jogo-xex-com-145-mil-arquivos-leva-mais-de-10-horas-para-gravar-em-pendrive-fat32_2026-10-09T19-40]]`
  — testes em `local_resilient_test.go`: (a) direto grava o conteudo certo, nada aparece na staging durante a
  gravacao e a pasta so tem o nome final; (b) destino pre-existente com conteudo errado do mesmo tamanho e
  reescrito por `copyTreeLocal`; (c) erro no meio: um `copyLocalEntryFunc` que grava metade do conteudo no `dst`
  e devolve erro (o estado de um pendrive arrancado) e depois a chamada seguinte de `copyTreeLocal` com o original
  termina com o conteudo certo e sem a marca; (d) `TestCopyLocalEntryKeepsTemporaryOutOfDestinationFolder` e
  `TestCopyLocalEntryPromotesValidStagedFileOnResume` passam sem mudanca (caminho staging).
- [ ] `local_resilient_fat32_test.go::TestFAT32CopyTreeLocalFitsLargeDirectory` — aceitar a staging inexistente
  (`os.IsNotExist`) alem de vazia.
- [ ] `local_copy_bench_test.go::benchVariants` — `staging` = `copyLocalEntry` com `direct=false` (o caminho de
  hoje, o mesmo codigo da base) e `atual` = `copyLocalEntry` com `direct=true` (o que `copyTreeLocal` faz com
  arquivo que nao e ponto de entrada); ordem padrao `staging,atual,sem-sync,direto,direto-sync`.
- [ ] `CHANGELOG.md` `[Unreleased]` `### Fixed` (fora da reserva: `merge=union`); o teste acrescenta os numeros.
- [ ] **Rodada 2, so se o teste pedir:** se o bench mostrar `direto` >= 1,25x `atual` em arq/min, tirar o `Sync`
  do caminho direto (nao do staging) e registrar no doc que a garantia por arquivo passa a ser o `Close` em
  remocao rapida.

### Plano de teste

- **Offline (sem slot):** em `src/server`: `go test ./services/pipeline/ -count=1` (testes novos e os de staging
  antigos) e `go vet ./services/pipeline/`; `TestFAT32LocalCopyBench` com `GODSEND_BENCH_ALLOW_NONFAT=1`, destino
  `%TEMP%`, 50 arquivos, `GODSEND_BENCH_DRAIN_MAX=4s` so prova que as variantes rodam (numeros nao valem).
- **Medicao (no slot, pendrive de teste; prova central do fix):** confirmar o disco pelo serial (forma com
  `Trim()`, ver Provas), criar o lock `C:\projects\.pendrive-teste-247700023090.lock`, conferir > 500 MB livres e
  nenhum `godsend*` gravando nele. Em `src/server` da lane:
  `$env:GODSEND_FAT32_TEST_DIR='<letra>:\'`;
  `$env:GODSEND_BENCH_SRC='C:\projects\Downloader-XBOX360-XEX-HDD-Games\Temp\EA FC 26 Legacy Edition_hf_ext\EA FC 26 Legacy Edition\data\sceneassets\kit'`;
  `$env:GODSEND_BENCH_MAX_FILES='1000'`; `$env:GODSEND_BENCH_VARIANTS='staging,atual,direto,staging,atual'`;
  `go test ./services/pipeline/ -run TestFAT32LocalCopyBench -v -timeout 6h` (em BACKGROUND; ~35-140 min). A
  repeticao `staging,atual` no fim mede o ruido. Saida na evidencia; apagar o lock no fim, inclusive em erro.
  **Criterio:** `atual` >= 1,25x `staging` em arq/min nas duas rodadas, com `escr/arq` menor. Entre 1,0x e 1,25x:
  reprovar com "ganho insuficiente" e os numeros (se `direto` >= 1,25x `atual`, pedir a rodada 2 das Tarefas).
  `atual` <= `staging`: reprovar com os numeros.
- **T2 reproducao como o usuario (E2E, no slot):** o caminho do cliente com o EA FC 26 (12,25 GB, 10+ h na base)
  nao cabe numa janela de teste; o equivalente proporcional: app da lane (`npm start`), destino local = o pendrive
  de teste (letra confirmada pelo serial); Catalogo/Browse -> um jogo **XEX** com pelo menos ~2.000 arquivos que
  caiba no espaco livre -> baixar e gravar no pendrive. Sinal: contador `Gravando e verificando... N% (i/total)` na
  Home/Fila amostrado a cada minuto (ou arquivos por mtime em `<letra>:\Games\<jogo>`) -> arq/min; no fim, a pasta
  do jogo sem `.xbox-companion-installing`, com `default.xex`, o mesmo numero de arquivos da origem e
  `<letra>:\.xbox-downloader\copy-staging` vazia ou inexistente. Comparar arq/min com o controle positivo (mesmo
  jogo, mesmo pendrive, pasta apagada antes). Se nenhum XEX assim couber na janela, registrar: a prova de taxa fica
  com a Medicao e a T2 vira a instalacao completa e correta de um XEX qualquer pelo app.
- **Controle positivo:** (a) a linha `staging` do bench e o caminho da base sem mudanca (o ramo sem `direct` de
  `copyLocalEntry` fica intacto), medida no mesmo volume e na mesma hora; (b) para a T2, a base pelo caminho que o
  manual da para projeto sem `deploy`.
- **T3 regressao direcionada:** retomada — gravar o mesmo XEX, cancelar na Fila no meio, reenfileirar: termina,
  arquivos integros, sem `.xbox-companion-installing`; um jogo **GOD** pequeno no pendrive (blocos `Data` pelo
  caminho direto, cabecalho por ultimo via staging) aparece em "Jogos Instalados"; com o pendrive,
  `GODSEND_FAT32_TEST_DIR=<letra>:\` e `go test ./services/pipeline/ -run 'FAT32CopyTree|FAT32Legacy' -count=1 -v`
  (`TestFAT32CopyTreeLocalFitsLargeDirectory`: a pasta de 13 mil nomes ainda cabe gravando direto;
  `TestFAT32LegacyPartSuffixExhaustsDirectory` segue como controle). Mais `go test -count=1 ./...` em `src/server`
  e `npm --prefix src/electron-app run test:safety` (linha de base do manual).
- **Falta para close (fora do pipeline):** o EA FC 26 inteiro no pendrive do cliente (horas mesmo com o fix);
  decisao do dono sobre orientar pendrive USB 3.0/HD para jogos com 100 mil+ arquivos.

### Sessoes seguintes

- dev: effort high, ultrathink sim — gravacao no pendrive do cliente: retomada, erro no meio, pontos de entrada, e
  os testes antigos de staging tem de continuar valendo.
- teste: effort high, ultrathink nao — a medicao e mecanica, mas toca disco real (serial, lock, espaco) e o
  veredito depende de ler os numeros com o ruido.

### Nota do dev (2026-10-12): correcao do plano antes da implementacao — quem vai direto

O plano marca `direct = true` em **toda** entrada que nao e ponto de entrada. Abrindo os chamadores, isso inclui
`local_install.go::InstallContentLocal` (`copyTreeLocal` de `Content/0000000000000000/<TitleID>/<tipo>/`): pacotes
STFS soltos (DLC, title update, conteudo de disco de instalacao) nao tem ponto de entrada nenhum, entao o console os
ve pelo proprio nome. Gravados direto, uma copia interrompida deixaria um pacote **truncado no nome final**, visivel
ao console (a marca `.xbox-companion-installing` so protege a varredura do Electron, nao o console). Com staging,
o pacote simplesmente nao existe ate estar completo — a mesma razao do plano para manter `default.xex` em staging.
E o ganho ali e nulo (poucos arquivos grandes; o custo e por arquivo).

**Regra corrigida:** vai direto so o arquivo que esta **atras de um ponto de entrada** que o proprio manifesto grava
por ultimo: (a) arvore com `default.xex` na raiz (XEX) -> todo arquivo menos o `default.xex`; (b) arquivo dentro de
`<cabecalho>.data/` cujo `<cabecalho>` esta no manifesto (GOD, SVOD) -> direto, o cabecalho via staging. Todo o
resto (pacote STFS solto, `.data/` sem cabecalho, `copyFileLocal`) continua em staging. Para o caso do bug (XEX com
145 mil arquivos) e para os blocos `Data` do GOD o resultado e o mesmo do plano; o teste do plano em
`TestCopyTreeLocalMarksFolderUntilLastFileAndWritesEntryPointsLast` (2 com `direct == false`, 4 com `true`) nao muda.

Consequencias nos testes:
- `local_resilient_fat32_test.go`: as arvores de `TestFAT32CopyTreeLocalFitsLargeDirectory` e
  `TestFAT32CopyTreeLocalRecoversFragmentedDirectory` nao tem `default.xex`, entao continuariam pela staging e nao
  provariam o caminho direto em FAT32 real. Os dois ganham um `default.xex` na raiz da origem (a pasta grande vira
  subpasta `faces/`, como no jogo); a staging continua existindo (o `default.xex` passa por ela) e tem de terminar
  vazia. O erro de pasta cheia passa a vir do `OpenFile` do nome final, nao do rename: o
  `TestFAT32CopyTreeLocalRecoversFragmentedDirectory` prova que `isFATDirectoryFull` o reconhece.
- Teste novo de `orderEntryPointsLast` com arvore de Content (pacote solto: nada direto; GOD/SVOD: so `.data/`).

Detalhe de biblioteca conferido (Go 1.26.6, `syscall/syscall_windows.go:429-480`): `O_CREATE|O_TRUNC` abre com
`OPEN_ALWAYS` e trunca por `Ftruncate`, entao reescrever um destino existente mantem a mesma entrada de diretorio.
Um destino somente leitura (copiado de ISO montada por outra ferramenta) faz o `OpenFile` falhar com acesso negado;
o caminho antigo o substituia porque `os.Remove` limpa o atributo (`os/file_windows.go:222-257`). O caminho direto
tenta `os.Remove(dst)` e abre de novo uma vez, para nao perder esse caso.

## Correcao (pipeline 20261012-0329, rodada 1)

Variante do plano: `direto-sync` (nome final, `Sync` mantido), so para arquivo atras de ponto de entrada (nota do
dev acima). O que mudou:

- `src/server/services/pipeline/local_resilient.go::localCopyEntry` — campo `direct bool`; valor zero = staging, entao
  `copyFileLocal` (entrada literal) e qualquer chamador que nao saiba dele seguem no caminho antigo.
- `local_resilient.go::orderEntryPointsLast` — depois de achar os pontos de entrada, marca `direct` em todo arquivo
  que nao e ponto de entrada e esta atras de um: `default.xex` na raiz cobre a arvore inteira; `<cabecalho>.data/`
  com o `<cabecalho>` no manifesto cobre os blocos. Sem ponto de entrada (pacote STFS solto de Content) retorna antes
  e nada vai direto.
- `local_resilient.go::copyLocalEntry` — com `direct`: nao promove sobra da staging (apaga), nao cria a pasta da
  staging, abre o **destino** com `O_CREATE|O_WRONLY|O_TRUNC` (Go 1.26: `OPEN_ALWAYS` + `Ftruncate`, mesma entrada
  de diretorio), se o `OpenFile` falhar tenta `os.Remove(dst)` e abre de novo uma vez (destino somente leitura),
  copia com SHA-256, `Sync`, `Close`, confere tamanho (ou hash com `GODSEND_FULL_VERIFY`) e retorna sem rename. Em
  erro devolve o erro **sem apagar** o destino (`discard` vazio): a retomada o reescreve no lugar. Sem `direct`: os
  mesmos passos de antes (as remocoes viraram `discard()`, que apaga a staging como antes; `partial` virou `target`).
  Comentarios citam `[[pipeline-jogo-xex-com-145-mil-arquivos-leva-mais-de-10-horas-para-gravar-em-pendrive-fat32_2026-10-09T19-40]]`.
- Testes: `local_resilient_test.go::TestCopyLocalEntryDirectWritesFinalNameWithoutStaging` (a: durante a gravacao a
  staging nao existe e a pasta so tem o nome final; sobra integra da staging e apagada, nao promovida; destino
  existente reescrito), `::TestCopyTreeLocalRewritesWrongDirectFileInPlace` (b), `::TestCopyTreeLocalResumesDirectFileCutShortByRemovedDevice`
  (c: o `copyLocalEntry` real grava metade no nome final e o pendrive "sai"; a metade fica, `default.xex` ausente, marca
  presente; com o mesmo pendrive de volta a retomada reescreve e conclui); `local_install_marker_test.go` — quem vai
  direto no teste da marca (2 `false`, 4 `true`) e `::TestOrderEntryPointsLastWritesDirectOnlyBehindAnEntryPoint`
  (Content solto, GOD, `.data` orfao ao lado de GOD, XEX). Os testes antigos de staging (d) passam sem mudanca.
- `local_resilient_fat32_test.go` — `TestFAT32CopyTreeLocalFitsLargeDirectory` e
  `TestFAT32CopyTreeLocalRecoversFragmentedDirectory` ganharam `default.xex` na raiz da origem (a pasta grande e
  `faces/`), para gravar os 13.146 nomes **pelo caminho direto** em FAT32 real; o segundo confere `direct` por arquivo
  e que o `ERROR_CANNOT_MAKE` do `OpenFile` (nao mais do rename) dispara a reorganizacao uma vez. A staging continua
  existindo (o `default.xex` passa por ela) e tem de terminar vazia — por isso a tarefa "aceitar staging inexistente"
  do plano nao foi necessaria.
- `local_copy_bench_test.go::benchVariants` — `staging` (`direct=false`, o caminho da base) e `atual` (`direct=true`);
  ordem padrao `staging,atual,sem-sync,direto,direto-sync`.
- `AGENTS.md` (reservado com `claim`) — invariante: so vai direto o que esta atras de ponto de entrada.
- `CHANGELOG.md` `[Unreleased]` `### Fixed`.

Provas offline (2026-10-12, na lane):
- `go vet ./services/pipeline/` limpo; `gofmt -d` vazio nos 5 arquivos (normalizados para LF).
- `go test ./services/pipeline/ -count=1` -> `ok godsend/services/pipeline 5.077s`.
- Compile-check do helper (`pipeline.py build`) -> rc 0: `dist/godsend*.exe` (x64, ia32), `tsc` e `renderer:typecheck`.
- Mutacao: `orderEntryPointsLast` sem marcar `direct` -> falham `TestCopyTreeLocalMarksFolderUntilLastFileAndWritesEntryPointsLast`,
  `TestOrderEntryPointsLastWritesDirectOnlyBehindAnEntryPoint`, `TestCopyTreeLocalResumesDirectFileCutShortByRemovedDevice`;
  `discard` do caminho direto apagando o destino -> falha `TestCopyTreeLocalResumesDirectFileCutShortByRemovedDevice`.
  Codigo restaurado depois.
- Bench a seco (`GODSEND_BENCH_ALLOW_NONFAT=1`, `%TEMP%` no SSD, 50 arquivos de `kit`, `GODSEND_BENCH_DRAIN_MAX=4s`):
  as 5 variantes completam, `PASS` em 59,7 s. Numeros **nao valem** (disco do sistema); so por curiosidade, as
  escritas por arquivo sairam staging 10,6 / atual 9,2 / direto-sync 8,1 / direto 6,4 / sem-sync 5,5.

Ajustes ao Plano de teste (para a sessao de teste):
- Medicao: o comando do plano vale como esta (`GODSEND_BENCH_VARIANTS='staging,atual,direto,staging,atual'`).
- T3 com o pendrive: `TestFAT32CopyTreeLocalFitsLargeDirectory` e `TestFAT32CopyTreeLocalRecoversFragmentedDirectory`
  agora exercitam o caminho direto; o segundo **tem de** ver exatamente 1 `ERROR_CANNOT_MAKE`. Se o `OpenFile` numa
  pasta FAT32 cheia devolver outro erro que nao o 82, e reprovacao (a reorganizacao nao dispararia).
- T2: a pasta `<letra>:\.xbox-downloader\copy-staging` existe ao fim (o `default.xex` passa por ela) e tem de estar
  vazia.
- Um jogo/DLC instalado como Content (pacote solto) continua pela staging: nao e regressao se a taxa dele nao mudar.

### Teste rodada 1 — reprovado (2026-10-12, 14:20-15:30, sessao de teste)

**Motivo: ganho insuficiente pelo criterio do Plano de teste.** A Medicao (prova central) pede `atual` >= 1,25x
`staging` em arq/min **nas duas rodadas**; deu 1,185x e 1,245x. Corretude: tudo aprovado (T2, T3, T4). Evidencia em
`C:\projects\.bugfix-xbox360\evidencia\20261012-teste-r1-pipeline-jogo-xex-145-mil\` (`LEIAME` = este texto).

**Medicao (bench, pendrive de teste `E:`, serial `247700023090` confirmado com `Trim()`, lock criado e removido):**
`GODSEND_FAT32_TEST_DIR=E:\`, `GODSEND_BENCH_SRC=...\data\sceneassets\kit`, 1.000 arquivos (135,6 MB),
`GODSEND_BENCH_VARIANTS=staging,atual,direto,staging,atual` -> `PASS` em 1067 s (`medicao-bench-pendrive.txt`):

| variante | arq/min | escr/arq | razao |
|---|---|---|---|
| staging (base) | 405,6 | 15,1 | |
| atual (fix) | 480,6 | 12,1 | **1,185x** staging |
| direto (sem Sync) | 424,2 | 9,0 | 0,88x atual |
| staging (base) | 280,6 | 15,1 | |
| atual (fix) | 349,5 | 12,1 | **1,245x** staging |

- Esperado: >= 1,25x nas duas. Observado: 1,185x e 1,245x -> faixa "entre 1,0x e 1,25x: reprovar com ganho
  insuficiente". `escr/arq` cai 20% (15,1 -> 12,1) nas duas rodadas, entao o ganho existe e e o previsto em escritas;
  em tempo ele fica abaixo da barra.
- Rodada 2 das Tarefas (tirar o `Sync`) **nao** se aplica: `direto` deu 0,88x `atual` (< 1,25x).
- Ruido: a mesma variante `staging` foi de 405,6 para 280,6 arq/min entre a 1a e a 4a passada (o pendrive desacelera
  com o uso). As razoes valem por par adjacente; a barra de 1,25x fica dentro do ruido de uma rodada.

**T2 (o usuario, pela UI do app da lane, controle positivo na base):** Playwright sobre o app em modo dev (`t2.cjs` +
`lib.cjs`, unico stub: a lista de unidades devolve so `E:\`), Baixar Jogos -> filtro "Master System" ->
"EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )" (XEX, `default.xex` na raiz, **2.216 arquivos**, 175 MB) -> XEX ->
Adicionar a fila. Base = `pipeline.py build` com a lane destacada em `50dcfe9` (volta ao branch logo depois); fix = build
do branch `b35a4e5`. `config.json` do dev com `"simpleMode": false` so durante o teste (sem a chave o app abre o
assistente; 1a tentativa em `tentativa1-wizard/`), original devolvido.

| | base (`t2-base-*`) | fix (`t2-fix-*`) |
|---|---|---|
| backend | PID 15924, `lanes\wt-1\dist\godsend-windows-x64.exe`, banner na Home | PID 57348, idem |
| taxa no contador da Fila (i/total) | 405,2 arq/min | **525,2 arq/min (1,30x)** |
| copia pelo log (`LOCAL XEX` -> `Complete`) | 328 s | 252 s (1,30x) |
| staging nao vazia durante a gravacao | 44 de 64 amostras (max 1) | **0 de 49** |
| fim | Ready, 2.216 arquivos, `default.xex`, sem marca, staging vazia | idem |

- Fix: os 2.216 arquivos no pendrive conferem CRC32 e tamanho com o `.zip` de origem (`t2-fix-crc32.txt`: 2216 iguais,
  0 divergentes, 0 faltando, 0 extras).
- Sinal do sintoma na base presente (todo arquivo pela staging), ausente no fix; comportamento correto presente.

**T3:** `go test -count=1 ./...` em `src/server` rc 0 (`t3-go-test-all.txt`); `test:safety` 327 pass / 0 fail
(`t3-test-safety.txt`); `go vet` limpo e `go test ./services/pipeline/` ok (offline). Pendrive:
`TestFAT32CopyTreeLocalRecoversFragmentedDirectory` **PASS** em 1401 s (`t3-fat32-recovers.txt`): fase 2.12.109 falhou no
#12569 (controle), fase nova viu **1** `ERROR_CANNOT_MAKE` vindo do `open` do nome final (caminho direto), reorganizou
a pasta uma vez e gravou os 13.146 arquivos em 9m19s (a mesma fase pela staging levou 14m28s na sessao de teste do bug
da fragmentacao, mesmo pendrive, 13:44-14:15 — outra hora, so referencia).

**T4:** janelas de log de base e fix: so o erro de CSP das fontes do Google (pre-existente), nenhum erro do backend.

**Nao testado nesta rodada:** `TestFAT32CopyTreeLocalFitsLargeDirectory` (coberto em parte pelo Recovers, que grava a
mesma pasta pelo caminho direto); retomada pela UI (cancelar na Fila no meio e reenfileirar) — coberta so pelo teste
de unidade `TestCopyTreeLocalResumesDirectFileCutShortByRemovedDevice`; jogo GOD pequeno no pendrive (nao cabia: 3,2 GB
livres, o GTA Brasil GOD tem 3,4 GB).

**Para o dev / o dono:** o codigo esta correto e da 1,2-1,3x (pelo app, 1,30x; pelo bench, 1,19x e 1,25x), com 20% menos
escritas por arquivo; o criterio de 1,25x em duas rodadas do bench nao foi atingido, e a alavanca seguinte do plano (sem
`Sync`) nao ajuda. Nao ha mudanca de codigo obvia a pedir: a decisao e aceitar 1,2-1,3x (afrouxar o criterio) ou fechar
como `sem-codigo` (orientar pendrive USB 3.0/HD para jogos com 100 mil+ arquivos).

**Bug lateral (nao pertinente, igual na base):** `docs/bugs/open/pipeline-xex-com-default-xex-na-raiz-do-arquivo-grava-pasta-com-sufixo-hf-ext_2026-10-12T14-56.md`
— XEX cujo arquivo traz `default.xex` na raiz e gravado em `E:\Games\<nome>_hf_ext`, sem TitleID.

### Rodada 1 — reprovada: ganho insuficiente no bench (1,185x e 1,245x contra 1,25x); correcao: bench intercalado (o codigo do fix nao muda)

**Analise (dev, 2026-10-12, antes de editar):** a reprovacao nao aponta defeito no codigo (T2/T3/T4 aprovados); ela
vem da Medicao. A medicao tem um vies sistematico **contra o fix**, visivel nos proprios numeros do teste:

- As passadas foram sequenciais (`staging,atual,direto,staging,atual`) e o pendrive desacelera com o uso: a mesma
  variante caiu de 405,6 para 280,6 arq/min (`staging`, passadas 1->4) e de 480,6 para 349,5 (`atual`, 2->5). Taxa
  por passada (media geometrica em 3 passadas): `staging` 0,884, `atual` 0,899 — ~11% mais lento a cada passada,
  monotono. As escritas por arquivo ficaram identicas entre rodadas (15,1 e 12,1): o que muda e o custo de cada
  escrita no aparelho, nao o codigo.
- Nos **dois** pares o `atual` roda uma passada **depois** do `staging`, entao a razao do par sai ~11% menor que a
  real. Interpolando so os numeros medidos (log-linear entre passadas da mesma variante, comando abaixo): `staging`
  na posicao da passada 2 = 358,7 -> `atual`/`staging` = **1,340**; `atual` na posicao da passada 4 = 388,7 ->
  **1,385**. E uma estimativa, nao prova: a prova e repetir a medicao sem o vies.
- Coerente com a T2 pelo app (2.216 arquivos, outro jogo, base antes do fix): 1,30x — ali a base tambem rodou antes.
- `direto` (sem `Sync`) na mesma interpolacao = 0,98x `atual`: confirma que tirar o `Sync` nao ganha nada (a rodada 2
  das Tarefas segue descartada).

`python -c "s1,a1,s2,a2=405.6,480.6,280.6,349.5; fs=(s2/s1)**(1/3); print(a1/(s1*fs), a1*(a2/a1)**(2/3)/s2)"` ->
`1.340 1.385`.

**Hipoteses de codigo descartadas para aumentar a margem (sem pendrive o dev nao mede, entao so entra o que tem prova):**
- Tirar o `Sync`: medido, nao ganha (acima).
- Pre-alocar o arquivo (`Truncate` ao tamanho final): o dado de um arquivo de ~130 KB ja e 1 chamada de escrita
  (buffer de 4 MB), a FAT e alocada uma vez; nada a cortar.
- Suprimir a atualizacao de horario no `Close` (`SetFileTime` com -1) para evitar a 2a gravacao da entrada de
  diretorio: depende de comportamento do fastfat que nao conferi na fonte e nao posso medir; especulativo.
- Gravar arquivos em paralelo: pendrive USB 2.0 (bulk-only) atende um comando por vez; complexidade alta, ganho
  incerto.

**Correcao (a fazer):** `local_copy_bench_test.go::TestFAT32LocalCopyBench` passa a **intercalar** as variantes em
blocos de `GODSEND_BENCH_BLOCK` arquivos (padrao 100), na ordem ABBA (bloco par: ordem da lista; impar: invertida),
cada variante na sua pasta. Uma desaceleracao monotona do aparelho cai igual em todas. Imprime o total por variante e
as duas metades dos blocos como "rodada 1" e "rodada 2", com a razao de cada variante contra a primeira da lista — o
criterio do plano (`atual` >= 1,25x `staging` nas duas rodadas) se le direto dessas linhas. Variante repetida na
lista vira erro (com intercalacao a repeticao nao tem sentido). O criterio **nao muda**.

**Correcao aplicada (rodada 2 do dev):** so `src/server/services/pipeline/local_copy_bench_test.go::TestFAT32LocalCopyBench`
mudou; `local_resilient.go` e os testes de corretude estao iguais aos de `b35a4e5` (o que a T2/T3/T4 aprovou).
- Variantes intercaladas por bloco, ordem ABBA (bloco impar invertido), cada uma na sua pasta (`<raiz>\<variante>`);
  as pastas coexistem ate o fim (o destino precisa de espaco para todas) e saem no `t.Cleanup`.
- **4 blocos por padrao** (`GODSEND_BENCH_BLOCK` muda o tamanho): cada metade e exatamente AB+BA, entao a deriva
  linear se cancela dentro de cada "rodada". Por que nao blocos pequenos: o dreno depois de cada bloco soma a cauda de
  escritas (1-2,5 s por passada na medicao da rodada 1, inclusive nas variantes com `Sync`) e, com 10 blocos, essa
  cauda entraria 10 vezes em cada variante, puxando as razoes para 1 — vies contra o fix de novo.
- Saida: linhas `total`, `rodada 1` e `rodada 2` por variante, com `arq/min`, a razao contra a primeira variante da
  lista (`N.NNNx staging`), MB/s, escritas e `escr/arq`. Variante repetida em `GODSEND_BENCH_VARIANTS` -> `FAIL`
  imediato ("as variantes ja rodam intercaladas").

Provas offline (2026-10-12): `go vet ./services/pipeline/` limpo; `gofmt -d` vazio; `go test ./services/pipeline/
-count=1` -> `ok 5.100s`; compile-check do helper (`pipeline.py build`) -> rc 0; bench a seco em `%TEMP%` (`GODSEND_BENCH_ALLOW_NONFAT=1`, `GODSEND_BENCH_DRAIN_MAX=4s`):
60 arquivos/3 variantes/blocos de 20 e 80 arquivos/`staging,atual`/4 blocos -> `PASS`, pasta de teste apagada;
`staging,atual,staging` -> `FAIL` com "variante \"staging\" repetida". Numeros do SSD nao valem: o disco do sistema
nunca fica parado e o tempo de cada bloco vira o teto do dreno.

**Medicao para a sessao de teste (substitui o comando do Plano de teste; criterio inalterado):** pendrive confirmado
pelo serial com `Trim()`, lock, nenhum `godsend*` gravando, **>= 600 MB livres**. Em `src/server` da lane:
`$env:GODSEND_FAT32_TEST_DIR='<letra>:\'`;
`$env:GODSEND_BENCH_SRC='C:\projects\Downloader-XBOX360-XEX-HDD-Games\Temp\EA FC 26 Legacy Edition_hf_ext\EA FC 26 Legacy Edition\data\sceneassets\kit'`;
`$env:GODSEND_BENCH_MAX_FILES='2000'`; `$env:GODSEND_BENCH_VARIANTS='staging,atual'` (sem `GODSEND_BENCH_BLOCK`:
4 blocos de 500); `go test ./services/pipeline/ -run TestFAT32LocalCopyBench -count=1 -v -timeout 6h` em BACKGROUND
(~15-25 min pelas taxas da rodada 1). 2.000 arquivos em vez de 1.000 para a cauda do dreno pesar ~2% por bloco.
**Criterio (o mesmo):** linhas `rodada 1 atual` e `rodada 2 atual` com razao >= 1,250x `staging` e `escr/arq` menor.
Entre 1,0x e 1,25x com a medicao intercalada: o ganho real e esse, e a decisao (aceitar ou `sem-codigo`) e do dono —
nao ha alavanca de codigo medida que falte (ver hipoteses acima). T2/T3/T4 da rodada 1 continuam valendo: o codigo
gravado no pendrive nao mudou.
