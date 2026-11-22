# Bug: jogos gravados em `\games` após o primeiro boot não aparecem na Aurora (`AutoScan` desmarcado), fila trava em varredura ocupada e jogos novos reiniciam a Aurora

## Status

- **Status:** Em reteste (movido de `open/` para `retest/` em 2026-11-20).
- **Corrigido em:** `[Unreleased]` (hook `ready-to-play-v7` em `src/electron-app/infrastructure/readyToPlayConfiguration.ts`).
- **Falta para `closed/`:** validação em console real (e coleta de `debug.log`/`crashlog.txt` caso o sintoma de reinício ao abrir jogos novos volte a ocorrer em versão `>= v2.12.130`).

---

- **Detectado em:** 2026-11-20 02:25 (triagem do chamado `#398` do painel, sessão `103724131332152@lid`, telefone `5524992112789`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/infrastructure/readyToPlayConfiguration.ts::generateAuroraReadyToPlayFilterLua` + desmontagem de `src/electron-app/assets/badavatar-1.3/Aurora/default.xex` (0.7b Rev1655)
- **Errors (serviço):** N/A — não há telemetria de `errors` vinculada nos autos da conversa (`debug.log` da Aurora / `content.db` / `settings.db` não coletados)
- **Classe:** fail / ux
- **Severidade:** **P1 — Alto** (matriz de `docs/agents/skills/bug-triage.md`: bloqueia a listagem e execução dos jogos baixados pelo Companion após o primeiro boot, levando a loop de configuração manual em `Manage Paths` e frustração severa do cliente)
- **Complexidade:** **média** (envolve comportamento do `XboxCompanionReady.lua` / banco padrão da Aurora `settings.db` / `content.db` e scanner recursivo da Aurora)
- **Versões:** cliente baixou `https://versions.digitalstoregames.com/xboxcompanion.exe` em `2026-11-17T12:33:26Z` (`09:33` BRT — anterior ao commit `4444a1c` de `2026-11-17 21:35 -0300`, `v2.12.130`; versão exata `vX.Y.Z` não visível nos prints)
- **Reincidência:** primeira vez registrado para esta combinação de sintomas pós-preparo (`XboxCompanionReady.lua` já gravou os caminhos no 1º boot)

## Sintoma, na ordem que o cliente viveu

Horários em UTC (`Wpp_proccess`, sessão `103724131332152@lid`). Console: **Xbox 360 Slim** bloqueado/LT com HD externo `Innostor Ext. HD` (465,8 GB, FAT32, `BADAVATAR (D:)`).

1. **2026-11-17 12:33–13:19 (preparo e 1º boot funcionaram):** cliente baixou o Xbox Companion (`[186088]`), preparou o HD externo marcando *Formatar antes* (`[186165]`–`[186184]`), ativou o BadAvatar e a Aurora abriu listando `Street Fighter II' HF` (`[186204]`).
2. **17/11 18:08–18:30 (jogos comuns funcionaram sem `Manage Paths`):** gravou 4 jogos; `Need For Speed Carbon` e `Red Dead Redemption` **apareceram automaticamente na Aurora** (`[186631]`–`[186636]`) sem mexer em caminhos. (Os dois jogos que falharam nessa leva — `FIFA 19` e `PES 2026` — eram entradas de catálogo já bloqueadas depois em `4444a1c`; ver "Escopo".)
3. **18/11 11:03–11:18 (9 jogos novos não aparecem apesar de os caminhos já existirem):** cliente baixou 9 jogos no Companion; todos estavam como `Pronto` e visíveis em `Jogos Instalados` (`[187562]`–`[187570]`), e a Aurora abriu (`[187574]`), mas **só mostrava os jogos antigos** (`[187578]`).
   - Print `[187586]` (11:10): `Manage Paths` já exibia `\Xbox360\System\Usb0\games` e `\Xbox360\System\Usb0\Content\0000000000000000`, com a caixa **`AutoScan` desmarcada**.
   - Print `[187590]` (11:12): dentro de `\Xbox360\System\Usb0\games`, os jogos estavam gravados (`COD - Black Ops III - 4156091D`, `Crash Mind over Mutant`, `Fast.&.Furious.Showdown`, `Fifa 19`, `FIFA 2022`, `Forza Motorsport 3`).
4. **18/11 11:18–11:39 (fila travada + jogos novos reiniciam a Aurora):** ao tentar varrer manualmente (`Scan Now`), a Aurora exibiu *"Manual Scan — The scanning queue is currently busy. Please try again after scanning has completed."* (`[187604]`, `[187610]`). Quando parte dos jogos apareceu sem capa (`[187622]`), **ao clicar para abrir a Aurora reiniciava** (`[187624]`: *"quando eu clico para entrar Aurora reinicia"*), enquanto os antigos abriam normalmente (`[187632]`).
5. **19/11 21:38 → 20/11 02:10 (novo lote não aparece e varredura trava de novo):** cliente gravou novos jogos pelo Companion (`[189983]`–`[189995]`, esperou todos concluírem). No Xbox, os jogos estavam em `\Xbox360\System\Usb0\games` (`[190358]`: `Amazing.Spider.Man.2`, `Call.of.Duty.Black.Ops.3`, `Far Cry 4 PT BR`, `FIFA 2022`, `Grand.Theft.Auto.5`, `Need.For.Speed.Carbon`; e `[190398]` mostrando `default.xex` dentro de `Far Cry 4 PT BR`), mas **não apareceram no carrossel** (`[190356]`).
   - Prints `[190360]` (01:19), `[190413]` (01:50) e `[190416]` (01:52): `Análise automática` (`AutoScan`) continuava **desmarcada** e o canto superior direito mostrava **`Procurando conteúdo`** preso; tentar `Procurar agora` dava *"A fila do escaneamento está atualmente ocupada"* (`[190375]`, `[190388]`), e tentar excluir o caminho `\Xbox360\System\Usb0\` adicionado durante as tentativas dava *"Varredura de conteúdo em andamento. Por favor, tente novamente mais tarde."* (`[190452]`).

## Evidência

- **Conversa (`Wpp_proccess`, chamado `#398`, `103724131332152@lid`):** `[186711]`, `[187562]`–`[187578]`, `[187586]`, `[187590]`, `[187597]`, `[187604]`, `[187610]`, `[187614]`, `[187622]`–`[187632]`, `[189981]`–`[189995]`, `[190356]`–`[190398]`, `[190413]`–`[190452]`.
- **Binário da Aurora (`src/electron-app/assets/badavatar-1.3/Aurora/default.xex`, 0.7b Rev1655; VAs em `0x82000000`) e `PT-BR.xzp` / `Default.xzp`:** ver seção "Causa raiz verificada no binário".
- **Lado do agente ligado ao mesmo episódio:** `C:\projects\digitalstoregamesproject\docs\modules\chatbot-whatsapp\areas\prompt-kb\bugs\2026-11-20-agente-xbox360-nao-reconhece-caminhos-aurora-e-alucina-ligar-sem-hd.md` (sobrevive de forma independente).

## Causa raiz verificada no binário (2026-11-20)

Análise direta do `Aurora/default.xex` decifrado (0.7b Rev1655) e das skins/locales empacotadas (`Default.xzp`, `PT-BR.xzp`):

1. **Verificação de H1 — `ScanAutoStart` nasce `"1"` no binário (não `"0"`), mas quando vai para `"0"` a Aurora para de varrer no boot e o hook nunca o recupera:**
   - Registro em `SystemSettings` (`0x823b7b00`–`0x823b8100`): `ScanAutoStart` (`0x82130628`) é registrado em `0x823b7df8` com padrão **`"1"`** (`r25 = 0x8213e1e4 = "1"`, regex `"^[01]$"`), o que explica por que `Need For Speed Carbon` e `Red Dead Redemption` apareceram automaticamente no passo 2 (`[186631]`–`[186636]`).
   - Na mesma aba `Settings > Content` (`Tab3`), existem **dois** checkboxes com o mesmo texto `"AutoScan"` / `"Análise automática"` (`PT-BR.xzp`):
     - `ManagePathGroup\AutoscanEnabledCheck` (`56(r27)` em `ScnOptionsContentSettings`, `0x822bd96c`) → vinculado a **`ScanAutoStart`** (padrão `"1"`).
     - `TUAutoScanCheck` (`52(r27)`, `0x822bd954`) → vinculado a **`TUScanAutoStart`** (padrão `"0"` em `0x823b8088`, `r24 = 0x82126338 = "0"`).
   - Em `LoadingEngine` (`0x8237fc80`–`0x8237fcbc`), 3 s após `LOADCOMPLETE`, a Aurora lê `ContentManager::GetScanSettings()->ScanAutoStart` (`1068(ContentManager)`, carregado em `0x8230b804` depois da carga de `ContentScripts` em `0x8230a2fc`) e só chama `ContentManager::StartScan()` (`0x82316f30`) se `ScanAutoStart == 1` (também checado ao adicionar/editar caminhos em `0x8230fb78` e `0x8230fd34`).
   - Se `ScanAutoStart` for desmarcado (`"0"`) no `settings.db`, a Aurora nunca mais varre no boot, e `XboxCompanionReady.lua` jamais conferia nem restaurava `ScanAutoStart`.

2. **Verificação de H2 — Profundidades excessivas (`\games = 6`, `\Content\0000000000000000 = 5`) fazem `ContentScanner` (`0x82321820`) travar a fila de varredura (`904(ContentManager) == 1`):**
   - `ContentWorkerThread` (`0x82322880`, caso 5 `0x82321660`) executa `Starting ScanPath` (`0x82315b48`, ligando `904(ContentManager) = 1` → banner *"Procurando conteúdo"* e bloqueios *"A fila do escaneamento está atualmente ocupada"* / *"Varredura de conteúdo em andamento"*), percorre recursivamente `0x82321820` e só desliga `904(ContentManager) = 0` em `Finished ScanPath` (`0x82315cf0`).
   - Em `0x82321820`, a coluna `Depth` do `ScanPaths` (`0x823e3248` → `0x823c0014` → `0x823191f8` → `0x823217cc`, sem ajuste ±1) é usada como profundidade restante `r20`: no nível `r20 == 0`, todos os **arquivos** do diretório atual ainda são lidos, e apenas a recursão em **subdiretórios** é interrompida (`0x82321fc0`: `cmpwi cr6, r20, 0; ble`).
   - Quando um diretório contém `default.xex` na raiz (`0x82321d4c`), o scanner retorna imediatamente; caso contrário, abre cada arquivo (`CreateFile` + `ReadFile` de 4 bytes + `CloseHandle` em `0x82306148`–`0x823061d4`) para todo item não presente no `content.db` em cada subdiretório até `r20 == 0`:
     - Em `\Content\0000000000000000`, todos os jogos GOD/XBLA ficam no nível 2 (`<TitleID>\00007000\<MediaID>` ou `<TitleID>\000D0000\<arquivo>`). Com `depth = 5`, a Aurora entrava nas pastas `<MediaID>.data\` (nível 3) e abria todos os chunks `Data0000..Data0048` no USB 2.0 a cada boot. Com **`depth = 2`**, encontra todos os títulos jogáveis e para antes de `.data\`.
     - Em `\games`, jogos XEX do Companion ficam no nível 1, multidisco no nível 2, jogos GOD gravados por `InstallGameLocal` ficam em `\games\<Nome> - <TitleID>\00007000\<MediaID>` (nível 2; `.data\` no nível 3) e o `Street Fighter II' HF` empacotado em `badavatar-1.3` fica no nível 3 (`\games\Street Fighter II' HF\584107F4\000D0000\<arquivo>`). Com `depth = 6`, qualquer pasta sem `default.xex` na raiz (ex.: `Fifa 19` quebrado da versão pré-`4444a1c`, cópia interrompida antes de `orderEntryPointsLast` gravar `default.xex`, ou a sobreposição manual da raiz `\Xbox360\System\Usb0\`) fazia o scanner descer 6 níveis abrindo milhares de arquivos de asset no USB 2.0, prendendo a fila de varredura por longos períodos a cada boot. Com **`depth = 3`** (mínimo para não ocultar o `Street Fighter II' HF` no 1º boot), preserva todos os layouts válidos e corta a recursão nos níveis 4–6.
   - *Lacuna remanescente (sem artefatos do HD do cliente):* o reinício ao abrir parte dos jogos novos sem capa (`[187624]`) não pôde ser isolado sem `debug.log`/`crashlog.txt` do HD do cliente (que já era de versão anterior a `4444a1c` e continha pacotes quebrados como `Fifa 19`). Caso ocorra novamente em versão `>= v2.12.130`, `collectConsoleCrashArtifacts` recolhe automaticamente os logs ao reconectar o HD.

## Escopo — o que NÃO é este bug

- **Falhas com `FIFA 19`, `PES 2026 - THE JOKER PATCH`, `PES 2018 OnFire` e `FIFA 23` em 17/11 (`[186236]`, `[186300]`, `[186583]`–`[186777]`):** são entradas quebradas do catálogo (pacotes apenas de save/patch sem executável ou payload errado) **já bloqueadas e removidas** no commit `4444a1c` (`v2.12.130`, `src/server/services/cache/huggingface.go::knownBadHuggingFaceFiles` L157–166), publicado ~12 horas **depois** do download do executável pelo cliente (`2026-11-17T12:33Z`). Classificado como **versão antiga**.
- **Orientação incorreta do `XBOX360_AGENT` (`Manage Paths`, `Scan Depth 2 ou 3` e ligar sem o HD):** registrado separadamente no repositório `digitalstoregamesproject` (`2026-11-20-agente-xbox360-nao-reconhece-caminhos-aurora-e-alucina-ligar-sem-hd.md`).

## Resolução (`[Unreleased]`, `ready-to-play-v7`)

1. **`src/electron-app/infrastructure/readyToPlayConfiguration.ts`:**
   - `READY_TO_PLAY_CONFIGURATION_VERSION` atualizado de `"6"` para `"7"` para aplicar o novo hook no repreparo sem formatar.
   - `READY_TO_PLAY_PATHS` ajustado de `\games` (`6`) / `\Content\0000000000000000` (`5`) para **`\games` (`3`)** e **`\Content\0000000000000000` (`2`)**; bancos existentes são migrados automaticamente pelo `UPDATE scanpaths SET depth=` já presente em `ensureScanPath`.
   - Adicionada `ensureAutoScanEnabled()` em `configureReadyToPlay()`: lê `ScanAutoStart` em `SystemSettings` e, somente quando estiver explicitamente em `'0'`, executa `UPDATE SystemSettings SET Value = '1' WHERE Name = 'ScanAutoStart';` (preservando o `Id` da linha, igual ao `0x8214a4f4` da Aurora) e aciona o reinício único protegido por `RESTART_GUARD_PATH` com motivo próprio no log (`"AutoScan reativado"` / `"caminhos e AutoScan configurados"`). Bancos virgens (sem linha, onde o padrão da Aurora já é `'1'`) não são alterados e `TUScanAutoStart` permanece intocado.
2. **Documentação atualizada:** `docs/READY-TO-PLAY-AURORA.md`, `AGENTS.md` e `CHANGELOG.md`.

## Testes Automatizados

- `src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs` (executado em Lua real via `fengari` + SQLite `sql.js`, mais validação de sintaxe Lua 5.1 com `luaparse`):
  - pendrive novo grava profundidades `3` (`\games`) e `2` (`\Content\0000000000000000`) sem criar linha desnecessária de `ScanAutoStart`;
  - `ScanAutoStart = '0'` é reativado para `'1'` com reinício único protegido contra laço;
  - caminhos legados com profundidades `6` e `5` são atualizados para `3` e `2` com reinício único;
  - falhas de leitura/escrita SQL em `ScanAutoStart` degradam sem erro nem reinício;
  - `TUScanAutoStart` nunca é alterado e o script gerado é Lua 5.1 válido.

## Critérios para fechar

- [x] Comportamento real do `AutoScan` de `Manage Paths` na Aurora verificado no binário (`Aurora/default.xex` 0.7b Rev1655: `ScanAutoStart` padrão `"1"` em `0x823b7df8`, checado em `LoadingEngine` `0x8237fc94`; `TUScanAutoStart` padrão `"0"` em `0x823b8088`)
- [x] Causa da trava do scanner (`scanning queue is currently busy`) isolada no binário (`0x82321820`) e corrigida (`\games` = 3, `\Content\0000000000000000` = 2, autorreparo de `ScanAutoStart = '0'`)
- [x] Teste automatizado cobrindo o ajuste em `readyToPlayConfiguration.ts` (`npm run test:safety --prefix src/electron-app`)
- [ ] Validação em console real e eventual coleta de `debug.log`/`crashlog.txt` caso o sintoma de reinício ao abrir jogos novos reapareça em versão `>= v2.12.130`

## Evidência adicional — re-triagem de 2026-11-21 (chamado `#398`, mesma sessão)

Veredito: **mesmo defeito, cliente em versão anterior à correção** → evidência anexada aqui; o doc fica em `retest/`.

- **A correção ainda não chegou ao cliente:** o `ready-to-play-v7` está só na árvore de trabalho (não commitado em `bec1245`); o `version.json` publicado em 2026-11-21 é `2.12.130` (`releaseDate 2026-11-19`), cujo hook é o **v6** (`\games` = 6, `\Content\0000000000000000` = 5, sem `ensureAutoScanEnabled`; conferido em `git show HEAD:src/electron-app/infrastructure/readyToPlayConfiguration.ts`). O critério "validação em console real" depende de publicar a versão com o v7 e o cliente repreparar o HD.
- **`[190436]` (20/11 02:01 UTC):** print de `Gerenciar Caminhos` confirma o estado descrito acima: `\games` profundidade **6**, `\Content\0000000000000000` profundidade **5**, mais um caminho **`\Xbox360\System\Usb0\` profundidade 2** adicionado durante as tentativas guiadas pelo agente, e `Análise automática` desmarcada.
- **`[190542]` (20/11 03:32 UTC, operador humano):** *"Aqui coloca profundida máxima"*, na tela de edição do caminho `\games`. É o contrário da correção (que reduz para 3/2). Observação: o hook v6 publicado regrava `\games` para 6 no boot seguinte (`ensureScanPath` → `UPDATE scanpaths SET depth=`), então o ajuste manual dura só até reiniciar.
- **`[193169]` (22/11 00:31 UTC, cliente):** *"Porque na Aurora tá aparecendo 81 de 81 sendo que nem tem 81 jogos baixados só tem três"*. Sem print desta tela.
- **`[193282]` (22/11 02:26 UTC, cliente):** *"Será que é por isso que os jogos que eu instalei não tá aparecendo?"* — os jogos instalados continuam não aparecendo.
- **`[193298]`/`[193299]` (22/11 02:35 UTC):** operador atribui a pendrive de má qualidade; o cliente usa HD externo de 500 GB (o mesmo `Innostor Ext. HD` do passo 1). A análise do binário acima não depende da mídia.

### Hipóteses — nenhuma verificada

- **"81 de 81" com 3 jogos:** o caminho manual `\Xbox360\System\Usb0\` (raiz do HD, profundidade 2), somado a profundidades altas, faria o scanner indexar itens que não são jogos (ex.: `Aurora\default.xex` na raiz do HD, conteúdo de `Content\...`) e/ou duplicar os jogos de `\games`. Falta o print do carrossel ou o `content.db` para confirmar.
- **Lacuna da correção v7 (verificada no código, efeito no console não verificado):** `ensureScanPath` só cria/ajusta os dois caminhos de `READY_TO_PLAY_PATHS`; um caminho extra adicionado à mão (como o `\Xbox360\System\Usb0\` deste cliente) **continua no `scanpaths`** depois do repreparo. Se a hipótese acima se confirmar, o v7 sozinho não limpa o HD deste cliente.
