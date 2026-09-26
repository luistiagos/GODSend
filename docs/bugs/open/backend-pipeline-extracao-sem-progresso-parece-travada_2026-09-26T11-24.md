# Bug: a fase de extração não publica progresso, e o cliente passa 20 minutos achando que o app travou

- **Detectado em:** 2026-09-26 11:24 (chamado #85 do painel, sessão `232224620290076@lid`)
- **Origem:** conversa de suporte + leitura de `src/server/services/pipeline/huggingface.go`, `stage_checkpoint.go::extractArchiveResilient`, `utils/iso2god.go::ExtractArchive` e `renderer/components/QueuePage.tsx`
- **Classe:** diagnóstico (UI da fila)
- **Severidade:** **P3 - Baixo** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): nada falha. O custo é o cliente não saber se o app travou e mexer no que não devia (fechar o app, tirar o pendrive)
- **Complexidade:** média — `ExtractArchive` não tem callback de progresso, e a extração passa pela biblioteca de 7z/rar/zip
- **Reincidência:** segunda ocorrência conhecida (FIFA 19, `[85248]`, 2026-08-26)

## Sintoma, na ordem que o cliente viveu

GTA 5 do HuggingFace (7z de 6,7 GB), v2.12.81, gravação direta no pendrive:

- `[109369]` 15/09 01:56:49 — print da fila: *"Ta assim é normal? ou tinha que mostrar o tempo estimado"*
- `[109371]` 02:02:52 — *"Entendi é que tá uns 20 minutos nisso, achei que tinha travado"*
- `[109373]` 02:03:43 — *"Não tem barra, só aparece que está extraindo"*

O agente disse duas vezes que a barra chegaria a 100% (`[109338]`, `[109370]`) e só depois admitiu que
*"sem barra é normal nessa tela"* (`[109374]`). O agente não tinha como saber, porque a tela não mostra.

Caso anterior: `[85248]` 2026-08-26, outro cliente, print da fila com FIFA 19 *"processando, extraindo
arquivos"*: *"Demorando muito aqui"*.

## Evidência

- `huggingface.go:58` publica uma única mensagem para a fase inteira: `LogStatus(gameName, "Processing",
  "Extracting HuggingFace archive...")`. Os outros provedores publicam frases equivalentes (`digital.go:183`
  e `:330`, `minerva.go:60`, achados por `grep`). Não abri essas funções para ver se alguma mede progresso.
- `stage_checkpoint.go:304-308`: `extractArchiveResilient` chama `utils.ExtractArchive(archivePath, destDir)`
  (`iso2god.go:822`), que não recebe callback de progresso. `runDirectoryStage` só publica status ao
  **retomar** uma fase já concluída.
- `QueuePage.tsx:174-176` só desenha porcentagem quando ela vem no texto da mensagem (`(NN%)` ou `: NN%`).
  Sem número, a fila mostra só o texto, sem barra.

Resultado: num arquivo de vários GB, a fila fica parada na mesma frase por dezenas de minutos, e nada na
tela diferencia "trabalhando" de "travado".

## Escopo — o que NÃO é este bug

- **Não é** a lentidão da gravação do #85 naquela noite, que teve colisão entre instâncias do app
  (ver a seção "Confirmação de campo — chamado #85" de
  [`electron-main-multiplas-instancias-sem-single-instance-lock`](../closed/electron-main-multiplas-instancias-sem-single-instance-lock_2026-09-15T14-44.md)).
  Este doc trata só da falta de sinal na tela.
- **Observado e não investigado:** no mesmo episódio, o jogo apareceu em *Jogos instalados* enquanto a fila
  ainda gravava (`[109375]` 02:05:43). Isso pode ser um problema à parte do scanner de jogos locais. Não
  abri `localGameScannerService.ts` e não há afirmação sobre ele aqui.

## Tarefas propostas / Próximos passos

1. Publicar progresso na extração: bytes ou arquivos extraídos sobre o total, na forma `(NN%)` que a
   `QueuePage` já entende. Onde a biblioteca não der o total, publicar ao menos um contador que muda
   ("NN arquivos extraídos"), para a tela mostrar que o app está vivo.
2. Teste unitário com um arquivo pequeno: a sequência de `LogStatus` da fase de extração precisa ter mais de
   uma mensagem e terminar em 100%.
