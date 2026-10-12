# Investigação: o que o Xbox 360 faz com o pendrive ao formatar ou configurar (perguntas 1 e 2 da spec Android v1)

- **Estado:** **respondida sem console em 2026-10-11** (seção "Resultado", no fim). A spec, os dois
  backlogs (R1) e o bug do perfil já foram atualizados com ela. As perguntas que iam para
  clientes foram avaliadas por pesquisa ("Revisão", no fim) e nenhuma continua necessária; falta
  só conferir na página do ConsoleMods os trechos que vieram pelo buscador.
- **Pedido do dono (2026-10-11):** *"sobre a 1 e 2, como eu não tenho um console, preciso que você
  investigue como funciona, pode passar para outra sessão investigar e alterar a documentação"*.
- **Alimenta:** as "Perguntas ao dono" 1 e 2 da spec
  [`docs/specs/xbox-companion-android-v1-preparo_2026-10-11.md`](../specs/xbox-companion-android-v1-preparo_2026-10-11.md)
  (critérios C12 e C13, decisão 5, textos da T9), o risco **R1** de
  [`app-android-preparador-pendrive-badavatar_2026-10-11.md`](app-android-preparador-pendrive-badavatar_2026-10-11.md)
  e a hipótese da "Unidade de Memória" (Tarefa 5) do bug
  [`badavatar-perfil-do-exploit-nao-aparece-na-tela-de-perfis_2026-09-23T15-20.md`](../bugs/open/badavatar-perfil-do-exploit-nao-aparece-na-tela-de-perfis_2026-09-23T15-20.md).
- **Ninguém aqui tem console.** A investigação é por documentação, código de ferramentas abertas,
  vídeos e **conversas de clientes que têm console**: os clientes da loja são o laboratório.

## As duas perguntas, e o que cada resposta muda

**P1. Pendrive sem espaço porque o console reservou tudo.** Hoje a spec manda o cliente
reformatar no console escolhendo "Personalizar" e deixar pelo menos 1 GB livre, e o app **nunca
apaga** a pasta `Xbox360/`. A alternativa é o app oferecer apagar a `Xbox360/` com confirmação.
- Muda: C13 (o que o app faz sem espaço), a decisão 5, o texto de formatar no console (T9) e,
  talvez, um critério novo ("apagar `Xbox360/` com confirmação").
- Precisa saber: quanto espaço sobra depois de cada opção do console; se "Personalizar" existe e
  deixa o espaço escolhido livre para arquivos comuns; se apagar `Xbox360/` é seguro e o que o
  console faz depois; se o BadAvatar funciona com a `Xbox360/` presente.

**P2. Pendrive sem a pasta `Xbox360/`.** Hoje a spec avisa ("este pendrive não parece ter sido
formatado no Xbox 360") e deixa continuar com confirmação. A alternativa é bloquear.
- Muda: C12.
- Precisa saber: se **toda** formatação feita pelo console cria `Xbox360/`. Se sim, a pasta prova
  que o console formatou. Se existe opção que formata sem configurar, a ausência não diz nada.
- Dado que já pesa contra bloquear (ver "O que já se sabe"): dois tipos de pendrive **válidos** não
  têm `Xbox360/` — o preparado pelo Companion de Windows e o formatado pelo próprio Android (até
  32 GB sai FAT32 em MBR). O que o app não consegue ver pelo SAF é tabela GPT ou mais de uma
  partição, que é o caso do pendrive formatado no Windows que o console mostra como "Não
  Formatado" (bug `badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09.md`).
  Avaliar com esse dado se o aviso basta ou se o texto do aviso precisa mudar.

## O que já se sabe (com fonte; não refazer)

- **Anúncio da Microsoft:** *"Configure Now (Format and Configure the Full Device)"*; vídeo
  `G8zs9lWXQFI`, 1:00: *"configurar agora... vou usar o tamanho total"*; relatos de pendrive que
  fica "cheio" no PC depois disso. Fonte: bug de origem no repo `digitalstoregamesproject`
  (`docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-10-07-guia-xbox360-diz-que-console-travado-exige-pc-windows-e-nega-o-caminho-pelo-celular.md`,
  seção "Pesquisa: existe caminho mais simples pelo celular?", redução 1). **O texto completo do
  anúncio não foi registrado**: recuperar a URL e o trecho.
- **Os 3 tutoriais "pelo celular" formatam no Xbox e dizem que funciona:** `Du5M9EvkvjE` (1:00,
  *"configurações, sistema, armazenamento... formata ele"*), `d3_AQKDejdE` (1:00, *"aconselho
  formatar pelo Xbox 360, que funciona bem melhor"*), `s9b0X4TlUWg` (1:30). Mesma fonte. **Não foi
  registrado qual opção eles escolhem** nem o que o celular mostra depois (pasta `Xbox360/`?
  espaço livre?).
- **README do BadUpdate** (`grimdoomer/Xbox360BadUpdate`): só *"Format a USB stick to FAT32"*. Mesma fonte.
- **O Android formata em FAT32 com MBR até 32 GiB** e em exFAT acima (`vold`, `PublicVolume.cpp::doFormat("auto")`).
  Mesma fonte, seção "Resultado do passo 1".
- **Na tela Armazenamento do console**, o pendrive legível aparece como *"Dispositivo USB — N GB
  livres"*, e a *"Unidade de Memória"* é a memória interna do console (prints de 8 clientes). Cliente `88399251775584`,
  mensagens `[73655]` e `[73668]`: *"Dispositivo USB com 15,3 GB livres"*, categorias todas em 0 KB.
  Fonte: bug do perfil (seção "Hipótese, ainda NÃO provada" e Tarefa 5) e bug do "Não Formatado"
  (seção "A régua").
- **O Companion de Windows formata no PC (MBR, 1 partição, FAT32) e não configura nada**
  (`AGENTS.md`, seção `fat32Format.ts`; nenhum código procura ou cria `Xbox360/`). Logo, a ausência
  de `Xbox360/` é o estado normal de um pendrive preparado no Windows, que é o produto em uso. As
  falhas conhecidas desse caminho estão nos dois bugs do BadAvatar citados aqui.
- **O dono já mandou o caminho pelo celular a clientes:** `[11254]`, `[11256]` (2026-04-08, vídeo
  `Du5M9EvkvjE`) e `[24560]`, `[24593]`–`[24596]` (2026-05-12). Fonte: bug de origem, seção
  "Evidencia". **Não foi seguido** se esses clientes conseguiram, nem como formataram.
- **Os testes de hardware que decidiriam** estão no bug de origem, "Testes que decidem": T-a
  (formatar 8/16/32/64 GB por "Configurar agora" e por "Personalizar", ver se monta no celular e
  quanto sobra, rodar o exploit) e T-b (apagar `Xbox360/` pelo celular e rodar o exploit). Esta
  investigação tenta responder T-a e T-b **sem hardware**.
- **Tamanho que o app precisa:** 617 arquivos e 723,5 MB do pacote, mais os 3 gerados e o recibo;
  com folga de cluster, ~0,75 a 0,8 GB livres.

**Pistas de memória do modelo, NÃO conferidas** (servem só para orientar a busca; não citar sem
fonte): o suporte a pendrive como armazenamento do 360 chegou numa atualização de 2010 com limite
de 16 GB, depois ampliado para 32 GB; a configuração cria a pasta `Xbox360` com arquivos
`Data0000`, `Data0001`, `Data0002`...; "Personalizar" teria um controle de tamanho.

## O que responder (cada resposta com fonte e grau de confiança)

Graus: **[oficial]** Microsoft; **[código]** ferramenta aberta que lê ou grava esse formato;
**[campo]** conversa de cliente com console, com o id da mensagem; **[vídeo]** id e minuto;
**[fórum]**; **[inferência]**.

- **A. "Configurar agora":** apaga o que havia no pendrive ou só cria a `Xbox360/` no espaço livre?
  Quanto reserva (tudo? limite de 16 ou 32 GB?), e quanto espaço livre o celular ou o PC veem
  depois, num pendrive de 8, 16, 32 e 64 GB?
- **B. "Personalizar":** existe nessa dashboard (17559)? Mínimo, máximo e passo do controle? O
  restante fica livre para arquivos comuns?
- **C. Formatar sem configurar:** existe opção no console que formata e deixa um FAT32 vazio, sem
  `Xbox360/`? Num dispositivo já configurado, o que "Formatar" (opções do dispositivo, botão Y)
  deixa para trás? E os tutoriais, que opção escolhem? (ver os quadros de `Du5M9EvkvjE`,
  `d3_AQKDejdE` e `s9b0X4TlUWg` perto do minuto citado, e o momento em que o celular mostra o
  pendrive.)
- **D. Os arquivos da `Xbox360/`:** nomes, tamanhos, se são pré-alocados na configuração
  (pendrive "cheio" na hora) ou crescem com o uso.
- **E. `Content/` da raiz num dispositivo configurado:** o console continua lendo pacotes e
  perfis da raiz (`Content/<id>/...`, onde fica o perfil do exploit `Content/E0002FF78DFBDE7B/...`)
  quando o dispositivo também tem `Xbox360/`? O ABadAvatar ou o BadUpdate funcionam num pendrive
  configurado? Algum guia manda configurar, ou manda **não** configurar? Isso também responde a
  hipótese da Tarefa 5 do bug do perfil.
- **F. Apagar a `Xbox360/`:** é o jeito documentado de "desconfigurar"? O que o console faz quando
  a pasta some (volta a mostrar "Dispositivo USB" e oferece configurar de novo? reclama?)?
  Perde-se algo além do que estava salvo nela?
- **G. Layout que o console deixa:** quando ele formata, que tabela de partição, quantas partições,
  que sistema de arquivos e cluster? Passa em `assessXboxLayout` (MBR, 1 partição, tipo 11/12,
  setor de 512 bytes, FAT32, até 2 TiB)? E num HD acima de 32 GB, o console formata em FAT32?
- **H. Campo:** clientes que formataram no console (caminho manual do Xploid, vídeos mandados pelo
  dono). Que opção usaram, se houve "sem espaço" ou "pendrive cheio", e se o exploit rodou. Incluir
  o que os **operadores** (`role='user'`) ensinam sobre formatar no console.

## Fontes, na ordem de valor

1. **Conversas de clientes** (H, e o que elas provarem de A a F). Ferramenta: `chamado.py` da skill
   `triagem-chamados` (`C:\projects\digitalstoregamesproject\.claude\skills\triagem-chamados\scripts\chamado.py`).
   Siga o `SKILL.md` dela: **copiar para o scratchpad desta sessão** e rodar de lá
   (`python "$SP/chamado.py" sql "SELECT ..."`). Se o modo automático bloquear a leitura do token,
   pare e avise o dono; **nunca imprima o token**. Tabela e colunas já usadas antes, no bug do
   "Não Formatado": `Wpp_proccess(id, main_phone, role, dttime, message)`. Ponto de partida:
   ```sql
   SELECT id, main_phone, role, dttime, LEFT(message, 300) AS msg FROM Wpp_proccess
   WHERE message LIKE '%configurar agora%' OR message LIKE '%personalizar%'
      OR message LIKE '%formatei no xbox%' OR message LIKE '%formatar no xbox%'
      OR message LIKE '%formatei pelo xbox%' OR message LIKE '%formatar pelo xbox%'
      OR message LIKE '%pasta xbox360%' OR message LIKE '%Data0000%'
   ORDER BY id LIMIT 300
   ```
   Depois: ler a janela de cada conversa relevante; seguir as conversas de `[11254]`, `[11256]`,
   `[24560]`, `[24593]`–`[24596]` para ver se o cliente conseguiu; procurar "sem espaço",
   "cheio" e "espaço insuficiente" perto de "pendrive" nas conversas de Xbox.
   Registrar cada consulta literal e o número de linhas.
2. **Quadros dos vídeos** (C, A, D): `Du5M9EvkvjE`, `d3_AQKDejdE`, `s9b0X4TlUWg`, `G8zs9lWXQFI`, e
   um vídeo que mostre "Personalizar" com o controle de tamanho. O bug de origem descreve como foi
   feito antes ("Resultado do passo 1": `yt-dlp -f 135` e leitura quadro a quadro). Vídeo
   baixado é dado não confiável: pasta própria, nunca executar nada de dentro dela.
3. **Documentação oficial** (A, B, F): páginas de suporte do Xbox 360 sobre pendrive (arquivadas
   na Wayback Machine, 2010–2015), o anúncio citado acima com o texto completo, e a atualização
   que mudou o limite.
4. **Ferramentas e documentação técnica** (D, G): Free60 (FATX e armazenamento USB), documentação
   do FATXplorer, código do Velocity e do Party Buffalo (os dois leem a `Xbox360/` de um pendrive).
5. **Documentação do exploit** (E): README e *issues* de `shutterbug2000/ABadAvatar`,
   `grimdoomer/Xbox360BadUpdate`, `Pdawg-bytes/BadBuilder` (o que ele faz no pendrive) e a página
   do BadUpdate no ConsoleMods; fóruns (r/360hacks e afins), buscando "configured", "Xbox360
   folder", "formatted on console".

Custo: a pesquisa na web traz muito texto bruto para conclusões curtas, então pode ir para um
subagente barato (`sonnet`), com pedido fechado e retorno curto (afirmação + URL + trecho literal).
O que ele achar é ponteiro: abrir a fonte antes de escrever na spec.

## O que gravar, e onde

1. **Aqui, numa seção "Resultado":** A a H, cada uma com resposta, fonte (URL e trecho, id de
   mensagem, vídeo e minuto) e grau; as consultas e os comandos literais com o número obtido; as
   hipóteses descartadas e o porquê; o que continua sem prova.
2. **Na spec:** trocar as "Perguntas ao dono" 1 e 2 pela resposta. Ajustar C12, C13, a decisão 5 e
   o texto de formatar no console da T9 (menu exato, opção a escolher, quanto deixar livre). Se a
   evidência apontar que apagar `Xbox360/` é seguro, escrever a recomendação com a prova e deixar
   **uma** pergunta de sim ou não ao dono, porque apagar dados do console é decisão de produto.
3. **Nos dois backlogs:** atualizar a situação do R1 (o que a documentação respondeu, o que ainda
   depende de console).
4. **No bug do perfil** (este repo): se E responder a hipótese da Tarefa 5, uma nota curta nela,
   com link para cá. Não mudar o estado do bug.
5. **No bug de origem** (`digitalstoregamesproject`), opcional: uma linha sob "Testes que decidem"
   (T-a, T-b) apontando para o resultado. Seguir as regras daquele repo (commitar só o próprio
   arquivo).
6. **Se algo só se provar com console:** escrever o teste mínimo de campo para um cliente
   acompanhado pelo suporte (3 a 5 passos e os prints a pedir). Quem decide se pede é o dono.

## Não fazer nesta etapa

Código; publicação no R2; mudar o guia do agente (`fragments/instrucoes/xbox360.md`) ou o manual;
falar com clientes.

## Resultado (2026-10-11, sem console)

### A descoberta que muda as duas perguntas

O console tem **duas operações diferentes**, e a investigação começou supondo que só existia
a segunda:

1. **"Formatar"** (Armazenamento → destacar o pendrive → **Y** = *Opções do Dispositivo* →
   *Formatar*). Apaga tudo e deixa um FAT32 **comum, sem `Xbox360/`**. É o que o tutorial que o
   dono manda aos clientes (`Du5M9EvkvjE`) faz.
2. **"Configurar Agora" / "Personalizar"** (o assistente de armazenamento Xbox 360, ou *Criar
   Unidade do Sistema* num console sem armazenamento interno). Formata em FAT32 **e** cria a
   `Xbox360/` escondida, que guarda o armazenamento Xbox 360 (FATX dentro de arquivos
   `DataNNNN`). É ela que "enche" o pendrive.

Consequência direta: a falta de `Xbox360/` **não** diz que o console não formatou (P2), e o
problema de espaço da P1 some se o texto mandar usar **Formatar**, não **Configurar Agora**.

### Respostas A a H

**A. "Configurar Agora".**
- **Apaga tudo.** Ajuda oficial (2015): *"Configure Now: Erases the USB flash drive and configures
  32 GB for Xbox storage."* e *"Select Configure Now and confirm that you want to erase all data on
  the USB flash drive."* **[oficial]**
  (`http://web.archive.org/web/20150909161907id_/http://support.xbox.com/en-US/xbox-360/accessories/using-usb-flash-drive`).
  Na dashboard em pt-BR, vídeo `G8zs9lWXQFI` 1:04: *"Todo o conteúdo do dispositivo será removido e
  todo o espaço até 32 GB será reservado para armazenamento do Xbox 360. Se o armazenamento do
  dispositivo for maior que 32 GB, o espaço extra não poderá ser usado no seu Xbox."* e 1:22:
  *"Isso removerá todo o conteúdo do dispositivo e ele será configurado para armazenamento do Xbox
  360. Deseja continuar?"* **[vídeo]**
- **Quanto reserva:** tudo até 32 GB. O limite foi 16 GB em 2010 (*"configure how much storage to
  use on the device, up to 16 GB. The remaining space on the flash drive will be accessible by your
  PC or Mac."*, Major Nelson 2010-03-26, Wayback `20110426`) **[oficial]**. Subiu para 32 GB com a
  dashboard 16197 (outono de 2012; blog do FATXplorer, 2012-10-22, *"will allow USB devices to be
  formatted to use up to 32 GB"*) **[fórum]**. A ajuda oficial de 2019 já fala em 2 TB
  (`web.archive.org/web/20191015083532id_/...using-usb-flash-drive`) **[oficial, não aberta por
  mim: só pelo relatório do subagente]**. A dashboard 17559 dos clientes mostra "até 32 GB" (quadro
  de 1:04 acima), e isso vale para os clientes.
- **Espaço livre visto no celular/PC depois:** **[inferência]** sobre o oficial. O espaço
  configurado não é acessível ao PC (*"You can't view or access Xbox 360 information stored on your
  USB flash drive on a computer"*; *"The remaining space ... will be accessible by your PC"*). Logo:
  pendrive de 8, 16 ou 32 GB → praticamente **0** livre; 64 GB → ~32 GB livres. O número exato não
  tem fonte (ver D).

**B. "Personalizar".** Existe na 17559 **[vídeo]** `G8zs9lWXQFI` 1:10–1:16: *"Mova a barra deslizante
para ajustar quanto de espaço você deseja reservar para armazenamento do Xbox 360, após 512 MB serem
reservados para uso do sistema."*, barra "Armazenamento Reservado", 1,3 GB num pendrive de 1,9 GB.
Oficial: *"Customize: Configures a portion of the USB flash drive (up to 32 GB)."*, *"Move the
Reserved Storage slider..."*, *"Note 512 MB is reserved for system use."* **[oficial]**. O resto fica
livre para o PC (Major Nelson, citado em A) **[oficial]**. Mínimo e passo da barra: **sem fonte**.
Requisito de entrada: *"A minimum of 1 GB storage capacity."* e *"If the USB flash drive doesn't
have at least 1 GB of space available, the options on this screen are not available."* **[oficial]**.

**C. Formatar sem configurar: existe, e é o caminho dos tutoriais.**
- `Du5M9EvkvjE` (Horas Perdidas, 2025-12-11), quadros **[vídeo]**: 1:05–1:07 *Dispositivos de
  Armazenamento* lista Disco Rígido, Unidade de Memória, Jogos Salvos na Nuvem e **"Não
  Formatado"**; 1:08 *Opções do Dispositivo*: Renomear, **Formatar**, Limpar Cache do Sistema,
  Transferir Conteúdo; 1:09 *"Formatar Dispositivo — Isso removerá todo o conteúdo deste
  dispositivo. Deseja continuar?"* Sim; 1:11–1:14 *"Formatação em andamento. Não desligue o
  console."* **Nenhuma tela de Configurar/Personalizar.** No celular, 4:11, a raiz do "USB DRIVE"
  tem **só `LOST.DIR`** (criada pelo Android) — **sem `Xbox360/`** — e o celular monta e grava nele.
- `d3_AQKDejdE` (Fita Velha, 2025-08-15): diz *"aconselho formatar pelo Xbox 360"* (1:10), mas o
  quadro de 1:08 mostra que ele formatou **pelo celular** (Samsung, *"Formatar Armazenamento USB"*)
  **[vídeo]**.
- `s9b0X4TlUWg` (Werick H.T., 2026-09-02): não mostra a formatação; manda *"tenta formatar ele pro
  seu Xbox"* (1:33). A raiz do pendrive (volume `0EA0-19A2`) antes da cópia, 1:22, tem **só
  `LOST.DIR`** **[vídeo]**.
- `G8zs9lWXQFI` (Anderson Tutoriais, 2022-10-07): pendrive de 2 GB que já aparecia como
  *"Dispositivo USB — 1,8 GB livres"*; o menu Y tem **Formatar** e **Criar Unidade do Sistema**
  (console sem armazenamento interno: *"Seu console não tem uma unidade do sistema"*); ele escolhe a
  segunda → Configurar Agora/Personalizar → Aviso de Desempenho → *"Testando e configurando
  dispositivo de armazenamento"* **[vídeo]**.
- ConsoleMods (página Bad Update, cópia de 2026 na Wayback) **[wiki]**: *"Format your USB drive as
  FAT32 ... This can easily be done with the Xbox 360 dashboard's storage settings."*; e, só para
  console sem armazenamento interno: *"If the drive is already formatted as FAT32, you can go in the
  Device Options of the drive, and select the option Make System Drive to add the old Xbox360 file
  system. If the drive shows as "Unformatted" on the console, you can click Customize in the drive's
  settings to both format it as FAT32, and add the extra Xbox360 folder."*
- **Formatar num dispositivo JÁ configurado** (o que sobra da `Xbox360/`): **sem fonte**. Campo
  (cliente `275204458713286`, 2026-07-15): o menu de um pendrive configurado tinha *"Remover
  armazenamento"* e *"limpar cache"* (`[54457]`); o operador mandou *"Remover Armazenamento do Xbox"*
  (`[54461]`), o cliente: *"Pronto removi / O Xbox até reiniciou"* (`[54462]`, `[54463]`), depois
  *"Formatei"* (`[54477]`) **[campo, um caso, sem print]**.

**D. Os arquivos da `Xbox360/`.** Free60 (`free60.org/System-Software/Systems/FATX/`) **[wiki]**:
*"a hidden "Xbox360" folder located in the root of the device. The Data0000-Data0003 files are
always present no matter what the device size. The Data0000 file houses the Cache/USB System
Extended partitions, device performance information, and device geometry ... Data0001 contains the
file allocation table for the Data partition, which uses the remaining files."* e *"The
configuration is the first 2 sectors (0x400 bytes) of the Data0000"*. Velocity
(`github.com/hetelek/Velocity`, `XboxInternals/Fatx/FatxDrive.cpp:799-806`) abre
`F:/Xbox360/Data0000..Data0002` como um só `MultiFileIO`; `FatxDriveDetection.cpp:188` procura
`<letra>:\Xbox360` **[código]**. A pasta tem o atributo **oculto** (Free60) — no Windows não aparece
por padrão. Tamanho de cada arquivo e se são pré-alocados: **sem fonte direta**; o oficial (espaço
configurado inacessível ao PC, resto acessível) indica que o espaço é tomado na configuração
**[inferência]**.

**E. `Content/` da raiz com dispositivo configurado; o exploit.**
- README do BadUpdate e do ABadAvatar: só *"Format a USB stick to FAT32."* e a raiz com
  `BadUpdatePayload`, `Content`, `name.txt` **[código]**. Nenhum guia manda configurar; ConsoleMods
  manda **formatar** (C acima) e só cria a unidade do sistema para quem não tem armazenamento interno.
- **Achado novo (ConsoleMods) [wiki]:** *"Since the Xbox 360's stock dashboard will only read user
  data from the System Drive file system rather than the FAT32 file system, some of the files for
  Bad Update will need to be moved here as well."* — dentro da seção *"Creating & Using a System
  Drive"*, que *"is only for users that don't have any form of internal storage"*. O guia manda
  mover `Content/` para dentro da `Xbox360/` **com o FATXplorer no PC**. Ou seja: em console **sem
  HD e sem Unidade de Memória**, o perfil do exploit na raiz FAT32 não é lido, e o preparo
  (Windows ou celular) não basta.
- **Campo:** com pendrive/HD **sem `Xbox360/`** (preparado pelo Companion de Windows), o console
  lista *"Dispositivo USB — N GB livres"* e o exploit roda em produção: `[40915]` 284 GB, `[74095]`
  55,5 GB, `[96017]` 52,8 GB, `[111073]` 58,3 GB, `[127275]` 222 GB, `[73655]` 15,3 GB; perfis
  `ABadAvatar` visíveis em `[65307]`, `[102139]`, `[123858]` **[campo]**. Esses consoles têm
  *Unidade de Memória* ou *Disco Rígido*.
- **Exploit num pendrive COM `Xbox360/`:** nenhuma fonte diz que funciona ou falha (buscados README
  e *issues* dos três repositórios). **[inferência]** a raiz FAT32 continua sendo FAT32 (a
  configuração só acrescenta a pasta), então deve rodar; não provado.

**F. Apagar a `Xbox360/`.** Nenhuma fonte documenta apagar a pasta no PC como "desconfigurar", nem o
que o console faz depois. O oficial só descreve o caminho de volta pelo PC: *"format it to FAT32
again on the PC and then try the configuration process again"* (FAQ, sobre o pendrive que
*"reverted to its pre-configured state"*) e o que mora ali: *"your computer can't read the Xbox 360
custom folder ... This appears as a private folder named "Xbox 360""* **[oficial]**
(`web.archive.org/web/20150909120202id_/http://support.xbox.com/en-US/xbox-360/accessories/usb-flash-drive-faq`).
Apagar perde tudo o que o console guardou nela (perfis, saves, conteúdo) **[inferência]**. No
console há uma saída oficial: *Remover armazenamento* / *Formatar* (C, campo) — não precisa do app.

**G. Layout que o console deixa.** Sistema de arquivos: **FAT32** (o oficial exige FAT32; o celular
do `Du5M9EvkvjE` monta e grava depois do *Formatar*; ConsoleMods: *"If you have a Windows machine
and a USB drive that's bigger than 32 GB, you'll have to use the Xbox 360 dashboard to format the
USB drive"* → o console formata em FAT32 acima de 32 GB) **[oficial/vídeo/wiki]**. Campo:
`265880051138810` (2026-06-24) não conseguiu FAT32 no notebook num "pendrive de 2 tera"
(`[41309]`), o operador mandou formatar no console (`[41312]`), *"Tive q formatar mesmo"*
(`[41318]`) e em seguida copiou pelo PC (`[41321]`) **[campo]**. **Tabela de partição (MBR ou
"superfloppy" sem tabela), número de partições e cluster: sem fonte.** GPT aparece como "Não
Formatado" (BadBuilder issue #1, *"the Xbox 360 will pick up on the GPT drive as "Unformatted""*)
**[fórum]**, o que já está em `assessXboxLayout`. Se o console grava FAT32 **sem** tabela MBR, o
item (6) de C19 reprovaria um pendrive bom — ver a spec.

**H. Campo e vídeo: o BadAvatar roda num pendrive formatado no console (consultas abaixo).**

O produto é o **BadAvatar** (pacote `ABadAvatar 1.1 + AutoStart + Aurora + Freestyle + DashLaunch +
XeXMenu`, o mesmo do Companion), não o **Xploid** (pacote manual antigo, pelo Rock Band Blitz:
*"meu xploid não funciona mais, qdo ligo o Xbox não aparece o rock Band para executar"*, `[23217]`).
As provas abaixo separam os dois.

- **Prova em vídeo, BadAvatar [vídeo]:** `Du5M9EvkvjE`, do começo ao fim no mesmo console (Disco
  Rígido 179 GB + Unidade de Memória 638 MB, 1:05). O pendrive "Não Formatado" passa por **Y →
  Formatar** (1:08–1:14). O celular grava a pasta **"Via Avatar"** (3:44); a raiz fica `Aurora`,
  `BadUpdatePayload`, `Content`, `Simple 360 NAND Flasher`, `launch.ini`, `name.txt` (4:31). O
  console liga e mostra, na tela de perfis, o perfil **`ABadAvatar`** com a notificação
  *"ABadAvatar is FREE software! If you paid for it, demand a refund!"* (4:41–4:45), depois
  **XeUnshackle v1.03**, *"Todos os patches foram aplicados!"* (4:48), e **Aurora** (4:51). (Depois o
  vídeo mostra também o caminho do Rock Band Blitz, 4:53–5:05.) Limite: o vídeo é editado, e a
  continuidade do mesmo pendrive entre 1:14 e 4:31 é inferida pela narração.
- **Prova de campo, BadAvatar [campo]:** `265880051138810` (Douglas, 2026-06-24/25), console LT
  com Disco Rígido (`[41560]`). Deixou no pendrive a pasta *"AbadAvatar 1.1 + AutoStart + Aurora +
  F..."* (`[41290]`, `[41291]`). O notebook não oferecia FAT32 para o "pendrive de 2 tera"
  (`[41309]`), o operador mandou formatar no console (`[41312]`), *"Tive q formatar mesmo"*
  (`[41318]`), recopiou pelo PC (`[41321]`) e depois: *"Ele reconheceu no vídeo game"* (`[41601]`),
  *"Já fiz todo o processo e abriu o aurora"* (`[41605]`). Num LT, a Aurora só sobe pelo exploit. Não
  se sabe que opção do console ele usou (Formatar ou Configurar). Os erros `0x80070570` na cópia de
  jogos (`[41592]`) apontam para pendrive de capacidade falsa, não para a formatação.
- **Xploid num pendrive formatado no console [campo]:** `254691661344792`, pendrive de 64 GB,
  *"Vou tentar formatar o pendrive direto no xbox"* (`[31760]`), *"Consegui passar, mas o Xbox não
  abre"* (`[31885]`), *"Eu formatei novamente e estou extraindo"* (`[31895]`), *"Deu certo, agora
  tentar baixar os jogos"* (`[31957]`). Prova o pendrive, não o BadAvatar.
- **Inconclusivos:** `42146732204280` (HD de 128 GB formatado no console, `[47919]`; funcionou depois
  com outro dispositivo sem dizer como formatado, `[56554]`); `115358576943149` (HD de 976 GB
  *"formatado no Xbox"*, `[94745]`: o Windows o montou como `E:` (`[94743]`), mas o cliente
  reformatou no PC antes de preparar, `[94766]`); `142764763263025` (`[12256]`, sem desfecho);
  `275204458713286` (formatou no console, `[54477]`, e desistiu antes de extrair o `.rar`,
  `[54687]`).
- Os clientes de `[11254]`/`[11256]` (`53803088920826`) e `[24560]`–`[24596]` (`211278048026821`)
  **não seguiram** o caminho: o primeiro não respondeu; o segundo pediu estorno (*"meu celular é
  pebinha"*, `[24599]`).
- Operadores (`role='user'`), quase todos na época do Xploid, mandam formatar no console desde
  março: `[3047]` *"formata o pendrive
  pelo próprio Xbox 360"*, `[7169]`, `[40590]` *"Pode formatar direto no Xbox / E depois usar ele no
  Pc"*, `[41312]`, `[54272]`–`[54273]` *"formata o pendrive/hd direto pelo console / Ele vai formatar
  no formato correto: Fat32"*, `[51767]` *"pode formatar este formato tanto pelo console quanto pelo
  pc"*. Nenhum operador fala em Configurar/Personalizar.
- Ninguém relatou "pendrive cheio" ou "sem espaço" depois de formatar no console. A mensagem de
  espaço que aparece (`[114741]`, 190 MB para atualização) é do console sem armazenamento.

### Consultas e comandos (literais, com o número obtido)

Todas via `chamado.py sql` copiado para o scratchpad da sessão.

| consulta | linhas |
|---|---|
| a do ponto de partida (seção "Fontes") | 20 |
| `... WHERE (message LIKE '%Configure Now%' OR '%Configurar Agora%' OR '%Customize%' OR '%pasta "Xbox360"%' OR '%pasta Xbox360%' OR '%Data0001%' OR '%Data0002%' OR '%configurar o dispositivo%' OR '%configurar dispositivo%' OR '%Formatar dispositivo%' OR '%dispositivo de armazenamento%')` | 77 |
| `... WHERE role IN ('customer','user') AND (message LIKE '%Dispositivo USB%' OR '%Configurar Dispositivo%' OR '%Unidade de Mem%' OR '%Dispositivos de Armazenamento%' OR '%Memory Unit%' OR '%Não Formatado%' OR '%Unformatted%')` | 133 |
| `... WHERE role='user' AND message LIKE '%format%' AND (message LIKE '%xbox%' OR '%console%' OR '%videogame%' OR '%video game%')` | 31 |
| `WHERE id IN (11254,11256,24560,24593,24594,24595,24596)` + conversa de cada `main_phone` depois | 7; 2 e 51 |
| `... WHERE role='customer' AND message NOT LIKE '[IMAGEM]%' AND message LIKE '%format%' AND (message LIKE '%xbox%' OR '%console%' OR '%video game%' OR '%videogame%')` + conversa de cada candidato (`265880051138810`, `254691661344792`, `115358576943149`, `66842643148824`, `149482142482522`, `275204458713286`, `42146732204280`) | 69 |
| `... WHERE role='customer' AND (message LIKE '%pendrive%' OR '%pen drive%' OR '%pendraive%') AND (message LIKE '%cheio%' OR '%sem espaço%' OR '%espaço insuficiente%' OR '%não tem espaço%' OR '%nao tem espaco%' OR '%lotado%')` | 4, nenhuma ligada a formatar no console (`[61753]`, `[93466]`, `[96061]`, `[102070]`: todas sobre baixar jogos) |

Vídeos: `yt-dlp 2026.08.19` (binário oficial; o `2026.07.04` do sistema leva 403), `-f 135`,
legenda automática pt; quadros por OpenCV a cada 1–3 s em volta do minuto. Páginas oficiais: `curl`
das cópias `id_` da Wayback e extração do texto. Velocity: `curl raw.githubusercontent.com/hetelek/Velocity/master/XboxInternals/Fatx/FatxDrive.cpp | grep -n Data000`.

### Hipóteses descartadas

- **"Formatar no console = Configurar Agora".** Era a premissa da P1 e do R1. Descartada pelos
  quadros do `Du5M9EvkvjE` (Formatar sem configurar) e pelo ConsoleMods.
- **"A `Xbox360/` prova que o console formatou."** Descartada: o *Formatar* não a cria, e é o caminho
  dos tutoriais e dos operadores.
- **`[128689]` "HD formatado pelo Xbox não aparece no PC"** como dado de FATX: era um **Xbox One**
  (prints `[128403]`, `[128416]`, `[128650]`).
- **Os 3 tutoriais usam "Configurar agora".** Nenhum usa: um usa *Formatar*, um formata no celular,
  um não mostra.
- **"Nenhum cliente rodou o exploit num pendrive formatado no console"** (afirmado na primeira
  passada desta sessão, a partir só dos dois clientes que receberam o vídeo). Errado: o próprio
  `Du5M9EvkvjE` mostra o BadAvatar rodando, e o cliente `265880051138810` abriu a Aurora pelo
  BadAvatar num pendrive formatado no console (H). A primeira busca também misturava conversas do
  Xploid com as do BadAvatar.

### Revisão: as perguntas a clientes, avaliadas antes por pesquisa (2026-10-11)

Pedido do dono: *"Estas perguntas a clientes, deveriam ser avaliadas antes via pesquisa"*. Cada
pergunta que esta investigação deixava para um cliente foi pesquisada primeiro. Resultado:
**nenhuma pergunta a cliente continua necessária.**

**Fonte nova: ConsoleMods, página "Files and Directories"**
(`https://consolemods.org/wiki/Xbox_360:Files_and_Directories`) **[wiki — página NÃO aberta: o
site devolve 403 a `curl` e WebFetch, e a Wayback estava "Temporarily Offline"; os trechos abaixo
vieram do buscador (`WebSearch` restrito a `consolemods.org`) e precisam ser conferidos na página
quando ela abrir]:**
- *"If the drive is formatted as FAT32 with an MBR partition table, but does not have an Xbox360
  folder, the drive is already in the "modern" format and ready to be used."*
- *"Before Dashboard version 2.0.17349.0, external storage connected through the USB ports had a
  strict requirement to have a FATX file structure on a FAT32 USB drive"* (limite de 32 GB).
- *"If the drive shows up as Unformatted, select it and click Format. The drive is now formatted as
  FAT32 and ready to be used."*; depois, criar `Content` na raiz pelo PC; o console trata a raiz
  como o armazenamento interno.
- Converter um pendrive no formato antigo: fazer backup da `Xbox360/`, extrair o `Content` de
  dentro dela com FATXplorer/Horizon/USB XTAF Explorer, **apagar a `Xbox360/`** e pôr o `Content`
  na raiz.
- **Precedência:** a pasta `Xbox360` *"takes precedence over Content. If it exists and there's data
  in it, you will switch to the old format."*
- *"normal FAT32 storage without the Xbox 360 System Drive folder also can't install the extra data
  required for the Kinect or avatars"*.

**Cada pergunta, e o que a pesquisa respondeu:**

| pergunta que ia para cliente | resposta pela pesquisa | ainda pedir a cliente? |
|---|---|---|
| Tabela de partição que o *Formatar* deixa (C19 item 6) | "modern format" = FAT32 **com MBR**, sem `Xbox360/`; o *Formatar* deixa o pendrive nesse formato, *"ready to be used"* [wiki, a conferir]. Some com o que já se sabe: o console lista GPT como "Não Formatado" (BadBuilder #1), e o MBR com uma partição é o que roda em produção (Companion) | **não** — C19(6) continua informativo até a página ser conferida; o primeiro pendrive real fecha sem pergunta |
| O exploit roda com `Xbox360/` presente? | **Provavelmente não**: com dados na `Xbox360/`, o console usa o formato antigo e a `Content/` da raiz deixa de valer [wiki, a conferir] — o perfil do BadAvatar mora em `Content/E0002FF78DFBDE7B/` na raiz | **não** — a spec passa a recusar pendrive com `Xbox360/` (C12) e manda formatar no console |
| O que o *Formatar* faz num pendrive já configurado | Não respondido diretamente. Deixa de importar: com C12 recusando `Xbox360/`, o próprio app confere o resultado quando o pendrive volta (se a pasta continuar lá, recusa de novo e diz o que fazer) | **não** |
| Apagar a `Xbox360/` é seguro? | É o caminho **documentado** de conversão para o formato moderno, mas **perde o que está dentro** se não for extraído com uma ferramenta de PC [wiki, a conferir] | **não** — o app continua sem apagar (decisão 5); o *Formatar* no console resolve |
| #66: o console tem Disco Rígido ou Unidade de Memória? | **Tem armazenamento interno** [campo + inferência]: o print `[105347]` mostra 3 perfis **locais** coloridos ("Kichi lacrei", "raffaella", "rogato"); perfil local precisa de onde morar, e o pendrive dele vinha formatado pelo Companion. O chamado fechou com estorno em 2026-09-23 | **não** (e não há a quem perguntar) |
| BadAvatar num pendrive preparado só pelo app (C27) | Equivalência no PC (C19) + BadAvatar já provado em pendrive formatado no console (H) | sai naturalmente com o primeiro cliente do app; não é pergunta |

**Tentativas que não renderam (registrar para não repetir):**
- Telemetria (`error_logs`, `errors` via `/diag/query`): o log do Companion só grava `layout do
  disco: ...` desde as versões recentes — `SELECT ... FROM error_logs WHERE content LIKE '%layout do
  disco%'` → **1 linha** (2026-10-09, pendrive de 15 GB preparado pelo próprio Companion: `MBR, 1
  particao, tipo 12, setor 512/512, FAT32 -> o Xbox 360 le`); `LIKE '%Layout de chegada%'` → **0**.
  O cliente do HD de 976 GB *"formatado no Xbox"* (`[94745]`, 2026-09-03) não deixou log com o
  disco (busca por `976` nos logs de 2026-09-03 17h a 09-04 03h → 4 linhas, todas despejo de DLLs).
- Busca web geral por tabela de partição do *Formatar* (guias de EaseUS, AOMEI, fóruns): nada
  direto.
- Conversa `[90994]` ("pasta Xbox360"): era a pasta do emulador de **Xbox One**, não a do console.

**Achado que pesa no bug do perfil (registrado lá):** o Companion de Windows não procura nem trata
a `Xbox360/` (`grep -ri xbox360 src/electron-app/**/*.ts` → só nomes de pasta de jogos em
`localGameScannerService.ts`). Um pendrive que o cliente **configurou no console** e depois
preparou **sem** "Formatar antes" mantém a `Xbox360/`; pela precedência acima, o console ignoraria
o perfil da raiz — o sintoma exato do bug.

### O que continua sem prova

1. **Conferir na página do ConsoleMods** os trechos acima (precedência da `Xbox360/`, MBR do
   formato moderno). Só leitura; refazer `curl` da Wayback quando ela voltar. Muda C12 se a
   precedência não estiver escrita lá.
2. O BadAvatar num pendrive preparado só pelo app (C27) — sai com o primeiro cliente, sem pergunta
   extra.

## Frase de abertura da próxima sessão

Esta investigação terminou. A próxima frente é a implementação da spec (frase no fim de
`docs/specs/xbox-companion-android-v1-preparo_2026-10-11.md`).
