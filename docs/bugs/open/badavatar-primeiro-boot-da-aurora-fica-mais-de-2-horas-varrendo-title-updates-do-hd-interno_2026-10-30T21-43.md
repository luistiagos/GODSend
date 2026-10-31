# Bug: no primeiro boot pelo BadAvatar, a Aurora fica mais de 2 horas varrendo e copiando Title Updates do HD interno do console e nunca chega à lista de jogos

- **Detectado em:** 2026-10-30 21:43 (chamado #301 do painel, sessão `24816857956591@lid`, telefone `5512988862575`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/infrastructure/readyToPlayConfiguration.ts::generateAuroraReadyToPlayFilterLua` e de `docs/READY-TO-PLAY-AURORA.md` ("Arquivos do pacote que não são gravados")
- **Classe:** falha funcional (primeiro boot da Aurora não termina em tempo útil)
- **Severidade:** **P1 — Alto, provisório** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): bloqueio total da plataforma para este cliente — 12h30 → 21h36 (relato dele) sem jogar nenhum dos 5 jogos gravados; terminou em **pedido de reembolso** e ameaça de processo. Rebaixar para P2 se a passada 2 mostrar que é raro (console com muito conteúdo no HD interno)
- **Complexidade:** **desconhecida** — depende de a Aurora expor por `settings`/`Sql` uma opção para não varrer/copiar Title Updates no boot; nada disso foi verificado. *(Passada 2: **baixa** — a opção é `TUScanAtBoot`, em `SystemSettings`, e o hook roda antes da varredura; sobra uma mudança no hook, com teste e prova no console. Ver "Causa raiz".)*
- **Reincidência:** primeira vez registrada. Outro cliente viu a mesma tela de carga sem demora relevante: [[badavatar-avatares-cinzas-sem-link-da-atualizacao-17559-cliente-garimpa-o-site-da-microsoft_2026-10-26T16-30]] (`[155541]`, *"Scanning for new Title Updates..."*)

## Sintoma, na ordem que o cliente viveu

Horários em UTC (o cliente está em UTC-3: `[161584]` 00:09 UTC = *"Já são 21:08"*).

1. **30/10 15:37–16:08**: comprou a Plataforma Xbox 360, preparou o pendrive (58,6 GB) no Companion em modo **Bloqueado ou LT** com "Formatar antes"; o app mostrou *"Pronto! O pendrive está preparado"* (`[160824]`).
2. **16:23 → 21:34**: gravou só **5 jogos** (`[160847]` mostra a fila: A Era do Gelo 3, Adventure Time, Amazing Spider-Man 2, Angry Birds Trilogy...; `[161208]` *"Já baixou todos os jogos"*).
3. **21:38 → 21:48**: login automático do perfil impedia parar na tela de perfis; desativou (`[161241]`). Tela de perfis com `ABadAvatar` + `DirtierT` (`[161249]`).
4. **21:55**: **a Aurora abriu pelo exploit** — o exploit funcionou. Primeira tela: *"Backing up Grand Theft Auto V T[itle Update]"* (`[161291]`).
5. **22:06 → 22:52**: tela de carga da Aurora com *"Scanning \Xbox360\System\Hdd1\Content\0000000000000000\<TitleID>\000B0000\..."* mudando de TitleID (`[161325]` 423607D1, `[161382]` 58411216, `[161401]` 494707F4, `[161429]` 5454082B). Às 22:50 o console avisa *"O console será desligado em breve"* (desligamento por inatividade, `[161429]`).
6. **23:59**: *"Mais de 2 horas , está demorando muito"* (`[161568]`); **00:00** *"Muda e demora muito , perdendo meu tempo quero meu dinheiro de volta"* (`[161571]`) — abre o chamado #301 por `programmatic_refund_intercept`.
7. Reiniciou de novo: tela de senha do Xbox Live (`[161591]`) e depois *"Backing up Goat Simulator Title Update..."* (`[161647]`) — **a varredura recomeça/continua a cada boot**.
8. Ao operador: *"Baixei só 5 jogos e a varredura não concluiu já faz 2 horas só de carreira, desisti"* (`[161638]`); reiniciar dá o *"Mesmo cenario"* (`[161643]`).

## Evidência

Sessão `24816857956591@lid`, tabela `Wpp_proccess`, chamado #301 (`wpp_support_ticket`, `origem_motivo = programmatic_refund_intercept`, `reembolso = 1`).

- **O caminho varrido é o HD INTERNO do console, não o pendrive.** Todos os prints de carga mostram `\Xbox360\System\Hdd1\Content\0000000000000000\<TitleID>\000B0000\`. `000B0000` é o tipo de conteúdo *Title Update*. O console é usado e cheio: 8 perfis (`[161223]` *"Entrar (8 Perfis)"*), GTA V, Captain America, Goat Simulator instalados.
- **Não são os caminhos que o Companion cadastra.** `generateAuroraReadyToPlayFilterLua` (`readyToPlayConfiguration.ts:39-42`) insere só `\games` (depth 6) e `\Content\0000000000000000` (depth 5), ambos com `deviceid` = serial do **pendrive** marcado (`findCompanionDrive`, linhas 62-90). Nenhuma linha aponta para o `Hdd1`.
- **A Aurora parte das configurações padrão.** `docs/READY-TO-PLAY-AURORA.md` ("Arquivos do pacote que não são gravados"): os `settings.db`/`content.db` do pacote capturado são retirados do plano, e o manifesto `src/electron-app/assets/badavatar-1.1.manifest.json` não traz `Aurora/Data/Databases/*` — o primeiro boot cria um banco novo, com os padrões da Aurora.
- **O exploit não é o problema.** A Aurora abriu (`[161291]`); o que não termina é a carga dela.

## Hipóteses — nenhuma verificada

1. **A varredura/backup de Title Updates do padrão da Aurora percorre o `Hdd1` inteiro e copia cada TU para a pasta de dados da Aurora no pendrive FAT32** (*"Backing up ... Title Update"*); com um HD interno cheio, isso passa de 2 horas e é refeito/continuado a cada boot. Falta medir: (a) qual opção da Aurora controla isso (tabela/chave no `settings.db` acessível pelo `Sql` do hook — **não abrir a Aurora por suposição**: confirmar o nome real no banco gerado por um primeiro boot); (b) se o progresso persiste entre boots (`[161647]` mostra outro jogo depois do reinício).
2. **A escrita no pendrive é o gargalo** (pendrive lento/USB 2.0 do console), não a leitura do HD. Falta medir o tamanho de `Aurora/Data/TitleUpdates` (ou equivalente) no pendrive deste cliente — o operador já pediu o print da pasta (`[161644]`, `[161654]`).
3. **Descartada por ora:** "gravação incompleta do pendrive" (hipótese do operador, `[161655]`). A Aurora abriu e está lendo o `Hdd1`; nada nos prints aponta arquivo faltando no pendrive.

## Escopo — o que NÃO é este bug

- Não é [[badavatar-perfil-do-exploit-nao-aparece-na-tela-de-perfis_2026-09-23T15-20]]: aqui o `ABadAvatar` apareceu e o exploit disparou.
- Não é o laço de reinício do hook (`READY_TO_PLAY_RESTART_GUARD_PATH`): a Aurora não reinicia, fica na tela de carga.
- O login automático do perfil (passo 3) é configuração do console, não defeito do app.
- O lado do agente (2 horas de "está avançando, aguarde") está em `C:\projects\digitalstoregamesproject\docs\modules\chatbot-whatsapp\areas\prompt-kb\bugs\2026-10-30-agente-xbox360-segura-cliente-2-horas-na-carga-da-aurora-dizendo-que-esta-avancando.md`. Os dois sobrevivem sozinhos: corrigir o app não ensina o agente a reconhecer o caso em pendrives já preparados.

## Causa raiz (passada 2, revista em 2026-10-31 lendo o binário da Aurora)

**Em uma frase:** toda Aurora nova nasce com `TUScanAtBoot = "1"`, uma pendência de varredura de Title Updates que só é
apagada quando a varredura **termina**. Num console com muitas TUs ela copia cada TU para o pendrive na tela de carga, e
qualquer desligamento antes do fim faz tudo recomeçar no boot seguinte. O Companion nunca mexe nessa pendência, embora o
hook rode **antes** da varredura e pudesse apagá-la.

Nenhum console foi usado: o que segue vem do código, do manifesto e do `Aurora/default.xex` do pacote (0.7b Rev1655).
Endereços são VAs da imagem carregada em `0x82000000`. Como abrir o binário está em "Como reproduzir a leitura", abaixo.

### Provado

1. **O Companion não toca nessa opção e o pacote não traz banco da Aurora.**
   `readyToPlayConfiguration.ts::generateAuroraReadyToPlayFilterLua` (linhas 31-185) só faz `SELECT`/`INSERT`/`UPDATE` em
   `scanpaths` e chama `Aurora.Restart()`. No `badavatar-1.1.manifest.json`, o único prefixo em `Aurora/Data/` é
   `Aurora/Data/Logs` (20 arquivos), que `foreignConsoleState.ts::FOREIGN_CONSOLE_STATE_PATTERNS` ainda retira.
2. **O padrão é varrer no primeiro boot.** O registro das opções, com os mesmos argumentos `(nome, padrão, regex)`:
   `TUScanAtBoot` padrão `"1"` (`823b802c`) e `TUScanAutoStart` padrão `"0"` (`823b8088`), ambos com regex `^[01]$`.
   Ficam em `Config.SystemSettings (Name, Value, UNIQUE(Name))`, no `settings.db` (`ATTACH '%s%s' AS Config`).
3. **O `if` do boot.** `LoadingEngine`, função `8237f660`, trecho `8237f9c4`-`8237fb18`: roda se
   `TUScanAutoStart == 1` **ou** `TUScanAtBoot == 1`. Dentro, `82460738` loga `Start Title Update Scan` e percorre
   `\Cache\` e `\Content\0000000000000000\`; `8245fb40` loga
   `Found Title Update:  %s [Version #%d]... copying to backup`.
4. **É uma pendência de uma vez só.** A espera da varredura é um laço de `WaitForSingleObject` com status (`8237fb98`,
   compara com 258 = timeout). Ao terminar, `8237fbd0`-`8237fbd8` grava `0` no objeto `r28`, que é o `TUScanAtBoot`
   (lido em `8237f9cc`, guardado em `8237f9f0`). Antes do fim ele fica `1`, e o boot seguinte repete. É isso que o passo 7
   do sintoma mostra.
5. **"Procurar agora" liga a mesma pendência.** `822bcb58`-`822bcbc0`: depois da confirmação, grava `1` em `TUScanAtBoot` e
   chama `8246d798(1)`, o que bate com o aviso *"Uma reinicialização é necessária..."*. Portanto o caminho de volta para
   quem quiser a varredura continua existindo mesmo com o padrão desligado.
6. **O hook roda antes da varredura.** Ordem dos status no `LoadingEngine`: `LOADCONTENTCACHE` (`8237f760`),
   `COVERFLOWINIT`, `INITMODULES`, `TUSCANSTART` (`8237fb24`), `BUILDGAMELIST`, `BUILDPROFILECACHE`, `LOADCOMPLETE`.
   Os Filters carregam antes disso, na inicialização do ContentManager (`8230a2fc`, erro `Failed to initialize
   ContentScripts`). No `debug.log` do pacote: `Loading User Filters:` às 19:05:41.917 (linha 25) e
   `Content Manager added 0 items from the content cache` às 19:05:44.738 (linha 244).
7. **As telas do cliente são estas etapas.** Tabela de strings lida pelo formato real (`[u16 tam][valor][u16 tam][chave]`,
   o valor vem **antes** da chave): `IDS_LOADING_STATUS_TUSCANSTART` = *"Verificando novas atualizações de título..."*,
   `IDS_LOADING_STATUS_TUSCAN` = *"Escaneando %1$s..."* (o `Scanning \Xbox360\System\Hdd1\...`) e
   `IDS_LOADING_STATUS_TUBACKUP` = *"Fazendo backup %1$s..."* (o `Backing up Grand Theft Auto V T...`).

### Indício forte, não provado

- **`TUScanAutoStart` é a caixa "Análise automática"** (`TUAutoScanCheck`, Configurações → Conteúdo): nome, padrão `0` e
  uso na mesma cena (`822bca70`, `822bcdec`). Não liguei o controle à opção. Qualquer que seja o caso, ela vem desligada e
  **não** é o que causa este bug.
- **O backup vai para o pendrive: agora provado.** A função de backup `8245fbe8` usa `Game:\Data\TitleUpdates\%s\%08X\%s\`
  (`8245fcd0`) e loga `Failed to Copy %s to it's backup location- might exist already` (`8245fd80`). Como a Aurora roda do
  pendrive, `Game:` é o pendrive. Essa mensagem também sugere que o que já foi copiado é pulado, sem provar.
- **O desligamento automático corta a carga.** `[161429]`, 22:50: *"O console será desligado em breve"*, cerca de 55 min
  depois de a Aurora abrir. Não há registro de que a tela de carga conte ou não como atividade, nem de quantos boots
  foram interrompidos assim e quantos pelo próprio cliente.

### Ainda desconhecido

- Por que levou mais de 2 horas: quantidade e tamanho das TUs e velocidade do pendrive. A correção não depende disso, mas a
  T4 mede.
- Se a varredura repetida pula o que já foi copiado (`[161647]` sugere que sim).
- **O que o lançador faz com um jogo cuja TU não está no banco da Aurora.** O arquivo continua no lugar (a varredura copia,
  não move), e o `Ativo/Inativo` do Companion trabalha por renomeação, sem depender da lista da Aurora
  (`docs/SUPPORT_AGENT_KB.md:159`). Mas não provei que o jogo aplica a TU com a tabela `TitleUpdates` vazia. A T2 precisa
  testar isso, e é o maior risco da correção. O passo de TU do lançador (`822956c4`) percorre uma lista e chama `82461d08`
  por item; não provei qual é a lista nem o efeito de ela vir vazia. O `ContentWorkerThread` (`82322880`) tem outro
  `copying to backup` (`82321358`, log em `82321408`), independente da varredura de boot, que pode cobrir as TUs do
  pendrive; não segui o que dispara esse caminho.

## Por que este cliente e não os outros (2026-10-31)

**Não há comportamento diferente neste console:** o `if` do boot não olha console nem dispositivo, então todo primeiro boot
concluído passa pela varredura. O que muda é o custo: tempo ≈ volume de TUs no HD interno ÷ escrita no pendrive, mais os
recomeços. Este console é usado (8 perfis, GTA V, Captain America, Goat Simulator, pelo menos 5 TitleIDs nos prints); o
cliente do `[155541]` viu a mesma etapa sem demora.

Isso é explicação compatível com os fatos, **não medição**. Faltam quantidade/tamanho das TUs e velocidade do pendrive (T4).
Pode nem ter havido uma execução de 2 horas: entre 21:55 e 23:59 houve o aviso de desligamento (`[161429]`) e reinícios, e
cada corte recomeça a carga. Quantos clientes passaram por isso sem reclamar é desconhecido; a contagem por `/diag/query` foi
negada pelo controle de permissões em 2026-10-31.

## Risco da correção para os outros clientes

O dono não tem console para testar (2026-10-31). Por isso a correção de "apagar a pendência sempre" foi **abandonada**: ela
mudaria o boot de todos, com um risco que só o console elimina (TU gravada antes do primeiro boot deixar de ser aplicada). O
desenho da T1 agora é **só agir depois de uma varredura interrompida**: quem funciona hoje não muda.

| Situação | O que acontece com a T1 | Risco |
|---|---|---|
| Varredura termina na 1ª tentativa (a maioria) | igual a hoje; a pendência zera sozinha e o hook só apaga a marca dele | nenhum |
| Pendrive não preparado de novo | continua com o hook v4 | nenhum |
| Varredura interrompida (console pesado) | no boot seguinte o hook apaga a pendência e reinicia uma vez | a TU pode não ser registrada; é onde hoje o cliente está travado |
| Interrupção por acaso em console leve | idem | raro; *Procurar agora* faz a varredura de novo |
| `SELECT`/`INSERT` falha, ou a marca não grava | nada muda; a varredura segue como hoje | nenhum |
| Erro de sintaxe no hook | as pastas de jogos não seriam cadastradas | **grave**; coberto na T1 rodando o Lua de verdade no PC |

**Limite aceito:** o console pesado ainda paga a primeira tentativa até ela ser cortada. A correção não evita essa espera, só
garante que um reinício a encerra e que ela não se repete.

**Sobre a escrita da pendência:** o setter `822121b8` chama `823c7e58`, que valida o valor pela regex e chama `823c8370`,
vizinha de `823c8208`, que chama o `UPDATE` (`823e2a68`); não segui o trecho entre as duas. Há `INSERT` em `823e27b0`, chamado de
`823c7358`. O desenho não depende de como isso termina: sem linha, vale o padrão `1`, e o `INSERT OR REPLACE` cobre os dois casos.
Se a linha não fosse atualizada ao fim da varredura, o custo seria um reinício a mais, uma vez.

## Hipóteses descartadas

- **O `Aurora.Restart()` do hook dobra a varredura** (eu mesmo afirmei isso como provado na primeira versão desta passada).
  Errado: o hook reinicia em cerca de 1 s de boot, antes do `TUSCANSTART`. O reinício não passa pela varredura.
- **A caixa "Análise automática" ligada é a causa, e desmarcá-la resolve** (idem). Errado: ela vem desligada por padrão;
  a varredura do primeiro boot vem do `TUScanAtBoot`, e desmarcar a caixa não muda nada.
- **Só um `settings.db` pré-gravado cobriria o primeiro boot.** Desnecessário: o hook roda antes da varredura.
- **Scan path do Companion apontando para o `Hdd1`.** `READY_TO_PLAY_PATHS` (linhas 39-42) só tem `\games` e
  `\Content\0000000000000000`, com o `deviceId` de `findCompanionDrive`. Quem percorre o `Hdd1` é o `TitleUpdateManager`.
- **Estado do console de origem do pacote mandando varrer o `Hdd1`.** `apps/freestyle/data/databases/` não é gravado e não
  existe banco da Aurora no pacote. Os `TitleUpdates` do FreeStyle não são lidos pela Aurora.
- **A TU que o próprio pacote grava** (`Content/0000000000000000/394707D1/000B0000/tu00000012_00000000`): uma só, no pendrive.
- **O `debug.log` não serve de cronômetro** (também escrito na primeira versão). A conclusão era apressada: o binário tem
  as mensagens `Start Title Update Scan` e `Found Title Update...`. O log do pacote não as tem porque aquele boot não varreu.
  O `debug.log` do pendrive do cliente pode medir o tempo por TU (T4).
- (passada 1) **Gravação incompleta do pendrive** e **o exploit**: a Aurora abriu e está lendo o `Hdd1`.

## O que fazer

- **T1 — o hook só apaga a pendência depois de uma varredura interrompida.** Em `generateAuroraReadyToPlayFilterLua`, dentro
  de `configureReadyToPlay`, depois do bloco dos scan paths. Regras, nesta ordem:
  1. ler `SELECT Value FROM SystemSettings WHERE Name = 'TUScanAtBoot'`, com `rowValue`; sem linha vale `1` (o padrão);
  2. valor `0`: apagar a marca de tentativa, se existir, e parar;
  3. se este boot já vai reiniciar pelos scan paths: não fazer nada, porque ele nem chega à varredura e não pode contar como
     tentativa;
  4. sem marca de tentativa: gravar `.xbox-downloader\ready-to-play-v5.tuscan` e deixar a varredura correr;
  5. com a marca: a tentativa anterior não terminou. `INSERT OR REPLACE INTO SystemSettings (Name, Value) VALUES ('TUScanAtBoot', '0');`
     e, só se der certo, reiniciar pelo fluxo que já existe, com a marca de reinício. O valor do boot atual está na memória,
     por isso o reinício é necessário.

  Não tocar em `TUScanAutoStart`. *Procurar agora* continua funcionando: grava `1`, não há marca (o boot com `0` a apagou), e vira
  uma tentativa normal. Tudo roda dentro do `pcall`, e o que falhar devolve o comportamento de hoje.

  **Decisões ao implementar (2026-10-31):**
  - no passo 5 o hook também **apaga a marca de tentativa** antes de reiniciar, e não reinicia se ela continuar lá. Motivo:
    a marca de reinício é apagada no começo de todo boot com os scan paths intactos, então ela sozinha não segura um laço.
    Se o `0` gravado não persistir (a Aurora regravar o `1` da memória, por exemplo — não provado nem descartado), o boot
    seguinte veria `1` + marca e reiniciaria de novo, para sempre. Consumindo a marca, o pior caso é um reinício a mais por
    varredura interrompida de verdade;
  - interpretador: `fengari` 0.1.4 (devDependency), que é Lua **5.3**; a Aurora é 5.1. O hook não usa nada exclusivo da 5.3
    (sem `//`, operadores de bit, `goto`, `utf8`), mas o teste não prova sintaxe 5.1. SQLite do teste: `sql.js`, já
    dependência do app, com `SystemSettings` num banco **anexado** como `Config` (como a Aurora faz), para provar que o nome
    sem esquema resolve no `SELECT` e no `INSERT OR REPLACE`. Não provado: que o `Sql` do hook enxerga o `Config` no console;
    se não enxergar, o `SELECT` falha, o hook imprime e a varredura segue como hoje (T2 confere no `debug.log`).

  Subir `READY_TO_PLAY_CONFIGURATION_VERSION` para `"5"`, atualizar `docs/READY-TO-PLAY-AURORA.md`, a versão nos quatro lugares
  e o `CHANGELOG.md`.

  **Teste que substitui o console na parte lógica:** em `src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs`, rodar
  o Lua gerado num interpretador real, com `FileSystem`, `Sql` e `Aurora` falsos e o `Sql` sobre SQLite com o esquema real de
  `SystemSettings` e `ScanPaths`. Não há Lua nesta máquina: entra dependência só de desenvolvimento (`fengari` executa, `luaparse`
  confere sintaxe de Lua 5.1); escolher ao implementar. Cenários:
  - pendrive novo: 1º boot reinicia sem marca de tentativa; 2º grava a marca; varredura termina; 3º apaga a marca e não reinicia;
  - interrompida: 2º boot grava a marca, a pendência fica `1`; 3º grava `0` e reinicia uma vez; 4º nada;
  - *Procurar agora* depois disso: uma tentativa normal;
  - `Sql.Execute` falhando, `ExecuteFetchRows` devolvendo `nil`, `WriteFile` sem efeito: nenhum reinício, nenhum erro;
  - marca de reinício já presente: grava `0` e não reinicia.
- **T2 — prova em campo, sem console do dono.** Publicar e acompanhar: `Backing up`/`Scanning` nas conversas, e `debug.log` do
  primeiro cliente que passar pelo caso. As mensagens `print` do hook vão para esse log, então cada ramo deve imprimir o que
  decidiu. Se aparecer um console para teste, repetir os itens de `SELECT ... LIKE 'TUScan%'` e da TU aplicada.
- **T3 — base de suporte** (`docs/SUPPORT_AGENT_KB.md`, `docs/BASE_CONHECIMENTO_SUPORTE_WHATSAPP.md`
  e o bug do agente citado no Escopo): tela `Scanning ...\000B0000\` ou `Backing up ... Title Update` é a varredura única;
  não reiniciar, mexer no controle para o console não desligar, e ela não volta depois de terminar. Pendrive preparado
  com a versão corrigida: se demorar demais, desligar e ligar de novo basta, porque o boot seguinte pula a varredura. O
  aviso na `BadAvatarUsbPage.tsx` sai do plano.
- **T4 — evidência do #301:** além do print da pasta pedido em `[161644]`/`[161654]`, pedir `Aurora/Data/Logs/debug.log` e
  `debug.log.last` do pendrive. Mede tempo por TU e confirma as hipóteses 1 e 2 da passada 1.

**Contorno para o suporte (substitui o da primeira versão):** deixar a carga terminar **uma vez**, sem reiniciar e mexendo
no controle de tempos em tempos. Depois disso a pendência se apaga e a varredura não volta. Não adianta procurar a caixa
"Análise automática".

## Achado fora do escopo (registro separado, não trabalho deste bug)

- `insertScanPath` tenta primeiro `INSERT INTO scanpaths (..., optionsflags)`, mas a coluna real é `OptionsFlag`, no singular
  (`0x1483b8`). A query falha sempre e cai na segunda, sem a opção; o cadastro funciona, mas o valor `1` nunca é gravado.
  Não sei se isso muda algo visível.

## Como reproduzir a leitura do binário

Só no PC, sem executar nada (`Aurora/default.xex`: `encryption=1`, `compression=1`, compressão **básica**, sem LZX):

1. cabeçalho em `0x3FF` (`file_format_info`): pares `(dados, zeros)` = `(0x208000, 0x8000) (0x958000, 0x8000) (0x40000, 0x18000) (0x20000, 0)`;
2. chave de sessão = AES-128-CBC, IV zero, chave mestra **zerada** (a de devkit; a de retail não dá `MZ`), sobre os 16 bytes em `security_offset + 0x150`;
3. mesmo AES sobre os blocos a partir de `0x3000`, sem reiniciar o CBC e reinserindo os zeros de cada bloco;
4. a imagem é plana: offset no arquivo = VA − `0x82000000`. Referências a string são `lis` + `addi`.

## Correção aplicada — T1 (2.12.121, 2026-10-31)

- `readyToPlayConfiguration.ts`: versão `"5"`; nova `READY_TO_PLAY_TU_SCAN_ATTEMPT_PATH`; no Lua, `restartOnce` (o trecho
  de gravar/conferir a marca e reiniciar, antes inline), `titleUpdateScanPending` e `skipInterruptedTitleUpdateScan`,
  chamada no fim de `configureReadyToPlay` em todo boot que não reinicia pelos scan paths. Mensagens de cada ramo vão para
  o `debug.log` (T2): `varredura de Title Updates pendente; deixando correr.`, `varredura de Title Updates anterior
  interrompida; TUScanAtBoot apagado; reiniciando Aurora.`, `TUScanAtBoot apagado sem reiniciar...`, `TUScanAtBoot
  ilegivel...`, `falha ao apagar TUScanAtBoot...`.
- Teste: `readyToPlayConfiguration.test.cjs` executa o hook (fengari 0.1.4 + `sql.js`) nos seis cenários da T1 (o teste de
  ordem por `indexOf` do reinício virou o cenário executado "cadastro que não persiste não reinicia em laço"). Prova
  inversa no JS compilado: sem a chamada `skipInterruptedTitleUpdateScan`, 5 de 6 cenários falham; sem o
  `DeleteFile(attemptPath)` do passo 5, falham 3 (interrompida, `0` que não persiste, marca de reinício presente).
  `npx tsc -p .` e `node --test tests/unit/*.test.cjs` (367) verdes.
- Docs: `docs/READY-TO-PLAY-AURORA.md` (seção "Varredura de Title Updates interrompida", v5, validação física),
  `AGENTS.md` (item `readyToPlayConfiguration.ts`), `CHANGELOG.md`.
- Não feito aqui: T2 (campo), T3 (base de suporte), T4 (evidência do #301).

## Critérios para fechar

- [x] T1 aplicada, com o hook executado em Lua real nos cenários listados (2.12.121)
- [ ] T2: `debug.log` de um caso real mostra a pendência apagada depois de uma interrupção e a lista de jogos abrindo
- [ ] T3 publicada na base de suporte
