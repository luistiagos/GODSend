# Bug: `ReferenceError: onOpenUpdateModal is not defined` derruba o renderer em Configurações

- **Detectado em:** 2026-09-06 04:37 (telemetria de produção)
- **Status:** **Resolvido** (v2.12.72)
- **Origem:** telemetria `xbox-360-companion/electron-renderer` (`window.onerror`)
- **Errors (serviço):** **4850**, **4660**, **4361** (3 ocorrências) — eram os **únicos** erros com status `open` do projeto
- **Classe:** crash
- **Reincidência:** presente em v2.12.43 e v2.12.58 — pelo menos três releases

## Sintoma

```
Uncaught ReferenceError: onOpenUpdateModal is not defined
```

| id | data | versão | plataforma |
|---|---|---|---|
| 4850 | 2026-09-06 04:37:35 | ElectronApp v2.12.43 | win32/x64/10.0.19045 |
| 4660 | 2026-09-05 15:37:46 | ElectronApp v2.12.58 | win32/x64/10.0.26200 |
| 4361 | 2026-09-04 10:10:21 | ElectronApp v2.12.43 | win32/x64/10.0.19045 |

Três usuários distintos, duas versões diferentes, três dias seguidos. Como é `window.onerror`
(exceção não capturada durante o render do React), a interface inteira cai.

## Causa raiz

Em [`SettingsPage.tsx`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/electron-app/renderer/components/SettingsPage.tsx),
a prop existia em todo lugar **menos** onde importava:

| Onde | Linha | Situação |
|---|---|---|
| Declarada em `SettingsPageProps` | 56 | ✅ `onOpenUpdateModal?: (info: any) => void;` |
| Passada por `App.tsx` | 391 | ✅ `onOpenUpdateModal={(info) => {…}}` |
| Usada no handler de update | 244-245 | ❌ identificador livre |
| Usada no botão de update | 784 | ❌ identificador livre |
| **Desestruturada dos props** | 60-64 | ❌ **ausente** |

```tsx
export default function SettingsPage({
  onAppendLine,
  simpleMode = true,
  onSimpleModeChange,
  // onOpenUpdateModal faltava aqui
}: SettingsPageProps) {
```

Ler um **identificador não declarado** lança `ReferenceError` — diferente de ler uma propriedade
`undefined`, que só devolve `undefined`. Por isso nem a guarda da linha 784 protegia:

```tsx
onClick={() => onOpenUpdateModal && onOpenUpdateModal(updateAvailableInfo)}
```

Ela *parece* defensiva, mas o `&&` já explode ao avaliar o operando esquerdo.

**Caminho até o crash:** o usuário abre Configurações → *Verificar atualizações*. A linha 244 só é
alcançada quando `res.updateAvailable` é verdadeiro — ou seja, **o crash só acontece quando existe
uma versão nova**. Quem mais precisava atualizar era exatamente quem não conseguia.

## Por que passou pelo build

O `tsc` acusava os quatro erros desde sempre:

```
SettingsPage.tsx(244,13): error TS2304: Cannot find name 'onOpenUpdateModal'.
SettingsPage.tsx(245,11): error TS2304: Cannot find name 'onOpenUpdateModal'.
SettingsPage.tsx(784,38): error TS2304: Cannot find name 'onOpenUpdateModal'.
SettingsPage.tsx(784,59): error TS2304: Cannot find name 'onOpenUpdateModal'.
```

Mas `npm run renderer:build` é `vite build`, e o Vite/esbuild **transpila sem checar tipos**. O
`npm run tsc` dos scripts de build cobre o processo Main (`tsconfig.json` da raiz do app), não o
renderer (`renderer/tsconfig.json`). O erro nunca bloqueou um release.

## Resolução implementada

Uma linha: `onOpenUpdateModal` acrescentado à desestruturação. Confirmado que os quatro `TS2304`
somem de `npx tsc --noEmit -p renderer/tsconfig.json`.

## Pendência: o furo de processo continua aberto

O renderer **não é checado por tipos em nenhum script de build**. Restam 6 erros de tipo conhecidos
em `renderer/tsconfig.json`, todos capazes de virar o mesmo tipo de crash em produção:

```
BadAvatarUsbPage.tsx(505): 'needsRepair' / 'healthStatus' / 'operationalStatus' não existem em UsbDrive
MainNav.tsx(344,348): comparação com "home" sem sobreposição de tipos
UsbGamesPage.tsx(742): variant "destructive" não existe no Button
```

Recomendado: incluir `tsc --noEmit -p renderer/tsconfig.json` nos scripts `build:*`, depois de
zerar esses 6. Enquanto isso não acontece, um `TS2304` no renderer chega ao usuário final.
