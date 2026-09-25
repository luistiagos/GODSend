# Bug: Disco multi-disco No-GOD (ex: Assassin's Creed IV Disc 2) é rejeitado quando pedido como GOD em vez de promover para XEX

- **Detectado em:** 2026-09-22 09:08 (telemetria de produção)
- **Origem:** telemetria `xbox-360-companion/pipeline` (`fallback.go::ProcessGameWithFallback` via `disc_layout.go::resolveISOInstallType`)
- **Errors (serviço):** 8181 (Assassin's Creed IV Black Flag [RF][DVD2])
- **Classe:** fail
- **Versões:** presente desde a introdução de `disc_layout.go` (v2.12.60+) até v2.12.98
- **Reincidência:** primeira vez
- **Status:** **Resolvido** (v2.12.99)

## Sintoma

```
Download falhou em todas as fontes para Assassins Creed IV Black Flag [RF][DVD2] (games):
ia: este disco nao e compativel com GOD; selecione instalacao XEX: Assassin's Creed IV Disc 2 is a No-GOD multiplayer disc; extract as XEX
```

O jogo foi baixado por completo (vários gigabytes), mas a validação de layout do disco abortou a instalação com erro bloqueante, fazendo o pipeline tentar todos os provedores em vão e encerrar o download em falha.

## Causa raiz

A tabela de compatibilidade multi-disco (`models/compat.go:26`) documenta:
```go
{0x555308C2, 2}: {InstallType: "xex", Notes: "Assassin's Creed IV Disc 2 is a No-GOD multiplayer disc; extract as XEX"},
```

Porém, em `services/pipeline/disc_layout.go`:
```go
rec := models.DiscCompat(compatTitleID, compatDiscNumber)
if rec.InstallType == "xex" {
    if execErr != nil {
        return "", fmt.Errorf("validar tipo do disco: %w", execErr)
    }
    if requested != "xex" {
        return "", fmt.Errorf("este disco nao e compativel com GOD; selecione instalacao XEX: %s", rec.Notes)
    }
    return "xex", nil
}
```

Quando o usuário adiciona o jogo à fila a partir do catálogo, ou em modo simples (Simple Mode), ou ao enfileirar o conjunto multi-disco completo, o formato solicitado (`requested`) padrão é `"god"`.
Para discos de conteúdo (`content`), o backend já promovia automaticamente `requested` para `content` (`if rec.InstallType == "content" || layout.HasInstallableContent { resolved = "content" }`).
Mas para discos `xex` (discos sem suporte a GOD cuja estrutura exige XEX, como multiplayer do AC IV), o código disparava um erro bloqueante que derrubava o job e descartava o download.

## Como reproduzir

Executar `resolveISOInstallType` passando uma ISO com `default.xex` com TitleID `0x555308C2` (Assassin's Creed IV) e número de disco 2, solicitando `"god"`. Antes da correção, retornava o erro `este disco nao e compativel com GOD; selecione instalacao XEX`.

## Resolução (v2.12.99)

1. Em `services/pipeline/disc_layout.go`, quando `rec.InstallType == "xex"`, validamos se o executável do disco é íntegro (`execErr == nil`) e atribuímos `resolved = "xex"` sem rejeitar a requisição.
2. Se `requested != resolved` (ex: solicitado `"god"` e resolvido para `"xex"`), a alteração é registrada nos logs do backend e o pipeline procede normalmente para a extração XEX.

## Testes Automatizados

- Adicionado `TestResolveISOInstallTypePromotesNoGodDiscToXex` em `src/server/services/pipeline/disc_layout_test.go`, construindo uma imagem sintética com cabeçalho XDVDFS e executável XEX2 do Assassin's Creed IV Disc 2 e confirmando que a chamada com `requested = "god"` resolve com sucesso para `"xex"`.

## Critérios para fechar

- [x] Reprodução confirmada e compreendida
- [x] Causa raiz isolada e corrigida
- [x] Teste unitário automatizado cobrindo o caso limite
- [x] Validação de todas as suítes de teste existentes
