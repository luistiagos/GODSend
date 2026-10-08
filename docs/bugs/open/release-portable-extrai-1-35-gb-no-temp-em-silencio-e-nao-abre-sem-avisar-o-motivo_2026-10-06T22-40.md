# Bug: o `xboxcompanion.exe` (portátil) não abre e não diz por quê: descompacta 1,35 GB no `%TEMP%` em modo silencioso, e qualquer falha nessa etapa termina sem janela, sem mensagem e sem telemetria

- **Detectado em:** 2026-10-06 22:40 (chamado #148 do painel, sessão `12210927591471@lid`, telefone `554196336064`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/package.json` (`build.portable`), `src/electron-app/scripts/build-portable.js` e do stub `node_modules/app-builder-lib/templates/nsis/portable.nsi` (+ `include/extractAppPackage.nsh`, app-builder-lib 26.8.1) + consulta à telemetria (`/admin/errors`)
- **Classe:** falha funcional / inicialização / diagnóstico
- **Severidade:** **P1 - Alto**: cliente pagante com Windows 10/11 baixou o arquivo completo e não conseguiu abrir o programa; 1 h 30 de suporte humano (22:25 → 23:53 UTC) sem diagnóstico, e pedido de reembolso ([133191]: *"Se não for dar certo quero reembolso"*)
- **Complexidade:** média: o remédio (checar espaço e avisar antes de extrair, ou trocar o portátil por outro formato) mexe no empacotamento, não na lógica do app
- **Versões:** 2.12.106 (arquivo publicado = `dist/xbox-360-companion-Portable-2.12.106-x64.exe`, 528.186.811 bytes; o cliente tem 503 MB nas Propriedades, que são os mesmos bytes em MiB, ou seja, download completo)
- **Reincidência:** segundo "nem abre" do portátil. O primeiro, [[electron-app-incompativel-windows-7-executavel-nao-abre_2026-09-23T02-45]], era Windows 7. Este é Windows 10/11, então a causa é outra.

## Sintoma, na ordem que o cliente viveu

1. Passou pelo bloqueio de download do Edge (bug irmão
   [[release-xboxcompanion-exe-sem-assinatura-barrado-no-download-pelo-smartscreen-do-edge_2026-10-06T17-49]])
   e às 22:25 UTC chegou à tela azul *"O Windows protegeu o computador"*.
2. "Mais informações" → "Executar assim mesmo": **nada aparece**.
3. "Abrir arquivo" pela lista de downloads: nada. "Executar como administrador" + "Sim" no UAC: nada.
4. O operador conferiu Propriedades (arquivo íntegro), Histórico de proteção (nenhum bloqueio no dia)
   e o Gerenciador de Tarefas (processo ausente). O Visualizador de Eventos não rendeu nada
   legível pelo WhatsApp. O atendimento parou às 23:53 UTC sem causa.

## Evidência

Horas em UTC (cliente em UTC-3).

| `Wpp_proccess` | hora | o que prova |
|---|---|---|
| 132424 | 13:32:49 | print do Windows: *"Não há espaço suficiente em Disco Local. 594 MB é necessário (...)"*, **782 MB livres de 118 GB** no disco C: |
| 133149 | 22:25:21 | tela azul do SmartScreen ("Mais informações" / "Não executar"). Essa tela e o app "Segurança do Windows" não existem no Windows 7, o que descarta o bug do Windows 7 |
| 133154/133155 | 22:27:26 | *"Fico assim"*, *"Não tá carregando nada"* |
| 133239 | 22:44:40 | *"Já abri arquivo não sai da mesma"* |
| 133267 | 22:52:16 | *"Não aconteceu nada"* (como administrador) |
| 133286 | 22:56:26 | *"Na parte do sim cliquei aí não fez mais nada"*: o UAC apareceu, logo o stub **iniciou** |
| 133289 | 22:57:39 | Propriedades: `xboxcompanion (1)`, **503 MB**, criado 19:23:33 e modificado 19:25:43 (hora local) |
| 133307 → 133308 | 23:03 | Histórico de proteção sem bloqueio no dia (leitura do operador sobre o print) |
| 133314 → 133315 | 23:10 | Gerenciador de Tarefas sem o Companion (leitura do operador) |

**Telemetria:** `GET /admin/errors` (9.492 registros, todos os status) não tem **nenhum** registro
`xbox-360-companion/*` entre 2026-10-06 19:46:50 e 2026-10-07 01:26 UTC. O último antes disso
(9484, 19:46:50) é de outra máquina: o cliente só teve o arquivo às 22:23. As tentativas dele
(22:27, 22:44, 22:52) não deixaram rastro. Isso é coerente com falha **antes** do JavaScript: os
handlers de `uncaughtException`/`unhandledRejection` ficam em `src/electron-app/app/bootstrap.ts`
e só existem depois que o Electron sobe.

## O que foi provado no código (o mecanismo, não o caso do cliente)

- `package.json` → `build.portable`: `unpackDirName: true`, **sem `splashImage`**.
- `portable.nsi`: sem `SPLASH_IMAGE`, `.onInit` faz `SetSilent silent`. Em modo silencioso o NSIS
  não mostra janela nem caixa de erro.
- A seção faz `StrCpy $INSTDIR "$TEMP\${UNPACK_DIR_NAME}"`, `RMDir /r $INSTDIR`, extrai o app
  inteiro ali e só então `ExecWait "$INSTDIR\${APP_EXECUTABLE_FILENAME}"`. Não há checagem de
  espaço livre nem de sucesso da extração antes do `ExecWait`. Se o executável não existir ou
  vier truncado, o stub termina e apaga `$INSTDIR`.
  - **Corrigido em 2026-10-07:** com `unpackDirName: true` o `UNPACK_DIR_NAME` **não** é
    definido, e a pasta é `$PLUGINSDIR\app` (`%TEMP%\ns<aleatório>.tmp\app`). Continua sendo o
    disco do `%TEMP%`; o que muda é que a pasta é nova a cada abertura. Ver a análise abaixo.
- Em `extractAppPackage.nsh::extractUsing7za`, a única caixa de erro
  (`MessageBox MB_RETRYCANCEL ... /SD IDRETRY`) tem resposta silenciosa padrão: em modo
  silencioso ninguém a vê.
- Tamanho do app descompactado: `du -sb dist/win-unpacked` = **1.352.308.407 bytes (1,35 GB)**,
  dos quais 727 MB são `resources/assets` e 232 MB o `Xbox360Companion.exe`.
- `%TEMP%` fica no disco do perfil do usuário (C:), **não** na pasta onde o `.exe` foi salvo. O
  cliente salvou em `D:\Dowload`, com espaço, mas isso não muda onde a extração acontece.

Consequência: toda abertura do portátil precisa de pelo menos 1,35 GB livres no disco do
`%TEMP%`, a cada execução, e quando falta o resultado é exatamente o relatado: UAC/SmartScreen
passam, nada abre, nenhum processo fica, nenhum erro chega à telemetria.

**Corrigido em 2026-10-07:** 1,35 GB é o tamanho do app; o que o launcher ocupa é **3.083 MB**
(medido), e não só durante a extração: fica nesse patamar enquanto o app está aberto. Ver a
análise abaixo.

## Hipóteses — nenhuma verificada na máquina do cliente

1. **Disco C: sem espaço para a extração (mais provável).** Às 13:32 UTC o C: tinha 782 MB
   livres; a extração pede 1,35 GB. Falta medir o espaço livre do C: no momento da tentativa
   (22:27 UTC) e reproduzir aqui com `%TEMP%` num volume pequeno.
   - Não medido: o pico real. Se o stub foi compilado pelo caminho `extractEmbeddedAppPackage`,
     ele grava primeiro o `.7z` em `$PLUGINSDIR`, extrai em `$PLUGINSDIR\7z-out` e copia para
     `$INSTDIR`, e o pico passa de 1,35 GB. Conferir os `!define` usados na compilação.
2. **Antivírus de terceiros apagando o `Xbox360Companion.exe` recém-extraído no `%TEMP%`.** O
   Histórico de proteção do Defender estava limpo, mas não se sabe se há outro antivírus.
3. **Windows de 32 bits.** O portátil publicado é só x64. Não conferido (Configurações → Sistema
   → Sobre).

Descartadas:
- **Download incompleto:** 503 MiB = 528.186.811 bytes, igual ao arquivo publicado.
- **Windows 7/8:** as telas mostradas são de Windows 10/11.
- **Bloqueio do Defender:** histórico sem evento no dia.
- **Segunda instância segurando o lock (`main.ts`, `requestSingleInstanceLock` → `app.quit()`):**
  não havia processo do Companion no Gerenciador de Tarefas.

## Escopo — o que NÃO é este bug

- O bloqueio no **download** pelo SmartScreen do Edge: bug irmão citado acima. O cliente só
  passou dele quando o operador ensinou a setinha ao lado de "Excluir" → "Manter mesmo assim"
  ([133120] → [133149]).
- O agente mandar baixar o `.exe` pelo celular ([132798]) e afirmar que o programa "pode demorar
  até 1 minuto" e procurar "ícone do GODsend perto do relógio" ([133158], [133184]): lado do
  agente, repositório `digitalstoregamesproject`.
- A varredura de jogos que congela a janela
  ([[electron-main-varredura-sincrona-de-jogos-instalados-congela-a-janela-e-gera-falso-timeout-de-usb_2026-10-05T17-25]]):
  lá a janela abre.

## Tarefas propostas / Próximos passos

1. **Com o cliente (destrava o chamado):** pedir print de "Este Computador" mostrando o espaço
   livre do C:. Se estiver abaixo de ~3 GB, liberar espaço (Limpeza de Disco, esvaziar a Lixeira,
   mover arquivos para o D:) e abrir de novo. Se houver espaço, perguntar por antivírus e pelo
   tipo de sistema (64 bits).
2. **Reproduzir:** rodar o portátil 2.12.106 com `TEMP`/`TMP` apontando para um volume com menos
   de 1,35 GB livres e registrar o que aparece (esperado: nada). Confirma ou derruba a hipótese 1.
3. **Correção, se confirmada:** o portátil precisa avisar. Opções a avaliar: `splashImage` (tira
   o `SetSilent` e dá sinal de vida durante a extração de 1,35 GB), checagem de espaço livre
   com `MessageBox` em pt-BR antes de extrair (script NSIS próprio), ou distribuir o instalador
   NSIS (`xbox-360-companion-Setup-*`) no link público em vez do portátil.
4. **Reduzir o peso:** 727 MB de `resources/assets` são extraídos a cada abertura. Avaliar o que
   pode ser baixado sob demanda.
5. **Telemetria:** hoje "não abriu" é invisível no painel. Só o item 3 muda isso, porque a falha
   acontece antes de existir processo do app.

---

## Análise de 2026-10-07 (gravada antes de qualquer edição de código)

Tamanhos em MB e GB como o Windows mostra (1 MB = 1.048.576 bytes). O app descompactado tem
1.352.308.407 bytes, isto é, 1.290 MB.

### O que mudou em relação ao diagnóstico acima

1. **O launcher ocupa 3.083 MB do `%TEMP%`, não 1,35 GB.** Ele grava o pacote `.7z` (503 MB),
   extrai numa pasta intermediária `7z-out` (1.290 MB) e **copia** tudo de novo para `app`
   (1.290 MB). Nada é apagado até o app fechar: os 3.083 MB ficam ocupados durante todo o uso.
2. **A extração falha em silêncio por conta própria, não só por causa do modo silencioso.** O
   plugin `Nsis7z` não devolve erro nem liga a flag de erro. Com o pacote danificado ele para no
   meio, deixa a árvore pela metade (com o `.exe` presente) e o launcher segue como se tivesse
   dado certo.
3. **Abaixo de ~1,8 GB livres o 2.12.106 não tem como abrir; entre ~1,8 e ~3,0 GB ele depende
   de um caminho de último recurso** do template (5 tentativas de cópia com 1 s de espera, depois
   apaga `7z-out` e extrai direto no destino). Às 13:32 UTC o cliente tinha 782 MB livres.
4. **A hipótese 3 (Windows de 32 bits) e o download cortado têm mensagem própria**, que aparece
   mesmo no launcher silencioso. O cliente não viu nenhuma, o que pesa contra as duas.

A hipótese 1 (disco C: sem espaço) continua **não verificada na máquina do cliente**. O que
está provado é o mecanismo, que é o que esta correção trata.

### Símbolos abertos

- `src/electron-app/package.json::build.portable`: `{ artifactName, unpackDirName: true }`. Sem
  `useZip`, sem `splashImage`.
- `node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js::buildInstaller` (26.8.1):
  - `UNPACK_DIR_NAME` só é definido quando `unpackDirName` é texto ou falso
    (`typeof unpackDirName === "string" || !unpackDirName`). Com `true` não é, e o template usa
    `$PLUGINSDIR\app`.
  - Sem `useZip`, o app vai num `.7z` (`packArch`), e o script recebe `APP_64` (caminho do
    `.7z`) e `APP_64_UNPACKED_SIZE` (KB do app descompactado).
  - O script do portátil vem sempre de `templates/nsis/portable.nsi`. As opções `script` e
    `include` só são lidas quando o alvo **não** é portable. **Não existe opção de configuração
    para trocar o script do portátil.**
- `NsisTarget.js::computeFinalScript(originalScript, isInstaller, archs)`: para portable devolve
  `scriptGenerator.build() + originalScript`. É o único ponto por onde o texto do template
  passa antes do `makensis`.
- `NsisTarget.js::executeMakensis`: roda com `cwd = templates/nsis` e manda o script por stdin
  em UTF-8 (`-INPUTCHARSET UTF8`). Os `!include "common.nsh"` resolvem a partir dali.
- `templates/nsis/portable.nsi` (sha256 `80fa75cf…7a48`): `.onInit` faz `SetSilent silent`; a
  seção extrai com `extractEmbeddedAppPackage`, chama `ExecWait` e apaga a pasta. Nenhuma
  checagem de espaço, nenhuma conferência do resultado.
- `templates/nsis/include/extractAppPackage.nsh::extractUsing7za`: `File` grava
  `$PLUGINSDIR\app-64.7z`; `Nsis7z::Extract` extrai em `$PLUGINSDIR\7z-out`; `CopyFiles /SILENT`
  copia para `$INSTDIR`. O `Pop $R0` logo depois do `Nsis7z::Extract` desempilha o `$OUTDIR`
  guardado antes, não um resultado do plugin. Em erro de cópia: 5 tentativas, caixa com
  `/SD IDRETRY` (invisível em modo silencioso), `RMDir /r 7z-out` e nova extração direta, sem
  conferir.
- `templates/nsis/common.nsh::check64BitAndSetRegView`: as caixas "Requer Windows 64 bits" e
  "Requer Windows 7 ou superior" **não** têm `/SD`.
- `src/electron-app/app/bootstrap.ts::bootstrapApp`: `checkPendingUpdateResult()` é o padrão que
  já existe para "quem rodou antes deixou um arquivo, o app reporta no boot".
- `src/electron-app/services/appDataPath.ts::getDefaultAppDataDir`: no portátil é
  `<PORTABLE_EXECUTABLE_DIR>/godsend-data`, a pasta ao lado do `.exe` baixado.
- `src/electron-app/services/autoUpdateService.ts::buildReplaceScript`: o updater espera o
  processo do launcher sair. Depende de `PORTABLE_EXECUTABLE_FILE`, não de onde o app é extraído.
- `src/electron-app/app/window.ts::createMainWindow`: a janela nasce com `show: false` e é
  mostrada em seguida (`mainWindow.show()`). Não há modo de abrir oculto.

### Medições e provas

Medidor: `measure-portable.ps1` (roda o `.exe` com `TEMP`/`TMP` numa pasta isolada, amostra o
uso de disco, lista as janelas do processo do launcher e lê o texto dos controles). Entra no
repositório nesta correção como `src/electron-app/scripts/measure-portable-launcher.ps1`.

| # | O que foi rodado | Resultado |
|---|---|---|
| 1 | Medidor sobre uma cópia de `dist\xbox-360-companion-Portable-2.12.106-x64.exe` (sha256 `7f8606f9…0d1d`, o mesmo do `dist/version.json`) | Extrai em `%TEMP%\ns<aleatório>.tmp\app\`. Pico **3.083 MB** = `7z-out` 1.290 + `app` 1.290 + `app-64.7z` 503. **Continua em 3.083 MB com o app aberto.** Janela do app aos **21,1 s**. **Nenhuma janela do launcher** nesses 21 s. Etapas: `.7z` gravado até 1,6 s, extração até 6,3 s, cópia de 6,8 s a 18,1 s. |
| 2 | Sonda NSIS (3.0.4.1, do cache do electron-builder): `SetSilent silent` e duas `MessageBox`, uma com `/SD IDOK` e outra sem | Só a caixa **sem** `/SD` aparece. `GetDiskFreeSpaceEx` + `System::Int64Op` e `SectionGetSize` devolvem os valores esperados (`sectionKB=24576` para um arquivo de 24 MB). |
| 3 | Sonda NSIS: `Nsis7z::ExtractWithDetails` sobre um `.7z` íntegro, um com 64 KB sobrescritos no meio e um cortado em 60% | Íntegro: 25.509.888 bytes extraídos. Danificado: **13.019.757 bytes, 3 arquivos, `.exe` presente, flag de erro desligada, nada na pilha, código de saída 0.** Cortado: nada extraído, também sem erro. |
| 4 | Sonda NSIS: extração nativa (`File /r`, o caminho do `useZip`) com o fluxo zlib danificado | Em modo janela: caixa do NSIS em inglês (*"Error decompressing data! Corrupted installer?"*) e depois a janela fica **presa** com o título *"Completado"* até alguém clicar. Em modo silencioso: nenhuma caixa do NSIS, `.onInstFailed` é chamado na hora, código de saída 2. |
| 5 | `.exe` do portátil cortado em 70% (download interrompido) | *"NSIS Error — Installer integrity check has failed"*, mesmo com `CRCCheck off`. O NSIS confere o tamanho do próprio arquivo ao iniciar. |
| 6 | Build experimental com `-c.portable.useZip=true` sobre a árvore da 2.12.106 | `.exe` de 540.749.893 bytes (+2,4%), build de 3 min 07 s (contra 32 s), pico 1.290 MB, janela do app aos 21,4 s. |
| 7 | Protótipo do launcher novo (extração direta, checagem de espaço, janela de progresso), compilado pelo electron-builder sobre a mesma árvore da 2.12.106 | Pico **1.793 MB** (`app` 1.290 + `app.7z` 503), **1.290 MB** com o app aberto, janela do launcher aos 0,3 s, janela do app aos **12,6 s**, 0 MB sobrando no `%TEMP%` depois de fechar. `.exe` de 528.188.899 bytes (+2 KB). |
| 8 | Mesmo protótipo com app de mentira (`cmd.exe` no lugar do `Xbox360Companion.exe`) | `xboxcompanion.exe /c exit 7` sai com código 7 (argumentos e código de saída atravessam). Com `XBOX360COMPANION_LAUNCHER_EXTRA_MB=99999999`: caixa de falta de espaço antes de qualquer gravação, código 2, linha `sem-espaco disco=C: livre_mb=… necessario_mb=…` no registro. Pacote danificado: caixa "Não foi possível preparar os arquivos", código 2, linha `extracao-incompleta extraido_kb=13008 esperado_kb=46932`. `.exe` do app inválido: caixa "o Windows não conseguiu iniciar", código 2, linha `nao-iniciou erro=216`. |

### Hipóteses e caminhos descartados

- **Windows de 32 bits (hipótese 3):** o launcher mostraria "Requer Windows 64 bits". Essa caixa
  não tem `/SD`, e a sonda 2 prova que caixa sem `/SD` aparece em modo silencioso. O cliente não
  viu caixa nenhuma. Não conferido na máquina dele.
- **Download cortado:** além dos 503 MB conferidos nas Propriedades, o NSIS teria mostrado o
  "NSIS Error" da linha 5.
- **`portable.useZip` (extração nativa do NSIS):** dá o menor pico possível (1.290 MB) com uma
  linha de configuração, mas troca o motor de extração de todo cliente, não abre mais rápido,
  alonga o build em 2 min 35 s e, em modo janela, uma falha deixa a janela presa em
  "Completado" (linha 4). Fica como opção para o item "reduzir o peso" se os 500 MB de
  diferença pesarem.
- **`portable.splashImage`:** imagem parada, sem progresso, e não resolve espaço nem falha.
- **Launcher silencioso com o plugin `Banner`:** faixa de 249×42 px que corta o texto.
- **Telemetria por HTTP direto do launcher (`INetC`):** um `.exe` sem assinatura que faz
  requisição de rede arrisca piorar a detecção por antivírus, que já é o bug irmão do
  SmartScreen. O registro fica em arquivo e o app reporta no boot seguinte.
- **`WaitForInputIdle` para saber quando esconder a janela do launcher:** retorna ~0,2 s depois
  de criar o processo, 2 s antes de a janela do app aparecer. Serve a busca pela janela.
- **Trocar o portátil pelo instalador no link público:** decisão de distribuição (mexe no
  updater, no link do R2 e no texto do agente de suporte). Fora desta correção.

Duas armadilhas de medição, para quem repetir:

- O VS Code exporta `ELECTRON_RUN_AS_NODE=1`. Lançado de um terminal dele, o
  `Xbox360Companion.exe` sobe como Node puro e sai na hora com código 0, e parece que "o
  portátil não abre". O medidor remove as variáveis `ELECTRON_*`, `VSCODE_*` e `CHROME_CRASHPAD*`.
- A primeira execução de um `.exe` recém-gerado inclui ~3 a 6 s de varredura do Defender antes
  de o processo começar. Comparar sempre a segunda execução.

### O que será feito

1. **Launcher próprio**: `src/electron-app/build/portable.nsi` (novo), derivado do template,
   com: checagem de espaço em `.onInit` (pacote + app + 100 MB) e aviso em pt-BR com o espaço
   livre, o necessário e quanto liberar; janela com barra de progresso durante a extração;
   extração direta em `app` e remoção do `.7z` em seguida; conferência do tamanho extraído e do
   `.exe`; aviso quando o Windows não consegue iniciar o app; a janela do launcher só some
   quando a do app aparece; cada falha grava uma linha em
   `<pasta do .exe>\godsend-data\launcher-failures.log`.
   - Prova: `tests/unit/portableLauncher.test.cjs` (novo) compila o launcher pelo
     `scripts/build-portable.js` com um app de mentira e roda os quatro casos da linha 8.
2. **Gancho de build**: `src/electron-app/scripts/portable-launcher-hook.js` (novo), carregado
   por `scripts/build-portable.js` com `node -r`. Troca o texto em
   `NsisTarget.computeFinalScript`, recusa o build se o template do electron-builder mudou
   (sha256) e falha se o build terminar sem ter compilado o launcher.
   - **Corrigido na implementação:** com `node -r` o build real falhou (*"Rebuilder failed with
     exit code: 1"*). O electron-builder abre um processo filho com `child_process.fork` para
     recompilar módulos nativos (`app-builder-lib/out/util/rebuild.js`), o filho herda as opções
     do node, carrega o gancho e sai pela trava "terminou sem compilar o launcher". O gancho
     virou o ponto de entrada: `build-portable.js` roda `portable-launcher-hook.js` no lugar do
     `cli.js` do electron-builder, e o gancho chama o `cli.js` depois de se instalar. O teste
     com `--prepackaged` não pega isso, porque esse caminho não recompila nada; só o build
     completo pega.
   - Prova: o mesmo teste, que só passa se o `.exe` gerado tiver o comportamento do launcher
     novo.
3. **Registro no painel**: `src/electron-app/services/portableLauncherReport.ts` (novo) lê e
   apaga o `launcher-failures.log` no boot (`bootstrap.ts`, ao lado de
   `checkPendingUpdateResult()`) e reporta em `xbox-360-companion/portable-launcher`.
   - Prova: `tests/unit/portableLauncherReport.test.cjs` (novo).
4. **Medidor** em `src/electron-app/scripts/measure-portable-launcher.ps1`, para repetir as
   linhas 1 e 7 com qualquer build.
5. **Prova de ponta a ponta com o build real da 2.12.107**: abrir o app e medir (controle
   positivo), falta de espaço com a variável de teste, e, se houver elevação, `%TEMP%` num disco
   virtual pequeno com o 2.12.106 e o 2.12.107 lado a lado (disco cheio de verdade).
6. Versão 2.12.107, `CHANGELOG.md`, `AGENTS.md`, `docs/ATUALIZACAO-AUTOMATICA.md` (aponta para o
   template antigo) e `docs/features.md`.

---

## Correção aplicada (2.12.107, 2026-10-07)

Os itens 1 a 6 acima, com a mudança registrada no item 2 (o gancho é o ponto de entrada do CLI,
não um `node -r`). Também: `docs/tutorial_usuario_leigo.md` pede 2 GB livres no C: entre os
requisitos, e o comentário de `autoUpdateService.ts::buildReplaceScript` deixou de citar
`ExecWait`.

### Provas

- **Testes automatizados:** `npm run test:safety` com 247 testes verdes, entre eles os 4 de
  `tests/unit/portableLauncher.test.cjs` e os 3 de `tests/unit/portableLauncherReport.test.cjs`.
  Com a checagem de espaço, a conferência da extração e a checagem do `CreateProcess`
  desligadas de propósito no `build/portable.nsi`, os três testes correspondentes falham e o de
  abrir o app continua passando. `go test -count=1 ./...` verde (só o banner mudou no Go).
- **Build completo:** `npm run build:server` + `npm run build:electron:win:portable` (os passos
  do `build-and-upload.ps1`), 3 min 02 s. Gerou `dist\xbox-360-companion-Portable-2.12.107-x64.exe`,
  528.191.584 bytes, sha256 `0234296cf0c600566e9cdc782c8e63d9761aa752914cd18627acbfe10995f1ee`
  (+4.773 bytes em relação à 2.12.106). A saída do build mostra
  `[portable-launcher-hook] compiling build\portable.nsi`.
- **Ponta a ponta no `.exe` gerado** (`scripts/measure-portable-launcher.ps1`, cópia do `.exe` numa
  pasta própria, `%TEMP%` isolado):

| Caso | 2.12.106 publicada | 2.12.107 |
|---|---|---|
| Abrir, disco com espaço (segunda execução do `.exe`) | nenhuma janela até o app; janela do app aos 21,1 s; pico 3.083 MB e 3.083 MB com o app aberto | janela de progresso aos 0,3 s (*"Abrindo o Xbox 360 Companion: 0% (0 / 1289 MB)"*, depois *"Iniciando o Xbox 360 Companion..."*), janela do app aos 12,2 s; pico 1.793 MB; 1.290 MB com o app aberto; 0 MB sobrando depois de fechar |
| `%TEMP%` num disco virtual de 2 GB com **782 MB livres** (o número do print do cliente) | `.7z` gravado, extração para em 277 MB com o disco zerado (1 MB livre), espera ~5 s, tenta de novo e sai com código 1. **Nenhuma janela, nenhum app.** É o sintoma do chamado. | caixa aos 0,3 s, antes de gravar qualquer byte: *"Não há espaço livre suficiente no disco X: para abrir o Xbox 360 Companion. Livre agora: 781 MB. Necessário: 1,9 GB. Libere pelo menos 1,1 GB no disco X:…"*; código 2; registro `sem-espaco disco=X: livre_mb=781 necessario_mb=1892` |
| Mesmo disco com **~1.950 MB livres** | abre aos 19,4 s pelo caminho de último recurso do template (extrai, a cópia falha por falta de espaço, espera ~5 s, apaga e extrai de novo), sem nenhuma janela antes; 1.793 MB ocupados com o app aberto | abre aos 15,4 s com a janela de progresso; mínimo de 155 MB livres no pico; 1.290 MB com o app aberto |
| Disco enche **durante** a gravação do pacote (outro processo ocupa o espaço logo depois da checagem) | — | caixa do próprio NSIS em português (*"Extrair: erro ao gravar o arquivo …\app.7z"*), a janela fica esperando um clique em Cancelar (título sem o falso "Completado"), e então o nosso aviso "Não foi possível preparar os arquivos…"; código 2; registro `pacote-nao-gravado` |
| Variável `XBOX360COMPANION_LAUNCHER_EXTRA_MB=99999999` e, em seguida, abertura normal | — | primeiro a caixa de falta de espaço e a linha no registro; na abertura seguinte o app apagou o `launcher-failures.log`, gravou `APP_LAUNCHER o portátil não abriu antes desta execução: sem-espaco (1 tentativa(s))` no log e enviou à telemetria `project=xbox-360-companion/portable-launcher`, `message=o portátil não abriu antes desta execução: sem-espaco`, com a linha completa em anexo (endpoint apontado para um receptor local pelo `config.json` do teste, para não sujar o painel) |

O disco virtual foi criado com uma elevação aprovada pelo dono, e desmontado e apagado no fim.

### O que ainda falta (fora do código)

- **Publicar a 2.12.107** (`build-and-upload.ps1`; o `.exe` acima está em `dist/`). Até lá o
  link público continua com o launcher antigo.
- **Chamado #148:** a hipótese 1 continua sem confirmação na máquina do cliente. Com a 2.12.107
  publicada, o próprio launcher diz se é falta de espaço e quanto liberar; antes disso, o
  roteiro do item 1 das tarefas propostas continua valendo, agora com o número certo: ele
  precisa de **~3 GB livres no C:** com a 2.12.106, ou ~1,9 GB com a 2.12.107.
- **Agente de suporte** (repositório `digitalstoregamesproject`, fora deste): saber que o
  portátil agora mostra uma janela de progresso e as três mensagens, e que precisa de ~1,9 GB no
  disco C: mesmo com o arquivo salvo em outro disco. A instrução atual ("pode demorar até 1
  minuto", ícone perto do relógio) não corresponde ao que o cliente vê.
- Para fechar este bug: confirmação de um cliente real com a 2.12.107, ou o primeiro
  `xbox-360-companion/portable-launcher` no painel acompanhado de abertura bem-sucedida.

## Passagem de bastão (2026-10-07)

Estado: código e docs commitados em `86dfac6` (análise em `b20d972`), só local; `main` estava 7
commits à frente do `origin` (3 deles de outra sessão, que mexe no scanner de jogos). Nada desta
correção ficou sem commit. Sandbox de teste apagada.

Próximo passo exato, em ordem, cada um depende de decisão do dono:

1. **Push:** `git push origin main` só com autorização (leva também os commits da outra sessão).
2. **Publicar a 2.12.107:** esperar a outra sessão commitar o trabalho do scanner
   (`localGameScannerService.ts` e `zzOldScannerTmp.ts` estavam sem commit) e rodar
   `build-and-upload.ps1` **sem** `-SkipBuild`. Não publicar o `.exe` que está em `dist/`: foi
   gerado às 10:33, antes dos commits `9258bfe`/`426d4ff`. Os dois commits da outra sessão entram
   na 2.12.107 sem entrada no `CHANGELOG.md` — avisar o dono ou a sessão dona.
3. **Depois de publicar:** rodar `src/electron-app/scripts/measure-portable-launcher.ps1` no
   `xboxcompanion.exe` baixado do link público (pasta própria, `-TempDir` isolado) e conferir a
   janela de progresso e o pico de ~1.793 MB. Para ver o aviso de espaço sem disco cheio:
   `-Env @{ XBOX360COMPANION_LAUNCHER_EXTRA_MB = '99999999' }`.
4. **Fora deste repositório:** atualizar o conhecimento do agente de suporte
   (`digitalstoregamesproject`) — janela de progresso, as três mensagens, ~1,9 GB livres no C:.
5. **Fechar o bug** (`git mv` para `docs/bugs/closed/`) quando um cliente real confirmar ou o
   painel mostrar `xbox-360-companion/portable-launcher` seguido de abertura.

### Andamento (2026-10-07, noite)

- **1. Push:** feito com autorização, `9b24e64..6f21c04` (10 commits, incluindo os do scanner).
- **2. Publicação:** o dono rodou `build-and-upload.ps1` com build novo (`dist/…-2.12.107.exe` de
  12:37, depois de `91d20dc`/`2d372b2`; o CHANGELOG da 2.12.107 já cobre o scanner).
  `version.json` público: 2.12.107, 528.194.658 bytes, sha256 `29d4b703…9494b5b`.
- **3. Medição do arquivo público:** o `xboxcompanion.exe?v=2.12.107` baixado tem o mesmo sha256.
  Com `-TempDir C:\t107\temp`: janela de progresso em 0,3 s, janela do app em 9,5 s, pico de
  **1.793 MB** (app 1.290 + `app.7z` 503), **1.290 MB** com o app aberto, exit 0, nada sobra no
  TEMP. Com `XBOX360COMPANION_LAUNCHER_EXTRA_MB=99999999`: aviso de espaço do disco C: em 0,3 s,
  nada gravado, exit 2.
- **Achado da medição: `%TEMP%` com caminho longo.** A primeira medição usou um TEMP com 139
  caracteres até `…\nsXXXX.tmp\app`. Ali o launcher mostrou "Não foi possível preparar os
  arquivos" duas vezes, sempre com `extracao-incompleta extraido_kb=1219445 esperado_kb=1320634`.
  O Defender não registrou nenhuma detecção. Causa: o maior caminho relativo do app tem 123
  caracteres, então com esse prefixo um arquivo de 50 MB passa de MAX_PATH e o Nsis7z o pula sem
  avisar. Com o TEMP típico de cliente (`C:\Users\<nome>\AppData\Local\Temp`, ~52 caracteres até
  `app`) nenhum arquivo passa do limite. O template da 2.12.106 extraía no mesmo lugar e falharia
  em silêncio; a 2.12.107 pelo menos avisa e registra. Só vira problema se o TEMP do cliente
  passar de ~136 caracteres. Não é regressão e não bloqueia a release. Se aparecer
  `extracao-incompleta` no painel com o TEMP longo, a correção é extrair num caminho mais curto
  ou com prefixo `\\?\`.
- Push do registro acima: `6a0616f..a1af13d`.

### Passagem de bastão — passo 4 (agente de suporte), decidido pelo dono em 2026-10-07

O dono pediu que o passo 4 seja feito **em outra sessão**. Repositório:
`C:\projects\digitalstoregamesproject`; achar lá onde mora o conhecimento do agente de suporte
sobre o Xbox 360 Companion (portátil) e acrescentar, para a 2.12.107 em diante:

- Ao abrir o `xboxcompanion.exe`, aparece logo uma janela "Xbox 360 Companion 2.12.107" com
  barra de progresso ("Abrindo o Xbox 360 Companion: x% (… / 1289 MB)" e depois "Iniciando…"),
  que some quando o app aparece (~10 s). Antes da 2.12.107 não aparecia nada nesse intervalo.
- O programa precisa de **~1,9 GB livres no disco C:** (pasta temporária do Windows) a cada
  abertura, mesmo com o `.exe` salvo em outro disco. Com o app aberto ficam ~1,3 GB ocupados;
  ao fechar, o espaço volta.
- As três mensagens do launcher (texto exato em `src/electron-app/build/portable.nsi`) e a
  orientação para cada uma:
  1. "Não há espaço livre suficiente no disco C:…" (mostra o espaço livre, o necessário e quanto
     liberar) → liberar espaço no C: (Lixeira, Limpeza de Disco) e abrir de novo.
  2. "Não foi possível preparar os arquivos…" → baixar de novo, liberar espaço, liberar o
     programa no antivírus.
  3. "Os arquivos… foram preparados, mas o Windows não conseguiu iniciar o programa" → liberar
     no antivírus; se continuar, baixar de novo.
- Cada falha grava `<pasta do .exe>\godsend-data\launcher-failures.log`, enviado ao painel na
  abertura seguinte (`xbox-360-companion/portable-launcher`). Se o cliente diz que "não abre e
  não aparece nada" na 2.12.107, já não é o caso do chamado #148: perguntar se a janela de
  progresso apareceu.

Prova de que terminou: o agente responde certo a "baixei e não abre, não aparece nada" e a
"apareceu que não há espaço no disco C:". Ao terminar, marcar o passo 4 como feito aqui.

### Passo 5 — critério para fechar (confirmado pelo dono em 2026-10-07)

Fechar (`git mv` para `docs/bugs/closed/`) só com **uma** destas provas: um cliente real
confirma que a 2.12.107 abriu (ou que o aviso o fez liberar espaço e depois abriu), ou o painel
mostra um evento `xbox-360-companion/portable-launcher` desse cliente seguido de abertura do app.
Medição local não fecha o bug.
