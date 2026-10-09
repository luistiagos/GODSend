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
