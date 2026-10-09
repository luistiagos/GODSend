# Bug: leitor XDVDFS para no primeiro arquivo vazio do setor; ISO vira pasta XEX incompleta sem erro e o probe deixa de achar o default.xex

- **Detectado em:** 2026-10-09 ~20:18 (horario local), durante a prova manual do bug
  [pipeline-jogo-xex-com-145-mil-arquivos-...](pipeline-jogo-xex-com-145-mil-arquivos-leva-mais-de-10-horas-para-gravar-em-pendrive-fat32_2026-10-09T19-40.md)
- **Origem:** leitura de `src/server/utils/iso2god.go` e um harness Go **fora do repo** que chama as funcoes
  exportadas reais (`godsend/utils`) sobre XISOs geradas pelo `extract-xiso`
- **Classe:** corretude / leitura de ISO (falha silenciosa)
- **Severidade:** **P2 - Medio (a confirmar)**: a perda e silenciosa (`err == nil`); a frequencia de arquivo
  vazio em ISOs reais do catalogo **nao foi medida**
- **Complexidade:** baixa (condicao de parada de um laco), mais um teste unitario
- **Estado:** causa raiz provada; nada corrigido. Achado fora do escopo da sessao que o encontrou

## Causa raiz

`utils/iso2god.go::parseDirSector` (linhas 319-351) le as entradas de um setor de diretorio em sequencia e
faz `break` quando `size == 0` (linhas 333-335). A intencao e parar no preenchimento com zeros, mas
**arquivo vazio legitimo tambem tem `size == 0`** — o `extract-xiso` grava arquivo vazio com `size = 0` e
setor diferente de zero (`extract-xiso.c::write_dir_start_and_file_positions`). Todas as entradas que vem
**depois** dele no mesmo setor de 2048 bytes somem. `readXDVDFSDirTable` (301-314) continua no setor
seguinte, entao a perda e so do resto daquele setor.

Quem usa o leitor (call-sites conferidos):
- `ExtractXEXFolderFromISO` -> `xdvdfsExtractRecursive` (1477): chamado por `stage_checkpoint.go::extractXEXResilient`,
  que roda nos fluxos de instalacao ISO -> XEX (`pipeline.go:68`, `pipeline.go:230`, `digital.go:210`,
  `huggingface.go:125`, `minerva.go:80`). **Arquivo faltando na pasta XEX, sem erro.**
- `extractExecInfo` -> `findInDir` (355): `ProbeISODiscInfo` e `RunIso2GodNative`. Vazio antes do
  `default.xex` no mesmo setor -> `ErrNoExecutable` (falso "nao e jogo").
- `maxXDVDFSUsedPrefix` (369): `RunIso2GodNative` (`convertGODResilient`, `pipeline.go:320`). Se a entrada
  pulada (ou uma subpasta pulada) contem o ultimo extent da imagem, `usedSize` sai menor e o **GOD e
  truncado** sem erro. **Nao provado** — so deduzido do codigo.

## Evidencia (2026-10-09)

ISO montada pelo `extract-xiso` (build-202609111233) a partir de uma copia da **raiz** do EA FC 26 Legacy
Edition com os mesmos 49 nomes (a tabela raiz sai identica; conteudo de 1 byte, `default.xex` real, os dois
vazios do jogo `patch.bh`/`patch.big` mantidos com 0 byte). Ordem fisica da raiz: `default.xex` no offset
716, `patch.big` (0 byte) no offset 1092, e depois dele `patch.bh`, `platform.ini`, `spa_mx.bh`, `rna.ini`,
`videoupload.ini`, `spa_mx.big`, `voicecommand.ini`.

| ISO | `ProbeISODiscInfo` | `ExtractXEXFolderFromISO` |
|---|---|---|
| raiz real (2 vazios) | OK `TitleID=454109F4 MediaID=4368ED0B` | `err=<nil>`, **41 de 49** entradas; faltam `patch.bh patch.big platform.ini rna.ini spa_mx.bh spa_mx.big videoupload.ini voicecommand.ini` |
| controle (vazios com 1 byte) | OK | `err=<nil>`, 49 de 49 |
| `ant.ini` vazio (offset 72, antes do `default.xex`) | **ERRO** `no game executable (default.xex / default.xbe) found in ISO root` | — |

Harness (em `scratchpad`, nao versionado): `go.mod` com `replace godsend => C:/projects/Downloader-XBOX360-XEX-HDD-Games/src/server`
e um `main.go` que chama `utils.ProbeISODiscInfo(iso)` e `utils.ExtractXEXFolderFromISO(iso, dest)`.

## Correcao proposta

1. Em `parseDirSector`, parar so no fim real dos dados: `left == 0xFFFF || right == 0xFFFF` (preenchimento
   padrao do XDVDFS) **ou** `nameLen == 0` (entrada toda zerada); aceitar `size == 0`. Conferir antes, numa
   ISO retail, se algum setor e preenchido com zeros em vez de `0xFF` — e o caso que o `size == 0` tentava
   cobrir.
2. Teste unitario em `utils`: setor sintetico com `a.txt` (size 0, setor != 0) seguido de duas entradas;
   `parseDirSector` devolve as tres. Teste de integracao: `ExtractXEXFolderFromISO` sobre uma XISO pequena com
   arquivo vazio extrai todos os arquivos (o vazio inclusive, com 0 byte).
3. Antes de priorizar: medir quantas ISOs do cache local tem arquivo vazio (varrer as tabelas com o leitor
   corrigido e contar entradas `size == 0`).
