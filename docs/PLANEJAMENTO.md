# Downloader Xbox 360 — planejamento de produto e implementação

> Estado detalhado e backlog atualizado: `docs/IMPLEMENTACAO-E-PENDENCIAS.md`.

## 1. Objetivo

Criar uma ferramenta Windows extremamente simples e conservadora para preparar um pendrive ou HD USB destinado a um Xbox 360 compatível com BadAvatar/BadUpdate. O aplicativo deverá:

- identificar com segurança o dispositivo removível;
- preparar uma instalação limpa de BadAvatar, XeUnshackle AutoStart e Aurora;
- configurar o Aurora como dashboard inicial da sessão explorada;
- importar jogos fornecidos legalmente pelo usuário;
- converter imagens Xbox 360 para GOD quando aplicável;
- instalar jogos na estrutura reconhecida automaticamente pelo Aurora;
- verificar integralmente o resultado antes de declarar o dispositivo pronto.

O programa não gravará NAND, não instalará DashLaunch na NAND, não modificará o HD interno do console e não deverá exigir FTP ou configuração prévia do Aurora no fluxo principal.

## 2. Base tecnológica

O projeto parte do GODSend-360, revisão upstream `b550b86e60430f32fd8b1dc3e34c3e0d7aa40c7a`, licenciado sob MIT.

Componentes inicialmente reaproveitados:

- Electron, React e TypeScript para a aplicação desktop;
- backend Go;
- leitura de metadados Xbox 360;
- conversão ISO para GOD;
- filas, progresso e armazenamento temporário;
- partes não destrutivas do catálogo e das ferramentas locais.

Componentes que não serão considerados seguros sem revisão ou substituição:

- aquisição e extração dos pacotes BadStick;
- seleção e formatação atual de volumes;
- download de executáveis sem hash fixado;
- gravação direta no dispositivo sem transação;
- backend exposto à LAN sem autenticação;
- distribuição sem assinatura de código.

## 3. Experiência do usuário

O modo padrão terá três tarefas:

1. **Preparar dispositivo** — instala o ambiente limpo e opcionalmente formata o dispositivo.
2. **Adicionar jogos** — importa arquivos locais autorizados e grava em GOD.
3. **Verificar ou reparar** — compara o conteúdo com o manifesto e corrige arquivos ausentes ou corrompidos.

Recursos herdados como FTP, saves, DLC, Title Updates, BitTorrent e edição de assets ficarão ocultos no modo simples. Um modo avançado poderá ser mantido separadamente depois de uma revisão de segurança.

## 4. Estrutura pretendida no dispositivo

```text
\
├── BadUpdatePayload\
├── Aurora\
├── Content\
│   └── 0000000000000000\
│       ├── <perfil de entrada>
│       └── <TitleID>\00007000\<conteúdo GOD>
├── launch.ini
└── .xbox-downloader\
    ├── manifest.json
    └── transaction.json
```

Configuração-base pretendida:

```ini
[Paths]
Default = Usb:\Aurora\default.xex

[Settings]
noupdater = true
liveblock = true
livestrong = false
```

O arquivo final será produzido a partir de um modelo versionado e validado. Não serão adicionados plugins de rede, Proto, Freestyle, instalador do DashLaunch, arquivos de MAC, caches ou logs de terceiros no modo simples.

## 5. Modelo de segurança

### 5.1 Seleção do dispositivo

Uma letra de unidade nunca será identidade suficiente. O aplicativo manterá uma impressão digital contendo, quando disponível:

- número e identificador único do disco;
- número da partição;
- número de série;
- fabricante e modelo;
- barramento;
- capacidade física.

Antes de uma ação destrutiva, o dispositivo será enumerado novamente. A operação será recusada se a impressão digital tiver mudado.

Serão recusados automaticamente:

- discos de boot ou sistema;
- o volume do Windows;
- discos internos ou cujo barramento não seja USB;
- discos offline ou somente leitura;
- dispositivos cuja identidade seja insuficiente;
- discos físicos sem uma única correspondência inequívoca;
- alvos informados manualmente que não estejam na enumeração segura.

### 5.2 Escrita transacional

Downloads e extrações ocorrerão primeiro em uma área temporária no computador. A gravação seguirá as fases:

1. obter manifesto versionado;
2. baixar para staging;
3. validar tamanho, SHA-256, formato e limites de extração;
4. validar a estrutura Xbox 360;
5. criar diário da transação no dispositivo;
6. copiar usando nomes temporários;
7. verificar por leitura e hash;
8. promover atomicamente quando possível;
9. gravar manifesto final;
10. somente então informar sucesso.

Interrupções deverão ser retomáveis. Arquivos existentes não serão removidos antes de existir uma cópia válida e verificável para substituí-los.

### 5.3 Cadeia de fornecimento

- todo componente distribuído terá origem, licença, versão, tamanho e SHA-256 registrados;
- nenhum executável será baixado durante o build por HTTP sem TLS;
- não será aceito apenas o cabeçalho ZIP como prova de integridade;
- arquivos ZIP terão proteção contra path traversal, links, arquivos especiais e expansão excessiva;
- releases públicas deverão ser reproduzíveis e assinadas;
- a integração de artefatos BadStick depende de autorização explícita; a preferência é compor a imagem a partir dos upstreams oficiais autorizados.

### 5.4 Limites que serão comunicados

O aplicativo não poderá garantir que o exploit funcione em qualquer Xbox 360. O fluxo depende de uma versão de dashboard e dos dados de avatar compatíveis, deve ser executado offline e pode precisar de nova tentativa devido à natureza do exploit. “Dispositivo pronto” significará que os arquivos foram preparados e verificados, não que o console foi permanentemente modificado.

## 6. Arquitetura proposta

```text
Interface simples (Electron/React)
              │
              ▼
Orquestrador de preparação
   ├── política de dispositivo seguro
   ├── catálogo de componentes confiáveis
   ├── staging e verificação
   ├── escritor transacional
   └── relatório/manifesto
              │
              ▼
Conversores e validadores Go
   ├── ISO → GOD
   ├── inspeção XDVDFS/STFS
   └── cálculo/verificação de hashes
```

O backend local do modo simples deverá escutar apenas em `127.0.0.1`. Recursos que realmente precisem atender scripts do Xbox terão processo e consentimento separados.

## 7. Fases

### Fase 0 — base e governança

- importar o histórico upstream e registrar a revisão-base;
- preservar MIT, créditos e avisos;
- inventariar dependências e licenças;
- definir nomenclatura e política de distribuição.

### Fase 1 — barreira de segurança do dispositivo

- modelo de identidade física;
- enumeração segura no Windows;
- classificação bloqueado/permitido;
- impressão digital e revalidação;
- testes unitários para todos os motivos de bloqueio;
- nenhuma formatação habilitada antes desses testes.

### Fase 2 — catálogo de componentes

- manifesto local assinado ou incorporado;
- aquisição apenas por HTTPS;
- hashes fixados;
- staging e extrator seguro;
- inventário de licenças e procedência.

### Fase 3 — escritor transacional

- plano de operações imutável;
- diário e retomada;
- cópia temporária e promoção;
- verificação por leitura;
- reparo idempotente.

O ensaio que combina extração segura, imagem limpa, plano e capacidade foi implementado em modo somente leitura. Seu contrato e limites estão em `docs/PREVIA-DE-PREPARACAO.md`; isso não habilita o escritor físico.

### Fase 4 — imagem limpa Xbox 360

- ABadAvatar verificado;
- XeUnshackle com AutoStart autorizado;
- Aurora limpo;
- `launch.ini` gerado;
- validação estrutural completa;
- testes reais sem qualquer operação de NAND.

### Fase 5 — jogos

- importação de ISO local;
- ISO para GOD;
- instalação em `Content\0000000000000000`;
- detecção de espaço e limite FAT32;
- multidisco e atualização/reparo;
- conteúdo somente de fontes autorizadas.

### Fase 6 — produto público

- modo simples em português;
- mensagens sem jargão;
- acessibilidade;
- logs com dados sensíveis removidos;
- testes em diferentes controladoras USB, capacidades e consoles;
- instalador e binários assinados;
- atualização assinada com possibilidade de rollback.

## 8. Critérios mínimos para liberar formatação

A opção de formatação permanecerá desabilitada até que todos sejam atendidos:

- enumeração por disco físico implementada e testada;
- bloqueio de boot, sistema e disco interno;
- revalidação imediatamente antes da ação;
- ferramenta FAT32 auditada e com hash fixado;
- confirmação que mostre modelo, serial e capacidade;
- teste de desconexão/troca do dispositivo;
- testes com falha de energia ou remoção durante cada fase;
- recuperação documentada e testada.

## 9. Estimativa inicial

- protótipo supervisionado: 4 a 6 semanas;
- beta pública conservadora: 10 a 16 semanas;
- o cronograma depende principalmente da autorização e procedência dos payloads, assinatura de binários e testes em hardware real.

## 10. Definição de pronto da primeira entrega

A primeira entrega não formata nem instala payloads. Ela estará pronta quando:

- o projeto compilar a partir da revisão registrada;
- o Windows listar somente dispositivos USB com identidade física;
- cada dispositivo receber uma avaliação explícita;
- qualquer disco de sistema, interno, ambíguo ou trocado for bloqueado;
- testes automatizados cobrirem a política;
- a interface mostrar a identidade e o motivo de bloqueio sem permitir prosseguir.
