# Investigação: o que o Xbox 360 faz com o pendrive ao formatar ou configurar (perguntas 1 e 2 da spec Android v1)

- **Estado:** aberta em 2026-10-11, **a fazer por outra sessão**. Nada investigado ainda além do que
  está em "O que já se sabe".
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

## Frase de abertura da próxima sessão

*"Leia `docs/backlog/xbox360-pendrive-formatado-no-console-investigacao_2026-10-11.md` no repo
`C:\projects\Downloader-XBOX360-XEX-HDD-Games` e responda as perguntas A a H sem console, por
conversas de clientes, quadros dos vídeos, documentação oficial e código de ferramentas abertas.
Grave o resultado nesse doc e atualize a spec da v1 Android (perguntas 1 e 2, C12, C13, decisão 5,
T9), os backlogs (R1) e o bug do perfil, como descrito em 'O que gravar, e onde'."*
