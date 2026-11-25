# Bug: pipeline — jogo que não foi encontrado em nenhuma fonte mostra "Verifique se sua internet está funcionando, pause VPN ou antivírus", e cliente e suporte vão atrás da causa errada

- **Detectado em:** 2026-11-24 21:07 (análise do fix da 2.12.132; caso do chamado #437)
- **Origem:** `xbox-360-companion/pipeline` — `src/server/services/pipeline/fallback.go::ProcessGameWithFallback` (`recordError`, `isCatalogMissError`) e `src/server/app/user_error.go::FormatErrorForUser`
- **Errors (serviço):** 14764, 14765 (mensagem mostrada ao cliente do #437)
- **Classe:** ux
- **Severidade:** **P3 — Baixo** pela matriz (mensagem confusa na UI). Custo real observado: no #437 o agente de suporte mandou o cliente conferir internet, VPN e antivírus três vezes (`[197283]`, `[197318]`, `[197324]`), e nada disso era a causa
- **Complexidade:** **baixa** para o item 1 (uma condição a mais em `user_error.go`, mensagem que já existe). **Média** se fizer o item 2 (combinar as mensagens por fonte em `fallback.go`)
- **Versões:** 2.12.131 e 2.12.132
- **Reincidência:** primeira vez registrada. Origem: [pipeline-original-xbox-colecoes-ia-…](../retest/pipeline-original-xbox-colecoes-ia-c-d-m-n-o-s-t-divididas-em-part1-part2-e-o-app-ainda-busca-o-nome-antigo_2026-11-24T21-30.md)

## Sintoma

Fila do app, *Crash Nitro Kart (USA)*, Original Xbox:

> Erro — Não foi possível baixar o jogo pela internet agora. Verifique se sua internet está funcionando, pause VPN ou antivírus se estiver usando, e clique em tentar novamente.

Erros por fonte no mesmo download (logs do erro 14764):
- `huggingface: plataforma xbox nao suportada no HuggingFace`
- `ia: IA search failed: not found in Internet Archive: Crash Nitro Kart (USA)`
- `minerva: Minerva torrent failed: Minerva sem fontes ativas (peers: 52, seeders: 0) por 45s`

Nenhuma das três é problema de rede do cliente, e logo depois outro jogo baixou normalmente no mesmo PC (`[197347]`).

## Causa raiz

1. `fallback.go::recordError` guarda em `reportedErr` o **primeiro** erro que não é "ausência de catálogo". `isCatalogMissError` só reconhece `jogo nao encontrado no catalogo` e `nao suportada no HuggingFace`. `not found in Internet Archive` não está na lista, então o erro do IA vira o `reportedErr`.
2. A mensagem da fila vem de `app.FormatErrorForUser(reportedErr.Error())`. Em `user_error.go`, bloco "5. Network / Download / IA auth", `strings.Contains(lower, "ia search failed")` leva à mensagem de internet/VPN/antivírus. O texto `not found in internet archive` não é testado antes, ao contrário de `not found in minerva` e `not found in hugging face`, que levam a *"Este jogo não está disponível para download neste catálogo no momento"*.
3. O erro do Minerva (`sem fontes ativas`), que tem mensagem própria e mais útil, nunca chega à tela: o primeiro erro reportável vence.

## Como reproduzir

- Unitário: `app.FormatErrorForUser("IA search failed: not found in Internet Archive: X")` devolve a mensagem de internet/VPN/antivírus.
- Ponta a ponta: pedir um título Original Xbox que não existe no IA nem tem seeders no Minerva. A fila mostra a mensagem de internet.

## Resolução proposta

1. **`user_error.go`:** tratar `not found in internet archive` como título indisponível no catálogo (junto de `not found in minerva`), **antes** do bloco de rede.
2. **Mensagem para quando todas as fontes falharam:** quando nenhum erro é de rede/disco (só "não encontrado" e "sem seeders"), dizer isso ao usuário, por exemplo: *"Este jogo não foi encontrado nas fontes de download agora (nenhuma tem o arquivo disponível). Escolha outra versão na lista ou tente mais tarde."* Avaliar a combinação das mensagens por fonte em vez de só a do primeiro erro reportável.
3. **Não tirar o erro da telemetria:** `not found in Internet Archive` **não** deve entrar em `isCatalogMissError`. Foi esse reporte que revelou a coleção sumida no bug de origem. A mudança é só na mensagem ao usuário (`userMsg`), não em `reportable`/`reportedErr`.

## Testes Automatizados

- `user_error_test.go`: `IA search failed: not found in Internet Archive: X` → mensagem de catálogo indisponível, sem "internet", "VPN" nem "antivírus".
- `user_error_test.go`: `IA search failed: dial tcp ... i/o timeout` continua dando a mensagem de internet.
- `fallback_test.go`: HF não suportado + IA "not found" + Minerva sem seeders → `userMsg` sem a mensagem de rede, e a telemetria continua reportando o erro do IA.

## Critérios para fechar

- [ ] "Não encontrado em nenhuma fonte" mostra mensagem de disponibilidade, não de rede
- [ ] Falha real de rede continua mostrando a mensagem de internet/VPN
- [ ] Telemetria continua recebendo o erro `not found in Internet Archive`
- [ ] Testes unitários acima verdes
