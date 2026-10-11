# Bug: Executável do Xbox 360 Companion falha silenciosamente e não abre no Windows 7 / 8 / 8.1 (incompatibilidade Electron 42 e Go 1.24)

- **Detectado em:** 2026-09-23 02:45 (chamado #27 do painel, sessão `55049166278770@lid`)
- **Origem:** conversa de suporte de cliente + inspeção de `src/electron-app/package.json` (`electron@42.4.1`), `src/server/go.mod` (`go 1.24.0`), `src/electron-app/scripts/build-portable.js` e `src/electron-app/build/installer.nsh`
- **Classe:** falha funcional / compatibilidade de SO / inicialização
- **Severidade:** P1 - Alto (usuários com Windows 7, 8 ou 8.1 não conseguem abrir nem utilizar o aplicativo; processo falha silenciosamente na inicialização sem aviso amigável nem bloqueio preventivo)
- **Complexidade:** média — exige verificação de versão do SO no instalador NSIS e no empacotador portátil, além de documentação clara de requisitos mínimos
- **Reincidência:** primeira vez neste repositório (problema análogo de suporte ao Windows 7 foi triado em `retrobatnew` sob [[es-nao-abre-windows7-setthreaddescription-kernel32_2026-09-22]])

## Sintoma, na ordem que o cliente viveu

1. O cliente comprou o pacote Xbox 360 e possui um console Xbox 360 com exploit BadAvatar e Aurora já instalados em HD externo.
2. Ao ser instruído a baixar o Xbox Companion para selecionar e gravar jogos, o cliente informou explicitamente que seu notebook é antigo e roda **Windows 7** ([114131]: *"Sim,mais ele é lerdo e usa o Windows 7"*).
3. O agente de atendimento instruiu o cliente a baixar o executável padrão distribuído pelo serviço (`https://versions.digitalstoregames.com/xboxcompanion.exe`, que é a build portátil `xbox-360-companion-Portable-*-x64.exe`), sugerindo que o sistema poderia rodar normalmente, apenas mais lento.
4. O cliente baixou o arquivo e tentou executá-lo no Windows 7. O executável sequer abriu janela ou processo visível ([114319]: *"Não deu certo no meu Windows"*, [114321]: *"nem abre o xboxcompanion"*).
5. O suporte não possuía diagnóstico imediato, pois o aplicativo não emite mensagem explicativa de incompatibilidade de sistema operacional ao usuário.

## Evidência

Trecho da conversa no WhatsApp (sessão `55049166278770@lid`, chamado #27):

- **[114131] 2026-09-19T16:57:53 (customer):**
  > *"Sim,mais ele é lerdo e usa o Windows 7"*
- **[114135] 2026-09-19T16:58:10 (XBOX360_AGENT):**
  > *"Entendo! O aplicativo que prepara o pendrive foi feito para Windows, e o ideal é usar uma versão mais recente, como Windows 10 ou 11. No Windows 7, pode ser que não rode direito ou fique muito lento por causa da idade do sistema. Mas dá pra tentar: baixa o aplicativo por este link e tenta instalar normalmente. Se abrir sem erro, seguimos por ele; se travar, me avise que aí eu te oriento outro caminho. https://versions.digitalstoregames.com/xboxcompanion.exe"*
- **[114158] 2026-09-19T17:03:03 (customer):**
  > *"Então me passa o link do Xbox conpanion para o Windows 7 blz"*
- **[114159] 2026-09-19T17:03:17 (XBOX360_AGENT):**
  > *"Claro, o link para baixar o Xbox Companion é este: https://versions.digitalstoregames.com/xboxcompanion.exe"*
- **[114278] 2026-09-19T18:51:38 (XBOX360_AGENT):**
  > Passo a passo detalhado para baixar e clicar duas vezes no `xboxcompanion.exe`.
- **[114319] 2026-09-19T19:35:31 (customer):**
  > *"Não deu certo no meu Windows"*
- **[114321] 2026-09-19T19:37:24 (customer):**
  > *"nem abre o xboxcompanion"*

## Causa raiz

A causa raiz foi provada por inspeção direta das dependências de runtime e do empacotamento:

1. **Electron 42.4.1 (`src/electron-app/package.json:68`):**
   - O projeto utiliza `"electron": "42.4.1"`.
   - O ecossistema Electron e Chromium encerrou oficialmente o suporte ao Windows 7, Windows 8 e Windows 8.1 no Electron 23 (Chromium 109 foi a última versão compatível; Chromium 110+ requer estritamente Windows 10 build 1809 ou superior).
   - Binários do Electron 42 dependem de símbolos de API do Windows 10 (ex.: APIs em `api-ms-win-core-*`, funções avançadas de thread e IO na `KERNEL32.dll` / `ntdll.dll`).
   - No Windows 7, o PE loader do Windows aborta o carregamento de `Xbox360Companion.exe` com erro de ponto de entrada (`STATUS_ENTRYPOINT_NOT_FOUND` / `0xC0000139`) ou falta de DLL, abortando o processo antes que qualquer linha de JavaScript seja interpretada.

2. **Go 1.24.0 (`src/server/go.mod:3`):**
   - O backend nativo utiliza `go 1.24.0`.
   - O Go descontinuou o suporte ao Windows 7 e Windows 8 a partir do Go 1.21. O runtime do Go 1.24 aborta a inicialização em sistemas operacionais legados da Microsoft.

3. **Ausência de verificação preventiva de OS no empacotador e instalador:**
   - Em `src/electron-app/build/installer.nsh`, o script NSIS faz apenas checagem de arquitetura (`${RunningX64}`), mas não valida a versão mínima do Windows (`${IsWin10}` ou `${AtLeastWin10}`).
   - O executável portátil gerado por `src/electron-app/scripts/build-portable.js` através do `electron-builder --win portable` extrai os binários no `%TEMP%` e tenta executar o binário do Electron diretamente, falhando de forma completamente silenciosa ou opaca para o usuário final.
   - O `README.md` do repositório lista apenas "Windows (x64)" sem especificar que o Windows 10 (64-bit) versão 1809+ é um requisito obrigatório.

## Escopo — o que NÃO é este bug

- **Não é falha de download corrompido de `xboxcompanion.exe`:** o arquivo baixou normalmente; a falha ocorre na execução do executável no Windows 7.
- **Não é bloqueio de SmartScreen ou antivírus:** o sintoma do SmartScreen é tela azul de proteção com botão "Mais informações". No Windows 7, o executável nem sequer instancia processo com janela gráfica devido à rejeição do loader.
- **Não é defeito no exploit BadAvatar ou nos scripts Aurora:** o cliente sequer chegou a conectar a mídia no PC para gravação.

## Tarefas propostas / Próximos passos

1. **Validação no instalador NSIS (`src/electron-app/build/installer.nsh`):**
   - Incluir verificação no `preInit` com `${If} ${IsWin10}` / `${AtLeastWin10}`. Se a versão for inferior ao Windows 10, exibir `MessageBox MB_ICONSTOP "O Xbox 360 Companion requer o Windows 10 (64 bits) ou Windows 11. O Windows 7 e 8 não são suportados."` e chamar `Abort`.
2. **Atualização da documentação (`README.md` e `docs/`):**
   - Atualizar a tabela de plataformas e a seção de Requisitos para explicitar: `Windows 10 (64-bit, versão 1809+) ou Windows 11`.
3. **Cruzamento com o agente de suporte:**
   - Registrar no repositório `digitalstoregamesproject` o bug de prompt/guia que instrui erroneamente o cliente a testar o aplicativo no Windows 7 em vez de apresentar imediatamente os requisitos reais (ver doc cruzado em `digitalstoregamesproject`).

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** corrigir — o app não tem como rodar no Windows 7/8/8.1 (Electron 42 e Go 1.24 exigem Windows 10), mas o launcher do portátil (`build/portable.nsi`) deixa passar esses Windows, extrai 1,3 GB e inicia um app que morre no loader sem nenhum aviso; a correção é recusar antes de extrair, com uma caixa que diz o motivo e uma linha no `launcher-failures.log`.
**Complexidade:** alta — critério do `docs/bugs/open/README.md`: "launcher do portátil (`build/portable.nsi`)". A mudança em si é pequena (uma checagem em `.onInit` + um teste), mas o arquivo é o da regra.
**Severidade:** medio — atinge só o subconjunto com Windows 7/8/8.1; para eles não há contorno no app (só outro PC) e a correção não faz o app abrir: ela troca o "nem abre" mudo por um aviso que o cliente e o suporte entendem.
**Arquivos a alterar (reserva da onda):**
- `src/electron-app/build/portable.nsi` — checagem da versão do Windows em `.onInit`, antes de `checkFreeSpace`; motivo novo no log via `launcherFailed`.
- `src/electron-app/tests/unit/portableLauncher.test.cjs` — teste novo do caminho "Windows antigo" (com a variável de ambiente que eleva o mínimo).
- `src/electron-app/services/portableLauncherReport.ts` — só o comentário de `launcherFailureReason` que lista os motivos (sem mudança de código).
- `AGENTS.md` — parágrafo do `build/portable.nsi` (lista de pontos não óbvios) e do `portableLauncherReport.ts` (lista de motivos).
- `docs/features.md` — seção "Portable launcher (Windows)": a checagem nova e a variável de ambiente (doc-sync).

### Causa raiz (símbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `src/electron-app/package.json` — `"electron": "42.4.1"` (linha 68); `src/server/go.mod` — `go 1.24.0`. Electron ≥ 23 e Go ≥ 1.21 exigem Windows 10; não há como "fazer rodar" no Windows 7/8/8.1 neste repo. O que é corrigível é o launcher não avisar.
- `src/electron-app/build/portable.nsi::.onInit` — chama `check64BitAndSetRegView`, escolhe o pacote (`$packageArch`) e chama `checkFreeSpace`. **Nenhuma checagem de versão do Windows.**
- `app-builder-lib/templates/nsis/common.nsh::check64BitAndSetRegView` (a cópia em `src/electron-app/node_modules`, que o `portable.nsi` inclui por `!include "common.nsh"`) — recusa só `IsWin2000`/`IsWinME`/`IsWinXP`/`IsWinVista` com `$(win7Required)` ("Requer Windows 7 ou superior"). Ou seja: o launcher afirma que Windows 7 serve. Windows 7/8/8.1 passam. `common.nsh` já faz `!include WinVer.nsh` (linha 2), então `${WinVerGetMajor}`/`${WinVerGetMinor}`/`${WinVerGetBuild}`/`${AtLeastBuild}` estão disponíveis no `portable.nsi` sem include novo.
- `src/electron-app/build/portable.nsi::Section "-launch"` — extrai o `.7z` (1,3 GB) em `%TEMP%`, confere o tamanho e chama `kernel32::CreateProcess`. No Windows 7 o `CreateProcess` do `Xbox360Companion.exe` **retorna sucesso** (a falha de import acontece depois, no loader do processo novo, `STATUS_ENTRYPOINT_NOT_FOUND`/`STATUS_DLL_NOT_FOUND`), então o ramo `nao-iniciou` não dispara. O laço de espera sai porque `WaitForSingleObject` != 258 (processo já morreu), `HideWindow`, repassa o exit code, `RMDir /r`. **Em erro: nada é mostrado nem registrado** — é o "nem abre o xboxcompanion" do cliente (depois de minutos de "Abrindo o Xbox 360 Companion..." num notebook lento).
- `src/electron-app/build/portable.nsi::launcherFailed` — grava `<data hora>\t<versão>\t<motivo> <detalhes>` em `$EXEDIR\godsend-data\launcher-failures.log`, mostra `MessageBox ... /SD IDOK`, `SetErrorLevel 2`, `Quit`. É o caminho de saída que a checagem nova deve reusar (mesmo contrato dos motivos `sem-espaco`, `extracao-incompleta`, `nao-iniciou`, `pacote-nao-gravado`).
- `src/electron-app/build/portable.nsi::checkFreeSpace` — precedente do gancho de teste: `XBOX360COMPANION_LAUNCHER_EXTRA_MB` (lida com `ReadEnvStr`) força o aviso numa máquina que tem espaço. A checagem nova segue o mesmo padrão para ser testável num Windows 11.
- `src/electron-app/services/portableLauncherReport.ts::launcherFailureReason` / `reportLauncherFailures` — genéricos: pegam a primeira palavra do 3º campo; motivo novo não exige código. (No Windows 7 o app nunca sobe para reportar; o log fica para o suporte ler na pasta `godsend-data`.)
- `src/electron-app/tests/unit/portableLauncher.test.cjs` — compila o `portable.nsi` de verdade (`scripts/build-portable.js --x64 -- --prepackaged <app de mentira>`), roda com `/S` num `%TEMP%` isolado e confere `status`, `launcher-failures.log` e `leftInTemp`. O teste novo entra aqui com `runLauncher(workingLauncher(), [...], { <env> })`.
- `src/electron-app/scripts/portable-launcher-hook.js` — troca o template pelo `portable.nsi` em `NsisTarget.computeFinalScript`; não muda.
- `build-and-upload.ps1` — publica **só o portátil** (`build:electron:win:portable:x64` e `:ia32`, `xboxcompanion.exe` e `xboxcompanion32.exe`). O instalador NSIS (`build/installer.nsh`) não é distribuído.

### Provas (comando literal -> resultado)

- `grep -n "electron\"" src/electron-app/package.json` -> `68:    "electron": "42.4.1",`; `sed -n '1,4p' src/server/go.mod` -> `go 1.24.0`.
- `grep -n -B2 -A25 "macro check64BitAndSetRegView" src/electron-app/node_modules/app-builder-lib/templates/nsis/common.nsh` -> só `IsWin2000`/`IsWinME`/`IsWinXP`/`IsWinVista` recusam (`$(win7Required)`); `grep -n include common.nsh` -> `2:!include WinVer.nsh`.
- `grep -n "define WinVerGet" %LOCALAPPDATA%/electron-builder/Cache/nsis/nsis-3.0.4.1-nsis-3.0.4.1/Include/WinVer.nsh` -> `WinVerGetMajor` (509), `WinVerGetMinor` (510), `WinVerGetBuild` (511); `AtLeastBuild`/`AtMostBuild` (518-519). O `WinVer.nsh` usa `kernel32::GetVersionEx`, que só diz a verdade no Windows 10+ se o manifesto declarar o GUID do Windows 10.
- `head -c 2000000 dist/xbox-360-companion-Portable-2.12.109-ia32.exe | grep -a -o 'supportedOS Id="{[^"]*}"' | sort -u` (árvore principal; launcher próprio desde a 2.12.107) -> 4 GUIDs, incluindo `{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}` (Windows 10). Logo `GetVersionEx` devolve 10.0.<build real> no Windows 10/11 e a checagem não bloqueia quem tem Windows 10. O teste novo confirma isso na máquina (ver Tarefas).
- `grep -n -i "setup\|portable\|nsis" build-and-upload.ps1` -> só `build:electron:win:portable:x64`/`:ia32`; nenhum `build:win`/`nsis`.
- `grep -n "Windows 10/11" README.md` -> linha 255 já diz "64‑bit **Windows 10/11**" (o item 2 das tarefas propostas originais já está feito).

### Hipóteses descartadas (e por quê)

- **"Fazer o app rodar no Windows 7" (downgrade do Electron para ≤ 22 e do Go para ≤ 1.20):** inviável e fora de escopo — perderia anos de correções de segurança e APIs usadas pelo app; não é correção de bug.
- **Checagem no instalador (`build/installer.nsh::preInit`), item 1 das tarefas propostas:** descartada por YAGNI — o instalador não é publicado (`build-and-upload.ps1` só gera o portátil) e o cliente usou o portátil. Se o instalador voltar a ser distribuído, a mesma checagem entra lá.
- **README:** já diz Windows 10/11 (linha 255). Nada a mudar.
- **Checagem no app Electron ou no backend Go:** inútil — no Windows 7 nenhum dos dois chega a executar uma linha (falha no loader do PE). Só o launcher NSIS (32 bits, roda no Windows 7) pode avisar.
- **Detectar a morte do app antes da janela (exit code `0xC0000139`) e avisar depois:** pior experiência (1,3 GB extraídos e minutos de espera antes do aviso) e mensagem menos precisa; a checagem de versão antes de extrair resolve o caso conhecido. Não incluída.
- **Exigir Windows 10 1809 (build 17763):** não há prova de que o Electron 42 exija mais que Windows 10; mínimo fica em 10240 (Windows 10 RTM), o mesmo que o `${AtLeastWin10}` do `WinVer.nsh`.
- **`RtlGetVersion` em vez de `WinVerGet*`:** desnecessário — o manifesto do launcher declara o Windows 10 (prova acima), então `GetVersionEx` não mente. Só vira plano B se o teste do Windows 11 ler build < 10240.

### Tarefas

- [ ] `src/electron-app/build/portable.nsi::.onInit` — logo depois de `!insertmacro check64BitAndSetRegView` e antes de escolher o pacote/`checkFreeSpace` (nada pode ser gravado antes): ler `${WinVerGetMajor}`, `${WinVerGetMinor}`, `${WinVerGetBuild}`; mínimo `!define LAUNCHER_MIN_WINDOWS_BUILD 10240`, que `ReadEnvStr` de `XBOX360COMPANION_LAUNCHER_MIN_WINDOWS_BUILD` pode **elevar** (só se > 0, como o `EXTRA_MB`); se build < mínimo: `StrCpy $R1 "windows-antigo versao=<maj>.<min> build=<bld> minimo=<min>"`, `StrCpy $R2` com a mensagem pt-BR (ex.: "O ${PRODUCT_NAME} precisa do Windows 10 ou do Windows 11.$\r$\n$\r$\nEste computador está com uma versão mais antiga do Windows (versão <maj>.<min>, build <bld>), na qual o programa não funciona.$\r$\n$\r$\nUse um computador com Windows 10 ou 11.") e `Call launcherFailed`. Comentário cita `[[electron-app-incompativel-windows-7-executavel-nao-abre_2026-09-23T02-45]]`. — teste abaixo.
- [ ] `src/electron-app/tests/unit/portableLauncher.test.cjs` — teste novo "launcher: Windows anterior ao 10 recusa antes de extrair e registra a versão": `runLauncher(workingLauncher(), ["/c","exit","7"], { XBOX360COMPANION_LAUNCHER_MIN_WINDOWS_BUILD: "99999" })` -> `status === 2`, log casa `/\twindows-antigo versao=(\d+)\.(\d+) build=(\d+) minimo=99999\r\n$/`, **`Number(build) >= 10240` e `major >= 10`** (prova que o launcher lê a versão real nesta máquina, isto é, não bloquearia Windows 10/11), `leftInTemp` vazio. O teste existente "abre o app, repassa argumentos..." continua passando sem a variável (prova do caminho normal). Estragar de propósito: remover a checagem -> o teste novo falha com `status 7`.
- [ ] `src/electron-app/services/portableLauncherReport.ts::launcherFailureReason` — acrescentar `windows-antigo` na lista do comentário. Sem mudança de código.
- [ ] `AGENTS.md` (parágrafo `build/portable.nsi`, linha ~108, e `portableLauncherReport.ts`, linha ~82) e `docs/features.md` ("Portable launcher (Windows)") — a checagem de versão em `.onInit` (antes da de espaço), o motivo `windows-antigo` e a variável `XBOX360COMPANION_LAUNCHER_MIN_WINDOWS_BUILD`. Dizer por que o template não basta (`check64BitAndSetRegView` só recusa até o Vista).
- [ ] `CHANGELOG.md` `## [Unreleased]` `### Fixed` — entrada com o porquê, `build/portable.nsi::.onInit` e o link deste doc (sem subir versão).

### Plano de teste

- **Offline (sem slot):** `node --test src/electron-app/tests/unit/portableLauncher.test.cjs` na lane (compila o launcher de verdade sobre o app de mentira e roda com `/S`; não abre o Electron nem usa a porta do backend) — 5 testes `pass`, o novo incluído, com o build lido >= 10240. Mais o build do helper (compile-check).
- **T2 reprodução como o usuário (E2E, no slot):** o caminho do cliente é dar dois cliques no `xboxcompanion.exe` num Windows 7/8.1. Não há máquina com Windows 7 (manual, Planning) e o caminho não passa pela UI do app (o launcher falha antes do Electron existir), então a T2 é o launcher em **modo janela** (sem `/S`), como o cliente o vê: (1) gerar o launcher sobre o app de mentira como o teste faz (`node scripts/build-portable.js --x64 -- --prepackaged <pasta com Xbox360Companion.exe = cópia do cmd.exe e resources\app.asar> -c.directories.output=<saída>`), copiar para uma pasta de evidência como `xboxcompanion.exe`; (2) rodar com `XBOX360COMPANION_LAUNCHER_MIN_WINDOWS_BUILD=99999` no ambiente, simulando um Windows abaixo do mínimo; **sinal:** aparece a caixa com "precisa do Windows 10 ou do Windows 11 ... versão 10.0, build <n>" ANTES de qualquer "Abrindo o Xbox 360 Companion..." (print da caixa por PrintWindow do hwnd), exit code 2, `godsend-data\launcher-failures.log` com `windows-antigo ... minimo=99999`, `%TEMP%` sem `ns*.tmp` deixado; (3) rodar de novo SEM a variável: o app de mentira é iniciado normalmente (exit code repassado), sem caixa e sem linha nova no log.
- **Controle positivo:** o mesmo passo (2) com o launcher compilado do `portable.nsi` da base (`git show <base>:src/electron-app/build/portable.nsi`, ou o teste novo rodado contra a base): a variável é ignorada, o launcher extrai e inicia o app de mentira (exit 7), nenhuma caixa, log vazio — é o "nem abre" sem aviso do cliente. O sintoma real (Windows 7 + Electron 42 morrendo no loader) não é reproduzível aqui: vai para "falta para close".
- **T3 regressão direcionada:** os 4 testes existentes de `portableLauncher.test.cjs` (abre o app, sem espaço, pacote danificado, `nao-iniciou`) — a checagem vem antes de `checkFreeSpace` e não pode mudar nenhum deles; `portableLauncherReport.test.cjs` (motivo extraído); e a bateria do manual (`go test -count=1 ./...` em `src/server`, `npm --prefix src/electron-app run test:safety`) sem `fail` novo.
- **Falta para close:** abrir o `xboxcompanion.exe` publicado (e o `xboxcompanion32.exe`) num Windows 7 ou 8.1 e ver a caixa; versão publicada pelo dono.

### Sessões seguintes

- dev: effort high, ultrathink não — o manual pede `high` para o launcher do portátil (falha nele = cliente sem app); a mudança é localizada e o desenho já está fechado aqui, é mais execução cuidadosa de NSIS do que raciocínio novo.
- teste: effort medium, ultrathink não — o teste unitário compila e roda o launcher sozinho; a T2 é o launcher em modo janela com a variável de ambiente, sem disco nem console.

### Achado cruzado (outro projeto)

- Agente de suporte: `C:\projects\digitalstoregamesproject\docs\modules\chatbot-whatsapp\areas\prompt-kb\bugs\2026-10-10-agente-xbox-manda-cliente-com-windows-7-tentar-o-companion-que-so-roda-no-windows-10.md` (o agente disse "dá pra tentar" no Windows 7; a KB hoje diz "Windows 10/11" mas não diz o que fazer com Windows 7/8). Cada lado sobrevive sozinho.
