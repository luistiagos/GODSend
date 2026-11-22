# Bug: Usuario RGH com pendrive ja preparado cai no "Modo de Instalacao" e "Verificar pendrive preparado novamente" exibe aviso alarmante voltado apenas a Xbox Bloqueado/LT

- **Detectado em:** 2026-11-18 09:15 (chamado #286 do painel, sessao `144384049869026@lid`, `allyssonbastos@gmail.com`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/renderer/components/HomePage.tsx` (`checkPreparedDevice`, passo `unlock`), `src/electron-app/services/preparedUsbDetection.ts` (`canSkipPreparation`, `nextStepAfterPreparedUsbScan`) e `src/electron-app/services/preparedDeviceCopy.ts` (`PREPARED_DEVICE_NOTICE`)
- **Errors (serviço):** N/A (fluxo de UI / estado de wizard sem excecao reportada na telemetria)
- **Classe:** ux / fail (induz o usuario RGH e o suporte a acreditar que o pendrive esta errado/incompleto e a repreparar/reconfirmar desbloqueio repetidamente)
- **Severidade:** **P2 — Medio** (matriz de `bug-triage.md`: bloqueio de UX com contorno manual — selecionar `Xbox Desbloqueado RGH` e clicar em `Avancar` — mas induziu confusao recorrente em 6 dias distintos na conversa `#286`)
- **Complexidade:** **baixa** (`docs/bugs/open/README.md` — texto/mensagem na UI em `preparedDeviceCopy.ts` e estado simples/persistencia de preferencia em `HomePage.tsx`)
- **Versões:** observado em `v2.12.118` (`2026-10-29`), `v2.12.120` (`2026-10-30`), `v2.12.123` (`2026-11-01`) e `v2.12.128` (`2026-11-10`); codigo identico no `HEAD` atual (`v2.12.130`)
- **Reincidência:** desdobramento do fluxo introduzido em [[badavatar-usb-service-declara-ja-preparado-sem-conferir-o-perfil-do-exploit_2026-09-23T14-08]] (fechado — que passou a exigir declaracao do modo RGH no wizard para nao deixar console travado/LT pular a preparacao)

## Sintoma

Cliente com Xbox 360 **RGH** ja havia preparado o pendrive `BADAVATAR (F:)` em modo RGH (`launch.ini`, `Aurora`, `Games`, `.xbox-downloader` presentes). A cada abertura do Xbox 360 Companion com o pendrive conectado, o app abria na tela **Modo de Instalacao** (`Xbox Bloqueado ou LT` / `Xbox Desbloqueado RGH`) em vez da tela de pendrive preparado (`Ver Jogos Instalados` / `Ir para o catalogo de jogos`):

- Em `2026-10-29` (`v2.12.118`, `[159450]` audio): *"Toda vez eu vou ter que fazer esse processo tudo de novo... ele nao vai direto mais para o programa, ele vai como se fosse a inicializacao"* (`[159407]`).
- Em `2026-10-30` (`v2.12.120`, `[160530]`): *"Atualizei e abriu modo instalacao"*. Ao clicar no link **"Verificar pendrive preparado novamente"** (`[160536]`), apareceu o aviso em ambar:
  > *"Este pendrive tem a Aurora para console RGH, mas nao tem o perfil do exploit (ABadAvatar). Se o seu Xbox e travado ou LT, prepare de novo escolhendo "Xbox Bloqueado ou LT"."*
- O aviso nao instrui o que um dono de **RGH** deve fazer e soa como erro de preparo: tanto o cliente (`[160536]`, `[162079]` *"Dessa tela qual o procedimento para ver os jogos?"*, `[162156]`, `[162162]` *"Se isso apareceu, o pendrive esta preparado, correto?"*) quanto o agente (`[160538]`, `[162080]`, `[162160]`) entraram em loop de revalidacao do desbloqueio (inclusive refazendo teste de `XeLL` pelo `Eject`) e orientacao para nao formatar sem querer.
- O sintoma persistiu em `v2.12.123` (`[163582]`–`[163584]`: *"Normalmente e dessa forma que ele vai para a pagina principal"*) e em `v2.12.128` (`[174890]`, `2026-11-10`).

## Evidência

- **Conversa (`Wpp_proccess`, sessao `144384049869026@lid`):** `[159384]`, `[159395]`, `[159407]`, `[159450]`, `[159484]`, `[159535]`, `[160530]`, `[160536]`, `[162079]`, `[162156]`, `[162162]`, `[163582]`, `[163584]`, `[171803]`, `[174890]`.
- **Codigo lido (`HEAD` `v2.12.130`):**
  - `src/electron-app/services/preparedUsbDetection.ts::canSkipPreparation` (L61-67) e `nextStepAfterPreparedUsbScan` (L74-87).
  - `src/electron-app/renderer/components/HomePage.tsx::checkPreparedDevice` (L111-158) e render do passo `"unlock"` (L530-638).
  - `src/electron-app/services/preparedDeviceCopy.ts::PREPARED_DEVICE_NOTICE` (L15-20) e `SKIP_SCREEN_TEXT` (L37-46).

## Causa raiz

Confirmada nos simbolos abertos:

1. **`PREPARED_DEVICE_NOTICE["preparado-rgh"]` (`preparedDeviceCopy.ts:18`) omite a acao do usuario RGH:** quando o cliente clica em **"Verificar pendrive preparado novamente"** (`HomePage.tsx:621-624`, `checkPreparedDevice(true)`), `canSkipPreparation("preparado-rgh")` (chamado em `L138` sem `declaredRghConsole`) devolve `false` e o bloco `else if (manual)` (`L145-147`) exibe:
   `"Este pendrive tem a Aurora para console RGH, mas não tem o perfil do exploit (ABadAvatar). Se o seu Xbox é travado ou LT, prepare de novo escolhendo “Xbox Bloqueado ou LT”."`
   O texto em ambar trata apenas o caso negativo (console travado/LT precisa refazer) e **nao diz** que, em console RGH, o pendrive ja esta pronto e basta selecionar **"Xbox Desbloqueado RGH"** e clicar em **"Avançar"** para abrir a tela `prepared-detected` (`HomePage.tsx:606-610`).
2. **`HomePage.tsx` nao persiste a declaracao de console RGH (`selectedUnlockMode`) entre sessoes:** `selectedUnlockMode` nasce sempre `null` (`HomePage.tsx:85`) e `checkPreparedDevice` na montagem (`L133-137`) chama `nextStepAfterPreparedUsbScan("checking-prepared", "preparado-rgh", false)`, que ignora `selectedUnlockMode` e força `wizardStep = "unlock"` em toda reabertura do app — mesmo existindo `SKIP_SCREEN_TEXT["preparado-rgh"]` (`preparedDeviceCopy.ts:42-45`).

## Como reproduzir

1. Preparar um pendrive FAT32 em modo **Xbox Desbloqueado RGH** (cria `Aurora/default.xex`, `launch.ini` e `.xbox-downloader/ready-to-play-v5.marker`, sem o perfil `ABadAvatar`).
2. Fechar e reabrir o Xbox 360 Companion com esse pendrive conectado.
3. Observar que o app abre em **Modo de Instalacao** (`unlock`) em vez de **Pendrive preparado para console RGH!** (`prepared-detected`).
4. Clicar em **"Verificar pendrive preparado novamente"** → o aviso em ambar informa apenas que nao tem o perfil do exploit e manda Bloqueado/LT preparar de novo, sem orientar o usuario RGH a selecionar **Xbox Desbloqueado RGH** e clicar em **Avançar**.

## Escopo — o que NAO e este bug

- **Nao** reverter a protecao de `badavatar-usb-service-declara-ja-preparado-sem-conferir-o-perfil-do-exploit_2026-09-23T14-08`: um console Bloqueado/LT conectado com pendrive preparado apenas para RGH continua nao podendo pular automaticamente na primeira vez sem que o usuario tenha declarado console RGH.
- As pastas vazias (`0 bytes`) no 2o pendrive do chamado `#286` (e os erros posteriores na Aurora) sao problema separado do dispositivo USB do cliente, nao deste fluxo de UI.

## Resolução (v2.12.131 / Unreleased)

1. **`preparedDeviceCopy.ts` (`PREPARED_DEVICE_NOTICE["preparado-rgh"]`):** atualizado para orientar explicitamente usuários RGH (*"Pendrive preparado para console RGH detectado. Se o seu Xbox é RGH, selecione “Xbox Desbloqueado RGH” acima e clique em “Avançar” para ir aos jogos."*) mantendo o aviso de ausência do perfil do exploit e instrução de repreparo para Xbox travado ou LT (*"Se o seu Xbox é travado ou LT, ele não tem o perfil do exploit (ABadAvatar) — prepare de novo escolhendo “Xbox Bloqueado ou LT”."*).
2. **`preparedUsbDetection.ts`, `HomePage.tsx` e `BadAvatarUsbPage.tsx`:** adicionados `readPersistedRghDeclaration` / `writePersistedRghDeclaration` (`godsend.declaredRghConsole` em `localStorage`) e parâmetro opcional `declaredRghConsole` em `nextStepAfterPreparedUsbScan`. A confirmação explícita em **"Avançar"** grava `true` para RGH (e limpa ao confirmar **"Xbox Bloqueado ou LT"**). Na reabertura ou retorno à Home com pendrive `preparado-rgh` conectado, quem já declarou RGH vai direto para `prepared-detected`; quem nunca declarou (incluindo consoles travados/LT no primeiro uso) continua caindo em `unlock` sem pular a verificação. Em `HomePage.tsx`, `detectedGamesCount` também é atualizado via `useEffect` ao entrar em `prepared-detected` e o botão **"Voltar"** da tela `unlock` limpa `preparedDetectionDismissed`.

## Testes Automatizados

- `src/electron-app/tests/unit/preparedDeviceCopy.test.cjs`: verifica a presença das orientações para RGH (`Xbox Desbloqueado RGH`, `Avançar`), o aviso de ausência do perfil do exploit (`não tem o perfil do exploit`) e a instrução para travado/LT (`Xbox Bloqueado ou LT`), preservando a regra negativa de não afirmar desbloqueio BadAvatar.
- `src/electron-app/tests/unit/preparedUsbDetection.test.cjs`: cobre `nextStepAfterPreparedUsbScan` com `declaredRghConsole` (`true`, `false`, `detectionDismissed`, e bloqueio para `jogos-apenas`) e `readPersistedRghDeclaration` / `writePersistedRghDeclaration` (incluindo armazenamento ausente ou com erro).
- `npm run test:safety --prefix src/electron-app` (TypeScript main + renderer + suíte unitária completa).

## Critérios para fechar

- [x] Texto de `PREPARED_DEVICE_NOTICE["preparado-rgh"]` atualizado orientando o usuario RGH a selecionar `Xbox Desbloqueado RGH` e clicar em `Avançar`, mantendo o alerta para Bloqueado/LT
- [x] UX de reabertura para RGH declarada avaliada/ajustada sem quebrar a protecao contra skip indevido em Bloqueado/LT
- [x] `npm run test:safety --prefix src/electron-app` aprovado
- [ ] Validação em campo / versão publicada (movido para `docs/bugs/retest/`)
