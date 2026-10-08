# Bug: "o Xbox Companion não quer abrir, a tela fica branca" com o app já aberto e baixando, e o log não tem nada do renderer para diagnosticar

- **Detectado em:** 2026-10-07 21:48 (chamado #157 do painel, sessão `255490944716923@lid`, telefone `5511964233557`; telemetria `9541`, host `DESKTOP-1HAMO38`)
- **Origem:** conversa de suporte + log anexo do report `9541` + leitura de `src/electron-app/app/bootstrap.ts::bootstrapApp` (handler `second-instance`) e `infrastructure/electronTray.ts::createTray`
- **Classe:** diagnóstico (falta de telemetria) + falha funcional não reproduzida
- **Severidade:** **P2 - Médio**: o cliente não conseguiu usar o app por ~15 min. Ele fechou pela bandeja, reabriu duas vezes e na segunda funcionou. Sem log do renderer, cada nova ocorrência vai custar o mesmo diagnóstico às cegas
- **Complexidade:** baixa para a telemetria (dois handlers de `webContents`), desconhecida para a causa
- **Versões:** 2.12.107 (portátil, `execPath` em `%TEMP%\nsc78F7.tmp\app\Xbox360Companion.exe`)
- **Reincidência:** primeira vez que o sintoma é "tela branca". Não é o "não abre" de [[release-portable-extrai-1-35-gb-no-temp-em-silencio-e-nao-abre-sem-avisar-o-motivo_2026-10-06T22-40]]: lá não aparece janela nenhuma; aqui a janela aparece e fica branca

## Sintoma, na ordem que o cliente viveu

Horas em UTC.

1. 21:32:33 [134420]: *"Quando eu abri o xboxcom panion ele já me jogo prós jogos"*. A janela funcionava.
2. 21:48:19 [134442]: *"O Xbox companion não quer abrir, a tela fica branca"*.
3. O agente mandou fechar pela bandeja e reabrir ([134443]). O app recebeu `before-quit` em
   22:01:04. A instância de 22:06:53 (pid 1244) fechou 25 s depois (22:07:18), e a de
   22:12:08 (pid 9420) funcionou: o cliente usou o catálogo e baixou GTA SA HD e Farming Simulator.

## Evidência

Log `9541` (`python telemetria.py logs 9541`), canais presentes: `APP_USB` 979 linhas,
`APP_BROWSE` 63, `ELECTRON_UI` 27, `APP_LIFECYCLE` 9, `APP_BACKEND` 6, `APP_BADAVATAR` 1.
**Nenhuma linha do renderer.** Os eventos de ciclo de vida do processo que estava aberto (pid 4108,
iniciado ~20:1x e baixando o PES):

```
21:34:59.900Z pid=4108 APP_LIFECYCLE second-instance event received; restoring and focusing window
21:40:40.914Z pid=4108 APP_LIFECYCLE second-instance event received; restoring and focusing window
21:54:23.180Z pid=4108 APP_LIFECYCLE second-instance event received; restoring and focusing window
22:01:04.429Z pid=4108 APP_LIFECYCLE application before-quit
```

- O cliente clicou de novo no `xboxcompanion.exe` com o app já aberto. Cada clique passa pelo stub
  portátil e cai no `second-instance` da instância viva, que só chama `focusMainWindow()`
  (`bootstrap.ts:147-150`). A janela que ficou branca é a da instância **pid 4108**.
- O processo principal estava vivo e respondendo: `APP_BROWSE varredura de jogos instalados` em
  21:44:48 (1,8 s) e o backend baixando a 2,8 MB/s até 21:55. **Não há como saber pelo log se o
  renderer travou, caiu ou só não pintou.**
- `grep -rn "render-process-gone\|'unresponsive'\|did-fail-load" src/electron-app --include=*.ts`
  (fora de `node_modules`) não acha nada. **O app não registra queda nem travamento do renderer.**

## Hipóteses — nenhuma verificada

1. **Renderer caiu (`render-process-gone`)** e a janela restaurada ficou sem conteúdo. Sem o
   handler, isso não deixa rastro.
2. **Renderer travado (`unresponsive`)** por alguma rotina pesada na UI, numa máquina lenta.
   Varreduras do processo principal levaram 25-35 s entre 21:58 e 22:00, com o pendrive fora.
3. **Janela restaurada de minimizada sem repintar** (problema de GPU/compositor no
   `restore()`/`focus()`). Precisaria abrir `focusMainWindow` e testar na máquina.

O que falta medir: qualquer uma das três aparece no log assim que existirem os handlers da T1.

## Escopo — o que NÃO é este bug

- O PES recomeçar do zero depois do fechamento: [[pipeline-download-chunked-concluido-perdido-ao-fechar-durante-o-hash-final-recomeca-do-zero_2026-10-07T21-48]].
- O stub portátil que não mostra nada enquanto extrai: [[release-portable-extrai-1-35-gb-no-temp-em-silencio-e-nao-abre-sem-avisar-o-motivo_2026-10-06T22-40]].
- O conselho do agente estava certo: a bandeja existe e o item é `Quit` (`electronTray.ts:40`).

## Tarefas propostas

| # | task | arquivo/símbolo | prova |
|---|---|---|---|
| T1 | registrar `render-process-gone` (motivo + exitCode), `unresponsive`/`responsive` e `did-fail-load` da janela principal no log de app, e mandar `render-process-gone` para a telemetria | `bootstrap.ts` / criação da `BrowserWindow` | forçar `webContents.forcefullyCrashRenderer()` em build de teste e ver a linha no log e o report |
| T2 | no `render-process-gone`, recarregar a janela (ou mostrar aviso) em vez de deixar branca | idem | mesma prova da T1, com a janela voltando |
| T3 | com a telemetria no ar, reabrir este doc com a causa do próximo caso | — | — |
