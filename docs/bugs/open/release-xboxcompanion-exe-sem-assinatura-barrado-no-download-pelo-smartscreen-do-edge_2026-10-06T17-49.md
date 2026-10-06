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
