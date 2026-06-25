# Plano e diário de escrita transacional

## Estado atual

O planejador, o diário e um executor restrito a simulações estão implementados e testados. O executor que copiará arquivos para um dispositivo real continua desabilitado.

## Plano imutável

Antes de qualquer operação, o planejador recebe arquivos que já estão no staging confiável. Para cada arquivo ele:

1. confirma que a raiz do staging é um diretório real;
2. recusa links simbólicos em qualquer segmento;
3. confirma que a origem não escapou da raiz após resolver o caminho real;
4. compara tamanho e SHA-256 com o valor esperado;
5. recusa arquivos maiores que o limite individual do FAT32;
6. normaliza e valida o destino;
7. recusa colisões sem diferenciar maiúsculas e minúsculas;
8. ordena as entradas;
9. calcula o hash canônico de todo o plano;
10. congela o objeto em memória.

Destinos permitidos no modo simples:

```text
Aurora/...
BadUpdatePayload/...
Content/...
launch.ini
.xbox-downloader/...
```

São recusados caminhos absolutos, letras de unidade, barras invertidas, `.` ou `..`, caracteres de controle, nomes reservados como `CON`, `NUL`, `COM1` e qualquer raiz diferente das cinco acima.

## Diário

O diário não é uma autorização criptográfica; sua assinatura de hash detecta corrupção e alterações acidentais. A autorização dos conteúdos continua vindo do manifesto Ed25519.

Estados da transação:

```text
planned → staging → committing → completed
    │          │           │
    └──────────┴───────────┴→ failed
```

Estados de cada arquivo:

```text
pending → staged → backup-created → committed
    └──────────────────────────────→ committed  (arquivo já idêntico)
```

Regressões são recusadas. A transação somente pode chegar a `completed` quando todas as entradas estão `committed`.

## Persistência recuperável

Cada atualização é gravada primeiro em `*.next.json`, sincronizada e só então promovida. A versão atual anterior é mantida como `*.previous.json`. Na inicialização, a leitura tenta o diário atual e usa a cópia anterior se o atual estiver corrompido ou incompleto.

## Próxima etapa

O executor deverá revalidar a impressão digital física antes de cada conjunto de operações. Arquivos novos serão copiados para uma área temporária no próprio dispositivo, verificados por releitura, e somente depois promovidos. Arquivos antigos diferentes precisarão de backup antes da troca. Interrupções em qualquer ponto deverão ser resolvidas pelo diário, sem presumir sucesso.

## Executor de simulação

O executor atual somente aceita diretórios que contenham um marcador exclusivo de teste. Ele não está ligado a IPC, interface, formatação ou enumeração USB.

Nos testes ele já executa:

- cópia para staging interno e verificação por releitura;
- reutilização de arquivo que já possui tamanho e hash corretos;
- preservação do arquivo anterior em backup;
- promoção do arquivo novo somente depois da verificação;
- remoção do backup somente após a transação completa;
- revalidação obrigatória antes das mutações;
- retomada após interrupção entre promoção e atualização do diário;
- retomada após interrupção com o arquivo antigo preservado no backup;
- recusa de qualquer diretório sem marcador explícito de simulação.

Uma falha transitória mantém o último diário monotônico retomável. Ela não marca automaticamente a transação como terminal enquanto um backup puder estar preservando o arquivo anterior.
