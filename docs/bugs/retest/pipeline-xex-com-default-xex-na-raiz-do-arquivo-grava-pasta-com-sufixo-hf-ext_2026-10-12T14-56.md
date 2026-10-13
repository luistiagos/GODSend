# Bug: jogo XEX cujo arquivo traz `default.xex` na raiz e gravado numa pasta com o sufixo de scratch `_hf_ext` (e sem TitleID)

## Status

- **Corrigido e testado:** 2026-10-13 (pipeline 20261012-1854, rodada de teste 1, aprovado). Fix: `5714370`.
- **Onde:** `src/server/services/pipeline/companion_content.go::ripFolderName` (novo: `""` quando o `default.xex` esta na
  raiz do arquivo extraido) e `::xexDestinationName` (nome vazio -> titulo da release); call-sites
  `huggingface.go::ProcessHuggingFaceGameWithErr`, `minerva.go::ProcessMinervaGameWithErr`/`ProcessMinervaGenericGameWithErr`,
  `digital.go::ProcessGenericGameWithErr`, `pipeline.go::ProcessGameWithErr`.
- **Evidencia:** `C:\projects\.bugfix-xbox360\evidencia\20261013-0449-pipeline-xex-default-xex-raiz-hf-ext\`.
  - Offline: `go vet ./services/pipeline/` limpo; `go test -count=1 ./services/pipeline/ ./infrastructure/helpers/` ok;
    os 7 `TestXexDestinationName*`/`TestRipFolderName*` PASS.
  - **T2 (cliente, pela UI do app da lane, Playwright `t2.cjs`; destino = pendrive de teste `E:`, serial `247700023090`
    confirmado, lock criado e removido):** Baixar Jogos -> filtro "Master System" -> "EMULADOR MASTER SYSTEM + 376 ROMS" ->
    XEX -> Adicionar a fila -> "Gravado no dispositivo!".
    - Controle positivo (base `6b3a61b`, lane destacada para `pipeline.py build`; backend PID 13612 da lane wt-4):
      `LOCAL XEX: 2216 arquivos (0.16 GB) -> E:\Games\EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )_hf_ext`
      (`t2-base-log-janela.txt`, `t2-base-result.json`) — sintoma presente.
    - Fix (`5714370`, backend PID 15260 da lane wt-4, banner na Home):
      `LOCAL XEX: 2216 arquivos (0.16 GB) -> E:\Games\EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )`; pasta com esse
      nome, 2.216 arquivos, `default.xex`, sem marcador, nenhuma pasta `*_hf_ext` em `E:\Games` (`t2-fix-*`). Sem TitleID,
      correto para este homebrew (sem `0x40006`, ver Planejamento).
  - **T3:** (1) XEX com subpasta propria pela UI (Digimon All Star Rumble, `t2-t3-digimon-*`):
    `-> E:\Games\Digimon All Star Rumble (0.421) - 4E4D0869`, `title_id 4E4D0869` — inalterado. (2) `go test -count=1 ./...`
    em `src/server` rc 0, 10 pacotes `ok` (`t3-go-test-all.txt`); `test:safety` 339 pass / 0 fail (`t3-test-safety.txt`).
  - **T4:** logs das tres janelas: so o erro de CSP das fontes do Google (pre-existente) e `QUEUE RESUME ... restaurado
    como Erro` da fila antiga da lane (`pending_queue/`, igual na base). Nenhum erro do backend.
- **Falta para `closed/`:** versao publicada (subida de versao + `build-and-upload.ps1`, do dono); nome da pasta no HD
  por FTP ao console (sem console de teste); IA/Minerva/generico com `default.xex` na raiz so pelo teste de unidade do
  helper comum (sem caso de catalogo conhecido); prova do cliente. Pastas ja gravadas com `_hf_ext` nao sao migradas.

- **Detectado em:** 2026-10-12 14:56 (teste local do pipeline, sessao de teste do bug
  `pipeline-jogo-xex-com-145-mil-arquivos-leva-mais-de-10-horas-para-gravar-em-pendrive-fat32_2026-10-09T19-40`)
- **Origem:** `src/server/services/pipeline/huggingface.go` (linha 71: `xexDestinationName(xexFolder, filepath.Base(xexFolder), gameName)`)
- **Errors (servico):** N/A (local)
- **Classe:** ux
- **Versoes:** 2.12.110 (`origin/main` @ `50dcfe9`, binario SEM o fix do bug acima) e o branch desse bug — igual nos dois
- **Reincidencia:** primeira vez
- **Severidade (sugerida):** P3 — o jogo grava inteiro e correto; so o nome da pasta no pendrive fica feio e sem TitleID

## Sintoma

App da lane `wt-1` em modo dev, Catalogo -> "EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )" (catalogo HF
`luisluis123/xboxrghgames`, `.zip` com `default.xex` na RAIZ do arquivo, 2.216 arquivos) -> XEX -> pendrive de teste `E:\`.
Log do backend:

```
[14:50:44] LOCAL XEX: 2216 arquivos (0.16 GB) -> E:\Games\EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )_hf_ext
```

A pasta no pendrive fica `E:\Games\EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )_hf_ext`: o sufixo `_hf_ext` e o nome
da pasta de extracao (scratch), e nao ha ` - <TitleID>`. Um jogo cujo arquivo traz uma subpasta (ex.: Digimon All Star
Rumble no mesmo teste) grava `Digimon All Star Rumble (0.421) - 4E4D0869`, correto.

Evidencia: `C:\projects\.bugfix-xbox360\evidencia\20261012-teste-r1-pipeline-jogo-xex-145-mil\t2-base-log-janela.txt`
(linha `LOCAL XEX`) e `t2-base-result.json` (`pastaJogo`).

## Causa raiz (a confirmar na investigacao)

- `huggingface.go` linha 61: `extDir := filepath.Join(s.outputRoot(gameName), safeName+"_hf_ext")`.
- Linha 68: `xexFolder := helpers.FindXEXFolder(extDir)` — com `default.xex` na raiz do arquivo, `xexFolder == extDir`.
- Linha 71: `xexDestinationName(xexFolder, filepath.Base(xexFolder), gameName)` -> o nome-base e `<safeName>_hf_ext`.
  `companion_content.go::xexDestinationName` so troca nomes genericos de disco (`IsGenericDiscFolderName`), nao o sufixo de
  scratch; `helpers.go::XEXFolderName` nao acrescentou TitleID (provavelmente `FindTitleIDInDir` voltou vazio ou o
  `SystemTitleID` para este homebrew — nao conferido).
- Nao conferido: se os outros provedores (torrent `_ext`/`_extracted`, Minerva, IA) tem o mesmo padrao quando o
  `default.xex` esta na raiz (`workspace.go` lista os sufixos `_hf_ext`, `_ext`, `_extracted`, `_torrent`).

## Como reproduzir

1. App em modo dev (`npm start` numa lane), destino local = uma pasta/pendrive.
2. Catalogo -> filtrar "Master System" -> "EMULADOR MASTER SYSTEM + 376 ROMS" -> XEX -> Adicionar a fila.
3. Ver o log `LOCAL XEX: ... -> <destino>\Games\<nome>_hf_ext`.

## Resolucao

(a definir)

## Testes Automatizados

(a definir — teste de `xexDestinationName`/caminho HF com `default.xex` na raiz do `extDir`)

## Criterios para fechar

- [ ] Reproducao confirmada e compreendida
- [ ] Causa raiz isolada e corrigida (nome = titulo do jogo, sem sufixo de scratch, com TitleID quando houver)
- [ ] Teste unitario cobrindo `default.xex` na raiz do arquivo
- [ ] Validacao no app (pasta gravada com o nome certo)

## Planejamento (pipeline 20261012-1854, 2026-10-12)

**Veredito:** corrigir — o nome-base do destino XEX sai de `filepath.Base(xexFolder)`, que e a pasta de extracao
(scratch) quando o `default.xex` esta na raiz do arquivo; isso acontece nos CINCO caminhos XEX de arquivo extraido (HF,
IA, generico, Minerva x2), nao so no HF.
**Complexidade:** media — logica nova (pequena) num servico Go (`services/pipeline`), sem tocar extracao, gravacao,
fila nem formatacao; pelo `docs/bugs/open/README.md` e "logica nova num servico Go".
**Severidade:** baixo — o jogo grava inteiro e funciona; so o nome da pasta (no pendrive, no HD e em "Jogos
Instalados") fica com o sufixo de scratch. A falta de TitleID e correta para este homebrew (ver Provas).
**Arquivos a alterar (reserva da onda):**
- `src/server/services/pipeline/companion_content.go` — `xexDestinationName` trata "rip sem pasta propria" como
  marcador generico (usa o titulo da release); helper novo que da o nome da pasta do rip ou vazio quando
  `xexFolder == extDir`
- `src/server/services/pipeline/companion_content_test.go` — testes novos
- `src/server/services/pipeline/huggingface.go` — linha 71 usa o helper
- `src/server/services/pipeline/minerva.go` — linhas 76 e 221 usam o helper
- `src/server/services/pipeline/digital.go` — linha 206 usa o helper
- `src/server/services/pipeline/pipeline.go` — linha 226 usa o helper

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `services/pipeline/huggingface.go::ProcessHuggingFaceGameWithErr` (l.28-258) — `extDir := filepath.Join(s.outputRoot(gameName), safeName+"_hf_ext")` (l.61);
  `xexFolder := helpers.FindXEXFolder(extDir)` (l.68); `folderName = xexDestinationName(xexFolder, filepath.Base(xexFolder), gameName)` (l.71).
  O `folderName` vai para `InstallXEXLocal` (local), `FTP.TransferXEX`/`PendingFTPJob.FolderName` (FTP) e
  `updateGameINI_XEX` (manual). `outputRoot` = `s.App.TempDir` (`workspace.go:18`).
- `infrastructure/helpers/helpers.go::FindXEXFolder` (l.247) — `filepath.Walk(dir)` e devolve `filepath.Dir(p)` de cada
  `default.xex`; com o `default.xex` na raiz, devolve o proprio `dir` (= `extDir`, ja limpo por `filepath.Join`). Sem
  `default.xex`: `""`.
- `services/pipeline/companion_content.go::xexDestinationName` (l.26) — troca so nome de disco generico
  (`helpers.IsGenericDiscFolderName`, regex `^(game|install...)?(disco|disc|disk|dvd|cd)[ _.-]*[0-9]*$`) pelo
  `SanitizeFilename(models.ExtractReleaseTitle(gameName))`; qualquer outro nome passa direto a `helpers.XEXFolderName`.
  `"<nome>_hf_ext"` nao casa a regex -> fica como esta.
- `infrastructure/helpers/helpers.go::XEXFolderName` (l.296) — acrescenta ` - <TitleID>` de `FindTitleIDInDir`; sem
  TitleID (ou `SystemTitleID`, ou nome ja terminado no TitleID) devolve o nome cru, SEM corte de 42 (ver bug lateral).
- `helpers.go::FindTitleIDInDir` (l.316) — 1) `utils.ExtractTitleIDFromFile(default.xex)`; 2) estrutura GOD; 3) walk ate
  3 niveis por `.xex`/cabecalho STFS. Erro em cada etapa = segue para a proxima; nada achado = `""`.
- `utils/iso2god.go::ExtractTitleIDFromFile`/`parseXEX2` (l.523/462) — le 64 KiB, procura o cabecalho opcional
  `0x00040006` (execution info); ausente -> erro `XEX2 execution-info optional header (0x40006) not found`.
- `models/compat.go::ExtractDiscInfo` (l.124) — `ReleaseTitle` = nome sem tags de disco/papel de disco; para
  "EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )" fica igual (nenhum grupo com `disc|dlc|install|...`).
- Mesmo padrao `filepath.Base(xexFolder)` com `xexFolder := helpers.FindXEXFolder(extDir)` (grep abaixo):
  `digital.go::ProcessGenericGameWithErr` l.206 (`extDir = TempDir/<safe>_ext`), `minerva.go::ProcessMinervaGameWithErr`
  l.76 (`_mext`), `minerva.go::ProcessMinervaGenericGameWithErr` l.221 (`_mgext`), `pipeline.go::ProcessGameWithErr`
  l.226 (`_ext`). Em todos, raiz -> pasta `<safeName>_ext`/`_mext`/`_mgext`. Os ramos "ISO dentro do arquivo" ja usam
  `folderName = safeName` (correto).
- `workspace.go::samePath` (l.37) — `filepath.Abs` + `Clean` dos dois lados; em erro do `Abs`, `a == b`. Reaproveitavel.
- `workspace.go::cleanupGameScratchInternal`/`scratchRoots` — so apagam `<TempDir>/<safe><sufixo>` e
  `<LocalRoot>/<localScratchFolder>/...`, nunca `<LocalRoot>/Games/...`: a pasta gravada com sufixo nao corre risco de ser
  apagada como scratch (descartado como agravante).

### Provas (comando literal -> resultado)

- `grep -rn "filepath.Base(xex\|FindXEXFolder(" --include=*.go src/server | grep -v _test` -> 5 derivacoes de nome a partir
  de `filepath.Base(xexFolder)`: `digital.go:206`, `huggingface.go:71`, `minerva.go:76`, `minerva.go:221`,
  `pipeline.go:226` (+ `FindXEXFolder` nas linhas acima de cada uma).
- Arquivo real baixado para `C:\Users\luist\.claude\jobs\9103a172\tmp\dl\ms.zip` (`curl -sL` da URL do
  `cache/hf_xbox360.json`, 103.230.435 B) e lido com `zipfile` (python -I): 2264 entradas; raiz =
  `configuration/ covers/ default.xex gameguides/ media/ retroarch.cfg roms/ ...`; um so `.xex` (`default.xex`, 5.419.008 B,
  magic `XEX2`). -> `default.xex` na RAIZ confirmado; `FindXEXFolder(extDir) == extDir`.
- Cabecalhos opcionais do `default.xex` (parse `>II` a partir do byte 24, contagem em `[20:24]`): 11 chaves —
  `0x3ff 0x10100 0x10201 0x103ff 0x18002 0x183ff 0x200ff 0x20104 0x20200 0x30000 0x40404`; **nenhuma `0x40006`** -> o
  homebrew (RetroArch) NAO tem TitleID; `FindTitleIDInDir` devolver `""` e correto, e o log
  `GODSEND_LOCAL_COMPLETE:{..."title_id":""}` confirma. "Com TitleID quando houver" = nao ha, neste caso.
- Evidencia do sintoma: `evidencia\20261012-teste-r1-pipeline-jogo-xex-145-mil\t2-base-log-janela.txt:140` e
  `t2-fix-log-janela.txt:141`: `LOCAL XEX: 2216 arquivos (0.16 GB) -> E:\Games\EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )_hf_ext`
  (base 50dcfe9 e fix do outro bug — igual nos dois); `t2-fix-log-janela.txt:145` mostra "Jogos Instalados" listando a
  pasta `..._hf_ext`.

### Hipoteses descartadas (e por que)

- "`XEXFolderName` deixou de acrescentar o TitleID" — descartada: o executavel nao tem execution-info (`0x40006`), entao
  nao ha TitleID a acrescentar; o Digimon do mesmo teste ganhou `- 4E4D0869` normalmente.
- "So o HF tem o problema" — descartada pelo grep: IA (`pipeline.go`), generico (`digital.go`) e Minerva (x2) derivam o
  nome do mesmo jeito; corrigir so o HF deixaria `<nome>_ext`/`_mext`/`_mgext` nos outros.
- "Tirar o sufixo com `strings.TrimSuffix` dos sufixos de scratch" — rejeitada: frágil (lista de sufixos em
  `workspace.go` muda), e um rip cuja pasta legitima termine em `_ext` seria mutilado. Comparar `xexFolder` com `extDir`
  e exato.
- "Usar `safeName` em vez do titulo da release" — preterida: com `default.xex` na raiz de uma entrada de catalogo
  Redump "(Disc 2)" o nome levaria a tag de disco; o titulo da release (`ExtractReleaseTitle`) e o que
  `xexDestinationName` ja usa para o marcador generico, e para nomes sem tag de disco e igual ao `safeName`.
- "A pasta com sufixo seria apagada pela limpeza de scratch" — descartada (`scratchRoots` nao inclui `LocalRoot/Games`).
- "Migrar pastas ja gravadas com sufixo" — fora do escopo (mesma ressalva da 2.12.81): reinstalar cria a pasta nova ao
  lado da antiga.

### Tarefas

- [x] `src/server/services/pipeline/companion_content.go` — helper novo (ex.: `ripFolderName(xexFolder, extDir string) string`)
  que devolve `""` quando `samePath(xexFolder, extDir)` (o rip nao tem pasta propria) e `filepath.Base(xexFolder)` no
  resto; e `xexDestinationName` passa a tratar `archiveFolder == ""` como o marcador generico (titulo da release; se ele
  vier vazio, `helpers.SanitizeFilename(gameName)`), para nunca chamar `XEXFolderName` com nome vazio. Comentario cita
  `[[pipeline-xex-com-default-xex-na-raiz-do-arquivo-grava-pasta-com-sufixo-hf-ext_2026-10-12T14-56]]`.
  Teste: ver a tarefa de testes.
- [x] `huggingface.go:71`, `minerva.go:221` — `xexDestinationName(xexFolder, ripFolderName(xexFolder, extDir), gameName)`.
- [x] `digital.go:206`, `minerva.go:76`, `pipeline.go:226` — `folderName = ripFolderName(xexFolder, extDir)` (o
  `xexDestinationName` logo abaixo ja existe). Os ramos ISO (`folderName = safeName`) nao mudam.
- [x] `src/server/services/pipeline/companion_content_test.go` — (a) pasta `t.TempDir()/X_hf_ext` com `default.xex`
  falso na raiz e SEM TitleID: `xexDestinationName(dir, ripFolderName(helpers.FindXEXFolder(dir), dir), "EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )")`
  == `"EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )"` (sem `_hf_ext`); (b) idem com TitleID (`writeXexRipFolder`) e
  nome curto -> `"<titulo> - <TitleID>"`; (c) `ripFolderName` de subpasta devolve o nome da subpasta (os 3 testes
  existentes continuam verdes); (d) gameName com "(Disc 2)" e raiz -> titulo sem a tag. Mutacao: voltar o call-site/helper
  para `filepath.Base` faz (a) falhar.
- [x] `CHANGELOG.md` `[Unreleased]` `### Fixed` (fora da reserva, `merge=union`), citando os 5 pontos e o doc.

### Plano de teste

- **Offline (sem slot):** `go test -count=1 ./services/pipeline/ ./infrastructure/helpers/` (testes novos acima) e
  `go vet ./services/pipeline/`. Prova a regra de nome nos 5 provedores pelo helper comum.
- **T2 reproducao como o usuario (E2E, no slot):** o caminho do achado. App da lane em modo dev (`npm start` via
  Playwright `_electron.launch`; reaproveitar `evidencia\20261012-teste-r1-pipeline-jogo-xex-145-mil\t2.cjs` + `lib.cjs`,
  cujo unico stub e a lista de unidades devolver so o pendrive; `config.json` do dev copiado antes e devolvido, com
  `"simpleMode": false` so durante o teste). Destino: pendrive de teste serial `247700023090` (confirmar com
  `Get-Disk | Where-Object SerialNumber -eq '247700023090'`, lock `C:\projects\.pendrive-teste-247700023090.lock`;
  precisa de ~0,2 GB livres) — ou uma pasta local, se a UI a oferecer: o bug nao depende de FAT32. Acoes: Baixar Jogos
  -> filtro "Master System" -> "EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )" -> XEX -> Adicionar a fila -> esperar
  "Gravado no dispositivo!". **Sinal:** linha `LOCAL XEX: 2216 arquivos (0.16 GB) -> <destino>\Games\EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )`
  SEM `_hf_ext`; pasta com esse nome no destino, com `default.xex` e 2.216 arquivos; nenhuma pasta `*_hf_ext` em
  `<destino>\Games`; "Jogos Instalados" (linha `APP_BROWSE varredura...`) sem `_hf_ext`. Apagar do pendrive as pastas
  gravadas pelo teste no fim (base e fix).
- **Controle positivo:** com a lane destacada na base (`pipeline.py build` na base, como a rodada r1 do bug vizinho
  fez) o mesmo caminho grava `...( XBOX 360 RGH )_hf_ext` — ja observado em `t2-base-log-janela.txt:140`; repetir
  no slot para ter base e fix na mesma sessao.
- **T3 regressao direcionada:** (1) jogo XEX com subpasta propria (o Digimon All Star Rumble do teste r1, ou outro XEX
  pequeno do HF com pasta) continua `"<pasta do rip> - <TitleID>"`; (2) testes existentes de nome
  (`TestXexDestinationName*`, `xex_folder_name_test.go`) verdes; (3) `go test -count=1 ./...` em `src/server` e
  `npm --prefix src/electron-app run test:safety` sem `fail` novo (linha de base: Go rc 0; `test:safety` 327/0 na r1).
  IA/Minerva/generico com raiz nao tem caso de catalogo conhecido: cobertos pelo teste de unidade do helper comum.
- **Falta para close:** FTP ao console (nome no HD) — sem console de teste; versao publicada.

### Sessoes seguintes

- dev: effort medium, ultrathink nao — troca mecanica em 5 call-sites + helper de 5 linhas + testes; a regra ja esta
  decidida aqui.
- teste: effort medium, ultrathink nao — T2 reaproveita o roteiro Playwright da r1; o sinal e uma linha de log e um
  nome de pasta.

**Bug lateral aberto:** [`pipeline-nome-de-pasta-xex-sem-titleid-com-mais-de-42-caracteres-nao-e-cortado-para-o-hd-fatx_2026-10-12T19-15.md`](pipeline-nome-de-pasta-xex-sem-titleid-com-mais-de-42-caracteres-nao-e-cortado-para-o-hd-fatx_2026-10-12T19-15.md)
— `XEXFolderName` so corta em 42 quando ha TitleID; este homebrew (51 caracteres, sem TitleID) iria cru ao HD FATX por FTP.
Nao faz parte deste fix (o nome atual `..._hf_ext` ja e mais longo; o fix nao piora).

## Correcao (pipeline 20261012-1854, rodada 1)

O plano foi seguido sem desvio.

- `services/pipeline/companion_content.go::ripFolderName(xexFolder, extDir)` (novo) — `""` quando
  `samePath(xexFolder, extDir)` (o `default.xex` esta na raiz do arquivo, a pasta e o scratch), senao
  `filepath.Base(xexFolder)`.
- `companion_content.go::xexDestinationName` — `archiveFolder == ""` e tratado como o marcador generico de disco: nome =
  `SanitizeFilename(ExtractReleaseTitle(gameName))`; se vier vazio, `SanitizeFilename(gameName)`. Nunca chama
  `XEXFolderName` com nome vazio. TitleID continua vindo de `XEXFolderName`.
- Call-sites: `huggingface.go::ProcessHuggingFaceGameWithErr` e `minerva.go::ProcessMinervaGenericGameWithErr` passam
  `ripFolderName(xexFolder, extDir)` a `xexDestinationName`; `minerva.go::ProcessMinervaGameWithErr`,
  `digital.go::ProcessGenericGameWithErr` e `pipeline.go::ProcessGameWithErr` atribuem `folderName = ripFolderName(...)`
  (o `xexDestinationName` seguinte ja existia). Ramos ISO (`folderName = safeName`) intocados.
- Testes novos em `companion_content_test.go`: `TestXexDestinationNameNamesARootRipAfterTheReleaseNotTheScratchDir` (o caso
  do achado, sem TitleID), `TestXexDestinationNameAddsTheTitleIDToARootRip` (`Halo 3 - 4D5307E6`),
  `TestXexDestinationNameDropsTheDiscTagFromARootRip` (`(Disc 2)` + raiz -> `Grand Theft Auto V (USA)`),
  `TestRipFolderNameKeepsTheRipsOwnFolder`.
- Provas offline: `go vet ./services/pipeline/` limpo; `go test -count=1 ./services/pipeline/ -run 'XexDestination|RipFolder' -v`
  -> 7 PASS (3 antigos + 4 novos). Mutacao (`if false && samePath(...)` em `ripFolderName`) -> 3 dos novos FALHAM
  (`obtido "..._hf_ext"`, `"Halo 3_ext - 4D5307E6"`, `"..._mgext"`); arquivo restaurado.
- Compile-check: `pipeline.py build` rc=0 (build-server x64/ia32 + `tsc` + `renderer:typecheck`).
- `CHANGELOG.md` `[Unreleased]` `### Fixed`: entrada nova.
- Plano de teste: sem ajuste.
