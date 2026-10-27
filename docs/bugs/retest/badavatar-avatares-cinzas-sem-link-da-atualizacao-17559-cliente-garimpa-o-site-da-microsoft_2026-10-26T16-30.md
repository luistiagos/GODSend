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

## Causa raiz (2026-10-27, sessão de correção)

Três defeitos no mesmo passo, todos provados no código ou na rede:

1. **O app não tem como abrir um link externo.** `src/electron-app/app/window.ts::createWindow` (linha 165) faz
   `setWindowOpenHandler(() => ({ action: "deny" }))`, e `will-navigate` só aceita o próprio `index.html`
   (`infrastructure/navigationPolicy.ts::isAllowedApplicationNavigation`). `grep -rn "shell.openExternal"
   src/electron-app` → **0** ocorrências. Então nem um `<a href>` resolveria: o clique seria negado em silêncio.
   Por isso o passo 2 de `BadAvatarUsbPage.tsx` (linha 682) só nomeia o arquivo.
2. **O link existe e é estável, mas fica escondido.** A página `support.xbox.com/.../system-updates-info` é
   montada por JavaScript e o link mora dentro de "Como atualizar", seção recolhida (o `curl` devolve 2.909 bytes
   sem conteúdo). Renderizada com o Edge (Playwright) e expandida, a seção "Copiar para uma unidade flash USB"
   aponta para `https://www.xbox.com/system-update-usb`, e:
   `curl -sIL https://www.xbox.com/system-update-usb` → `307 /pt-BR/system-update-usb` → `301
   https://download.microsoft.com/download/8/f/4/8f456817-e264-4207-9b95-6efc990fee98/SystemUpdate_17559_USB.zip`
   → `200`, `Content-Length: 115992188` (o mesmo `SystemUpdate_17559_USB.zip` que o cliente achou, [155505]).
3. **O texto do app manda renomear para `$$SystemUpdate` no fluxo errado.** O bloco só aparece com
   `!isRghOnly` (linha 630; `isRghOnly === false` é o botão "Xbox Bloqueado ou LT", linha 378), e o passo 4
   (linha 688) diz "Importante para RGH". Console bloqueado/LT roda o kernel da Microsoft, que procura a pasta
   oficial `$SystemUpdate` (é o que o zip traz). O cliente deste chamado manteve `$SystemUpdate` e a Aurora abriu
   ([155541]); o do chamado #254 também atualizou 17349 → 17559 com `$SystemUpdate` (doc
   `badavatar-hd-preparado-nao-dispara-...`, [145371]). O guia do agente já diz o mesmo (passo 3).
   O mesmo `$$SystemUpdate` está em `docs/SUPPORT_AGENT_KB.md:176`, `docs/BASE_CONHECIMENTO_SUPORTE_WHATSAPP.md:176`,
   `docs/MANUAL-JOGOS-XBOX-COMPANION.md:101` e `docs/tutorial_usuario_leigo.md:82`, todos no caso "console travado".

A pasta dentro de outra pasta (sintoma 6) vem do "Extrair tudo"/WinRAR, que por padrão cria
`SystemUpdate_17559_USB\`; nenhum texto do app diz que `$SystemUpdate` precisa ficar na raiz.

## Hipóteses descartadas

- **Link direto para `download.microsoft.com`:** funciona hoje, mas o GUID do caminho é o que a Microsoft troca
  quando move o arquivo. `www.xbox.com/system-update-usb` é o link que a própria página oficial usa; fica ele.
- **O app baixar a 17559 e gravá-la no pendrive:** resolveria também o zip e a pasta aninhada, mas é funcionalidade
  nova (download + extração + escolha de dispositivo, ~116 MB), não correção. Fica como sugestão ao dono.
- **Liberar `window.open` para qualquer `https:`:** abriria o navegador para qualquer URL que aparecesse no
  renderer. A liberação é por lista exata de URLs.
- **"Zip corrompido" no WinRAR (sintoma 6) como defeito do arquivo:** o arquivo oficial responde 200 com 115.992.188
  bytes; o `(1)` no nome indica segundo download, e o mais provável é download incompleto. O texto passa a dar o
  tamanho esperado (~110 MB) para o cliente conferir. Não verificado no PC do cliente.

## Correção planejada

- `infrastructure/navigationPolicy.ts`: `XBOX360_SYSTEM_UPDATE_USB_URL` e `isAllowedExternalLink(url)` (lista exata).
- `app/window.ts::createWindow`: `setWindowOpenHandler` abre no navegador (`shell.openExternal`) só o que
  `isAllowedExternalLink` aceita; segue negando a janela nova.
- `renderer/components/BadAvatarUsbPage.tsx`, "Como corrigir os avatares cinzas": passo 2 com o link
  (`target="_blank"`, importado da constante), tamanho esperado; passo 3 "extraia na raiz do pendrive, a pasta
  `$SystemUpdate` não pode ficar dentro de outra pasta"; remover o passo de renomear para `$$SystemUpdate`.
- Prova: `tests/unit/navigationPolicy.test.cjs` — a URL da 17559 é aceita; variações (`http:`, outro caminho,
  outro host, `javascript:`) são recusadas. `test:safety` verde; `renderer:build` sem erro.
- Docs do atendimento deste repo (as 4 linhas acima): link + `$SystemUpdate` na raiz.
- **Fora deste repo:** o guia do agente (`digitalstoregamesproject/.../guias/xbox360_badavatar.md`, passo 1)
  continua sem o link. Está sob a moratória de prompts (doc + eval + aprovação do dono): não é editado aqui.

## Tasks

| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | app abre o link oficial da 17559 e o texto do bloqueado/LT manda `$SystemUpdate` na raiz | -- | -- | -- | -- |
| T2 | guia do agente (digitalstoregamesproject) com o link — moratória, pendente do dono | -- | backlog | -- | -- |

## Correção aplicada (2.12.118)

Seguiu a correção planejada, sem desvio de código:

- `infrastructure/navigationPolicy.ts`: `XBOX360_SYSTEM_UPDATE_USB_URL` + `isAllowedExternalLink` (Set de URLs exatas).
- `app/window.ts::createWindow`: `setWindowOpenHandler(({ url }) => …)` chama `shell.openExternal` só para URL
  aceita e continua devolvendo `deny`.
- `BadAvatarUsbPage.tsx`: passo 2 com o link (constante importada, `target="_blank"`) e o tamanho (~110 MB); passo 3
  "extraia direto na raiz", `E:\$SystemUpdate`, "não renomeie"; o passo de `$$SystemUpdate` saiu. A frase de abertura
  "para não perder o destrave RGH" também saiu: o bloco só aparece no fluxo bloqueado/LT.
- Docs do atendimento deste repo: as quatro linhas com `$$SystemUpdate` agora dão o link e `$SystemUpdate` na raiz.
  `AGENTS.md` (`app/`) registra a regra da lista exata; `docs/features.md` ganhou o item na seção BadAvatar.
- `renderer-dist` reconstruído (`npm run renderer:build`). Versão 2.12.118 nos quatro arquivos + CHANGELOG.

T2 (guia do agente no `digitalstoregamesproject`) **não** foi feita: moratória de prompts.

## Testes executados (2026-10-27)

- `npm run test:safety` (em `src/electron-app`): tsc + typecheck do renderer + **361 pass / 0 fail**. O teste novo
  `link externo: só a atualização 17559 oficial, pela URL exata` falha sem a mudança (o export não existe).
- App real, Playwright + Electron sobre o `renderer-dist` novo (script de rascunho derivado de
  `tests/electron/badavatar-preview-smoke.cjs`): "Xbox Bloqueado ou LT" → Avançar → abre "Como corrigir os avatares
  cinzas" → nenhum `$$SystemUpdate` na tela → clique no link. `shell.openExternal` (stub no main) recebeu
  `["https://www.xbox.com/system-update-usb"]`; nenhuma janela nova; a página continuou em `file:///…`.
- `curl -sIL https://www.xbox.com/system-update-usb` → `200`, `Content-Length: 115992188` (2026-10-27).

**Falta para fechar:** publicar a 2.12.118 e um cliente com avatares cinzas baixar pelo link do app. Não verificado:
se o `$SystemUpdate` instala só o dado de avatar num console que já está na 17559 (o caso do doc
`badavatar-hd-preparado-nao-dispara-...` diz que não oferece nada); isso é daquele bug, não deste.
