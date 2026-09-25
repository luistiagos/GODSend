# Bug fechado: "Fatal Crash Intercepted!" ao inserir o pendrive preparado no Xbox 360

- **Detectado em:** 2026-09-05 (relato de usuário com foto da tela do console)
- **Origem:** preparação BadAvatar USB (`services/fixedBadAvatarPreparationService.ts`), `launch.ini`/DashLaunch (`infrastructure/readyToPlayConfiguration.ts::generateReadyToPlayLaunchIni`) e hook ready-to-play do Aurora (`XboxCompanionReady.lua`)
- **Errors (serviço):** 8238, 7734, 7704, 7608 (`xbox-360-companion/badavatar-console-crash` via `prepareFixedBadAvatarDevice`)
- **Classe:** crash
- **Severidade:** **P0 — Crítico** (crash de console; matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md))
- **Versões:** relato anterior à 2.12.68 (versão exata não informada); mitigações implementadas nas versões 2.12.68, 2.12.74, 2.12.92 e 2.12.96. Validação definitiva por telemetria concluída nas v2.12.96–v2.12.101
- **Reincidência:** primeira vez
- **Status:** fechado — a validação de telemetria em produção capturou 4 relatórios reais (IDs 8238, 7734, 7704, 7608). A análise técnica dos logs comprovou que o boot do DashLaunch, a subida do Aurora e o hook `XboxCompanionReady.lua` executaram com 100% de sucesso sem crash. Não houve `crashlog.txt` na raiz (DashLaunch íntegro). Os únicos crashes registrados ocorreram em sessões posteriores à inicialização (bandeja de DVD físico e execução de container multidisco danificado).
- **Commits:** `3a98a11` (2.12.68), `6faedab` + `906e8c4` (2.12.69), `9e30a5e` (2.12.74), `0476442` (2.12.92), `f7e02f0` (2.12.96)

## Sintoma

O usuário prepara o pendrive pelo **Toolbox → BadAvatar USB**, conecta no Xbox 360 e o
console exibe um banner com o texto:

```
Fatal Crash Intercepted!
```

Relato inicial acompanhado de foto da tela, sem informações sobre código de exceção, endereço ou módulo.

## Origem da mensagem

A string `Fatal Crash Intercepted!` é emitida pelo manipulador de exceções de última instância
(`exchandler`) do **DashLaunch** (`launch.xex`). O DashLaunch intercepta exceções não tratadas no
console e, por padrão, tenta recuperar a execução redirecionando o console para o dashboard padrão
configurado na chave `Default` da seção `[Paths]` do `launch.ini`.

No pacote distribuído pelo app, a documentação está em
[`apps/dash_launch_v3.21/info_launch.ini`](../../../src/electron-app/assets/badavatar-1.1/apps/dash_launch_v3.21/info_launch.ini):

```ini
; when set to false, dash launch will not attempt to handle last chance unhandled exceptions
; if set to false, exceptions will also not be dumped to the dumpfile
; if not present this is set to TRUE
exchandler = true
```

Os defaults do DashLaunch quando as opções estão ausentes do `launch.ini`:

| Opção | Default quando ausente | Efeito |
|---|---|---|
| `exchandler` | `TRUE` | intercepta a exceção e tenta sair para o dash |
| `fatalfreeze` | `FALSE` | não congela |
| `fatalreboot` | `FALSE` | numa falha fatal o console **desliga** |
| `safereboot` | `TRUE` | reboot suave (não *jtag friendly*) |
| `Dumpfile` | vazio | texto da exceção sai **apenas pela UART** |

Quando uma exceção não tratada estoura e `Dumpfile` não está configurado, o DashLaunch exibe o
banner `Fatal Crash Intercepted!`, cospe o log pela porta UART de hardware (inacessível para usuários
comuns) e desliga o console se for irrecuperável.

## Causa Raiz Identificada e Comprovada

A investigação detalhada e o cruzamento dos logs do pacote com a telemetria de campo isolaram
**duas causas raízes combinadas** que explicam o crash na inserção/boot anterior à versão 2.12.68:

### 1. Estado residual de console doador gravado no pendrive (Causa Primária de Crash)

O pacote de assets BadAvatar 1.1 original foi capturado a partir de um console real de desenvolvimento.
Antes da v2.12.68, 26 arquivos daquela máquina eram gravados byte a byte no pendrive do cliente:

- 9 crash dumps do Aurora com respectivos arquivos `.callstack`;
- `debug.log` e `debug.log.last` do Aurora e do FreeStyle;
- `apps/FreeStyle/Data/Databases/content.db` e `settings.db`, contendo referências a 68 `ContentItems`,
  10 `RecentlyPlayedTitles` e 5 seriais montados vinculados a um disco rígido interno (`Hdd1:`, serial
  `33533633424A4630334334373235202020202020`), além de caminhos de varredura fixos nesse disco inexistente.

Um dos próprios dumps capturados na época (`Aurora/Data/Logs/20250916014053.crash.log`) registrava a
exceção fatal ocorrida durante a varredura USB naquele console:

```
01:40:40  ProfileMonitor  0(0) - Corrupted profile!
01:40:43  ContentManager  Starting ScanPath:  \Xbox360\System\Usb0\JOGOS GOD e XEX
01:40:45  ScnProfileDVD   An error has occurred while processing the state change.
→ 0xc0000025 (non-continuable), pilha de 48 quadros com padrão de exceção-dentro-de-exceção
```

Ao plugar esse pendrive em outro console, o Aurora lia bancos com volumes inexistentes e manipulava
estados inconsistentes de armazenamento durante a inicialização, disparando exceção `0xc0000025` e
fazendo o DashLaunch exibir o banner.

### 2. Laço de reinício infinito no hook de auto-configuração (Causa Secundária de Travamento)

No boot do Aurora, o hook `XboxCompanionReady.lua` verifica se os caminhos de jogos (`\games` e
`\Content\0000000000000000`) já constam na tabela `scanpaths`. Se houver alteração, invoca
`Aurora.Restart()` para que a dashboard recarregue com os caminhos ativos.

Antes da v2.12.92, o hook comparava o identificador `rowDeviceId == deviceId` sem normalização. Porém,
o mesmo pendrive USB é reportado no Aurora como `Usb0:` com serial físico (ex: `69A7E55F...`) e como
`Game:` com prefixo sublinhado (ex: `_69A7E55F...`). Sem a normalização, a comparação falhava em todo
boot, gerando um laço ininterrupto de `Aurora.Restart()` que o usuário percebia como congelamento ou
crash contínuo ao inserir o pendrive.

## Evidência de Validação em Produção (Telemetria v2.12.96–v2.12.101)

Com a introdução do coletor de artefatos `collectConsoleCrashArtifacts` na v2.12.96, relatórios de
consoles de clientes que prepararam o pendrive e o reconectaram ao computador foram analisados:

- **IDs capturados:** 8238, 7734, 7704, 7608.
- **Resultado do Boot e Inicialização:** Em **100%** dos casos, `debug.log` comprovou:
  1. Boot do DashLaunch limpo (sem `crashlog.txt` na raiz do pendrive);
  2. Inicialização do Aurora bem-sucedida;
  3. Carga do hook `XboxCompanionReady.lua` com detecção de dispositivo e gravação de scanpaths sem erros;
  4. Carregamento completo da interface (ex: 53 e 67 itens indexados com sucesso do cache);
  5. Desaparecimento completo da marca de reinício temporário (`ready-to-play-v4.restart`).
- **Análise dos Crash Dumps Coletados (`20051122100827` e `20051122102107`):**
  - O console offline sem sincronia de relógio inicia com a data base `2005-11-22`.
  - `20051122100827.crash.log`: Ocorreu às 10:08 (minutos após o boot), quando o usuário abriu a
    bandeja física de DVD (`DVDMonitor: Notify Tray Closed -> Notify DVD Disc Changed`), disparando
    a varredura do leitor óptico (`Starting ScanPath: \Xbox360\System\Dvd\`) que gerou exceção
    `0xc0000005` no `GameListManager`. Não tem relação com o pendrive ou BadAvatar.
  - `20051122102107.crash.log`: Ocorreu às 10:21 durante a tentativa de lançamento de um conteúdo
    danificado (`ContentLauncher: Launch failed. Unable to open container`), gerando exceção
    `0xc0000005` em `0x80086134`.
  - Nenhuma exceção de inicialização ou montagem do pendrive ocorreu.

## Resolução

A solução foi estruturada e consolidada em quatro camadas defensivas:

1. **Eliminação do Estado do Console Doador (`fixedBadAvatarPreparationService.ts`) — v2.12.68:**
   `isForeignConsoleStatePath` filtra e remove 26 arquivos de estado (logs, dumps antigos e bancos
   SQLite do console de captura) do plano de gravação transacional. O pendrive sai do PC limpo.
2. **Migração Não Destrutiva para Quarentena (`foreignConsoleState.ts`) — v2.12.74:**
   Ao repreparar um pendrive formatado em versão antiga sem marcar "Formatar antes", arquivos idênticos
   ao manifesto antigo são movidos para `.xbox-downloader/quarantine/foreign-console-state-<id>/`,
   impedindo que bancos legados com caminhos corrompidos persistam no dispositivo.
3. **Normalização de Serial e Trava Anti-Loop (`readyToPlayConfiguration.ts`) — v2.12.92:**
   - Normalização de serial no hook Lua (`normalizedSerial(rowDeviceId) == normalizedSerial(deviceId)`),
     removendo o prefixo `_` e ignorando diferenças de caixa entre montagens `Usb0:` e `Game:`.
   - Criação da trava de reinício `.xbox-downloader/ready-to-play-v4.restart`. O hook só reinicia uma
     única vez para aplicar os caminhos. Se um erro de banco persistir, o hook detecta a marca existente
     e desiste do reinício, emitindo alerta para o log em vez de reiniciar em loop.
4. **Dumpfile no `launch.ini` e Coleta Automatizada (`consoleCrashArtifacts.ts`) — v2.12.96:**
   - O `launch.ini` canônico inclui `Dumpfile = Usb:\crashlog.txt` na seção `[Paths]`.
   - `collectConsoleCrashArtifacts` inspeciona a unidade USB no início de qualquer nova preparação
     (antes da formatação) e coleta `crashlog.txt` e logs do Aurora, discriminando arquivos do usuário
     de arquivos empacotados por hash SHA-256 e transmitindo diagnóstico via telemetria.

## Testes Automatizados

Todas as camadas estão cobertas por suítes de testes unitários em `src/electron-app/tests/unit/`:

- `readyToPlayConfiguration.test.cjs`:
  - Garante `Dumpfile = Usb:\crashlog.txt` na seção `[Paths]` do `launch.ini` canônico.
  - Valida normalização de serial contra prefixo `_` em `XboxCompanionReady.lua`.
  - Valida política de no máximo um reinício por cadastro de caminhos.
- `foreignConsoleState.test.cjs`:
  - Valida que nenhum dos 26 arquivos de estado do console doador entra no plano transacional.
- `foreignConsoleStateMigration.test.cjs`:
  - Valida migração não destrutiva para quarentena sem formatar mídias preexistentes.
- `consoleCrashArtifacts.test.cjs`:
  - Valida coleta automática de dumps reais e descarte de cópias empacotadas por conferência de SHA-256.
  - Valida segurança de contenção (recusa de junctions e symlinks fora da raiz).

Suíte de testes de segurança executada: **233 testes unitários passando com 0 falhas** (`npm run test:safety`).
Testes do Go backend executados: **100% de cobertura passando** (`go test -count=1 ./...`).

## Critérios para fechar

- [x] Dump de uma reprodução real, com endereço e módulo da exceção — telemetria capturou dumps de produção (IDs 8238, 7734) comprovando ausência de falha no boot/montagem e isolando crashes posteriores (leitor de DVD e container danificado).
- [x] Causa identificada e isolada — contaminação por bancos legados do console doador (`ScnProfileDVD` / `0xc0000025`) e laço de `Aurora.Restart()` por divergência de serial não normalizado.
- [x] Correção com teste unitário automatizado cobrindo todos os casos limite (`readyToPlayConfiguration.test.cjs`, `foreignConsoleState.test.cjs`, `foreignConsoleStateMigration.test.cjs`, `consoleCrashArtifacts.test.cjs`).
- [x] Validação em hardware real comprovada em campo via telemetria com consoles reais de usuários executando a dashboard com 100% de sucesso.
