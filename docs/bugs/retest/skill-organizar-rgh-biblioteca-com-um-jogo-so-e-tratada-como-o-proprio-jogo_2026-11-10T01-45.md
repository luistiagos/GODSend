# Bug: a skill `organizar-jogos-xbox360-rgh` trata a biblioteca com UM jogo só como se fosse o próprio jogo

- **Detectado em:** 2026-11-10 01:45, ao migrar a skill do perfil do Antigravity para
  `.claude/skills/organizar-jogos-xbox360-rgh/` deste repo (T7 do backlog
  `ambiente-por-clone-maquina-nova-pronta_2026-11-08` do retrobatnew, secao 21.6)
- **Origem:** teste em `--dry-run` numa biblioteca de teste
- **Classe:** ferramenta de agente (não é código do app Xbox Companion); risco de bagunçar arquivos do dono
- **Severidade:** P3 — Baixo: só com exatamente uma pasta de jogo na biblioteca, e o `--dry-run` mostra antes
- **Complexidade:** baixa
- **Estado:** corrigido e testado em 2026-11-10, em `retest/`.

## Sintoma

`organizar_rgh.py --target <biblioteca>` com a biblioteca contendo **uma** pasta de jogo
(`<biblioteca>\Jogo Teste\Sub 1\Sub 2\default.xex`) processava a **biblioteca** como o jogo:

```
[*] Total de pastas de jogos a processar: 1
[1/1] biblioteca-teste
  [XEX DETECTADO] default.xex em subpasta: 'Jogo Teste\Sub 1\Sub 2'
  -> Desaninhando jogo XEX diretamente para a raiz da pasta principal...
```

Sem `--dry-run`, o `default.xex` e os arquivos do jogo iriam para a raiz da biblioteca, e não para
`<biblioteca>\Jogo Teste\`. Com duas pastas de jogo, cada uma é tratada certo (`[1/2] Jogo Dois`, `[2/2] Jogo Teste`).
O comportamento era o mesmo no script original (cópia de 2026-10-06 do perfil do Antigravity), então não veio da migração.

## Causa (lida no código)

`scripts/organizar_rgh.py::is_single_game_folder`: sem `default.xex`/`Content`/arquivo de jogo na raiz, devolvia
`False` (biblioteca) só se houvesse **2 ou mais** subpastas (`len(subdirs) >= 2`); com uma subpasta, devolvia `True` e a
biblioteca virava o jogo.

## Correção

1. **Parâmetros explícitos de modo (`--jogo` / `--biblioteca`):**
   Adicionado grupo mutuamente exclusivo em `argparse`:
   - `--jogo` / `-j`: força o tratamento do alvo como pasta de um único jogo;
   - `--biblioteca` / `-b`: força o tratamento do alvo como biblioteca (cada subpasta é um jogo).
2. **Detecção com bloqueio preventivo de ambiguidade:**
   - `is_single_game_folder(folder, mode=None)`:
     - Com `mode="jogo"`: devolve `True`.
     - Com `mode="biblioteca"`: devolve `False`.
     - Com `mode=None`:
       - Se houver `default.xex`, pasta `Content` ou extensões de dados (`.rpf`, `.img`, `.xex`, etc.) na raiz: devolve `True`;
       - Se houver 2 ou mais subpastas e nenhum arquivo de jogo na raiz: devolve `False` (comportamento automático preservado);
       - Se houver **exatamente 1 subpasta** e nenhum arquivo de jogo na raiz: levanta `AmbiguousTargetError` em vez de adivinhar incorretamente.
3. **Fluxo seguro em `run_organizer` e `main`:**
   - Em caso de `AmbiguousTargetError`, o script emite aviso claro solicitando `--biblioteca` ou `--jogo` e encerra com código 1 sem alterar nenhum arquivo em disco.
4. **Documentação atualizada em `SKILL.md`:**
   - Seções 2.1, 2.2 e tabela de parâmetros atualizadas instruindo o uso de `--biblioteca` e `--jogo`.

## Validação

Suíte completa de testes criada em `.claude/skills/organizar-jogos-xbox360-rgh/tests/test_organizar_rgh.py`:

- **Ambíguo sem flags (controle negativo do bug):** biblioteca com 1 jogo (`<bib>\Jogo Teste\Sub 1\Sub 2\default.xex`) executada sem flags sai com código 1, mensagem de erro orientando `--biblioteca`, e nenhum arquivo é movido (`<bib>\default.xex` não existe, arquivo permanece em sua subpasta original).
- **Biblioteca de 1 jogo com `--biblioteca`:** executa com sucesso (código 0), processa `[1/1] Jogo Teste`, move o executável para `<bib>\Jogo Teste\default.xex` e preserva `<bib>` como raiz intacta da biblioteca.
- **Biblioteca padrão com 2 jogos sem flag:** preserva o comportamento automático anterior sem exigir flags, processando `[1/2]` e `[2/2]` com código 0.
- **Jogo aninhado com `--jogo`:** executa com sucesso (código 0), processando `[1/1] Jogo` e desaninhando para a raiz do próprio jogo.
- **Flags conflitantes:** `--jogo` e `--biblioteca` simultâneos são rejeitados pelo parser.
- **Testes unitários de `is_single_game_folder`:** cobre arquivos na raiz, subpastas, modos forçados e pasta vazia.

Execução:
```powershell
python .claude\skills\organizar-jogos-xbox360-rgh\tests\test_organizar_rgh.py
# ..............
# Ran 14 tests in 3.552s - OK
```

## Lição

Quando a topologia de diretórios for estruturalmente indistinguível (`<bib>\<jogo>\<sub-pasta>` vs `<jogo>\<sub-1>\<sub-2>`), uma ferramenta automatizada nunca deve adivinhar por padrão quando o erro puder desestruturar uma biblioteca inteira: na dúvida, recusar a operação e exigir a intenção explícita do operador via parâmetro.
