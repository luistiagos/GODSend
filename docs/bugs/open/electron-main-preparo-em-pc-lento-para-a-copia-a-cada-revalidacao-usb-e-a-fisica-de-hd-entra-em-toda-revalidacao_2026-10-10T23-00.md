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
