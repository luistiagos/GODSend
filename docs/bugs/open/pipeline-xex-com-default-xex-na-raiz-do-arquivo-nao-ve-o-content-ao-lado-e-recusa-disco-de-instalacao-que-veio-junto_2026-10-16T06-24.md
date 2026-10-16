# Bug: rip XEX com `default.xex` na raiz do arquivo esconde o `Content/` ao lado e recusa o disco de instalação que veio junto

- **Detectado em:** 2026-10-16 (T4 de [pipeline-gta5-multidisco-termina-pronto-e-nao-inicia-no-console-reincidencia_2026-10-15T15-40](pipeline-gta5-multidisco-termina-pronto-e-nao-inicia-no-console-reincidencia_2026-10-15T15-40.md))
- **Origem:** `xbox-360-companion/pipeline`: `infrastructure/helpers/multi_disc.go::FindCompanionContentPayloads`, chamado com
  `excludeDir == extDir` por `services/pipeline/huggingface.go` (L68-73), `minerva.go` (L73-90, L217-222), `digital.go` (L194-221)
  e `pipeline.go` (L223-241)
- **Errors (serviço):** nenhum consultado
- **Classe:** fail (release válida recusada; e conteúdo copiado para dentro da pasta do jogo)
- **Severidade:** P2 - Médio. Para GTA V o job falha com mensagem errada depois de ~16 GB. Para um título fora de
  `mandatoryInstallDiscs`, o `Content/` vai parar dentro de `Games/<jogo>/`, onde o console não lê, sem erro nenhum.
- **Complexidade:** média
- **Versões:** 2.12.110 e 2.12.111 (código lido em `2d58c66`)

## Sintoma

A entrada `Grand Theft Auto V + MOD Definitive Edition 1.5.1 ( COPIA E COLA ).zip` (16,34 GiB, HuggingFace
`luisluis123/xboxrghgames`) traz o jogo inteiro: GTA V jogável em XEX na raiz e o Disco 1 em
`Content/0000000000000000/545408A7/00000002/`, com os nomes certos. Num destino sem os pacotes, a pipeline recusa com
`release incompleta: ... que nao veio no arquivo baixado nem esta no destino`. Isso é previsto pelo código; não foi reproduzido
de ponta a ponta.

## Evidência

Medido em T4 por HTTP Range (diretório central + primeiros 4 KiB de cada membro, scripts descritos na seção T4 do bug de
origem):

- raiz: `default.xex` XEX2 TitleID `0x545408A7`, MediaID `0x79E465C5`, disco **2/2**; `xbox360a.rpf`, `xbox360b.rpf`, `sfx/`,
  `common.rpf`, `nxeart`;
- `Content/0000000000000000/545408A7/00000002/545408A70000000[0-3]`: `PIRS`, TitleID `545408A7`, tipo `0x2`, `gtav - part0..3`,
  com tamanhos idênticos aos do Disco 1 Redump medido em T1; mais 12 DLC `LIVE`, `00009000/` (27 itens) e
  `000B0000/tu00000009_00000000` ("Definitive Edition 1.5.1 PT-BR");
- `Content/0000000000000000/545408A7/00000001/SGTA50001` (save).

## Causa raiz

**Comprovado pelo código:**

1. `helpers.FindXEXFolder(extDir)` (`helpers.go` L247-267) acha um único `default.xex`, o da raiz, e devolve `extDir`.
   `ripFolderName` (`companion_content.go` L45-50) já trata esse caso para o **nome** da pasta.
2. `installCompanionDiscContent(gameName, extDir, gameFolder=extDir)` → `FindCompanionContentPayloads(extDir, excludeDir=extDir)`
   (`multi_disc.go` L58-87). O primeiro diretório do walk é a própria raiz. `isWithinDir(raiz, excludeDir)` é verdadeiro e
   `utils.CompanionDiscFolders` (`companion_disc.go` L50-72) não acha outro `default.xex` com o mesmo TitleID, então volta
   `filepath.SkipDir` na raiz. Nenhum payload é encontrado.
3. `playableTitleID(extDir)` = `0x545408A7`, que está em `mandatoryInstallDiscs` → `requireInstallContent` (L192-225) com
   `delivered` vazio → lê o destino → `release incompleta`.
4. Para um título fora de `mandatoryInstallDiscs`, o passo 3 não age e `InstallXEXLocal(extDir, ...)` / `TransferXEX` copia a raiz
   inteira, `Content/` incluído, para `Games/<pasta>/Content/...`. O console não lê conteúdo ali, então DLC e TU do rip ficam sem
   efeito e sem aviso. Isso foi lido no código, não medido num rip real.

`excludeDir` serve para não tratar o próprio jogo como payload. Quando o jogo É a raiz, ele exclui o arquivo inteiro.

**Não provado:**

- Quantas entradas do catálogo têm `default.xex` na raiz e `Content/` ao lado. Só a Definitive foi vista (a PT-BR também tem
  esse formato, mas com Sleeping Dogs na raiz, e saiu do app em `2d58c66`).

## Hipóteses descartadas

- **Conjunto incompleto ou mal nomeado na Definitive:** descartada. São os 4 PIRS com os nomes canônicos e tamanhos idênticos
  aos do retail.

## Correção planejada

| # | o quê | onde | prova |
|---|---|---|---|
| T1 | Quando `excludeDir == dir`, excluir do walk só os arquivos do jogo, não a árvore inteira: procurar `Content/0000000000000000` também dentro da raiz | `helpers/multi_disc.go::FindCompanionContentPayloads` | teste: extDir com `default.xex` (GTA V disco 2/2) + `Content/.../545408A7/00000002/545408A70000000[0-3]` → 1 payload `545408A7/00000002`; contra o código atual, 0 |
| T2 | Não copiar `Content/` da raiz para dentro da pasta do jogo XEX depois de gravá-lo como payload | `InstallXEXLocal` / `TransferXEX` (abrir o filtro de cópia antes de desenhar) | teste: destino XEX não tem `Content/`, e `Content/0000000000000000/<TitleID>/...` está na raiz do destino |
| T3 | Conferir o mesmo formato no caminho Minerva/IA/digital (os quatro chamadores) | `minerva.go`, `digital.go`, `pipeline.go` | os mesmos testes passam pelos quatro, ou um teste no helper cobre todos |

## Tasks
| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | payloads dentro da raiz quando o jogo é a raiz | -- | -- | -- | -- |
| T2 | não duplicar `Content/` na pasta do jogo | -- | -- | -- | -- |
| T3 | cobrir os quatro chamadores | -- | -- | -- | -- |

## Critérios para fechar
- [ ] Definitive 1.5.1 instala num destino vazio, com os 4 PIRS em `Content/0000000000000000/545408A7/00000002/`
- [ ] Teste automatizado do formato "XEX na raiz + `Content/` ao lado"
- [ ] Boot no console
