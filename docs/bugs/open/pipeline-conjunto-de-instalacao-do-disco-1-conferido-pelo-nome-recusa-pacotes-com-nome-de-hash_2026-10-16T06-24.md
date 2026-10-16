# Bug: conjunto de instalação do Disco 1 é conferido pelo nome do arquivo e recusa os mesmos pacotes com nome de hash

- **Detectado em:** 2026-10-16 (T4 de [pipeline-gta5-multidisco-termina-pronto-e-nao-inicia-no-console-reincidencia_2026-10-15T15-40](pipeline-gta5-multidisco-termina-pronto-e-nao-inicia-no-console-reincidencia_2026-10-15T15-40.md))
- **Origem:** `xbox-360-companion/pipeline`: `models/compat.go::mandatoryInstallDiscs`,
  `infrastructure/helpers/multi_disc.go::InstallSetProblem` / `::LocalPackageProbe`,
  `services/pipeline/companion_content.go::mandatoryPayloadProblem` / `::requireInstallContent` / `::destinationInstallContentProblem`
- **Errors (serviço):** nenhum consultado
- **Classe:** fail (release válida recusada)
- **Severidade:** P2 - Médio. O job falha com mensagem errada ("não veio no arquivo baixado") depois de um download de ~16 GB.
  Não entrega jogo quebrado.
- **Complexidade:** média
- **Versões:** 2.12.110 e 2.12.111 (código lido em `2d58c66`)

## Sintoma

As entradas `GTA V MOD DARK V25 ( XBOX 360 RGH _ XPLOIT ).zip` (16,61 GiB) e `GTA 5 PT-BR + DLC + TU + SAVE 100 % .GOD`
(21,96 GiB) do catálogo HuggingFace (`luisluis123/xboxrghgames`) trazem os quatro pacotes do Disco 1 de GTA V. Num destino que
ainda não tem esses pacotes, a pipeline recusa a release com
`release incompleta: ... exige o conteudo de instalacao do Disco 1 em Content/0000000000000000/545408A7/00000002, que nao veio no arquivo baixado nem esta no destino (faltam 545408A700000000, ...)`.
Isso é previsto pelo código; não foi reproduzido de ponta a ponta.

A PT-BR saiu do app em `2d58c66`, porque o `default.xex` da raiz dela é do Sleeping Dogs. A DARK continua listada.

## Evidência

Medido em T4 por HTTP Range, lendo o diretório central do zip e os primeiros 4 KiB de cada membro (scripts `t4/zipls.py` e
`t4/hdr.py` no scratchpad daquela sessão, descritos na seção T4 do bug de origem):

| membro em `Content/0000000000000000/545408A7/00000002/` (DARK e PT-BR, idênticos) | magia | TitleID | tipo | nome STFS | bytes |
|---|---|---|---|---|---|
| `2EFC46BF02E0B126A64A81D0C915514661A2D5CD54` | PIRS | 545408A7 | 0x2 | `gtav - part0` | 2.146.643.968 |
| `03C98730D46C8F9CE6A79F6BA75802AC3C6DA21E54` | PIRS | 545408A7 | 0x2 | `gtav - part1` | 2.147.262.464 |
| `96CC1A6939BCD6EF4F0522A1E039EEBC294E354454` | PIRS | 545408A7 | 0x2 | `gtav - part2` | 2.146.807.808 |
| `85C21A6E9328BAB01B957E8FBD1C6A3B64E83FBA54` | PIRS | 545408A7 | 0x2 | `gtav - part3` | 1.817.518.080 |

Os tamanhos são idênticos, byte a byte, aos de `545408A70000000[0-3]` gravados pelo Disco 1 Redump em T1 e aos da release
Definitive, que usa os nomes `545408A70000000[0-3]`. Ao lado, na mesma pasta, ficam 12 DLC `LIVE` com nomes de hash do mesmo
formato.

## Causa raiz

**Comprovado pelo código:**

1. `models/compat.go::mandatoryInstallDiscs` (L443-447) descreve o conjunto por nome de arquivo:
   `"545408A700000000"` ... `"545408A700000003"`.
2. `helpers/multi_disc.go::InstallSetProblem` (L222-239) pergunta cada nome ao `probe`, e `::LocalPackageProbe` (L243-258) só
   acha arquivo com aquele nome (`strings.EqualFold(entry.Name(), name)`). Os pacotes com nome de hash dão `faltam ...`, mesmo
   que `InstallPackageProblem` (L187-214), que confere magia, TitleID, tipo e tamanho pelo cabeçalho, os aprovasse.
3. `pipeline/companion_content.go::installCompanionDiscContent` (L74-82): `mandatoryPayloadProblem` devolve esse problema e o
   payload inteiro é **ignorado**, inclusive as 12 DLC da mesma pasta. Depois, `requireInstallContent` (L192-225) não acha o
   conjunto em `delivered` e lê o destino. Se não estiver lá, `return fmt.Errorf("release incompleta: ...")`.

O comentário de `InstallPackageProblem` diz "Identity comes from the header, never from the file name". O conjunto, porém, é
endereçado por nome.

**Não provado:**

- **Se o console aceita os pacotes com nome de hash.** O que o instalador do disco grava é `545408A70000000x` (ZTM, Redump em
  T1, Definitive). Se o jogo abre o conteúdo por enumeração (`XContentCreateEnumerator`), o nome não importa. Se o jogo abre
  por nome, gravar com o nome de hash entrega um jogo que trava. Isso decide entre a correção A e a B abaixo e precisa ser
  medido antes de qualquer código.
- O que `destinationInstallContentProblem` faz com um destino que já tem os pacotes com nome de hash. Ele usa o mesmo probe
  por nome (abrir antes de corrigir).

## Hipóteses descartadas

- **Pacote truncado ou de outro jogo:** descartada. Cabeçalho `PIRS`, TitleID `545408A7`, tipo `0x2`, nome `gtav - partN` e
  tamanho idêntico ao do disco retail.

## Correção planejada

| # | o quê | onde | prova |
|---|---|---|---|
| T1 | Medir no console: com o GOD 2/2 instalado, o jogo abre com os 4 PIRS sob nomes de hash? | console do dono | boot passa da tela de carregamento, ou não |
| T2a | (se T1 abrir) identificar o conjunto pelo cabeçalho: um pacote do conjunto é qualquer arquivo da pasta com TitleID/tipo certos e nome STFS `gtav - partN`, N = 0..3 | `models/compat.go` (descrever as partes), `helpers/multi_disc.go::InstallSetProblem`/`LocalPackageProbe`, probe FTP do destino | teste com a pasta da DARK sintética (cabeçalhos reais, nomes de hash): o conjunto passa; contra o código atual dá `faltam` |
| T2b | (se T1 não abrir) gravar cada parte com o nome canônico `545408A70000000N`, escolhido pelo nome STFS | `installCompanionDiscContent` / `InstallContentLocal` / FTP `TransferContent` | teste: destino recebe `545408A70000000[0-3]` a partir dos nomes de hash |
| T3 | Não descartar as DLC da pasta quando o conjunto é recusado | `installCompanionDiscContent` | teste: payload com conjunto incompleto + DLC → DLC gravadas, ou documentar por que não |

## Tasks
| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | medir no console os PIRS com nome de hash | -- | -- | -- | -- |
| T2 | conjunto pelo cabeçalho (a) ou nome canônico na gravação (b) | -- | -- | -- | -- |
| T3 | DLC da pasta do conjunto recusado | -- | -- | -- | -- |

## Critérios para fechar
- [ ] T1 medido no console
- [ ] DARK V25 instala num destino vazio e dá boot (ou sai do catálogo, se T1 mostrar que não há como)
- [ ] Teste automatizado com os nomes de hash reais
