# Spec: Xbox Companion Android v1 — preparar pendrive ou HD já formatado no Xbox 360

- **Estado:** spec escrita (2026-10-11). As 2 perguntas do fim ("Perguntas ao dono") foram
  passadas a uma investigação sem console (o dono não tem console):
  [`docs/backlog/xbox360-pendrive-formatado-no-console-investigacao_2026-10-11.md`](../backlog/xbox360-pendrive-formatado-no-console-investigacao_2026-10-11.md).
  Ela trava só C12, C13 e os textos da T9; T1 a T6 e T8 andam em paralelo. Nada implementado.
- **Origem:** [`docs/backlog/xbox-companion-mobile-quanto-falta_2026-10-11.md`](../backlog/xbox-companion-mobile-quanto-falta_2026-10-11.md)
  (seções "Resultado" e "Respostas do dono") e
  [`docs/backlog/app-android-preparador-pendrive-badavatar_2026-10-11.md`](../backlog/app-android-preparador-pendrive-badavatar_2026-10-11.md)
  ("T0 — resultado"). Os números de prazo e as medições do pacote estão lá; aqui não se repetem.
- **Onde mora o código:** `src/android-app/` (o próprio Companion mobile) e um script novo em
  `src/electron-app/scripts/` (pacote mobile). Publicação: script novo na raiz, ao lado do
  `upload-r2.ps1`.

## 1. O QUE

O cliente que **não tem computador** e tem um Xbox 360 travado ou LT instala um APK, formata o
pendrive (ou HD) **no próprio console**, pluga no celular pelo OTG, e o app grava nele o mesmo
desbloqueio BadAvatar que o Companion de Windows grava. Depois o cliente leva o pendrive ao
console.

### Decisões já tomadas pelo dono (não reabrir)

| decisão | fonte |
|---|---|
| v1 só prepara pendrive ou HD **já formatado no Xbox 360**; o app não formata | backlog "Respostas do dono" 1 |
| catálogo, download de jogos, jogo no pendrive, FTP: **fora**, chegam depois como atualização do mesmo APK | idem |
| código em `src/android-app/`, não app novo | backlog "Resultado", parte 4 |
| `applicationId` e `namespace` continuam **`com.godsend.app`**; muda só o nome visível para **"Xbox Companion"** | backlog "Decisão do dono sobre o id" |
| distribuição por **APK avulso** (sem Play Store) | T0 "Respostas do dono" 3 |
| pacote no **R2**, `https://versions.digitalstoregames.com/XBOX360Companion/` | T0, R4 |
| só modo BadAvatar (bloqueado/LT); sem modo RGH | doc irmão, decisão 3 |
| HD externo **entra** (aceito, com aviso de energia) | backlog "O que isso muda" |
| quem escreve é um agente; o dono testa em celular com OTG; **o dono não tem Xbox 360** | ambos |

### Decisões que esta spec toma (o dono pode reverter; nenhuma muda prazo)

1. **O backend Go não roda na v1 e não vai no APK.** `MainActivity` deixa de iniciar
   `GodsendBackendService` e de abrir o WebView. O `.so` e a cópia em `assets/` saem do APK por
   exclusão no Gradle, mas **ficam no repositório** (a versão de jogos os traz de volta). O código
   de `GodsendBackendService.kt` fica no repositório, sem declaração no manifesto.
   Motivo: os riscos do Go no Android (DNS, SELinux, binário 43 commits atrás, 32 bits) ficam
   fora da v1, e o APK cai de ~31 MB para poucos MB.
2. **Permissões da v1:** saem `MANAGE_EXTERNAL_STORAGE`, `READ/WRITE_EXTERNAL_STORAGE`,
   `CHANGE_WIFI_MULTICAST_STATE`, `ACCESS_WIFI_STATE` e `usesCleartextTraffic`. Ficam `INTERNET`,
   `ACCESS_NETWORK_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `WAKE_LOCK`,
   `POST_NOTIFICATIONS`. Entra `REQUEST_INSTALL_PACKAGES` (atualização).
3. **Pendrive por SAF**, nunca caminho bruto `/storage/...`, nunca USB Host. Sem leitura de layout
   de disco (R2 do doc irmão): quem formatou foi o console.
4. **O pacote é baixado inteiro para o armazenamento do app antes de pedir o pendrive** (um `.zip`,
   ~730 MB). Download e gravação são fases separadas: o pendrive fica plugado só os 2 a 5 minutos
   da gravação, o que importa para HD sem fonte e para o cliente que baixa no Wi-Fi de casa.
5. **O app nunca apaga nada no pendrive fora dos caminhos que ele mesmo grava** (inclusive a pasta
   `Xbox360/` do console). Sem espaço, o app para e explica. Ver pergunta 1 ao dono.
6. **Interface nativa com Views + Material** (dependências que o `app/build.gradle.kts` já tem:
   `appcompat`, `material`, `constraintlayout`, `viewBinding = true`). Sem Compose, sem trocar a
   versão do AGP (8.2.2) nem do Kotlin (1.9.22). O `gradle/libs.versions.toml` (AGP 9, Compose)
   não é usado pelo build hoje e continua sem uso.
7. **Telemetria remota fica fora da v1** (item H do backlog é opcional). Em troca, toda tela de
   erro mostra um **código curto** e um botão "Copiar detalhes", para o cliente colar no WhatsApp.

### Fora do escopo da v1

Formatar; ler/consertar layout de disco; modo RGH; jogos, catálogo, FTP, Biblioteca; backend Go;
Play Store; iPhone; quarentena do estado de outro console **no dispositivo** (o filtro continua,
aplicado no PC); diário transacional completo do Windows (a v1 usa a retomada simplificada do T0);
apagar a `Xbox360/` do console; telemetria remota; recolher `crashlog.txt` do pendrive.

## 2. Critérios de aceite (EARS) e a prova de cada um

Notação: **[auto]** = teste que roda sem o dono; **[dono]** = rodada no celular do dono;
**[console]** = só com Xbox 360 real.

### Pacote mobile (PC → R2)

- **C1.** QUANDO o mantenedor roda o gerador do pacote mobile, o sistema DEVE produzir um zip cujo
  conteúdo é exatamente: os arquivos do manifesto ativo (`assets/badavatar-package.json` →
  `badavatar-<x>.manifest.json`) **menos** os que `isForeignConsoleStatePath` filtra, **mais** os
  três gerados (`launch.ini`, `AURORA_READY_TO_PLAY_FILTER_PATH`, `READY_TO_PLAY_MARKER_PATH`) com
  os bytes de `generateReadyToPlayLaunchIni()`, `generateAuroraReadyToPlayFilterLua()` e
  `generateReadyToPlayMarker()`, e um `mobile-manifest.json` com tamanho e SHA-256 de cada arquivo.
  - **Prova [auto]:** `src/electron-app/tests/unit/mobilePack.test.cjs` — gera o pacote de um
    manifesto pequeno de teste e confere a lista, o filtro, os bytes dos gerados (comparando com as
    funções TS) e cada SHA-256. Mais uma execução contra o pacote real: 617 arquivos de payload + 3
    gerados (contagem do T0).
- **C2.** SE o manifesto ativo não validar (mesmas regras de `loadManifest`: `manifestId`,
  `bundleSha256` recalculado, duplicatas sem diferenciar maiúsculas) ou algum arquivo em disco não
  conferir em SHA-256, ENTÃO o gerador DEVE falhar sem escrever o zip.
  - **Prova [auto]:** mesmo teste, com um byte trocado num arquivo de payload → exceção, nenhum zip.
- **C3.** O `mobile-manifest.json` DEVE marcar com `role: "exploit-profile"` exatamente os arquivos
  em que `isExploitProfilePath` é verdadeiro, e o gerador DEVE falhar se não houver nenhum.
  - **Prova [auto]:** teste unitário; no pacote real, 1 arquivo (`Content/E0002FF78DFBDE7B/...`).
- **C4.** QUANDO o mantenedor publica, o sistema DEVE enviar ao R2 o zip versionado, o `.sha256`
  dele e por último o índice `badavatar-mobile.json`; SE o envio do zip falhar, ENTÃO o índice NÃO
  DEVE ser trocado.
  - **Prova [auto]:** `-DryRun` do script imprime a ordem e os comandos; **[dono]** primeira
    publicação real, conferida com `curl` no índice e no `.sha256`.

### Download do pacote no celular

- **C5.** QUANDO o cliente toca "Baixar", o app DEVE baixar o zip apontado pelo índice para o
  armazenamento do próprio app, retomando de onde parou (HTTP `Range`) depois de queda de rede,
  de o app ir para segundo plano ou de a tela apagar.
  - **Prova [auto]:** teste com servidor HTTP local (um `com.sun.net.httpserver.HttpServer` do
    JDK, sem dependência nova) que corta a conexão no meio → o segundo pedido manda
    `Range: bytes=<n>-` e o arquivo final confere. **[dono]** desligar o Wi-Fi no meio e religar.
- **C6.** O app DEVE conferir o SHA-256 do zip contra o `.sha256` publicado e, ao gravar, cada
  arquivo contra o `mobile-manifest.json`; SE algum não conferir, ENTÃO DEVE apagar o zip, dizer
  "o download veio corrompido, baixe de novo" e não gravar nada no pendrive.
  - **Prova [auto]:** zip com um byte alterado → estado `CORROMPIDO`, nenhuma chamada de escrita
    ao destino falso.
- **C7.** ANTES de baixar, SE o celular não tiver espaço livre para o zip mais 10% de folga, ENTÃO o
  app DEVE dizer quanto falta, em GB, e não iniciar.
  - **Prova [auto]:** unitário da regra com `freeBytes` injetado.
- **C8.** ENQUANTO baixa ou grava, o app DEVE manter um serviço em primeiro plano com notificação de
  progresso, para o sistema não matar o trabalho com a tela apagada.
  - **Prova [dono]:** baixar com a tela apagada por 5 minutos; o progresso continua.

### Escolha do pendrive

- **C9.** QUANDO o cliente toca "Escolher pendrive", o app DEVE abrir o seletor do sistema na raiz
  do volume removível (API 29+: `StorageVolume.createOpenDocumentTreeIntent()`; API 26–28:
  `ACTION_OPEN_DOCUMENT_TREE`) e guardar a permissão (`takePersistableUriPermission`).
- **C10.** SE a pasta escolhida não for a raiz de um volume removível (memória interna ou uma
  subpasta), ENTÃO o app DEVE recusar e explicar
  "escolha o pendrive inteiro, não uma pasta".
  - **Prova [auto]** de C9/C10: unitário da regra sobre o `documentId` da árvore (raiz =
    `<UUID>:` sem caminho) e `StorageVolume.isRemovable`; **[dono]** escolher uma subpasta e a
    memória interna → recusado.
- **C11.** SE o volume aparecer como exFAT ou NTFS em `/proc/self/mounts`, ENTÃO o app DEVE recusar
  e mandar formatar no console. SE o tipo não puder ser lido, ENTÃO o app segue, e o registro diz
  "sistema de arquivos não conferido".
  - **Prova [auto]:** unitário do parser de `/proc/self/mounts` com linhas reais de `vfat`,
    `exfat`, `sdfat`, `fuse` e `ntfs3` (coletar as linhas reais na rodada R1 do dono).
- **C12.** SE a raiz não tiver a pasta `Xbox360/` (sinal de que o console não formatou), ENTÃO o
  app DEVE avisar "este pendrive não parece ter sido formatado no Xbox 360" e só continuar com
  confirmação explícita. Ver pergunta 2 ao dono.
  - **Prova [auto]:** unitário; **[dono]** pendrive formatado no PC → aviso.
- **C13.** SE o espaço livre do volume (`DocumentsContract.Root.COLUMN_AVAILABLE_BYTES`) for menor
  que o necessário — soma de cada arquivo ainda não gravado arredondada para o pior cluster FAT32
  (32 KiB), mais 16 MiB de folga para diretórios —, ENTÃO o app DEVE parar, dizer quanto falta, e,
  se existir `Xbox360/`, explicar que o console reservou o espaço e como reformatar escolhendo
  "Personalizar" para deixar pelo menos 1 GB livre.
  - **Prova [auto]:** unitário da regra. **[console]** o número real de espaço após "Configurar
    agora" (R1).

### Gravação com retomada

- **C14.** O app DEVE gravar os arquivos na ordem: payload comum (ordem do manifesto) → `launch.ini`
  e o filtro Lua → marcador → **perfil do exploit por último**. O recibo vem depois, fora dessa
  lista.
  - **Prova [auto]:** teste do gravador sobre um destino falso em memória que registra a ordem.
- **C15.** Cada arquivo DEVE ir para `<nome>.xcpartial` na pasta final, ser relido e conferido em
  tamanho e SHA-256 e só então renomeado (`DocumentsContract.renameDocument`) para o nome final,
  substituindo um alvo antigo de mesmo nome sem diferenciar maiúsculas.
  - **Prova [auto]:** destino falso; **[dono]** pendrive real, conferido no PC (C19).
- **C16.** QUANDO uma gravação recomeça (pendrive tirado, app fechado, celular desligado), o app
  DEVE pular todo arquivo cujo alvo já confere em tamanho e SHA-256, apagar os `.xcpartial`
  restantes e continuar do primeiro que não confere, sem regravar o que já conferiu.
  - **Prova [auto]:** destino falso que falha no arquivo 300 de 620 → segunda execução escreve só
    do 300 em diante (contagem de escritas). **[dono]** tirar o pendrive no meio, plugar, retomar.
- **C17.** ENQUANTO o perfil do exploit não estiver gravado e conferido, NENHUM texto do app DEVE
  dizer que o pendrive está pronto; e o app nunca diz que o console foi desbloqueado.
  - **Prova [auto]:** teste de estado: interrupção em qualquer ponto antes do último arquivo →
    estado `INCOMPLETO`. **[auto]** busca nos `strings.xml` por "desbloquead" → zero ocorrências.
- **C18.** Nomes no pendrive DEVEM ser resolvidos sem diferenciar maiúsculas antes de criar
  pasta ou arquivo (o FAT não diferencia; o SAF criaria `Aurora (1)` ao lado de `AURORA`).
  - **Prova [auto]:** destino falso com `AURORA/` preexistente → grava dentro dele, não cria outro.
  **[dono]** pendrive com `AURORA/` criada no PC.
- **C19 (equivalência).** QUANDO a gravação termina, o pendrive levado ao PC DEVE: (1) ter cada
  arquivo do `mobile-manifest.json` com tamanho e SHA-256 corretos; (2) ter os três gerados iguais
  à saída das funções TS na versão atual; (3) não ter nenhum arquivo do estado alheio; (4) dar
  `detectPreparedDeviceState(...) === "preparado-bloqueado-lt"`; (5) ter o recibo com
  `origin: "android"`; (6) passar em `assessXboxLayout` (o console formatou; isto confirma).
  - **Prova [dono + auto]:** `node src/electron-app/scripts/verify-mobile-prepared-drive.js E:`
    depois de uma gravação real; sai com código 0 e imprime os 6 itens.
- **C20.** O Companion de Windows, ao preparar de novo um pendrive gravado pelo app, DEVE
  reaproveitar os arquivos (sem conflito de diário).
  - **Prova [dono]:** preparar no Windows um pendrive feito pelo celular, sem "Formatar antes" →
    termina com `reusedFiles` ≈ total. (Hoje garantido por leitura: `fileMatches` em
    `simulatedTransactionalWriter.ts` reaproveita alvo que confere em SHA-256.)

### Recibo

- **C21.** QUANDO a gravação termina e confere, o app DEVE gravar `.xbox-downloader/preparo.json`
  com `schemaVersion: 1`, `mode: "bloqueado-lt"`, `preparedAt` (ISO), `appVersion` (o
  `versionName` do APK), `release`, `readyToPlayVersion` e o campo novo opcional
  `origin: "android"`, no mesmo formato de `writePreparationReceipt` (JSON com 2 espaços + CRLF).
  Falha ao gravar o recibo NÃO derruba o preparo.
  - **Prova [auto]:** unitário Kotlin do JSON; o tipo `PreparationReceipt` no TS ganha
    `origin?: "windows" | "android"` e `npm run test:safety` continua verde.

### Identidade, atualização e distribuição

- **C22.** O APK instalado DEVE aparecer no celular como **"Xbox Companion"**, com
  `applicationId` `com.godsend.app`, assinado pela chave de release.
  - **Prova [auto]:** `aapt2 dump badging app-release.apk` → `package: name='com.godsend.app'`,
    `application-label:'Xbox Companion'`; `apksigner verify --print-certs` → SHA-256 do
    certificado igual ao registrado na seção 4.
- **C23.** QUANDO o app abre (e no máximo uma vez a cada 6 h), ele DEVE ler
  `XBOX360Companion/android/version.json`; SE o `versionCode` publicado for maior que o instalado,
  ENTÃO DEVE oferecer a atualização — **nunca no meio de uma gravação**.
- **C24.** QUANDO o cliente aceita, o app DEVE baixar o APK, conferir o SHA-256 do índice **e** que o
  certificado de assinatura do APK baixado é o mesmo do app instalado; SE algum não conferir,
  ENTÃO DEVE descartar o arquivo e não abrir o instalador. Se conferir, abre o instalador do
  sistema; sem a permissão "instalar apps desconhecidos", leva o cliente a essa tela com instrução.
  - **Prova [auto]** de C23/C24: unitário da comparação de versão e da decisão (hash errado,
    certificado diferente → descarta); **[dono]** instalar a 1.0.0, publicar uma 1.0.1 de teste,
    abrir o app → atualiza por cima sem perder a permissão do pendrive.
- **C25.** O APK DEVE estar disponível num link fixo para o suporte mandar
  (`.../XBOX360Companion/android/xboxcompanion.apk`) e num versionado; o script de publicação DEVE
  recusar um `versionCode` menor ou igual ao já publicado.
  - **Prova [auto]:** `-DryRun` com `versionCode` repetido → erro.

### Textos para leigo

- **C26.** Cada passo DEVE ter um texto curto com o que fazer: instalar (apps desconhecidos),
  baixar, formatar no console (Configurações > Sistema > Armazenamento, com fotos), plugar, gravando
  ("não tire o pendrive"), pronto (o que fazer no console). HD externo: aviso de que o OTG
  costuma não alimentar HD de 2,5" sem fonte ou hub com energia.
  Cada erro diz o que fazer e mostra um código curto (`XC-<área>-<n>`).
  - **Prova [dono]:** o dono lê todas as telas numa rodada e aprova. **[auto]** teste que todo
    código de erro do enum tem texto em `strings.xml`.

### Console (fora do prazo de desenvolvimento)

- **C27.** Um console real travado/LT DEVE rodar o BadAvatar a partir de um pendrive formatado no
  próprio console e preparado só pelo app (fecha R1).
  - **Prova [console]:** primeiro cliente acompanhado pelo suporte. Até lá o app é oferecido "novo,
    com acompanhamento" (condição 2 do doc irmão).

## 3. COMO (design)

### 3.1 Pacote mobile (PC)

`src/electron-app/scripts/build-mobile-pack.js` (Node, usa os `.js` que o `tsc` gera ao lado dos
`.ts`, como os testes em `tests/unit/` já fazem):

1. lê `assets/badavatar-package.json` e o manifesto, e valida com as **mesmas** regras de
   `loadManifest` — exportar de `fixedBadAvatarPreparationService.ts` uma função pura
   `validateFixedPayloadManifest(index, manifest)` extraída de `loadManifest`, em vez de copiar a
   regra (hoje `loadManifest` não é exportada);
2. confere SHA-256 de cada arquivo em `assets/<directoryName>/`;
3. tira os de `isForeignConsoleStatePath`; adiciona os três gerados (bytes UTF-8 das funções de
   `readyToPlayConfiguration.ts`, substituindo entrada de mesmo nome sem diferenciar maiúsculas,
   como `replaceGeneratedEntry`);
4. escreve `mobile-manifest.json`:
   ```json
   {
     "schemaVersion": 1,
     "packId": "xboxcompanion.mobile.badavatar",
     "release": "1.1-autostart-aurora-freestyle-dashlaunch-xexmenu",
     "bundleSha256": "<do manifesto de origem>",
     "readyToPlayVersion": "4",
     "fileCount": 620,
     "totalBytes": 0,
     "files": [
       { "path": "apps/...", "sizeBytes": 0, "sha256": "...", "role": "payload" },
       { "path": "launch.ini", "sizeBytes": 0, "sha256": "...", "role": "generated" },
       { "path": "Content/E0002FF78DFBDE7B/...", "sizeBytes": 0, "sha256": "...", "role": "exploit-profile" }
     ]
   }
   ```
   (`fileCount` e tamanhos são os do pacote real; o exemplo só mostra a forma.) A ordem do array
   **é** a ordem de gravação de C14; o app não reordena.
5. empacota em `dist/android/badavatar-mobile-<release>-rtp<N>.zip` (zip comum; o manifesto vai na
   raiz do zip) e grava `<zip>.sha256` no formato `"<hash>  <nome>"`, igual ao `upload-r2.ps1`.

`npm run mobile-pack:build` no `src/electron-app/package.json`.

### 3.2 Publicação (R2)

`upload-r2-android.ps1` na raiz, copiando do `upload-r2.ps1` a leitura de credenciais
(`build.properties` → `R2_*`, ou `r2-config.json`; os dois já ignorados pelo git), o `Find-Rclone` e
os `--s3-*`. Dois modos:

- `-Pack`: envia `XBOX360Companion/android/badavatar-mobile-<release>-rtp<N>.zip` e `.sha256`,
  confere o tamanho remoto com `rclone lsjson`, e **só então** grava o índice
  `XBOX360Companion/android/badavatar-mobile.json`:
  `{ schemaVersion, release, readyToPlayVersion, bundleSha256, url, sha256, size }`.
- `-Apk`: lê `versionCode`/`versionName` do `app/build.gradle.kts`, recusa `versionCode` ≤ o do
  `version.json` publicado, envia `xboxcompanion-<versionName>.apk`, a cópia fixa
  `xboxcompanion.apk` e por último `XBOX360Companion/android/version.json`:
  `{ versionCode, versionName, releaseDate, url: ".../xboxcompanion-<v>.apk?v=<v>", sha256, size,
  minSdk, notes }` (o `?v=` pelo mesmo motivo de cache da Cloudflare documentado em
  `docs/ATUALIZACAO-AUTOMATICA.md`).
- `-DryRun` nos dois.

`docs/ATUALIZAR-PACOTE-BADAVATAR.md` ganha o passo: depois de `payload:update` e `test:safety`,
`npm run mobile-pack:build` e `.\upload-r2-android.ps1 -Pack`. Sem isso o celular continua
gravando o pacote anterior (o índice é a verdade do celular).

### 3.3 App Android

Pacote Kotlin `com.godsend.app.prep` (namespace continua `com.godsend.app`):

| peça | o que faz |
|---|---|
| `PrepActivity` (vira a `LAUNCHER`; `MainActivity` sai do manifesto) | uma activity com 5 telas (`ViewFlipper`/fragments simples): Início → Baixar → Formatar no console → Escolher e gravar → Pronto. Estado vem do `PrepService` |
| `PrepService` (foreground, `dataSync`, WakeLock só enquanto trabalha) | executa download e gravação; publica progresso por `StateFlow`; sobrevive à tela apagada (C8) |
| `PackRepository` | lê o índice, baixa o zip com `HttpURLConnection` + `Range` para `filesDir/pack/`, confere `.sha256`, lê o `mobile-manifest.json` (C5–C7) |
| `DriveAccess` | interface com `list/child/createDir/createFile/openWrite/openRead/rename/delete/freeBytes`. Implementação `SafDriveAccess` (DocumentsContract) e `FakeDriveAccess` (memória, para testes) |
| `DrivePicker` | intent do seletor, validação de raiz removível (C9–C10), leitura de `/proc/self/mounts` (C11), sinal `Xbox360/` (C12), espaço (C13) |
| `PackWriter` | ordem, `.xcpartial` + releitura + rename, pulo do que confere, nomes sem diferenciar maiúsculas (C14–C18). Lê cada entrada **direto do zip** (`java.util.zip.ZipFile`) para o `openWrite`, calculando o SHA-256 no caminho |
| `ReceiptWriter` | C21 |
| `UpdateChecker` | C23–C24; `FileProvider` em `cacheDir/update/`; conferência do certificado com `PackageManager.getPackageArchiveInfo(..., GET_SIGNING_CERTIFICATES)` (API 28+) e `GET_SIGNATURES` em 26–27 |
| `ErrorCode` | enum `XC-*` → texto de `strings.xml` + "Copiar detalhes" (C26) |

**Retomada sem diário.** O estado da gravação não precisa ser guardado: a retomada é recalculada
comparando o pendrive com o manifesto (C16). O único estado persistido é a URI da árvore e o UUID
do volume (para a tela saber que é "o mesmo pendrive"). Isso é a retomada simplificada do T0
("O que fica fora da v1"): perde o "tudo ou nada" para arquivos preexistentes substituídos, o que
não pesa num pendrive recém-formatado pelo console. Custo da releitura na retomada: hashear o que
já está no pendrive (~723 MB a 15–30 MB/s, 0,5–1 min); aceitável. Otimização permitida se
medida lenta: conferir só tamanho na retomada e SHA-256 completo só no fim.

**Releitura logo depois de gravar** pode vir do cache de páginas do Android e não do pendrive (T0,
R3). Ela pega erro de cópia, não de mídia; a prova de mídia é C19 no PC. Não tentar contornar na
v1.

**Ordem e o que o Windows vê numa interrupção:** com o marcador gravado e o perfil ainda não,
`detectPreparedDeviceState` responde `preparado-rgh` (ele aceita qualquer `ready-to-play-v*.marker`).
É impreciso mas não afirma desbloqueio, que é o invariante do `AGENTS.md`. Pôr o marcador depois do
perfil faria o inverso — responder `preparado-bloqueado-lt` com o pendrive incompleto —, por isso o
perfil é o último.

### 3.4 Gradle e manifesto

- `res/values/strings.xml` `app_name` = "Xbox Companion"; `AndroidManifest.xml`
  `android:label="@string/app_name"`; `settings.gradle.kts` `rootProject.name` opcional.
- `versionCode = 1`, `versionName = "1.0.0"` na primeira release; +1 a cada APK publicado.
- `packaging { jniLibs { excludes += "**/libgodsend.so" } }` e
  `androidResources { ignoreAssetsPattern = "!godsend-android-*" }` (ou equivalente que o AGP
  8.2.2 aceite — conferir na T5; a prova é o `aapt2`/`unzip -l` do APK sem o binário).
- `signingConfigs.release` lendo de `build.properties` (raiz, ignorado): `ANDROID_KEYSTORE_PATH`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Sem as chaves, o
  `assembleRelease` falha com mensagem (nunca cai para a chave de debug).
- `dependencies`: `androidx.documentfile` não é necessário (usar `DocumentsContract` direto, que dá
  controle de nome e de `renameDocument`); testes: `junit`, `androidx.test.ext:junit`,
  `kotlinx-coroutines-test`.

## 4. Chave de release (fora do repositório)

Criar uma vez, na T5: `keytool -genkeypair -v -keystore <fora do repo>\xboxcompanion-release.jks
-alias xboxcompanion -keyalg RSA -keysize 4096 -validity 36500`. Guardar o `.jks` e as senhas em
**dois lugares** fora desta máquina. Registrar aqui só o SHA-256 do certificado (prova de C22):

- SHA-256 do certificado de release: *(preencher na T5)*

Perder a chave = nunca mais atualizar o app por cima nos clientes (igual a trocar o id).

## 5. Tasks (cada uma com o teste que a prova)

Ordem pensada para que o dono teste o mais cedo possível o que só o celular prova.

| # | task | arquivos/símbolos | prova | rodada do dono |
|---|---|---|---|---|
| **T1** | teste rápido do SAF num celular real: app de debug mínimo grava 620 arquivos sintéticos (mesma distribuição de tamanhos do T0) num pendrive por SAF; mede tempo, testa `renameDocument`, `AURORA` x `Aurora`, `/proc/self/mounts`, `COLUMN_AVAILABLE_BYTES`, tirar o pendrive no meio. Pode ser descartado depois; o que fica é o número | `src/android-app/app/src/main/java/com/godsend/app/prep/` (rascunho de `SafDriveAccess`) | log com tempos e resultados copiado para a seção 6 | R1 |
| **T2** | pacote mobile: extrair `validateFixedPayloadManifest` de `loadManifest`; `build-mobile-pack.js`; `npm run mobile-pack:build` | `src/electron-app/services/fixedBadAvatarPreparationService.ts::loadManifest`, `scripts/build-mobile-pack.js` | C1, C2, C3 em `tests/unit/mobilePack.test.cjs`; `npm run test:safety` verde | — |
| **T3** | publicação: `upload-r2-android.ps1` (`-Pack`, `-Apk`, `-DryRun`); passo novo em `docs/ATUALIZAR-PACOTE-BADAVATAR.md`; primeira publicação do pacote | raiz | C4, C25 (`-DryRun`); `curl -sI` no zip e no índice | — (o dono autoriza a publicação) |
| **T4** | verificador de equivalência no PC | `src/electron-app/scripts/verify-mobile-prepared-drive.js` (usa `detectPreparedDeviceState`, `isForeignConsoleStatePath`, funções de `readyToPlayConfiguration`, `assessXboxLayout` sobre `readWindowsUsbDiskLayout`) | roda contra uma pasta montada pelo próprio `build-mobile-pack` → 0; com um arquivo a menos → ≠ 0 | — |
| **T5** | identidade e build: nome visível, permissões, exclusão do Go, chave de release, `signingConfig`, `PrepActivity` vazia como `LAUNCHER` | `strings.xml`, `AndroidManifest.xml`, `app/build.gradle.kts` | C22 (`aapt2 dump badging`, `apksigner verify`, `unzip -l` sem `libgodsend.so`) | — |
| **T6** | download: `PackRepository` + `PrepService` | `prep/PackRepository.kt`, `prep/PrepService.kt` | C5, C6, C7 (instrumentados/unitários); C8 | R2 (junto da T7) |
| **T7** | pendrive e gravação: `DrivePicker`, `SafDriveAccess`, `PackWriter`, `ReceiptWriter`; tipo `origin?` no TS | `prep/*.kt`, `src/electron-app/infrastructure/preparationReceipt.ts::PreparationReceipt` | C9–C18, C21 sobre `FakeDriveAccess`; C19 com T4 no pendrive real; C20 no Windows | R2: gravação completa + C19; R3: tirar no meio + C16 + C20 |
| **T8** | atualização do APK: `UpdateChecker`, `FileProvider`, `REQUEST_INSTALL_PACKAGES` | `prep/UpdateChecker.kt`, `res/xml/file_paths.xml` | C23, C24 unitários; 1.0.0 → 1.0.1 de teste no celular | R4 |
| **T9** | telas e textos para leigo, códigos de erro, fotos do "formatar no console" | `res/layout/*`, `res/values/strings.xml`, `prep/ErrorCode.kt` | C17 (busca "desbloquead"), C26 (todo `ErrorCode` com texto) | R4 (o dono lê) |
| **T10** | primeira release: `assembleRelease`, `upload-r2-android.ps1 -Apk`, link para o suporte; atualizar `src/android-app/README.md` (v1 = preparo; Go fora do APK) | — | C22, C25 no APK publicado | — |
| **T11** | fora do repo, **depois** de C27 com o primeiro cliente: guia do agente (`digitalstoregamesproject`, `fragments/instrucoes/xbox360.md`) oferece o app de forma ampla; manual | outro repo | registro no bug de origem | — |

Estimativa (do backlog, não refeita): ~7 a 9 sessões de agente e 3 a 4 rodadas do dono,
~2 a 2,5 semanas. C27 fica fora desse prazo.

## 6. Registro da análise (o que foi aberto para escrever esta spec)

**Símbolos abertos nesta sessão (2026-10-11)** — além dos já listados nos dois docs de origem:

- `src/android-app/app/build.gradle.kts` — `namespace`/`applicationId` `com.godsend.app`,
  `versionCode 1`, `versionName 1.0.0`, minSdk 26, targetSdk 34, `viewBinding = true`, deps
  `appcompat 1.6.1`, `material 1.11.0`, `constraintlayout`, `webkit`, `coroutines 1.7.3`; sem
  `signingConfigs`; `useLegacyPackaging = true`.
- `src/android-app/build.gradle.kts` — AGP 8.2.2, Kotlin 1.9.22; wrapper Gradle 8.5.
  `gradle/libs.versions.toml` (AGP 9.0.1, Compose) **não** é referenciado pelos `build.gradle.kts`.
- `AndroidManifest.xml` — permissões listadas na decisão 2; `android:label="GODsend-360"` literal
  (não usa `@string/app_name`); tema `Theme.GODsend360`.
- `res/values/strings.xml` — só `app_name = GODsend-360`.
- `MainActivity.kt` — `onCreate` chama `checkAndRequestPermissions()` (abre a tela de
  `MANAGE_EXTERNAL_STORAGE` em API 30+), `startBackendService()` e o WebView em `127.0.0.1:8080`.
- `GodsendBackendService.kt` — executa `nativeLibraryDir/libgodsend.so`; se faltar, copia de
  `assets/godsend-android-arm64` (ou `-amd64` em x86_64) — a cópia em `assets/` é fallback, não
  duplicata morta.
- `src/electron-app/services/fixedBadAvatarPreparationService.ts` — `loadPackageIndex`,
  `loadManifest` (não exportadas), `exploitProfileFiles` (exportada, memorizada),
  `replaceGeneratedEntry` (substitui sem diferenciar maiúsculas), `prepareFixedBadAvatarDevice`
  (ordem: crash → formatar → FAT32 → layout → filtro alheio → gerados → plano → espaço →
  quarentena → gravação → recibo). Os caminhos do manifesto são gravados **como estão** na raiz do
  dispositivo (`apps/...`, `Aurora/...`, `Content/...`).
- `infrastructure/readyToPlayConfiguration.ts` — `READY_TO_PLAY_CONFIGURATION_VERSION = "4"`,
  `AURORA_READY_TO_PLAY_FILTER_PATH = Aurora/User/Scripts/Content/Filters/XboxCompanionReady.lua`,
  `READY_TO_PLAY_MARKER_PATH = .xbox-downloader/ready-to-play-v4.marker`; as três funções devolvem
  strings fixas com CRLF.
- `infrastructure/preparationReceipt.ts` — `PREPARATION_RECEIPT_PATH`, `PreparationMode`,
  `PreparationReceipt` (sem `origin`), `writePreparationReceipt` (JSON 2 espaços + `\r\n`).
- `infrastructure/foreignConsoleState.ts::isForeignConsoleStatePath` — 4 regex sobre o caminho em
  minúsculas.
- `infrastructure/exploitProfile.ts::isExploitProfilePath` — `Content/<id>/...` com id ≠
  `0000000000000000`.
- `services/preparedDeviceState.ts::detectPreparedDeviceState` — perfil por tamanho
  (`matchesBundledSize`) → `preparado-bloqueado-lt`; qualquer `ready-to-play-v*.marker` →
  `preparado-rgh`. Base de C19(4) e da decisão de ordem em 3.3.
- `infrastructure/simulatedTransactionalWriter.ts::fileMatches` (tamanho + SHA-256 → reaproveita)
  e `metadataPaths` (`.xbox-downloader/transactions|staging|backup`) — o sufixo `.xcpartial` do app
  não colide com nada do Windows.
- `infrastructure/transactionalWritePlan.ts` — lista de nomes reservados na raiz (`apps`, `aurora`,
  `content`, `launch.ini`, `.xbox-downloader`...).
- `upload-r2.ps1` — credenciais de `build.properties`/`r2-config.json`, `Find-Rclone`,
  `XBOX360Companion/`, `.sha256` no formato `"<hash>  <nome>"`, `version.json` com `?v=`.
- `services/autoUpdateService.ts` e `docs/ATUALIZACAO-AUTOMATICA.md` — formato do `version.json`
  do Windows (versão em texto); o do Android usa `versionCode` inteiro porque é o que o instalador
  do Android compara.
- `docs/ATUALIZAR-PACOTE-BADAVATAR.md` — `payload:update` → `test:safety` → build; sem passo de R2.
- `src/electron-app/package.json` — `test:safety` = `tsc` + typecheck + `node --test tests/unit/*.test.cjs`;
  o `tsc` gera `.js` ao lado do `.ts` (os testes fazem `require("../../infrastructure/x.js")`).
- `.gitignore` — `build.properties` e `r2-config.json` ignorados (onde vão as senhas da chave).

**Hipóteses descartadas nesta sessão**

- **Baixar o pacote arquivo por arquivo direto para o pendrive** (não ocupa o celular): descartado
  porque deixa o pendrive/HD plugado durante todo o download (dezenas de minutos no Wi-Fi do
  cliente, pior com HD sem fonte) e mistura falha de rede com falha de mídia na mesma retomada.
  Os ~730 MB no celular são avisados antes (C7).
- **Gravar o marcador por último** (depois do perfil): faria o Windows responder
  `preparado-bloqueado-lt` para um pendrive interrompido; ver 3.3.
- **Portar o diário transacional do Windows:** já descartado no T0 (+3 a 4 d); a retomada por
  comparação com o manifesto cumpre C16.
- **Compose para as telas:** exigiria trocar AGP/Kotlin (o `libs.versions.toml` aponta para AGP 9,
  mas não é usado); Views + Material já estão nas dependências.
- **App confiar no próprio pacote embutido:** APK de ~750 MB e uma release a cada troca de pacote;
  já descartado no T0 (R4 = R2).
- **Copiar a regra de `loadManifest` para o script do pacote:** duas cópias da validação divergem;
  extrair a função pura.

**Riscos que continuam** (detalhes nos docs de origem): R1 (espaço depois do "Configurar agora",
só console prova — C13 e C27); compatibilidade do SAF/OTG por fabricante (T1 mede); celular sem
~0,8 GB livre (C7); HD sem energia pelo OTG (texto + retomada).

## Perguntas ao dono

**Em investigação (2026-10-11):** o dono não tem console e pediu que se investigue como o console
trata o pendrive. A investigação está em
[`docs/backlog/xbox360-pendrive-formatado-no-console-investigacao_2026-10-11.md`](../backlog/xbox360-pendrive-formatado-no-console-investigacao_2026-10-11.md)
e, ao terminar, troca as duas perguntas abaixo pela resposta e ajusta C12, C13, a decisão 5 e a
T9. Até lá, o texto abaixo é o comportamento provisório.

1. **Pendrive sem espaço porque o console reservou tudo ("Configurar agora").** A spec manda o
   cliente reformatar no console escolhendo "Personalizar" e deixar ≥ 1 GB livre, e o app **nunca
   apaga** a `Xbox360/`. A alternativa é o app oferecer apagar a `Xbox360/` com confirmação (+0,5
   sessão), mas ninguém provou que o console e o BadAvatar aceitam isso. Fica como está até o
   primeiro console?
2. **Pendrive sem a pasta `Xbox360/`** (por exemplo, formatado no PC ou preparado antes pelo
   Companion de Windows). A spec avisa e deixa continuar com confirmação. Prefere bloquear?

## Frase de abertura da próxima sessão

São duas frentes independentes; podem ir para duas sessões.

**Investigação (perguntas 1 e 2):** a frase de abertura está no fim de
[`docs/backlog/xbox360-pendrive-formatado-no-console-investigacao_2026-10-11.md`](../backlog/xbox360-pendrive-formatado-no-console-investigacao_2026-10-11.md).

**Implementação:** *"Leia a spec `docs/specs/xbox-companion-android-v1-preparo_2026-10-11.md` no repo
`C:\projects\Downloader-XBOX360-XEX-HDD-Games` (seções 3, 5 e 6) e execute a T2 (pacote mobile) e a
T4 (verificador de equivalência), que não dependem do celular. Em paralelo, prepare a T1 (teste
rápido do SAF) para a rodada R1 do dono."*
