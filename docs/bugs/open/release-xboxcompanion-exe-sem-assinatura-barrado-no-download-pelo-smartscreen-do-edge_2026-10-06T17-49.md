# Bug: o `xboxcompanion.exe` publicado é barrado no DOWNLOAD pelo SmartScreen do Edge ("fornecedor desconhecido") e o cliente não consegue nem começar

- **Detectado em:** 2026-10-06 17:49 (chamado #148 do painel, sessão `12210927591471@lid`, telefone `554196336064`)
- **Origem:** conversa de suporte + cabeçalhos HTTP do link publicado `https://versions.digitalstoregames.com/xboxcompanion.exe`
- **Classe:** falha funcional (distribuição/release), sem crash
- **Severidade:** **P2 — Médio** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): o cliente do #148 pagou, ficou ~1 h tentando baixar o Companion (15:11 → 16:16 UTC, mais 16:43 → 17:06), desistiu (*"Vou volta a trabalhar n deu nada certo"*) e terminou o dia sem o programa. Há saída manual na própria janela do Edge (ver Hipóteses), então não é P1. Subir para P1 se a medição da tarefa 3 mostrar que a maioria desiste.
- **Complexidade:** média: a causa provável é conhecida (sem assinatura de código), mas o remédio (certificado) tem custo e prazo fora do código
- **Versões:** o arquivo servido em 2026-10-06 tem `Last-Modified: Mon, 05 Oct 2026 19:57:55 GMT` e `content-range: bytes 0-0/528186811` (528 MB)
- **Reincidência:** recorrente no suporte. Mensagens de cliente com `xboxcompanion` e os textos do aviso (`normalmente não é baixado`, `não pôde ser verificado`, `download recente`, `fornecedor desconhecido`) em `Wpp_proccess`: **23 mensagens em 15 dias distintos**, de 2026-08-06 a 2026-10-06 (uma conversa por dia).

## Sintoma, na ordem que o cliente viveu

1. Comprador da *Plataforma Xbox 360*, console **bloqueado**, só pendrive. Às 15:06 UTC o operador
   mandou o caminho certo: baixar o Xbox Companion pelo link acima, escolher "Xbox Bloqueado ou
   LT", preparar o pendrive com "Formatar antes" e adicionar os jogos.
2. No Edge, o download parou no aviso do navegador; *"Manter"* abriu uma segunda janela do
   **Microsoft Defender SmartScreen** com só **"Cancelar"** e **"Excluir"** visíveis.
3. Trocou de navegador, usou Ctrl+J e os três pontinhos, e tentou "Salvar link como" (que salvou
   uma página `.html` no lugar do programa). Às 16:16 desistiu.

## Evidência

| `Wpp_proccess` | hora UTC | o que prova |
|---|---|---|
| 132620 | 15:11:44 | print: *"xboxcompanion.exe (...) não foi baixado normalmente"*, o aviso de download do navegador |
| 132690 | 15:47:37 | *"Apertei manter aí aparece isso"*; descrição: SmartScreen, *"xboxcompanion.exe não pôde ser verificado e que o fornecedor é desconhecido. Há opções para 'Cancelar' ou 'Excluir'"* |
| 132697 | 15:52:30 | *"Mesma coisa"*, no outro navegador |
| 132715 | 15:56:43 | lista de downloads: várias tentativas de `xboxcompanion.exe` como "Cancelado" |
| 132737 | 16:12:43 | *"Cliquei em manter e não da"*; de novo "Cancelar" e "Excluir" |
| 132739 | 16:16:00 | *"Vou volta a trabalhar n deu nada certo"* |

**"Fornecedor desconhecido"** é como o SmartScreen apresenta um executável sem assinatura válida.
O link serve o arquivo direto (`HTTP 206`, `Content-Type: application/x-msdownload`), igual para
user-agent Android e desktop e sem redirecionamento (curl em 2026-10-06). O "app Itaú" que o
cliente relatou no celular ([132825]) não veio deste link.

## Hipóteses — nenhuma verificada

1. **Sem assinatura de código.** A janela diz "fornecedor desconhecido", e o guia do agente
   afirma *"Os nossos programas (...) não são assinados"* (`avisos_seguranca_pc.md`, no
   digitalstoregamesproject). Falta conferir no binário publicado
   (`Get-AuthenticodeSignature` no arquivo baixado).
2. **Reputação zerada a cada release.** O arquivo foi republicado ~19 h antes das tentativas do
   cliente (2026-10-05 19:57 UTC). Cada build tem hash novo, e o SmartScreen avalia a reputação
   pelo arquivo, então quem baixa logo depois de uma release pega o aviso mais duro. A medição
   da tarefa 3 diz se os relatos se concentram depois das datas de release.
3. **A saída manual existe, mas está escondida.** Na janela do SmartScreen do Edge, a opção de
   manter fica atrás de um expansor ("Mostrar mais" → "Manter mesmo assim", pelo plano do doc do
   agente citado abaixo). Os rótulos em pt-BR **não foram conferidos contra a tela real**: a
   imagem do cliente não fica guardada, e a descrição de visão só lista "Cancelar" e "Excluir".

## Escopo — o que NÃO é este bug

- **O agente não saber guiar a segunda janela** (afirmou *"Essa janela não tem o botão certo —
  só Cancelar e Excluir"* e inventou "Salvar link como"): lado do agente, registrado como caso
  de campo em `C:\projects\digitalstoregamesproject\docs\modules\chatbot-whatsapp\areas\prompt-kb\bugs\2026-10-01-aviso-de-download-do-navegador-confundido-com-bloqueio-do-windows.md`
  (seção "Verificação em produção §2: primeiro caso de campo, chamado #148"). Cada lado
  sobrevive sozinho: assinado, o aviso some; com o guia certo, o cliente passa mesmo sem
  assinatura.
- **Antes das 15:06 o cliente foi guiado pelo zip legado `Downloader-XBOX360-XEX-Games` do Drive**
  (com `.git` e `tests`, extração em erro de caminho longo e disco cheio): o agente estava sem o
  manual de pós-venda por outro defeito (`digitalstoregamesproject`,
  `entrega-posvenda/bugs/2026-10-06-email-digitado-sem-ponto-com-nao-liga-a-compra-e-mantem-o-pos-venda-fechado.md`).
  Não é este bug. Se o zip legado ainda deve estar no Drive é pergunta separada, não medida aqui.
- **Abrir o programa** (tela azul "O Windows protegeu o computador" → "Mais informações" →
  "Executar assim mesmo"): é outra caixa, depois do download. O cliente não chegou lá.

## Tarefas propostas / Próximos passos

1. Baixar o `xboxcompanion.exe` publicado e rodar `Get-AuthenticodeSignature` (confirma ou
   derruba a hipótese 1).
2. Num Windows com Edge em pt-BR, baixar o link e fotografar as duas janelas, para registrar os
   rótulos reais da segunda (hipótese 3). Isso destrava o guia do agente.
3. Cruzar os 15 dias com relato (query em `Wpp_proccess`, acima) com as datas de publicação do
   Companion (hipótese 2).
4. Decidir sobre assinatura de código. O planejamento já lista "instalador e binários assinados"
   (`docs/PLANEJAMENTO.md`) e "assinatura de código" para o instalador público
   (`docs/IMPLEMENTACAO-E-PENDENCIAS.md`); este doc é o custo medido que faltava para priorizar.

## Evidência de campo: o cliente do #148 passou da segunda janela (2026-10-06 22:25 UTC)

Mesma sessão (`12210927591471@lid`). Às 20:57 UTC o operador humano mandou ([133120]): na
janela *"Verifique se você confia em xboxcompanion.exe antes de abrir"*, clicar **na setinha ▼ ao
lado do botão "Excluir"** e escolher **"Manter mesmo assim"**. Às 22:25 UTC ([133149]) o cliente
já estava na tela azul de execução (*"O Windows protegeu o computador"*), e as Propriedades do
arquivo ([133289]) mostram 503 MB, criado às 19:23:33 e modificado às 19:25:43 (hora local): o
download concluiu em ~2 min depois de 6 h travado. Isso sustenta a hipótese 3 com os rótulos que
funcionaram em campo; a tela real ainda não foi fotografada (tarefa 2).

O que aconteceu **depois** do download (o programa não abre e não diz por quê) é outro bug:
[[release-portable-extrai-1-35-gb-no-temp-em-silencio-e-nao-abre-sem-avisar-o-motivo_2026-10-06T22-40]].

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** sem-codigo — o binário publicado não tem assinatura Authenticode e o build a desliga de propósito; o remédio é o dono obter um certificado de assinatura de código (decisão de custo, fora do repo) e, só então, ligar a assinatura no build; até lá, a saída é o guia do suporte/agente (já registrado no digitalstoregamesproject).
**Complexidade:** média — empacotamento (`electron-builder`, `build-and-upload.ps1`), pelo critério do `docs/bugs/open/README.md`; o trabalho de código só existe depois do certificado.
**Severidade:** medio — falha com contorno (seta ▼ ao lado de "Excluir" → "Manter mesmo assim", provado em campo no #148) e atinge o subconjunto que baixa pelo Edge/Chrome com reputação baixa; recorrente (23 mensagens em 15 dias).
**Arquivos a alterar (reserva da onda):** nenhum (sem-codigo).

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `src/electron-app/package.json::build.win` — `"forceCodeSigning": false` e `"signAndEditExecutable": false`: o electron-builder não assina o `.exe` do app nem o instalador NSIS. Não há erro: sai sem assinatura, em silêncio.
- `build-and-upload.ps1`, `build-portable-local.ps1`, `upload-r2.ps1`, `src/electron-app/build/portable.nsi` — nenhum passo de `signtool`/Authenticode (grep abaixo). `build-and-upload.ps1:132` só renomeia o portátil para `xboxcompanion.exe`; `upload-r2.ps1` sobe com SHA-256 (integridade, não identidade do fornecedor).
- O SmartScreen do Edge avalia reputação por arquivo (hash) ou por certificado do assinante. Sem assinatura, cada release (hash novo) recomeça com reputação zero, e a janela mostra "fornecedor desconhecido" — exatamente o texto do #148.

### Provas (comando literal -> resultado)

- `curl -sI https://versions.digitalstoregames.com/xboxcompanion.exe` → `200`, `Content-Type: application/x-msdownload`, `Content-Length: 589027450`, `Last-Modified: Thu, 08 Oct 2026 15:21:20 GMT` (já é outro build que o do #148: o `version.json` diz `2.12.109`, `releaseDate 2026-10-08`).
- Cabeçalho PE do arquivo publicado, sem baixar os 589 MB: `curl -s -r 0-4095 -o head.bin <url>` + leitura do `IMAGE_DIRECTORY_ENTRY_SECURITY` (índice 4 do data directory; `magic 0x10b`, PE32 = stub NSIS) → **`SECURITY dir offset 0 size 0`**: não há bloco de assinatura Authenticode. Isso equivale a `Get-AuthenticodeSignature` = `NotSigned` e fecha a hipótese 1 (tarefa 1 do doc).
- `grep -niE "sign|signtool|Authenticode" build-and-upload.ps1 build-portable-local.ps1 upload-r2.ps1 src/electron-app/build/portable.nsi` → nada.
- `grep -niE "sign|certificate|smartscreen|signtool" src/electron-app/package.json` → só as linhas 143-144 (`forceCodeSigning: false`, `signAndEditExecutable: false`).

### Hipoteses descartadas (e por que)

- **Defeito do link/servidor** (redirecionamento, MIME errado, página HTML no lugar do exe): descartado — `200`/`206` direto com `application/x-msdownload`; o `.html` que o cliente obteve veio de "Salvar link como", não do servidor.
- **Corrigível só com código neste repo**: descartado — ligar `signtool` no build sem certificado não muda nada; com certificado, a mudança é pequena e mecânica (config do electron-builder ou passo no `build-and-upload.ps1`) e só pode ser testada com o certificado em mãos. Por isso `sem-codigo` (o manual lista "SmartScreen/assinatura do `.exe`" como exemplo).
- **Hipótese 2 (reputação zera a cada release)**: não é descartada, é consequência da hipótese 1 (sem certificado, a reputação é por hash). A medição da tarefa 3 só serve para priorizar; não muda o veredito.

### Tarefas

- [ ] **Dono:** decidir e contratar assinatura de código (certificado OV/EV de uma CA, ou serviço de assinatura em nuvem como o Azure Trusted Signing — conferir elegibilidade para pessoa/empresa no Brasil antes). Observação para a decisão: desde 2024 a Microsoft diz que EV não dá mais reputação imediata no SmartScreen; o ganho real é a reputação acumular no certificado em vez de zerar a cada build. Não verificado nesta sessão: o tempo até o aviso sumir.
- [ ] **Depois do certificado (vira bug/task `corrigir` nova):** `src/electron-app/package.json::build.win` (`signtoolOptions`/`azureSignOptions`, tirar `signAndEditExecutable: false`) e/ou passo de assinatura no `build-and-upload.ps1` antes do `upload-r2.ps1` — prova: `Get-AuthenticodeSignature dist\xboxcompanion.exe` → `Valid`, e o mesmo teste de cabeçalho PE acima com `size > 0` no arquivo publicado. Assinar também `godsend-backend.exe`/`godsend-windows-*.exe` (o CHANGELOG cita antivírus barrando o backend não assinado: `spawn UNKNOWN`).
- [ ] **Suporte/agente (outro projeto, já registrado):** guia com os rótulos que funcionaram em campo (▼ ao lado de "Excluir" → "Manter mesmo assim"), em `C:\projects\digitalstoregamesproject\docs\modules\chatbot-whatsapp\areas\prompt-kb\bugs\2026-10-01-aviso-de-download-do-navegador-confundido-com-bloqueio-do-windows.md`. Nada novo a abrir lá.
- [ ] Tarefas 2 e 3 do doc (foto da janela em pt-BR; cruzar relatos × datas de release) continuam úteis para o guia e para priorizar, não para o veredito.

### Plano de teste

- **Offline (sem slot):** o teste do cabeçalho PE acima contra o arquivo publicado: hoje `size 0`; depois da assinatura, `size > 0` e `Get-AuthenticodeSignature` `Valid` no arquivo baixado.
- **T2 reproducao como o usuario (E2E, no slot):** dispensada — o bug é de distribuição (download no navegador, antes de o app existir na máquina); o app da lane não participa. A reprodução é: num Windows com Edge pt-BR, abrir `https://versions.digitalstoregames.com/xboxcompanion.exe`; sinal = aviso "não é baixado normalmente" e, em "Manter", janela do SmartScreen "fornecedor desconhecido". Exige o certificado para haver algo a testar.
- **Controle positivo:** o próprio arquivo publicado hoje (2.12.109) sem bloco de assinatura (prova acima).
- **T3 regressao direcionada:** quando a assinatura for ligada: o launcher do portátil (`build/portable.nsi`) ainda extrai e abre; o backend assinado ainda é lançado pelo `services/backendClient.ts`; o auto-update compara `sha256` do `version.json` com o arquivo assinado (o hash muda ao assinar: gerar o SHA-256 DEPOIS de assinar).

### Sessoes seguintes

- dev: não há (sem-codigo).
- teste: não há (sem-codigo).

## Planejamento (pipeline 20261012-1854, 2026-10-12)

**Veredito:** sem-codigo — nada mudou desde o planejamento de 2026-10-10: a release 2.12.110 (publicada hoje) continua sem assinatura Authenticode e o build segue com a assinatura desligada; o remédio continua sendo o dono decidir/contratar o certificado de assinatura de código (pendência 3 de `docs/backlog/bugs-abertos-proximos-passos_2026-10-12.md`), e só então abrir um item `corrigir` para ligar a assinatura no build.
**Complexidade:** média — empacotamento/release, igual ao planejamento anterior; não há código a mudar antes do certificado.
**Severidade:** medio — falha com contorno (▼ ao lado de "Excluir" → "Manter mesmo assim", provado no #148), recorrente no suporte.
**Arquivos a alterar (reserva da onda):** nenhum (sem-codigo).

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

Sem mudança em relação ao planejamento de 2026-10-10 (acima): `src/electron-app/package.json::build.win` continua com `"forceCodeSigning": false` e `"signAndEditExecutable": false` (linhas 143-144); nenhum script de release assina o `.exe`. Sem assinatura, cada release recomeça com reputação zero no SmartScreen ("fornecedor desconhecido").

### Provas (comando literal -> resultado)

- `grep -niE "sign|certificate|azure|smartscreen" src/electron-app/package.json` → só as linhas 143-144 (`forceCodeSigning: false`, `signAndEditExecutable: false`).
- `grep -nilE "signtool|Authenticode|azureSign" build-and-upload.ps1 build-portable-local.ps1 upload-r2.ps1 src/electron-app/build/portable.nsi` → nenhum arquivo (rc 1).
- `git log --oneline --since=2026-10-10 -- src/electron-app/package.json build-and-upload.ps1 upload-r2.ps1 build-portable-local.ps1` → vazio: nada de build/release mudou desde o planejamento anterior.
- `curl -sI https://versions.digitalstoregames.com/xboxcompanion.exe` → `200`, `application/x-msdownload`, `Content-Length: 589138900`, `Last-Modified: Mon, 12 Oct 2026 21:26:55 GMT`; `version.json` → `2.12.110`, `releaseDate 2026-10-12` (build novo, hash novo).
- `curl -s -r 0-4095 -o head.bin <url>` + leitura do `IMAGE_DIRECTORY_ENTRY_SECURITY` (índice 4, `magic 0x10b`) → **`SECURITY dir offset 0 size 0`**: a 2.12.110 também sai sem assinatura.
- Lado do agente (`digitalstoregamesproject/.../prompt-kb/bugs/2026-10-01-aviso-de-download-do-navegador-confundido-com-bloqueio-do-windows.md`) → `status: no-ar`: o contorno guiado já está em produção; nada a abrir lá.

### Hipoteses descartadas (e por que)

- **"Algo mudou e agora há código a corrigir"**: descartado pelas provas acima (config de build e scripts intocados; binário publicado hoje sem bloco de assinatura).
- As demais descartadas no planejamento de 2026-10-10 continuam valendo (link/servidor ok; ligar `signtool` sem certificado não muda nada).

### Tarefas

- [ ] **Dono:** decidir e contratar o certificado de assinatura de código (ver tarefas do planejamento de 2026-10-10). Enquanto não houver decisão nova, o pipeline não deve replanejar este bug.
- [ ] **Depois do certificado:** item `corrigir` novo, com as tarefas e a prova já descritas no planejamento de 2026-10-10 (inclui assinar o backend, ligado a [[release-backend-go-sem-identidade-e-com-hash-novo-a-cada-release-vira-desconhecido-para-antivirus_2026-10-11T00-14]]).

### Plano de teste

- **Offline (sem slot):** teste do cabeçalho PE contra o arquivo publicado: hoje (2.12.110) `size 0`; depois da assinatura, `size > 0` e `Get-AuthenticodeSignature` `Valid`.
- **T2 reproducao como o usuario (E2E, no slot):** dispensada — bug de distribuição (download no navegador, antes de o app existir na máquina); o app da lane não participa. Receita quando houver certificado: Edge pt-BR, abrir o link publicado; sinal = sem "fornecedor desconhecido".
- **Controle positivo:** o próprio arquivo publicado hoje (2.12.110) sem bloco de assinatura.
- **T3 regressao direcionada:** a do planejamento de 2026-10-10 (launcher do portátil, spawn do backend assinado, `sha256` do `version.json` gerado DEPOIS de assinar).

### Sessoes seguintes

- dev: não há (sem-codigo).
- teste: não há (sem-codigo).
