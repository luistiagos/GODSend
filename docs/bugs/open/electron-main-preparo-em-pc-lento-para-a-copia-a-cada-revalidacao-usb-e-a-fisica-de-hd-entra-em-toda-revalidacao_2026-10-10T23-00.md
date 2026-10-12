# Bug: em PC lento o preparo do pendrive para a cópia a cada revalidação USB (~7 s de PowerShell a cada ~17 s), e com uma unidade fixa não-sistema (D: interno) cada revalidação roda também a enumeração física

- **Detectado em:** 2026-10-10 23:00 (leitura de código no planning do pipeline 20261010-2242)
- **Origem:** achado lateral do pipeline em electron-main-powershell-lento-estoura-prazo-fixo-da-enumeracao-usb-e-preparo-falha-com-pendrive-presente_2026-10-07T20-40 — `services/fixedBadAvatarPreparationService.ts::createThrottledUsbTargetRevalidator`, `infrastructure/windowsUsbDeviceService.ts::enumerateSafeWindowsUsbDevices` (`finishNative`)
- **Errors (serviço):** N/A (sem report; medido em simulação na 2.12.108)
- **Classe:** perf
- **Severidade:** P3 — Baixo: o preparo termina (não falha), só fica muito mais lento em PC lento
- **Versões:** código de `origin/main` em `d7bd9ad` (2.12.110)
- **Reincidência:** primeira vez; registrado como "observação fora do escopo" no doc
  [`electron-main-powershell-lento-…_2026-10-07T20-40`](../retest/electron-main-powershell-lento-estoura-prazo-fixo-da-enumeracao-usb-e-preparo-falha-com-pendrive-presente_2026-10-07T20-40.md),
  seção "Prova ponta a ponta"

## Sintoma

Na prova ponta a ponta da 2.12.108 (cada `powershell.exe` atrasado 6 s, como o PC do cliente do
chamado #157), o preparo sem formatar de um pendrive de 15,5 GB levou **804,8 s**, com 41
`powershell.exe` de revalidação, um a cada ~17 s (10 s de intervalo + ~7 s de PowerShell). O
preparo não falha mais; fica lento.

## Causa raiz

- `fixedBadAvatarPreparationService.ts::createThrottledUsbTargetRevalidator`: a cada chamada faz
  `fsPromises.access(root)` (barato) e, se passaram 10 s (`DEVICE_REVALIDATION_INTERVAL_MS`) desde a
  última validação **completa terminada**, roda `requireSafeWindowsUsbTarget` e **espera**
  (`await pendingFullValidation`). Quem chama (`revalidateTarget`, linhas 616–630) é a cópia: ela
  para enquanto o PowerShell roda. Como `lastFullValidationAt` só é gravado no fim, o ciclo é
  intervalo + duração; num PC em que a enumeração leva ~7 s, ~40% do tempo de cópia é espera.
- `windowsUsbDeviceService.ts::enumerateSafeWindowsUsbDevices` → `finishNative` (de `0a719db`, bug do
  HD externo): se o script nativo viu qualquer unidade `Fixed` que não seja a do sistema
  (`FixedDriveMarker`, script linhas ~226–233) — um D: interno de dados basta —, roda também o
  `ENUMERATE_USB_SCRIPT` (Storage Management) em **toda** enumeração, inclusive em cada revalidação
  do preparo. A falha dele é tratada (custa só o HD), mas o tempo soma: num PC lento, mais ~8 s por
  revalidação, com prazo adaptativo que pode chegar a 30 s.

## Como reproduzir

Simulação da prova de 2026-10-07 (`scratchpad/e2e-prepare.cjs` daquela sessão: `powershell.exe`
real atrasado 6 s) contando os `powershell.exe` e o tempo total do preparo; com e sem uma unidade
fixa não-sistema montada. Sem disco real liberado no pipeline: dá para medir pelo harness com mock
de disco contando chamadas de `runPowerShell` durante um preparo simulado.

## Resolução (a planejar)

Ideias, não decididas: espaçar a revalidação completa proporcionalmente à duração da última
enumeração (mantendo o `fs.access` a cada chamada); não rodar a enumeração física de HD na
revalidação de um alvo que a nativa já listou como removível.

## Testes Automatizados

A definir com a correção: contar enumerações durante um preparo simulado com PowerShell lento.

## Critérios para fechar

- [ ] Custo medido (chamadas de PowerShell por minuto de cópia) antes e depois
- [ ] A revalidação continua detectando troca de dispositivo (testes de `requireSafeWindowsUsbTarget`)
- [ ] Validação em hardware real (PC lento) quando aplicável

## Planejamento (pipeline 20261012-1854, 2026-10-12)

**Veredito:** corrigir — duas mudanças locais no Electron: a revalidação de um pendrive que a nativa já listou deixa de rodar a enumeração física de HD, e o intervalo da revalidação completa passa a acompanhar a duração da última.
**Complexidade:** alta — toca `windowsUsbDeviceService.ts` e `fixedBadAvatarPreparationService.ts` (preparo de disco, critério "Alta" do `docs/bugs/open/README.md`), ainda que o diff seja pequeno.
**Severidade:** baixo — o preparo termina (não falha); só fica mais lento em PC lento (P3 no doc). Atinge só o subconjunto PC lento, sem perda de dado.
**Arquivos a alterar (reserva da onda):**
- `src/electron-app/infrastructure/windowsUsbDeviceService.ts` — `enumerateSafeWindowsUsbDevices` ganha o alvo opcional; `finishNative` pula a física quando o alvo já veio da nativa; `requireSafeWindowsUsbTarget` passa o alvo.
- `src/electron-app/services/fixedBadAvatarPreparationService.ts` — `createThrottledUsbTargetRevalidator` mede a validação completa e espaça a próxima; função pura exportada para o intervalo.
- `src/electron-app/tests/unit/usbFixedDriveMerge.test.cjs` — casos novos: revalidação de pendrive com marcador Fixed não abre a física; revalidação de HD continua abrindo.
- `src/electron-app/tests/unit/preparationRevalidationInterval.test.cjs` — novo: intervalo puro e o revalidador com validação lenta simulada.
- `AGENTS.md` — doc-sync: o parágrafo de `windowsUsbDeviceService.ts` diz "disparado a cada 10 s durante a gravação" (e a linha da 2.12.x "revalidação de 10 s"); passa a dizer "a cada 10 s, ou 4 × a última validação, até 30 s", e que a revalidação de um alvo listado pela nativa não roda a física de HD.

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

Confirma a causa do doc, no código de `cab6830` (fluxo principal desta execução):

- `src/electron-app/services/fixedBadAvatarPreparationService.ts::createThrottledUsbTargetRevalidator` (linhas 460–486) —
  a cada chamada `fsPromises.access(root)` (em erro zera `lastFullValidationAt` e lança "O dispositivo USB não está
  acessível"); se `Date.now() - lastFullValidationAt < DEVICE_REVALIDATION_INTERVAL_MS (10_000)` retorna; senão
  cria (ou reaproveita) `pendingFullValidation = requireSafeWindowsUsbTarget(root, fingerprint)` e **espera**.
  `lastFullValidationAt` só é gravado no `.then` (fim da validação); em erro a promise rejeita e o erro sobe para a
  cópia, que aborta o preparo (comportamento certo, não muda). Ciclo = 10 s + duração da validação.
- Quem chama: `prepareFixedBadAvatarDevice` (linhas 619–639) passa o revalidador a
  `foreignConsoleState.ts::quarantineForeignConsoleState` (linha 94) e a
  `simulatedTransactionalWriter.ts::executeTransactionalWriteToDevice`, que o chama antes de cada journal, cópia,
  diretório e no fim (linhas 275–428). Toda cópia de arquivo para enquanto a validação roda.
- `src/electron-app/infrastructure/windowsUsbDeviceService.ts::requireSafeWindowsUsbTarget` (760–811) — chama
  `enumerateSafeWindowsUsbDevices()` **sem saber do alvo** e só depois filtra por `normalizedRoot`; em erro da
  enumeração lança `explainSlowEnumeration(...)`; fingerprint diferente → `planRevalidationRetry` +
  `revalidateWithScript` (não muda).
- `...::enumerateSafeWindowsUsbDevices` (546–678) → `finishNative` (578–607): se a nativa viu um marcador
  `FixedDriveMarker` (qualquer unidade Fixed que não seja a do sistema, script linhas 229–233), roda
  `ENUMERATE_USB_SCRIPT` com `enumerationTimeout(USB_ENUMERATION_TIMEOUT_MS)` e acrescenta só as linhas cujo root
  **não** está em `listed` (as da nativa). Em erro, loga e devolve só os removíveis. Consequência: para um alvo
  que a nativa já listou, a linha do alvo que `requireSafeWindowsUsbTarget` usa é **a mesma** com ou sem a física —
  ali a física só gasta um `powershell.exe` (Storage Management) por revalidação.

### Provas (comando literal -> resultado)

- `powershell -NoProfile -Command "Get-Volume | Where-Object DriveLetter | Select DriveLetter,DriveType,FileSystem,Size"`
  nesta máquina -> `D Fixed NTFS 512092008448`, `C Fixed NTFS`, `E Removable FAT32 15507390464`: a máquina de teste
  tem um D: interno, então **hoje cada revalidação do preparo roda a física de HD** aqui — o controle positivo
  existe sem simular nada.
- `grep -rn "revalidateTarget" --include=*.ts src/electron-app` -> 1 criação (`fixedBadAvatarPreparationService.ts:619`),
  1 uso em `foreignConsoleState.ts:94` e ~20 em `simulatedTransactionalWriter.ts` (por arquivo/journal): é a cópia
  quem espera.
- `grep -rn "enumerateSafeWindowsUsbDevices(" --include=*.ts src/electron-app` -> 3 chamadores:
  `requireSafeWindowsUsbTarget` (revalidação), `badAvatarUsbService.ts:466` (lista, `includeHealth=true`, sem alvo) e
  `fixedBadAvatarPreparationService.ts:354` (`waitForFormattedDevice`, sem alvo). Só o primeiro muda.
- `tests/unit/usbFixedDriveMerge.test.cjs` já tem o harness (`fakePowerShell` registra os scripts iniciados) e o
  caso "revalidacao do preparo acha o HD com o pendrive conectado" (alvo F:, HD), que precisa continuar verde.
- Medida da prova de 2026-10-07 (doc em `retest/`): 804,8 s, 41 revalidações de ~7 s ⇒ ~287 s de espera,
  ~518 s de cópia. Estimativa com o fix (fator 4, teto 30 s): intervalo 28 s, ciclo 35 s, ~19 revalidações,
  ~650 s no total; com D: montado o ganho é maior (hoje ~7 + ~8 s por revalidação).

### Hipoteses descartadas (e por que)

- **Validação completa em segundo plano (a cópia não espera):** descartada — a cópia seguiria gravando com uma
  validação pendente e a troca de dispositivo só apareceria depois; muda a semântica de segurança numa área com
  perda de dado se errar. O fix mantém o `await`.
- **Gravar `lastFullValidationAt` no início da validação:** pioraria — com 10 s de intervalo e 7 s de validação,
  a próxima dispararia 3 s depois do fim (70% de espera).
- **Nunca rodar a física na revalidação / tirar o `FixedDriveMarker`:** quebra a revalidação de HD USB, que só a
  física acha (caso "revalidacao do preparo acha o HD com o pendrive conectado", bug do HD externo, `0a719db`).
  O corte é só para alvo que a nativa já listou.
- **Usar `recentPowerShellDurationsMs` do `windowsUsbDeviceService` para o intervalo:** acopla os módulos e mede
  um `powershell.exe` só; o que a cópia espera é a validação completa (nativa + física + nova tentativa), e o
  revalidador mede isso localmente.
- **A lista da UI disputando a máquina durante o preparo:** já resolvido na 2.12.108 (`setUsbPreparationActive`);
  as 393 consultas da prova de 2026-10-07 não abriram PowerShell.
- **Aplicar o alvo também em `waitForFormattedDevice`:** fora — roda 1–2 tentativas depois da formatação, ganho
  desprezível; mudança cirúrgica.

### Tarefas

- [ ] `src/electron-app/infrastructure/windowsUsbDeviceService.ts::enumerateSafeWindowsUsbDevices` — segundo
  parâmetro opcional `targetRoot?: string`; em `finishNative`, depois de `if (!fixedDriveMounted) return devices`
  e de montar `listed`: `if (targetRoot && listed.has(normalizeRoot(targetRoot))) return devices;`, com comentário
  `[[electron-main-preparo-em-pc-lento-para-a-copia-a-cada-revalidacao-usb-e-a-fisica-de-hd-entra-em-toda-revalidacao_2026-10-10T23-00]]`
  explicando a equivalência (linhas da física para um root já listado são descartadas pelo filtro `listed`).
  `requireSafeWindowsUsbTarget` chama `enumerateSafeWindowsUsbDevices(false, normalizedRoot)`. Atualizar o JSDoc.
  — Teste em `usbFixedDriveMerge.test.cjs`: (a) nativa `[PENDRIVE_NATIVE, marker("D:")]` →
  `requireSafeWindowsUsbTarget("e:", fp)` resolve com `started` = `["nativa"]` (hoje `["nativa","fisica"]`);
  (b) o caso existente do HD (alvo F:) continua com a física; (c) a lista (`enumerateSafeWindowsUsbDevices()` sem
  alvo) continua `["nativa","fisica"]`.
- [ ] `src/electron-app/services/fixedBadAvatarPreparationService.ts::createThrottledUsbTargetRevalidator` — medir
  `Date.now()` antes de `requireSafeWindowsUsbTarget` e guardar a duração no `.then`; trocar o teste do intervalo
  por `revalidationIntervalFor(lastFullValidationMs)` = `min(30_000, max(DEVICE_REVALIDATION_INTERVAL_MS, 4 × duração))`
  (exportada e pura, como `enumerationTimeoutFor`). Manter o `fs.access` a cada chamada, o reset em erro, o
  `await` e o `pendingFullValidation` compartilhado. Comentário com o `[[slug]]`. O revalidador também precisa
  ser exportado (ou testado por uma fábrica exportada) para o teste (b). — Teste novo
  `preparationRevalidationInterval.test.cjs`: (a) puro: 500 ms → 10 000; 7 000 → 28 000; 20 000 → 30 000;
  (b) revalidador com `requireSafeWindowsUsbTarget` mockado no objeto do módulo (`t.mock.method`, como em
  `usbDriveListCache.test.cjs`; o TS compila para `(0, mod.fn)(...)`, então o mock pega), `fs.promises.access`
  mockado e `t.mock.timers` em `Date`: validação de 7 s → chamada aos 20 s depois do fim não valida de novo, aos
  29 s valida; validação rápida → continua a cada 10 s; `fs.access` falhando continua lançando e zerando.
  Mutação: voltar o intervalo fixo derruba (b).
- [ ] `AGENTS.md` (doc-sync, mesmo commit) e entrada em `CHANGELOG.md` `[Unreleased]` `### Fixed` (sem subir versão).

### Plano de teste

- **Offline (sem slot):** no `src/electron-app` da lane, depois do build do helper:
  `node --test tests/unit/usbFixedDriveMerge.test.cjs tests/unit/preparationRevalidationInterval.test.cjs tests/unit/powershellSlowMachine.test.cjs`.
  Os casos novos falham contra o código base (`started` com `"fisica"`; intervalo fixo) e passam com o fix.
- **T2 reproducao como o usuario (E2E, no slot):** app da lane (`npm start`, ou Playwright `_electron.launch`),
  pendrive de teste confirmado pelo serial (`Get-Disk | Where-Object SerialNumber -eq '247700023090'`, lock
  `C:\projects\.pendrive-teste-247700023090.lock`), máquina com o D: interno (já é o caso). Tela **BadAvatar USB** →
  selecionar o pendrive de teste → modo do console (bloqueado/LT) → **"Formatar antes" DESMARCADO** (evita UAC) →
  "Preparar pendrive/HD" até `Dispositivo preparado com sucesso`. Anotar a hora do clique e do fim.
  **Sinal:** no log do app dev (`%APPDATA%\xbox-360-companion-electron\logs\`, linhas `APP_USB`) entre o clique e o
  fim: contar `enumeracao nativa encontrou` (= validações completas) e `enumeracao fisica de HD USB` (= físicas da
  revalidação). Com o fix: **zero** `enumeracao fisica de HD USB` no intervalo do preparo; com PowerShell normal,
  as nativas continuam ~1 a cada 10 s. **Segunda rodada, PC lento simulado:** mesmo caminho com o
  `powershell.exe` atrasado 6 s (shim descartável na evidência, carregado por `NODE_OPTIONS=--require <shim>.cjs`
  no `electron .` da lane, que envolve `child_process.spawn` e só inicia o `powershell.exe` real 6 s depois);
  sinal: intervalo entre `enumeracao nativa encontrou` consecutivas ≥ ~25 s (hoje ~17 s) e tempo total menor que
  no controle. Registrar tempo total e PowerShells por minuto de cópia (critério do doc).
- **Controle positivo:** não há `deploy --at-base` neste projeto; rodar o mesmo caminho na lane com o código base
  (antes do commit do fix, ou com os dois `.js` compilados do base). Esperado: uma
  `enumeracao fisica de HD USB encontrou 0 unidade(s)` por revalidação (por causa do D:), e com o shim de 6 s um
  ciclo de ~17–25 s entre validações.
- **T3 regressao direcionada:** `npm --prefix src/electron-app run test:safety` (inclui `usbFixedDriveMerge`,
  `powershellSlowMachine`, `deviceSafetyPolicy`, `usbDriveListCache`, `simulatedTransactionalWriter`,
  `foreignConsoleState`) e `go test -count=1 ./...` em `src/server` (sem mudança Go; linha de base). Na UI: a lista
  BadAvatar USB continua mostrando o pendrive (e um HD USB, se houver: a lista não passa alvo). Remoção do pendrive
  no meio do preparo continua abortando com "O dispositivo USB não está acessível" (o `fs.access` por chamada não
  muda) — coberto pelo teste unitário (b); na UI só se o tester aceitar o risco no pendrive de teste.
- **Falta para close:** PC lento real (cliente do chamado #157) — campo.

### Sessoes seguintes

- dev: effort high, ultrathink sim — preparo de disco (manual: `high`); a equivalência do corte da física e o
  `pendingFullValidation` compartilhado pedem raciocínio, ainda que o diff seja curto.
- teste: effort medium, ultrathink não — os sinais são contagens de linhas de log; o trabalho é montar o shim do
  PowerShell lento e o controle com o pendrive de teste.
