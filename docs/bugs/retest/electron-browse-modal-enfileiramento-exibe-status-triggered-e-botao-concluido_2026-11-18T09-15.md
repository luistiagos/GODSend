# Bug: Modal de enfileiramento no catalogo exibe `"Na fila! Status: triggered"` e botao `"Concluído"`, induzindo o usuario a achar que o jogo ja terminou de baixar

- **Detectado em:** 2026-11-18 09:15 (chamado #286 do painel, sessao `144384049869026@lid`, `allyssonbastos@gmail.com`)
- **Origem:** conversa de suporte + leitura de `src/electron-app/renderer/components/BrowsePage.tsx` (`QueueDialog`, L658-701) e `src/server/interfaces/http/handlers.go` (respostas `"status": "triggered"`)
- **Errors (serviço):** N/A (texto/UX de confirmacao na UI)
- **Classe:** ux (feedback enganoso apos enfileirar download)
- **Severidade:** **P2 — Medio** (matriz de `bug-triage.md`: induz o usuario leigo a desconectar o pendrive imediatamente apos enfileirar o jogo, levando-o ao console sem o jogo gravado)
- **Complexidade:** **baixa** (`docs/bugs/open/README.md` — texto/acao de modal em componente React `BrowsePage.tsx`)
- **Versões:** observado em `v2.12.118` (`2026-10-29`); codigo identico no `HEAD` atual (`v2.12.130`, `BrowsePage.tsx:669,698`)
- **Reincidência:** primeira vez registrado

## Sintoma

Ao clicar em **Adicionar à fila** na tela de detalhes de um jogo no catalogo, o modal exibe em verde:

> `Na fila! Status: triggered`

com um unico botao abaixo escrito **`Concluído`**.

No chamado `#286` (`2026-10-29`), o cliente adicionou `Call of Duty - Black Ops III` (`3.55 GiB`) para o pendrive, viu `"Na fila! Status: triggered"` e `"Concluído"` (`[159357]`), acreditou que a gravacao ja havia terminado, tirou o pendrive e ligou no Xbox 360:

- `[159359]` (15:26:25 UTC): *"É assim mesmo?"*
- `[159361]` (15:27:12 UTC): *"Foi muito rápido, deu tempo de baixar o jogo?"*
- `[159367]` (15:33:08 UTC): enviou novo print do modal mostrando `"Na fila! Status: triggered"` e `"Concluído"`.

O agente precisou explicar manualmente (`[159368]`): *"Esse 'Concluído' é só a confirmação de que o jogo entrou na fila, não que o download terminou"*, e orientar o cliente a ir ate a aba **Fila** e esperar o status **Pronto** antes de remover o pendrive (`[159362]`, `[159368]`).

## Evidência

- **Conversa (`Wpp_proccess`, sessao `144384049869026@lid`):** `[159357]`, `[159359]`, `[159361]`, `[159367]`.
- **Codigo aberto (`HEAD` `v2.12.130`):**
  - `src/server/interfaces/http/handlers.go` (L629, L662, L682, L704, L741, L755, L1149): endpoints de disparo/retomada respondem JSON `{"status": "triggered", ...}` significando que o job foi disparado em segundo plano.
  - `src/electron-app/renderer/components/BrowsePage.tsx:659-700`:
    ```tsx
    {result.ok
      ? isMultiDiscGame
        ? `Todos os ${discsToQueue.length} discos foram adicionados à fila com sucesso!`
        : `Na fila! Status: ${result.status}`
      : result.error}
    ...
    <Button variant="outline" className="w-full" onClick={onClose}>
      Concluído
    </Button>
    ```

## Causa raiz

Confirmada no codigo:

1. `BrowsePage.tsx:669` interpola literalmente `result.status` (`"triggered"`, termo tecnico em ingles do backend Go em `handlers.go`) em vez de uma mensagem clara em portugues explicando que o download/gravacao comecou em segundo plano e deve ser acompanhado na aba **Fila**.
2. `BrowsePage.tsx:698` rotula o botao de fechamento do modal como **"Concluído"** mesmo quando a operacao que acabou de ocorrer foi apenas o enfileiramento do download (que pode levar minutos ou horas para concluir e gravar no pendrive).

## Como reproduzir

1. Abrir **Baixar Jogos** no Xbox 360 Companion e selecionar qualquer jogo de disco unico.
2. Escolher o destino e clicar em **Adicionar à fila**.
3. Observar a caixa verde `"Na fila! Status: triggered"` e o botao `"Concluído"` logo abaixo.

## Escopo — o que NAO e este bug

- Nao trata falhas de rede/API ao enfileirar (`queueFailureReason`), ja tratadas em `closed/electron-browse-queue-game-erro-desconhecido-sem-motivo_2026-09-05T12-00.md`.

## Resolução (v2.12.131 / Unreleased)

1. Criado o helper puro `buildQueueSuccessFeedback` em `src/electron-app/infrastructure/browseQueueFeedback.ts` para compor as mensagens de confirmação em português após enfileirar:
   - Disco único: `"Adicionado à fila!"`
   - Multidisco: `"Todos os N discos foram adicionados à fila!"`
   - Orientação para destino USB (`local`): `"O download e a gravação começaram em segundo plano. Acompanhe na aba Fila até aparecer “Pronto” antes de desconectar o pendrive."`
   - Orientação para destino FTP (`ftp`): `"O download e o envio para o console começaram em segundo plano. Acompanhe o progresso na aba Fila até aparecer “Pronto”."`
   - Rótulos dos botões: `"Entendi"` (fechar modal) e `"Ir para a Fila"` (atalho direto para a aba **Fila**).
2. Em `src/electron-app/renderer/components/BrowsePage.tsx` (`QueueDialog`) e `src/electron-app/renderer/App.tsx`:
   - Removida a interpolação de `result.status` (`"triggered"`) e substituída pelo bloco `role="status"` com `queueSuccessFeedback.headline` e `queueSuccessFeedback.guidance`.
   - Substituído o botão `"Concluído"` por `"Entendi"`, acompanhado do botão `"Ir para a Fila"` conectado a `navProps.onNavigateQueue`.

## Testes Automatizados

- `src/electron-app/tests/unit/browseQueueFeedback.test.cjs`: valida as mensagens para disco único (USB), multidisco (USB) e FTP, garantindo ausência de `"triggered"`, `"Status:"` e `"Concluído"`, além de verificação estática de `BrowsePage.tsx`.
- `src/electron-app/tests/electron/browse-queue-dialog-smoke.cjs`: monta a `BrowsePage` real em Chromium via Electron + Vite, simula enfileiramento com resposta `{"status": "triggered"}` nos fluxos disco único USB e multidisco FTP, confirma a exibição das mensagens e botões corretos e valida a navegação pelo botão `"Ir para a Fila"`.

## Critérios para fechar

- [x] Texto `"Na fila! Status: triggered"` substituido por orientacao clara em portugues sem termo tecnico cru
- [x] Botao `"Concluído"` substituido por rotulo que nao sugira fim do download/gravacao
- [x] `npm run test:safety --prefix src/electron-app` aprovado (447/447 testes unitários + `tsc` + `renderer:typecheck`)
- [ ] Validação em build publicado / usuário final (movido para `docs/bugs/retest/`)
