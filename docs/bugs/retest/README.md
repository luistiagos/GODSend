# bugs/retest

Bugs com correcao **ja commitada e testada** (na lane do pipeline ou a mao), mas ainda sem versao publicada
para o cliente e/ou sem a prova do cliente. Ciclo completo em [../open/README.md](../open/README.md):
`open/` -> `retest/` -> `closed/`.

## Por que separar de closed

O teste daqui roda o app em modo dev, sem disco real liberado e sem console. O que so o cliente prova (o
portatil publicado, o pendrive/HD dele, o jogo aparecendo e dando boot no Xbox) ainda nao foi visto. Se o
cliente ou a proxima versao mostrar o sintoma de novo, o arquivo volta para [../open/](../open/) com nota da
reincidencia.

## Status

Ao mover de open para retest, acrescente uma secao `## Status` no TOPO do arquivo, com:

- data e hora da correcao;
- hash do(s) commit(s) do fix;
- onde no codigo o fix foi aplicado (`arquivo::simbolo`);
- evidencia de cada nivel de teste (T2 caminho do cliente, T3 `go test ./...` e `test:safety`, T4 logs),
  com o caminho da pasta de evidencia;
- **o que falta para `closed/`**: versao publicada (subida de versao + `build-and-upload.ps1`, do dono), o que
  depende de disco real ou do console, e a prova do cliente.
