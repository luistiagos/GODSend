# Bug: HD preparado pelo Companion não dispara o BadAvatar, com os avatares cinzas, no mesmo console LT em que o pendrive preparado funcionou 5 dias antes, e reaplicar a 17559 não resolve

## Status

- **Status:** Em reteste (movido de `open/` para `retest/` em 2026-11-08).
- **Correção:** Resolvido pela atualização do pacote BadAvatar para a versão v1.3 (`bibarub/Xbox360BadUpdate` v1.3-beta com Stage 2 assíncrono e `badavatar-1.3.manifest.json`). O carregamento assíncrono do Stage 2 elimina a corrida crítica de temporização (*race condition*) entre o offset `0x2200` e a injeção em memória, tolerando a alta latência de I/O e spin-up de HDs mecânicos USB e prevenindo a desativação da renderização 3D de avatares (*Grey Silhouette Fallback*).
- **Doc de homologação do payload:** [`badavatar-atualizar-pacote-para-versao-estavel-com-suporte-otimizado-a-hd-externo_2026-11-06T18-10.md`](badavatar-atualizar-pacote-para-versao-estavel-com-suporte-otimizado-a-hd-externo_2026-11-06T18-10.md).
- **Falta para `closed/`:** Validação em hardware real (boot no console travado/LT com HD mecânico externo USB contendo jogos).

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
  [`badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09.md`](badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09.md).
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

## Ocorrencia - chamado #254 (2026-10-23): resposta do operador depois do registro

Mesmo chamado e mesma sessao (`268796283584649@lid`), mensagem posterior ao fim da leitura acima:
`[152050]` 2026-10-23 03:04 UTC, operador humano: *"Tente refazer o processo pelo xboxcompanion, e veja se dai funciona, se nao funcionar e algum problema com o hd."*
O operador atribui a falha ao HD; as hipoteses H1/H2 (dado de avatar fora do console, todos os perfis cinzas, incluindo `gui`) nao foram propostas ao cliente, e o teste barato de H1 (ligar so com o pendrive de 17/10) segue pendente.

## Ocorrencia - chamado #232 (sessao `161091405496378@lid`, registrada em 2026-11-06): mesmo HD que funcionou fica com avatares cinzas 9 dias depois, e o boot com o pendrive da 17559 devolve o funcionamento

Outro cliente, console **bloqueado**, Plataforma Xbox 360 comprada em 13/10. Horarios no relogio do banco (UTC), ids de `Wpp_proccess`.
Coleta: `python .claude/skills/sessao-whatsapp/scripts/sessao.py 161091405496378@lid` no `digitalstoregamesproject`.

1. **14/10:** preparou um pendrive de 4 GB e, antes de usa-lo, um **HD externo de 500 GB** no Companion
   ([142151], [142170] *"fiz com HD de 500"*). Disse que o console **tem HD interno de 500 GB** ([142162]).
   A Aurora abriu pelo exploit no mesmo dia e os jogos rodaram (Street Fighter, Max Payne 3: [142193], [142432]).
2. **15/10 18:08 [143505]:** tela de perfis com `ABadAvatar` cinza; minutos depois *"agora na parte da manha funcionou beleza"* ([143512]).
3. **23/10 13:56 [152333]:** *"Ja faz 30 minutos que esta assim"*: print com `ABadAvatar` **e o perfil pessoal `cfm`**
   cinzas. [152335]: *"quase sempre tem que ta desligado tudo e ligando de novo uma tres ou quatro vezes para o jogo entrar"*.
4. O agente mandou reaplicar a 17559 (guia "Como resolver"). O cliente baixou `SystemUpdate_17559_USB (3).zip` (do
   Digiex, [152360], [152400]), pos `$SystemUpdate` num pendrive e ligou o console com ele.
   **14:30 [152406]:** *"Nao apareceu nada ficou assim"*: **nenhum aviso de atualizacao**, e um perfil (a visao leu
   `dim`, provavelmente o `cfm`) agora **colorido**.
5. **14:35 [152412]:** desligou, trocou para o HD dos jogos, ligou: *"Funcionou"*.

O que esta ocorrencia acrescenta:

- **Mesmo dispositivo**, nao um segundo: o HD de 500 GB funcionou de 14/10 a pelo menos 15/10 e parou de disparar em
  23/10. Aqui nao houve troca de pendrive para HD entre o "funcionou" e o "cinza", entao H1 na forma escrita acima
  (dado de avatar no dispositivo que saiu) nao cobre este caso.
- **Console com HD interno** (fala do cliente, nao verificada). Isso entra em H2.
- **Diferente do #254, aqui o boot com o pendrive da 17559 resolveu**, mesmo sem aparecer o aviso de atualizacao. Nao se
  sabe se foi o pendrive ou o ciclo de liga e desliga a mais, ja que o cliente relata instabilidade intermitente.
- O guia do agente (`fragments/guias/xbox360_badavatar.md`, versao `70e62b71` usada na geracao #54750) diz que, se o
  pendrive anterior funcionava no console, o dado de avatar ja estava la e **nao** e o caso dos avatares cinzas. Neste
  console a regra apontaria para longe do que funcionou. Ela so deve mudar depois que a causa for provada (moratoria
  de prompts do `digitalstoregamesproject`).

## Investigação (2026-11-06): onde mora o dado de avatar, o que as duas conversas provam e o teste que separa as hipóteses

A causa raiz **continua não provada**. Esta seção registra o mecanismo que foi verificado, os fatos novos das conversas
(que corrigem o registro acima) e o teste que decide entre as hipóteses. Nenhum código foi alterado.

### 1. Onde o console guarda o dado de avatar

- O dado de avatar (e o de Kinect) fica na partição **SysExt (SystemExtended)**, criada pela atualização 2.0.12611.0.
  Ela existe no **HD interno** (FATX, offset `0x10C080000`, tamanho `0xCE30000`) e, num USB **configurado pelo
  console**, dentro de `Xbox360\Data0000` (*"houses the Cache/USB System Extended partitions"*). Fonte:
  [free60, FATX](https://free60.org/System-Software/Systems/FATX/). A unidade interna de 4 GB dos Slim/E não aparece
  nessa página: não verificado.
- O dispositivo que o Companion prepara é FAT32 com `Content\` na raiz e sem `Xbox360\`. Logo, **não tem SysExt**:
  não guarda, não recebe e não apaga o dado de avatar.
- Relatos de comunidade, não oficiais. O GBAtemp e o consolemods deram 403 e foram lidos só pelo resumo do buscador.
  - Num console Fat, o ABadAvatar só funcionou com o HD SATA interno ligado.
  - A 17559 **não instala o dado de avatar se nenhum armazenamento interno estiver ligado** durante a atualização. A
    correção relatada foi reaplicar a 17559 com o HD ligado
    ([GBAtemp](https://gbatemp.net/threads/new-xbox-360-hypervisor-exploit-software-based.662219/page-36)).
  - *"ABadAvatar does need an internal storage unit to work"* ([bytesnbits](https://bytesnbits.co.uk/abadavatar-1-3/)).
  - O README do [ABadAvatar](https://github.com/shutterbug2000/ABadAvatar) diz que, sem HD, *"you may need the
    official offline System Update 17559 on a formatted USB stick"*. Diz também que o exploit é uma corrida: 30% de
    sucesso, até 20 minutos, e a orientação é desligar e repetir.

### 2. O que o app grava (conferido)

- `fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice` (linhas 606-687) monta o plano com as **mesmas**
  entradas do manifesto para HD e para pendrive. O único filtro é `foreignConsoleState.ts::isForeignConsoleStatePath`
  (linhas 10-20), que tira só os logs do Aurora/FreeStyle e os bancos do FreeStyle. A diferença entre HD e pendrive
  está na formatação e no layout, não no conteúdo.
- Os únicos pacotes do título de sistema que o pacote grava (`Content/0000000000000000/FFFE07DF/00000002/532BBD19…` e
  `E80F2556…`) são **"Optional Media Update"** (codecs), não dado de avatar. Foi lido o cabeçalho STFS (tipo em `0x344`,
  título em `0x360`, nome em UTF-16BE em `0x411`):
  ```
  python -I -c "import struct;b=open(p,'rb').read(0x2000);print(b[:4],hex(struct.unpack('>I',b[0x344:0x348])[0]),b[0x411:0x511].decode('utf-16-be').split('\x00')[0])"
  ```
  O resultado nos dois foi `b'LIVE' 0x2 Optional Media Update`, com título `FFFE07DF`. O perfil `E0002FF78DFBDE7B` é
  `CON`, tipo `00010000`, título `FFFE07D1`.
- O preparo não copia perfil para o dispositivo. O único código que mexe em `FFFE07D1/00010000` é
  `src/server/services/saves/saves.go::backupProfilePackage` (linhas 831-847), que **baixa** o perfil do console para
  o PC pelo FTP.

### 3. Fatos das conversas que corrigem o registro acima

As duas conversas foram relidas com `sessao.py` em 2026-11-06: no #254, 99 mensagens, até 27/10; no #232, 229 mensagens.

- **O #254 se resolveu sem mudança no app.** Em [152011] (23/10 01:35) o cliente escreveu *"consegui atualizar de novo,
  mas não mudou nada"*. Em [152050] (03:04) o operador mandou refazer pelo Companion. Em **[152869] (18:16) veio
  *"Funcionou"***, com o HD. O que o cliente fez entre 01:44 e 18:16 não está na conversa.
- **No #254, o perfil `gui` está no HD.** O print [156130] (27/10) mostra que `BADAVATAR (D:)\Content` tem
  `E0002FF78DFBDE7B` (o `ABadAvatar`) e `E00004A7AE752F97`, o único outro perfil visto na conversa. A premissa da H3
  acima (*"o perfil pessoal `gui` não está no HD"*) está **errada**, pelo menos em 27/10. Como o preparo não copia
  perfil (item 2), quem gravou o `gui` no HD foi o próprio console.
- **No #232, o console disse que não tem HD.** Em [148672] (20/10), ao abrir MGSV Ground Zeroes pela Aurora, apareceu
  *"Disco Rígido Xbox 360 não detectado. É preciso ter um disco rígido…"*. Em [148676] o cliente escreveu *"O meu só
  está com HD externo que baixei os jogos"*. Isso põe em dúvida o "HD interno de 500 GB" de [142162]: ou ele não
  existe, ou não foi detectado naquele boot.
- **No #232, a lista de perfis muda de um boot para outro.**
  - 15/10 [143505]: só o `ABadAvatar`, cinza.
  - 23/10 13:56 [152333], com o HD: `ABadAvatar` e `cfm`, cinzas por 30 minutos.
  - 14:30 [152406], **sem o HD** e só com o pendrive da 17559 ([152403] mandou não usar o HD): um perfil pessoal
    colorido (a visão leu `dim`) e **nenhuma oferta de atualização**.
  - 14:35 [152412], com o HD de novo: funcionou.
- **No #232, o agente leu errado o boot sem o HD.** Em [152407] ele disse *"O perfil dim está colorido, então a
  atualização resolveu os avatares"*, mas nenhuma atualização foi oferecida nem aplicada. O boot sem o dispositivo só
  mostrou que o dado **já estava** no console. Pelo critério do próprio guia ("um único perfil colorido já prova que o
  console tem o dado"), o cinza das 13:56 daquele dia não era falta de dado.

**Consequência: avatar cinza com o dispositivo do exploit ligado não basta para concluir que falta o dado.** No #232,
o dado existia no mesmo dia. Mesmo assim, o material de suporte aponta uma só causa e um só remédio (reaplicar a 17559):
a KB em `SUPPORT_AGENT_KB.md:169-178`, o app em `BadAvatarUsbPage.tsx:667` e `677-699`, e o guia do agente em
`xbox360_badavatar.md:67-91`. Esse remédio não age quando o dado já está instalado, porque o console ignora a mesma
versão ([151498], [151958], [152406]). Os dois clientes passaram horas nesse laço.

### 4. Hipóteses revistas

| | H1: o dado está num USB configurado que saiu | H2: o armazenamento interno não é detectado no boot | H4: tentativa do exploit que não completa |
|---|---|---|---|
| Mecanismo | console sem HD interno guarda a SysExt só num USB que ele configurou (`Xbox360\Data0000`), e esse USB saiu ou foi formatado | HD interno falhando, mal encaixado ou sem energia; no boot em que ele não aparece, a SysExt some | o estágio 1 está no item de avatar do perfil `ABadAvatar` (README: endereço 0x2200; PR #4 do ABadAvatar: troca e descarrega o `gamerprofile.xex`); uma tentativa presa deixaria a tela sem nenhum avatar renderizado |
| Boot **sem** o dispositivo do Companion | cinza | varia | colorido |
| Armazenamento, num boot cinza | sem disco interno nem unidade de memória | o interno falta na lista | igual a um boot bom |
| Religar 3 ou 4 vezes com o dispositivo | não resolve | às vezes resolve | resolve |
| O console oferece a 17559? | só se houver onde instalar (relato do GBAtemp) | não, porque o dado existe | não |
| Casa com | o #254, **se** o console não tiver armazenamento interno. Os perfis no HD externo apontam nessa direção, mas não provam. A atualização de 01:35, se foi mesmo oferecida pelo console, pesa a favor | o #232 ([148672], listas de perfis diferentes, "três ou quatro vezes") | o #232 (colorido sem o HD; funcionou no boot seguinte) e o fim do #254 |
| Verificada? | não | não | **não**: nenhuma fonte descreve esse efeito; ele vem só de o exploit ser uma corrida |

A H3 (o conteúdo do HD bloqueia os avatares) perde a base que tinha, porque o conteúdo gravado é o mesmo do pendrive
(item 2). Sobra só a diferença física: o HD externo é maior e mais lento para girar no boot. No máximo, isso mudaria o
tempo da corrida da H4, e é especulação.

### 5. Hipóteses descartadas

- **O app grava ou apaga dado de avatar:** descartada pelos itens 1 e 2.
- **Reaplicar a 17559 resolve quando o pendrive já funcionou no console:** nos dois casos o console não ofereceu a
  atualização, e no #232 o HD voltou a funcionar sem atualização nenhuma.
- **O `gui` fora do HD enfraquece a H3:** a premissa estava errada (item 3). A H3 cai, mas por outro motivo (item 2).

### 6. Medição que ficou bloqueada

Contagem, em `Wpp_proccess`, dos prints da tela de perfis com o `ABadAvatar` descritos como cinzas ou coloridos:

```sql
SELECT COUNT(*) n, COUNT(DISTINCT main_phone) lids, MIN(dttime), MAX(dttime) FROM Wpp_proccess
WHERE role='customer' AND message LIKE '%DESCRI%' AND message LIKE '%badavatar%'
  AND (message LIKE '%cinza%' OR message LIKE '%silhue%' OR message LIKE '%colorid%' OR message LIKE '%sem rosto%')
```

O resultado foi **82 prints de 41 clientes**, de 2026-08-06 a 2026-11-02. A leitura dos 82 foi barrada pelo
classificador do auto mode, e a skill `sessao-whatsapp` manda parar nesse caso. Essa leitura diz quantas vezes o cinza
terminou com a atualização oferecida e aceita, e quantas terminou depois de religar ou de um boot sem o dispositivo.
Esse número decide se o material deve começar por "falta o dado" ou pelo teste do item 7. Para rodar, o dono libera
`Bash(python *sessao.py *)` ou roda fora do auto mode.

### 7. O que fazer

1. **Suporte, sem código (decide entre H1, H2 e H4).** No próximo boot cinza com o dispositivo do Companion:
   - (a) desligar, **tirar o dispositivo do Companion** e ligar. Algum perfil fica colorido?
   - (b) em Configurações ➔ Sistema ➔ Armazenamento, nesse boot e num boot cinza: aparece Disco Rígido ou Unidade de
     Memória? Qual é o modelo do console?
   - (c) se o perfil ficou colorido sem o dispositivo: religar com ele, esperando até 20 minutos por tentativa, até 3 ou 4
     vezes.

   No #254, perguntar o que foi feito entre 23/10 01:35 e 18:16 e como a atualização apareceu. No #232, pedir o print do
   Armazenamento com nada espetado.
2. **Rodar a medição do item 6**, com a permissão do dono.
3. **Textos, depois do passo 1 ou do 2.** Pôr o boot sem o dispositivo **antes** do passo da 17559, e dizer quando o
   console oferece o dado: dado ausente e armazenamento interno (ou USB configurável) ligado.
   - App: `BadAvatarUsbPage.tsx:667` e `677-699`. Complexidade baixa. Prova: o `badavatar-preview-smoke.cjs` continua
     passando e o dono lê o texto.
   - KB: `SUPPORT_AGENT_KB.md` e `BASE_CONHECIMENTO_SUPORTE_WHATSAPP.md`, linhas 169-178.
   - Guia do agente: segue a moratória (doc, eval e aprovação do dono).

   O passo do boot sem o dispositivo não afirma causa nenhuma: só manda aplicar o critério que o guia já tem. Cabe ao
   dono decidir se ele entra antes de a causa ser provada.
4. **Só se a H1 se confirmar, no app:** antes de "Formatar antes", detectar `Xbox360\Data0000` no destino e avisar que
   ali está o armazenamento do console (perfis, saves e, num console sem HD, o dado de avatar). Complexidade alta
   (preparo de disco). Prova: teste unitário com uma raiz falsa que contém `Xbox360/Data0000` (o aviso aparece) e outra
   sem ela (o aviso não aparece).

**Severidade:** nos dois casos o HD voltou a funcionar sem nenhuma mudança no app. O P1 do cabeçalho deve ser revisto
pelo dono depois do passo 1.
