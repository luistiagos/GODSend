# Bug: nome de pasta XEX sem TitleID com mais de 42 caracteres nao e cortado para o HD (FATX) do console

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

## Causa raiz (a confirmar)

`AGENTS.md` (modulo pipeline) registra o motivo do corte: "`TransferXEX` descarta o resultado de `MkdirAll` e um nome
recusado vira job de FTP falhando igual em toda retentativa". `infrastructure/ftp/client.go::TransferXEX` (linha ~490)
monta `base := fmt.Sprintf("/%s/%s/%s", drive, xexSubPath, folderName)` e chama `MkdirAll(fc, base)` sem olhar o erro.
O corte existe so no ramo com TitleID; o ramo sem TitleID devolve o nome cru. Nao conferido: se o Aurora/FTP do console
recusa ou trunca o nome; se o mesmo vale para o nome com TitleID ja presente no fim (`HasSuffix`), que tambem pula o
corte.

## Como reproduzir

So com console (FTP para `Hdd1`): baixar um jogo/homebrew XEX sem TitleID e com nome de release > 42 caracteres, em
modo FTP. Offline: teste de unidade de `XEXFolderName` com pasta sem TitleID e nome de 51 caracteres -> devolve 51.

## Resolucao

(a definir — provavelmente cortar em `fatxMaxNameLen` tambem sem TitleID, preservando o comportamento do pendrive FAT32,
onde o nome longo e valido)

## Testes Automatizados

(a definir — caso em `infrastructure/helpers/xex_folder_name_test.go`)

## Criterios para fechar

- [ ] Reproducao confirmada e compreendida (console ou teste de unidade)
- [ ] Causa raiz isolada e corrigida
- [ ] Teste unitario cobrindo nome sem TitleID > 42 caracteres
- [ ] Validacao em hardware real (FTP para o HD do console)
