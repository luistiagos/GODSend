# Bug: jogo XEX com 145 mil arquivos (EA FC 26 Legacy Edition) leva mais de 10 horas para gravar num pendrive FAT32; proposta: converter para GOD no PC antes de gravar

- **Detectado em:** 2026-10-09 ~19:20 (horario local), em teste do dono na maquina de desenvolvimento
- **Origem:** log `%APPDATA%\xbox-360-companion-electron\logs\godsend-server-2026-10-09.log`, contadores de disco do Windows durante a copia, mtime dos arquivos ja gravados no pendrive, leitura de `src/server/services/pipeline/local_resilient.go` e `src/server/utils/iso2god.go`
- **Classe:** desempenho / gravacao local
- **Severidade:** **P1 - Alto**: o dono considera o tempo inviavel para cliente. A copia comecou 17:40 e as 19:24 estava em 34% (25271/144851 arquivos); projecao de 10 a 16 horas no total
- **Complexidade:** alta para a correcao definitiva (construir imagem XDVDFS a partir de pasta); baixa para a prova manual
- **Estado:** analise feita; **proximo passo e a prova manual (secao "Proxima sessao")**, nada implementado

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

## Correcao proposta: converter XEX -> GOD no PC e gravar so o GOD

GOD = cabecalho + ~76 blocos grandes (`Data0000`...). Gravacao sequencial a ~3,3 MB/s (medido
neste pendrive) = **~1 h para 12,3 GB**, contra 10+ h; e elimina os limites de pasta do FAT32.

O que existe: `utils/iso2god.go::RunIso2GodNative(isoPath, outDir, resolveDisplayTitle)` converte
**ISO** em GOD; `pipeline.go::finalizeGOD` instala um GOD. Ha so **leitores** de XDVDFS
(`readXDVDFSVolDesc`, `xdvdfsExtractRecursive`...). **Nao existe** construtor de imagem XDVDFS a
partir de pasta — e o que falta (ou gerar o GOD direto da pasta, sem ISO intermediaria).

Riscos que a prova precisa responder:
1. O mod (default.xex modificado) roda como GOD em **RGH** e em **BadUpdate** (o pendrive de teste tem `BadUpdatePayload`)?
2. GOD de **12,25 GB** (maior que um disco XGD2/XGD3) e aceito pelo Aurora/dashboard?
3. O mod nao escreve na propria pasta do jogo (GOD e somente leitura)?

## Proxima sessao

1. **Prova manual (sem mexer no app):** gerar XISO da pasta acima com ferramenta externa
   (ex.: `extract-xiso -c`), converter com o `RunIso2GodNative` existente (ou iso2god), gravar no
   pendrive so com autorizacao do dono, cronometrar e testar no console RGH e BadUpdate.
2. Se rodar: abrir `[FEATURE]` "converter XEX em GOD automaticamente quando o destino e pendrive
   FAT32 e o jogo tem muitos arquivos" — construtor XDVDFS em Go + reuso de `RunIso2GodNative`
   + roteamento em `pipeline.go` antes de `copyTreeLocal`.
3. Independente do GOD (ganho menor, registrar como task separada): em `copyLocalEntry`, gravar
   direto no destino e trocar `out.Sync()` por arquivo por flush em lote; medir num pendrive de
   teste antes de decidir.
