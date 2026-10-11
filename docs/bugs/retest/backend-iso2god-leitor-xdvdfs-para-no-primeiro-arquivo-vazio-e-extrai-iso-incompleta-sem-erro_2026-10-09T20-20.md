# Bug: leitor XDVDFS para no primeiro arquivo vazio do setor; ISO vira pasta XEX incompleta sem erro e o probe deixa de achar o default.xex

## Status

- **Corrigido e testado:** 2026-10-11 (pipeline 20261010-2242, teste rodada 1 aprovado).
- **Commit do fix:** `0230c7d` (rebaseado sobre `origin/main` @ `2e886d2`; o SHA publicado pode mudar no rebase do `publish`).
- **Onde:** `src/server/utils/iso2god.go::parseDirSector` (para em `0xFFFF` ou `nameLen == 0`, aceita `size == 0`)
  e `::maxXDVDFSUsedPrefix` (ignora extent de 0 byte); testes em `src/server/utils/xdvdfs_dir_test.go`.
- **Evidencia:** `C:\projects\.bugfix-xbox360\evidencia\20261011-1340-backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio\`
  (ISOs sinteticas `isos\A.iso`/`B.iso` de `scripts\make_isos.py`, mesmo layout do teste (c); driver `scripts\t2.js`, Playwright
  `_electron` sobre a lane, `dialog.showOpenDialog` stubado; `*-result.json` e prints por rodada).
  - **Offline:** `go test -count=1 ./utils/` ok; com `iso2god.go` da base, (a), os dois de (c) e (d) FALHAM
    (`got entries [default.xex]`, `got max prefix 69632, want 132306`).
  - **Controle positivo (base, `dist\godsend-windows-x64.exe` da lane construido com `iso2god.go` de `origin/main`):**
    "ISO para XEX" com `A.iso` termina em "Saida: ..." verde com SO `default.xex` (faltam `vazio.bin`, `z1.txt`, `z2.txt`,
    `sub\inner.txt`); `POST /tools/probe-iso` e `/tools/iso2xex` com `B.iso` -> 500 `Probe failed: no game executable
    (default.xex / default.xbe) found in ISO root` (`base-result.json`, `base-3-result.png`). O erro em vermelho que o plano
    esperava na UI para `B.iso` NAO aparece: a tela mostra check verde — defeito do IPC, independente deste fix, registrado em
    [electron-main-ferramentas-iso-mostram-sucesso-quando-o-backend-responde-erro_2026-10-11T13-55](../open/electron-main-ferramentas-iso-mostram-sucesso-quando-o-backend-responde-erro_2026-10-11T13-55.md).
  - **T2 (fix, mesmo caminho pela UI, backend PID 20300 com Path na lane):** as duas linhas com "Saida: ..."; `A.iso` -> 5 arquivos
    (`vazio.bin` 0 byte, `z1.txt` 2, `z2.txt` 3, `sub\inner.txt` 4, `default.xex` 64); `B.iso` (`Halo 3 - 4D5307E6`) -> 6 arquivos com
    `aaa.ini` 0 byte; `probe-iso` de `B.iso` 200 com `titleId 4D5307E6` (`fix-result.json`, `fix-3-result.png`).
  - **T3:** `go test -count=1 ./...` em `src/server`: todos os pacotes `ok`; `npm --prefix src/electron-app run test:safety`: 307 pass / 0 fail
    (`t3-test-safety.log`); "ISO para GOD" pela UI com `A.iso` e `B.iso`: as duas concluem, GOD com header + `Data0000` (`god-result.json`).
  - **T4:** `t4-godsend-server-2026-10-11.log` (janela 13:48-13:53, so os launches deste teste): nenhum erro/panic.
  - Ambiente: o teste rodou em modo avancado (`simpleMode: false` no `config.json` dev, o modo simples nao tem a barra
    de Ferramentas sem Xbox na rede ou disco); `config.json` devolvido a copia original no fim.
- **Falta para `closed/`:** versao publicada (subida de versao + `build-and-upload.ps1`, do dono); ISO retail real com arquivo
  vazio (EA FC 26 Legacy, `patch.big`/`patch.bh`) instalada como XEX e dando boot no console; frequencia de arquivo vazio no
  catalogo nao medida (sem ISO de Xbox nesta maquina).

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

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** corrigir — a condicao de parada de `parseDirSector` trata arquivo vazio legitimo como fim do setor; o conserto e local e testavel offline e pela tela "ISO para XEX".
**Complexidade:** media — logica em Go no backend (`src/server/utils/iso2god.go`), sem rota/IPC/UI nova; a mudanca e de uma condicao, mas alimenta extracao XEX, probe e o corte do GOD.
**Severidade:** medio — perda silenciosa de arquivos (e falso "nao e jogo"), mas so em ISOs com arquivo de 0 byte; frequencia no catalogo nao medida (nao ha ISO de Xbox nesta maquina para varrer: busca em `C:\projects`, `Downloads` e `D:\` sem resultado).
**Arquivos a alterar (reserva da onda):**
- `src/server/utils/iso2god.go` — `parseDirSector`: aceitar `size == 0`; parar em `0xFFFF` ou `nameLen == 0`
- `src/server/utils/xdvdfs_dir_test.go` — arquivo NOVO com os testes do fix

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)
- `utils/iso2god.go::parseDirSector` (319-351) — varre o setor em sequencia; para em `left/right == 0xFFFF`, em `size == 0` (linhas 333-335, o defeito) e quando a entrada nao cabe no buffer. Nao devolve erro: o que vem depois do vazio some.
- `utils/iso2god.go::readXDVDFSDirTable` (301-314) — concatena `parseDirSector` de cada setor do diretorio; em erro de leitura faz `break` e devolve o que tem (sem erro).
- `utils/iso2god.go::findInDir` (355) e `extractExecInfo` (422) — sem a entrada, `ErrNoExecutable`. Call-sites: `ProbeISODiscInfo` (1140) <- `handlers_tools.go:62/96/147`, `handlers.go:949`, `pipeline/digital.go:30`, `disc_layout.go:15`, `companion_content.go:158`; `RunIso2GodNative:183`.
- `utils/iso2god.go::maxXDVDFSUsedPrefix` (369) — maior extent da arvore; chamado por `RunIso2GodNative:214`. Com entradas puladas pode subestimar `usedSize` (nao provado). O fix so pode aumentar o valor.
- `utils/iso2god.go::ExtractXEXFolderFromISO` (1452) -> `findXEXRootDirRecursive` (1427) -> `xdvdfsExtractRecursive` (1477) -> `xdvdfsExtractFile` (1497). Call-sites: `pipeline/stage_checkpoint.go:342` (`extractXEXResilient`) e `handlers_tools.go:160` (rota `POST /tools/iso2xex`, tela "ISO para XEX").
- `xdvdfsExtractFile` com `size == 0`: o laco nao roda, `remaining == 0`, cria o arquivo vazio e renomeia — ja suporta arquivo vazio. Diretorio com `size == 0`: `readXDVDFSDirTable` calcula 0 setores e devolve nada — ja suporta.
- `ProbeISOInstallLayout::hasRegularFile` ja filtra `entry.size > 0`; `ProbeContentPackageTitleID` pula `e.size < 0x364`. Nenhum dos dois quebra com entradas vazias passando a aparecer.

### Provas (comando literal -> resultado)
- Harness da sessao de 2026-10-09 (tabela da secao Evidencia): raiz real com 2 vazios -> `ExtractXEXFolderFromISO` `err=<nil>`, 41 de 49; controle com 1 byte -> 49 de 49; vazio antes do `default.xex` -> `ErrNoExecutable`.
- `grep -rn "parseDirSector\|readXDVDFSDirTable" src/server --include=*.go` -> so `utils/iso2god.go` usa o leitor; nenhum outro parser XDVDFS no repo.
- Fixtures de teste existentes (`utils/god_validate_test.go::writeTestXDVDFSDir`, `pipeline/disc_layout_test.go::writeTestDirEntry`) terminam a tabela com `0xFFFF`; nenhuma depende da parada em `size == 0`.

### Hipoteses descartadas (e por que)
- "Parar em `size == 0` protege setor preenchido com zeros": uma entrada zerada tambem tem `nameLen == 0`; parar em `nameLen == 0` cobre o mesmo caso sem perder arquivo vazio.
- "Subir `stageCheckpointVersion` para invalidar extracoes antigas": invalidaria checkpoints de todas as fases (inclusive GOD de horas). Checkpoint XEX incompleto de antes do fix so sobrevive em job interrompido atravessando a atualizacao; fica como limitacao conhecida.
- "Mudar `xdvdfsExtractFile` para arquivo vazio": ja trata 0 byte (aberto acima).

### Tarefas
- [x] `src/server/utils/iso2god.go::parseDirSector` — remover a parada em `size == 0`; parar em `left == 0xFFFF || right == 0xFFFF` ou `nameLen == 0`; atualizar o comentario citando `[[backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio-e-extrai-iso-incompleta-sem-erro_2026-10-09T20-20]]` — testes abaixo.
- [x] `src/server/utils/xdvdfs_dir_test.go` (novo) — (a) setor sintetico: entrada normal, vazia (`size 0`, setor != 0), duas normais, `0xFFFF` -> 4 entradas; (b) uma entrada seguida de zeros -> 1 entrada; (c) ISO sintetica (helpers ja existentes do pacote: `writeDiscXEX` de `companion_disc_test.go` para o executavel, layout de `buildInstallDiscTestISO`) com vazio ANTES do `default.xex`: `ProbeISODiscInfo` ok e `ExtractXEXFolderFromISO` extrai todos, o vazio com 0 byte; (d) `maxXDVDFSUsedPrefix` enxerga o extent que vem depois do vazio. Cada teste falha sem o fix.
- [x] `CHANGELOG.md` `[Unreleased]` `### Fixed` (fora da reserva, merge=union).

- **Nota do dev (2026-10-11):** `maxXDVDFSUsedPrefix` tambem passa a ignorar entrada com `size == 0`. Com o leitor corrigido, arquivos vazios entram na varredura; o setor de um extent de 0 byte nao ocupa nada e pode apontar para alem do fim da imagem (o `extract-xiso` grava o "setor atual"; outras ferramentas, lixo), o que acusaria `ISO truncada` em `RunIso2GodNative`. Ainda vale "o fix so pode aumentar o valor" em relacao a base, que nem via essas entradas.

### Plano de teste
- **Offline (sem slot):** `go test -count=1 ./utils/` em `src/server` com os testes novos; conferir que (a), (c) e (d) falham com a linha antiga restaurada.
- **T2 reproducao como o usuario (E2E, no slot):** tela "ISO para XEX" (menu Ferramentas). Partida: duas ISOs sinteticas na evidencia, montadas por script descartavel com o mesmo layout do teste (c): `A.iso` = `default.xex`, `vazio.bin` (0 byte), `z1.txt`, `z2.txt`, pasta `sub\inner.txt`; `B.iso` = `aaa.ini` (0 byte) antes do `default.xex`. Acoes: "Adicionar ISOs" (dialogo nativo stubado no Playwright via `electronApp.evaluate` sobre `dialog.showOpenDialog`), "Pasta de saida" (pasta local na evidencia), "Extrair 2 ISOs para XEX". Sinal: a linha de cada ISO mostra "Saida: ..." (verde) e a pasta tem TODOS os arquivos, `vazio.bin`/`aaa.ini` com 0 byte (`Get-ChildItem -Recurse` na evidencia). Complemento: `POST /tools/probe-iso` com `B.iso` responde ok com o TitleID.
- **Controle positivo:** mesma receita no codigo da base: `A.iso` termina "sucesso" sem `z1.txt`, `z2.txt` e `sub` (so `default.xex` e `vazio.bin`, se este vier antes deles); `B.iso` mostra erro em vermelho `Probe failed: no game executable (default.xex / default.xbe) found in ISO root`.
- **T3 regressao direcionada:** `go test -count=1 ./...` em `src/server` (linha de base 9 `ok`) — cobre `TestProbeISOInstallLayout*`, `TestExtractXDVDFSContentToDirNilInfoSafe`, `TestMaxXDVDFSUsedPrefix*` e `pipeline/disc_layout_test.go`; `npm --prefix src/electron-app run test:safety` (258/0). Na UI, "ISO para GOD" com `A.iso` conclui sem erro. Falta para close: ISO retail real com arquivo vazio (EA FC 26) instalada como XEX no console.
### Sessoes seguintes
- dev: effort high, ultrathink nao — mudanca de uma condicao, mas o manual pede high na extracao e os testes exigem montar tabela XDVDFS byte a byte.
- teste: effort medium, ultrathink nao — receita fechada; o trabalho e montar as ISOs sinteticas e stubar o dialogo.

## Correcao (pipeline 20261010-2242, rodada 1)

- `src/server/utils/iso2god.go::parseDirSector` — removida a parada em `size == 0`; para em `left/right == 0xFFFF` (como antes) ou em `nameLen == 0` (registro zerado, o caso que a linha antiga queria cobrir). Arquivo vazio passa a ser entrada normal. Comentario da funcao cita `[[backend-iso2god-leitor-xdvdfs-para-no-primeiro-arquivo-vazio-e-extrai-iso-incompleta-sem-erro_2026-10-09T20-20]]`.
- `src/server/utils/iso2god.go::maxXDVDFSUsedPrefix` — `continue` para entrada com `size == 0` (nota do dev no Planejamento): extent de 0 byte nao ocupa nada; sem isso, um vazio com setor alem do EOF faria `RunIso2GodNative` recusar a ISO como truncada. Diretorio de 0 byte ja nao tinha o que percorrer.
- Sem mudanca em `xdvdfsExtractFile` (ja cria arquivo de 0 byte) nem nos demais consumidores de `readXDVDFSDirTable` (abertos: `hasRegularFile` exige `size > 0`, `ProbeContentPackageTitleID` exige `size >= 0x364`, `findXEXRootDirRecursive` e `xdvdfsExtractRecursive` so ganham entradas).
- `src/server/utils/xdvdfs_dir_test.go` (novo):
  - `TestParseDirSectorKeepsEntriesAfterZeroByteFile` — (a) 4 entradas com um vazio (setor != 0) no meio.
  - `TestParseDirSectorStopsAtZeroFilledEntry` — (b) entrada seguida de zeros -> 1 entrada (guarda a parada antiga; passa com e sem o fix).
  - `TestProbeISODiscInfoFindsExecutableAfterZeroByteFile` e `TestExtractXEXFolderFromISOExtractsEveryFileAroundZeroByteFiles` — (c) ISO sintetica com `aaa.ini` (0 byte) antes do `default.xex` (gerado por `writeDiscXEX`), `vazio.bin` (0 byte), `z1.txt`, `z2.txt`, `sub/inner.txt`: probe devolve `TitleID 454109F4`; extracao traz os 6 arquivos com os tamanhos certos (vazios com 0 byte).
  - `TestMaxXDVDFSUsedPrefixSeesExtentAfterZeroByteFile` — (d) vazio com setor `0x7fffffff` antes de `game.bin`: o prefixo e o fim de `game.bin`.
- Provas offline (em `src/server`):
  - `go test -count=1 ./utils/` -> `ok`; `go test -count=1 ./...` -> todos os pacotes com teste `ok` (sem `FAIL`).
  - Controle com `iso2god.go` da base (`git show HEAD:...`): `go test -count=1 -run 'ZeroByte|ZeroFilled' ./utils/` -> FAIL em (a) `got entries [default.xex]`, nos dois de (c) e em (d) `got max prefix 69632, want 132306`.
  - Controle sem o `continue` de `maxXDVDFSUsedPrefix`: (d) FAIL `got max prefix 4398046509056, want 132306`.
- `CHANGELOG.md` `[Unreleased]` `### Fixed`. Sem rota/IPC/servico novo: doc-sync nao se aplica. Versao nao sobe (manual, secao Dev).
- Plano de teste: sem ajuste. O T2 da tela "ISO para XEX" segue a receita do Planejamento; as ISOs sinteticas podem copiar o layout de `buildZeroByteFileTestISO` (setor 0x20 = descritor, raiz em 0x21).
