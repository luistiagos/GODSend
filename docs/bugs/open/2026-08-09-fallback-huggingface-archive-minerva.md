# Bug aberto: Fallback unificado ignora fontes anteriores e termina em erro Minerva

Data: 2026-08-09
Status: aberto
Area: browse unificado, pipeline de fallback, cache IA/HuggingFace/Minerva
Commits: pendente

## Sintoma

Na fila de tarefas, varios jogos do Xbox 360 falham com a mensagem:

```
Download falhou em todas as fontes. Ultimo erro: Minerva: jogo nao encontrado no catalogo
```

O problema e recorrente e aparece mesmo para titulos que existem nas listas locais de
HuggingFace, Internet Archive e/ou Minerva. O comportamento esperado para o fluxo unificado
e tentar os provedores nesta ordem:

```
HuggingFace -> Internet Archive -> Minerva
```

Minerva deve ser apenas o ultimo ponto da cadeia, salvo titulos que so existem nele.

## Contexto da conversa

O relato veio acompanhado de uma captura da fila com jogos como `007 Legends`,
`Aliens vs. Predator`, `Batman Arkham City GOTY`, `Carros 3`, `MotoGP 15`,
`NASCAR '15`, `Naruto Shippuden - Ultimate Ninja Storm 3`, `Spider-Man 3` e
`Split-Second - Velocity`. A UI mostra quase todos os itens terminando no erro final
do Minerva, dando a impressao de que os provedores anteriores nao foram usados ou nao
casaram o titulo corretamente.

O usuario confirmou que `romsrepository` deve ser ignorado por enquanto. A cadeia valida
neste repositorio e `huggingface -> ia/archive -> minerva`.

## Evidencia inicial

- A ordem padrao no endpoint unificado ja esta como `huggingface`, `ia`, `minerva`.
- O merge do browse usa somente `strings.ToLower(g)` como chave. Assim, variantes como
  `007 Legends` e `007 Legends (USA, Europe) (En,Fr,De)` nao sao tratadas como o mesmo
  titulo com fallbacks.
- O lookup fuzzy do HuggingFace compara na direcao errada:
  `strings.Contains(cacheTitle, requestedLongRegionalTitle)`. Quando o cache tem o titulo
  curto e a UI dispara o titulo regional longo, o match falha.
- O cache empacotado do Minerva esta em schema 2, enquanto o backend exige schema 3. Isso
  faz o cache ser rejeitado na inicializacao e deixa a busca dependente de rebuild
  assincrono.
- A mensagem final da fila preserva apenas o ultimo erro da cadeia, normalmente Minerva,
  escondendo o motivo real das falhas anteriores em HuggingFace ou Internet Archive.
- No teste real de `Batman Arkham City GOTY`, o HuggingFace foi encontrado corretamente e
  apontou para um RAR de 9.646 MB no Archive.org. A falha ocorreu ao pre-alocar o arquivo:
  `truncate C:\godsend-temp\proc\Batman Arkham City GOTY_hf.rar: There is not enough space on the disk`.
- O mesmo erro apareceu em `Aliens Colonial Marines`, `Amazing Spider-Man 2` e
  `Assassin's Creed II GOTY`, comprovando que a recorrencia era de armazenamento e
  concorrencia, nao uma indisponibilidade isolada do Batman.
- Inventario no momento da falha: `C:` 3,52 GB livres, `E:` 3,39 GB livres e `F:`
  57,5 GB livres. O destino `F:` e FAT32 e nao aceita um arquivo unico acima de 4 GB.
- Havia 14,47 GB de scratch abandonado em `E:\projects\Downloader-XBOX360-XEX-HDD-Games\Temp`,
  incluindo pre-alocacoes de 7,17 GB (`007 Legends`), 5,40 GB (`Aliens vs Predator`) e
  1,89 GB (`Avengers Battle For Earth`). Esses restos fizeram o seletor escolher `C:`.
- O endpoint `/trigger` iniciava toda tarefa em uma goroutine independente. Assim, varios
  jogos grandes disputavam e pre-alocavam o mesmo volume simultaneamente.

## Hipotese inicial de causa

O bug nao esta apenas na ordem de provedores. A ordem existe, mas os titulos nao sao
normalizados de forma compartilhada entre browse, HuggingFace, Internet Archive e Minerva.
Por isso o app mostra uma variante regional vinda de uma fonte, dispara essa string
literal no pipeline e falha em outra fonte que conhece o mesmo jogo por nome base.

Tambem ha um problema de boot no cache Minerva: caches validos para busca operacional sao
recusados por schema antigo antes de receberem a migracao leve de plataforma/aliases.

## Tratativas aplicadas

1. A normalizacao e comparacao de titulos foi centralizada em `services/cache/matching.go`.
2. A regra compartilhada passou a ser usada no merge unificado e nos lookups de
   HuggingFace, Internet Archive e Minerva.
3. Caches Minerva schema 2 aproveitaveis agora sao migrados localmente para schema 3.
4. O pipeline acumula erros por provedor para a fila nao mascarar a causa anterior com o erro final
   do Minerva.
5. O casamento preserva palavras de edicao como `GOTY`, evitando associar versoes
   diferentes do jogo por substring.
6. `GOTY`, `Game of the Year` e `Game of the Year Edition` agora compartilham uma chave
   canonica; o fallback Minerva do Batman escolhe o Disc 1 de forma deterministica.
7. O scratch recebe um marcador de PID. Na inicializacao seguinte, dados de um processo
   encerrado sao limpos antes da medicao de espaco, mas fontes de jobs FTP pendentes sao
   preservadas.
8. Downloads pesados de jogos foram serializados no backend. Os demais itens permanecem
   em estado `Queued` ate a tarefa atual liberar o armazenamento temporario.
9. Para instalacao local, arquivos XEX extraidos e a saida GOD ja dividida podem usar
   `.xbox-360-companion-temp` no dispositivo de destino. Arquivos compactados e ISOs
   inteiros continuam em NTFS/exFAT, respeitando o limite de 4 GB do FAT32.
10. O downloader HTTP verifica espaco antes da pre-alocacao e retorna diagnostico claro,
    em vez de expor somente o erro bruto de `truncate`.
11. Falhas na gravacao GOD local agora retornam erro ao pipeline; antes, `finalizeGOD`
    podia registrar erro na fila e ainda devolver sucesso ao fallback.
12. A remocao de uma tarefa agora cancela tambem downloads HTTP e aria2 que ja estejam
    em andamento, remove o arquivo parcial e impede que um disparo antigo com o mesmo
    titulo volte a executar depois de uma nova tentativa.
13. A carga dos caches HuggingFace valida URL, host e extensao de arquivo antes de publicar
    um titulo. A entrada corrompida `path` -> `link` foi removida do cache empacotado.
14. Foi adicionada uma auditoria automatica de contrato do catalogo: todo titulo publicado
    nos caches Xbox 360 de HuggingFace, Internet Archive e Minerva precisa resolver de
    volta para uma entrada estruturalmente valida da fonte de origem.
15. A atualizacao de cache para `xbox360` ou `all` agora inclui HuggingFace. Antes ela
    reconstruia apenas Internet Archive e Minerva, deixando a fonte primaria obsoleta.
16. O Minerva mudou os links de `/rom?name=...` para `/rom?id=...`; o scraper agora aceita
    os dois formatos e usa o texto HTML decodificado como nome do arquivo no torrent.
17. Um scrape Minerva vazio nao pode mais apagar um cache valido. A troca em memoria e no
    disco so ocorre quando a pagina retorna pelo menos uma entrada, e entradas antigas da
    mesma plataforma sao removidas apenas depois de um rebuild bem-sucedido.
18. O refresh do Internet Archive agora e atomico: se qualquer colecao configurada falhar
    ou retornar zero arquivos, o catalogo completo anterior continua ativo e nao e
    substituido por um resultado parcial.
19. O refresh HuggingFace tambem preserva o cache anterior em resposta vazia/invalida e,
    quando bem-sucedido, substitui imediatamente o mapa em memoria, sem exigir reinicio.
20. Antes de publicar um refresh Minerva, cada nome vindo da pagina e comparado com o
    torrent real usado no download. Itens ausentes do torrent nao entram no catalogo.
21. Foi criada uma auditoria remota opt-in, item a item, sem baixar os payloads completos.
    Ela confronta Archive e links Archive do HuggingFace com os metadados oficiais,
    executa HEAD em cada URL direta do HuggingFace e compara Minerva com o torrent.

## Testes executados

- `go test ./...` - aprovado em todos os pacotes do backend.
- Casos de regressao: `007 Legends`, `NASCAR '15`, `Split/Second - Velocity`, lookup
  regional no HuggingFace, separacao das chaves do Archive e migracao Minerva 2 -> 3.
- `npm run build:server` - aprovado; `dist/godsend.exe` validado como Windows PE32+.
- Auditoria dos caches empacotados: todos os titulos publicados por HuggingFace,
  Internet Archive e Minerva resolvem de volta para pelo menos a fonte de origem.
- Regressao adicionada para `Batman Arkham City GOTY` ->
  `Batman - Arkham City - Game of the Year Edition (...) (Disc 1)`.
- Inicializacao real removeu 14,47 GB de scratch orfao e elevou o espaco livre em `E:`
  de 3,39 GB para 17,85 GB antes de selecionar o volume de processamento.
- Download real do Batman pelo HuggingFace iniciou sem o erro de `truncate`, atingindo
  `63/9646 MB` a `7,4 MB/s`. A transferencia foi cancelada manualmente depois dessa
  comprovacao para evitar baixar os 9,6 GB completos durante o diagnostico.
- A remocao da tarefa em andamento foi observada no log como `tarefa cancelada pelo
  usuario`; o item saiu da fila e nenhum RAR parcial do Batman permaneceu no scratch.
- A auditoria estrita identificou a entrada invalida `path` -> `link`; apos a sanitizacao,
  todos os titulos publicados nos tres provedores passaram no teste.
- Uma atualizacao remota real confirmou `HuggingFace=1.688`, `Internet Archive=3.310` e
  `Minerva=4.446` entradas prontas. O merge publicou 3.269 titulos canonicos, sem estado
  de carregamento e sem republicar a entrada `path`.
- Durante essa atualizacao, o formato antigo do scraper Minerva retornou zero e tentou
  apagar os 4.446 itens. O caso foi reproduzido, o parser foi adaptado para `/rom?id=...`,
  o cache foi reconstruido da pagina atual e o teste de preservacao contra scrape vazio
  foi adicionado.
- Auditoria remota `TestRemoteXbox360CatalogArtifacts` - aprovada em 59,59 s:
  3.310 entradas Internet Archive verificadas, 1.688 entradas HuggingFace verificadas
  (343 URLs diretas sondadas individualmente) e 4.446 entradas Minerva encontradas no
  torrent real. Total de artefatos invalidos: zero.
- Regressoes de refresh aprovadas: IA parcial nao substitui cache completo; resposta HF
  vazia nao apaga catalogo; refresh HF valido entra em memoria; falha de validacao torrent
  preserva Minerva; item presente apenas na pagina Minerva nao e publicado.
- Validacao de runtime no executavel final `2.12.30`: refresh Minerva buscou o torrent,
  publicou 4.446 jogos sem exclusoes/avisos; as quatro visoes (`huggingface`, `ia`,
  `minerva`, `unified`) ficaram prontas, continham Batman e nao continham `path`.

## Situacao atual

A primeira correcao de merge/fallback entrou na versao `2.12.29`. A tratativa sistemica de
armazenamento, fila e alias GOTY esta na versao `2.12.30`. O documento permanece aberto
ate a confirmacao de uma instalacao real completa do arquivo de 9,6 GB do Batman. O
bloqueio original de pre-alocacao foi reproduzido e eliminado em execucao real; os testes
automatizados, a auditoria integral dos caches e a cancelacao com limpeza estao verdes.
