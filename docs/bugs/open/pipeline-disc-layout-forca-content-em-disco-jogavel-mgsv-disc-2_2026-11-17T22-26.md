# Bug: `resolveISOInstallType` classifica disco jogável (`Metal Gear Solid V: The Phantom Pain - Disc 2`) como `content` e falha com `no content/ dir in ISO`

- **Detectado em:** 2026-11-17 22:26 (triagem do chamado `#232` do painel, sessao `161091405496378@lid`, `cfmota418@hotmail.com`)
- **Origem:** `xbox-360-companion/pipeline` — `src/server/services/pipeline/disc_layout.go::resolveISOInstallType` e `src/server/models/compat.go::DiscCompatTable`
- **Errors (serviço):** `12520` (`2026-11-02T22:43:56`, `pipeline v2.12.123`) e `11420` (`2026-10-23T17:16:48`, `pipeline v2.12.116`)
- **Classe:** fail (rejeicao de disco jogavel apos download completo)
- **Severidade:** **P1 — Alto** (bloqueia por completo a instalacao de `Metal Gear Solid V - The Phantom Pain (USA, Europe) ... (Disc 2)` no Internet Archive e no Minerva depois de baixar gigabytes)
- **Complexidade:** média (`src/server/services/pipeline/disc_layout.go::resolveISOInstallType` + teste unitario com ISO sintetica)
- **Versões:** `v2.12.116` (`11420`) e `v2.12.123` (`12520`); o comportamento permanece identico no `HEAD` atual (`disc_layout.go` linhas 33–51)
- **Reincidência:** relacionado a [[pipeline-gta5-multidisco-termina-pronto-e-nao-inicia-no-console-reincidencia_2026-10-15T15-40]] (Causa raiz #1: `resolveISOInstallType` permite que `rec.InstallType == "content"` sobreponha `layout.HasInstallableContent == false`). Aquele doc trata de GTA V / Alien Isolation e sua T3 propoe falhar cedo quando a tabela diz `content` sem pasta `content/`, o que **manteria** o Disc 2 jogavel de MGSV quebrado em vez de instala-lo como `god`.

## Sintoma, na ordem que o cliente viveu (UTC)

1. **2026-11-02 22:47 (`[165585]`):** cliente do chamado `#232` enviou print da Fila de tarefas do Companion mostrando erro para `Metal Gear Solid V - The Phantom Pain (USA, Europe) (En,Ja,Fr,De,Es,It,Pt,Ru) (Disc 2)`:
   `Download falhou em todas as fontes. Erros: ia: content extract: contentExtract: no content/ dir in ISO | huggingface: jogo nao encontrado`
2. Na telemetria (`errors` + `error_logs`), 3 minutos antes do print (`2026-11-02T22:43:56`, `id=12520`, `pipeline v2.12.123`), o pipeline registrou a cadeia completa:
   - `seq=0`: `ia: content extract: contentExtract: no content/ dir in ISO`
   - `seq=1`: `huggingface: jogo nao encontrado no catalogo`
   - `seq=2`: `minerva: content extract: contentExtract: no content/ dir in ISO`
3. O mesmo erro ja havia ocorrido em `2026-10-23T17:16:48` (`id=11420`, `pipeline v2.12.116`), falhando em `ia`, `minerva` e `minerva (retry)` com `contentExtract: no content/ dir in ISO`.

## Evidência

- **Conversa (`Wpp_proccess`, sessao `161091405496378@lid`):** `[165585]` (02/11 22:47 UTC).
- **Telemetria (`errors` / `error_logs`):** `12520` (`2026-11-02T22:43:56`, `pipeline v2.12.123`) e `11420` (`2026-10-23T17:16:48`, `pipeline v2.12.116`).
- **Codigo aberto:**
  - `src/server/models/compat.go:49`: `DiscCompatTable` contem apenas `{0x4B4E085E, 1}: {InstallType: "content", Notes: "Metal Gear Solid V Disc 1 is the installation/content disc"}`. O Disco 2 (`{0x4B4E085E, 2}`) nao esta na tabela e retorna default `"god"`.
  - `src/server/services/pipeline/disc_layout.go:33-51`:
    ```go
    compatDiscNumber := info.DiscNumber
    if compatDiscNumber == 0 {
        compatDiscNumber = models.DiscNumberFromName(gameName)
    }
    rec := models.DiscCompat(compatTitleID, compatDiscNumber)
    ...
    } else if rec.InstallType == "content" || layout.HasInstallableContent {
        resolved = "content"
    }
    ```
  - `src/server/utils/iso2god.go:1368-1371` (`ProbeISOInstallLayout`) e `iso2god.go:1461-1463` (`ExtractXDVDFSContentToDirWithContext`): ambas procuram `"content"` na raiz XDVDFS via `findInDir`. Como `ExtractXDVDFSContentToDirWithContext` retornou `no content/ dir in ISO`, `layout.HasInstallableContent` era `false`.

## Causa raiz (parcialmente isolada)

**Comprovado no codigo (`disc_layout.go::resolveISOInstallType`):**
1. A linha 49 de `disc_layout.go` aceita `rec.InstallType == "content"` mesmo quando `layout.HasInstallableContent == false`, contrariando o comentario do proprio arquivo (`"The ISO structure probe remains authoritative"`).
2. Como `layout.HasInstallableContent` era `false`, `Metal Gear Solid V ... (Disc 2)` so entrou no ramo `"content"` porque `models.DiscCompat(compatTitleID, compatDiscNumber)` retornou `InstallType: "content"` — ou seja, `compatTitleID` resolveu para `0x4B4E085E` com `compatDiscNumber == 1` apesar de `gameName` declarar `(Disc 2)`.

**Hipótese — não verificada no binário da ISO:**
- O `default.xex` dentro da ISO de `Metal Gear Solid V - The Phantom Pain ... (Disc 2)` (Play Disc, ja que o Disc 1 e apenas instalador) provavelmente declara `DiscNumber = 1` no cabecalho XEX2. Como `disc_layout.go:33-36` prioriza `info.DiscNumber` sobre `models.DiscNumberFromName(gameName)` quando `info.DiscNumber != 0`, o Disc 2 jogavel cai na entrada `{0x4B4E085E, 1}` de `DiscCompatTable` e e forcado para `content` mesmo sem pasta `content/` e com `default.xex` valido (`execErr == nil`).

## Escopo — o que NAO e este bug

- As falhas por lentidao/estagnacao em `Dead Island` (`[165585]`, 02/11) e `Operation Flashpoint: Dragon Rising` (`[169183]`, 06/11) no mesmo chamado `#232`: ocorreram na `v2.12.123`, versao anterior ao fix da `v2.12.124` (`e6ea18d`), e ja estao documentadas em `docs/bugs/retest/pipeline-download-falha-em-todas-as-fontes-por-lentidao-e-estagnacao-cliente-perde-13-titulos_2026-11-06T16-40.md`.
- O bug `pipeline-gta5-multidisco-termina-pronto-e-nao-inicia-no-console-reincidencia_2026-10-15T15-40` (em `open/`): la a T3 trata de disco de instalacao sem `content/` (onde nao ha executavel jogavel e falhar cedo e desejavel); aqui o Disco 2 e jogavel e precisa ser instalado como `god`.

## Como reproduzir

1. Inspecionar o cabecalho XEX2 (`ProbeISODiscInfo`) e a arvore raiz XDVDFS da ISO `Metal Gear Solid V - The Phantom Pain (USA, Europe) (En,Ja,Fr,De,Es,It,Pt,Ru) (Disc 2)` do Internet Archive ou Minerva.
2. Ou enfileirar `Metal Gear Solid V - The Phantom Pain (USA, Europe) (En,Ja,Fr,De,Es,It,Pt,Ru) (Disc 2)` em `xbox360` com `install_type=god`.

## Resolução (vX.Y.Z)

*(Pendente — inspecionar o XEX2 do Disc 2 para confirmar `info.DiscNumber` e ajustar `resolveISOInstallType`: quando `layout.HasInstallableContent == false` e `execErr == nil` com disco jogavel identificado como `Disc 2` pelo nome/catalogo, nao forcar `content` e seguir para `god`)*

## Testes Automatizados

*(Pendente — adicionar teste unitario em `src/server/services/pipeline/disc_layout_test.go` cobrindo ISO jogavel `(Disc 2)` com `TitleID 0x4B4E085E`, `info.DiscNumber == 1` e sem `content/` resolvendo para `god`)*

## Critérios para fechar

- [ ] Confirmar `info.DiscNumber` e raiz da ISO real de MGSV Disc 2 (ou reproduzir com ISO sintetica)
- [ ] Corrigir `resolveISOInstallType` para nao forcar `content` em disco jogavel sem `content/`
- [ ] Teste unitario automatizado cobrindo o caso
- [ ] `go test -count=1 ./...` aprovado em `src/server`
