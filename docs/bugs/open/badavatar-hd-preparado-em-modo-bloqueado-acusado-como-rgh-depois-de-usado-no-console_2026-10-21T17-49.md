# Bug: HD preparado em modo "Xbox Bloqueado ou LT" volta do console e o Companion diz que é RGH, sem o perfil do exploit — o cliente formata e perde os jogos

- **Detectado em:** 2026-10-21 17:49 (análise da sessão de WhatsApp `32822140117221@lid`, telefone `5513974048946`)
- **Origem:** `xbox-360-companion/electron-main` — aviso `preparado-rgh` de `src/electron-app/services/preparedDeviceCopy.ts`,
  decidido em `src/electron-app/services/preparedDeviceState.ts::detectPreparedDeviceState`
- **Errors (serviço):** N/A (o aviso é estado da UI, não vai para a telemetria)
- **Classe:** fail (perda de dados induzida: o aviso manda refazer o preparo, e o caminho indicado formata)
- **Severidade:** **P1 — Alto** (provisória) pela matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md): um
  dispositivo legítimo é recusado, e a saída indicada apaga jogos, perfil e saves. Sobe para P0 se a prova abaixo
  confirmar que todo dispositivo BadAvatar usado no console cai nisso.
- **Complexidade:** média (detecção de estado num serviço + teste com pendrive real no console)
- **Versões:** o cliente estava na 2.12.110 (versão da telemetria no mesmo horário; a conversa não traz a versão).
  O código atual (2.12.114) tem a mesma regra de detecção.
- **Reincidência:** primeira vez registrado. Relacionados, mas não iguais:
  [[badavatar-fatal-crash-no-meio-do-jogo-deixa-o-pendrive-ilegivel-e-leva-perfil-e-saves_2026-10-20T13-28]] (o perfil
  some depois de um crash; aqui o cliente não relatou crash) e o fechado
  [[badavatar-usb-service-declara-ja-preparado-sem-conferir-o-perfil-do-exploit_2026-09-23T14-08]] (que criou a
  conferência do perfil).

## Sintoma

Cliente com Xbox 360 travado (comprou a Plataforma Xbox 360 em 20/10, transação 64138). Horários em UTC.

1. **20/10 20:50** ([149429]): print do preparo em andamento no HD WD 320 GB: *"Preparando… Copiando
   apps/FreeStyle/Plugins/HudScene/Images/tco_40x_room_private_active.png - 282/620"*.
2. **20/10 22:11** ([149507]): print do destino do jogo: *"D: — BADAVATAR - 297.3 GB livres"*. Baixou jogos (FIFA World
   Cup 2006, Amped 3 — [149651]).
3. **21/10 16:00** ([150207]): depois de levar o HD ao console, o Companion mostra:
   > Este pendrive tem a Aurora para console RGH, mas não tem o perfil do exploit (AbadAvatar). Se o seu Xbox é
   > travado ou LT, prepare de novo escolhendo 'Xbox Bloqueado ou LT'.
4. **21/10 16:01** ([150209]): *"O HD eu tirei e agora eu quero pôr mais jogos mas não vai"*; **16:03** ([150212], áudio):
   *"já tem jogo dentro dele e não tem como eu colocar só mais jogos, eu tenho que formatar…"*.
5. O agente de WhatsApp leu o aviso ao pé da letra ([150208], [150213]): *"o HD foi preparado no modo de console
   destravado (RGH)"* e mandou refazer com "Formatar antes" marcado — *"Os jogos que estavam nele saem"*.
6. **21/10 19:46** ([150485]): o cliente aparece com outro HD (Seagate, *"D: — BADAVATAR · 880.4 GB livres"*), ou seja,
   preparou de novo do zero.

## Evidência

- Conversa lida inteira pela skill `sessao-whatsapp` (55 mensagens, 20/10 16:03 → 21/10 19:48). Ids acima são de
  `Wpp_proccess`.
- **O HD foi preparado em modo BadAvatar, não RGH:** 620 entradas no preparo é a contagem do modo BadAvatar (o modo RGH
  copia 202 — ver a fase `(24%, 1/620)` × `(24%, 1/202)` em
  [[badavatar-repreparo-sem-formatar-falha-diario-transacional-nao-pertence-ao-plano_2026-10-20T21-27]]), e o volume
  ficou com o rótulo `BADAVATAR`.
- **Entre o preparo e o aviso o HD foi ao console** ([150209] "O HD eu tirei").
- **O que o código faz hoje** (observado, não é causa provada):
  `preparedDeviceState.ts::detectPreparedDeviceState` (linhas 89–96) devolve `preparado-bloqueado-lt` só se **todo**
  arquivo de `exploitProfileFiles()` existir com `size === sizeBytes` do manifesto (`matchesBundledSize`, linhas 55–62).
  Se algum falhar e existir o marcador do app (`preparedByThisApp`), devolve `preparado-rgh`.
  `exploitProfileFiles()` (`fixedBadAvatarPreparationService.ts:338`) pega todo arquivo do manifesto sob
  `Content/<id>/`, exceto `Content/0000000000000000` (`infrastructure/exploitProfile.ts::isExploitProfilePath`).
- Telemetria no mesmo horário (errors 11181, 16:04, e 11182, 16:05, v2.12.110, modo badavatar) **não** é atribuível a
  este cliente: o log anexo é de outra máquina (`C:\Users\User`, baixando Jurassic Park). Não usar como evidência deste
  caso.

## Causa raiz

_Pendente (passada 2)._ Pergunta a responder com prova: depois que o console usa o perfil do exploit, algum arquivo de
`Content/<id-do-perfil>/` muda de tamanho ou some? Ou o perfil foi apagado por outro motivo (crash, como no bug P0)?

## Como reproduzir

_Pendente._ Roteiro proposto: pendrive de teste preparado em "Xbox Bloqueado ou LT" → listar tamanho de cada arquivo
de `Content/` → bootar no console travado pelo perfil do exploit, abrir a Aurora e um jogo → voltar ao PC, listar de
novo e abrir o Companion.

## Critérios para fechar

- [ ] Reprodução confirmada em hardware (ou hipótese descartada com a listagem antes/depois)
- [ ] Causa raiz isolada e corrigida
- [ ] Teste unitário cobrindo o caso
- [ ] Validação em hardware real
