# Bug: Jogos pesados (`GTA V`, `Red Dead Redemption`) fecham com `"fatal interceptor crash"` em HD externo preparado no BadAvatar (jogos leves abrem)

- **Detectado em:** 2026-11-17 22:26 (triagem do chamado `#254` do painel, sessao `268796283584649@lid`, `guilhermeportoexpress@gmail.com`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/infrastructure/readyToPlayConfiguration.ts::generateReadyToPlayLaunchIni` e `src/electron-app/infrastructure/consoleCrashArtifacts.ts`
- **Errors (serviço):** N/A para o crash em jogo (`crashlog.txt` nao chegou a telemetria `errors`; versao do cliente provada na `v2.12.110` em `2026-10-23T01:02:32` pelo erro `11367`, `Users\PNA-USER`)
- **Classe:** crash (excecao fatal no console durante execucao de jogos pesados)
- **Severidade:** **P1 — Alto** (provisoria — bloqueia os principais titulos do cliente em HD externo onde jogos leves funcionam)
- **Complexidade:** alta (crash em runtime no console sem dump `crashlog.txt` capturado)
- **Versões:** `v2.12.110` comprovada em `2026-10-23` (anterior ao pacote `badavatar-1.3` e anterior aos fixes de CHKDSK/backup da `v2.12.128`)
- **Reincidência:** distinto de [[2026-09-05-fatal-crash-intercepted-pendrive-preparado]] (fechado — crash no **boot/insercao** do pendrive, mitigado ate a `v2.12.96`, ja presente na `v2.12.110`) e distinto de [[badavatar-fatal-crash-no-meio-do-jogo-deixa-o-pendrive-ilegivel-e-leva-perfil-e-saves_2026-10-20T13-28]] (em `retest/` — corrupcao que deixa o dispositivo **ilegivel** no Xbox e PC).

## Sintoma, na ordem que o cliente viveu (UTC)

1. **2026-10-17:** cliente (`Xbox 360 LT`) atualizou para dashboard `17559` e ativou BadAvatar com sucesso em pendrive (`[145419]`).
2. **2026-10-22–23:** comprou HD externo, enfrentou falha de avatares cinzas ao trocar do pendrive para o HD (caso ja registrado em [[badavatar-hd-preparado-nao-dispara-com-avatares-cinzas-no-console-onde-o-pendrive-funcionou_2026-10-22T23-00]]), e em **23/10 18:16 (`[152869]`)** o HD funcionou e entrou na Aurora.
3. **2026-10-23 18:17 (`[152871]`, `[152873]`):** logo apos funcionar, relatou: *"Mas alguns jogos fecham com a mensagem: fatal interceptor crash"* — *"GTA V"*.
4. **2026-10-23 23:53–24/10 03:34 (`[153233]`–`[153560]`):** baixou a versao em 2 discos; travou na fila (`[153235]` *"Aguardando a tarefa anterior liberar o armazenamento temporário..."* com 168 GB livres no C:) e deu *"Não foi possível iniciar o jogo"* (`[153560]`) enquanto o Disc 2 ainda estava em 0% (`[155781]`).
5. **2026-10-27 02:29–03:03 (`[156115]`–`[156138]`):**
   - Print de `Jogos Instalados` (`[156115]`): lista 8 jogos no HD, incluindo **duas versoes de GTA V** (`Assassin's Creed IV Black Flag PT`, `Batman Arkham City PT BR`, 2x `GTA V`, `Harry Potter & The Deathly Hall`, `LEGO Harry Potter`, `Minecraft (0.2)`, `Toy Story 3`).
   - Prints do Explorador de Arquivos (`[156129]`, `[156132]`, `[156134]`): `BADAVATAR (D:)\games\GTA V - 545408A7\00007000\79E465C5` (+ `.data`) e `BADAVATAR (D:)\Content\0000000000000000\545408A7\00000002\` com os 4 arquivos `545408A700000000` a `545408A700000003`.
   - Mesmo com os arquivos presentes no HD, o cliente informou em audio (`[156136]`): *"Jogos... Leves estão abrindo, mas pesados não. Red Dead Redemption eu instalei, não funcionou, eu tive que desinstalar e tentar de novo... nao está funcionando"* e confirmou a mensagem (`[156138]`): *"fatal interceptor crash"*.

## Evidência

- **Conversa (`Wpp_proccess`, sessao `268796283584649@lid`):** `[152871]`, `[152873]`, `[156115]`, `[156129]`, `[156132]`, `[156134]`, `[156136]`, `[156138]`.
- **Telemetria (`errors`):** `11367` (`2026-10-23T01:02:32`, `ElectronApp v2.12.110`, `Users\PNA-USER`). Nao ha captura de `crashlog.txt` desse cliente em `errors` (`badavatar-console-crash` so envia na proxima preparacao do dispositivo no Companion).
- **Codigo lido:**
  - `src/electron-app/infrastructure/readyToPlayConfiguration.ts::generateReadyToPlayLaunchIni`: o `launch.ini` gravado pela `v2.12.110` ja inclui `Dumpfile = Usb:\crashlog.txt` (desde `v2.12.68`), que registra excecoes interceptadas pelo `exchandler` do DashLaunch (`Fatal Crash Intercepted!`).
  - `src/electron-app/infrastructure/consoleCrashArtifacts.ts`: recolhe `crashlog.txt` da raiz e logs da Aurora apenas no inicio de um novo preparo em `prepareFixedBadAvatarDevice`.

## Hipóteses — nenhuma verificada

Sem o `crashlog.txt` da raiz do HD externo do cliente (ou logs da Aurora na epoca do crash), nao ha como provar a causa raiz:

1. **H1 — Corrupcao silenciosa/parcial no FAT32 do HD ou gravacao incompleta na `v2.12.110`:** o cliente ja havia enfrentado falhas na fila (`[153235]`) e possuia duas versoes de GTA V instaladas simultaneamente (`[156115]`); a `v2.12.110` era anterior a verificacao de volume sujo / `CHKDSK` da `v2.12.128` (`badavatar-fatal-crash-no-meio-do-jogo...`).
2. **H2 — Instabilidade de I/O ou do payload `badavatar-1.1` em HD externo mecanico durante streaming pesado:** jogos pesados (`GTA V`, `Red Dead Redemption`) fazem leitura continua intensa via USB, onde o payload `badavatar-1.1` / `UsbdSecPatch` ou alimentacao USB do HD externo pode falhar e disparar excecao interceptada pelo DashLaunch.
3. **H3 — Conflito de instalacao/versao no GTA V (`[156115]`):** presenca de duas entradas de GTA V no HD (`Jogos Instalados`), embora isso sozinho nao explique o mesmo `fatal interceptor crash` no `Red Dead Redemption` (`[156136]`).

## Escopo — o que NAO e este bug

- A falha de avatares cinzas ao trocar pendrive pelo HD na mesma sessao `#254`: ja registrada em `docs/bugs/retest/badavatar-hd-preparado-nao-dispara-com-avatares-cinzas-no-console-onde-o-pendrive-funcionou_2026-10-22T23-00.md` e tratada pela atualizacao `badavatar-1.3` (`badavatar-atualizar-pacote-para-versao-estavel-com-suporte-otimizado-a-hd-externo_2026-11-06T18-10.md`).
- A falha de `Set-Partition -MbrType 12` de 17/10 na mesma sessao `#254`: ja anexada a `docs/bugs/retest/badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09.md`.

## Tarefas propostas / Próximos passos

1. **Suporte (com o cliente):** pedir o arquivo `crashlog.txt` da raiz do HD externo (e o print de `Aurora/Data/Logs/`), alem de verificar se o problema persiste apos atualizar o Companion para `>= 2.12.128` (com `badavatar-1.3` + diagnostico `CHKDSK`).
2. Com o `crashlog.txt` em maos, identificar modulo/endereco da excecao e atualizar este doc com a causa raiz.

## Critérios para fechar

- [ ] `crashlog.txt` coletado ou reproducao obtida em versao `>= 2.12.128` (`badavatar-1.3`)
- [ ] Causa raiz isolada e corrigida (se defeito do app/payload) ou descartada com prova
