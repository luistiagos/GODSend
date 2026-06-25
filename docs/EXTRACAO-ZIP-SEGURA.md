# Extração ZIP segura

## Princípio

Um arquivo ZIP nunca é extraído diretamente para o dispositivo. Primeiro seu próprio tamanho e SHA-256 precisam corresponder ao manifesto Ed25519. Depois, todas as entradas do diretório central são inspecionadas antes da criação do primeiro arquivo.

## Recusas implementadas

- ZIP vazio ou acima do limite de entradas assinado;
- arquivo criptografado;
- método de compressão diferente de Store ou Deflate;
- tamanho inválido ou acima do limite assinado;
- soma de expansão acima do limite;
- taxa de compressão anormalmente alta;
- caminho absoluto, letra de unidade ou barra invertida;
- `.` e `..`;
- caracteres proibidos ou de controle;
- nomes reservados do Windows;
- Unicode fora da normalização NFC;
- links simbólicos e outros tipos especiais;
- entradas duplicadas sem diferenciar maiúsculas;
- colisão entre arquivo e diretório;
- raiz de staging ou arquivo ZIP baseado em link simbólico;
- tentativa de sobrescrever uma extração anterior.

## Processo

1. verificar o ZIP contra tamanho e SHA-256 assinados;
2. abrir em modo lazy, sem extração automática;
3. validar todas as entradas e limites;
4. criar uma pasta parcial aleatória;
5. extrair cada arquivo com criação exclusiva;
6. contar novamente os bytes durante a descompressão;
7. calcular SHA-256 de cada arquivo extraído;
8. sincronizar o arquivo no sistema operacional;
9. promover a pasta parcial por renomeação;
10. remover a pasta parcial se qualquer etapa falhar.

O extrator utiliza `yauzl` 3.4.0 fixado como dependência direta. `yazl` é usado somente nos testes para produzir fixtures ZIP controladas.

