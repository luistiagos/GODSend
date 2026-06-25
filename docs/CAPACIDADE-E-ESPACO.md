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

