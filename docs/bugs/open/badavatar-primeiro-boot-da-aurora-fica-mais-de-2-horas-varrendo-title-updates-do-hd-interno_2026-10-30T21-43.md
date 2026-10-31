# Bug: no primeiro boot pelo BadAvatar, a Aurora fica mais de 2 horas varrendo e copiando Title Updates do HD interno do console e nunca chega à lista de jogos

- **Detectado em:** 2026-10-30 21:43 (chamado #301 do painel, sessão `24816857956591@lid`, telefone `5512988862575`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/infrastructure/readyToPlayConfiguration.ts::generateAuroraReadyToPlayFilterLua` e de `docs/READY-TO-PLAY-AURORA.md` ("Arquivos do pacote que não são gravados")
- **Classe:** falha funcional (primeiro boot da Aurora não termina em tempo útil)
- **Severidade:** **P1 — Alto, provisório** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): bloqueio total da plataforma para este cliente — 12h30 → 21h36 (relato dele) sem jogar nenhum dos 5 jogos gravados; terminou em **pedido de reembolso** e ameaça de processo. Rebaixar para P2 se a passada 2 mostrar que é raro (console com muito conteúdo no HD interno)
- **Complexidade:** **desconhecida** — depende de a Aurora expor por `settings`/`Sql` uma opção para não varrer/copiar Title Updates no boot; nada disso foi verificado
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

## Tarefas propostas / Próximos passos

- [ ] **Passada 2 (console):** num console com TUs no `Hdd1`, primeiro boot da Aurora pelo pendrive do Companion; cronometrar a carga e ler o `settings.db` criado para achar a opção de TU (nome exato).
- [ ] Se a opção existir e for gravável por `Sql`: o hook `XboxCompanionReady.lua` desliga a varredura/backup de TU no boot (teste em `src/electron-app/tests/unit/readyToPlayConfiguration.test.cjs` conferindo a query gerada) — antes, provar no console que a mudança vale sem reinício extra.
- [ ] Mensagem na tela final do preparo (`BadAvatarUsbPage.tsx`): o primeiro boot pode demorar em console com muitos jogos instalados no HD — só depois de medido o tempo real.
- [ ] Pegar o print da pasta do pendrive que o operador pediu ao cliente do #301 (prova da hipótese 2).
