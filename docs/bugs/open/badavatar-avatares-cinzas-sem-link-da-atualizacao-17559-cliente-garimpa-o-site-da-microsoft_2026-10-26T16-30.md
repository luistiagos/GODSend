# Bug: com os avatares cinzas, nem o Companion nem o atendimento dão o arquivo da atualização 17559 — o cliente garimpa o site da Microsoft, desiste no notebook e leva três dias para chegar à Aurora

- **Detectado em:** 2026-10-26 16:30 (chamado **#261**, sessão `168654842908762@lid`, telefone `5547991025596`)
- **Origem:** conversa de suporte lida inteira (192 mensagens, 13/10 → 26/10, skill `sessao-whatsapp`) + leitura de
  `src/electron-app/renderer/components/BadAvatarUsbPage.tsx` (seção dos avatares cinzas) e do guia do agente
  `digitalstoregamesproject/digitalstoregamesbackend/mysite/templates/prompts/fragments/guias/xbox360_badavatar.md`
- **Errors (serviço):** N/A (não há erro de app; é o passo que o app deixa para o cliente)
- **Classe:** fricção de fluxo / diagnóstico (o requisito é conhecido; falta o meio de cumpri-lo)
- **Severidade:** **P2 — Médio** (provisória): não perde dado, mas bloqueia o uso até o cliente achar o arquivo
  sozinho, e é o motivo mais comum de o BadAvatar não disparar (o próprio guia do agente diz isso).
- **Reincidência:** primeira vez registrado **nesta forma**. Avatares cinzas aparecem em dezenas de conversas
  (ver [[badavatar-hd-preparado-nao-dispara-com-avatares-cinzas-no-console-onde-o-pendrive-funcionou_2026-10-22T23-00]],
  seção Reincidência); o que este doc registra é a falta do arquivo, não a causa dos avatares.

## Sintoma, na ordem que o cliente viveu (UTC)

1. **23/10 20:58** ([153034]): print da tela de perfis com `ABadAvatar` cinza; [153042] *"sim está sem rosto"*.
2. **21:02** ([153041]) o agente: *"No computador, baixe a atualização oficial de sistema da Microsoft, versão
   17559"*; **21:16** ([153060]): *"Pesquisa exatamente assim: atualização de sistema Xbox 360 17559 Microsoft"*.
3. **21:15** ([153059]) o cliente: *"pow tá complicado pra conseguir joga esses jogos"*.
4. **21:19 → 21:23**: o cliente está na página `support.xbox.com/pt-BR/help/xbox-360/console/system-updates-info`
   ([153081]) e não acha o download: [153071] *"n aparece ND para baixar nesse site"*, [153087] *"esse eh o
   final"*, [153090] *"n tem essa opção"*, [153095] *"n destacou ND"* (depois do Ctrl+F sugerido). O agente
   adivinha o layout da página quatro vezes ([153077], [153082], [153089], [153092]) e às 21:23 abre o chamado
   ([153098]).
5. **21:45** ([153106]): *"achei o link pelo celular"*.
6. **26/10 14:30 → 14:49**: o zip no HD não extrai (WinRAR: *"O arquivo está corrompido"*, [155517]), a pasta
   `$SystemUpdate` fica dentro de `SystemUpdate_17559_USB (1)` ([155525]) até o cliente movê-la ([155527]).
7. **26/10 14:55** ([155541]): a Aurora abre (*"Scanning for new Title Updates..."*), no mesmo console e com o
   mesmo HD que em 23/10 só mostravam o `ABadAvatar` cinza.

## Evidência

- **App:** `BadAvatarUsbPage.tsx` (786 linhas), seção "Como corrigir os avatares cinzas" (linhas 673-691): o
  passo 2 é *"Baixe no PC a atualização oficial de sistema da Microsoft correspondente à sua versão exata (ex:
  Xbox 360 System Update 17559)"*, sem link nem botão. A mesma seção (linha 688) manda **renomear para
  `$$SystemUpdate`** ("Importante para RGH"), e o bloco inteiro só aparece com `!isRghOnly` (linha 630), isto é,
  no fluxo bloqueado/LT. Contradiz o guia do agente (abaixo). O cliente deste chamado seguiu o agente
  (`$SystemUpdate`) e a Aurora abriu em seguida ([155541]); a conversa não traz o print da atualização aplicada.
- **Guia do agente** (`fragments/guias/xbox360_badavatar.md`, seção "os avatares estão cinzas", passo 1): *"No
  PC, baixar a atualização oficial de sistema da Microsoft da versão 17559"*, sem link. Passo 3: em
  bloqueado/LT, **manter `$SystemUpdate`** e não renomear para `$$SystemUpdate`.
- O nome do arquivo que o cliente acabou baixando é `SystemUpdate_17559_USB.zip` ([155505]).
- Custo medido nesta conversa: ~45 min de 23/10 (21:02 → 21:45) e ~25 min de 26/10 (14:25 → 14:49), mais um
  chamado (#261) aberto por causa desse passo.
