# Backlog: app Android que só prepara o pendrive BadAvatar

- **Estado:** backlog (não iniciado)
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
- **R4. Distribuição do pacote (726 MB).** Hoje o pacote só existe embutido no instalador de
  Windows (`docs/ATUALIZAR-PACOTE-BADAVATAR.md`) e não tem URL pública. O app precisa dele
  embutido (conferir o limite de tamanho da Play Store e o Play Asset Delivery) ou baixado de um
  repositório com o catálogo SHA-256. A segunda opção pede publicar a mesma versão do manifesto.
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
Antes, responder R1 (sem console isso depende de uma ajuda de campo) e R4.
