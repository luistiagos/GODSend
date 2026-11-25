# Bug: no primeiro boot depois do preparo, a Aurora abre e uns 2 minutos depois o console volta ao painel normal da Microsoft

- **Detectado em:** 2026-11-23 21:50 (chamado #434 do painel, sessão `260854989750300@lid`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/infrastructure/readyToPlayConfiguration.ts::restartOnce` e de `docs/READY-TO-PLAY-AURORA.md` ("Sequência no console", itens 5 e 6)
- **Classe:** falha funcional (ativação do BadAvatar), **passada 1** (causa não provada)
- **Severidade:** **P2 — Médio** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): a ativação acaba funcionando, mas custa ao cliente uma ou mais tentativas extras do exploit, e a queda para o painel normal parece com "o exploit não funciona". No #434 foram 3 tentativas e uma escalada para o suporte
- **Complexidade:** média. Prova barata pelo `debug.log` do pendrive; a correção (se for o reinício) mexe no hook do Aurora, que é P0 quando quebra (laço de reinício)
- **Reincidência:** primeira vez registrada. **Não é** [[badavatar-perfil-do-exploit-nao-aparece-na-tela-de-perfis_2026-09-23T15-20]] (lá a Aurora nunca abre) nem [[2026-09-05-fatal-crash-intercepted-pendrive-preparado]] (lá há o banner de crash e um laço; aqui é uma queda só, sem banner relatado)

## Sintoma, na ordem que o cliente viveu

Horários em UTC; ids `[n]` = `Wpp_proccess.id`.

1. Preparou um pendrive de 128 GB no Companion (provável 2.12.131, ver Evidência), baixou um jogo e levou o pendrive ao Xbox 360 travado na 17559, offline.
2. 20:01 `[196139]`: tela de logo e perfis. O agente mandou esperar sem entrar em nenhum perfil.
3. 20:02 `[196141]`: **"Aurora abriu"**.
4. 20:04 `[196143]`: **"Ele reiniciou sozinho"**. 20:05 `[196145]`: foto do painel normal (aba "início", "Conecte seu Xbox 360 à internet..."), sem Aurora.
5. 20:11 `[196148]`: segunda tentativa, **"Nada so fica ligado normal"**.
6. 20:31 `[196250]`: terceira tentativa, "Welcome to Aurora"; `[196259]` os jogos aparecem. Daí em diante o cliente jogou normalmente.

## Evidência

- Versão: o instalador foi baixado em 2026-11-22 22:22 UTC (`[195078]`), depois do commit da 2.12.131 (`376e011`, 2026-11-22 04:43 UTC). Sem print da versão.
- Raiz do pendrive `GAME (F:)` (`[196224]`): `.xbox-downloader`, `apps`, `Aurora`, `Content`, `games`, `lhelper.xex`, `UsbdSecPatch.xex`.
- Painel `2.0.17559.0` (`[196165]`); Armazenamento com "Dispositivo USB 107 GB livres" (`[196233]`).
- O intervalo entre "Aurora abriu" e "reiniciou sozinho" é de ~2 min (20:02:17 → 20:04:46, horários das mensagens, não do console).

## O que o código faz no primeiro boot (aberto, não suposição)

`readyToPlayConfiguration.ts`, Lua gerado em `XboxCompanionReady.lua`:

- `restartOnce(guardPath, deviceId, reason)`: grava `.xbox-downloader/ready-to-play-v7.restart` no pendrive, confere com `FileSystem.FileExists` e então chama `Aurora.Restart()`. Se a marca não ficar gravada, retorna sem reiniciar.
- `docs/READY-TO-PLAY-AURORA.md`, item 5: "Quando o banco muda, o hook grava `.xbox-downloader\ready-to-play-v7.restart` ... e só então reinicia o Aurora". Item 6: na segunda inicialização os caminhos já existem e não há novo reinício.

Num pendrive recém-preparado, o banco de `scanpaths` muda no primeiro boot. Então **o hook pede um `Aurora.Restart()` exatamente no primeiro boot**, e esse é o boot em que o cliente viu a queda. O desenho prevê que o Aurora volte sozinho; no #434 o console foi para o painel normal.

## Hipóteses — nenhuma verificada

1. **`Aurora.Restart()` sob BadAvatar não volta para a Aurora.** Num console RGH/JTAG o DashLaunch (`launch.ini`: `Default = Usb:\Aurora\default.xex`) devolve para a Aurora; num console travado ativado pelo BadUpdate, o reinício pode passar pelo painel padrão, e o exploit teria de ser disparado de novo. Bate com o momento (primeiro boot), com a queda única e com a terceira tentativa funcionando (o guard já existia, então sem reinício). **Falta medir.**
2. **Instabilidade do próprio BadUpdate** (o exploit cai depois de carregar). Explicaria a queda e também a segunda tentativa falha, sem relação com o hook.
3. O cliente apertou algo (botão guia → Xbox Home). Não há relato disso; menos provável, porque ele estava respondendo ao agente pelo celular.

## Como provar (barato, sem console nosso)

1. Pedir ao cliente do #434 o arquivo `Aurora\Data\Logs\debug.log` do pendrive (ou print da pasta `.xbox-downloader`):
   - `caminhos configurados; reiniciando Aurora.` logo antes do fim do log da primeira sessão ⇒ a queda coincide com o `Aurora.Restart()` (hipótese 1 ganha);
   - sem essa linha na primeira sessão ⇒ o hook não reiniciou, e a hipótese 1 cai.
   - `ready-to-play-v7.restart` presente ou ausente na `.xbox-downloader` hoje mostra se o segundo boot com Aurora chegou ao trecho que apaga a marca.
2. Em console travado de teste: preparar, ligar e cronometrar o primeiro boot; ver se ao `Aurora.Restart()` a tela vai para o painel normal.

## Escopo — o que NÃO é este bug

- O perfil `ABadAvatar` ausente (doc irmão): aqui o exploit disparou duas vezes em três.
- O resumo da escalada que afirma "perfil ABadAvatar não aparece" sem o cliente ter dito: é do agente de WhatsApp (`digitalstoregamesproject`), não deste repo.

## Tarefas propostas / Próximos passos

1. Coletar o `debug.log` (item 1 acima). É o que decide entre as hipóteses.
2. Se a hipótese 1 for confirmada: decidir entre (a) não reiniciar sob BadAvatar e pedir ao Content Manager um novo scan sem reiniciar, ou (b) manter o reinício e avisar na tela de "Pendrive pronto" e no guia do agente que o primeiro boot volta ao painel uma vez e é preciso repetir a ativação. Qualquer mudança no hook precisa do teste de laço de `READY-TO-PLAY-AURORA.md` (itens 5 a 7 do roteiro).
3. Enquanto isso, a KB do agente pode dizer que, se a Aurora abrir e o console voltar ao painel no primeiro boot, basta desligar e repetir a ativação (é o que o cliente fez, e funcionou).
