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

**A detecção trata como imutável um arquivo que o console regrava.** Não houve console para a prova antes/depois (o
dono não tem console de teste, 2026-10-21); a causa foi fechada pela consistência do próprio arquivo, como o dono
pediu.

- `preparedDeviceState.ts::matchesBundledSize` exige `stat.size === file.sizeBytes` do manifesto. Em erro de `lstat`
  devolve `false`. Um único `false` faz `detectPreparedDeviceState` (linhas 89–94) cair para `preparado-rgh` quando
  existe o marcador. Chamador único: `badAvatarUsbService.ts:514` (lista de dispositivos, a cada 5 s).
- O perfil do exploit é **um** arquivo, `Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B` (manifesto
  `badavatar-1.1`, filtrado por `isExploitProfilePath`). É um pacote STFS `CON ` de perfil (content type
  `0x00010000`, title `FFFE07D1` = dashboard). Pacote `CON ` é assinado pelo console, que o regrava quando grava no
  perfil (GPD do dashboard, títulos jogados, conquistas). Um GPD novo ocupa blocos novos, e o pacote **cresce** em
  blocos de 4 KiB. O cliente jogou (FIFA World Cup 2006, Amped 3) entre o preparo e o aviso.
- O tamanho do pacote é determinado pelo próprio cabeçalho. Fórmula de bloco do STFS
  (`ComputeBackingDataBlockNumber`, a mesma do Velocity/XContent), aplicada ao perfil do pacote:
  `headerSize 0x971A`, `blockSeparation 2` → tabelas de hash de 2 blocos, `allocated 70`. Último bloco de dados (69)
  → bloco físico 71 → exigido `0xA000 + 72 × 0x1000 = 335872`; o arquivo tem **335872** (script Python no cabeçalho do
  arquivo do pacote: `required 335872 actual 335872`). Então "o arquivo contém todos os blocos que o cabeçalho
  declara" é uma conferência exata, que vale para qualquer tamanho que o console deixar.

Limite desta prova: ela mostra que a regra atual recusa todo perfil que o console aumentou, e que a regra nova aceita
o perfil regravado e recusa o truncado. Ela **não** mostra em hardware que o perfil do cliente cresceu, em vez de ter
sido apagado. Se ele foi apagado, o aviso estava certo e continua igual depois da correção.

## Hipóteses descartadas

- **Telemetria 11181/11182 como evidência:** o log é de outra máquina (ver Evidência).
- **Pendrive `E:` como prova antes/depois:** nada nele é mais novo que o preparo (`find -newer launch.ini` → vazio).
  Os arquivos de console em `Content/0000000000000000` vieram do próprio pacote.
- **Trocar `===` por `>=` o tamanho do manifesto:** aceita o crescimento e recusa a cópia truncada do pacote, mas
  depende de o console nunca encolher o pacote, o que não dá para provar sem console. Pior: um pacote que cresceu e
  foi truncado depois (cópia do perfil regravado interrompida) passaria. A conferência pelo cabeçalho cobre os dois.
- **Comparar SHA-256:** o console reassina o pacote, então o hash muda sempre depois do primeiro uso. Seria pior que
  o tamanho.

## Correção planejada

- `src/electron-app/services/preparedDeviceState.ts`: trocar `matchesBundledSize` por uma conferência de pacote STFS
  completo. Ler o começo do arquivo e exigir magic `CON `/`LIVE`/`PIRS`, `allocated > 0` e
  `tamanho ≥ endereço do fim do último bloco alocado` (fórmula acima). Arquivo comum, sem symlink, como hoje. Erro de
  leitura → `false`, como hoje. Custo: um `read` de ~1 KiB por varredura de 5 s.
- Testes em `src/electron-app/tests/unit/preparedDeviceState.test.cjs`, com o perfil real do pacote copiado para uma
  raiz temporária:
  - o perfil do pacote é reconhecido (`preparado-bloqueado-lt`);
  - o perfil que o console aumentou em um bloco (`allocated 71` + 4 KiB) é reconhecido (este é o caso do bug: hoje dá
    `preparado-rgh`);
  - o mesmo perfil sem o último bloco é recusado (`preparado-rgh`);
  - um arquivo que não é STFS, com o tamanho do manifesto, é recusado.
- Versão 2.12.115 nos quatro lugares + `CHANGELOG.md`.

## Tasks

| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | detecção confere o perfil do exploit pela consistência do pacote STFS, não pelo tamanho do manifesto | `d06e424` | commitado, sem release; 12/12 unitários verdes (reconferido 2026-10-21); falta a validação em hardware | claude-opus-5-5 | -- |

## Como reproduzir

_Em andamento (2026-10-21)._ Roteiro: pendrive de teste preparado em "Xbox Bloqueado ou LT" → listar tamanho de cada
arquivo de `Content/` → bootar no console travado pelo perfil do exploit, abrir a Aurora e um jogo → voltar ao PC,
listar de novo e abrir o Companion.

**Linha de base, pendrive de teste `E:` (FAT32 15,5 GB, "USB DISK 2.0"), antes de ir ao console:**

- `preparo.json`: `mode: bloqueado-lt`, release `1.1-autostart-aurora-freestyle-dashlaunch-xexmenu`.
- O manifesto `badavatar-1.1` tem **um** arquivo de perfil do exploit:
  `Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B`, `sizeBytes 335872`.
- No pendrive, esse arquivo é idêntico ao do pacote: 335872 bytes, mtime 2026-10-13 05:45, SHA-256
  `51631962a981136bdee63a2dcf31ff27f64a706ecc70af6c20aae87f86cca4b9` nos dois (`sha256sum`; `cmp -l | wc -l` → 0).
- Nenhum arquivo em `Content/` ou `Aurora/` é mais novo que `launch.ini` (`find -newer` → vazio): este pendrive **não
  voltou** do console desde o preparo, então não serve como prova antes/depois.
- Cabeçalho do perfil (STFS): magic `CON ` (pacote assinado por console), content type `0x00010000` (perfil),
  descritor com 70 blocos alocados e 7 não alocados, cerca de 72 blocos de 4 KiB no arquivo. Um pacote `CON ` é
  reassinado e regravado pelo console quando ele grava no perfil, e é isso que o retorno do console vai mostrar.

Comando para comparar na volta:
`ls -la --time-style=full-iso /e/Content/E0002FF78DFBDE7B/FFFE07D1/00010000/; sha256sum /e/Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B`

## Correção aplicada

Como planejado, versão 2.12.115. `preparedDeviceState.ts::matchesBundledSize` virou
`hasCompleteProfilePackage` + `stfsRequiredBytes`: lê os primeiros 0x3A0 bytes e exige magic `CON `/`LIVE`/`PIRS`,
`allocated > 0` e `tamanho ≥ fim do último bloco alocado`. Erro de leitura → `false`, como antes. O campo `sizeBytes`
de `ExploitProfileFile` continua no tipo, mas a detecção não o usa mais.

O segundo e o terceiro nível de tabelas de hash (perfis com mais de 170 blocos, ~680 KiB) seguem a fórmula do STFS,
mas só o primeiro nível foi conferido contra um arquivo real.

## Testes executados

- `node --test tests/unit/preparedDeviceState.test.cjs` (depois de `npx tsc`): 12 pass / 0 fail, com o perfil real
  do pacote presente (teste 10 não pulou).
- Sabotagem: no JS compilado, `stat.size >= required` trocado por `stat.size === file.sizeBytes` (a regra antiga)
  → falham o 7 (perfil aumentado em um bloco: o caso do cliente) e o 8 (perfil aumentado e depois truncado, que
  tem 335872 bytes e passava pela regra antiga). Recompilado em seguida.
- `npm run test:safety`: 357 pass / 0 fail.

## Critérios para fechar

- [ ] Reprodução confirmada em hardware (ou hipótese descartada com a listagem antes/depois) — sem console de teste;
  substituída pela conferência do cabeçalho (ver Causa raiz)
- [x] Causa raiz isolada e corrigida
- [x] Teste unitário cobrindo o caso
- [ ] Validação em hardware real — primeiro pendrive/HD BadAvatar que voltar do console: abrir o Companion e
  conferir que aparece como preparado para Bloqueado/LT; anotar o tamanho do perfil antes/depois

## Passagem de bastão (2026-10-21)

Feito: T1 em `d06e424` (código, testes, versão 2.12.115, CHANGELOG), carimbado em `eea2bfe`. Não há edição sem
commit desta sessão. Os dois arquivos de `src/android-app` modificados na árvore não são deste bug.

Próxima sessão, nesta ordem:

1. **Publicar a 2.12.115.** Rodar `build-and-upload.ps1` na raiz do repo (HF + R2 + `version.json`). Antes,
   `git log --oneline -5`: se o dono já publicou, só anotar. Depois, conferir no `version.json` publicado que a versão
   é `2.12.115` e atualizar a célula `estado` da T1 para "release 2.12.115".
2. **Graphify: nada a fazer.** `graphify-out/` não existe no repo, e o comando `graphify` não está instalado
   (exit 127). A regra do CLAUDE.md ("rodar `graphify update .` depois de mudar código") vale só quando o grafo
   existe. Criar o grafo é decisão do dono, fora deste bug.
3. **Fechar o bug** só depois da validação em hardware (critério acima). Até lá o doc fica em `docs/bugs/open`. Se
   o perfil voltar do console **menor** que o do pacote, ou ausente, a causa provada aqui não é a do cliente: reabrir
   a Causa raiz.
