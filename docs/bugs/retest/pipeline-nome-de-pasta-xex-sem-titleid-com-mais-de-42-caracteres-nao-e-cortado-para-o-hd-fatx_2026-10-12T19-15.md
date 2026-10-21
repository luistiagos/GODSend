# Bug: nome de pasta XEX sem TitleID com mais de 42 caracteres nao e cortado para o HD (FATX) do console

## Status

- **Corrigido e testado:** 2026-10-16.
- **Onde:** `src/server/infrastructure/helpers/helpers.go::XEXFolderName` — corte de `fatxMaxNameLen` (42 caracteres) aplicado também a nomes sem TitleID (`titleID == ""` e `SystemTitleID`), e truncamento da base preservando o TitleID único quando o nome já termina em TitleID mas excede 42 caracteres.
- **Evidência:**
  - Testes unitários novos em `src/server/infrastructure/helpers/xex_folder_name_test.go`:
    - `TestXEXFolderNameFitsFATXNameLimitWithoutTitleID`: homebrew de 51 caracteres sem TitleID ("EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )") é truncado para 42 caracteres ("EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 3").
    - `TestXEXFolderNameFitsFATXNameLimitWithSystemTitleID`: jogo com `SystemTitleID` e nome longo é truncado em 42 caracteres sem o TitleID de sistema e sem espaços/pontos finais.
    - `TestXEXFolderNameFitsFATXNameLimitWhenTitleIDAlreadyPresent`: nome longo que já terminava em TitleID é truncado na base preservando o sufixo único " - <TitleID>" com comprimento total <= 42.
  - Regressão e integração:
    - `src/server/services/pipeline/companion_content_test.go::TestXexDestinationNameNamesARootRipAfterTheReleaseNotTheScratchDir` atualizado para validar tanto a remoção do sufixo de scratch `_hf_ext` quanto o corte em 42 caracteres para FATX.
    - Suíte Go completa: `go test ./...` 100% PASS (todos os pacotes).
    - Suíte Electron: `npm run test:safety` 345/345 testes PASS.
  - Teste End-to-End (E2E) via Playwright + Electron App + Backend Go:
    - Evidência em `C:\projects\.bugfix-xbox360\evidencia\20261016-0015-pipeline-nome-xex-sem-titleid-fatx\`.
    - Executado teste real de download e gravação de "EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )" (51 caracteres) na unidade USB `E:\`.
    - Acompanhamento da fila do app: download de 98 MB do HuggingFace, extração de 2.216 arquivos (165 MB) e gravação no dispositivo.
    - Pasta final criada no pendrive: `E:\Games\EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 3` (exatamente 42 caracteres, com `default.xex` na raiz, 2.216 arquivos gravados, marcador `.xbox-companion-installing` removido, zero arquivos em staging).
    - Screenshots registrados: `t2-fix-0-home.png`, `t2-fix-1-dialogo.png`, `t2-fix-2-enfileirado.png`, `t2-fix-3-gravando.png`, `t2-fix-4-fila-fim.png`.
- **Falta para `closed/`:** Validação em hardware real (FTP para o HD do console Xbox 360 / Hdd1) e versão publicada.

- **Detectado em:** 2026-10-12 19:15 (investigacao no codigo, planning do pipeline 20261012-1854)
- **Origem:** `src/server/infrastructure/helpers/helpers.go::XEXFolderName` (`fatxMaxNameLen`)
- **Origem (pipeline):** achado lateral do pipeline em `pipeline-xex-com-default-xex-na-raiz-do-arquivo-grava-pasta-com-sufixo-hf-ext_2026-10-12T14-56`
- **Errors (servico):** N/A (local)
- **Classe:** fail
- **Versoes:** codigo de `origin/main` @ `cab6830` (2.12.110); nao reproduzido (nao ha console de teste)
- **Reincidencia:** primeira vez (lacuna da correcao 2.12.81)

## Sintoma

Nao observado em campo. Inferido do codigo: `XEXFolderName` so corta o nome em 42 caracteres (limite FATX do HD interno)
quando ha TitleID para acrescentar. Sem TitleID (`FindTitleIDInDir` vazio ou `SystemTitleID`), o nome volta inteiro:

```go
if titleID == "" || titleID == SystemTitleID || strings.HasSuffix(strings.ToUpper(folderName), titleID) {
    return folderName
}
```

Exemplo real: o homebrew "EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )" (catalogo HF `luisluis123/xboxrghgames`)
tem `default.xex` SEM o cabecalho opcional de execution-info `0x40006` (11 cabecalhos lidos do arquivo; nenhum e
`0x40006`), entao nao tem TitleID, e o nome tem 51 caracteres. Enviado por FTP ao `Hdd1`, o destino
`/Hdd1/Games/<51 caracteres>` passa do limite FATX.

## Causa raiz (confirmada)

`AGENTS.md` (modulo pipeline) registra o motivo do corte: "`TransferXEX` descarta o resultado de `MkdirAll` e um nome
recusado vira job de FTP falhando igual em toda retentativa". `infrastructure/ftp/client.go::TransferXEX` (linha ~490)
monta `base := fmt.Sprintf("/%s/%s/%s", drive, xexSubPath, folderName)` e chama `MkdirAll(fc, base)` sem olhar o erro.
O corte existia só no ramo com TitleID a adicionar; o retorno antecipado sem TitleID (`titleID == ""` ou `SystemTitleID`)
ou com TitleID já presente no fim (`HasSuffix`) devolvia o nome sem aplicar o corte em `fatxMaxNameLen` (42 caracteres).

## Como reproduzir

So com console (FTP para `Hdd1`): baixar um jogo/homebrew XEX sem TitleID e com nome de release > 42 caracteres, em
modo FTP. Offline: teste de unidade de `XEXFolderName` com pasta sem TitleID e nome de 51 caracteres -> devolvia 51.

## Resolucao

1. Em `src/server/infrastructure/helpers/helpers.go::XEXFolderName`:
   - Quando `titleID == ""` ou `titleID == SystemTitleID`, se `len([]rune(folderName)) > fatxMaxNameLen`, trunca para `fatxMaxNameLen` (42 caracteres) e remove espaços/pontos finais (`strings.TrimRight(..., " .")`).
   - Quando `strings.HasSuffix(strings.ToUpper(folderName), titleID)`, se o comprimento total for menor ou igual a 42 caracteres, mantém o nome intacto. Caso exceda 42 caracteres, remove o sufixo de TitleID existente e delimitadores, trunca a base para `fatxMaxNameLen - len(suffix)` runes e reanexa o sufixo `" - " + titleID`, garantindo unicidade e comprimento <= 42 caracteres.
2. Em `src/server/services/pipeline/companion_content_test.go`:
   - `TestXexDestinationNameNamesARootRipAfterTheReleaseNotTheScratchDir` atualizado para esperar a pasta truncada para 42 caracteres ("EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 3").

## Testes Automatizados

- Casos adicionados em `src/server/infrastructure/helpers/xex_folder_name_test.go`:
  - `TestXEXFolderNameFitsFATXNameLimitWithoutTitleID`
  - `TestXEXFolderNameFitsFATXNameLimitWithSystemTitleID`
  - `TestXEXFolderNameFitsFATXNameLimitWhenTitleIDAlreadyPresent`
- Caso atualizado em `src/server/services/pipeline/companion_content_test.go`:
  - `TestXexDestinationNameNamesARootRipAfterTheReleaseNotTheScratchDir`

## Criterios para fechar

- [x] Reproducao confirmada e compreendida (console ou teste de unidade)
- [x] Causa raiz isolada e corrigida
- [x] Teste unitario cobrindo nome sem TitleID > 42 caracteres
- [ ] Validacao em hardware real (FTP para o HD do console)

