# Montagem da imagem limpa

## Objetivo

O montador combina somente componentes previamente autenticados pelo manifesto e extraídos no staging seguro. Ele não grava USB. A saída é outro diretório de staging que pode ser transformado em plano transacional.

## Papéis obrigatórios

Cada manifesto precisa identificar exatamente um componente para cada papel:

- `badavatar-entry`;
- `xeunshackle-autostart`;
- `dashboard-aurora`.

Pode existir no máximo um `xexmenu`. IDs, versões, papéis e hashes dos componentes precisam coincidir com o manifesto confiável.

## Arquivos obrigatórios

Após a combinação, a imagem precisa conter:

```text
BadUpdatePayload/default.xex
BadUpdatePayload/XeUnshackleAutoStart.txt
Aurora/default.xex
Content/<perfil de entrada>
launch.ini
.xbox-downloader/manifest.json
```

O AutoStart fica em `BadUpdatePayload` porque a implementação do PR 54 lê `GAME:\XeUnshackleAutoStart.txt`, e `GAME:` é o diretório do executável do XeUnshackle. O valor padrão é `2.00`, seguindo o temporizador padrão implementado pelo autor e preservando uma pequena janela para cancelar com B. Valores inferiores a 1 ou superiores a 10 segundos são recusados.

Referência primária: <https://github.com/Byrom90/XeUnshackle/pull/54>

## launch.ini gerado

```ini
[Paths]
Default = Usb:\Aurora\default.xex

[Settings]
noupdater = true
liveblock = true
livestrong = false
```

O arquivo é ASCII sem BOM e usa CRLF. O validador aceita somente essa representação canônica. Não existe seção de plugins.

A sintaxe, o caminho `Usb:\`, a seção `[Paths]` e os padrões das opções foram confirmados no arquivo de referência do DashLaunch 3.21:

<https://github.com/XeFreedom/DashLaunch/blob/main/ReadMe/info_launch.ini>

`liveblock = true` bloqueia domínios LIVE. `livestrong = false` evita o bloqueio amplo de todos os domínios Microsoft, que também poderia impedir recursos como capas. `noupdater = true` mantém o bloqueador de atualização ativo.

Como `Usb:` representa uma classe de dispositivo, o procedimento de uso deverá instruir o usuário a deixar somente o dispositivo preparado conectado durante a ativação inicial.

## Arquivos recusados

Componentes não podem fornecer ou substituir:

- `launch.ini`;
- `XeUnshackleAutoStart.txt`;
- metadados `.xbox-downloader`;
- `OriginalMACAddress.bin`;
- `KV.bin`;
- `updflash.bin`;
- `nanddump.bin`;
- `flashdmp.bin`.

Colisões entre componentes também são recusadas sem diferenciar maiúsculas e minúsculas.

## Manifesto da imagem

O montador cria `.xbox-downloader/manifest.json` contendo origem, caminho, tamanho e SHA-256 de cada arquivo, além da versão do manifesto confiável e do tempo de AutoStart. O próprio manifesto da imagem recebe tamanho e SHA-256 quando é entregue ao planejador transacional.

