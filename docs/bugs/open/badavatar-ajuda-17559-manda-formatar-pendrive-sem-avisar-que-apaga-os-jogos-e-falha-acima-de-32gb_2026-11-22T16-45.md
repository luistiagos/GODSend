# Bug: ajuda "Como corrigir os avatares cinzas" manda formatar "um pendrive em FAT32" sem avisar que apaga o pendrive do BadAvatar nem que o Windows não faz FAT32 acima de 32 GB

- **Detectado em:** 2026-11-22 16:45 (análise da sessão de WhatsApp `9900050616500@lid`, pedido do dono; chamado `#426` do painel)
- **Origem:** conversa de suporte + leitura de `src/electron-app/renderer/components/BadAvatarUsbPage.tsx` (v2.12.131, `376e011`), bloco `<details>` "Como corrigir os avatares cinzas (instalar dados de avatar/Kinect)?", passo "Prepare o pendrive"
- **Classe:** diagnóstico / texto de ajuda que leva a perda de dados do cliente
- **Severidade:** **P3 — Baixo** (texto de UI); o custo medido neste caso foi alto: o cliente formatou o único pendrive (128 GB) e perdeu 12 jogos já baixados, e pediu cancelamento. Neste episódio quem conduziu foi o agente de WhatsApp, não a ajuda — ver "Escopo".
- **Complexidade:** baixa — só texto da ajuda (opcional: botão que prepara o pendrive de atualização, ver Tarefas)
- **Versões:** cliente na `v2.12.130`→`v2.12.131` (print `[194279]`); texto conferido na `v2.12.131`
- **Reincidência:** primeira vez registrada neste repositório

## Sintoma, na ordem que o cliente viveu (UTC)

1. **2026-11-19:** cliente (Xbox 360 Slim bloqueado) prepara pelo Companion um pendrive de 128 GB
   (117,2 GB) em "Xbox Bloqueado ou LT" com **Formatar antes**; o app formata em FAT32 e termina
   com "Pronto! O pendrive está preparado para o Xbox 360." (`[190311]`).
2. **2026-11-21:** baixa 12 jogos para esse pendrive pela fila do Companion (`[192984]`, `[193157]`).
3. **2026-11-22 14:25:** o perfil `ABadAvatar` não aparece; o agente de WhatsApp manda instalar a
   atualização 17559 por pendrive FAT32 (o mesmo procedimento desta ajuda).
4. O cliente só tem esse pendrive. Formata pelo Explorador do Windows: em 117 GB só há exFAT/NTFS
   (`[194050]`); o Xbox mostra o pendrive como "Não Formatado" (`[194128]`). Formata com programa
   externo, aplica a atualização e o console responde que **já está atualizado** (`2.0.17559.0`,
   `[194252]`, `[194258]`). Os jogos foram perdidos ("Não salvei", `[194264]`).

## Evidencia

- `BadAvatarUsbPage.tsx`, passo "Prepare o pendrive" (texto literal): "Formate um pendrive em
  **FAT32** e extraia o ZIP **direto na raiz** dele." Não diz que deve ser um pendrive diferente
  do preparado para o BadAvatar, nem que formatar aquele apaga os jogos, nem como conseguir FAT32
  acima de 32 GB no Windows (o formatador do Windows não oferece FAT32 nesse tamanho).
- O próprio Companion formata FAT32 acima de 32 GB ("Formatar antes", `[190256]` "Formatando para
  FAT32...", `[190311]` FAT32 em 117,2 GB) — a ajuda não aproveita isso.
- Um pendrive já preparado pelo Companion **já está em FAT32**: bastaria copiar `$SystemUpdate`
  para a raiz dele, sem formatar. *Não testado se o console aplica a atualização com os arquivos do
  BadAvatar no mesmo pendrive* — conferir antes de escrever isso na ajuda.
- A referência dos agentes de WhatsApp (`digitalstoregamesbackend/mysite/templates/prompts/instructions/xboxcompanion_agents_guide.md`)
  diz "Extrair em **outro** pendrive FAT32"; a ajuda do app não diz "outro".
- A ajuda "Como verificar a versão do sistema" está correta (ler ao lado de **Painel:**, exemplo
  `2.0.17559.0`). O `$$SystemUpdate` que existia numa versão antiga (`v2.12.26`) já foi trocado por
  "Mantenha o nome `$SystemUpdate`, com um cifrão" — não é este bug.

## Causa raiz

Provada pela leitura do texto: o passo "Prepare o pendrive" omite (a) usar outro pendrive ou o
efeito de formatar o do BadAvatar e (b) a limitação de FAT32 > 32 GB no Windows.

## Escopo — o que NAO e este bug

- O agente de WhatsApp concluir sem prova que o console não estava na 17559 e mandar formatar o
  pendrive com os jogos: `digitalstoregamesproject`,
  `docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-11-22-agente-xbox360-conclui-dashboard-fora-da-17559-sem-ler-o-numero-e-manda-formatar-o-pendrive-com-os-jogos.md`.
- O perfil `ABadAvatar` não aparecer na tela de perfis com 17559, avatares coloridos, console
  offline e raiz correta (`BadUpdatePayload`, `apps`, `Aurora`, `Content`, `games` em `BADAVATAR (D:)`,
  `[193982]`): causa desconhecida, sem investigação neste doc.

## Tarefas propostas / Proximos passos

- **T1** — reescrever o passo "Prepare o pendrive": usar **outro** pendrive (formatar o do BadAvatar
  apaga os jogos); acima de 32 GB o Windows não oferece FAT32 — usar um pendrive de até 32 GB ou
  formatar pelo próprio Companion ("Formatar antes"). Prova: snapshot/teste do texto do componente.
- **T2** (opcional, feature) — botão "Preparar pendrive de atualização 17559" que formata em FAT32
  (qualquer tamanho), baixa `SystemUpdate_17559_USB.zip`, confere ~110 MB e extrai `$SystemUpdate`
  na raiz. Antes de T2, testar em console se `$SystemUpdate` convive com o BadAvatar no mesmo
  pendrive (se sim, o botão nem precisa formatar).
