# Guia e Diretrizes do Desenvolvedor AI (AGENTS.md)

## Visão Geral do Projeto

**Xbox 360 Companion** (anteriormente GODsend-360) é um ecossistema completo para gerenciamento local de jogos, conteúdos (DLCs/TUs), perfis, saves e preparação de mídias para consoles Xbox 360 rodando a dashboard **Aurora** ou consoles travados/LT utilizando o exploit **BadAvatar**.

O ecossistema é composto por quatro componentes principais:

1. **Go Backend (`src/server/`)**: Servidor HTTP em Go de alta performance rodando no PC ou Android, responsável pela comunicação com o Internet Archive e Minerva Archive (BitTorrent), conversão nativa de ISOs para os formatos GOD/XEX, servidor cliente de FTP resiliente (com retentativas e suporte a `REST` resume), parsing de perfis STFS com descriptografia RC4, codec de texturas RXEA (DXT5) e coordenação da fila de trabalhos.
2. **Electron Desktop App (`src/electron-app/`)**: Aplicação desktop para Windows (instalador NSIS e portátil), macOS (DMG) e Linux (AppImage). Interface gráfica em React 19 + TailwindCSS que gerencia o processo do backend em Go, oferece sincronização 3D da biblioteca do Xbox, gerenciador FTP integrado, editor de artes/capas, gerenciador de saves, e a ferramenta **BadAvatar USB** com formatador FAT32 nativo.
3. **Android Mobile App (`src/android-app/`)**: Aplicativo nativo em Kotlin que empacota o backend Go como uma biblioteca JNI nativa (`libgodsend.so`). Executa um *Foreground Service* com *WakeLock* e conformidade com SELinux (Android 10+), acompanhado de um assistente didático em 3 passos para transferências Wi-Fi ou mídias USB móveis.
4. **Aurora Lua Scripts (`aurora-scripts/`)**: Conjunto de scripts Lua 5.1 executados dentro da dashboard Aurora no Xbox 360, permitindo que o usuário navegue pelas bibliotecas online/locais, monitore filas e instale jogos diretamente pela TV com o controle do videogame.

### Fluxo Geral de Dados
```
┌─────────────────────────────────────────────────────────────┐
│             Electron App (PC) / Android App                 │
│         (Interface React/Vite / Kotlin Native)              │
│  - Gerenciamento de Biblioteca, Saves, DLCs e BadAvatar     │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC / JNI / HTTP local (127.0.0.1:8080)
                               ▼
┌─────────────────────────────────────────────────────────────┐          Protocolo FTP           ┌───────────────────────────────────────┐
│                    Go Backend Server                        │─────────────────────────────────>│             Xbox 360                  │
│  - Conversor Nativo ISO -> GOD/XEX (Pure Go)                │<─────────────────────────────────│         (Aurora Dashboard)            │
│  - Downloader Paralelo (IA HTTP / Minerva BitTorrent aria2c)│    (Pull de Capas e Status)    │  - Lua GUI Menu (Navegação na TV)    │
│  - Core FTP Manager (Locking de IP & Retentativas)          │                                │  - Leitura de Perfil STFS / Saves     │
└─────────────────────────────────────────────────────────────┘                                └───────────────────────────────────────┘
```

**Referência Técnica Detalhada para LLMs:** Para especificações minuciosas de funções, codecs e endpoints HTTP, consulte [docs/agents/llm_functionality_guide.md](file:///e:/projects/Downloader-XBOX360-XEX-HDD-Games/docs/agents/llm_functionality_guide.md).

---

## Estrutura do Repositório e Padrões Arquiteturais

### 1. Go Backend (`src/server/`)

O backend utiliza o padrão de **DDD (Domain-Driven Design)** com uma estrutura central `*app.App` para injeção de dependência. Todo estado compartilhado reside em `App`, e os serviços mantêm um ponteiro para `App`.

* **`main.go`**: Ponto de entrada fino. Apenas instancia `*app.App`, registra os serviços, configura as rotas e inicia o servidor HTTP. Nenhuma regra de negócio deve ser colocada aqui.
* **`embed_titles.go`**: Embutição do banco de dados de títulos (`iso2god_titles.jsonl`) via `go:embed`.
* **`models/`**: Tipos puros de domínio (sem dependências externas):
  * `types.go`: Estruturas exported (`IAGameEntry`, `PlatformCache`, `MinervaEntry`, `XboxConnection`, `PendingFTPJob`, `ROMSystemDef`, etc.).
  * `compat.go`: Tabela de compatibilidade de discos multi-disco (`discCompatTable`) e função de busca `DiscCompat()`.
  * `game.go`: Enums de plataformas (`Platform`) e status de trabalhos (`JobStatus`).
* **`app/`**: Container de estado central:
  * `app.go`: Estrutura `App`, locks de concorrência (`sync.Map`, mutexes), logs formatados (`Logf`, `LogStatus`), lookup de instalações. `LogStatus` é o único ponto por onde passam **todas** as transições de estado de **todos** os pipelines: é ele que espelha a mudança no registro durável da fila (`persistJobState`). Não desvie um pipeline para gravar em `JobQueue` diretamente — a fila para de sobreviver ao fechamento do aplicativo sem que nada quebre visivelmente.
  * `queue_store.go`: Fila de download durável em `GODSEND_HOME/pending_queue/` — um JSON por jogo com destino, tipo de instalação, prioridade de provedor e o caminho do arquivo parcial (`PersistedJob`). Registro criado pelo lançamento (`Deps.saveQueueRecord`), atualizado a cada transição de estado e apagado quando o jogo é entregue (`Ready`), passa para a fila de FTP pendente (`Pending FTP`) ou é removido da fila. Define também `DownloadResumeSuffix`/`DownloadCompleteSuffix`, usados por `infrastructure/download` e pela limpeza de scratch.
  * `config.go`: Constantes globais, coleções IA/Minerva, rotas de armazenamento (`SetupPaths`), suporte a credenciais. `protectedScratchPaths` protege da limpeza de inicialização tanto a origem dos jobs de FTP pendentes quanto o download parcial de cada job ainda na fila (com os dois marcadores de retomada) — sem isso, reabrir o aplicativo recomeça a transferência do zero.
* **`infrastructure/`**: Adaptadores de efeitos colaterais:
  * `download/`: Downloads via IA (chunked range requests) e EdgeEmu.
  * `ftp/`: Serviço FTP para Xbox (`client.go`), gerenciamento de conexões assíncronas, retentativas com backoff exponencial e persistência de jobs em `GODSEND_HOME/pending_ftp/`.
  * `torrent/`: Serviço de torrent utilizando `aria2c` embutido (`DownloadViaTorrent`).
  * `helpers/`: Funções utilitárias (cálculo de IP, sanitização de nomes, inspeção de cabeçalhos XDVDFS).
* **`services/`**: Camada de aplicação e regras de negócio:
  * `cache/`: Serviços de cache para IA (`ia.go`), Minerva (`minerva.go`) e ROMs (`rom.go`).
  * `pipeline/`: Pipeline de conversão e transferência (`ProcessLocalISO`, `ProcessGame`, `FinalizeGOD`, `digital.go`, `minerva.go`, `rom.go`, `ini.go`). O nome da pasta de destino de uma instalação XEX **tem** de passar por `helpers.XEXFolderName()`, que acrescenta o TitleID — e não pode ser só o `filepath.Base(xexFolder)` que vem do arquivo baixado. Rips de jogos de dois discos trazem a pasta raiz chamada `Disc2`, então sem o TitleID títulos diferentes resolvem para o mesmo destino e, como `copyTreeLocal` mescla no que já existe, o segundo sobrescreve o `default.xex` do primeiro **em silêncio**, com as duas tarefas relatando sucesso. A composição fica nos seis pontos onde `folderName` é derivado, não nas funções de gravação, para valer também no FTP (`ftp/client.go` monta o destino com o mesmo nome). Duas condições da função não são óbvias e não devem ser removidas: ela **ignora `helpers.SystemTitleID`** (`FFFE07DF`), porque `FindTitleIDInDir` varre em ordem lexical e os pacotes Kinect embutidos no jogo — `Database.xmplr` e afins — vêm antes de `default.xex`, o que produziria uma pasta que o próprio scan de jogos instalados descarta como dado de sistema; e **corta o nome em 42 caracteres** (limite FATX do HD interno), preservando o TitleID, porque `TransferXEX` descarta o resultado de `MkdirAll` e um nome recusado vira job de FTP falhando igual em toda retentativa. Ver a entrada 2.12.81 do `CHANGELOG.md` antes de simplificar essa nomenclatura.
  * `saves/`: Leitura e gerenciamento de perfis/saves (`saves.go`, `account.go`). Leitura de contêineres STFS, validação HMAC-SHA1 + descriptografia RC4 com chaves Retail e Devkit para extração da gamertag UTF-16BE.
  * `title_lookup.go`: Resolução de nomes de jogos em cascata (XboxUnity ➔ XboxDB ➔ Lista embutida iso2god-rs).
* **`interfaces/http/`**: Camada HTTP/REST:
  * `router.go`: Registro central de rotas no `*http.ServeMux`.
  * `handlers.go`, `handlers_content.go`, `handlers_saves.go`, `handlers_tools.go`, `handlers_rxea.go`, `handlers_ftp_manager.go`: Métodos HTTP expostos pela estrutura `*Deps`.
  * `queue_resume.go`: Fila durável no lado HTTP — `saveQueueRecord` (grava o lançamento antes de `RegisterGameJob`), `relaunchGame` (despacho compartilhado por `/queue/retry` e pela retomada) e `ResumeQueuedJobs`, chamado por `main.go` na inicialização para restaurar a fila da sessão anterior.
* **`utils/`**: Codecs e conversores puros:
  * `iso2god.go`: Conversor nativo em Go de ISO para GOD (Games On Demand), extrator de XDVDFS e probe de discos (`ProbeISODiscInfo`). Usa a semente `utils/data/empty_live.bin`.
  * `rxea.go`: Codec nativo para codificação/decodificação de capas e texturas DXT5 do Aurora (`.asset`).

---

### 2. Electron Desktop App (`src/electron-app/`)

Escrito em **TypeScript** (compilado in-place via `tsconfig.json`, mantendo arquivos `.ts` e gerando `.js` lado a lado):

* **`app/`**: Ciclo de vida da aplicação (`bootstrap.ts`), gerenciamento da janela principal (`window.ts`) e bandeja do sistema (`electronTray.ts`).
* **`services/`**: Regras de aplicação no Node.js:
  * `settingsService.ts`: Leitura e escrita de configurações em `%APPDATA%`, injeção das variáveis de ambiente `GODSEND_*`.
  * `backendClient.ts`: Gerenciamento do processo filho Go (`godsend-backend.exe` / `godsend-backend`), captura de logs e login no Internet Archive.
  * `auroraLibraryService.ts`: Parser SQLite (`sql.js`) dos bancos de dados do Aurora (`content.db` e `settings.db`), com caching por fingerprint SHA-256 / tamanho.
  * `auroraVisualService.ts`: Sincronização de capas e artes visuais do console (RXEA `.asset`, Media JPGs, `visual-manifest.json`).
  * `badAvatarUsbService.ts`: Orquestrador de criação do pendrive BadAvatar USB (formatador FAT32 + gravação transacional do BadStick).
  * `fixedBadAvatarPreparationService.ts`: Preparação efetiva do pendrive (`tools:badavatar-prepare`) — valida o pacote fixo contra `assets/badavatar-1.1.manifest.json`, exclui o estado do console de origem (`isForeignConsoleStatePath`) e grava via plano transacional.
  * `autoSyncService.ts`: Sincronização pós-transferência de capas e biblioteca do Aurora.
* **`ipc/`**: Manipuladores IPC expostos ao React (`configHandlers`, `xboxFtpHandlers`, `auroraLibraryHandlers`, `auroraAssetHandlers`, `browseHandlers`, `toolsHandlers`, `contentHandlers`, `saveHandlers`, `badAvatarHandlers`).
* **`infrastructure/`**:
  * `fat32Format.ts`: Formatação FAT32 multiplataforma para drives USB grandes (Ridgecrop `fat32format.exe` no Windows, `newfs_msdos`/`diskutil` no macOS, `mkfs.vfat`/`mkfs.fat` no Linux). Os quatro caminhos de `diskpart` usam **`convert mbr`, e isso é deliberado** — o Xbox 360 lê FAT32 em MBR; trocar por GPT devolveria capacidade no Windows e tornaria o disco ilegível no console. MBR e FAT32 limitam um volume a 2 TiB cada um, então um HD de 4 TB termina com ~2 TB e o resto fica inendereçável: **é comportamento esperado, não bug a corrigir**. Acima de 32 GB o caminho principal formata a partição existente e só cai no `diskpart` quando o `fat32format` falha. Um disco acima de 2 TiB recebe faixa de aviso na seleção (`BadAvatarUsbPage.tsx`, constante `MBR_MAX_VOLUME_BYTES`) — **avisa, não bloqueia**: o teto ficou deliberadamente fora de `assessDeviceSafety`, cujos códigos são todos impeditivos, porque 2 TB funcionam. Ver [`docs/CAPACIDADE-E-ESPACO.md`](docs/CAPACIDADE-E-ESPACO.md#teto-de-2-tib-por-volume).
  * `readyToPlayConfiguration.ts`: Gera o `launch.ini` do DashLaunch (inclusive `Dumpfile = Usb:\crashlog.txt`, que preserva no pendrive a exceção que o DashLaunch interceptar, em vez de mandá-la só para a UART), o marcador e o script Lua carregado pelo Aurora. `READY_TO_PLAY_CONFIGURATION_VERSION` precisa subir sempre que o conteúdo gerado mudar, senão o diário transacional do pendrive rejeita o novo plano. O Lua é gravado em `Aurora/User/Scripts/Content/Filters/` e roda na fase `ContentScripts` do boot; o `Aurora.Restart()` no fim dele é **deliberado** — os scan paths só valem a partir da inicialização seguinte. Antes de mexer nesse script, leia [`docs/READY-TO-PLAY-AURORA.md`](docs/READY-TO-PLAY-AURORA.md), que descreve a sequência de boot, e use [XboxUnity/AuroraScripts](https://github.com/XboxUnity/AuroraScripts) como referência de API — [`docs/reference/aurora.md`](docs/reference/aurora.md) é condensada e não cobre `Sql.*` nem `Aurora.Restart`.
  * `windowsSystemExecutables.ts`: Resolve `powershell.exe`, `cmd.exe`, `net.exe` e `chkdsk.exe` em System32, caindo para o nome simples só quando o arquivo não existe lá. **Nem o `%PATH%` nem o `%SystemRoot%` decidem qual binário é elevado, e isso é deliberado** — os dois são variáveis de ambiente que um usuário comum semeia para os próprios processos, e `systemRootCandidates()` põe `C:\Windows` fixo na frente por isso, recorrendo ao `%SystemRoot%` só quando o arquivo não está no lugar padrão (instalação fora de `C:\Windows` continua funcionando). O primitivo correto seria `GetSystemDirectoryW`, que exigiria um módulo nativo que o projeto não carrega. Esses binários formatam e reparam discos, e o `fat32Format.ts` entrega o interpretador resolvido ao `Start-Process -Verb RunAs`: uma pasta gravável pelo usuário no `%PATH%`, ou um `%SystemRoot%` semeado, transformaria "escrever onde o usuário pode" em "ganhar administrador pelo nosso próprio UAC". A 2.12.78 tinha invertido para `%PATH%` primeiro, registrando a exposição como aceita; as 2.12.83 e 2.12.84 desfizeram isso — leia as tres entradas do `CHANGELOG.md` antes de mexer nessa ordem de novo. **Nunca passe o nome simples direto para `spawn`/`spawnSync`** — aí o `%PATH%` volta a ser a única fonte, e em instalações com o PATH truncado ou "debloatado" todo `spawn` falha com `spawn powershell.exe ENOENT`. `powerShellExe()` para o interpretador, `system32Exe()` para os demais, `isResolvedSystemExe()` para quem vai elevar (o guarda de `runPs1Elevated`, que recusa nome simples), `isExecutableNotFound()`/`powerShellMissingMessage()` para traduzir o ENOENT restante. O `Start-Process` aninhado da elevação **não** refaz a busca: `buildElevationScript()` (em `fat32Format.ts`) recebe o interpretador já resolvido pelo pai. `describeWindowsExecutableEnvironment()` produz a linha de diagnóstico anexada ao log e à telemetria quando a enumeração de USB falha (PowerShell no disco, PATH com/sem `System32`, tamanho do PATH, `arch`) — com a pasta do perfil mascarada, porque o log inteiro é enviado a um serviço externo.
  * `windowsUsbDeviceService.ts`: Enumeração e revalidação dos dispositivos USB no Windows. São **dois** scripts PowerShell com identidades diferentes para o mesmo pendrive: `ENUMERATE_REMOVABLE_SCRIPT` (`DriveInfo` + `mountvol`, sem número de disco/serial/modelo, tentado primeiro, teto de 5 s) e `ENUMERATE_USB_SCRIPT` (`Get-Disk`/`Get-Partition`/`Get-Volume`, teto de 12 s). **O script nativo não pode chamar Storage Management** — `Get-Disk`, `Get-Volume`, `Get-CimInstance` — porque ele existe justamente para funcionar quando esse serviço trava depois de uma desconexão USB instável; as dicas de integridade ficam em `annotateRemovableHealth()`, num processo separado, com teto próprio e resultado descartável — e **opt-in**, porque `enumerateSafeWindowsUsbDevices()` também é o caminho de revalidação, disparado a cada 10 s durante a gravação. Como os fingerprints dos dois caminhos nunca coincidem, `requireSafeWindowsUsbTarget()` reexecuta **o outro** script antes de dizer que o dispositivo mudou, segundo `planRevalidationRetry()` (em `deviceSafetyPolicy.ts`): subir para o script físico é sempre permitido, descer para o nativo só com veredito `allowed` e unidade `Removable`, porque as linhas nativas fixam as flags de segurança no valor permissivo. Ver a entrada 2.12.79 do `CHANGELOG.md` antes de mexer nessa assimetria.
  * `serverLog.ts`: Logs rotativos diários com timestamp ISO 8601 em `logs/`.
  * `backendHttp.ts`: Cliente HTTP do backend Go local. `backendGetWithStatus()` devolve `{ status, body }`; `backendGet()` é o atalho que só entrega o corpo. Quem precisa distinguir sucesso de recusa **tem** de usar a variante com status — o backend sinaliza falha com 4xx/5xx, e ignorar o código transforma toda recusa em sucesso silencioso.
  * `backendFailure.ts`: Interpretação das respostas do backend (sem imports do Electron, por isso testável em `tests/unit/backendFailure.test.cjs`). `backendFailureReason()` cobre as três formas de falha do Go — `jsonError()` com `{"state":"Error","message":…}`, as rotas que respondem `{"ok":false,"error":…}` e os `*_unavailable` com 200 — e `errorMessage()` garante texto não vazio para qualquer valor lançado.
* **`preload.ts`**: Ponte restrita e tipada entre o processo Main e a interface React (`window.godsendApi.*`).
* **`renderer/`**: Interface visual construída em React 19, Vite e TailwindCSS (páginas `HomePage`, `LibraryPage`, `QueuePage`, `SettingsPage` e overlays).

---

### 3. Android Mobile App (`src/android-app/`)

Aplicativo nativo Android em **Kotlin**:

* **Backend Go Embutido (`libgodsend.so`)**: Compilado nativamente para a arquitetura `android/arm64` (`CGO_ENABLED=1`) e empacotado em `jniLibs/arm64-v8a/libgodsend.so` com `android:extractNativeLibs="true"`, cumprindo os requisitos de execução de binários do SELinux no Android 10+ (API 29+).
* **Foreground Service (`GodsendBackendService.kt`)**: Mantém o servidor Go rodando em segundo plano no celular/tablet com notificação persistente e `WakeLock`, garantindo downloads e transferências contínuas mesmo com a tela desligada.
* **Activity Principal (`MainActivity.kt`)**: Carrega a interface web local (`http://127.0.0.1:8080`) com tratamento de permissões de armazenamento.
* **Assistente de 3 Passos (Wizard Mobile)**: Interface intuitiva para escolha entre modo Wi-Fi (FTP para Xbox RGH) e modo USB (gravação de pendrive/cartão SD em dispositivos móveis).

---

### 4. Aurora Lua Scripts (`aurora-scripts/`)

Executados diretamente no Xbox 360 na dashboard Aurora:

* **`main.lua`**: Metadados do script e gerenciador do loop principal.
* **`state.lua`**: Configurações de conexão (`BRAIN_IP`, `PORT`) e estado mutável compartilhado.
* **`http_client.lua`**: Utilitários HTTP defensivos para o console.
* **`services.lua`**: Operações de segundo plano (trigger de downloads, registro FTP, loop `waitForProcessing`).
* **`menu.lua`**: Interface gráfica no console para navegação de bibliotecas, seleção de drives e monitoramento de fila.

#### Regras Críticas do Ambiente Lua no Console:
1. **Barras Invertidas Obrogatórias:** Usar exclusivamente `\` nos caminhos (`Hdd1:\Games\`). Barras normais `/` causam falha.
2. **Bug Crítico dos 350 MB no Zip:** Arquivos maiores que 350 MB dentro de um `.zip` são extraídos como **0 bytes sem emitir erro**. O backend cuida de descompactar arquivos grandes antes de enviar ao Xbox.
3. **MoveFile Exige 3 Parâmetros:** O comando `FileSystem.MoveFile(src, dst, overwrite)` **causa crash** se o terceiro argumento booleano de overwrite não for fornecido.
4. **Índices de Perfil em Base-1:** `Profile.GetGamerTag(1)` usa índice 1 para o primeiro perfil (e não 0).

---

## Resumo das APIs REST HTTP do Backend

O backend disponibiliza uma API REST na porta `8080` (ou `GODSEND_PORT`):

| Categoria | Endpoints Princpais | Descrição |
|---|---|---|
| **Navegação & Fila** | `GET /browse`, `GET /status`, `GET /queue`, `GET /trigger`, `GET /register`, `POST /queue/remove`, `POST /queue/retry` | Consulta de jogos por plataforma, polling de status, disparador de downloads, limpeza da fila e relançamento de um job (`Deps.relaunchGame`, compartilhado com a restauração da fila na inicialização). |
| **Diagnóstico & Caches** | `GET /cache-status`, `GET /cache-refresh`, `GET /disc-info`, `GET /data/status`, `GET /data/clear` | Status do cache, rebuild assíncrono, probe de ISOs e limpeza de temporários em `Ready/` e `Temp/`. |
| **DLC & Title Updates** | `GET /content/discover`, `GET /content/tu`, `GET /content/installed`, `POST /content/queue`, `POST /content/set-active` | Descoberta e instalação de DLCs/TUs, alternância de TU ativo (renomeando inativos para `.disabled`). |
| **Saves & Perfis** | `GET /saves/discover`, `GET /saves/list`, `POST /saves/download`, `POST /saves/delete`, `POST /saves/copy`, `POST /saves/backup-all` | Leitura de contêineres STFS, descriptografia RC4 de perfis, extração de gamertags e backup completo em 1 clique. |
| **Ferramentas & Codecs** | `POST /tools/probe-iso`, `POST /tools/iso2god`, `POST /tools/iso2xex`, `POST /rxea/decode`, `POST /rxea/encode` | Conversão e inspeção local de ISOs, codificação/decodificação de capas RXEA DXT5 para Aurora. |
| **Utilitários FTP** | `GET /ftp/ping`, `GET /ftp/drives`, `POST /ftp/list`, `POST /ftp/mkdir`, `POST /ftp/delete`, `POST /ftp/move-game`, `POST /ftp/upload-scripts` | Navegação no sistema de arquivos do Xbox, movimentação de jogos entre HDs e envio de scripts. |

---

## Ferramentas e Scripts de Build

Todos os builds são executados a partir do diretório raiz utilizando os scripts do `package.json`:

```bash
# Compilar o backend em Go para a plataforma local (dist/godsend.exe, x64 e ia32 no Windows)
npm run build:server
npm run build:server:win:x64
npm run build:server:win:ia32

# Compilar o backend em Go para todas as plataformas (Windows x64/ia32, macOS Intel/ARM, Linux x64/ARM64)
npm run build:server:all

# Compilar o backend em Go para Android (dist/godsend-android-arm64)
npm run build:server:android

# Compilar o aplicativo Electron completo para Windows (NSIS Installer)
npm run build:electron:win:x64
npm run build:electron:win:ia32

# Compilar a versão portátil para Windows (.exe único)
npm run build:electron:win:portable:x64
npm run build:electron:win:portable:ia32

# Compilar para macOS (DMG para Intel e Apple Silicon)
npm run build:electron:mac
npm run build:electron:mac:arm

# Compilar para Linux (AppImage)
npm run build:electron:linux
```

### Scripts de Deploy e Upload (HuggingFace + Cloudflare R2)

Para automação de compilação e publicação dos binários compilados:

* **`build-and-upload.ps1`**: Compila o executável portátil e envia automaticamente para o repositório no HuggingFace (com versionamento) e para o bucket Cloudflare R2 (como `xboxcompanion.exe`).
* **`upload-hf.ps1`**: Faz o upload apenas do executável para a pasta `XBOX360Companion/` no HuggingFace.
* **`upload-r2.ps1`**: Faz o upload do executável atualizado como `xboxcompanion.exe` no Cloudflare R2.
* **`build-portable-local.ps1`**: Compila localmente a versão portátil do Windows sem realizar o upload.

---

## Processo Estrito de Bump de Versão e Release

**Toda alteração funcional DEVE incluir o bump de versão.** Nunca envie alterações de código sem atualizar a versão nos 4 locais obrigatórios e no arquivo `CHANGELOG.md`.

### 1. Atualizar a Versão nos 4 Locais Obrigatórios

| Arquivo | O que alterar |
|---|---|
| `package.json` | `"version": "X.Y.Z"` |
| `src/electron-app/package.json` | `"version": "X.Y.Z"` |
| `src/server/main.go` | Linha de banner: `Xbox 360 Companion Backend Server vX.Y.Z` |
| `aurora-scripts/main.lua` | `scriptVersion = "X.Y.Z"` (linha 3) |

### 2. Atualizar o `CHANGELOG.md`
Mova a seção `[Unreleased]` para o novo cabeçalho `[X.Y.Z] - YYYY-MM-DD` e crie uma nova seção `[Unreleased]` vazia no topo.

### 3. Atualizar Referências no `README.md` e Documentações
Substitua as menções da versão antiga pela nova nos nomes de arquivos do instalador (`xbox-360-companion-Setup-X.Y.Z.exe`, `xbox-360-companion-Portable-X.Y.Z.exe`, `.dmg`, `.AppImage`).

### 4. Regras Absolutas de Release
* **NUNCA crie tags git.**
* **NUNCA crie GitHub Releases nem envie tags para o repositório remoto.**
* **Uploads de Artefatos:** Todo binário de release é publicado diretamente no **GoFile.io** (principal) e **file.kiwi** (espelho), e os links da tabela de downloads no `README.md` são atualizados no mesmo commit.

---

## Diretrizes de Desenvolvimento para Agentes

1. **Preservar a Integridade da Documentação:** Mantenha comentários, comentários de documentação e tipos intactos, a menos que o usuário solicite explicitamente a remoção.
2. **Inspecione Logs e Stack Traces Antes de Diagnosticar Erros:** Nunca faça suposições sobre falhas de runtime sem ler os logs completos gerados em `%APPDATA%\Xbox 360 Companion\logs\`.
3. **Sem Correções Superficiais de Sintomas:** Não resolva erros engolindo exceções, retornando dados falsos ou desativando verificações de testes. Identifique e corrija a causa raiz.
4. **Verificação Obrigatória:** Nunca declare uma tarefa concluída sem executar o comando de build (`npm run build:server` ou `npm run tsc`) para validar que não há erros de compilação.
5. **Nomes de Arquivo e Links de Código:** Ao mencionar arquivos no chat, crie links markdown clicáveis utilizando o esquema `file://` (ex: `[handlers.go](file:///e:/projects/Downloader-XBOX360-XEX-HDD-Games/src/server/interfaces/http/handlers.go)`).
