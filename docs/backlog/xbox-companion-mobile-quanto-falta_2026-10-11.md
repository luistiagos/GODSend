# Backlog: quanto falta para terminar o Xbox Companion mobile (Android)

- **Estado:** partes 1 a 5 respondidas por leitura de código em 2026-10-11 (seção "Resultado");
  nada executado em aparelho. Aguarda o dono nas duas perguntas do fim do resultado.
- **Aberto em:** 2026-10-11, a pedido do dono
- **Doc irmão:** [`app-android-preparador-pendrive-badavatar_2026-10-11.md`](app-android-preparador-pendrive-badavatar_2026-10-11.md),
  com a medição do **preparo do pendrive** no Android (seção "T0 — resultado"). Aquele doc
  responde quanto custa a peça do preparo; este responde quanto falta para o app inteiro.

## Pergunta do dono

Quanto ainda falta, em complexidade e em tempo, para terminar o **Xbox Companion versão mobile**?
"Já temos algumas coisas feitas nele." A resposta decide entre:

1. lançar antes um app reduzido que só prepara o pendrive (doc irmão), já com o `applicationId`,
   o nome e a chave de assinatura definitivos, e depois atualizar por cima para o completo; ou
2. pular o reduzido e terminar o Companion mobile com o preparo dentro.

Recomendação já registrada no doc irmão ("Vale lançar o app reduzido..."): o reduzido só **não**
vale se o Companion mobile completo puder sair em menos de ~3 semanas.

## Decisão do dono que muda o escopo (2026-10-11)

**A versão mobile não formata o pendrive.** O cliente formata no próprio Xbox 360 (Configurações >
Sistema > Armazenamento), guiado pela documentação e pelo agente de suporte do WhatsApp. Ficam fora
do mobile, por enquanto: `formatVolumeFat32`, a leitura de layout por USB Host e o reparo de disco.
Também já decidido (doc irmão): quem escreve o código é um agente, o dono testa num celular Android
com OTG e pendrive, e a distribuição é **APK avulso** (sem Play Store), com o pacote BadAvatar no R2
(`https://versions.digitalstoregames.com/XBOX360Companion/`).

## O que já se sabe (aberto e conferido na sessão de 2026-10-11, não refazer)

- `src/android-app/` = **o Companion mobile**. `AGENTS.md` (seções 1 e 3): o backend Go
  (`src/server/`) roda no PC ou no Android; no Android vai embutido como `libgodsend.so` (15,5 MB,
  compilado em 2026-08-04). Último commit em `app/src`: `978e128`, 2026-08-18, mensagem `*`.
- `app/src/main/java/com/godsend/app/MainActivity.kt` (114 linhas): só um WebView em
  `http://127.0.0.1:8080` e o pedido de `MANAGE_EXTERNAL_STORAGE`. Não usa a interface React do
  Electron (`src/electron-app/renderer`): a tela vem do HTML que o próprio Go serve
  (`src/server/interfaces/http/handlers.go`, tela de passos com `fetch('/tools/storage-drives')`
  por volta da linha 1926).
- `app/src/main/java/com/godsend/app/service/GodsendBackendService.kt` (172): serviço em primeiro
  plano que executa o binário Go com WakeLock de 24 h; variáveis `GODSEND_HOME`, `GODSEND_PORT=8080`
  e `GODSEND_TRANSFER`.
- `src/server/interfaces/http/handlers_tools.go::handleToolsStorageDrives`: o "modo pendrive" só
  lista `/storage/*` e testa escrita; não sabe nada de BadAvatar. Em `src/server`, `grep -i
  "badavatar|exploitProfile|launch.ini"` acha dois comentários e nenhum código: **o preparo do
  pendrive só existe no Electron, em TypeScript** (`services/fixedBadAvatarPreparationService.ts`).
- `app/build.gradle.kts`: `applicationId = "com.godsend.app"`, `versionName = "1.0.0"`, minSdk 26,
  targetSdk 34, rótulo "GODsend-360". O nome e o id definitivos do Companion mobile ainda não
  existem. Decidir isso é pré-requisito da opção 1 acima.
- Ambiente desta máquina pronto: SDK em `D:\DevCaches\Android\Sdk`, JDK 17, `adb`, `gradlew`, e
  existe `app/build/outputs/apk/debug/app-debug.apk`. Nenhum celular estava conectado
  (`adb devices` vazio), então **nada foi executado em aparelho**.
- Medido no doc irmão: o preparo no Android sai em ~6 a 8 sessões de agente se for feito em Kotlin
  com SAF e com o pacote mobile gerado no PC.

## O que esta sessão precisa responder

**1. Inventário de funcionalidades: Companion de Windows x Companion mobile.** Listar o que o
Companion de Windows faz e, para cada item, dizer se o mobile já tem, tem pela metade ou não tem,
**com a prova** (rota HTTP em `src/server/interfaces/http/router.go`, tela no HTML do Go, ou teste
em aparelho). Fontes do lado Windows: `docs/features.md`, `docs/STATUS.md`,
`docs/IMPLEMENTACAO-E-PENDENCIAS.md`, `docs/MANUAL-JOGOS-XBOX-COMPANION.md` e as telas em
`src/electron-app/renderer`. Separar o que mora no **Go** (já vai junto para o Android: download,
conversão ISO→GOD, FTP, fila) do que mora no **Electron/TS** (preparo do pendrive, assistente,
atualização automática, telemetria), que **não vai**.

**2. O que funciona de fato no Android.** Compilar (`npm run build:server:android`, copiar para
`jniLibs`, `./gradlew assembleDebug`, comandos no `src/android-app/README.md`) e, com o celular do
dono conectado, instalar e exercitar cada fluxo. O celular tem uma porta só, e o OTG a ocupa: usar
a depuração por Wi-Fi (Android 11+: `adb pair` e `adb connect`) ou um hub USB-C. Se não houver
aparelho, dizer o que ficou só lido e não executado.

**3. Lista do que falta para a v1 do Companion mobile**, cada item com complexidade
(baixa/média/alta) e estimativa em **sessões de agente** mais **rodadas de teste do dono**. No
mínimo:
- o preparo do pendrive sem formatar (puxar a medição do doc irmão, não refazer);
- interface: continuar com o HTML servido pelo Go ou levar a interface React do Electron para o
  WebView? (custo de cada caminho);
- acesso a arquivos: o app hoje depende de `MANAGE_EXTERNAL_STORAGE` e caminho bruto `/storage`.
  Com APK avulso a restrição da Play Store não pesa, mas ver se esse acesso grava de fato no
  pendrive OTG nos Android 11+ testados, ou se é preciso SAF;
- nome, `applicationId`, ícone e assinatura definitivos; atualização do APK (hoje o Windows tem
  `services/autoUpdateService.ts` e `upload-r2.ps1`; o Android não tem nada);
- telemetria de erros (o Windows reporta para o `/logErr`; o Android não);
- textos para leigo e instruções de formatar no console;
- o que muda fora do repo: o guia do agente de suporte (repo `digitalstoregamesproject`,
  `fragments/instrucoes/xbox360.md`, ver o bug de origem citado no doc irmão) e o manual.

**4. Comparação final**, com números: (1) app reduzido agora e completo depois, como atualização
do mesmo APK, x (2) só o completo. Quanto tempo até o primeiro cliente sem PC conseguir preparar o
pendrive em cada caminho.

**5. Riscos que mudam a estimativa:** o espaço que o "Configurar agora" do console deixa (R1 do
doc irmão, só prova com console); o binário Go no Android (SELinux, 32 bits, aparelhos sem
arm64: o `abiFilters` só tem arm64-v8a e x86_64); o desempenho de conversão e download no celular.

Registrar premissas, símbolos abertos, comandos com os números obtidos e hipóteses descartadas
**neste doc**, nunca só no chat. Perguntar ao dono só o que mudar o número.

**Não fazer nesta etapa:** código, publicação no R2, mudança no guia do agente.

## Resultado (2026-10-11)

**Resposta curta.** O Companion mobile hoje **liga o servidor Go e mostra um assistente de
configuração, e só**. Não tem tela de catálogo, nenhuma fonte de download funciona no Android
(Minerva depende do `aria2c`, que o APK não leva; o Internet Archive exige login, que não tem
tela), o binário Go embutido está 43 commits atrás e, pelo código-fonte do Go, **não resolve DNS**
no Android. Gravar jogo no pendrive pelo caminho bruto `/storage/...` muito provavelmente não
funciona com pendrive OTG. Ou seja: o que existe é o esqueleto (serviço em primeiro plano, WebView,
o truque do `libgodsend.so` contra o SELinux) e o backend Go inteiro, que é a parte grande, mas que
ainda não foi provado rodando no celular.

Para uma **v1 = preparar o pendrive + escolher jogo + baixar + converter + gravar no pendrive**:
**~15 a 20 sessões de agente e ~7 a 9 rodadas de teste do dono, cerca de 3,5 a 5 semanas** de
calendário. Isso passa do limite de ~3 semanas do doc irmão, então **o app reduzido vale**, mas
**não como app separado**: como a primeira versão do próprio `src/android-app/`, só com o preparo
ligado, já com nome, `applicationId`, chave e atualizador definitivos. Primeiro cliente sem PC com
pendrive preparado: **~2 a 2,5 semanas** nesse caminho, contra **~3,5 a 5** esperando o completo.

**Premissas**
- Quem escreve é um agente; o dono testa num celular Android com OTG e pendrive; APK avulso;
  pacote BadAvatar no R2. Uma "sessão" é uma sessão de agente com build e teste unitário; uma
  "rodada" é o dono com o celular, 30 a 60 min.
- O dono **não tem Xbox 360** (R6 do doc irmão): o que só se prova no console (FTP pelo Wi-Fi,
  BadAvatar rodando, jogo abrindo) fica para o primeiro cliente acompanhado pelo suporte.
- **Nenhum celular conectado nesta sessão** (`adb devices` vazio). A parte 2 é só leitura.

### Parte 1 — Inventário: Companion de Windows x Companion mobile

Lado Windows: `docs/features.md` (seções), `docs/STATUS.md`, as telas em
`src/electron-app/renderer/components/` e os 150 canais IPC que o `preload.ts` expõe em
`window.godsendApi`. Lado Android: `router.go`, o HTML de `handlers.go::handleRoot` e os dois `.kt`.

**Onde mora cada coisa.** A interface React fala só com o processo principal do Electron (IPC),
nunca direto com o Go. Uma parte dos canais é repasse para rotas HTTP do Go (`browse:*`,
`content:*`, `saves:*`, `tools:ftp-*`, `tools:iso2god`, fila); outra parte é lógica em TS que não
existe no Go: preparo BadAvatar, leitura do banco do Aurora (`auroraLibraryService.ts`, 266 linhas),
capas (`coverArtService.ts`, 950), visuais do Aurora (`auroraVisualService.ts`, 842), varredura dos
jogos no pendrive (`localGameScannerService.ts`, 858), sincronia pós-FTP (`autoSyncService.ts`),
atualização (`autoUpdateService.ts`), reparo e teste de pendrive falso, ~60 canais `config:*`.

| funcionalidade (Windows) | mora em | mobile | prova |
|---|---|---|---|
| preparar pendrive BadAvatar | TS (`fixedBadAvatarPreparationService.ts`) | **não tem** | `grep -i "badavatar\|exploitProfile\|launch.ini"` em `src/server`: só comentários |
| formatar FAT32, reparar disco, teste de pendrive falso | TS (Windows) | **fora por decisão** | — |
| catálogo Xbox 360/OG/XBLA/DLC/indie (navegar e escolher) | rotas Go `/browse`, `/browse/releases`; tela React `BrowsePage.tsx` (1813) | **não tem tela** | `/browse` devolve texto `nome|nome|...` (`handlers.go::handleBrowse`, `Content-Type: text/plain`); o passo 3 do assistente só faz um link para `/browse?platform=xbox360`, que mostra esse texto cru |
| baixar do Minerva (torrent) | Go `infrastructure/torrent` + **binário `aria2c`** | **não funciona** | `torrent.go::ProbeWorkingAria2c` procura `aria2c` ao lado do binário ou no PATH; o APK não leva nenhum (`jniLibs` só tem `libgodsend.so`); `aria2c_stub.go` não instala nada fora do macOS |
| baixar do Internet Archive | Go (HTTP) + login | **não funciona sem login** | login vem de `GODSEND_IA_COOKIE` (`app/config.go:617`), preenchido pelo Electron (`config:ia-login`); o `GodsendBackendService.kt` não passa nada disso e o HTML não tem tela de login |
| ROMs retrô (EdgeEmu) | Go | **pela metade** | rota existe (`/browse?platform=rom_*`); sem tela; depende de DNS |
| conversão ISO→GOD / ISO→XEX na fila | Go `services/pipeline` | **tem no código, não provado** | roda dentro do mesmo binário; nunca executado em aparelho |
| fila, status, retomada da fila | Go `/queue`, `/status`, `queue_resume.go` | **pela metade** | o HTML só mostra o **número** de itens (`fetchQueueStatus`); sem progresso, sem remover/tentar de novo |
| enviar pelo Wi-Fi (FTP) ao console | Go `/register?mode=http`, `/ftp/*` | **pela metade** | assistente passo 2 faz `/ftp/discover`, `/ftp/ping` e `/register`; o dono não tem console para provar |
| gravar jogo no pendrive (modo local) | Go `/register?mode=local&local_root=...` | **pela metade, provavelmente quebrado em OTG** | o assistente lista `/storage/*` (`handleToolsStorageDrives`) e grava por caminho bruto; ver parte 3, item "acesso a arquivos" |
| ver/apagar jogos no pendrive (`UsbGamesPage.tsx`, 785) | TS (`localGameScannerService.ts`) | **não tem** | nenhuma rota Go equivalente; `/browse?platform=local` lista só a pasta Transfer |
| Biblioteca do Xbox (capas, ordenar, mover jogo) | TS (banco do Aurora por FTP) + Go `/ftp/move-game` | **não tem** | `LibraryPage.tsx` (2881) e os serviços Aurora são TS |
| editor de artes do Aurora | TS + Go `/rxea/*` | **não tem** (só as rotas) | — |
| DLC e Title Updates | Go `/content/*` | **só as rotas, sem tela** | `router.go` |
| saves e backup de perfil | Go `/saves/*` | **só as rotas, sem tela** | `router.go` |
| gerenciador de FTP | Go `/ftp/*` | **só as rotas, sem tela** | `router.go` |
| ISO→GOD de arquivo próprio | Go `/tools/iso2god` | **só a rota**; sem seletor de arquivo no Android | — |
| scripts do Aurora por FTP | TS (`xbox:ftp-scripts`) + Go `/ftp/upload-scripts` | **só a rota** | — |
| atualização automática | TS (`autoUpdateService.ts`, `upload-r2.ps1`) | **não tem** | nada em `src/android-app` |
| telemetria de erros | Go (`infrastructure/telemetry`) **e** TS | **o Go já reporta**, se tiver DNS | `telemetry.go`: `Project = "xbox-360-companion/<componente>"`, `Platform = runtime.GOOS/GOARCH` (sai `android/arm64`); ligado por padrão (`app/config.go:592`). O lado Kotlin e o WebView não reportam |
| logs persistentes | Go | **tem**, mas o cliente não tem como abrir nem enviar | — |
| lançador portátil, iniciar com o Windows, UAC | TS/Windows | não se aplica | — |

**Resumo do inventário.** O que vai junto de graça é o motor (download, conversão, fila, FTP, saves,
DLC) — **como rotas HTTP, sem nenhuma tela**, exceto o assistente de 3 passos. Tudo o que o cliente
vê no Windows (catálogo, fila, jogos no pendrive, biblioteca) é React + TS e não vai.

### Parte 2 — O que funciona de fato no Android

**Nada foi executado em aparelho nesta sessão** (sem celular conectado). O que a leitura permite
afirmar:

- **O binário embutido está velho.** `libgodsend.so` e a cópia em `assets/godsend-android-arm64`
  (a mesma, 15.564.428 bytes cada, 2026-08-04; o APK leva duas vezes 15 MB) são anteriores a
  **43 commits** em `src/server` (`git log --oneline --since=2026-08-04 -- src/server | wc -l` → 43;
  último em 2026-10-09). Qualquer teste em aparelho precisa recompilar antes.
- **DNS não funciona no Android com esse build** (alta confiança, não executado).
  `scripts/build-android.js` compila com `CGO_ENABLED=0`. No código do Go instalado (1.26.6),
  `net/conf.go` diz, no caso `"android"`: *"DNS requests don't work on Android, so prefer the cgo
  resolver. Issue #10714."* Sem cgo, o resolvedor Go não tem `/etc/resolv.conf` e cai em
  `defaultNS = ["127.0.0.1:53", "[::1]:53"]` (`net/dnsconfig.go`). `grep "net.Resolver|DefaultResolver|PreferGo"`
  em `src/server`: nada. Efeito: archive.org, minerva-archive.org, XboxUnity, R2 e o `/logErr` falham
  todos. O FTP para o console (IP numérico) e o servidor local escapam.
  Os certificados TLS não são problema: `crypto/x509/root_linux.go` já lê `/system/etc/security/cacerts`.
- **Minerva não baixa** (sem `aria2c`) e **IA não baixa** (sem login). Ver parte 1.
- **SELinux:** o README documenta o truque (`extractNativeLibs="true"` + executar de
  `nativeLibraryDir`), e o código segue isso. Não provado nesta sessão.
- **Emulador:** `abiFilters` declara `arm64-v8a` e `x86_64`, mas só existe
  `jniLibs/arm64-v8a`. Num emulador x86_64 o binário não existe; para testar no emulador é preciso
  compilar também `GOARCH=amd64` (barato).

O que o dono roda na primeira rodada, quando houver celular (já dentro da sessão A da parte 3):
`npm run build:server:android`, copiar para `jniLibs`, `./gradlew assembleDebug`, `adb install -r`,
abrir o app; com `adb forward tcp:8080 tcp:8080`, chamar do PC
`http://127.0.0.1:8080/browse?platform=xbox360` e `/tools/storage-drives` com o pendrive no OTG;
ler `adb logcat` e o log do Go em `GODSEND_HOME`. Esperado hoje: catálogo com erro de DNS e o
pendrive ausente ou sem escrita na lista.

### Parte 3 — O que falta para a v1

**v1 proposta** (pergunta 1 ao dono, no fim): o cliente sem PC (a) prepara o pendrive, sem formatar
no celular, (b) escolhe um jogo num catálogo, (c) o celular baixa e converte, (d) o jogo vai para o
pendrive, (e) vê e apaga os jogos que estão no pendrive. Wi-Fi/FTP continua como está (não dá para
o dono provar sem console). Biblioteca do Aurora, editor de artes, saves, DLC/TU, gerenciador de
FTP, ROMs e ISO próprio ficam para depois.

| # | item | complexidade | sessões | rodadas do dono |
|---|---|---|---|---|
| A | **base que roda**: recompilar o Go; DNS (o Kotlin lê os servidores DNS do `ConnectivityManager`/`LinkProperties` e passa por variável de ambiente; o Go monta `net.DefaultResolver` com `PreferGo` e `Dial` para eles quando `GOOS=android`); tirar a cópia duplicada de `assets/`; build `amd64` para o emulador | baixa | 0,5–1 | 1 (abre, catálogo carrega) |
| B | **fonte de download**: levar `aria2c` estático para Android como `libaria2c.so` (mesmo truque do Go) e apontar o Go para ele; alternativa: biblioteca de torrent em Go (`anacrolix/torrent`), alta, +3–4 sessões | média | 1–1,5 | 1 (baixar um jogo pequeno) |
| C | **preparo do pendrive sem formatar** — puxado do doc irmão ("Prazo refeito"), não refeito: SAF, pacote mobile gerado no PC e publicado no R2, download conferido, gravação com retomada, recibo, telas. Desconto de ~1 sessão porque esqueleto e serviço já existem aqui | média (gravação: alta) | 5–7 | 3–4 |
| D | **jogo para o pendrive**: o Go grava no armazenamento do próprio app (`getExternalFilesDir`, sem permissão); quando o item da fila termina, o Kotlin copia para o pendrive pelo **mesmo motor SAF do item C** (retomada, conferência) e apaga a cópia local; aviso de espaço no celular. Tirar o `MANAGE_EXTERNAL_STORAGE` | média–alta | 2–3 | 2 |
| E | **interface**: catálogo com busca e capas, fila com progresso/remover/tentar de novo, jogos no pendrive (listar, apagar), entrada do preparo. Caminho recomendado abaixo | média | 2–3 | 1 (junto de B/D) |
| F | **nome, `applicationId`, ícone, chave de release**; build assinado | baixa | 0,5 | — |
| G | **atualização do APK**: `latest.json` no R2 (`XBOX360Companion/android/`), checagem ao abrir, baixar o APK, abrir o instalador (`REQUEST_INSTALL_PACKAGES` + `FileProvider`); passo de publicação ao lado do `upload-r2.ps1` | média | 1 | 1 |
| H | **telemetria**: o Go já reporta (vale depois de A); falta o Kotlin (backend que morre, exceção não tratada) e o `window.onerror` do WebView, no mesmo `/logErr` com `xbox-360-companion/android-*` | baixa | 0,5 | — |
| I | **textos para leigo e instrução de formatar no console** (Configurações > Sistema > Armazenamento), "instalar apps desconhecidos", tirar o celular da otimização de bateria (o serviço morre em Xiaomi/Samsung) | média | 1 | 1 (o dono lê) |
| J | **fora do repo**: guia do agente (`digitalstoregamesproject`, `fragments/instrucoes/xbox360.md`) e o manual passam a oferecer o app; só depois do primeiro cliente provar | baixa | 0,5 | — |
| K | **prova**: teste de equivalência do pendrive no PC (já no C); teste no emulador de "baixa um jogo pequeno, converte e entrega"; um segundo celular | média | 1 | (contadas acima) |
| | **total v1** | | **~15–20** | **~7–9** |

**Calendário:** o gargalo são as rodadas do dono, não as sessões. Com uma rodada a cada 2–3 dias e
algumas rodadas juntando itens (A+B, D+E), **~3,5 a 5 semanas**.

**Interface: HTML do Go x React do Electron no WebView**
- **Continuar com HTML servido pelo Go (recomendado): 2–3 sessões.** Hoje o HTML é uma string de
  ~800 linhas dentro de `handleRoot` (`fmt.Fprintf` com `%%` escapado). Mover para arquivos estáticos
  com `go:embed` (separado, mobile-first) e fazer 4 telas que chamam rotas que já existem. `/browse`
  devolve texto com `|`, então o catálogo também precisa de um formato que traga capa/tamanho (ou o
  JS divide o texto e busca capa à parte).
- **React no WebView: 6–10 sessões.** A interface usa ~150 canais de `window.godsendApi`. Daria para
  escrever uma ponte que traduz cada canal para HTTP, mas as telas que interessam à v1 dependem de
  lógica que só existe em TS no processo principal: capas (950 linhas), varredura de jogos no
  pendrive (858), preparo, ~60 canais de configuração, além de supor Windows (letra de unidade, UAC,
  formatar). Tudo isso teria de ser portado para Go ou Kotlin antes, e as telas adaptadas para
  celular. Ganha-se a aparência igual; não se ganha prazo.

**Acesso a arquivos.** O app pede `MANAGE_EXTERNAL_STORAGE` e o Go grava em `/storage/<id>`. No
AOSP, o `StorageManagerService` só marca como visível para apps o disco público **adotável**
("Adoptable public disks are visible to apps, since they meet public API requirement of being in a
stable location"); cartão SD costuma ser adotável, **pendrive USB não**. Então, mesmo com "acesso a
todos os arquivos", o caminho bruto do pendrive OTG tende a não aparecer ou a ser só leitura, e
varia por fabricante. **Lido de memória do código do AOSP, não conferido no fonte nem em
aparelho** — a primeira rodada (A) confirma: `ls /storage` e gravar um arquivo pelo
`/tools/storage-drives`. Decisão de projeto independente do resultado: **SAF para o pendrive**, porque
o preparo (C) já exige o motor SAF e o D reaproveita; o Go grava só no armazenamento do app.

**Nome, id, assinatura.** `applicationId = "com.godsend.app"`, rótulo "GODsend-360", sem keystore de
release no repo (só o debug). Um APK avulso só se atualiza por cima com o **mesmo id e a mesma
chave**: decidir antes do primeiro APK que chega a um cliente (pergunta 2 ao dono).

### Parte 4 — Comparação

| | (1) reduzido agora, completo como atualização | (2) só o completo |
|---|---|---|
| o que é | o próprio `src/android-app/` com id, nome, chave e atualizador definitivos (F+G), só a tela do preparo (C) e os textos dele (parte de I); catálogo/jogos escondidos | A até K de uma vez |
| até o 1º cliente sem PC preparar o pendrive | **~7–9 sessões, 3–4 rodadas: ~2 a 2,5 semanas** | **~15–20 sessões, 7–9 rodadas: ~3,5 a 5 semanas** |
| até o completo | ~4 a 5,5 semanas (+~1 sessão e +1 rodada pela publicação a mais) | ~3,5 a 5 semanas |
| trabalho jogado fora | ~0: mesmo app, mesmo id, mesma chave; a atualização chega pelo G | 0 |
| risco que o (1) tira cedo | o R1 (espaço depois do "Configurar agora") começa a ser provado por clientes ~2 semanas antes | — |

**Recomendação: (1), na forma "mesmo app"**. Ele bate o limite do doc irmão (o completo passa de 3
semanas) e não cria um segundo produto. A ordem de trabalho fica: F → G → C → (publica, oferecido
"com acompanhamento", condição 2 do doc irmão) → A → B → D → E → H → I → J. Isso **substitui a base
(b) "app novo" do T0 do doc irmão**: o preparo passa a ser escrito dentro de `src/android-app/`, com
os itens do T0 (SAF, pacote mobile, gravação com retomada) iguais. O que pesava contra a base (a) no
T0 — `MANAGE_EXTERNAL_STORAGE` e binário de 15 MB — só pesava na Play Store, que está fora.

### Parte 5 — Riscos que mudam a estimativa

- **R1, espaço depois do "Configurar agora" do console.** Igual nos dois caminhos e só se prova com
  console (doc irmão). Se o console ocupar o pendrive inteiro, o app apaga a `Xbox360/` com
  confirmação (+0,5 sessão) ou o texto manda usar "Personalizar". Também vale para os jogos (D): o
  espaço livre que sobra é o que cabe de jogo.
- **DNS do Go no Android** — quase certo que quebra, e é barato (dentro de A). Se a correção por
  `net.DefaultResolver` falhar em algum aparelho, a saída é compilar com cgo pelo NDK: +1 sessão.
- **`aria2c` no Android** — o maior desconhecido técnico da v1. Precisa de um binário estático
  arm64 (o próprio `aria2c` também resolve DNS: com c-ares embutido ou bionic, conferir), executado
  do `nativeLibraryDir`. Se não houver build confiável: torrent em Go puro, +3–4 sessões.
- **SELinux / execução do binário** — o truque do `nativeLibraryDir` é o padrão conhecido e o código
  já usa; risco baixo, mas nunca provado nesta sessão. Vale para os dois binários (Go e `aria2c`).
- **32 bits.** O APK só tem `arm64-v8a`. Celular barato com Android Go ou com sistema 32 bits
  (`armeabi-v7a`) não roda o Go embutido. Compilar `GOARCH=arm GOARM=7` é barato (+0,25 sessão, mais
  um `aria2c` armv7), mas conversão em 32 bits é mais lenta e com menos memória. Sem dado de quantos
  clientes têm esse aparelho; a telemetria (H) mede depois (`Platform`).
- **Desempenho e espaço no celular** (estimativa, não medido): um jogo de disco tem ~7–8 GB; o
  download pelo Wi-Fi do celular domina (de dezenas de minutos a horas). A conversão lê e grava o
  disco inteiro (~5–15 min em flash de celular). O pipeline apaga a ISO depois de converter
  (`pipeline.go`, `os.Remove(isoPath)`), mas no pico o celular precisa de **ISO + GOD ≈ 2× o jogo
  (~15 GB livres)**, e celular cheio é comum nesse público. Mitigação no D: aviso de espaço antes de
  enfileirar. Aquecimento e o sistema matando o serviço em segundo plano (Xiaomi, Samsung) são
  instrução de texto (I) e um teste com tela apagada.
- **Sem console para o dono** — FTP pelo Wi-Fi, BadAvatar rodando e jogo abrindo só se provam com
  cliente. Não muda as sessões; muda quando dá para oferecer o app de forma ampla.

### Símbolos abertos nesta sessão (além dos já listados acima do resultado)
- `src/server/interfaces/http/router.go::NewRouter` — todas as rotas; nenhuma de BadAvatar.
- `handlers.go::handleRoot` (1242–2015) — o único HTML; assistente de 3 passos em `localStorage`.
- `handlers.go::handleBrowse` — responde `text/plain` com nomes separados por `|`.
- `infrastructure/torrent/torrent.go::ProbeWorkingAria2c`, `::Aria2cBinary`; `aria2c_stub.go` (`!darwin`, no-op).
- `infrastructure/telemetry/telemetry.go` — `Report` com `Project`/`Platform`; `main.go:36` inicializa.
- `app/config.go:592` (telemetria ligada por padrão), `:617` (`GODSEND_IA_COOKIE`).
- `scripts/build-android.js` — `GOOS=android GOARCH=arm64 CGO_ENABLED=0`, só arm64.
- `GodsendBackendService.kt` — passa só `GODSEND_HOME`, `GODSEND_PORT`, `GODSEND_TRANSFER`.
- `AndroidManifest.xml` — `MANAGE_EXTERNAL_STORAGE`, `usesCleartextTraffic`, `FOREGROUND_SERVICE_DATA_SYNC`.
- `src/electron-app/preload.ts` — `godsendApi` com ~150 canais; telas em `renderer/components/`
  (Browse 1813, Library 2881, UsbGames 785, Home 867 linhas).
- Go stdlib 1.26.6: `net/conf.go` (caso `android`), `net/dnsconfig.go::defaultNS`,
  `crypto/x509/root_linux.go` (`/system/etc/security/cacerts`).

### Hipóteses descartadas
- **"O backend Go já vai pronto para o Android, falta só o preparo."** Falso: sem DNS, sem
  `aria2c`, sem login do IA e sem telas, o motor não serve ao cliente sem os itens A, B, D e E.
- **"Levar a interface React para o WebView economiza."** Não: as telas da v1 dependem de lógica TS
  do processo principal (capas, varredura, preparo, configuração); portar essa lógica custa mais que
  4 telas novas em HTML.
- **"`MANAGE_EXTERNAL_STORAGE` resolve a gravação no pendrive."** Provavelmente não para OTG (ver
  parte 3); e o SAF já é obrigatório pelo preparo, então não se paga dois caminhos.
- **"App reduzido = app novo separado" (base b do T0).** Com o `src/android-app/` sendo o Companion
  mobile, o reduzido é a primeira versão dele; um segundo app exigiria migração do cliente.

### Perguntas ao dono (só as que mudam o número)
1. **A v1 é a proposta na parte 3** (preparo + catálogo + baixar + jogo no pendrive + ver/apagar),
   ou precisa paridade com o Windows (Biblioteca do Aurora, editor de artes, saves, DLC/TU,
   gerenciador de FTP)? A paridade soma **~10 a 13 sessões**, e quase nada dela o dono consegue
   testar sem console.
2. **Nome e `applicationId` definitivos** do Companion mobile (hoje `com.godsend.app`, "GODsend-360").
   Trava o primeiro APK que chega a um cliente.

## Frase de abertura da próxima sessão

*"Leia a seção 'Resultado (2026-10-11)' de
`docs/backlog/xbox-companion-mobile-quanto-falta_2026-10-11.md` no repo
`C:\projects\Downloader-XBOX360-XEX-HDD-Games` e, com as respostas do dono às duas perguntas do
fim, escreva a spec da primeira versão (caminho 1: preparo do pendrive dentro de `src/android-app/`,
com F e G), reaproveitando a T0 do doc irmão. Se houver celular conectado, comece pela rodada A
(DNS e caminho bruto do OTG)."*
