# Bug: `docs/READY-TO-PLAY-AURORA.md` afirma que há teste de "sintaxe Lua 5.1 do arquivo gerado", e esse teste não existe

- **Detectado em:** 2026-10-31 12:27, ao implementar a T1 do bug [[badavatar-primeiro-boot-da-aurora-fica-mais-de-2-horas-varrendo-title-updates-do-hd-interno_2026-10-30T21-43]]
- **Origem:** leitura do doc e dos testes; nenhum relato de cliente
- **Classe:** documentação que afirma uma garantia inexistente (cobertura de teste)
- **Severidade:** **P3 — provisório**: um erro de sintaxe 5.1 no hook deixaria as pastas de jogos sem cadastro em todo
  pendrive preparado (risco "grave" da tabela de risco do bug do #301), e o doc leva a crer que isso é pego antes de publicar
- **Complexidade:** desconhecida
- **Reincidência:** primeira vez registrada

## Sintoma

Quem lê a seção "Validação automatizada" do `docs/READY-TO-PLAY-AURORA.md` entende que o hook
`XboxCompanionReady.lua` gerado tem a sintaxe conferida contra Lua 5.1 (a versão da Aurora). Nenhum teste faz isso.

## Evidência

- `docs/READY-TO-PLAY-AURORA.md`, linha 194 (na 2.12.121): `- sintaxe Lua 5.1 do arquivo gerado;`. A linha está no doc
  desde o commit `978e128` (2026-08-18).
- `src/electron-app/tests/unit/`: a busca por `5.1`, `luac`, `luaparse` e `fengari` só acha
  `fat32FormatGuard.test.cjs` (PowerShell 5.1, outro assunto) e `readyToPlayConfiguration.test.cjs`.
- `readyToPlayConfiguration.test.cjs`, desde a 2.12.121, **executa** o hook com `fengari` 0.1.4, que é Lua **5.3**
  (`_VERSION` devolve `Lua 5.3`, conferido em 2026-10-31). Código só válido na 5.3 (`//`, operadores de bit, `goto`,
  `utf8.*`) passaria nesse teste e quebraria na Aurora.
- `git log --all -S"luaparse"` só acha o commit da 2.12.121 (onde o nome aparece em doc); não há `luac` em script nem em
  teste do repositório.

## Critérios para fechar

- [ ] (a definir na passada 2)
