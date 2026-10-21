# Bug: preparar de novo, sem "Formatar antes", um pendrive já preparado falha a 24% com "O diário transacional não pertence ao plano de escrita informado"

- **Detectado em:** 2026-10-20 19:14 UTC (teste local: E2E do bug
  [[badavatar-fatal-crash-no-meio-do-jogo-deixa-o-pendrive-ilegivel-e-leva-perfil-e-saves_2026-10-20T13-28]] no pendrive de
  teste), confirmado na telemetria de produção
- **Origem:** `xbox-360-companion/electron-main` — `src/electron-app/infrastructure/simulatedTransactionalWriter.ts::loadOrCreateJournal`
  → `infrastructure/transactionJournal.ts::verifyTransactionJournalAgainstPlan`, com o plano de
  `services/fixedBadAvatarPreparationService.ts::prepareFixedBadAvatarDevice`
- **Errors (serviço):** 10633 (17/10, modo `rgh`, SanDisk 123 GB), 10704 (19/10, modo `badavatar`), 10726 (19/10, modo
  `rgh`, HD Toshiba 500 GB). São 3 clientes diferentes (`C:\Users\User`, `C:\Users\jhsil`, `C:\Users\Carlo`), nas versões
  2.12.109/2.12.110. O 11054 foi o teste local (fechado).
- **Classe:** fail
- **Severidade:** **P1 — Alto** pela matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md). Bloqueia por inteiro o
  repreparo sem formatar de um pendrive já preparado. A única saída é "Formatar antes", que apaga jogos, perfis e saves.
- **Versões:** observado na 2.12.109/2.12.110 (clientes) e na 2.12.114 (app dev). O código do plano é de 06–08/2026
  (`d4db121`, `978e128`). Só aparece na telemetria desde a 2.12.110: até `203484d` (11/10) a falha do preparo não era
  reportada.
- **Reincidência:** primeira vez registrado. O doc
  [[badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09]] já alertava, linha 699, que
  byte volátil no plano faria "toda retomada de preparo interrompido falhar" com esta mensagem. Lá o alerta era sobre o
  recibo; o caso aqui é outro campo.

## Sintoma

Os três clientes seguiram o mesmo caminho: `formatar=false`, fase `Preparando a cópia… (24%, 1/202)` (RGH) ou
`(24%, 1/620)` (BadAvatar), e a pilha:

```
Error: O diário transacional não pertence ao plano de escrita informado.
    at verifyTransactionJournalAgainstPlan (...\app.asar\infrastructure\transactionJournal.js:101:15)
    at loadOrCreateJournal (...\app.asar\infrastructure\simulatedTransactionalWriter.js:171:70)
    at async executeTransactionalWrite (...\app.asar\infrastructure\simulatedTransactionalWriter.js:209:32)
    at async prepareFixedBadAvatarDevice (...\app.asar\services\fixedBadAvatarPreparationService.js:516:24)
```

O app de todos rodava de `C:\Users\<u>\AppData\Local\Temp\ns<aleatório>.tmp\app\resources\app.asar` (`nsk9121`,
`nsu3B6F`, `nsi83FF`): é o portátil, que extrai para uma pasta temporária nova a cada abertura.

Reprodução local (2026-10-20): pendrive de teste E: preparado em 13/10 pelo app instalado 2.12.110
(`.xbox-downloader/preparo.json`), com o diário `542848dd-c0c1-5dca-a12a-8cba2f8f2155.json` em `state: completed` e 620
entradas. Preparo sem formatar pelo app dev 2.12.114 → mesmo erro a 24%, 1/620.

## Causa raiz (hipótese forte, verificada no código, não isolada por teste)

1. `deterministicTransactionId(bundleSha256, fingerprint, scope)` (`fixedBadAvatarPreparationService.ts`) dá o **mesmo**
   `transactionId` a todo preparo do mesmo pacote no mesmo dispositivo, no mesmo modo. Por isso o diário de um preparo
   antigo é encontrado em `.xbox-downloader/transactions/<transactionId>.json`.
2. O `planHash` (`transactionalWritePlan.ts::planHash`, `canonicalizeJson` do plano inteiro) inclui **`sourceRoot`** e o
   **`sourcePath`** de cada entrada, que são caminhos absolutos do PC. O `sourceRoot` é a pasta de staging de
   `createReadyToPlayStagingDirectory()`, irmã do pacote dentro dos recursos do app (`path.dirname(sourceRoot)`) ou em
   `app.getPath("temp")`. No portátil esse caminho muda a cada abertura do app (`ns<aleatório>.tmp`). Entre app
   instalado e dev ele também muda.
3. `loadOrCreateJournal()` chama `verifyTransactionJournalAgainstPlan()` **antes** de qualquer outra coisa. O
   `planHash` difere, e a função lança. O caminho de reparo de diário `completed` (`completedPlanStillMatchesTarget` /
   `resetCompletedJournalForRepair` em `executeTransactionalWrite`) nunca é alcançado, nem a retomada de um preparo
   interrompido, que é a razão de existir do diário.

**Não verificado:** se é só o caminho que difere (nenhum arquivo gerado mudou: `readyToPlayConfiguration.ts` não tem
commit desde 01/10) e se o mesmo erro aparece entre duas aberturas do app instalado (caminho fixo). A prova é montar dois
planos com os mesmos arquivos em `sourceRoot` diferentes e comparar o `planHash`.

## Como reproduzir

1. Preparar um pendrive (qualquer modo) e deixar terminar, ou interromper no meio.
2. Fechar o app portátil e abrir de novo (pasta `ns*.tmp` nova). Ou preparar com o app instalado e depois com o dev.
3. Preparar de novo o mesmo pendrive, sem "Formatar antes" → falha a 24% com a mensagem acima.

Sintético: `tests/unit/simulatedTransactionalWriter.test.cjs`. Gravar com um plano cujo `sourceRoot` é a pasta A,
montar outro plano com os mesmos arquivos copiados para a pasta B e chamar `executeTransactionalWrite` de novo no mesmo
destino.

## Tarefas propostas / Próximos passos

1. Provar a hipótese com o teste sintético acima (vermelho no código atual).
2. Decidir a correção com o dono. A identidade do plano não deveria depender de onde o app foi extraído. Opções: tirar
   `sourceRoot`/`sourcePath` do que entra no `planHash` (o conteúdo já é fixado por `sha256` e `entryId`); ou, se o
   diário não confere mas o plano é do mesmo `transactionId`, tratá-lo como obsoleto (descartar e recomeçar, conferindo
   por hash o que já está gravado) em vez de lançar. Cuidado com a garantia de segurança de
   `docs/ESCRITA-TRANSACIONAL.md` antes de relaxar qualquer conferência.
3. Ler `docs/ESCRITA-TRANSACIONAL.md` e o alerta do doc de 10-08 (linha 699) antes de mexer.

## Critérios para fechar

- [ ] Reprodução sintética vermelha e depois verde
- [ ] Repreparo sem formatar de um pendrive preparado por outra abertura do app passa (E2E no pendrive de teste
      `247700023090`, que já está nesse estado)
- [ ] Retomada de preparo interrompido entre duas aberturas do app passa
- [ ] Telemetria sem novas ocorrências depois da versão publicada
