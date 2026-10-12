# Bug: jogo XEX cujo arquivo traz `default.xex` na raiz e gravado numa pasta com o sufixo de scratch `_hf_ext` (e sem TitleID)

- **Detectado em:** 2026-10-12 14:56 (teste local do pipeline, sessao de teste do bug
  `pipeline-jogo-xex-com-145-mil-arquivos-leva-mais-de-10-horas-para-gravar-em-pendrive-fat32_2026-10-09T19-40`)
- **Origem:** `src/server/services/pipeline/huggingface.go` (linha 71: `xexDestinationName(xexFolder, filepath.Base(xexFolder), gameName)`)
- **Errors (servico):** N/A (local)
- **Classe:** ux
- **Versoes:** 2.12.110 (`origin/main` @ `50dcfe9`, binario SEM o fix do bug acima) e o branch desse bug — igual nos dois
- **Reincidencia:** primeira vez
- **Severidade (sugerida):** P3 — o jogo grava inteiro e correto; so o nome da pasta no pendrive fica feio e sem TitleID

## Sintoma

App da lane `wt-1` em modo dev, Catalogo -> "EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )" (catalogo HF
`luisluis123/xboxrghgames`, `.zip` com `default.xex` na RAIZ do arquivo, 2.216 arquivos) -> XEX -> pendrive de teste `E:\`.
Log do backend:

```
[14:50:44] LOCAL XEX: 2216 arquivos (0.16 GB) -> E:\Games\EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )_hf_ext
```

A pasta no pendrive fica `E:\Games\EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )_hf_ext`: o sufixo `_hf_ext` e o nome
da pasta de extracao (scratch), e nao ha ` - <TitleID>`. Um jogo cujo arquivo traz uma subpasta (ex.: Digimon All Star
Rumble no mesmo teste) grava `Digimon All Star Rumble (0.421) - 4E4D0869`, correto.

Evidencia: `C:\projects\.bugfix-xbox360\evidencia\20261012-teste-r1-pipeline-jogo-xex-145-mil\t2-base-log-janela.txt`
(linha `LOCAL XEX`) e `t2-base-result.json` (`pastaJogo`).

## Causa raiz (a confirmar na investigacao)

- `huggingface.go` linha 61: `extDir := filepath.Join(s.outputRoot(gameName), safeName+"_hf_ext")`.
- Linha 68: `xexFolder := helpers.FindXEXFolder(extDir)` — com `default.xex` na raiz do arquivo, `xexFolder == extDir`.
- Linha 71: `xexDestinationName(xexFolder, filepath.Base(xexFolder), gameName)` -> o nome-base e `<safeName>_hf_ext`.
  `companion_content.go::xexDestinationName` so troca nomes genericos de disco (`IsGenericDiscFolderName`), nao o sufixo de
  scratch; `helpers.go::XEXFolderName` nao acrescentou TitleID (provavelmente `FindTitleIDInDir` voltou vazio ou o
  `SystemTitleID` para este homebrew — nao conferido).
- Nao conferido: se os outros provedores (torrent `_ext`/`_extracted`, Minerva, IA) tem o mesmo padrao quando o
  `default.xex` esta na raiz (`workspace.go` lista os sufixos `_hf_ext`, `_ext`, `_extracted`, `_torrent`).

## Como reproduzir

1. App em modo dev (`npm start` numa lane), destino local = uma pasta/pendrive.
2. Catalogo -> filtrar "Master System" -> "EMULADOR MASTER SYSTEM + 376 ROMS" -> XEX -> Adicionar a fila.
3. Ver o log `LOCAL XEX: ... -> <destino>\Games\<nome>_hf_ext`.

## Resolucao

(a definir)

## Testes Automatizados

(a definir — teste de `xexDestinationName`/caminho HF com `default.xex` na raiz do `extDir`)

## Criterios para fechar

- [ ] Reproducao confirmada e compreendida
- [ ] Causa raiz isolada e corrigida (nome = titulo do jogo, sem sufixo de scratch, com TitleID quando houver)
- [ ] Teste unitario cobrindo `default.xex` na raiz do arquivo
- [ ] Validacao no app (pasta gravada com o nome certo)
