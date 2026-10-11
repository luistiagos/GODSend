# Backlog: app Android que só prepara o pendrive BadAvatar

- **Estado:** backlog. T0 (complexidade e tempo) feito em 2026-10-11, aguardando o dono decidir
  se segue para a spec (ver "T0 — resultado")
- **Aberto em:** 2026-10-11, a pedido do dono
- **Origem:** clientes da Plataforma Xbox 360 com console travado ou LT **sem computador**. O
  agente de suporte do WhatsApp diz que "sem PC não tem como" (chamados #95 e #167). Análise
  completa no repo `digitalstoregamesproject`:
  `docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-10-07-guia-xbox360-diz-que-console-travado-exige-pc-windows-e-nega-o-caminho-pelo-celular.md`
  (seções "Resultado do passo 1", "Pesquisa: existe caminho mais simples pelo celular?" e "A loja
  não tem Xbox para testes").

## O que é

Um app Android **novo e separado**, com uma função só: deixar no pendrive o mesmo conteúdo que
o Companion de Windows grava no preparo BadAvatar, para o cliente que só tem celular.

Decisões do dono (2026-10-11):

1. **App novo, dedicado.** Não é o `src/android-app/` (GODsend-360 Android, que baixa e envia
   jogos). O código dele pode servir de referência.
2. **Quem formata o pendrive é o cliente, no próprio Xbox 360** (Configurações > Sistema >
   Armazenamento). O app não formata.
3. **Só o desbloqueio BadAvatar.** Sem modo RGH (`isRghOnly`) e sem jogos.
4. **"Da mesma forma que o Companion":** mesmo pacote, mesmos arquivos gerados e mesmas
   conferências que valem fora do Windows.

## O que o Companion faz hoje e o que entra no app

Fonte: `src/electron-app/services/fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice`,
nesta ordem:

| passo no Companion | símbolo | no app Android |
|---|---|---|
| identifica o dispositivo físico e a impressão digital | `requireSafeWindowsUsbTarget` | **adaptar**: identificar o volume USB do Android; a impressão digital alimenta o `transactionId` |
| carrega e confere o catálogo do pacote (SHA-256 por arquivo + `bundleSha256`) | `loadPackageIndex`, `loadManifest` (`assets/badavatar-package.json`) | **igual**, com o mesmo manifesto |
| recolhe crashlog e logs do Aurora antes de formatar | `reportConsoleCrashArtifacts` | **fora** (o app não formata e não manda telemetria nesta versão); pode entrar depois |
| formata em FAT32 (opcional) | `formatVolumeFat32` | **fora**: quem formata é o console |
| exige FAT32 e layout que o Xbox lê | `requireXboxReadableLayout` → `infrastructure/xboxDiskLayoutPolicy.ts::assessXboxLayout` | **igual onde der para ler** (ver risco R2) |
| tira do plano o estado de outro console | `isForeignConsoleStatePath`, `quarantineForeignConsoleState` | **igual** |
| gera o filtro Lua do Aurora, o marcador e o `launch.ini` | `replaceGeneratedEntry` + `infrastructure/readyToPlayConfiguration.ts` (`READY_TO_PLAY_CONFIGURATION_VERSION`) | **igual**, byte a byte |
| plano transacional, espaço, gravação com diário e retomada | `buildTransactionalWritePlan`, `assessWriteCapacity`, `executeTransactionalWriteToDevice` | **igual no comportamento**: retomar depois de o pendrive sair, conferir SHA-256 depois de gravar |
| recibo do preparo (`.xbox-downloader/preparo.json`, fora da transação) | `infrastructure/preparationReceipt.ts` | **igual**, mais um campo que diga que veio do app Android: o recibo existe para o suporte saber **como** o pendrive foi preparado |

Invariante que vale também aqui (ver `AGENTS.md`, `badAvatarUsbService.ts`): a única prova de
"pendrive preparado" é o **perfil do exploit** (`exploitProfileFiles()`, `Content/<XUID>/…`),
nunca a presença de `Aurora/`, `Content/0000000000000000` ou `launch.ini`. Nenhum texto do app
afirma que o console foi desbloqueado.

## Fora do escopo

- Formatar o pendrive pelo celular.
- Modo RGH/JTAG, jogos, FTP, catálogo.
- iPhone (decisão do dono no bug de origem: só Android).
- HD externo: o OTG do celular costuma não alimentar HD sem fonte própria. Decidir na spec se o
  app recusa ou só avisa.

## Riscos e perguntas abertas (resolver na spec, antes de codar)

- **R1. O que o "formatar no console" deixa no pendrive.** O "Configurar agora" do Xbox 360
  reserva o dispositivo inteiro para armazenamento do console: cria a pasta `Xbox360` com os
  arquivos de dados, e há relatos de pendrive "cheio" no PC depois disso. Falta saber: sobra espaço
  para os 726 MB do pacote? O layout que o console deixa passa em `assessXboxLayout`? O BadAvatar
  roda com a pasta `Xbox360` presente? O app pode apagar essa pasta? Hoje o Companion não trata
  pendrive configurado pelo console (nada no código procura `Xbox360/`), porque ele mesmo formata.
  Três tutoriais do YouTube fazem desse jeito e dá certo (`Du5M9EvkvjE`, `d3_AQKDejdE`,
  `s9b0X4TlUWg`), mas nenhum mede o espaço.
- **R2. Ler o layout do disco no Android.** Pelo Storage Access Framework só se veem arquivos,
  sem MBR, tipo de partição nem tamanho de setor. Ler o layout exige acesso USB bruto (API USB
  Host, como fazem EtchDroid e libaums). Decidir se a conferência de layout entra, e por qual
  caminho. Sem ela, o app confere só o que dá: FAT32 e espaço livre.
- **R3. Como gravar no pendrive.** As opções são o SAF (`ACTION_OPEN_DOCUMENT_TREE` na raiz do
  pendrive, sem root, o caminho dos gerenciadores de arquivos) ou a escrita FAT32 própria sobre
  USB bruto. Pesam desempenho com cerca de 640 arquivos, retomada e quantos aparelhos funcionam.
- **R4. Distribuição do pacote (726 MB) — decidido pelo dono em 2026-10-11: R2, no mesmo
  lugar dos outros.** Hoje o pacote só existe embutido no instalador de Windows
  (`docs/ATUALIZAR-PACOTE-BADAVATAR.md`) e não tem URL pública. O "mesmo lugar" é o que o
  `upload-r2.ps1` usa: bucket `versions` (`r2-config.json`), URL pública
  `https://versions.digitalstoregames.com`, pasta `XBOX360Companion/`, envio com `rclone`
  (`--s3-provider=Cloudflare`) e um `.sha256` publicado ao lado do arquivo. O app baixa o pacote
  dali e confere cada arquivo contra o mesmo `badavatar-package.json` (`bundleSha256`) que o
  Companion usa. Para a spec decidir: o nome e o caminho do objeto (com a release no nome, para
  versões conviverem), o formato (`.zip` único ou arquivos soltos) e quem publica a cada troca de
  pacote (ver se o `docs/ATUALIZAR-PACOTE-BADAVATAR.md` ganha esse passo).
- **R5. Loja de apps.** A Play Store pode recusar um app ligado a desbloqueio de console. Se for
  APK avulso, instalar fora da loja vira mais um passo para o cliente leigo.
- **R6. A loja não tem Xbox 360 para testes.** A prova é por equivalência: um pendrive preparado
  pelo app, plugado no PC, tem de sair igual ao que o Companion grava, com os mesmos arquivos e
  SHA-256, os mesmos arquivos gerados, layout aprovado por `assessXboxLayout`, e o Companion tem
  de listá-lo como preparado. O lado do console (R1) só se prova com um console de verdade,
  seja de um cliente acompanhado pelo suporte, seja um console de laboratório.

## Critérios de aceite (rascunho, para a spec)

1. Com um pendrive formatado no Xbox 360, o app grava o pacote e, no PC, cada arquivo confere em
   tamanho e SHA-256 com `badavatar-package.json`. Os arquivos gerados (Lua, marcador,
   `launch.ini`) são iguais aos que o Companion gera com o mesmo `READY_TO_PLAY_CONFIGURATION_VERSION`.
2. Depois do app, o Companion de Windows lista o pendrive com `preparedState =
   preparado-bloqueado-lt` (`services/preparedDeviceState.ts::detectPreparedDeviceState`, que
   confere o perfil do exploit).
3. Tirar o pendrive no meio da gravação e plugar de novo retoma sem regravar o que já conferiu e
   sem deixar o pendrive parecendo pronto.
4. Pendrive sem espaço, fora de FAT32 ou com layout reprovado (quando legível) é recusado com uma
   mensagem que diz o que fazer.
5. Pelo menos um console real roda o BadAvatar a partir de um pendrive preparado só pelo app,
   começando da formatação no console (fecha R1).

## Próximo passo

Spec seguindo o fluxo do projeto: o QUE, os critérios com a prova de cada um, e só então o COMO.
R4 está decidido. R1 continua aberto (sem console, depende de ajuda de campo) e entra na spec
como premissa a provar, sem travar a escrita.

## Passagem de bastão (2026-10-11) — escrever a spec

**Já feito (não refazer):** a pesquisa de mercado e o "por que celular" estão no bug de origem
(link no topo). O mapa do preparo do Companion, na tabela acima, foi lido em
`fixedBadAvatarPreparationService.ts` (linhas 485-666), `preparedDeviceState.ts`,
`preparationReceipt.ts` e `xboxDiskLayoutPolicy.ts`. A decisão de hospedar no R2 está no R4.

**Fatos para a spec, já conferidos no código:**
- `detectPreparedDeviceState` devolve `preparado-bloqueado-lt` só quando **todos** os arquivos do
  perfil do exploit existem com o tamanho do pacote (`matchesBundledSize`). Essa é a prova do
  critério 2.
- O recibo (`.xbox-downloader/preparo.json`) só é **gravado** pelo Companion; nada no app o lê.
  Ele serve ao suporte. `PreparationMode` hoje é `"bloqueado-lt" | "rgh"`, e a origem Android
  pede campo novo ou modo novo: decidir sem quebrar `schemaVersion: 1`.
- O `transactionId` sai de `bundleSha256 + fingerprint + scope` (`deterministicTransactionId`), e
  o diário recusa um plano com byte volátil (comentário no topo de `preparationReceipt.ts`). A
  impressão digital do dispositivo no Android precisa ser estável entre conexões, senão a
  retomada não acha o diário.
- Nada no código trata a pasta `Xbox360/` que o console cria ao configurar o pendrive (R1).

**T0 — PRIMEIRA TAREFA, antes da spec (pedido do dono, 2026-10-11): medir complexidade e tempo.**

Pergunta do dono: quanto falta, em complexidade e em tempo, para terminar a **versão mobile do
Xbox Companion**, sendo que a **v1 se resume a pegar o pendrive já formatado pelo Xbox 360 e
gravar nele o desbloqueio**? A resposta decide se vale seguir para a spec e com que tamanho.

O que entregar, gravado nesta seção do doc (nunca só no chat):
1. **Duas bases comparadas**, com o que cada uma já tem e o que falta para a v1:
   - (a) partir do `src/android-app/` (GODsend-360 Android: backend Go embutido como
     `libgodsend.so`, WebView, assistente "Wi-Fi x Pendrive", varredura de unidades montadas). Abrir
     `MainActivity.kt`, `GodsendBackendService.kt` e o README da pasta, e ver o que funciona de fato;
   - (b) app novo e mínimo (Kotlin nativo, uma tela).
   Recomendar uma das duas. A decisão anterior do dono era "app novo"; se a medição apontar (a),
   levar a ele com os números.
2. **Lista de trabalho da v1**, cada item com complexidade (baixa/média/alta) e estimativa em
   dias de desenvolvimento. Mínimo: acesso ao pendrive (R3), download do pacote do R2 com
   conferência SHA-256 (R4), conferência do catálogo (`loadManifest`), arquivos gerados iguais
   byte a byte (`readyToPlayConfiguration.ts`), retirada do estado de outro console, gravação
   com retomada, recibo, telas e textos para leigo, publicação (Play Store ou APK, R5), e o
   passo de publicar o pacote no R2 a cada troca.
3. **O que pode ficar fora da v1** para encurtar, e quanto isso economiza. Candidatos: retomada
   transacional completa (versus regravar tudo), leitura do layout do disco (R2), quarentena do
   estado de outro console.
4. **Riscos que mudam a estimativa** e quanto cada um pesa: R1 (espaço depois do "Configurar
   agora"; se não sobrar espaço, a v1 precisa de um passo a mais), R3 (desempenho do SAF com
   cerca de 640 arquivos), R5 (Play Store recusar).
5. **Prova sem console:** quanto custa montar o teste por equivalência (pendrive preparado pelo
   celular, conferido no PC contra o Companion), incluindo um teste automatizado, se der.

Como medir: estimar por item, a partir do código que já existe (o tamanho das funções que vão ser
portadas). Não estimar no escuro. Registrar as premissas (uma pessoa? experiência com Android?)
e perguntar ao dono só o que mudar o número.

### T0 — resultado (2026-10-11)

**Resposta curta:** a v1 dá **15 a 22 dias de desenvolvimento** de uma pessoa que conhece Android
(17 na conta item a item, mais uma folga para diferenças entre aparelhos), cerca de 3 a 4,5
semanas, com **APK avulso**. A complexidade geral é média: nada ali é pesquisa, e o único item
alto é gravar com retomada pelo SAF. O que mais mexe no prazo não é código: é o R1 (só um console
prova) e a Play Store (se for a escolha, +3 a 5 dias de trabalho e pelo menos 14 dias de
calendário). **Recomendação: base (b), app novo**, o que confirma a decisão anterior do dono.

**Premissas**
- Uma pessoa com experiência em Kotlin/Android, ou um agente escrevendo o código com o dono
  testando no celular. "Dias" são dias úteis de desenvolvimento, sem contar a espera pelo console.
- O ambiente desta máquina está pronto (conferido): SDK em `D:\DevCaches\Android\Sdk`, JDK 17,
  `adb`, `gradlew`, e o `src/android-app/` já gerou um `app-debug.apk`. Montar o ambiente custa ~0.
- Nenhum celular conectado (`adb devices` vazio): **nada do SAF foi medido em aparelho**, e os
  números de desempenho abaixo são estimativa.
- v1 = o cliente formata no console e o app grava o desbloqueio. O app não formata, não tem modo
  RGH, não baixa jogos e não manda telemetria.

**O que foi aberto (`arquivo::símbolo` — o que faz)**
- `src/android-app/.../MainActivity.kt` (114 linhas): só um WebView em `http://127.0.0.1:8080` e
  o pedido de `MANAGE_EXTERNAL_STORAGE`.
- `src/android-app/.../service/GodsendBackendService.kt` (172): serviço em primeiro plano que
  executa `libgodsend.so` (15,5 MB, compilado em 2026-08-04) com WakeLock de 24 h.
- `src/server/interfaces/http/handlers_tools.go::handleToolsStorageDrives`: o "modo pendrive" do
  GODsend só lista `/storage/*` e testa escrita gravando um arquivo; não sabe nada de BadAvatar.
  `grep -i "badavatar|exploitProfile|launch.ini"` em `src/server`: dois comentários e nenhum código.
- `services/fixedBadAvatarPreparationService.ts` (667): o fluxo inteiro. `loadManifest` (40
  linhas) valida o catálogo e recalcula o `bundleSha256`.
- `infrastructure/readyToPlayConfiguration.ts` (185): **os três arquivos gerados são strings
  fixas** que só dependem de `READY_TO_PLAY_CONFIGURATION_VERSION` (`"4"`). Nada vem do dispositivo.
- `infrastructure/foreignConsoleState.ts` (124): o filtro são 4 regex. A quarentena só move, no
  pendrive, cópias byte a byte do estado que veio no pacote.
- `infrastructure/transactionalWritePlan.ts` (231) + `simulatedTransactionalWriter.ts` (461) +
  `transactionJournal.ts` (274): diário no próprio pendrive com estados
  `planned → staging → committing → completed`, `.partial` + rename e backup do alvo. A retomada
  só acha o diário se `transactionId` e `planHash` baterem. **Um alvo que já confere em SHA-256 é
  reaproveitado sem regravar**, então o Companion de Windows aceita depois um pendrive gravado pelo
  app sem conflito.
- `infrastructure/writeCapacityPolicy.ts` (214): espaço livre calculado com arredondamento por cluster.
- `services/preparedDeviceState.ts::detectPreparedDeviceState`: recebe só a pasta raiz e a lista
  do perfil, então roda **sem adaptação** contra o pendrive plugado no PC. É a base do teste de
  equivalência.
- `infrastructure/preparationReceipt.ts` (59): nada lê o recibo, e um campo opcional novo não
  quebra o `schemaVersion: 1`.
- Do lado do Windows, cada peça já tem teste em `src/electron-app/tests/unit/` (14 arquivos:
  `readyToPlayConfiguration`, `foreignConsoleState`, `transactionJournal`,
  `simulatedTransactionalWriter`, `preparedDeviceState`, `preparationReceipt`,
  `writeCapacityPolicy`, `xboxDiskLayoutPolicy`...).

**O pacote ativo em números** (`assets/badavatar-1.1.manifest.json`, lido com um script node):
- 643 arquivos e 724,1 MB. O estado de outro console são 26 arquivos e 0,5 MB, e depois do filtro
  ficam **617 arquivos e 723,5 MB**.
- Por tamanho: 321 arquivos com até 4 KB, 166 com até 64 KB, 88 com até 1 MB, 36 com até 16 MB e
  6 maiores que 16 MB (juntos, 524 MB). O tempo por arquivo pesa nos 487 pequenos; o volume de
  dados pesa em 6 arquivos.
- O perfil do exploit é **um arquivo** (`Content/E0002FF78DFBDE7B/...`, 0,3 MB).

**1. As duas bases**

| | (a) `src/android-app/` | (b) app novo mínimo |
|---|---|---|
| o que já tem | esqueleto Gradle que compila, serviço em primeiro plano, pedido de permissão | nada (copia o esqueleto Gradle de (a)) |
| lógica do preparo | **nenhuma**: o backend Go não tem nada do BadAvatar, e seria preciso portar o TS para Go | portar para Kotlin (o mesmo trabalho) |
| acesso ao pendrive | caminho bruto `/storage/<id>` com `MANAGE_EXTERNAL_STORAGE` | SAF, sem permissão especial |
| peso | +15,5 MB de binário Go, WebView, HTTP sem TLS no localhost, telas em HTML dentro do Go | uma activity |
| loja | `MANAGE_EXTERNAL_STORAGE` é restrita na Play Store (gerenciador de arquivos, backup, antivírus), e o app baixa jogos: dois motivos de recusa | nenhuma permissão restrita |
| economia | ~1 dia (esqueleto + serviço) | — |

**Recomendação: (b).** A base (a) não tem nada da parte cara, porque a lógica do preparo não existe
em Go. Partir dela traria a permissão que trava a loja e um produto que baixa jogos, o oposto de
"só o desbloqueio". De (a), aproveitar só o `build.gradle.kts` e o modelo do serviço em primeiro
plano. O veredito vem da leitura do código, que é pequeno o bastante para ler inteiro; o app não
foi executado em aparelho.

**Simplificação que muda a estimativa: gerar no PC, só copiar no celular.** Os três arquivos
gerados e o filtro do estado alheio não dependem do pendrive. Então o script que publica o
pacote no R2 roda no PC, chama as próprias funções TS (`generateAuroraReadyToPlayFilterLua`,
`generateReadyToPlayMarker`, `generateReadyToPlayLaunchIni`, `isForeignConsoleStatePath`) e
publica um **pacote mobile já final**, com manifesto próprio: SHA-256 de cada arquivo final
(inclusive os gerados), o `bundleSha256` de origem e a `READY_TO_PLAY_CONFIGURATION_VERSION`. O app
só copia e confere. Assim os arquivos saem iguais byte a byte por construção, sem porte manual,
e o app não carrega nenhuma regra que precise acompanhar o Companion.

**2. Lista de trabalho da v1 (base b)**

| # | item | complexidade | dias |
|---|---|---|---|
| 1 | esqueleto: módulo, `applicationId`, ícone, keystore de release | baixa | 0,5 |
| 2 | pacote mobile e publicação no R2 (R4): script node (manifesto ativo → tira o estado alheio → gera os 3 arquivos com as funções TS → manifesto mobile → zip → `rclone` + `.sha256`, como no `upload-r2.ps1`), passo novo em `docs/ATUALIZAR-PACOTE-BADAVATAR.md`, teste unitário "gerado == função TS" | média | 1,5 |
| 3 | download no app: HTTP com retomada (Range), conferir o `.sha256` do zip e o SHA de cada arquivo contra o manifesto mobile, serviço em primeiro plano para não parar com a tela apagada, avisos de Wi-Fi e de espaço no celular | média | 2 |
| 4 | acesso ao pendrive por SAF (R3): `StorageVolume.createOpenDocumentTreeIntent` (API 29+) e `ACTION_OPEN_DOCUMENT_TREE` (API 26–28); recusar pasta que não seja a raiz de um volume removível; guardar a permissão; o UUID do volume vira a impressão digital (estável entre conexões, muda ao formatar, que é o que a retomada precisa); espaço livre por `DocumentsContract.Root` | média | 2 |
| 5 | conferências antes de gravar: espaço com folga de cluster (versão curta de `assessWriteCapacity`; o SAF não informa o tamanho do cluster, então usar o pior caso do FAT32), sinal de FAT32 formatado pelo console (UUID no formato `XXXX-XXXX` e a pasta `Xbox360/` que o console cria) e o tratamento da `Xbox360/` (R1) | média | 1 |
| 6 | gravação com retomada, na versão simplificada (ver parte 3): ordem fixa, primeiro os arquivos comuns, depois os gerados e **por último o perfil do exploit**; cada arquivo vai para `.partial`, é relido e conferido em SHA-256 e então renomeado (`renameDocument`); a retomada pula o que já confere em tamanho e SHA; nomes comparados sem diferenciar maiúsculas (o FAT não diferencia e o SAF sim: uma pasta `AURORA` antiga viraria `Aurora (1)`) | alta | 3 |
| 7 | recibo `.xbox-downloader/preparo.json` com `mode: "bloqueado-lt"` e um campo opcional de origem (`"android"`), mantendo `schemaVersion: 1`; ajustar o tipo no TS | baixa | 0,5 |
| 8 | telas e textos para leigo: baixar → formatar no console (passo a passo com fotos) → plugar e escolher o pendrive → gravando ("não tire o pendrive") → pronto, e o que fazer no console; cada erro diz o que fazer; nenhum texto diz que o console foi desbloqueado. Fora do repo: o agente de suporte do WhatsApp passa a oferecer o app (bug de origem) | média | 3 |
| 9 | publicação como APK avulso: build assinado no R2 (`XBOX360Companion/...`) e um link para o suporte enviar | baixa | 0,5 |
| 10 | testes: unitários em Kotlin (manifesto, ordem de gravação, retomada sobre um sistema de arquivos falso), 1 d; teste de equivalência no PC, 1 d; tirar o pendrive no meio da gravação em 2 ou 3 celulares, 1 d | média | 3 |
| | **soma** | | **17** |
| | folga para diferenças entre aparelhos (SAF e OTG variam por fabricante) | | −2 a +5 |
| | **v1** | | **15 a 22** |

**3. O que fica fora da v1 e quanto economiza** (a lista acima já não inclui estes itens; o número
é quanto custaria colocá-los de volta)
- **Retomada transacional completa** (diário no pendrive, estados, backup do alvo; porte de ~970
  linhas de TS e de 3 arquivos de teste): +3 a 4 d. A versão simplificada cumpre o critério 3:
  como o perfil do exploit é gravado por último e `detectPreparedDeviceState` só responde
  "preparado" quando ele existe, um pendrive interrompido nunca parece pronto. Perde-se o "tudo ou
  nada" para arquivos que já existiam e foram substituídos, o que não pesa num pendrive recém-formatado
  pelo console.
- **Leitura do layout do disco (R2) por USB Host:** +4 a 6 d, mais risco de aparelho (tomar a
  interface USB desmonta o volume, e depois é preciso esperar ele voltar para gravar pelo SAF).
  Fica fora porque quem formatou foi o console: o layout é, por construção, um que o console lê.
  O `assessXboxLayout` existe por causa do formatador do PC.
- **Quarentena do estado de outro console no pendrive:** +1 d. Num pendrive formatado pelo console
  não há nada para tirar. O filtro (não gravar o estado alheio) continua, aplicado no PC ao publicar.
- **Portar `readyToPlayConfiguration.ts` para Kotlin:** +1 d, com risco de diferença de byte.
  Substituído pela geração no PC.
- **Play Store:** +3 a 5 d de trabalho (conta, ficha, política de privacidade, formulário de
  segurança de dados). Para conta pessoal nova, o Google exige um teste fechado de 14 dias com 12
  testadores antes de publicar (regra em vigor desde 2023–2024; confirmar na spec). São pelo menos
  2 semanas de calendário, com risco de recusa no fim.
- **Total que fica fora da v1:** 12 a 17 dias de trabalho, mais o calendário da loja.

**4. Riscos que mudam a estimativa**
- **R1, espaço depois do "Configurar agora".** Um pendrive de até 16 ou 32 GB fica inteiro
  reservado, então o mais provável é sobrar pouco ou nada. Em código, as duas saídas são baratas:
  o app apaga a `Xbox360/` com confirmação (+0,5 d), ou o texto manda usar "Personalizar" e deixar
  pelo menos 1 GB livre (+0,25 d, com mais chance de erro do leigo). O peso de verdade é a prova:
  só um console diz se o BadAvatar roda com a `Xbox360/` presente ou apagada. No pior caso, um
  ciclo a mais com console (dias de calendário, não de desenvolvimento). Também só o console prova
  que o Android monta o pendrive do jeito que o console o deixa; o risco é baixo (deve ser um FAT32
  comum), mas não está provado.
- **R3, desempenho do SAF.** Estimativa, não medida: 617 arquivos × 50 a 150 ms por arquivo dá 0,5
  a 1,5 min; 723 MB a 5 a 20 MB/s num pendrive USB 2.0 dá 0,6 a 2,5 min; reler para conferir, cerca
  de 0,5 min. **Total esperado: 2 a 5 min**, risco baixo para o prazo. O que pesa é a
  compatibilidade (aparelho que não monta OTG, `renameDocument` que falha), e isso já está na folga.
  Para a spec: a releitura logo depois de gravar pode vir do cache do Android e não do pendrive. A
  conferência que vale é a do PC (teste de equivalência).
- **R5, Play Store recusar.** Com APK avulso na v1, o prazo de desenvolvimento não muda. Muda o
  funil: o cliente precisa liberar "instalar apps desconhecidos", que é uma tela a mais de
  instrução, já contada no item 8. Se o dono quiser a loja: +3 a 5 d e pelo menos 14 dias de
  calendário, com chance de recusa depois disso.
- **Espaço no celular.** Baixar o zip exige ~730 MB livres no celular, e celular cheio é comum
  nesse público. A alternativa é baixar arquivo por arquivo do R2 direto para o pendrive: não
  ocupa o celular, mas o pendrive tem de ficar plugado durante o download. O custo é parecido;
  decidir na spec.

**5. Prova sem console**
- **Teste de equivalência no PC** (1 d, já no item 10): script node que recebe a letra do pendrive
  gravado pelo celular e confere (1) cada arquivo do manifesto mobile em tamanho e SHA-256, (2) os
  três arquivos gerados iguais à saída das funções de `readyToPlayConfiguration.ts` na versão
  atual, (3) nenhum arquivo do estado alheio, (4) `detectPreparedDeviceState` ===
  `"preparado-bloqueado-lt"`, (5) o recibo com a origem Android e, já que roda no Windows, (6)
  `assessXboxLayout` sobre o `readWindowsUsbDiskLayout`. Fecha os critérios 1, 2 e a parte de layout
  do 4 sem console.
- **Automação no emulador** (+1 a 1,5 d, opcional): o emulador Android tem cartão SD virtual que
  aparece como volume removível. Um teste instrumentado grava nele (o UIAutomator escolhe a pasta
  no seletor do SAF), `adb pull` copia o conteúdo e o mesmo script confere. Prova a cadeia inteira
  sem hardware, mas não substitui o pendrive real por OTG.
- **O que continua sem prova:** o estado inicial "formatado pelo console" é simulado (FAT32
  formatado no PC, mais uma pasta `Xbox360/` para ocupar espaço). O critério 5 só fecha com console.

**Hipóteses descartadas**
- Partir de (a) para economizar: a parte cara (o preparo) não existe no Go. A economia é de ~1 dia,
  e o custo é a permissão restrita, o binário de 15 MB e um produto de jogos.
- Embutir o pacote no APK, o que tiraria o item 3 (~1,5 d): o APK teria ~750 MB, cada troca de
  pacote exigiria um APK novo, e isso contraria o R4 (decidido: R2).
- Ler o layout por USB Host na v1: não ganha nada num disco que o console formatou (ver parte 3).

**Perguntas ao dono, só as que mudam o número**
1. Quem desenvolve: um agente escrevendo o código com o dono testando no celular, ou uma pessoa?
   Com agente, o código encolhe para poucos dias, e o gargalo passa a ser o teste em aparelho, que
   depende do dono.
2. Existe um celular Android com adaptador OTG e um pendrive para testes? Sem isso, os itens 4, 6
   e 10 não fecham.
3. v1 em APK avulso (recomendado) ou na Play Store? A loja soma 3 a 5 d e pelo menos 2 semanas.

**Respostas do dono (2026-10-11):** (1) quem escreve o código é um agente; (2) o dono tem celular
Android, adaptador OTG e pendrive para testes; (3) a v1 sai em APK avulso. A Play Store fica fora,
e o R5 vira só uma tela de instrução ("instalar apps desconhecidos"), já contada no item 8.

**Prazo refeito com essas respostas.** Os 15 a 22 dias valiam para uma pessoa. Com um agente, a
parte de código encolhe, e o prazo passa a depender das rodadas de teste do dono no celular:
- ~6 a 8 sessões de agente: teste rápido do SAF (1), pacote mobile e publicação no R2 (1), download,
  acesso ao pendrive e gravação com retomada (2 a 3), telas e textos (1), testes unitários e o
  teste de equivalência no PC (1 a 2);
- ~3 a 4 rodadas de teste do dono, de 30 a 60 min cada: o teste rápido do SAF, a primeira gravação
  completa, tirar o pendrive no meio, e um segundo celular, se houver;
- **calendário: ~1,5 a 2 semanas**, se o dono conseguir fazer uma rodada a cada 2 ou 3 dias. O
  critério 5 (console real, R1) continua fora desse prazo.

**Como o agente vê o celular com o pendrive plugado:** o celular tem uma porta só, e o OTG a ocupa.
Para o `adb` funcionar ao mesmo tempo, o caminho é a depuração por Wi-Fi (Android 11+: Opções do
desenvolvedor → Depuração por Wi-Fi → `adb pair <ip:porta>` e depois `adb connect`) ou um hub USB-C
que deixe passar dados. Em Android 10 ou anterior: `adb tcpip 5555` com o cabo, depois tirar o cabo
e plugar o OTG.

**Vale lançar o app reduzido antes do Companion Android completo? (pergunta do dono, 2026-10-11)**

Recomendação: **sim, com duas condições**, e corrigir o guia do agente **já**, independente do app.

- **Demanda medida** (bug de origem, seção "Evidencia"): 28 conversas de clientes do Xbox que
  escreveram "não tenho computador/PC" entre 2026-08-01 e 2026-10-07 (~3 por semana), e 46
  recusas do agente em 34 conversas. Pelo menos um pediu estorno por não ter PC (msg [24560]).
- **O guia está errado hoje, com ou sem app.** Ele diz "sem PC não tem como", mas o material da
  loja e o próprio dono ensinam o caminho manual pelo celular (Xploid, doc `1ig4bDek...`). Essa
  correção é a T2(c) do bug de origem, custa só texto e para a perda agora. Não depende do app.
- **O app reduzido não se joga fora.** O Companion Android completo vai precisar exatamente
  destas peças: acesso ao pendrive por SAF, download conferido do R2, gravação com retomada e o
  pacote mobile. O app reduzido é a primeira versão do completo, não um produto paralelo.
  **Condição 1:** nascer com o `applicationId`, o nome e a chave de assinatura definitivos do
  Companion Android, para que a versão completa chegue como atualização do mesmo APK (APK avulso
  só se atualiza por cima com o mesmo id e a mesma chave). Assim não há dois apps para manter nem
  cliente para migrar.
- **Custo:** 6 a 8 sessões de agente e ~1,5 a 2 semanas de calendário (ver "Prazo refeito").
  Contra o caminho manual (baixar um `.rar` de 12,2 GB, ~25 GB livres no celular, extrair com
  7Zipper, copiar), o app reduz o processo a quatro passos.
- **Condição 2 — o R1 não está provado.** Os primeiros clientes são o teste do console. O agente
  só oferece o app de forma ampla depois que um cliente acompanhado pelo suporte rodar o BadAvatar
  a partir de um pendrive feito só pelo app. Até lá, o app é oferecido como "novo, com
  acompanhamento", e o caminho manual fica no guia como plano B.
- **Quando não valeria:** se o Companion Android completo estivesse a menos de ~3 semanas de sair.
  Hoje não há plano dele no repo: o `src/android-app/` é o GODsend, de jogos, sem preparo. Se o
  dono tiver um prazo que eu não conheço, isso muda a conta.
- **Alternativa sem app próprio, a testar em paralelo** (bug de origem, opção 3): uma imagem `.img`
  gerada pela loja e gravada pelo EtchDroid, que já está na Play Store. Não precisa de app nem de
  formatar no console, mas a partição fica do tamanho da imagem, o que limita o espaço para jogos no
  mesmo pendrive, salvo se a hipótese de declarar uma partição maior passar no teste. Também
  depende de um app de terceiros.

**Próximo passo proposto, se o dono aprovar:** antes de fechar a spec, um teste rápido de 0,5 a 1
dia num celular real: gravar os 617 arquivos por SAF num pendrive, medir o tempo e testar
`renameDocument` e nomes com maiúsculas diferentes. É o que tira a maior incerteza de
desenvolvimento (R3). O R1 continua dependendo do console.

**Depois do T0, se o dono aprovar seguir — o que a spec precisa entregar:**
1. O QUE, em critérios EARS, cada um com a prova que roda. Partir dos 5 critérios de aceite
   acima. O critério 5 é o único que exige console.
2. R2/R3: o caminho de acesso ao USB no Android (SAF ou USB Host com escrita FAT32 própria),
   escolhido com os prós e contras escritos.
3. R4: o nome do objeto no R2, o formato e o passo de publicação.
4. R5: Play Store ou APK avulso, com o risco de política escrito.
5. Onde mora o código: um módulo novo neste repo (como o `src/android-app/`) ou um repo próprio;
   e como reaproveitar `readyToPlayConfiguration.ts` sem copiar à mão (os arquivos gerados têm
   de sair byte a byte iguais).
6. Tasks derivadas dos critérios, cada uma com o teste que a prova.

**Não fazer nesta etapa:** código, publicação no R2, pergunta ao dono sobre R4.

**Frase de abertura da próxima sessão** (T0 feito e respondido pelo dono): *"Leia 'T0 —
resultado' (inclusive 'Respostas do dono') e 'Depois do T0' em
`docs/backlog/app-android-preparador-pendrive-badavatar_2026-10-11.md` no repo
`C:\projects\Downloader-XBOX360-XEX-HDD-Games` e escreva a spec da v1: base (b), pacote mobile
gerado no PC, retomada simplificada, sem USB Host, APK avulso. O item 4 da spec (Play Store x APK)
já está decidido: APK."*
