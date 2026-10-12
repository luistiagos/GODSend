# Bug: gravar no HD falha em `mkdir D:\Games\<jogo>` com "O sistema não pode encontrar o caminho especificado", com o dispositivo presente, e a mensagem manda o cliente (e o agente) procurar um pendrive desconectado

- **Detectado em:** 2026-10-04 23:28 (chamado #144 do painel, sessão `165291833184337@lid`, telefone `553196998502`)
- **Origem:** conversa de suporte + telemetria `xbox-360-companion/pipeline` (`fallback.go::ProcessGameWithFallback`) + leitura de `src/server/services/pipeline/local_resilient.go` (`Service.copyTreeLocal` / `Service.copyFileLocal`, `copyLocalEntry`, `localDeviceMatches`)
- **Errors (serviço):** 6938, 7026, 7031, 7162, 7166, 7169, 7202, 8560, 8565 (9 reports, 2026-09-16 12:28 → 2026-09-25 13:49 UTC, todos com `status = close` na telemetria e **nenhum** citado em doc: grep pelos ids em `docs/` = 0)
- **Classe:** falha funcional (recorrente, sem crash)
- **Severidade:** **P2 — Médio** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): o download é preservado para nova tentativa, mas a cliente do #144 ficou pelo menos 2 dias sem conseguir gravar jogos no HD, com 5 jogos diferentes. Subir para P1 se a medição mostrar que o volume fica inutilizável.
- **Complexidade:** média — a causa não está provada; o primeiro passo é instrumentar
- **Versões:** desconhecidas. O report do pipeline não carrega versão nem máquina (`user_agent = 'pipeline'`, `screen = NULL`), e o log anexo (`error_logs`) dos ids 7026, 7202 e 8565 é um segmento único de ~181 caracteres, igual à mensagem
- **Reincidência:** primeira vez como sintoma próprio. Vizinhos, sem cobrir este caso: [[backend-volume-temp-autoselecionado-indisponivel-derruba-backend_2026-09-13T15-59]] (scratch em `D:\godsend-temp`, dispositivo **ausente**) e [[electron-main-multiplas-instancias-sem-single-instance-lock_2026-09-15T14-44]] (instâncias simultâneas; ids não listados lá)

## Sintoma, na ordem que o cliente viveu

1. 2026-09-14: preparou o HD externo de 2 TB no modo Bloqueado/LT; o volume aparece como
   `BADAVATAR (D:)`. No preparo já houve um erro de `mkdir` no mesmo volume (ver
   [[electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28]]).
2. 2026-09-16 22:53 UTC: *"hoje não estou conseguindo baixar nenhum jogo novamente"*. Print da
   fila: "Disney-Pixar Up" baixando, **erro em "F1 2014"**, "UFC Undisputed 3" pendente.
3. 22:56: print do erro: *"Falha no dispositivo local. O download concluído foi preservado para
   nova tentativa: Gravação local falha no dispositivo local. gravar AvatarAssetPack: mkdir
   D:\Games\F1.2014.USA.X360-ZTM - 434D0852: O sistema não pode encontrar o caminho
   especificado."*
4. 23:01: print do destino do jogo, *"Pendrive (USB)"* e *"D:—BADAVATAR · 1887.7 GB livres"*:
   o destino estava certo.
5. 23:05: print de Este Computador com *"BADAVATAR (D:)"* presente.

## Evidencia

**Telemetria** (`/diag/query`, tabela `errors`, `project LIKE 'xbox-360-companion%'`, mensagem com
`AvatarAssetPack` ou `mkdir` + `caminho especificado`; 9 linhas, todas no mesmo formato):

| id | hora (UTC) | arquivo que falhou | pasta do `mkdir` |
|---|---|---|---|
| 6938 | 09-16 12:28 | `0L` | `D:\Games\College.Hoops.2K8.USA.X360-ZTM - 54540818` |
| **7026** | **09-16 22:51** | `AvatarAssetPack` | `D:\Games\F1.2014.USA.X360-ZTM - 434D0852` |
| 7031 | 09-16 23:42 | `AvatarAssetPack` | `D:\Games\Dragon.Ball.Z.USA.X360-ZTM - 4E4D084E` |
| 7162 | 09-17 14:27 | `AvatarAssetPack` | `D:\Games\Dragon.Ball.Z.USA.X360-ZTM - 4E4D084E` |
| 7166 | 09-17 15:04 | `Data00.packed` | `D:\Games\Castlevania.Lords.of.Shadow.2…` |
| 7169 | 09-17 15:14 | `8E0A912724F258B7EFC5` (GOD) | `D:\Games\Toy Story 3 - 425607E5` |
| 7202 | 09-17 19:03 | `AvatarAssetPack` | `D:\Games\UFC.Undisputed.2010.USA.X360-ZT - 54510851` |
| 8560 | 09-25 13:28 | `destructionsound.lxb` | `D:\Games\Kung.Fu.Panda.1.USA.X360-ZTM…` |
| 8565 | 09-25 13:49 | `AvatarAssetPack` | `D:\Games\Left 4 Dead 2 (4.33) - 454108D4` |

O **7026** é o print da cliente: mesmo jogo, mesma pasta, 5 min antes do print. Os demais não
têm como ser atribuídos a uma máquina (sem versão nem id no report).

**O dispositivo estava presente na falha. Provado pelo código**, não pelo relato:
`local_resilient.go` só monta `"%w: gravar %s: %v"` com `ErrLocalDelivery` depois de
`localDeviceMatches(root, expectedID)` devolver **true**, ou seja, depois de o marcador de
identidade gravado na raiz da mídia ser lido e bater. Isso vale nos dois laços
(`copyTreeLocal` e `copyFileLocal`). Com o dispositivo ausente ou trocado, o caminho é
`waitForLocalDevice`. Ainda houve 3 novas tentativas de 1 s (`transientRetries < 3`). O que falha
é o `os.MkdirAll(filepath.Dir(dst), 0755)` de `copyLocalEntry`. `AvatarAssetPack` é só o
primeiro arquivo do jogo (o nome varia entre os 9 reports), então **quem falha é a criação da
pasta do jogo**, não um arquivo.

**Efeito no atendimento:** "Falha no **dispositivo local**" foi lido pelo agente de WhatsApp como
"pasta do computador" e "pendrive desconectou". Os três diagnósticos que ele deu estão errados
(evidência anexada a
`digitalstoregamesproject/docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-08-15-agente-inventa-procedimento-tecnico-sem-regra-de-abstencao.md`).
A mensagem não diz ao cliente o que fazer.

## Hipoteses — nenhuma verificada

1. **Volume FAT32 inconsistente.** A mesma mídia já tinha falhado em `mkdir` no preparo, dois
   dias antes, com um erro `UNKNOWN` do Node. Um `mkdir` com `ERROR_PATH_NOT_FOUND` e o pai
   presente é compatível com estrutura de diretório corrompida. Medir: `chkdsk D:` na mídia de
   um cliente afetado; tamanho/sistema de arquivos dos volumes nos reports (hoje não reportado).
2. **Instâncias simultâneas** (corrigido na v2.12.95 por
   [[electron-main-multiplas-instancias-sem-single-instance-lock_2026-09-15T14-44]]): uma instância
   removendo ou renomeando a pasta do jogo enquanto a outra a cria. Medir: se os reports de 09-25
   (8560, 8565) vierem de versão ≥ v2.12.95, a hipótese cai para eles. Hoje o report não diz a
   versão.
3. **Descartada: o nome da pasta.** São 8 jogos diferentes, com e sem espaço, parênteses e
   ponto; nenhum padrão comum além de `D:\Games\`.

## Escopo — o que NAO e este bug

- Dispositivo **ausente** ou trocado de letra: tem caminho próprio (`waitForLocalDevice`) e doc
  próprio (o do `D:\godsend-temp`).
- A cota do Google Drive de 09-14 (`[108943]`): caminho da planilha, não do Companion.
- A falha do preparo não chegar à telemetria: doc irmão
  [[electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28]].

## Tarefas propostas / Proximos passos

1. Report do pipeline com **versão do app, id anônimo da máquina e sistema de arquivos/tamanho do
   volume de destino**. Sem isso nenhuma das hipóteses se mede.
2. Na falha de `MkdirAll` com o dispositivo presente, anexar ao report o `os.Stat` de cada
   componente do caminho (`D:\`, `D:\Games`) e o código Win32 original (`errors.As` para
   `syscall.Errno`).
3. Mensagem ao usuário que diga o que fazer quando o dispositivo está presente e a gravação
   falha (hoje "Falha no dispositivo local" sugere desconexão). Ex.: verificar o disco
   (`chkdsk`) ou preparar a mídia de novo, conforme a causa que (1) e (2) apontarem.

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** corrigir — a causa no volume não se prova sem o disco do cliente, mas o que este repo
deve fazer está claro: com o dispositivo presente, um `mkdir` que volta "caminho não encontrado"
precisa sair com diagnóstico (código Win32, estado da pasta-pai, sistema de arquivos) e com a ação
certa (verificar o disco), e o ponto onde a pasta do jogo é criada HOJE (`writeInstallInProgressMarker`)
falha sem conferir o dispositivo e sem nada disso.
**Complexidade:** alta — pelo critério do `docs/bugs/open/README.md`, pipeline de gravação
(`src/server/services/pipeline/`); a mudança em si é pequena (2 funções + testes).
**Severidade:** medio — falha com contorno (o download é preservado e há como reparar o volume), num
subconjunto (2 máquinas na telemetria, 10 reports); a mensagem atual levou cliente e agente de suporte
ao diagnóstico errado (desconexão).
**Arquivos a alterar (reserva da onda):**
- `src/server/services/pipeline/fat_directory.go` — `localWriteErrorText` passa a traduzir o erro 3
  (ERROR_PATH_NOT_FOUND) com diagnóstico e ação
- `src/server/services/pipeline/local_resilient.go` — ramo de falha de `writeInstallInProgressMarker`
  em `copyTreeLocal` confere o dispositivo e usa `localWriteErrorText`
- `src/server/services/pipeline/fat_directory_test.go` — teste do texto com erro 3 real
- `src/server/services/pipeline/local_install_marker_test.go` — teste do ramo do marcador

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

O que se sabe, e onde parou:

- `os::MkdirAll` (Go 1.26.6, `GOROOT/src/os/path.go`, aberto) — `Stat(path)`; se falha, recursão no
  pai e então `Mkdir(path)`; se o `Mkdir` falha e `Lstat(path)` não mostra pasta, devolve o erro do
  `Mkdir`. Logo, `mkdir D:\Games\<jogo>: O sistema não pode encontrar o caminho especificado` só sai
  quando `Stat("D:\Games")` respondeu **pasta** e, em seguida, `CreateDirectory("D:\Games\<jogo>")`
  respondeu ERROR_PATH_NOT_FOUND (3). Pasta-pai existindo e criação do filho dizendo "caminho não
  encontrado" não acontece num volume FAT32 sadio; é compatível com a hipótese 1 (estrutura de
  diretório inconsistente). Não há como provar a causa no volume sem o disco.
- `local_resilient.go::copyTreeLocal` (aberto inteiro) — **mudou depois dos reports**: desde
  `431ffe3` (2026-10-09) chama `writeInstallInProgressMarker(dstDir, ...)` ANTES do laço de arquivos.
  É esse `MkdirAll(dstDir)` que cria a pasta do jogo hoje. Em erro devolve
  `"%w: marcar instalacao em andamento em %s: %v"` com `ErrLocalDelivery`, **sem** `localDeviceMatches`
  (um pendrive desconectado nesse instante vira falha seca em vez de `waitForLocalDevice`), **sem**
  as 3 novas tentativas e **sem** `localWriteErrorText`. Ou seja: a falha destes reports, na versão
  atual, sai por este ramo, não mais por `gravar <arquivo>: mkdir ...`.
- `local_resilient.go::writeInstallInProgressMarker` — `os.MkdirAll(dstDir)` + `os.WriteFile` do
  marcador; em erro devolve o erro cru.
- `local_resilient.go::copyLocalEntry` — `MkdirAll(filepath.Dir(dst))` (subpastas) e
  `MkdirAll(filepath.Dir(partial))` (staging na raiz); em erro devolve cru; quem chama decide.
- Laço de `copyTreeLocal` e `copyFileLocal` — no erro de `copyLocalEntryFunc`/`copyLocalEntry`, se
  `localDeviceMatches` é true: 3 novas tentativas de 1 s, depois
  `"%w: gravar %s: %s"` com `ErrLocalDelivery` e `localWriteErrorText(copyErr)`. Se false:
  `waitForLocalDevice`.
- `fat_directory.go::localWriteErrorText` — só traduz o erro 82 (`isFATDirectoryFull`, guardado por
  `runtime.GOOS == "windows"`); qualquer outro erro passa como `err.Error()` (texto do Windows no
  idioma do sistema, por isso "O sistema não pode..." num PC e "The system cannot..." no outro).
- `local_resilient.go::localDeviceMatches` — lê `<raiz>\.xbox-downloader\xbox-companion-device-id` e
  compara com o id do job; é a prova de "dispositivo presente" nos dois laços.
- `fallback.go::ProcessGameWithFallback`/`haltOnLocalStorageFailure` — prefixa
  "Falha no dispositivo local. O download concluido foi preservado para nova tentativa: " + `err.Error()`,
  `LogStatus(Error)` e `telemetry.Report` com o mesmo texto. Por isso o texto de `localWriteErrorText`
  chega tal e qual à fila do usuário E à telemetria: é o único lugar onde o diagnóstico precisa entrar.
- `infrastructure/telemetry/telemetry.go::Report` — `ErrorReport` não tem campo de versão nem de
  máquina; `UserAgent = component`. Não muda neste bug (ver achado lateral abaixo).
- `local_install.go::InstallXEXLocal`/`InstallGameLocal` — destino `<raiz>\<Games|detectado>\<pasta>`;
  `detectExistingGamesDir` acha `Games` por `Stat`. Nada aqui explica o erro 3.
- `helpers/freespace_windows.go::FlushVolumeBuffers` — abre `\\.\D:` com `FILE_SHARE_*` e chama
  `FlushFileBuffers`; em falha de abertura devolve nil. Não desmonta nem trava o volume: descartada
  como causa de corrida com outro job.
- Ação para o usuário que já existe no app: `renderer/components/UsbGamesPage.tsx` ("Jogos
  Instalados") tem o botão **"Reparar (CHKDSK)"** (`DriveRepairModal` -> IPC `tools:drive-repair` ->
  `services/driveRepairService.ts::repairDrive`). Mas a tela lista as unidades por
  `toolsBadAvatarListDrives`, a mesma lista que hoje omite HD externo
  ([[badavatar-lista-de-dispositivos-mostra-so-o-pendrive-e-omite-o-hd-externo_2026-10-09T00-00]]) —
  justamente o caso do #144. Por isso a mensagem tem de dar também o caminho do Windows, que vale
  para qualquer unidade.

### Provas (comando literal -> resultado)

- Telemetria (`POST /diag/query`, script `chamado.py` copiado para o scratch):
  `SELECT id, time, status, LEFT(message, 420) FROM errors WHERE project LIKE 'xbox-360-companion%' AND (message LIKE '%caminho especificado%' OR message LIKE '%find the path%' OR message LIKE '%marcar instalacao%') ORDER BY id`
  -> 27 linhas; as de `mkdir D:\Games\...` são **10**, não 9: as 9 do doc + **8616**
  (2026-09-25 19:42, `ia`, GOD, `gravar 5B68C6D5: mkdir D:\Games\PES 2013 - 4B4E084C: The system cannot
  find the path specified.`). O texto em inglês prova uma **segunda máquina** (Windows em inglês); não é
  só a cliente do #144. Nenhuma com `marcar instalacao` (o ramo novo é de 2026-10-09). Nenhuma ocorrência
  de `mkdir D:\Games` depois de 2026-09-25.
- As outras linhas da consulta são de outros caminhos (scratch `D:\godsend-temp`, `Ready\...\.source*`,
  `GetFileAttributesEx` da origem) e já têm doc próprio ou são outra fase; fora do escopo.
- `git log --format='%h %ad' --date=iso 431ffe3` -> `2026-10-09 16:44:30` (marcador antes do 1º arquivo).
- `sed -n '/^func MkdirAll/,/^}/p' $(go env GOROOT)/src/os/path.go` -> confirma a sequência
  Stat -> recursão no pai -> Mkdir -> Lstat descrita acima (go1.26.6; `go.mod` pede 1.24).

### Hipoteses descartadas (e por que)

- **O nome da pasta** (já no doc): 9 jogos, nomes variados, nenhum com ponto/espaço no fim.
- **Pasta-pai ausente** (`D:\Games` não existia): `MkdirAll` teria tentado `mkdir D:\Games` e o erro
  citaria esse caminho; cita o filho.
- **`D:\Games` como arquivo**: `MkdirAll` devolveria `ENOTDIR` ("not a directory") citando `D:\Games`.
- **Limite de 65.536 entradas do FAT32**: dá ERROR_CANNOT_MAKE (82), não 3, e `D:\Games` tem poucas
  pastas.
- **Caminho longo**: os caminhos têm < 100 caracteres; Go só prefixa `\\?\` a partir de 248.
- **`FlushVolumeBuffers` de outro job travando o volume**: só faz `FlushFileBuffers` com
  compartilhamento total; não desmonta nem bloqueia (aberto acima).
- **Dispositivo ausente**: provado presente pelo `localDeviceMatches` antes do erro (no código daquela
  época); ausente iria para `waitForLocalDevice`.
- Não descartadas e não mensuráveis aqui: volume FAT32 inconsistente (hipótese 1, a mais compatível) e
  instâncias simultâneas (hipótese 2; o report não traz versão). O fix entrega o diagnóstico que as
  separa na próxima ocorrência.

### Tarefas

- [x] `src/server/services/pipeline/fat_directory.go::localWriteErrorText` — no Windows, quando
  `errors.As(err, *os.PathError)` e `errors.Is(err, syscall.Errno(3))` (ERROR_PATH_NOT_FOUND), devolver
  texto em português com: o caminho que falhou, "o dispositivo está conectado", o código (`erro 3`), o
  estado da pasta-pai (`os.Stat(filepath.Dir(pe.Path))`: existe / não existe / erro), o sistema de
  arquivos (`helpers.VolumeFileSystem(pe.Path)`) e a ação: "verifique o disco: no Windows, Este Computador
  > botão direito na unidade > Propriedades > Ferramentas > Verificar (ou, no app, Jogos Instalados >
  Reparar (CHKDSK)), e tente de novo". Guardar por `runtime.GOOS == "windows"` como `isFATDirectoryFull`
  (errno 3 é ESRCH fora do Windows). Os outros erros continuam passando como estão. Comentário cita
  `[[pipeline-mkdir-da-pasta-do-jogo-falha-com-caminho-nao-encontrado-e-o-dispositivo-presente_2026-10-04T23-28]]`.
  — teste: `fat_directory_test.go::TestLocalWriteErrorTextExplainsPathNotFound` com erro 3 REAL
  (`os.Mkdir(filepath.Join(t.TempDir(), "falta", "jogo"))`, que no Windows devolve exatamente esse
  errno): o texto contém `erro 3`, `Verificar` e o caminho; um erro qualquer (`errors.New`) continua
  igual. Skip fora do Windows, como o teste do 82.
- [x] `src/server/services/pipeline/local_resilient.go::copyTreeLocal` (ramo de erro de
  `writeInstallInProgressMarker`, hoje linhas 608-610) — se `!localDeviceMatches(root, expectedID)`:
  `waitForLocalDevice` e, reconectado, tentar o marcador de novo (mesma regra do laço); se o
  dispositivo confere: `"%w: criar a pasta do jogo em %s: %s"` com `ErrLocalDelivery` e
  `localWriteErrorText(err)`. Não acrescentar novas tentativas cegas: o laço antigo já repetia 3 vezes e
  o erro persistia em todos os 10 reports.
  — teste: `local_install_marker_test.go` — (a) destino cuja pasta do jogo não pode ser criada com o
  dispositivo presente (ex.: um ARQUIVO no lugar de `<raiz>\Games`, que faz o `MkdirAll` falhar de forma
  determinística) -> erro `errors.Is(ErrLocalDelivery)` contendo "criar a pasta do jogo" e nenhum arquivo
  copiado; (b) dispositivo que some exatamente nesse ponto -> o erro é o de `waitForLocalDevice`
  ("tempo esgotado..."/"identificador", com `localDeviceWaitTimeout` curto), não o de criar a pasta.
  Para (b) é preciso uma costura `writeInstallInProgressMarkerFunc` (mesmo padrão de
  `copyLocalEntryFunc`/`localIsFATVolume`), cuja versão de teste apaga o marcador de identidade da raiz
  e devolve erro: remover o marcador ANTES da chamada não serve, porque `ensureLocalDeviceIdentity` no
  topo de `copyTreeLocal` já iria para `waitForLocalDevice` e o ramo novo nunca rodaria.
- [x] `CHANGELOG.md` `[Unreleased]` `### Fixed` (fora da reserva, regra do manual).

Fora do escopo deste fix (não fazer aqui): versão/máquina no report da telemetria (achado lateral
registrado), mudar o prefixo "Falha no dispositivo local" de `fallback.go` (o texto novo já diz que o
dispositivo está conectado), e a lista de unidades sem HD externo (bug próprio, bloqueado).

### Plano de teste

- **Offline (sem slot):** `go test -count=1 ./services/pipeline/ -run "LocalWriteErrorText|InstallInProgress|Marker"`
  em `src/server` (os dois testes novos passam), e `go test -count=1 ./...` sem `fail` novo.
- **T2 reproducao como o usuario (E2E, no slot):** o sintoma exato (erro 3 com a pasta-pai presente)
  só nasce num volume FAT32 danificado; disco real está proibido, então a T2 cobre o caminho do cliente
  sem o volume defeituoso e o ramo novo com um defeito determinístico:
  1. *Caminho do cliente (regressão):* app da lane (`npm start`), Configurações com destino de gravação
     local apontando para uma pasta da evidência (`...\evidencia\<exec>-<slug>\destino`); Catálogo/Browse
     -> um jogo XEX pequeno -> baixar. Sinal: na Fila o job termina "Concluído"; existe
     `destino\Games\<jogo> - <TitleID>\default.xex`; não existe `.xbox-companion-installing` nessa pasta.
  2. *Pasta do jogo que não pode ser criada, dispositivo presente:* na mesma pasta de destino, apagar
     `destino\Games` e criar um ARQUIVO vazio chamado `Games`; repetir o download de outro jogo pequeno.
     Sinal: o job vai a Erro com "Falha no dispositivo local..." contendo "criar a pasta do jogo em
     ...\Games\..." (texto novo do ramo), SEM passar pelo status "Pendrive/HD desconectado..." (o
     dispositivo confere), e a cadeia de provedores para nesse erro (`isLocalStorageHalt`: nenhum
     download novo de outro provedor no console do backend). Apagar o arquivo `Games` e "Tentar
     novamente" na Fila -> conclui.
  Print da Fila (Playwright `page.screenshot`) e listagem da pasta de destino na evidência.
- **Controle positivo:** não há `deploy --at-base` neste projeto. Controle = o dev escreve os dois
  testes novos ANTES de mudar o código e os roda na base: o do texto falha (sem `erro 3`/`Verificar`, só o texto cru do
  Windows) e o do marcador falha na mensagem (`marcar instalacao em andamento` em vez de `criar a pasta
  do jogo`). Na UI, o passo 2 da T2 na base mostra "marcar instalacao em andamento em ...: mkdir ...".
- **T3 regressao direcionada:** `go test -count=1 ./services/pipeline/...` (em especial
  `fat_directory_test.go` — o texto do erro 82 não pode mudar — `local_resilient_test.go`,
  `local_resilient_fat32_test.go`, `local_install_marker_test.go`, `fallback_test.go`: o
  `ErrLocalDelivery` tem de continuar encerrando a cadeia de provedores) e
  `npm --prefix src/electron-app run test:safety` (linha de base do manual). Depois do passo 2 da T2,
  "Jogos Instalados" não lista o jogo que falhou (nenhuma pasta dele foi criada).
- **Falta para close:** a próxima ocorrência real na telemetria com o texto novo (código, pasta-pai,
  sistema de arquivos) e o CHKDSK numa mídia afetada decidem entre as hipóteses 1 e 2; versão publicada.

### Sessoes seguintes

- dev: effort high, ultrathink nao — pipeline de gravação (regra do manual), mas a mudança é localizada
  e o desenho está fechado aqui; o cuidado é não mudar o comportamento do erro 82 nem do
  `waitForLocalDevice`.
- teste: effort medium, ultrathink nao — T2 é caminho de UI com destino local e um arquivo no lugar
  da pasta; classificar o resultado é direto pelo texto da Fila.

### Achado lateral

- [[pipeline-report-de-telemetria-do-backend-nao-carrega-versao-do-app_2026-10-10T23-30]] — o report do
  backend não traz versão nem máquina; é o que impede medir a hipótese 2 aqui.

## Correcao (pipeline 20261010-2242, rodada 1)

**O que mudou** (`arquivo::simbolo`):

- `src/server/services/pipeline/fat_directory.go::localWriteErrorText` — novo ramo, só no Windows
  (`errorPathNotFound = syscall.Errno(3)`, mesmo guarda de `isFATDirectoryFull`), para
  `*os.PathError` com errno 3: texto em português com a operação e o caminho, "com o dispositivo
  conectado", o estado da pasta-pai (`os.Stat`: existe / não existe / existe mas não é pasta / não pôde
  ser lida), o sistema de arquivos (`helpers.VolumeFileSystem`, "desconhecido" se vazio) e a ação
  (Verificar no Windows ou Jogos Instalados > Reparar (CHKDSK)). Erro 82 e os demais erros: inalterados.
  Todos os chamadores (laço de `copyTreeLocal`, `copyFileLocal` e o ramo novo do marcador) só o
  chamam depois de `localDeviceMatches` = true, por isso a frase "dispositivo conectado" é verdadeira.
- `src/server/services/pipeline/local_resilient.go::copyTreeLocal` — a criação do marcador (que cria a
  pasta do jogo) virou laço: falhou e o dispositivo confere -> `"%w: criar a pasta do jogo em %s: %s"`
  com `ErrLocalDelivery` e `localWriteErrorText`; não confere -> `waitForLocalDevice` e nova tentativa
  (mesma regra do laço de arquivos; cancelamento e tempo esgotado saem por `waitForLocalDevice`). Sem
  novas tentativas cegas com o dispositivo presente.
- `local_resilient.go` — costura `writeInstallInProgressMarkerFunc` (junto de `copyLocalEntryFunc`).
- `CHANGELOG.md` — `[Unreleased]` / `### Fixed`.

**Testes novos** (escritos antes do código e rodados na base = controle positivo):

- `fat_directory_test.go::TestLocalWriteErrorTextExplainsPathNotFound` — erro 3 REAL
  (`os.Mkdir(<tmp>\falta\jogo)`). Base: FALHA (`texto do erro 3 sem "erro 3": "mkdir ...: The system
  cannot find the path specified."`). Com o fix: passa.
- `local_install_marker_test.go::TestCopyTreeLocalExplainsGameFolderThatCannotBeCreated` — arquivo
  `Games` no lugar da pasta. Base: FALHA (`marcar instalacao em andamento em ...`). Com o fix: passa,
  nenhum arquivo gravado.
- `local_install_marker_test.go::TestCopyTreeLocalWaitsForDeviceThatLeavesWhenGameFolderIsCreated` —
  a costura apaga o identificador da raiz e falha; o erro é o de `waitForLocalDevice`
  ("...nao possui o identificador esperado"), não "criar a pasta do jogo". (Não roda na base: a costura
  é nova; no código antigo o erro seria "marcar instalacao..." e o teste falharia.)
- `go test -count=1 ./services/pipeline/ -run "LocalWriteErrorText|InstallInProgress|Marker|GameFolder|LeavesWhen" -v`
  -> 5 PASS.
- `go test -count=1 ./...` em `src/server` -> rc 0, 9 pacotes `ok` (igual à linha de base do manual).
- Compile-check `pipeline.py build --bug <slug>` -> rc 0 (build-server x64/ia32, `tsc`, `renderer:typecheck`).

**Ajuste ao Plano de teste / nota sobre a análise (2026-10-11):** com um ARQUIVO chamado `Games` no
lugar da pasta, o Go no Windows NÃO devolve `ENOTDIR`: devolve erro 3 citando `...\Games`
(medido: `mkdir <raiz>\Games: The system cannot find the path specified.`). A hipótese descartada
"`D:\Games` como arquivo" continua descartada (o erro citaria `Games`, não a pasta do jogo), mas o
motivo escrito ("devolveria ENOTDIR") está errado. Consequência boa para a T2: o passo 2 também
exercita o texto novo do erro 3. Texto real que a Fila deve mostrar no passo 2 (medido no teste,
destino NTFS):
`falha no dispositivo local: criar a pasta do jogo em <destino>\Games\<jogo> - <TitleID>: o Windows
respondeu "caminho não encontrado" (erro 3) em mkdir <destino>\Games com o dispositivo conectado
(pasta-pai <destino>: existe; sistema de arquivos: NTFS). A estrutura de pastas da unidade pode estar
danificada: verifique o disco (...) e tente de novo`, precedido do prefixo "Falha no dispositivo
local. O download concluido foi preservado..." de `fallback.go`.
