# Capacidade e espaço livre

## Objetivo

O programa não deve descobrir falta de espaço no meio de uma substituição. A política de capacidade examina o plano e o destino antes da escrita e calcula o pico de alocação necessário.

## Informações coletadas no Windows

Para a partição USB selecionada são coletados:

- filesystem;
- capacidade física e da partição;
- bytes livres;
- tamanho da unidade de alocação;
- disco e partição físicos;
- identidade usada na revalidação.

Filesystem diferente de FAT32 ou tamanho de cluster desconhecido bloqueiam o fluxo final.

## Teto de 2 TiB por volume

**Um HD de 4 TB preparado por este programa fica com 2 TB. Isso é esperado, não é defeito
do HD nem falha da formatação.** Dois limites independentes caem no mesmo número:

| Limite | Origem | Teto |
|---|---|---|
| MBR | a entrada da tabela de partição guarda a contagem de setores em 32 bits: 2³² × 512 B | 2 TiB = 2.199.023.255.552 B |
| FAT32 | o campo `BPB_TotSec32` do setor de boot também é de 32 bits, com setor de 512 B | 2 TiB |

Um HD anunciado como "4 TB" tem 4.000.787.030.016 B ≈ 3,64 TiB. Depois do MBR sobram
2.199.023.255.552 B, e ficam inalcançáveis 1.801.763.774.464 B.

**Cuidado ao citar esses números para o cliente: eles têm duas leituras válidas.** O
fabricante conta em potências de 10; o Windows e a tela do programa contam em potências
de 2 e mesmo assim escrevem "TB". O mesmo disco, portanto:

| | Na caixa do produto (10³) | No Windows e na tela do app (2¹⁰, rotulado "TB") |
|---|---|---|
| Tamanho do disco | 4 TB | 3,6 TB |
| Acessível no Xbox 360 | 2,2 TB | 2,0 TB |
| Inacessível | 1,8 TB | 1,6 TB |

São os mesmos bytes nas duas colunas. Use a coluna da direita ao falar do que aparece na
tela — é a que o cliente está lendo — e a da esquerda só ao comparar com o anúncio da
loja.

**Não adianta criar uma segunda partição com o resto.** O MBR não consegue *endereçar*
nada além de 2 TiB: o espaço não fica "livre para outra partição", ele fica fora do que o
esquema sabe descrever.

O formatador é MBR em todos os caminhos de `diskpart` de
[`fat32Format.ts`](../src/electron-app/infrastructure/fat32Format.ts) (`clean` →
`convert mbr` → `create partition primary` sem tamanho, portanto o máximo que o esquema
permite). Isso é deliberado: o Xbox 360 lê FAT32 em MBR. Trocar para GPT devolveria a
capacidade no Windows e tornaria o disco ilegível no console — **não é uma otimização
pendente, é um requisito do alvo**.

Acima de 32 GB ([`fat32Format.ts:145`](../src/electron-app/infrastructure/fat32Format.ts#L145))
o caminho principal **não reparticiona**: roda o `fat32format.exe` na partição existente.
O `diskpart` só entra quando o volume não existe ou quando o `fat32format` falha — que é
justamente o que acontece com um HD de 4 TB que chega com partição GPT de 3,64 TiB, e é
por esse caminho que ele termina em 2 TiB.

Consequência prática para recomendação de compra: **2 TB é o teto útil por disco**.
Comprar 4 TB para Xbox 360 é pagar o dobro por metade aproveitável; para mais que isso,
use dois discos.

## Aviso na tela de seleção

Desde a v2.12.80, selecionar um disco com `sizeBytes` acima de 2 TiB mostra uma faixa
âmbar no card **Dispositivo conectado**
([`BadAvatarUsbPage.tsx`](../src/electron-app/renderer/components/BadAvatarUsbPage.tsx)),
com os números daquele disco: quanto ele tem, quanto fica inacessível, e que nem uma
segunda partição recupera o espaço.

**É aviso, não bloqueio.** O disco continua selecionável e preparável — 2 TB funcionam
normalmente, e o usuário pode ter feito essa escolha de propósito. É também por isso que
o teto **não** entrou em `assessDeviceSafety`: todos os códigos de lá são impeditivos
(`allowed: false`), e recusar um disco que funciona seria pior que a perda de capacidade.
O piso continua sendo a única regra de capacidade da política (`INVALID_CAPACITY`, abaixo
de 1 GB).

A checagem usa `sizeBytes`, que no caminho de enumeração física é o tamanho do **disco**
(`Get-Disk .Size`), não o da partição — é o que permite avisar mesmo quando o HD de 4 TB
já chega particionado em 2 TiB, caso em que o volume sozinho não denunciaria nada.

O aviso existe apenas na tela de preparação, onde a formatação é escolhida; a
`UsbGamesPage` mostra a mesma classe de dispositivo e não tem a faixa.

## Inventário

Cada destino do plano é classificado como:

- `missing`: ainda não existe;
- `identical`: tamanho e SHA-256 já conferem;
- `different`: existe, mas precisa ser substituído.

Diretórios, links ou outros tipos especiais onde deveria existir um arquivo são recusados. Arquivos idênticos são reutilizados e não exigem outra cópia.

## Pico de espaço

Para arquivos ausentes ou diferentes, o cálculo usa o tamanho efetivamente alocado em clusters FAT32, não apenas o tamanho lógico. O arquivo antigo diferente permanece ocupando seu espaço enquanto a nova cópia é criada no staging; movê-lo para backup no mesmo volume não consome uma segunda cópia.

O requisito inclui:

1. alocação de todos os arquivos novos no staging;
2. overhead conservador para plano, diário atual, diário anterior e metadados;
3. margem livre após a operação.

A margem é o maior valor entre:

- 128 MiB;
- 2% da capacidade total.

Se o espaço livre não comportar staging, metadados e margem, a operação é recusada antes da primeira escrita.

## Interrupções simuladas

Todos os pontos instrumentados do executor agora possuem teste de retomada:

- depois de criar o diário;
- depois de preparar um arquivo;
- depois de preservar o backup;
- depois de promover o arquivo novo;
- depois de confirmar a entrada;
- depois de marcar a transação como concluída.

