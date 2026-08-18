# Fluxo BadAvatar USB pronto para conectar e jogar

## Objetivo

O pendrive preparado pelo Xbox 360 Companion deve chegar ao cliente com três etapas já resolvidas:

1. o BadAvatar ativa o ambiente necessário sem gravar a NAND;
2. o DashLaunch em memória abre `Usb:\Aurora\default.xex` depois que o usuário entra no perfil;
3. o Aurora cadastra e lê automaticamente os jogos gravados pelo Companion em `\games` e `\Content\0000000000000000`.

O usuário não deve precisar localizar `default.xex`, cadastrar caminhos em **Content > Scan Paths** nem iniciar uma varredura manual.

## Sintomas que motivaram a correção

- o exploit terminava, mas o Aurora não abria automaticamente;
- ao abrir `Aurora\default.xex` manualmente, os jogos copiados pelo Companion não apareciam;
- executar novamente a preparação podia informar sucesso sem restaurar um `launch.ini` ou arquivo de configuração apagado.

## Causas encontradas

### Inicialização

O pacote precisava de um `launch.ini` canônico na raiz do dispositivo, com o destino `Usb:\Aurora\default.xex`. A preparação agora sempre gera esse arquivo tanto no modo BadAvatar/LT quanto no modo somente RGH.

### Biblioteca vazia

Copiar jogos para o dispositivo não cria por si só as entradas em `ScanPaths` no banco do Aurora. Os dois formatos usados pelo Companion precisam ser cadastrados com o identificador físico do dispositivo:

| Caminho no Aurora | Profundidade | Conteúdo esperado |
|---|---:|---|
| `\games` | 6 | jogos extraídos/XEX |
| `\Content\0000000000000000` | 5 | jogos GOD e conteúdo Xbox 360 |

### Hook de boot incorreto

A primeira implementação gerava `Aurora\User\Scripts\Main.lua`, mas os logs do pacote não demonstram que esse arquivo seja executado no boot. Os mesmos logs demonstram a carga automática dos arquivos em `Aurora\User\Scripts\Content\Filters`. Por isso, a automação final usa um arquivo isolado nesse diretório e preserva o `Main.lua` original do pacote.

### Seleção ambígua do dispositivo

Procurar apenas o primeiro drive com `Aurora\default.xex` poderia selecionar um HD interno ou outro USB. O hook agora exige o marcador exclusivo do Companion e correlaciona o serial do mount `Game:` com o serial do dispositivo físico. Se o mapeamento não estiver disponível, só aceita um único candidato marcado; com mais de um candidato, não altera o banco.

### Transação concluída sem reparo

O escritor transacional reutilizava imediatamente um diário em estado `completed`. Assim, um arquivo removido depois da primeira preparação não era recriado. Agora todas as entradas do plano concluído são verificadas por tamanho e SHA-256. Se qualquer uma não conferir, somente os três arquivos de diário daquela transação são reinicializados e o plano é executado novamente, reutilizando os arquivos íntegros e reparando os ausentes ou alterados.

## Arquivos gerados no pendrive

- `launch.ini`: configura o Aurora como dashboard padrão do ambiente em memória;
- `.xbox-downloader\ready-to-play-v2.marker`: identifica inequivocamente um dispositivo preparado por esta versão;
- `Aurora\User\Scripts\Content\Filters\XboxCompanionReady.lua`: configura os caminhos de conteúdo durante o boot do Aurora;
- `.xbox-downloader\transactions\...`: diários de gravação retomável e verificável.

Os arquivos originais do payload e os jogos continuam sendo gravados pelo mesmo plano transacional. O staging usa hard links no PC quando o sistema de arquivos permite e recorre à cópia normal quando necessário.

## Sequência no console

1. O console lê o `launch.ini` da raiz e abre `Usb:\Aurora\default.xex`.
2. Durante a carga de Content Filters, o Aurora executa `XboxCompanionReady.lua`.
3. O hook encontra o marcador, identifica o serial físico correspondente ao mount `Game:` e consulta `scanpaths`.
4. Se necessário, insere os dois caminhos sem substituir caminhos iguais pertencentes a outros dispositivos.
5. Quando o banco muda, o hook reinicia o Aurora uma única vez.
6. Na segunda inicialização, os caminhos já existem antes de o Content Manager carregar a biblioteca; nenhuma nova reinicialização é solicitada.

O hook não depende de `Content.StartScan()`, pois esse método não faz parte da API documentada usada como referência. A descoberta fica a cargo do fluxo normal de inicialização do Content Manager com os caminhos já persistidos.

## Orientação para um pendrive já preparado

Para atualizar um dispositivo criado por uma versão anterior:

1. conecte o mesmo pendrive ao PC;
2. abra a ferramenta BadAvatar USB do Xbox 360 Companion atualizado;
3. selecione o dispositivo conferindo capacidade e identificação;
4. deixe **Formatar antes** desmarcado para preservar os jogos;
5. execute **Preparar** novamente e aguarde a verificação terminar;
6. ejete com segurança, conecte ao Xbox 360, execute o BadAvatar e entre no perfil.

A nova transação tem escopo de configuração `ready-to-play-v2`, portanto os arquivos de automação são instalados mesmo que uma preparação antiga esteja marcada como concluída. Nas execuções seguintes, qualquer arquivo ausente ou corrompido é reparado.

## Validação automatizada

A implementação possui testes para:

- conteúdo canônico do `launch.ini`;
- local e conteúdo do hook carregável pelo Aurora;
- presença e versão do marcador;
- correlação com o mount `Game:` e ausência de `Usb0:`, `Usb1:` ou outro índice fixo;
- cadastro dos dois scan paths e reinicialização somente após mudança;
- ausência da chamada não documentada `Content.StartScan()`;
- restauração de arquivo removido após uma transação concluída;
- retomada segura nos pontos de interrupção já cobertos pelo escritor transacional;
- sintaxe Lua 5.1 do arquivo gerado;
- compilação TypeScript, renderer e backend Go.

## Validação física obrigatória antes da publicação

O teste automatizado não substitui o ensaio em um Xbox 360 compatível. Em hardware de laboratório:

1. use FAT32 e firmware/kernel compatíveis com o pacote BadAvatar;
2. grave ao menos um jogo XEX em `\games` e um GOD em `\Content\0000000000000000`;
3. confirme que o login no perfil abre o Aurora sem seleção manual de XEX;
4. aceite a reinicialização única do Aurora no primeiro boot preparado;
5. confirme os dois caminhos em **Content > Scan Paths** e a presença dos jogos;
6. reinicie novamente e confirme que não ocorre loop de reinicialização;
7. consulte `Aurora\Data\Logs\debug.log` e procure por `Load Success: XboxCompanionReady.lua` e por uma das mensagens `Xbox 360 Companion:`;
8. teste com outro USB ou Aurora interno conectado para confirmar que nenhum scan path alheio é alterado;
9. apague apenas `launch.ini`, execute a preparação sem formatar e confirme que ele é restaurado sem remover os jogos.

O fluxo só deve ser anunciado como validado em hardware depois que esses itens forem registrados. A implementação não grava NAND e não elimina as exigências próprias do exploit, da atualização de avatar e da compatibilidade do console.

## Evidências técnicas consultadas

- `src/electron-app/assets/badavatar-1.1/Aurora/Data/Logs/debug.log`: comprova a montagem física `Usb0:`, o mount de execução `Game:` com o mesmo serial prefixado por `_`, a carga automática de **User Filters** e a inicialização posterior do Content Manager;
- [XboxUnity/AuroraScripts — referência da API](https://github.com/XboxUnity/AuroraScripts): documenta `Aurora.Restart()`, `FileSystem.GetDrives(false)`, `FileSystem.FileExists()`, `Sql.Execute()` e `Sql.ExecuteFetchRows()`;
- [XboxUnity/AuroraScripts — FixClonedDrive](https://github.com/XboxUnity/AuroraScripts/blob/master/UtilityScripts/FixClonedDrive/Main.lua): implementação oficial/comunitária que lê `Id`, `Path` e `DeviceId` de `scanpaths`, usa o serial retornado por `FileSystem.GetDrives(false)` e reinicia o Aurora depois de alterar o banco;
- [XboxUnity/AuroraScripts — filtros](https://github.com/XboxUnity/AuroraScripts/tree/master/Filters): estrutura de scripts de filtro carregada pelo Aurora.
