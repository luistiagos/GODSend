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

Mas `resolveISOInstallType` nunca chega nessas linhas. Em
`services/pipeline/disc_layout.go:14-17` a **primeira** coisa é:

```go
info, err := utils.ProbeISODiscInfo(isoPath)
if err != nil {
    return "", fmt.Errorf("validar tipo do disco: %w", err)
}
```

E `ProbeISODiscInfo` (`utils/iso2god.go:1131-1146`) termina em `extractExecInfo`
(`iso2god.go:417-434`), que só aceita `default.xex` ou `default.xbe` na raiz e senão
retorna o erro visto. Disco de instalação de conteúdo não tem executável na raiz — ele tem
`Content/0000000000000000/<TitleID>/00000002/...`.

O resto da função já foi escrito para esse caso, e fica inalcançável:

- `disc_layout.go:22-24` cai em `GuessTitleIDFromMultiDiscName(gameName)` quando
  `compatTitleID == 0` ou placeholder — exatamente o que um disco sem executável produziria;
- `ProbeISOInstallLayout` (`iso2god.go:1159-1215`) varre `content/0000000000000000/*` sem
  depender do `TitleID` do executável; só exige `info` para, se vier `nil`, chamar
  `ProbeISODiscInfo` de novo — e falhar do mesmo jeito.

Não é específico do Batman: vale para **qualquer** linha `content` da tabela cujo disco não
traga executável na raiz.

## Como reproduzir

Enfileirar `Batman - Arkham Origins (Brazil) (En,Es,Pt) (Disco 2)` pelo Internet Archive. Ou,
sem baixar, chamar `resolveISOInstallType` com qualquer ISO XGD cuja raiz não tenha
`default.xex`/`default.xbe` e que tenha `content/0000000000000000/<id>/00000002/`.

Esperado: `content`. Observado: `validar tipo do disco: no game executable ...`.

## Próximos passos

1. Em `resolveISOInstallType`, tratar "sem executável na raiz" como `info` vazio
   (`TitleID == 0`, `DiscNumber == 0`) em vez de erro, e deixar `ProbeISOInstallLayout` +
   `GuessTitleIDFromMultiDiscName` + `DiscNumberFromName` decidirem. Só recusar se o layout
   **também** não achar conteúdo instalável.
2. Distinguir esse caso de ISO corrompida: erro de `detectXGDPartition` ou
   `readXDVDFSVolDesc` continua sendo recusa.
3. `ProbeISOInstallLayout` não deve reprovar por `info == nil` sem executável.
4. **`DiscNumberFromName` não reconhece `(Disco 2)`.** Medido rodando as duas regex de
   `models/compat.go:66` e `:68` copiadas literalmente:

   ```
   "Batman - Arkham Origins (Brazil) (En,Es,Pt) (Disco 2)" tag=[] trailing=[]
   "Batman - Arkham Origins (USA) (Disc 2)"                tag=[ (Disc 2) 2 ] trailing=[]
   ```

   `(?:disc|disk|dvd|cd)\s*([0-9]+)` exige o dígito logo depois de `disc`; o `o` de `Disco`
   quebra. Então, depois do item 1, este jogo ainda chegaria com `DiscNumber == 0` e a linha
   `{0x57520828, 2}` da tabela **não casaria** — só resolveria `content` se
   `ProbeISOInstallLayout` achar a pasta `content/`. Acrescentar `disco` às duas regex
   (e revisar o que mais usa `ExtractDiscInfo`: agrupamento de irmãos, disco faltante).
5. Teste: ISO sintética só com `content/0000000000000000/57520828/00000002/<arquivo>` e nome
   `... (Disco 2)` deve resolver `content`.
