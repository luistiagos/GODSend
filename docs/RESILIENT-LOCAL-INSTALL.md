# Instalação local resiliente em pendrive/HD

## Objetivo

O fluxo local do Xbox 360 Companion deve continuar sendo “conectar e jogar” mesmo quando um pendrive ou HD USB sofre mau contato durante a gravação. A perda temporária do destino não é uma falha de download e nunca deve acionar outro provedor.

## Causa do incidente observado

O log registrou a desconexão durante `Data0021`, depois que `Data0000` a `Data0020` já haviam sido gravados. O erro de escrita foi devolvido como uma falha comum do pipeline; por isso o fallback tentou Internet Archive/Minerva e o material intermediário foi removido. O arquivo `Data0021` ficou truncado e o diretório incompleto ficou visível em `Games`.

## Contrato de recuperação

1. Ao registrar o destino, o backend cria `.xbox-downloader/xbox-companion-device-id` e guarda essa identidade na tarefa.
2. Cada arquivo é copiado para `<nome>.xbox-companion-part`, sincronizado no dispositivo, verificado por tamanho e SHA-256 e somente então renomeado para o nome definitivo.
3. Se o destino desaparecer, a tarefa permanece em `Processing` com a mensagem para reconectar o mesmo dispositivo. Um disco diferente na mesma letra não é aceito.
4. Na reconexão, arquivos definitivos íntegros são apenas verificados e reutilizados. O arquivo interrompido é refeito a partir do staging local.
5. Se o staging GOD no USB tiver sido perdido, a ISO preservada no armazenamento temporário do PC é usada para reconstruí-lo.
6. Downloads HTTP destinados a mídia local ficam em `Ready/<jogo>/.source*.ext` com o marcador `<arquivo>.xbox-companion-complete.json`. URL, tamanho e SHA-256 precisam conferir antes do cache ser reutilizado. Downloads Minerva preservam o diretório do torrent e seus metadados de retomada enquanto a tarefa local não chegar a `Ready`.
7. O cache e a ISO só são removidos depois que a instalação local termina. Erros de destino não avançam para outro provedor.

## Checkpoints por etapa

### Detecção do pendrive no Windows

- A listagem tenta primeiro `System.IO.DriveInfo` e `mountvol`, que continuam funcionando quando o provedor Storage Management/WMI fica bloqueado após uma desconexão ruim.
- Pendrives removíveis montados recebem uma identidade estável pelo GUID do volume e podem ser selecionados e gravados normalmente.
- O tamanho do cluster no modo alternativo é lido diretamente por `GetDiskFreeSpaceW`; a validação de capacidade não depende de `Get-Volume` e não recebe mais o valor desconhecido `0`.
- Se nenhuma mídia removível for encontrada, o Companion consulta `Get-Disk` para suportar HDs USB reportados como disco fixo, com timeout limitado para não travar a interface.
- A formatação pode ser escolhida no modo alternativo quando há GUID de volume estável. Antes de apagar, o processo elevado confirma novamente o GUID, resolve a partição física e bloqueia disco 0, barramento não USB, boot/sistema, disco offline/somente leitura, múltiplas partições montadas ou capacidade divergente.
- O script PowerShell elevado é gerado por template raw para preservar literalmente `System32\mountvol.exe` e a raiz `<letra>:\`. Um teste analisa a sintaxe do script completo sem executá-lo, evitando regressões de escape antes do bloco destrutivo.
- Depois de recriar a partição, o GUID muda por definição. O Companion espera o mesmo destino reaparecer em FAT32 e com a capacidade esperada, então passa a usar a nova impressão digital em todo o plano transacional.
- O método de detecção, unidades encontradas e decisões de segurança ficam registrados no log diário.
- A tela inicial repete a detecção a cada cinco segundos. Se o dispositivo estava desconectado na abertura e reaparecer depois, o fluxo muda automaticamente para “Pendrive Xbox 360 detectado”.
- “Verificar pendrive preparado novamente” executa a mesma validação sob demanda e diferencia uma unidade ainda não montada pelo Windows de uma unidade que realmente não contém a estrutura Xbox.
- A escolha explícita “Preparar outro pendrive/HD” suspende o redirecionamento automático para não interromper o novo assistente.

### Download HTTP

- Fluxo simples: `<arquivo>.xbox-companion-resume.json` registra URL, tamanho, validador HTTP e o offset durável. A retomada usa `Range` e `If-Range`; se o servidor trocar o arquivo, o parcial é descartado com segurança.
- Fluxo paralelo: o mesmo marcador mantém o mapa dos segmentos concluídos e o SHA-256 de cada segmento. Um segmento só é reutilizado se seu conteúdo ainda conferir.
- Conclusão: `<arquivo>.xbox-companion-complete.json` guarda URL, tamanho e SHA-256 do arquivo inteiro.
- Antes de considerar o HTTP concluído, o Companion valida `Content-Range` contra o offset, o segmento e o tamanho total solicitados. Uma faixa divergente nunca é gravada sobre outro segmento.
- Se o processo parar entre o `fsync` do último byte e a publicação do marcador final, o arquivo integral é promovido e recebe seu SHA-256 sem outra requisição.

### Torrent Minerva

- O aria2 grava em `Temp/torrent-dl/resume-<identidade>` com `--continue=true` e conserva o arquivo de controle durante interrupções.
- O espaço já baixado entra no cálculo de capacidade restante.
- O diretório de retomada só é removido após o arquivo completo ser movido para o staging; o staging concluído permanece enquanto a tarefa local não chegar a `Ready`.

### Extração ZIP, 7Z, RAR e XDVDFS

- Cada arquivo é produzido como `.xbox-companion-part`, sincronizado e renomeado somente após atingir o tamanho esperado.
- ZIP/7Z e XDVDFS reutilizam arquivos já confirmados. RAR refaz atomicamente a entrada porque arquivos sólidos precisam ser drenados em sequência.
- `<diretório>.xbox-stage-complete.json` relaciona fonte, tamanho, data e SHA-256 de todos os resultados. Arquivo ausente, extra ou alterado invalida somente aquela fase.
- `<diretório>.xbox-stage-source.json` identifica a fonte de uma fase ainda incompleta. A mesma fonte preserva os arquivos confirmados; uma fonte alterada limpa os resíduos antes de recomeçar.
- ZIP/7Z reutilizam arquivos somente quando tamanho e CRC32 conferem. XDVDFS compara o arquivo existente com os bytes correspondentes da ISO. Assim, corrupção que mantenha o mesmo tamanho também é detectada e reparada.

### Conversão GOD/XEX/Content

- A ISO permanece disponível até a entrega chegar a `Ready`.
- GOD incompleto é descartado e reconstruído da ISO, com limite de tentativas para evitar laço infinito em uma ISO realmente inválida.
- XEX e Content reutilizam arquivos XDVDFS publicados atomicamente e um checkpoint validado.
- A fase anterior só é limpa depois que a seguinte possui um checkpoint íntegro ou a instalação foi concluída.
- Diretórios incompletos de extração, XEX e Content permanecem disponíveis depois de erro/reinício local e só são limpos automaticamente quando a tarefa chega a `Ready`.

## Validação automatizada sem Xbox físico

Falhas de espaço, permissão, volume somente leitura, CRC ou dispositivo ausente em qualquer fase local são classificadas como armazenamento local. O Companion não troca de provedor nem apaga a fonte por causa delas. Os marcadores de retomada, conclusão e fase são sincronizados antes da publicação atômica.

Os testes de backend validam o comportamento no sistema de arquivos:

- arquivo já completo conserva a data de modificação, provando que não foi regravado;
- arquivo truncado e `.xbox-companion-part` inválido são reparados e verificados;
- troca de dispositivo sob a mesma letra/caminho é rejeitada;
- espera termina somente quando o marcador do dispositivo original reaparece;
- download concluído e íntegro não gera nova requisição HTTP;
- cache alterado, mesmo com o mesmo tamanho, falha no SHA-256 e é baixado novamente.
- download simples interrompido envia `Range` a partir do offset persistido;
- download paralelo não solicita segmentos íntegros e baixa novamente um segmento cujo hash mudou;
- extração interrompida conserva arquivos já confirmados e substitui o `.part` inválido;
- checkpoint de extração/conversão é reutilizado somente enquanto todos os arquivos e a fonte conferirem.
- arquivo extraído corrompido com o mesmo tamanho é rejeitado por CRC32 e reparado;
- arquivo HTTP integral deixado entre sincronização e checkpoint é promovido sem acesso à rede;
- falha de armazenamento em qualquer fase local bloqueia o fallback e preserva a fonte.

Comandos de validação:

```powershell
$env:GOMAXPROCS='2'
go test ./... -count=1
npm run build:server
npm run tsc --prefix src/electron-app
```

O limite desta validação é o comportamento do hardware/controlador USB e do FAT32 durante remoção elétrica real. A estrutura, integridade e retomada dos arquivos podem ser simuladas e verificadas sem console; a inicialização no Xbox continua coberta pelo checklist físico descrito em `READY-TO-PLAY-AURORA.md`.
