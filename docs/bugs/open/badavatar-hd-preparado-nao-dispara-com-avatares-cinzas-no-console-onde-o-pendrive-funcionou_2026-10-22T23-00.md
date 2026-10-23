# Bug: HD preparado pelo Companion não dispara o BadAvatar, com os avatares cinzas, no mesmo console LT em que o pendrive preparado funcionou 5 dias antes, e reaplicar a 17559 não resolve

- **Detectado em:** 2026-10-22 23:00 (chamado **#254** do painel, sessão `268796283584649@lid`, telefone `555185707025`)
- **Origem:** conversa de suporte, lida inteira (54 mensagens, de 17/10 00:11 a 23/10 01:44 UTC), mais a telemetria
  `errors` da mesma máquina (`Users\PNA-USER`, `ElectronApp v2.12.110`)
- **Errors (serviço):** N/A. O preparo do HD **terminou sem erro**: não há falha de preparo dessa máquina entre
  22/10 18:00 e 23/10 01:00. A única falha da noite é `11367` (23/10 01:02), num pendrive. Ver "Evidência".
- **Classe:** fail (o exploit não dispara) + diagnóstico (nem o app nem o guia explicam o caso)
- **Severidade:** **P1 — Alto** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): bloqueio total
  do HD que o cliente comprou para os jogos. O pendrive de 17/10 continua sendo a única coisa que funcionou.
- **Complexidade:** desconhecida; a causa não foi provada
- **Reincidência:** primeira vez registrado **nesta forma**. Avatares cinzas em geral são recorrentes (dezenas de
  relatos em `Wpp_proccess`, de jul a out/2026), e a KB trata o caso como "falta a atualização". O que é novo
  aqui é o console que **já tinha disparado o exploit**. Não é
  [[badavatar-perfil-do-exploit-nao-aparece-na-tela-de-perfis_2026-09-23T15-20]], porque aqui o `ABadAvatar`
  aparece na lista, nem
  [[badavatar-hd-preparado-em-modo-bloqueado-acusado-como-rgh-depois-de-usado-no-console_2026-10-21T17-49]],
  porque aqui o perfil está no HD.

## Sintoma, na ordem que o cliente viveu (UTC)

1. **17/10:** console LT em 17349. Atualizou para a 17559 com `$SystemUpdate` (`[145371]` *"Feito"*) e preparou um
   **pendrive** (Kingston DataTraveler SE9) no Companion. O formatador do app falhou (ver "Escopo"), e o cliente
   formatou com outro aplicativo. Às 00:58 o pendrive estava pronto (`[145410]`). Às 01:01, `[145419]`
   *"Funcionou"*: a Aurora abriu pelo exploit.
2. **22/10 20:27 `[151466]`:** *"Comprei um HD pra por os jogos, formatei e instalei tudo lá pelo app só que não sai
   da tela de login no xbox"*.
3. **20:29 `[151475]`** (print): tela "entrar ou sair" com os perfis `ABadAvatar` e `gui`, **os dois com avatar
   cinza** (silhuetas sem rosto). **20:30 `[151478]`:** *"Se eu entro, nos jogos não aparece o aurora"*.
4. **20:38 `[151496]`** (print): *"já está na versão certa"*, `Menu Xbox: 2.0.17559.0`.
5. Seguindo o guia, montou o pendrive com `$SystemUpdate` (`[151500]`: print do Explorer com `AvatarEditor.xex`,
   `dashnui.xex`…). **20:41 `[151498]`:** *"Quando coloco o pen drive e ligo não aparece a atualização"*. Repetiu
   nas 3 portas USB (`[151518]`), conferiu FAT32 (`[151524]`) e trocou de pendrive (`[151958]`), sem resultado.
6. **01:11 `[151976]`:** *"se o Xbox já estiver atualizado e identificar a mesma versão no pendrive ele vai
   ignorar"*. **01:35 `[152011]`:** *"eu consegui atualizar de novo, mas não mudou nada"*.
7. **01:44 `[152015]`:** em Armazenamento, o HD aparece como *"Dispositivo USB"*.

## Evidência

- O console tem os dados de avatar, ou os teve: o exploit disparou em 17/10 01:01, e o exploit depende deles
  (KB `SUPPORT_AGENT_KB.md:169`; guia do agente `fragments/guias/xbox360_badavatar.md`).
- Cinco dias depois, no mesmo console e na mesma 17559, **todos** os perfis aparecem cinzas, inclusive o pessoal
  (`gui`), e não só o `ABadAvatar`. O sintoma é do console inteiro, não do perfil do exploit.
- O HD é lido pelo console: o `ABadAvatar` está na lista de perfis, e o HD aparece em Armazenamento como
  "Dispositivo USB".
- O app **não** mexe em dados de avatar do console. O `grep` de `FFFE07D1`/`avatar` em
  `src/electron-app/services`, `src/electron-app/infrastructure` e `src/server` só acha o backup de perfil
  (`src/server/services/saves/saves.go`). Logo, nenhum caminho do preparo grava ou apaga avatar.
- O guia do agente afirma: *"Se o pendrive anterior funcionava neste console, o dado de avatar também já estava
  lá"* (`fragments/guias/xbox360_badavatar.md`, seção dos avatares cinzas). Este caso mostra que isso **não
  garante** que o dado continue visível depois.
- Telemetria da máquina na noite de 22/10: avisos de enumeração USB (`11349`, `11356`, `11358`, `11359`, `11366`),
  um preparo BadAvatar falho num **segundo** Kingston às 01:02 (`11367`, o `Set-Partition` do bug em retest) e,
  às 01:02:50, `11368` *"O dispositivo mudou desde a seleção"*. Não há falha do preparo do HD.

## Hipóteses — nenhuma verificada

- **H1 — o dado de avatar estava num dispositivo removível que não está mais ligado.** Por exemplo: na 17/10 a
  atualização gravou o dado de avatar no armazenamento USB que estava conectado, e esse armazenamento não está no
  console agora (o HD entrou no lugar do pendrive). Isso explicaria por que **todos** os perfis ficaram cinzas, e
  por que reaplicar a mesma 17559 não oferece nada (o console já está na versão). **Não verificado:** onde o
  Xbox 360 guarda o pacote de avatar num console sem HD interno. Teste barato no cliente: ligar o console **só
  com o pendrive de 17/10** e ver se os avatares voltam coloridos. Depois, ligar **HD + pendrive juntos**.
- **H2 — o console tem HD/memória interna e o dado sumiu dali.** Teste: modelo do console e Armazenamento com
  nada espetado.
- **H3 — algo no HD preparado impede a carga dos avatares.** Fraca: o perfil pessoal `gui` não está no HD e
  também está cinza. Teste: H1 com o HD desligado.

## Escopo — o que NÃO é este bug

- A falha do formatador em 17/10 (*"Set-Partition : Not Supported"*), que levou o cliente a formatar em outro
  aplicativo, é evidência anexada ao bug em retest
  [`../retest/badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09.md`](../retest/badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09.md).
- As respostas do agente de WhatsApp: as promessas de suporte sem humano foram anexadas ao bug do
  `digitalstoregamesproject` `docs/modules/chatbot-whatsapp/areas/estado-handoff/bugs/2026-09-14-promessa-de-atendente-sem-lastro-depois-que-o-pino-e-liberado.md`.
  O agente seguiu o guia: o roteiro de reaplicar a 17559 é o "Como resolver" dos avatares cinzas. O guia é que
  não cobre o caso, e ele só pode ser corrigido depois que a causa for conhecida.

## Tarefas propostas / Próximos passos

1. **Suporte (humano), com o cliente:** rodar o teste de H1 (pendrive de 17/10 sozinho; depois junto com o HD) e
   perguntar o modelo do console e se ele tem HD interno. Esse resultado decide entre H1, H2 e H3.
2. Com a causa provada, escrever a causa raiz neste doc e decidir o que muda:
   - no app (aviso no preparo de HD para console sem HD interno, se H1);
   - na KB (`docs/SUPPORT_AGENT_KB.md`, `docs/BASE_CONHECIMENTO_SUPORTE_WHATSAPP.md`);
   - no guia do agente (moratória de prompts do `digitalstoregamesproject`: doc + eval + aprovação do dono).
