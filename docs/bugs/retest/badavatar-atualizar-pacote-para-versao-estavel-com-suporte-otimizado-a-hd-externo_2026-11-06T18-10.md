# Bug: Atualizar pacote BadAvatar para versão estável (v1.3) com alta taxa de sucesso e tolerância a HD externo mecânico

## Status

- **Status:** Em reteste (código e pacote integrados, suítes de teste 100% aprovadas)
- **T1:** Homologado release oficial de bibarub/Xbox360BadUpdate v1.3-beta com Stage 2 assíncrono e `GamerProfile.xex`, integrado ao XeUnshackle com `XeUnshackleAutoStart.txt` (`0.00`) e autostart da Aurora via `launch.ini`.
- **T2:** Pacote importado via utilitário `scripts/update-fixed-payload.js` para `badavatar-1.3`, gerando manifesto `badavatar-1.3.manifest.json` com 644 arquivos (SHA-256 `6c634df097ab2938826c0babbbe7ebf0b733aa4586fa3bb1e3181da023e04e2e`) e atualizando `badavatar-package.json`. `.gitignore` atualizado para ignorar `src/electron-app/assets/badavatar-*/` sem sujar o versionamento git.
- **T3:** Suíte `npm run test:safety` executada com aprovação de 369/369 testes; testes de segurança do electron `security-smoke.cjs` e teste de preview do BadAvatar `badavatar-preview-smoke.cjs` executados com aprovação (código 0); suíte Go (`go -C src/server test ./...`) aprovada com 100%.
- **T4:** Aguarda reteste em hardware físico (console com HD externo mecânico).

- **Detectado em:** 2026-11-06 18:10
- **Origem:** Análise de causa raiz do bug [`badavatar-hd-preparado-nao-dispara-com-avatares-cinzas-no-console-onde-o-pendrive-funcionou_2026-10-22T23-00.md`](badavatar-hd-preparado-nao-dispara-com-avatares-cinzas-no-console-onde-o-pendrive-funcionou_2026-10-22T23-00.md) (chamados de suporte #254 e #232)
- **Errors (serviço):** N/A (o preparo do HD pelo app completa com sucesso; a falha ocorre em tempo de execução no console)
- **Classe:** fail (exploit stall / race condition failure no console em HD mecânico) + upgrade de dependência interna (payload)
- **Severidade:** **P1 — Alto** (afeta diretamente clientes que compram ou usam HD externo USB para rodar a biblioteca de jogos)
- **Complexidade:** média (importação e validação de payload conforme [`docs/ATUALIZAR-PACOTE-BADAVATAR.md`](../ATUALIZAR-PACOTE-BADAVATAR.md))
- **Reincidência:** alta em clientes de HD externo (chamados #254, #232 e dezenas de relatos em `Wpp_proccess` de consoles que necessitam religar de 3 a 4 vezes para engatar o boot)

## Sintoma

Em consoles Xbox 360 bloqueados ou LT, dispositivos do tipo **HD externo mecânico (USB)** preparados pelo Companion para BadAvatar apresentam falha frequente de disparo na tela de seleção de perfis:
1. Ao ligar o console com o HD externo conectado, a Dashboard lista os perfis (`ABadAvatar` e perfis pessoais), mas os avatares caem em **silhuetas cinzas estáticas** (*Grey Silhouette Fallback*).
2. A Aurora não abre mesmo após longos períodos de espera (o exploit trava e a Dashboard desativa o renderizador 3D de avatares).
3. O cliente é forçado a desligar e religar o console repetidamente (3 a 4 vezes) até que uma das tentativas consiga vencer a corrida do exploit e abrir a Aurora.
4. No mesmo console, um pendrive USB simples (memória flash) funciona de primeira ou com muito mais facilidade, gerando a falsa impressão de incompatibilidade com o HD ou necessidade de reaplicação da atualização 17559.

## Evidência e Diagnóstico Técnico

1. **Pacote atualmente embutido no Companion (`badavatar-1.1`):**
   - O arquivo `src/electron-app/assets/badavatar-package.json` referenciava o release:
     `"1.1-autostart-aurora-freestyle-dashlaunch-xexmenu"`.
   - Essa versão baseia-se na implementação inicial de `shutterbug2000/ABadAvatar`, derivada do BadUpdate v1.0/v1.1.
   - O README oficial do ABadAvatar original registra expressamente que o exploit tem uma taxa de sucesso de ~30%-40% por tentativa, operando sob uma janela estrita de temporização de corrida (*race condition*) entre o parsing do item de avatar no offset `0x2200` e a injeção do Stage 2 em memória.

2. **Por que HDs mecânicos falham criticamente na v1.1:**
   - **Spin-up e latência de I/O:** O pendrive responde em < 1 ms. O HD mecânico leva 2 a 5 segundos para rotação estável, consome pico de corrente na porta USB (500 mA) e possui latência mecânica de posicionamento das cabeças (*seek time*).
   - **Varredura de FAT e jogos:** Em HDs de 500 GB formatados em FAT32 com dezenas de jogos, a Dashboard do Xbox 360 realiza operações de I/O concorrentes para montar diretórios (`games`, `Content`), disputando o barramento USB no exato instante em que o Stage 1 tenta ler `BadUpdatePayload\BadUpdateExploit-2ndStage.bin`.
   - **Queda no fallback cinza:** Quando a leitura atrasa ou a temporização falha, a rotina `gamerprofile.xex` aborta e a Dashboard aciona o fallback de avatares cinzas, desativando permanentemente a execução do exploit naquela sessão.

3. **Solução consolidada na comunidade (ABadAvatar v1.3 / BadUpdate 1.3):**
   - Desenvolvida por **bibarub** e integrada às melhorias do **BadUpdate 1.3** de **Grimdoomer**:
     - Reescrita do carregamento do Stage 2 para ser assíncrono e dinâmico, disparando de forma quase instantânea na tela de perfis.
     - Suporte híbrido e tolerância a latências de armazenamento (USB, Unidades de Memória `Mu0` e `HDD`).
     - Rotina aprimorada de preservação e recuperação do `gamerprofile.xex`, evitando que falhas de temporização derrubem o renderizador em silhuetas cinzas.
     - Elevação da taxa de sucesso no primeiro boot para **~85% a 90%+**, mesmo em discos rígidos mecânicos.

## Escopo da Correção

1. Obter e homologar a versão compilada e estável do **ABadAvatar v1.3** (com base no release `bibarub/Xbox360BadUpdate` / BadUpdate 1.3), contendo os binários atualizados em `BadUpdatePayload/` (`BadUpdateExploit-2ndStage.bin`, Stage 3/4 e payloads associados) configurados para auto-start na Aurora.
2. Atualizar o pacote em `src/electron-app/assets/` utilizando o utilitário seguro documentado em `docs/ATUALIZAR-PACOTE-BADAVATAR.md`:
   ```powershell
   npm run payload:update -- "<caminho-para-versao-1.3>" "1.3"
   ```
3. Validar que o gerador de `launch.ini` e o marcador Ready-to-Play (`readyToPlayConfiguration.ts`) continuam compatíveis.
4. Rodar a suíte de testes de segurança e integridade:
   - `npm run test:safety`
   - `tests/electron/badavatar-preview-smoke.cjs`
5. Testar em dispositivo físico real (HD externo mecânico de 500 GB) para validar o boot direto e a eliminação do travamento com avatares cinzas.

## Tasks

| # | task | commit | estado | modelo | revisor |
|---|---|---|---|---|---|
| T1 | Homologar binarios e payload do ABadAvatar v1.3 com AutoStart Aurora | working tree | concluido | Gemini Flash | user |
| T2 | Importar pacote v1.3 via payload:update gerando novo manifesto e hash no assets | working tree | concluido | Gemini Flash | user |
| T3 | Validar suites test:safety e badavatar-preview-smoke.cjs com o novo pacote | working tree | concluido | Gemini Flash | user |
| T4 | Validar em hardware real (HD externo USB mecânico) confirmando boot sem stall de avatares cinzas | -- | pendente-hardware | -- | user |

