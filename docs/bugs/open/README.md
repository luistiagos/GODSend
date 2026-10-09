# bugs/open

Bugs ativos, sem correcao publicada. Vem de chamados de suporte (skill `triagem-chamados`), da telemetria
de erros (`triagem-bugs-prod`) e de investigacao no codigo. Template, nome do arquivo e severidade P0-P3:
[`docs/agents/skills/bug-triage.md`](../../agents/skills/bug-triage.md), secoes 1-3.

## Ciclo de pastas

```
open/<arquivo>.md      bug aberto
   |  [fix commitado + testado na lane pelo pipeline, ou a mao]
   v
retest/<arquivo>.md    corrigido e testado aqui; falta versao publicada e/ou prova do cliente
   |  [versao publicada + cliente (ou o dono no console) confirmou]
   v
closed/<arquivo>.md    encerrado
```

`closed/` faz o papel do `done/` que a skill `pipeline-correcao-bugs` cita. Nunca apague um doc de bug: mova
com `git mv`.

## Criterio de complexidade (obrigatorio em todo bug)

- **Baixa:** texto/mensagem na UI (`preparedDeviceCopy.ts`, componentes do `renderer/`), validacao que ja tem a
  regra pronta em outro lugar e so falta chamar, flag ou default de config, catalogo (`cache/*.json`).
- **Media:** logica nova num handler ou servico Go (`src/server/services/...`, `interfaces/http/...`), canal IPC
  novo (`ipc/<area>Handlers.ts` + `preload.ts` + `renderer/global.d.ts`), tela React com estado novo, empacotamento
  (`electron-builder`, `build-and-upload.ps1`).
- **Alta:** formatacao/preparo de disco (`fat32Format.ts`, `windowsUsbDeviceService.ts`,
  `fixedBadAvatarPreparationService.ts`: perda de dados se errar), pipeline de download/extracao/gravacao e fila
  duravel (`src/server/services/pipeline/`, `app/queue_store.go`), FTP com o console, multidisco, launcher do
  portatil (`build/portable.nsi`), ou mudanca que atravessa backend + IPC + UI.
