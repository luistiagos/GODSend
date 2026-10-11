# Backlog: quanto falta para terminar o Xbox Companion mobile (Android)

- **Estado:** investigação passada a outra sessão (não iniciada)
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

## Frase de abertura da próxima sessão

*"Leia `docs/backlog/xbox-companion-mobile-quanto-falta_2026-10-11.md` no repo
`C:\projects\Downloader-XBOX360-XEX-HDD-Games` e responda as partes 1 a 5: quanto falta para
terminar o Xbox Companion mobile (`src/android-app/`), sem formatar pendrive no aparelho (o cliente
formata no Xbox 360). Grave tudo no próprio doc."*
