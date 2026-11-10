# Bug: a skill `organizar-jogos-xbox360-rgh` trata a biblioteca com UM jogo só como se fosse o próprio jogo

- **Detectado em:** 2026-11-10 01:45, ao migrar a skill do perfil do Antigravity para
  `.claude/skills/organizar-jogos-xbox360-rgh/` deste repo (T7 do backlog
  `ambiente-por-clone-maquina-nova-pronta_2026-11-08` do retrobatnew, secao 21.6)
- **Origem:** teste em `--dry-run` numa biblioteca de teste
- **Classe:** ferramenta de agente (não é código do app Xbox Companion); risco de bagunçar arquivos do dono
- **Severidade:** P3 — Baixo: só com exatamente uma pasta de jogo na biblioteca, e o `--dry-run` mostra antes
- **Complexidade:** baixa

## Sintoma

`organizar_rgh.py --target <biblioteca>` com a biblioteca contendo **uma** pasta de jogo
(`<biblioteca>\Jogo Teste\Sub 1\Sub 2\default.xex`) processa a **biblioteca** como o jogo:

```
[*] Total de pastas de jogos a processar: 1
[1/1] biblioteca-teste
  [XEX DETECTADO] default.xex em subpasta: 'Jogo Teste\Sub 1\Sub 2'
  -> Desaninhando jogo XEX diretamente para a raiz da pasta principal...
```

Sem `--dry-run`, o `default.xex` e os arquivos do jogo iriam para a raiz da biblioteca, e não para
`<biblioteca>\Jogo Teste\`. Com duas pastas de jogo, cada uma é tratada certo (`[1/2] Jogo Dois`, `[2/2] Jogo Teste`).
O comportamento é o mesmo no script original (cópia de 2026-10-06 do perfil do Antigravity), então não veio da migração.

## Causa (lida no código)

`scripts/organizar_rgh.py::is_single_game_folder`: sem `default.xex`/`Content`/arquivo de jogo na raiz, devolve
`False` (biblioteca) só se houver **2 ou mais** subpastas (`len(subdirs) >= 2`); com uma subpasta, devolve `True` e a
biblioteca vira o jogo.

## O que fazer

Pela estrutura o caso é ambíguo: `<biblioteca>\Jogo\Sub\default.xex` (biblioteca de 1 jogo) e `Jogo\Sub 1\Sub 2\default.xex`
(um jogo aninhado) têm a mesma forma. Então o modo tem de vir de quem chama: um parâmetro explícito (`--jogo` /
`--biblioteca`) e, sem ele, com uma única subpasta e sem `default.xex`/`Content` na raiz, o script para sem mexer em
nada e diz para escolher. Prova: biblioteca de 1 jogo com `--biblioteca` lista `[1/1] Jogo Teste`; sem o parâmetro, sai
com erro e nenhum arquivo muda; a de 2 jogos continua igual.
