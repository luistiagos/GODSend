# Bug: `Uncaught ReferenceError: onOpenUpdateModal is not defined` no bundle do Renderer

- **Detectado em:** 2026-09-09 03:15 (telemetria de produção)
- **Status:** **Duplicado** de [`electron-renderer-settingspage-onopenupdatemodal-referenceerror_2026-09-06T04-37.md`](electron-renderer-settingspage-onopenupdatemodal-referenceerror_2026-09-06T04-37.md) — já corrigido no commit `ea06af0`
- **Origem:** telemetria `xbox-360-companion/electron-renderer` (`renderer-dist/assets/index-*.js::window.onerror`)
- **Errors (serviço):** 5085, 5196, 5368 (3 ocorrências); **triagem de 2026-09-15:** 5994, 6211 (+2); **triagem de 2026-09-17:** 7065 (+1, v2.12.67); **triagem de 2026-09-30:** 8724 (+1, v2.12.46)
- **Classe:** crash
- **Versões:** ElectronApp v2.12.43, v2.12.46 e v2.12.67 — todas **anteriores** à correção

## Novas ocorrências (triagens de 2026-09-15 a 2026-09-30)

- **5994** (2026-09-12 00:27) e **6211** (2026-09-13 07:08), duas máquinas diferentes, ambas
  **ElectronApp v2.12.67** e o mesmo bundle `index-CHZYXPsL.js`. Stack de 5994:
  `ReferenceError: onOpenUpdateModal is not defined at onClick (index-CHZYXPsL.js:356:1754)`.
- **7065** (2026-09-17), também em v2.12.67.
- **8724** (2026-09-27 01:41), em **ElectronApp v2.12.46** (bundle `index-BoIdq-ry.js`).
- Não é regressão: todas as versões continuam anteriores a `ea06af0` (v2.12.71). São clientes legados
  que ainda não atualizaram manualmente.
- **Critério de reabertura:** a mesma mensagem com `user_agent` ≥ v2.12.71.

## Sintoma

```
Uncaught ReferenceError: onOpenUpdateModal is not defined
```

## Causa raiz

A mesma do bug fechado: em `SettingsPage.tsx`, `onOpenUpdateModal` estava declarada em
`SettingsPageProps` e era passada por `App.tsx`, mas **não era desestruturada** dos props. O
handler de *Verificar atualizações* e o botão de update liam um identificador livre, e isso
lança `ReferenceError` (só quando existe versão nova).

Conferido no histórico:

| Commit | Versão | `onOpenUpdateModal` na desestruturação de `SettingsPage` |
|---|---|---|
| `8fb3002` | v2.12.43 | ❌ ausente |
| `9d82b3f` | v2.12.67 | ❌ ausente |
| `ea06af0` | v2.12.71 → v2.12.76 | ✅ acrescentada |

As duas versões destes reports são anteriores a `ea06af0`: são clientes que ainda não
atualizaram, não uma regressão.

## Verificação do estado atual

- Fonte: `SettingsPage.tsx` e `HomePage.tsx` desestruturam `onOpenUpdateModal`; `App.tsx` passa a prop
  para os dois.
- Bundle versionado (`renderer-dist/assets/index-CLN6IxkW.js`): as 3 ocorrências de
  `onOpenUpdateModal` são chaves de objeto (`onOpenUpdateModal:re`, `onOpenUpdateModal:c`,
  `onOpenUpdateModal:_=>…`) — nenhuma leitura de identificador livre.
- `npx tsc --noEmit -p renderer/tsconfig.json` (2026-09-10): nenhum `TS2304`. Restam só os mesmos
  6 erros de tipo já listados no bug fechado (`BadAvatarUsbPage.tsx`, `MainNav.tsx`,
  `UsbGamesPage.tsx`).

## Pendência

Continua valendo a do bug fechado: o renderer não é checado por tipos em nenhum script de build
(`renderer:build` é `vite build`; o `npm run tsc` só cobre o processo Main). Um `TS2304` novo no
renderer ainda chegaria ao usuário final.
