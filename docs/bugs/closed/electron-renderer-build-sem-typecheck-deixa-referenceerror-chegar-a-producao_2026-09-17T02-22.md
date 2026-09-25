# Bug: nenhum build checa os tipos do renderer, e um `ReferenceError` chega ao usuário final

- **Detectado em:** 2026-09-17 02:22 (triagem de bugs — pendência não rastreada em dois bugs fechados)
- **Origem:** `xbox-360-companion/electron-renderer` — scripts de `src/electron-app/package.json` (`renderer:build`, `tsc`, `test:safety`, `build:*`) e `src/electron-app/tsconfig.json`
- **Errors (serviço):** nenhum próprio. Já produziu os crashes 4850, 4660, 4361 ([`electron-renderer-settingspage-onopenupdatemodal-referenceerror_2026-09-06T04-37.md`](electron-renderer-settingspage-onopenupdatemodal-referenceerror_2026-09-06T04-37.md)) e 5085, 5196, 5368, 5994, 6211, 7065 ([`renderer-onopenupdatemodal-not-defined_2026-09-09T03-15.md`](renderer-onopenupdatemodal-not-defined_2026-09-09T03-15.md)) — 9 reports
- **Classe:** crash (a classe de defeito que ele deixa passar); o furo em si é de processo de build
- **Severidade:** **P2 — Médio** — falha de resiliência do build; corrigido na v2.12.99
- **Versões:** observado na v2.12.98; corrigido na v2.12.99
- **Reincidência:** primeira vez como bug próprio; registrado como "Pendência" nos dois bugs fechados acima

## Sintoma

Não havia sintoma em produção imediato, mas o furo em si permitiu que erros como:

```
Uncaught ReferenceError: onOpenUpdateModal is not defined
```

chegassem ao usuário em releases anteriores. E `tsc` já acusava o erro antes de cada release:

```
SettingsPage.tsx(244,13): error TS2304: Cannot find name 'onOpenUpdateModal'.
```

Estado inicial de 2026-09-17 — `npx tsc --noEmit -p renderer/tsconfig.json` em `src/electron-app`:

```
renderer/components/BadAvatarUsbPage.tsx(512,50): error TS2339: Property 'needsRepair' does not exist on type 'UsbDrive'.
renderer/components/BadAvatarUsbPage.tsx(512,80): error TS2339: Property 'healthStatus' does not exist on type 'UsbDrive'.
renderer/components/BadAvatarUsbPage.tsx(512,153): error TS2339: Property 'operationalStatus' does not exist on type 'UsbDrive'.
renderer/components/MainNav.tsx(344,20): error TS2367: This comparison appears to be unintentional because the types '"library" | ... | "usb-games"' and '"home"' have no overlap.
renderer/components/MainNav.tsx(348,13): error TS2367: (idem)
renderer/components/UsbGamesPage.tsx(742,17): error TS2322: Type '"destructive"' is not assignable to type '"default" | "primary" | "ghost" | "outline" | "secondary"'.
```

## Causa raiz

1. **`renderer:build` era `vite build`** (`package.json`, linha 7). Vite/esbuild transpila TypeScript
   sem checar tipos: um identificador não declarado virava leitura de variável global e só lançava
   quando o código rodava.
2. **O `tsc` dos scripts não enxergava o renderer.** `npm run tsc` usa o `tsconfig.json` da raiz do
   app, que tem `"renderer"` e `"renderer-dist"` em `exclude`. O renderer tem o próprio
   `renderer/tsconfig.json`, que nenhum script invocava.
3. **Nenhuma porta pegava o erro depois.** Todos os `build:*` faziam `renderer:build && tsc`, e
   `test:safety` era `npm run tsc && node --test tests/unit/*.test.cjs`: nenhum dos dois cobria o
   renderer.

## Como reproduzir

1. Em `src/electron-app`, rodar `npx tsc --noEmit -p renderer/tsconfig.json`: apareciam os 6 erros
   acima.
2. Conferir que nenhum script de `package.json` executava esse comando (`renderer:build`, `tsc`,
   `test:safety` e `build:*`).
3. Prova histórica de que um erro desses chega ao usuário: `ea06af0` corrigiu `onOpenUpdateModal`
   na v2.12.71, mas o erro já tinha saído em v2.12.43 e v2.12.67.

## Resolução (v2.12.99)

1. **Zerar os 6 erros de tipagem**:
   - `BadAvatarUsbPage.tsx`: adicionados campos opcionais `needsRepair?: boolean;`, `healthStatus?: string;` e `operationalStatus?: string;` à interface `UsbDrive`.
   - `MainNav.tsx`: removida comparação morta `currentPage === "home"` dentro do bloco `{!onHome && ...}` e simplificado para `variant="default"`.
   - `UsbGamesPage.tsx`: ajustado `variant="default"` no botão de confirmação de exclusão (a estilização vermelha é provida pelas classes utilitárias).
2. **Ativação da checagem em `test:safety` e `renderer:build`**:
   - Adicionado script `"renderer:typecheck": "tsc --noEmit -p renderer/tsconfig.json"`.
   - `"renderer:build"` atualizado para `"npm run renderer:typecheck && vite build"`.
   - `"test:safety"` atualizado para `"npm run tsc && npm run renderer:typecheck && node --test tests/unit/*.test.cjs"`.
3. **Trava automatizada em teste de unidade**:
   - Criado `tests/unit/rendererBuildTypecheck.test.cjs` validando a existência e integração de `renderer:typecheck` em `test:safety` e `renderer:build`.
4. **Rebuild e Reversionamento**:
   - Executado `npm run renderer:build` para atualizar `renderer-dist/` com o bundle limpo e tipado.

## Testes Automatizados

- `tests/unit/rendererBuildTypecheck.test.cjs`: valida a integração dos scripts no `package.json`.
- Aceitação: verificado que `npm run test:safety` falha com código 1 (`TS2304`) ao introduzir identificador não declarado no renderer, e passa com sucesso (código 0) sem ele.

## Critérios para fechar

- [x] Reprodução confirmada e compreendida
- [x] Causa raiz isolada e corrigida (6 erros zerados e checagem ligada nos scripts)
- [x] `npm run test:safety` falha com um identificador não declarado no renderer e passa sem ele
- [x] Validação em hardware real — não se aplica
