# Bug: catálogo HuggingFace traz release incompleta de GTA 5 (apenas Disco 2, 7.61 GB) sem Disco 1 de instalação, travando o jogo no carregamento no console

- **Detectado em:** 2026-09-26 01:05 (chamado #85 do painel, sessão `232224620290076@lid`)
- **Origem:** conversa de suporte do chamado #85 + inspeção de acervo (`cache/hf_xbox360.json`, API `emuladores.pythonanywhere.com`) e código Go (`src/server/infrastructure/helpers/multi_disc.go`, `src/server/interfaces/http/handlers.go::recordReleaseCompleteness`)
- **Classe:** conteudo-acervo / falha funcional
- **Severidade:** P1 - Alto (entrega de jogo inoperante no console, com travamento definitivo na tela de carregamento, gerando chamados de suporte e perda de horas do cliente em reinstalações)
- **Complexidade:** baixa — substituição de entrada no acervo/catálogo pelo release completo ou bloqueio/alerta de integridade para o TitleID `545408A7`
- **Reincidência:** primeira vez (relacionado ao mecanismo de multidisco introduzido em `v2.12.85` e `v2.12.86`)

## Sintoma, na ordem que o cliente viveu

1. O cliente comprou o produto Xbox 360 e configurou um pendrive de 30 GB no modo Bloqueado/LT (BadAvatar + Aurora).
2. No catálogo do Xbox Companion, buscou e baixou "GTA 5" (via HuggingFace). O app baixou e gravou a pasta `D:\Games\GTA 5 (7.61) - 545408A7\` (7.61 GB) e reportou "Gravado no dispositivo" com sucesso.
3. No console Xbox 360, ativou o Aurora via BadAvatar e executou o GTA 5.
4. O jogo iniciou os logos iniciais e entrou na tela de carregamento (artwork da policial prendendo a mulher loira de óculos escuros). Ficou travado nessa tela indefinidamente.
5. Em 25/09/2026, o cliente atualizou o aplicativo e baixou o GTA 5 novamente do zero para testar se era corrupção de download. O resultado foi idêntico: travou exatamente na mesma tela de carregamento.
6. Outro jogo instalado no mesmo pendrive (*Lord of the Rings: War in the North*) funcionou perfeitamente, provando que o exploit, o console, o pendrive e o Aurora estavam 100% funcionais e o defeito é estritamente de dados do GTA 5.

## Evidência

1. **Mensagens do cliente no chamado #85 (`Wpp_proccess`):**
   - `[109797]` (15/09 15:05): *"Liguei de novo coloquei o jogo aí tá na parte do carregamento que tá policial prende a mulher loira de óculos e tá nessa parte faz uns 4 minutos eu espero quantos minutos mais ou menos porque não sei se travou ou se demora"*
   - `[109809]` (15/09 15:15): *"o senhor dos aneis deu certo, joguei aqui"* (prova que outros jogos rodam).
   - `[109846]` (15/09 15:23): *"É o GTA trava no carregamento mesmo, vc acha que o problema tá no download ?"*
   - `[122580]` (25/09 21:11): Reinstalou o GTA 5 após atualizar o Companion.
   - `[122880]` (26/09 02:27): *"Tentei duas vezes e trava no carregamento, e outro jogo tá ok, parece que é algo técnico com esse jogo em específico"* (disparo da abertura do chamado #85).

2. **Evidência do arquivo baixado (`Wpp_proccess` e telemetria de erro local pré-fix):**
   - Mensagem `[109377]`: `rename D:\Games\GTA 5 (7.61) - 545408A7\sfx\audio_cs.rpf.xbox-companion-part D:\Games\GTA 5 (7.61) - 545408A7\sfx\audio_cs.rpf`. O tamanho nominal da pasta é **7.61 GB**.

3. **Inspeção do catálogo remoto e empacotado:**
   - Em `cache/hf_xbox360.json` (L4237-4240):
     ```json
     "hf_xbox360\u0000gta 5": {
       "collection_id": "6758.12MB",
       "filename": "https://huggingface.co/datasets/luistiagos/xbx/resolve/main/GTA%205%20%287.61%29.7z"
     }
     ```
   - Na API de catálogo remoto (`https://emuladores.pythonanywhere.com/api/rom/list?system=xbox360rgh&source_id=1`):
     - Item 1: `Grand Theft Auto 5.rar` (14.36 GiB, Archive.org: `Grand.Theft.Auto.5.EUR.X360-ZTM.rar`) -> Release completa contendo Disco 1 (Content install packs) + Disco 2 (jogo executável).
     - Item 2: `GTA 5 7z` (6758.12 MB, HuggingFace: `GTA 5 (7.61).7z`) -> Contém **apenas o Disco 2** (Playable disc, ~7.61 GB extraído).
   - Consulta à árvore do dataset HuggingFace (`https://huggingface.co/api/datasets/luistiagos/xbx/tree/main`):
     - Contém somente `GTA 5 (7.61).7z` (tamanho: 7.086.399.509 bytes). Não existe arquivo de Disco 1 no repositório `luistiagos/xbx`.

4. **Comportamento comprovado do console Xbox 360:**
   - GTA V no Xbox 360 é um jogo estritamente obrigatório de 2 discos: o Disco 1 contém 4 pacotes de instalação mandatórios (`Content/0000000000000000/545408A7/00000002/545408A700000000` a `0003`, totalizando ~8 GB).
   - O Disco 2 é o disco jogável (`default.xex` e arquivos de áudio/gráficos).
   - Quando o Disco 2 é iniciado sem os pacotes do Disco 1 presentes na partição `Content/0000000000000000/545408A7/00000002/`, o motor do jogo carrega os splashes e congela indefinidamente no loop da tela de loading da policial prendendo a mulher loira.

## Causa raiz

A causa raiz é dupla:

1. **Acervo / Catálogo:** A entrada `"gta 5"` em `hf_xbox360.json` e no endpoint de ROMs mapeia para um rip de apenas um disco (`GTA 5 (7.61).7z` em `luistiagos/xbx`), faltando completamente o Disco 1 de instalação. Por ser nomeado apenas `"gta 5"`, ele não traz o sufixo `(Disc 2)` nem foi marcado como multidisco.
2. **Defesa do Companion no Enfileiramento / Instalação:**
   - Em `handlers.go::recordReleaseCompleteness`: a checagem `if !models.ExtractDiscInfo(primaryGame).IsMultiDisc` ignora títulos que não tragam palavras de disco no rótulo, mesmo que o TitleID (`0x545408A7`) esteja categorizado em `models/compat.go:45` como jogo com disco de instalação obrigatório:
     ```go
     {0x545408A7, 1}: {InstallType: "content", Notes: "Grand Theft Auto V Disc 1 is the installation/content disc"},
     ```
   - Em `companion_content.go::installCompanionDiscContent`: o pipeline tenta extrair payloads de `Content/...` do arquivo baixado via `helpers.FindCompanionContentPayloads(extDir, gameFolder)`. Como o arquivo `GTA 5 (7.61).7z` não possui a árvore de conteúdo embutida, nenhum payload é encontrado (`len(payloads) == 0`). O app grava apenas o executável e declara a instalação como concluída sem verificar se os requisitos mínimos de instalação do TitleID foram atendidos.

## Escopo — o que NÃO é este bug

- **Não é falha de hardware do cliente, do pendrive ou do console:** outros títulos (LOTR) rodaram normalmente.
- **Não é falha do BadAvatar ou do Aurora:** o exploit disparou, carregou o Aurora e o Aurora lançou o jogo.
- **Não é bug do pipeline de gravação local do Companion:** o arquivo baixado foi descompactado e gravado sem erros na segunda tentativa. O problema é que o arquivo baixado é intrinsecamente incompleto.

## Tarefas propostas / Próximos passos

1. **Acervo / Base de ROMs (`digitalstoregamesproject` / `emuladores`):**
   - Na tabela de ROMs e no dataset `luistiagos/xbx`, remover a entrada isolada `GTA 5 (7.61).7z` ou substituí-la pelo pacote completo unificado (como o `Grand.Theft.Auto.5.EUR.X360-ZTM.rar` de 15.4 GB do Archive.org), ou empacotar os arquivos do Disco 1 (`Content/0000000000000000/545408A7/00000002/`).
2. **Xbox 360 Companion (`Downloader-XBOX360-XEX-HDD-Games`):**
   - Atualizar `cache/hf_xbox360.json` e `cache/hf_.json` para apontar `gta 5` para a fonte completa.
   - Em `models/compat.go` / `handlers.go`: se um jogo com TitleID conhecido de instalação obrigatória (`0x545408A7`, etc.) for baixado sem pacotes de instalação presentes em `Content/`, alertar ou buscar o fallback para a release completa.
3. **Agente de Atendimento:**
   - Registrar bug cruzado em `digitalstoregamesproject` para o agente não orientar clientes a apagar arquivos de instalação de CD 1 do pendrive (ver doc irmão: `docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-09-26-agente-xbox-instrui-apagar-disco1-instalacao-gta5.md`).

## Revisão da correção — 2026-09-26

**Resultado: correção ainda não aprovada; manter o bug aberto.** A revisão examinou as alterações locais ainda não commitadas, com base em `c859f97`. A troca da URL nos caches e a exclusão do arquivo incompleto durante o carregamento/rebuild do catálogo ajudam a tratar a origem conhecida, mas a nova defesa de instalação introduz regressões e ainda aceita instalações incompletas.

As referências de linha abaixo correspondem ao estado revisado e podem mudar com a correção dos achados. Esta seção registra a revisão; os problemas descritos não foram corrigidos nela.

### 1. [P1] A barreira de conteúdo bloqueia o próprio Disco 1 de instalação

- **Local:** [companion_content.go](../../../src/server/services/pipeline/companion_content.go), `installCompanionDiscContent`, linhas 40–43; chamadas em [pipeline.go](../../../src/server/services/pipeline/pipeline.go), linhas 293–302, e [minerva.go](../../../src/server/services/pipeline/minerva.go), linhas 146–149.
- **Condição:** destino vazio e um arquivo de catálogo contendo a ISO do Disco 1. Nesse ponto, apenas a ISO foi retirada do arquivo compactado; a árvore `Content/` dentro dela ainda não foi extraída.
- **Defeito:** a nova chamada a `verifyMandatoryCompanionContentPresent` exige os pacotes no destino antes de `resolveISOInstallType` identificar o disco como instalação e de `processContentInstallFromISO` extrair e gravar esses mesmos pacotes.
- **Evidência:** o teste temporário `TestReviewInstallDiscCanReachISOProbe` chamou a barreira nesse estado, com o nome real de catálogo `Grand Theft Auto V (Japan) (Disc 1) (Install)`, e recebeu `release incompleta` por ausência do Disco 1. O teste reproduziu a decisão da barreira; não utilizou uma ISO real.
- **Impacto:** impede instalar do zero o conteúdo que a própria correção passa a exigir.
- **Correção necessária:** determinar o papel do disco antes de aplicar a exigência. Permitir que discos de instalação sejam processados e validar os requisitos para a entrega do disco jogável, considerando também a ordem/dependência dos jobs dos discos.

### 2. [P1] Os novos aliases confundem GTA IV com GTA V

- **Local:** [compat.go](../../../src/server/models/compat.go), `titleNameHints`, linhas 352 e 354; `GuessTitleIDFromMultiDiscName`, linha 368.
- **Defeito:** os padrões novos exigem a substring `"v"` usando `strings.Contains`. A letra também está presente no numeral `"IV"`.
- **Evidência:** `TestReviewGTAIVIsNotGTAV` confirmou que `Grand Theft Auto IV (USA) (En,Fr,De,Es,It)`, nome existente em `cache/xbox360.json`, resolve indevidamente para `545408A7` (GTA V).
- **Impacto:** quando só há uma ISO no diretório extraído e o TitleID ainda não foi lido, a nova barreira usa esse palpite e pode rejeitar GTA IV exigindo os pacotes de instalação do GTA V. O mesmo palpite também alimenta o aviso de incompletude.
- **Correção necessária:** reconhecer `V`/`5` como componentes completos do título, sem aceitar letras ou números contidos em outros termos. Acrescentar testes negativos para GTA IV e variantes reais do catálogo, preservando a identificação dos aliases legítimos do GTA V.

### 3. [P1] Qualquer arquivo no destino é aceito como instalação completa

- **Local:** [companion_content.go](../../../src/server/services/pipeline/companion_content.go), `hasDestinationMandatoryContent`, linhas 87–95 (local) e 109–117 (FTP).
- **Defeito:** basta encontrar uma entrada que não seja diretório em `Content/0000000000000000/<TitleID>/00000002`. Não há conferência dos pacotes obrigatórios, de tamanho ou de identidade do conteúdo.
- **Evidência:** `TestReviewRejectUnrelatedDestinationFile` criou somente um `unrelated.txt` vazio na pasta do GTA V. A instalação foi autorizada e o log afirmou que os pacotes já estavam presentes. O teste adicionado pela própria correção, `TestInstallCompanionDiscContentAllowsWhenDestinationAlreadyHasContent`, também aceita apenas um arquivo sintético `545408A700000000` com os bytes `install-pack-0`, sem os demais pacotes.
- **Impacto:** um DLC, um arquivo vazio ou uma sobra de transferência pode liberar novamente a entrega de um jogo sem o Disco 1 completo. O ramo FTP tem a mesma fragilidade por inspeção do código; não foi exercitado contra um console.
- **Correção necessária:** definir e verificar o conjunto obrigatório de pacotes por título, com identidade e integridade suficientes para rejeitar conteúdo ausente, truncado ou alheio. Para GTA V, conferir todos os quatro pacotes descritos neste relatório. Aplicar critérios equivalentes no destino local e no FTP; existência de qualquer arquivo não comprova completude.

### 4. [P1] Conteúdo alheio no arquivo compactado pula a validação obrigatória

- **Local:** [companion_content.go](../../../src/server/services/pipeline/companion_content.go), `installCompanionDiscContent`, linhas 41–43 e 73–74.
- **Defeito:** a verificação obrigatória só roda quando `len(payloads) == 0`. Havendo qualquer payload reconhecido, o código o instala, apaga `IncompleteRelease` e retorna sucesso sem demonstrar que os requisitos do jogo foram atendidos.
- **Evidência:** `TestReviewRejectUnrelatedArchivePayload` montou uma pasta jogável identificada como GTA V e uma árvore de conteúdo com um pacote sintético de outro TitleID, `4D5307D5`. O pacote alheio foi copiado e a função retornou sucesso mesmo sem os pacotes do GTA V.
- **Impacto:** conteúdo de outro jogo ou um conjunto parcial de pacotes permite contornar a defesa. O aviso também pode desaparecer indevidamente. No ramo sem destino registrado, o aviso é apagado mesmo quando o próprio log informa que o conteúdo de instalação não será incluído no pacote manual.
- **Correção necessária:** validar a correspondência entre os payloads e o TitleID do jogo e a completude do conjunto exigido, considerando origem e destino. Remover o aviso apenas após comprovar a entrega dos requisitos; encontrar ou copiar algum payload não basta.

### 5. [P2] Os novos testes de cache não compilam

- **Local:** [refresh_safety_test.go](../../../src/server/services/cache/refresh_safety_test.go), bloco de imports e linhas 175, 184, 207 e 210.
- **Defeito:** quatro chamadas novas a `strings.Contains` foram adicionadas sem importar `strings`.
- **Evidência:** `go test ./models ./services/cache ./services/pipeline ./interfaces/http`, executado em `src/server`, falhou com:
  ```text
  services\cache\refresh_safety_test.go:175:6: undefined: strings
  services\cache\refresh_safety_test.go:184:6: undefined: strings
  services\cache\refresh_safety_test.go:207:5: undefined: strings
  services\cache\refresh_safety_test.go:210:6: undefined: strings
  FAIL godsend/services/cache [build failed]
  ```
- **Correção necessária:** acrescentar o import e executar novamente os testes de cache junto aos demais pacotes afetados. O build do executável não compila os arquivos `*_test.go`, portanto não detecta essa falha.

### Pendências de versão e changelog

O diff revisado não inclui o bump funcional exigido pelo `AGENTS.md` nem a entrada correspondente no `CHANGELOG.md`. Antes de publicar a correção, atualizar os quatro locais obrigatórios (`package.json`, `src/electron-app/package.json`, banner em `src/server/main.go` e `aurora-scripts/main.lua`), o changelog e as referências de versão pertinentes na documentação.

Esta atualização do relatório é apenas documental; não representa a implementação nem a publicação de uma nova versão.

### Validação executada e limites da revisão

| Verificação | Resultado |
|---|---|
| `npm run build:server` | Passou; binários Windows x64 e ia32 gerados e verificados pelo script. |
| `go test ./models ./services/cache ./services/pipeline ./interfaces/http` | Models, pipeline e HTTP passaram; cache falhou na compilação por falta do import `strings`. |
| `go -C src/server test ./services/pipeline -run '^TestReview' -count=1 -v` | Os quatro testes temporários falharam nas expectativas de comportamento correto, confirmando os achados funcionais 1–4. |
| Preservação da correção revisada | Os testes temporários foram removidos após a execução; o código da correção não foi alterado pela revisão. |

Os testes temporários usaram diretórios locais e cabeçalhos sintéticos, sem baixar os jogos. Não houve execução em console, teste real de FTP, inspeção do conteúdo do arquivo substituto do Archive.org nem confirmação de mudança no catálogo remoto. Portanto, a revisão não comprova que a nova fonte entrega uma release completa e funcional: isso permanece como validação necessária antes de encerrar o bug.

### Critérios para nova revisão e encerramento

- [ ] Corrigir os cinco achados acima e incluir testes de regressão permanentes para cada comportamento.
- [ ] Permitir a instalação do Disco 1 em destino vazio e garantir a dependência do disco jogável em relação ao conteúdo obrigatório.
- [ ] Rejeitar arquivos irrelevantes, pacotes de outro título e conjuntos incompletos, tanto na origem quanto no destino.
- [ ] Preservar GTA IV e outros títulos que não podem herdar os requisitos do GTA V.
- [ ] Reexecutar build e testes dos pacotes afetados, incluindo cache.
- [ ] Validar o conteúdo real da fonte substituta, sua gravação completa e o boot no console.
- [ ] Conferir as ações de acervo remoto e atendimento propostas anteriormente; elas não foram verificadas nesta revisão.
- [ ] Cumprir as pendências de versão/changelog antes da publicação e só então reavaliar o fechamento do bug.

## Correção dos achados — 2026-09-26 (v2.12.102)

**Resultado: código corrigido e testado; o bug continua aberto até a validação no console e as ações de acervo remoto.** A correção retrabalha as alterações revisadas acima, ainda sem commit, sobre `c859f97`.

### Fato de base conferido antes de codificar

O conjunto do Disco 1 foi confirmado em duas fontes independentes (fóruns Se7enSins e XPG): quatro arquivos, `545408A700000000` a `545408A700000003`, em `Content/0000000000000000/545408A7/00000002`. Os metadados do item `mx360gcpt3-x360-ztm` no Archive.org registram, para `Grand.Theft.Auto.5.EUR.X360-ZTM.rar` (15.414.198.016 bytes), *"Copied Folder 545408A7 From Disc2/content/0000000000000000/ To hdd1/content/0000000000000000/ — Tested Game No Issues Found"*. O item pertence à coleção `loggedin` e responde 401 sem login, como as outras 1.345 entradas `archive.org` do mesmo catálogo. O downloader já trata isso (`iaHTTPError`).

### Achado por achado

| # | Correção | Regressão permanente |
|---|---|---|
| 1 | A exigência saiu da entrada de `installCompanionDiscContent` e só vale quando a pasta entregue é um disco jogável: `default.xex` ou estrutura GOD (`playableTitleID`). Nos caminhos de ISO ela roda depois de `resolveISOInstallType`, em `convertAndFinalizeGODResilient`, antes do laço GOD de `ProcessGameWithErr` e no ramo XEX de `ProcessLocalISO`. A ordem entre os jobs dos discos é tratada por `pendingInstallDiscJob`: com a tarefa do Disco 1 da mesma release ainda na fila, o disco jogável é entregue com aviso. Se ela já falhou, a entrega é recusada. | `TestInstallDiscIsNotHeldToItsOwnContent`, `TestPlayableDiscDefersToAQueuedInstallDisc`, `TestPlayableGTAVISORequiresInstallContent` |
| 2 | `GuessTitleIDFromMultiDiscName` casa palavras inteiras (`containsWords`). A pipeline não usa mais o palpite pelo nome para exigir conteúdo: o TitleID vem do executável. Sobre todos os nomes de `cache/*.json`, a comparação antes/depois tirou do GTA V 18 linhas que só casavam por substring (GTA IV, San Andreas "Rev 1", Advance GTA, "GTA IV Complete Edition [DVD1]" e um TU do GTA Online que casava pelo "v" de "Festive" e voltou a ficar sem palpite, como no `HEAD`). Fora do GTA V, mudaram só quatro palpites antigos, todos para melhor. | `TestGTAVNameHintMatchesWholeWordsOnly`, `TestGTAIVIsNotHeldToGTAVInstallContent` |
| 3 | `mandatoryInstallDiscs` passou a listar os quatro pacotes. `InstallPackageProblem` confere magia, TitleID (`0x360`) e tipo de conteúdo (`0x344`) no cabeçalho, e compara o tamanho do arquivo com o declarado: content size em `0x34C` e blocos alocados em `0x395`. Contra 28 pacotes STFS reais, nenhum íntegro foi reprovado, todo TitleID alheio foi recusado e todo pacote retail LIVE/PIRS com 1 byte a menos foi detectado. Local e FTP usam o mesmo `InstallSetProblem`. No FTP, só o que o console mostra de forma positiva falha o job (ver "Segunda revisão", abaixo). No modo local, outro pendrive montado na mesma letra deixa a conferência em aberto. | `TestDestinationMustHoldEveryValidInstallPackage` (arquivo alheio, parcial, outro TitleID, truncado, completo), `TestFTPInstallSetCheckReportsOnlyWhatTheConsoleShows`, `TestFTPInstallSetCheckGivesUpOnAStalledConsole`, `TestAnotherDriveAtTheDestinationIsNotRead` |
| 4 | O payload de um título obrigatório é conferido na origem e, se incompleto, não é gravado. Payload de outro TitleID continua sendo entregue, mas não satisfaz a exigência. O aviso só é apagado quando o conjunto foi gravado neste job ou conferido no destino. Sem destino (pacote manual), o aviso é gravado em vez de apagado. | `TestIncompleteInstallSetInTheArchiveIsNotWritten`, `TestForeignPayloadDoesNotStandInForTheInstallDisc`, `TestManualPackageWarnsThatTheInstallDiscIsLeftOut`, `TestGTAVArchiveWithTheWholeReleaseIsDelivered` |
| 5 | Import de `strings` acrescentado em `refresh_safety_test.go`. O teste de sanitize agora também exige que "GTA 5" continue listado. | `go test ./services/cache` |

O aviso de enfileiramento que a tentativa anterior pôs em `handlers.go::recordReleaseCompleteness` foi retirado, e o arquivo voltou a ser igual ao `HEAD`. Ele dependia do palpite pelo nome e se prenderia também a entregas de conteúdo. Agora quem decide é a pipeline, com o TitleID real. MGS V e Alien: Isolation saíram da lista obrigatória por não terem o conjunto de pacotes verificado.

### Segunda revisão independente (mesma data) e ajustes

A revisão do código acima confirmou `containsWords`: de 48.992 nomes em `cache/*.json`, mudaram 35, todos para melhor. Ela também achou problemas no ramo FTP, que foram corrigidos:

- **`List` com caminho absoluto.** O projeto documenta (`services/content/content.go:174` e `:438`) que o Aurora ignora ou recusa caminho absoluto. A listagem voltaria sem os pacotes, e o job acusaria um falso `release incompleta`, inclusive logo depois de gravar os 8 GB nos caminhos de ISO. Agora a leitura faz `CWD` e depois `LIST("")`, e o `RETR` usa só o nome. O servidor FTP falso do teste imita esse comportamento, e voltar ao caminho absoluto derruba o teste.
- **Erros transitórios contados como conteúdo ausente.** Só 550 no `CWD` conta como pasta inexistente. Qualquer outro código, `LIST` com falha ou cabeçalho que não chega deixa a conferência em aberto: a entrega segue com aviso, sem erro.
- **Checagem sem prazo.** Ela roda com a fila de jobs e o slot FTP do console presos. Agora tem prazo total de 30 s, prazo por leitura de 8 s e pausa de 150 ms entre canais de dados, como `listWithTimeout`.
- **Dispositivo trocado no modo local.** Com `LocalDeviceID` diferente do pendrive montado, a conferência fica em aberto, e quem assume é o `waitForLocalDevice` da entrega.
- **Conjunto repetido no arquivo.** Pela descrição do item no Archive.org, o rar pode trazer a árvore em `Disc2/content` e em `hdd1/content`. O segundo conjunto obrigatório igual não é regravado (`TestRepeatedInstallTreeIsWrittenOnce`).

Ficou como limitação conhecida, sem mudança de código, o Disco 1 com tipo XEX forçado. Os discos companheiros herdam o tipo do primário, e nesse modo a ISO do Disco 1 vira pasta XEX sem passar por `resolveISOInstallType`, então cai na exigência. Não é regressão: esse caminho já entregava uma pasta inútil sem instalar o conteúdo. Distinguir o disco pelo número gravado no `default.xex` arriscaria liberar justamente um rip do disco jogável.

Cada teste novo foi conferido contra o defeito que protege. Reintroduzir a gravação de conjunto parcial, a aceitação de qualquer pacote e a exigência antes de identificar o papel do disco derruba, respectivamente, `TestIncompleteInstallSetInTheArchiveIsNotWritten`, `TestDestinationMustHoldEveryValidInstallPackage` e `TestInstallDiscIsNotHeldToItsOwnContent`.

### Validação executada

| Verificação | Resultado |
|---|---|
| `go test ./models ./infrastructure/helpers ./services/pipeline ./services/cache ./interfaces/http` | Passou. |
| `go test ./...` | A última rodada, depois dos ajustes da segunda revisão, passou em todos os pacotes. Rodadas anteriores tiveram duas falhas intermitentes de Windows em código não alterado: `infrastructure/download` `TestSingleDownloadResumesFromPersistedOffset` (limpeza do `TempDir`: "directory is not empty"; falha em 1 de 3 execuções isoladas) e, numa das duas rodadas, `TestWaitForLocalDeviceIgnoresWrongReplacementAndResumesSameDevice` preso até o timeout (passa isolado 3 de 3). |
| `go vet ./...` | Sem apontamentos. |
| `npm run build:server` | Passou; binários Windows x64 e ia32 verificados pelo script. |
| Versão | 2.12.102 nos quatro locais obrigatórios e nos dois `package-lock.json`; entrada no `CHANGELOG.md`. |

### O que continua pendente para fechar

- [ ] Baixar a release ZTM com conta logada, instalar num pendrive e confirmar o boot do GTA V no console. A árvore `hdd1/content` foi confirmada só pela descrição do item; o conteúdo do `.rar` não foi aberto. Conferir em especial qual pasta traz o `default.xex` jogável. `FindXEXFolder` pega o primeiro em ordem lexical: se houver `Disc1/` com o instalador e `Disc2/` com o jogo, o instalador seria entregue como jogo, e a exigência passaria porque o conjunto de `hdd1` foi gravado.
- [ ] Exercitar a conferência por FTP contra um console real com o Aurora. O servidor falso reproduz o comportamento documentado no código, não o servidor verdadeiro.
- [ ] Acervo remoto (`digitalstoregamesproject`/`emuladores`): retirar `GTA 5 (7.61).7z` da API de ROMs e do dataset `luistiagos/xbx`. Enquanto isso, o app descarta a URL no rebuild e no cache salvo.
- [ ] Atendimento: o bug cruzado existe em `digitalstoregamesproject`, em `docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-09-26-agente-xbox-instrui-apagar-disco1-instalacao-gta5.md`. T1 (evidência) e T2 (caso de eval) estão commitadas. A T3, que ajusta a KB do `XBOX360_AGENT`, está sob a moratória de prompts e depende de aprovação do dono. A "Passada 2" desse doc lista o que esta correção muda para o agente, incluindo as mensagens novas do Companion. A KB só deve mudar depois que a 2.12.102 for publicada.
