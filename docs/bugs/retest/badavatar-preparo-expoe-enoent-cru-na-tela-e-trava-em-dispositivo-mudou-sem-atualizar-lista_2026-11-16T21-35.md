# Bug: Preparo BadAvatar exibe `ENOENT`/erros crus de `.xbox-downloader` na tela e trava em "O dispositivo mudou desde a seleção" por não atualizar a lista ao preparar

- **Detectado em:** 2026-11-16 20:49 (chamado **#373**, sessão WhatsApp `554196398337`, `lid=173315519983842@lid`)
- **Origem:** conversa de suporte + telemetria (`13808`, `13809`, `14053`) + leitura de `src/electron-app/ipc/badAvatarHandlers.ts::tools:badavatar-prepare`, `src/electron-app/renderer/components/BadAvatarUsbPage.tsx::handlePrepare` e `src/electron-app/infrastructure/simulatedTransactionalWriter.ts::copyAndVerify`
- **Errors (serviço):** `13808` (`2026-11-14T02:36:38`), `13809` (`2026-11-14T02:40:17`), `14053` (`2026-11-16T23:57:09`) — `ElectronApp v2.12.128`, `hostname: DESKTOP-892920A` (`Users\hello2`); e `14055` (`detectado: exFAT`), `14056` (`UNKNOWN: unknown error, read`) e `14058` (`Users\WESLEY`, `DESKTOP-RMJQ4MQ`, `v2.12.129`: dump completo do `fat32format.exe` + `Set-Partition` recusando tipo 4 + `DiskPart` + `godsend_fat32_...ps1`)
- **Classe:** falha funcional / diagnóstico / UX
- **Severidade:** **P1 — Alto** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): bloqueou a preparação do HD externo do cliente por dias, levou a falso diagnóstico de "avatares cinzas" pelo bot e travou cliques subsequentes em *"O dispositivo mudou desde a seleção"* sem explicar que a falha era na conexão/dispositivo USB
- **Complexidade:** média — handler IPC (`badAvatarHandlers.ts`), tradução pura (`badAvatarPrepareError.ts`), identidade física no navegador (`usbSelectionIdentity.ts`) e estado da tela (`BadAvatarUsbPage.tsx`)
- **Reincidência:** primeira vez registrado com esta causa combinada; falhas cruas similares em `tools:badavatar-prepare` constam na telemetria (`13765`, `13083`, `13011`, `12960`, `12959`, `12956`, `12927`, `12815`, `12374`, `12370`, `11426`, `11422`, `11421`, `10580`, `10579`, `10050`)

## Sintoma

1. **2026-11-14 (`13809`, `v2.12.128`):** ao preparar o HD externo Seagate 500 GB (`D:\ — ST500LM0 00-1EJ162`) com *"Formatar antes"*, a formatação para FAT32 mudou o rótulo do disco para `BADAVATAR`, mas a cópia falhou em 31% (`55/621`) exibindo na barra vermelha:
   `ENOENT: no such file or directory, open 'D:\.xbox-downloader\staging\88096c0a-3075-5bd8-a705-de05de397b80\apps\Aurora\nxeart.partial'`
   Como o rótulo mudou para `BADAVATAR`, o cliente achou que tinha funcionado (`[180623]`), plugou o HD vazio no Xbox (`[180633]`, sem nenhum perfil `ABadAvatar`) e passou 2 dias tentando aplicar `$SystemUpdate` 17559.
2. **2026-11-16 (`[185450]`, `[185494]`, `[185495]`, `14053`):** após reformatar `D:\` para `exFAT` e tentar novamente no app, a UI continuou exibindo `exFAT` depois de falhar pós-formatação. Nos cliques seguintes em *"Preparar pendrive/HD"*, passou a falhar antes de a barra andar com *"O dispositivo mudou desde a seleção. Atualize a lista e selecione novamente antes de continuar."* (`[185494]` *"Eu clico mas não acontece nada"*).

## Evidência

- `Wpp_proccess`: `[180623]`, `[180633]`, `[181873]`, `[185450]`, `[185494]`, `[185495]`, `[185508]`, `[185452]`.
- `errors` / `error_logs`:
  - `13808`: timeout de enumeração física (`14508 ms`) no HD externo antes da formatação.
  - `13809`: `02:39:24.892Z` layout FAT32 aprovado (`ST500LM0 00-1EJ162`), 54 arquivos gravados em 50 s, `02:40:15.196Z` enumeração física saltou para `10101 ms` e `02:40:15.938Z` lançou `ENOENT` em `D:\.xbox-downloader\staging\...\apps\Aurora\nxeart.partial`.
  - `14053`: `23:49:08.403Z` `second-instance event received` reabriu a janela antiga (`pid=7036`, `v2.12.128`) e `23:57:08.271Z` falhou em `assertDeviceStillMatches` porque o `fingerprint` na tela ainda era o anterior à formatação.

## Causa raiz

1. **`badAvatarHandlers.ts::tools:badavatar-prepare` devolvia `err.message` cru para a UI:** erros de I/O do Node (`ENOENT`, `UNKNOWN`, `ETIMEDOUT`), falhas de verificação SHA-256 na gravação e traces do PowerShell/`fat32format`/`diskpart` chegavam literalmente à barra vermelha do usuário com caminhos internos (`.xbox-downloader\staging\<UUID>\...`) sem explicitar que o problema ocorreu no pendrive ou HD.
2. **`BadAvatarUsbPage.tsx::handlePrepare` usava o `fingerprint` antigo e não atualizava após falha:** `refreshDrives` só era chamado no caminho de sucesso (`L284`), nunca ao clicar em *"Preparar pendrive/HD"* nem no `catch`. Qualquer formatação (externa ou de tentativa anterior que falhou depois de formatar) alterava o `volumeGuid` e deixava a tela presa no `fingerprint` vencido.

## Resolução (2.12.130)

1. **`src/electron-app/infrastructure/badAvatarPrepareError.ts` (`formatBadAvatarPrepareErrorForUser`, `formatBadAvatarListErrorForUser`):** traduz para linguagem simples de usuário leigo (sem jargões técnicos nem caminhos/códigos internos, indicando sempre o que fazer) erros crus de filesystem (`ENOENT`, `UNKNOWN`, `EIO`, `ETIMEDOUT`, `EROFS`, `ENOSPC`, `EPERM`, `EACCES`, `EBUSY`, `ENODEV`, `ENXIO`, `EINVAL`), dumps do `fat32format`/`Set-Partition`/`diskpart`/PowerShell (como o caso `14058`), falhas de layout (`GPT`/`MBR`/`tipo 4`/`setores de 4096 bytes`/`exFAT`), falta de espaço em bytes, cancelamento de UAC, contêiner legado `Xbox360/` e verificações de cópia/diário — mantendo o gatilho `"Reparar (CHKDSK)"` limpo, sem expor `Detalhe:` nem `System Volume Information`.
2. **`src/electron-app/ipc/badAvatarHandlers.ts`:** mantém a mensagem técnica bruta intacta no log local (`appendAppEvent`) e na telemetria (`reportError`) em `tools:badavatar-prepare` e `tools:badavatar-list-drives`, devolvendo à UI somente a mensagem simples.
3. **`src/electron-app/infrastructure/usbSelectionIdentity.ts` (`isSamePhysicalUsbSelection`) e `src/electron-app/renderer/components/BadAvatarUsbPage.tsx` (`handlePrepare`, `refreshDrives`, `BLOCK_REASONS`):** ao clicar em *"Preparar pendrive/HD"*, a tela atualiza a lista (`refreshDrives(true)`) antes de confirmar/gravar e valida que o dispositivo no mesmo `rootPath` é o mesmo disco físico (aceitando troca de `volumeGuid`/sistema de arquivos por formatação e bloqueando se outro dispositivo físico tiver sido conectado na mesma letra); também atualiza a lista após falha de preparo mantendo a mensagem visível, e simplifica os textos de `BLOCK_REASONS` para linguagem leiga.

## Testes Automatizados

- Unitários (`npm run test:safety --prefix src/electron-app`, `tsc` + `renderer:typecheck` + **423/423** aprovados):
  - `src/electron-app/tests/unit/badAvatarPrepareError.test.cjs`: cobre tradução simples de `ENOENT`/`UNKNOWN`/`ETIMEDOUT`/`EROFS`/`EPERM`/`ENOSPC`, erro no disco do PC vs pendrive/HD, dump do `fat32format`/`Set-Partition`/`diskpart` (caso Wesley `14058`), layout/`exFAT`/`4096 bytes`/espaço/UAC/contêiner `Xbox360`, verificação na cópia, simplificação do gatilho `Reparar (CHKDSK)`, `formatBadAvatarListErrorForUser` e `isSamePhysicalUsbSelection` (mesmo disco reformatado, troca de disco e transição nativo ↔ físico).
  - `src/electron-app/tests/unit/badAvatarHandlers.test.cjs`: valida que `tools:badavatar-prepare` entrega mensagem simples com `pendrive ou HD (D:)` para a UI preservando o erro técnico bruto no log e na telemetria.
- End-to-End Electron + Playwright:
  - `node src/electron-app/tests/electron/badavatar-prepare-e2e.cjs` (**aprovado** nos 4 cenários): executa `BadAvatarUsbPage.tsx` real via `preload.ts` + `badAvatarHandlers.js` reais no Chromium/Electron, cobrindo (1) HD reformatado `exFAT → FAT32` com refresh automático no clique de *"Preparar pendrive/HD"*, envio do `fingerprint` novo, erro `ENOENT` bruto mantido em log/telemetria e mensagem simples de `pendrive ou HD (D:)` na UI sem vazamento de `.xbox-downloader`/`ENOENT`; (2) troca silenciosa de disco físico em `D:\` bloqueada antes de chamar o preparo; (3) cancelamento do `window.confirm` reabilitando o botão; (4) dump bruto de `fat32format`/`Set-Partition`/`DiskPart` (`14058`) traduzido para mensagem simples na UI enquanto o trace técnico permanece em log e telemetria.
  - `npm run test:electron-security --prefix src/electron-app` (`security-smoke.cjs` + `badavatar-preview-smoke.cjs`): aprovado.
- Backend Go (`go -C src/server test .`): aprovado (`2.288s`), confirmando paridade da versão `2.12.130`.

## Critérios para fechar

- [x] Causa raiz isolada e corrigida na `2.12.130`
- [x] Testes unitários e E2E Electron/Playwright aprovados após a última alteração de código
- [ ] Publicar a versão `2.12.130` e confirmar em campo (ou encerrar o chamado `#373`)
