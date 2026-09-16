# Bug: disco de conteúdo sem `default.xex` é recusado antes de a tabela de compatibilidade ser consultada

- **Detectado em:** 2026-09-15 11:40 (telemetria de produção)
- **Origem:** telemetria `xbox-360-companion/pipeline` (`fallback.go::ProcessGameWithFallback`)
- **Errors (serviço):** 6699, 6726 (2 ocorrências, mesmo jogo, 2026-09-15 05:09 e 11:40)
- **Classe:** fail
- **Versões:** o componente `pipeline` não manda versão no `user_agent`; `disc_layout.go` não muda desde `ece2826` (2026-09-02), então o defeito está no código atual (v2.12.93)
- **Reincidência:** primeira vez

## Sintoma

```
Download falhou em todas as fontes para Batman - Arkham Origins (Brazil) (En,Es,Pt) (Disco 2) (xbox360):
validar tipo do disco: no game executable (default.xex / default.xbe) found in ISO root
```

Log anexo, por provedor:

```
huggingface: jogo nao encontrado no catalogo
ia: validar tipo do disco: no game executable (default.xex / default.xbe) found in ISO root
minerva: Minerva torrent failed: download muito lento, alternando para o próximo provedor
minerva (retry): validar tipo do disco: no game executable (default.xex / default.xbe) found in ISO root
```

Dois provedores entregaram a ISO certa e os dois esbarraram no mesmo ponto. Não é
download: é a validação recusando um disco que o próprio app sabe instalar.

## Causa raiz

O app **já conhece** este disco como disco de conteúdo:

- `models/compat.go:28` — `{0x57520828, 2}: {InstallType: "content", Notes: "Batman: Arkham Origins Disc 2 contains installable content"}`
- `models/compat.go:336` — dica de nome `{0x57520828, []string{"batman", "arkham origins"}}`
- `docs/reference/multi-disc-compatibility.md:56` — "Batman: Arkham Origins | `57520828` | Disc 2"

Mas `resolveISOInstallType` nunca chegava nessas linhas. Em
`services/pipeline/disc_layout.go:14-17` a **primeira** coisa era:

```go
info, err := utils.ProbeISODiscInfo(isoPath)
if err != nil {
    return "", fmt.Errorf("validar tipo do disco: %w", err)
}
```

E `ProbeISODiscInfo` (`utils/iso2god.go:1131-1146`) terminava em `extractExecInfo`
(`iso2god.go:417-434`), que só aceitava `default.xex` ou `default.xbe` na raiz e senão
retornava o erro visto. Disco de instalação de conteúdo não tem executável na raiz — ele tem
`Content/0000000000000000/<TitleID>/00000002/...`.

O resto da função já fora escrito para esse caso, e ficava inalcançável:

- `disc_layout.go:22-24` caía em `GuessTitleIDFromMultiDiscName(gameName)` quando
  `compatTitleID == 0` ou placeholder — exatamente o que um disco sem executável produziria;
- `ProbeISOInstallLayout` (`iso2god.go:1159-1215`) varre `content/0000000000000000/*` sem
  depender do `TitleID` do executável; só exigia `info` para, se viesse `nil`, chamar
  `ProbeISODiscInfo` de novo — e falhar do mesmo jeito.

Além disso, `DiscNumberFromName` (`models/compat.go:66`) usava regex `(?:disc|disk|dvd|cd)\s*([0-9]+)`,
não reconhecendo o padrão `(Disco 2)` ou `(Disco 1 de 2)` comum em releases brasileiras/ibéricas.

## Como reproduzir

Enfileirar `Batman - Arkham Origins (Brazil) (En,Es,Pt) (Disco 2)` pelo Internet Archive. Ou,
sem baixar, chamar `resolveISOInstallType` com qualquer ISO XGD cuja raiz não tenha
`default.xex`/`default.xbe` e que tenha `content/0000000000000000/<id>/00000002/`.

Esperado: `content`. Observado: `validar tipo do disco: no game executable ...`.

## Resolução (v2.12.96)

1. **Sentinela `ErrNoExecutable` (`src/server/utils/iso2god.go`)**:
   - `extractExecInfo` agora retorna o erro sentinela exportado `ErrNoExecutable = errors.New("no game executable (default.xex / default.xbe) found in ISO root")` quando não encontra `default.xex` nem `default.xbe` na raiz.
   - Erros estruturais de imagem (partição XGD inexistente ou descritor XDVDFS inválido) continuam retornando erros específicos, permitindo que os callers diferenciem corrupção de falta de executável via `errors.Is(err, utils.ErrNoExecutable)`.

2. **Resiliência a Discos de Conteúdo sem Executável (`src/server/services/pipeline/disc_layout.go`)**:
   - `resolveISOInstallType` agora captura `execErr` de `ProbeISODiscInfo(isoPath)`. Se o erro for estritamente `ErrNoExecutable`, a função instancia `info = &TitleExecInfo{}` e prossegue com a validação da estrutura de conteúdo via `ProbeISOInstallLayout`.
   - Caso `rec.InstallType == "content"` ou `layout.HasInstallableContent == true`, o disco é resolvido com sucesso como `"content"`.
   - Caso não haja executável e o disco também não possua conteúdo instalável nem registro de compatibilidade como `content`, o erro original `validar tipo do disco: no game executable ...` é retornado.
   - Pedidos explícitos de `xex` para discos sem executável são rejeitados de imediato com o mesmo erro.

3. **Resiliência em `ProbeISOInstallLayout`, `ExtractXDVDFSContentToDir` e `ProbeContentPackageTitleID` (`src/server/utils/iso2god.go`)**:
   - `ProbeISOInstallLayout` aceita `info == nil` e não aborta quando `ProbeISODiscInfo` retorna `ErrNoExecutable`.
   - `ExtractXDVDFSContentToDir` e `ProbeContentPackageTitleID` tornaram-se seguros contra ponteiro nulo e `TitleID == 0`, buscando a pasta correspondente ou caindo para `FFED2000` e a primeira pasta de TitleID presente em `content/0000000000000000/`.

4. **Instalação de Conteúdo End-to-End (`src/server/services/pipeline/digital.go`)**:
   - `processContentInstallFromISO` tolera `ErrNoExecutable` ao sondar a ISO, derivando `titleID` a partir de `layout.ContentTitleID` ou de `GuessTitleIDFromMultiDiscName(gameName)`, e preenchendo `info.DiscNumber` e `info.DiscCount` através de `models.ExtractDiscInfo(gameName)`.
   - `handleDiscInfo` em `src/server/interfaces/http/handlers.go` também aceita `ErrNoExecutable` para retornar recomendação `content` para ISOs locais sem executável na raiz.

5. **Reconhecimento de `(Disco N)` em Português/Espanhol (`src/server/models/compat.go`, `helpers/multi_disc.go`)**:
   - `discTagPattern` atualizado para `(?:disco|disc|disk|dvd|cd)\s*([0-9]+)(?:\s*(?:of|de|\/)\s*([0-9]+))?`.
   - `discTrailingPattern` atualizado para `\b(?:disco|disc|disk|dvd|cd)\s*([0-9]+)\b`.
   - `discSubtitlePattern` agora inclui `disco` nas palavras-chave de papéis de disco.
   - `genericDiscFolderName` em `helpers/multi_disc.go` agora cobre `(?:disco|disc|...)`.
   - Discos como `Batman - Arkham Origins (Brazil) (En,Es,Pt) (Disco 2)` agora resolvem `DiscNumber = 2`, agrupam-se com o Disco 1 como companheiros (`FindCompanionDiscs`) e casam perfeitamente com a linha `{0x57520828, 2}` da tabela de compatibilidade.

6. **Testes Automatizados**:
   - `models/compat_test.go`: testa parsing de `(Disco 2)`, `(Disco 1 de 2)` e agrupamento de irmãos para `Batman - Arkham Origins (Brazil) (En,Es,Pt) (Disco 1/2)`.
   - `utils/god_validate_test.go`: testa `ProbeISOInstallLayout` com `info == nil` em ISO sem executável e `ExtractXDVDFSContentToDirNilInfoSafe`.
   - `services/pipeline/disc_layout_test.go`: testes unitários pontuais para `resolveISOInstallType` (resolução como `content` sem executável, recusa de disco sem executável e sem conteúdo, recusa de ISO corrompida e recusa de pedido `xex`) e teste end-to-end de `processContentInstallFromISO` empacotando o conteúdo da ISO sintética.
