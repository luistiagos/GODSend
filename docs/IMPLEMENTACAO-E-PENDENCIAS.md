# Implementação atual e pendências

Atualizado em 2026-06-25.

Este é o documento mestre do estado do projeto `Downloader-XBOX360-XEX-HDD-Games`. Ele separa o que existe no código, o que está apenas parcialmente integrado e o que ainda precisa ser validado antes de oferecer preparação de pendrive/HD ao público.

## 1. Resumo executivo

O projeto usa o GODSend-360 como base para reaproveitar interface Electron, backend Go, conversão de jogos, FTP e recursos Aurora. Sobre essa base foi construída uma fundação de segurança específica para o futuro preparador ABadAvatar/Aurora.

> Atualização de 2026-06-25: a versão local BadAvatar 1.1 + AutoStart + Aurora + Freestyle + DashLaunch + XexMenu foi incorporada, catalogada por SHA-256 e ligada ao escritor físico transacional. Consulte `docs/STATUS.md` para o resumo operacional e os ensaios de hardware ainda pendentes.

Hoje o projeto consegue, em validação automatizada e build local:

- identificar e classificar dispositivos USB físicos no Windows;
- verificar um manifesto Ed25519 e componentes com tamanho/SHA-256 fixados;
- baixar componentes para staging seguro;
- inspecionar e extrair ZIPs sem escrever no dispositivo;
- montar uma imagem limpa de ABadAvatar + XeUnshackle + Aurora;
- gerar `launch.ini`, AutoStart e manifesto da imagem;
- construir um plano de escrita imutável;
- calcular capacidade e inventariar o destino somente por leitura;
- simular gravação transacional e retomada após interrupções;
- produzir uma prévia completa sem alterar o destino;
- validar o pacote fixo incorporado por catálogo SHA-256;
- preparar fisicamente um dispositivo USB seguro no Windows com FAT32 opcional, revalidação, diário transacional, backup e verificação pós-cópia.

O projeto ainda precisa de QA destrutivo em pendrive/HD descartável e validação em Xbox 360 de laboratório antes de qualquer distribuição pública ampla. O fluxo de manifesto remoto assinado continua disponível como infraestrutura, mas a rota principal atual usa o pacote fixo incorporado e catalogado localmente.

Ainda não foi validado em hardware de laboratório:

- fluxo completo com e sem formatação FAT32 em mídia descartável;
- remoção física do USB durante a cópia e retomada no mesmo dispositivo;
- inicialização de BadAvatar, AutoStart, Aurora, Freestyle, DashLaunch e XexMenu no console;
- instalação de DashLaunch no console;
- gravar NAND modificada;
- alterar KV, MAC ou NAND;
- incluir ou distribuir jogos comerciais sem autorização;
- afirmar que o exploit funcionará em qualquer console.

## 2. Legenda de estado

| Estado | Significado |
|---|---|
| Concluído | Implementado e coberto por validação automatizada proporcional ao risco atual. |
| Parcial | Existe código ou desenho, mas falta integração, autorização, hardware real ou cobertura necessária. |
| Bloqueado | Mantido deliberadamente inacessível por segurança. |
| Pendente | Ainda não implementado. |
| Herdado | Veio do GODSend-360 e foi preservado; não significa que todo o recurso foi requalificado neste ciclo. |

## 3. Decisões de arquitetura já tomadas

### 3.1 Base do produto

- GODSend-360 foi adotado como base técnica.
- O remoto `upstream` e a revisão importada estão registrados em `docs/UPSTREAM.md`.
- A interface continua Electron/React/Vite e o backend continua Go.
- O backend escuta em `127.0.0.1` por padrão. Exposição em rede exige host explícito.

### 3.2 Método de entrada no console

- O fluxo planejado usa ABadAvatar como entrada simples para o usuário.
- XeUnshackle fornece o payload e o AutoStart.
- Aurora é o dashboard principal da imagem.
- XeXMenu pode existir como componente opcional de suporte.
- Proto e Freestyle não são opções pré-selecionadas no fluxo novo.
- O exploit é temporário e precisa ser executado novamente após reiniciar/desligar.
- Não haverá instalação de DashLaunch na NAND. O `launch.ini` é preparado no dispositivo e o DashLaunch é carregado em memória pelo fluxo do payload.

Referências técnicas primárias:

- [ABadAvatar](https://github.com/shutterbug2000/ABadAvatar)
- [Xbox360BadUpdate](https://github.com/grimdoomer/Xbox360BadUpdate)
- [XeUnshackle AutoStart — PR 54](https://github.com/Byrom90/XeUnshackle/pull/54)
- [Sintaxe do DashLaunch](https://github.com/XeFreedom/DashLaunch/blob/main/ReadMe/info_launch.ini)

### 3.3 Segurança do conteúdo

- Nenhum download poderá ser confiado somente por URL ou nome de arquivo.
- Componentes precisam estar em manifesto assinado, com versão, licença, autorização de redistribuição, tamanho, SHA-256 e limites de extração.
- Downloads e extrações acontecem primeiro no computador.
- A imagem final é construída do zero; pacotes não podem fornecer configurações reservadas.
- O dispositivo somente poderá receber arquivos descritos em um plano verificável.

### 3.4 Jogos e direitos de distribuição

- O produto pode importar e converter arquivos locais que o usuário esteja autorizado a usar.
- Qualquer catálogo de download precisa de procedência e autorização documentadas.
- O aplicativo não deve incorporar ROMs, ISOs, DLCs ou credenciais de terceiros sem licença.
- Os recursos herdados de Minerva/Internet Archive precisam de revisão jurídica e de política antes de integrarem a experiência pública do novo preparador.

### 3.5 Análises de métodos e pacotes já realizadas

As avaliações exploratórias orientaram a arquitetura, mas nenhum pacote analisado foi automaticamente promovido a componente confiável:

- **GODSend-360:** considerado uma base viável por já possuir Electron, backend Go, conversores, filas, FTP e integração Aurora. Foi importado e mantido com remoto upstream. O preparador físico herdado, porém, não atende aos requisitos novos de integridade/transação e permanece bloqueado.
- **BadStick:** útil como referência de empacotamento e reúne payloads prontos, mas o fluxo herdado usa URLs/pacotes sem manifesto assinado e extração direta no destino. Portanto, BadStick não é raiz de confiança e seus artefatos somente poderão ser usados após autorização, inventário, hash e licença.
- **BadUpdate/Rock Band:** mantido como referência técnica do exploit. Para o produto inicial, não foi escolhido como fluxo principal porque adiciona dependência de título/etapas específicas e piora a experiência pretendida para público totalmente leigo.
- **ABadAvatar:** escolhido como candidato de entrada por permitir um fluxo guiado baseado nos dados de Avatar/perfil. Continua sujeito aos requisitos de dashboard 17559, dados oficiais de Avatar, console offline e proibição de entrar no perfil do exploit.
- **Pacote local `AbadAvatar 1.1 + AutoStart + Aurora + Freestyle + DashLauch + Xexmenu`:** analisado como protótipo/conveniência, não como fonte de produção. A presença conjunta de executáveis e instalador DashLaunch exige separar componentes, comprovar procedência/licença e recusar qualquer ação de NAND. Nada desse pacote deve ser copiado para uma release apenas por estar disponível localmente.
- **XeUnshackle:** adotado no desenho para carregar o ambiente em memória e fornecer AutoStart. Isso elimina a necessidade de instalar DashLaunch ou gravar NAND para o fluxo planejado.
- **Projeto local de desbloqueio/Xploit:** a análise estabeleceu a regra de nunca tratar uma NAND de RGH/JTAG como compatível com console retail. Instaladores de DashLaunch e imagens NAND não fazem parte do preparador.

Conclusão dessas análises: a facilidade de um pacote pronto não substitui procedência, assinatura, licença e montagem limpa. O produto construirá sua própria imagem a partir de componentes individualmente autorizados.

## 4. Recursos herdados do GODSend-360

Estes recursos permanecem no repositório e formam a base reaproveitável. Eles são descritos detalhadamente em `docs/features.md`:

- aplicativo desktop Electron e backend Go;
- biblioteca Minerva e fallback Internet Archive;
- importação de ISOs da pasta `Transfer`;
- conversão local ISO para GOD e ISO para XEX;
- instalação via FTP para Aurora;
- gerenciador FTP;
- biblioteca do console Aurora e cache de capas;
- editor de assets Aurora/RXEA;
- gerenciamento de DLC e Title Updates;
- gerenciamento e backup de saves/perfis;
- suporte multidisco;
- fila de downloads/processamento;
- bibliotecas de ROMs e caminhos RetroArch;
- configuração de armazenamento e logs persistentes;
- scripts Aurora e implantação por FTP.

Estado: **herdado**. Eles compilam e continuam presentes, mas não foram todos submetidos ao mesmo processo de segurança do preparador físico. A integração deles ao modo simples será feita por etapas.

## 5. Implementação concluída nesta iniciativa

### 5.1 Governança e planejamento

Estado: **concluído para a fase de fundação**.

- planejamento geral e fases documentados;
- revisão-base upstream registrada;
- separação explícita entre código herdado e fluxo seguro novo;
- critérios que impedem liberar formatação prematuramente;
- política de não gravar NAND/ KV/ MAC incorporada ao montador;
- documentos técnicos por subsistema criados em `docs/`.

### 5.2 Identidade e segurança do dispositivo Windows

Estado: **concluído para enumeração e bloqueio; escrita real pendente**.

Implementado em:

- `src/electron-app/infrastructure/deviceSafetyPolicy.ts`;
- `src/electron-app/infrastructure/windowsUsbDeviceService.ts`.

O Windows é consultado por disco e partição físicos. A interface recebe:

- letra/raiz da unidade;
- disco e partição;
- identificador único e serial;
- fabricante e modelo;
- barramento;
- capacidade física e da partição;
- filesystem, bytes livres e unidade de alocação;
- estado de boot, sistema, offline e somente leitura.

Bloqueios implementados:

- barramento diferente de USB;
- disco de boot ou sistema;
- volume do Windows em execução;
- disco físico zero;
- disco offline ou somente leitura;
- identidade sem `UniqueId` e sem serial;
- capacidade inválida ou inferior a 1 GiB;
- quantidade de partições montadas diferente de uma.

A seleção recebe uma impressão digital SHA-256. Antes de uma operação, o serviço enumera novamente o dispositivo e recusa troca, remoção, mudança de identidade ou mudança para estado inseguro.

### 5.3 Manifesto confiável e chaveiro

Estado: **validador concluído como infraestrutura de catálogo remoto; a rota fixa atual não depende dele**.

Implementado em:

- `src/electron-app/infrastructure/trustedComponentManifest.ts`;
- `src/electron-app/infrastructure/trustedManifestKeyring.ts`;
- `src/electron-app/services/preparationReadinessService.ts`.

Regras implementadas:

- envelope e esquema JSON fechados;
- assinatura Ed25519;
- chave pública identificada por `keyId`;
- datas de criação/expiração;
- papéis funcionais fechados;
- HTTPS obrigatório;
- hosts de redirecionamento explicitamente assinados;
- tamanho máximo e SHA-256;
- limites de quantidade de entradas e expansão;
- licença SPDX, projeto, atribuição e autorização de redistribuição;
- rejeição de campos desconhecidos, IDs duplicados e caminhos inseguros.

O chaveiro `PRODUCTION_TRUSTED_MANIFEST_KEYS` está vazio de propósito enquanto não houver catálogo remoto aprovado. Nenhuma chave privada pertence ao repositório ou ao aplicativo.

### 5.4 Download e staging de componentes

Estado: **concluído como infraestrutura; não ligado ao catálogo de produção**.

Implementado em `src/electron-app/infrastructure/secureComponentStaging.ts`.

- download HTTPS com timeout;
- redirecionamento limitado a hosts assinados;
- limite de bytes durante streaming;
- conferência de `Content-Length`, quando informado;
- arquivo parcial exclusivo;
- sincronização antes da promoção;
- validação de tamanho e SHA-256;
- cache somente reutilizado após nova verificação;
- remoção do parcial em falha.

### 5.5 Extração ZIP segura

Estado: **concluído**.

Implementado em `src/electron-app/infrastructure/secureZipExtractor.ts`.

O extrator valida o ZIP completo antes da criação de arquivos e bloqueia traversal, links, tipos especiais, nomes reservados, colisões, entradas criptografadas, métodos inesperados, excesso de entradas, expansão excessiva e taxas de compressão suspeitas. A extração usa pasta parcial e promoção sem sobrescrita.

### 5.6 Montagem da imagem limpa

Estado: **concluído com componentes de teste; componentes reais pendentes**.

Implementado em `src/electron-app/infrastructure/cleanDeviceImage.ts`.

Papéis obrigatórios:

- `badavatar-entry`;
- `xeunshackle-autostart`;
- `dashboard-aurora`.

Saída mínima validada:

```text
BadUpdatePayload/default.xex
BadUpdatePayload/XeUnshackleAutoStart.txt
Aurora/default.xex
Content/<perfil de entrada>
launch.ini
.xbox-downloader/manifest.json
```

O montador:

- confirma vínculo do componente ao manifesto;
- recusa componentes obrigatórios ausentes ou duplicados;
- revalida tamanho e SHA-256 de cada origem;
- recusa colisões sem diferenciar maiúsculas;
- gera AutoStart padrão `2.00`, limitado a 1–10 segundos;
- gera `launch.ini` canônico em ASCII/CRLF;
- gera manifesto da imagem com origem, tamanho e SHA-256;
- nunca sobrescreve imagem existente.

Arquivos reservados ou sensíveis recusados:

- `launch.ini` fornecido por componente;
- `XeUnshackleAutoStart.txt` fornecido por componente;
- `.xbox-downloader/*` fornecido por componente;
- `OriginalMACAddress.bin`;
- `KV.bin`;
- `updflash.bin`;
- `nanddump.bin`;
- `flashdmp.bin`.

Configuração gerada:

```ini
[Paths]
Default = Usb:\Aurora\default.xex

[Settings]
noupdater = true
liveblock = true
livestrong = false
```

### 5.7 Plano e diário transacional

Estado: **planejador/diário concluídos; executor físico pendente**.

Implementado em:

- `src/electron-app/infrastructure/transactionalWritePlan.ts`;
- `src/electron-app/infrastructure/transactionJournal.ts`.

O plano:

- aceita somente origens dentro do staging real;
- recusa links simbólicos;
- revalida tamanho e SHA-256;
- aplica limite individual FAT32;
- limita destinos a `Aurora`, `BadUpdatePayload`, `Content`, `launch.ini` e `.xbox-downloader`;
- recusa nomes reservados/traversal/colisões;
- ordena entradas;
- gera identificadores de entrada e hash canônico do plano;
- é congelado em memória.

O diário:

- possui estados monotônicos da transação e arquivos;
- usa checksum para detectar alteração/corrupção;
- grava arquivo temporário e promove atomicamente;
- mantém a versão anterior recuperável;
- recusa concluir enquanto houver arquivo não confirmado.

### 5.8 Executor transacional

Estado: **integrado ao USB físico revalidado e coberto por simulação marcada**.

Implementado em `src/electron-app/infrastructure/simulatedTransactionalWriter.ts`.

O executor exige revalidação explícita do destino e, nos testes, só aceita raiz marcada como simulação quando roda sem dispositivo físico. No fluxo atual ele é chamado pelo preparador fixo com USB revalidado. Já cobre:

- staging no destino simulado;
- releitura e verificação;
- reutilização de arquivo idêntico;
- backup de arquivo diferente;
- promoção após verificação;
- retomada após falha;
- revalidação antes de mutações;
- limpeza de backup após conclusão.

Pontos de interrupção testados:

- após criação do diário;
- após staging de entrada;
- após criação do backup;
- após promoção do novo arquivo;
- após confirmação de entrada;
- após marcação da transação como concluída.

### 5.9 Capacidade FAT32 e inventário somente leitura

Estado: **concluído**.

Implementado em `src/electron-app/infrastructure/writeCapacityPolicy.ts`.

- exige FAT32 e unidade de alocação válida;
- classifica destino como ausente, idêntico ou diferente;
- calcula clusters ocupados no pico;
- considera plano, diário, versão anterior e metadados;
- mantém reserva mínima igual ao maior entre 128 MiB e 2% da capacidade total;
- recusa falta de espaço antes da primeira escrita;
- reutiliza arquivo idêntico sem reservar nova cópia.

### 5.10 Prévia completa sem gravação

Estado: **integrado como infraestrutura de prévia remota; a preparação física atual usa o pacote fixo incorporado**.

Implementado em:

- `src/electron-app/infrastructure/preparationPreview.ts`;
- `src/electron-app/services/preparationPreviewService.ts`;
- `src/electron-app/ipc/badAvatarHandlers.ts`;
- `src/electron-app/preload.ts`.

A prévia encadeia:

1. revalidação estrutural do manifesto já autenticado;
2. seleção exata dos componentes;
3. extração ZIP ou staging de arquivo `raw` no PC;
4. construção da imagem limpa;
5. construção do plano transacional;
6. inventário somente leitura e cálculo de capacidade;
7. relatório `ready`/`blocked` com motivos.

Pré-requisitos explícitos do console:

- dashboard `17559`/`2.0.17559.0`;
- dados oficiais de Avatar instalados;
- Wi-Fi e Ethernet desconectados;
- reconhecimento de que o exploit não é persistente;
- reconhecimento de que o perfil do exploit nunca deve ser acessado, sobretudo na Xbox Live.

A sessão usa UUID, não sobrescreve sessões anteriores e é removida quando ocorre erro. Testes confirmam que nenhum arquivo do destino é alterado.

O serviço de aplicação agora:

- carrega o manifesto somente pelo processo principal;
- usa apenas URLs e arquivos definidos no manifesto assinado;
- revalida o USB antes e depois dos downloads;
- baixa/reutiliza componentes pelo staging seguro;
- usa uma chave de cache derivada de manifesto/release, sem colocar dados não validados em caminhos;
- envia progresso por IPC dedicado;
- permite cancelar a prévia e propaga o cancelamento ao download, hashing e pipeline de staging;
- remove arquivos parciais e uma sessão concluída no PC caso o cancelamento chegue durante a composição;
- retorna relatório público sem caminhos internos de staging;
- impede duas prévias simultâneas;
- mantém a prévia inacessível enquanto não houver chave e manifesto de produção.

### 5.11 Interface de segurança do preparador

Estado: **fluxo fixo e escrita física integrados; QA destrutivo em hardware pendente**.

Implementado em:

- `src/electron-app/ipc/badAvatarHandlers.ts`;
- `src/electron-app/renderer/components/BadAvatarUsbPage.tsx`;
- `src/electron-app/services/badAvatarUsbService.ts`.

A tela:

- lista o dispositivo físico;
- mostra modelo, serial, disco, filesystem, capacidade e espaço livre;
- mostra razões de bloqueio;
- seleciona preferencialmente um dispositivo permitido;
- carrega o diagnóstico do pacote fixo, do escritor e dos requisitos;
- apresenta checklist de dashboard, Avatar, rede, persistência e perfil;
- oferece verificação/prévia sem gravar e preparação física quando o dispositivo e as confirmações são válidos;
- mostra progresso e resumo de pacote, plano, arquivos e capacidade;
- bloqueia ações destrutivas quando o dispositivo é inseguro, o pacote falha, falta espaço ou as confirmações do console não foram aceitas;
- habilita a preparação física somente no Windows, com USB revalidado e destino FAT32 ou formatação marcada.

O gravador BadStick herdado não possui mais canal IPC/preload nem controle na interface. A superfície pública usa exclusivamente o novo fluxo fixo e transacional.

### 5.12 Segurança Electron e backend

Estado: **concluído para a fundação atual**.

Electron:

- atualizado para 42.4.1;
- Jimp antigo removido;
- `contextIsolation`, sandbox e `webSecurity` ativos;
- integração Node desativada no renderer;
- novas janelas, permissões e navegações externas negadas;
- CSP restritiva;
- DevTools somente em desenvolvimento.

Backend:

- listener padrão em `127.0.0.1`;
- host explícito validado para exposição voluntária;
- teste cobre loopback padrão e host inválido.

## 6. Validação automatizada atual

Última execução registrada em 2026-06-25:

| Validação | Resultado |
|---|---|
| `npm run test:safety` | 85 de 85 testes unitários aprovados. |
| `npm run test:electron-security` | Renderer build aprovado; Electron real abriu; preload disponível; `require` e `process` ausentes no renderer; prévia fixa renderizada; gravador legado ausente. |
| `npm audit --json` | Zero vulnerabilidades conhecidas. |
| `go test ./...` | Aprovado. |
| `go vet ./...` | Aprovado. |
| `git diff --check` | Sem erros de whitespace; apenas avisos de normalização de fim de linha quando aplicável. |

Distribuição dos 85 testes Electron:

| Subsistema | Testes |
|---|---:|
| Imagem limpa | 8 |
| Segurança do dispositivo | 8 |
| Navegação Electron | 3 |
| Prévia de preparação | 6 |
| Serviço/contrato público da prévia | 2 |
| Staging/download seguro | 9 |
| Extração ZIP | 6 |
| Pacote fixo | 3 |
| Executor transacional | 12, incluindo 4 casos gerados por ponto de falha |
| Plano transacional | 7 |
| Diário transacional | 7 |
| Manifesto confiável | 8 |
| Capacidade | 6 |

Além disso, existem 2 testes Go do listener local.

### 6.1 Estado do artefato de release

- o pacote fixo BadAvatar 1.1 está incorporado em `assets/badavatar-1.1/` e indexado por `assets/badavatar-package.json`;
- instalador NSIS x64 e executável portátil x64 2.12.24 foram produzidos e validados localmente;
- ainda falta assinatura de código e QA destrutivo em hardware;
- a implementação atual está no working tree sobre a revisão upstream `b550b86` e ainda precisa de revisão/commit de projeto antes de uma release pública.

## 7. Itens parciais ou deliberadamente bloqueados

| Área | Estado atual | O que falta |
|---|---|---|
| Chaveiro de produção | Infraestrutura mantida para catálogo remoto | Custódia, geração offline, backup, rotação, revogação e incorporação de chave pública se o fluxo remoto voltar a ser usado. |
| Manifesto remoto real | Não usado pela rota fixa atual | Versões, URLs oficiais, tamanhos, hashes, licenças e assinaturas aprovadas para qualquer download futuro. |
| Prévia na interface | Integrada ao pacote fixo | Refinar relatório, acessibilidade e casos de erro de hardware. |
| Download seguro no fluxo | Infraestrutura com cancelamento | Retry e testes de falhas HTTP ponta a ponta antes de reativar catálogo remoto. |
| Executor real | Integrado ao USB revalidado | Ensaios destrutivos em pendrive/HD descartável e validação de retomada após remoção física. |
| Formatação FAT32 | Integrada com UAC sob demanda | Testes destrutivos em mídia de laboratório e confirmação de comportamento em controladoras diferentes. |
| Configuração Aurora | Estrutura mínima pronta | Distribuição autorizada e settings/scan paths para funcionamento sem configuração manual no console. |
| Jogos no dispositivo | Recursos de conversão herdados | Novo planejador para instalar GOD/XEX/conteúdo no dispositivo local com segurança transacional. |
| Windows | Enumeração segura implementada | Testes em hardware/controladoras reais. |
| macOS/Linux | Detecção herdada, fluxo novo indisponível | Política física equivalente e testes específicos; não deve ser liberado por paridade presumida. |
| Instalador público | GODSend possui empacotamento | Nome/branding final, assinatura de código, atualização assinada e QA do novo fluxo. |

## 8. Pendências detalhadas

### 8.1 P0 — governança dos componentes

Para a rota fixa atual, o pacote BadAvatar 1.1 foi incorporado e catalogado por SHA-256. Para qualquer catálogo remoto futuro, ainda falta:

- escolher responsáveis pela assinatura;
- gerar chave Ed25519 privada offline;
- definir backup, recuperação, rotação e revogação;
- incorporar somente a chave pública ao aplicativo;
- localizar upstream oficial de cada componente;
- confirmar licença e autorização de redistribuição;
- fixar versão, URL, hosts de CDN, tamanho e SHA-256;
- criar e revisar o primeiro manifesto de produção;
- definir validade e procedimento de renovação;
- manter registro de atribuições/licenças entregue junto ao aplicativo;
- decidir se XeXMenu será distribuído ou solicitado ao usuário separadamente;
- decidir se algum artefato do BadStick pode ser legalmente redistribuído;
- revisar fontes de jogos e ROMs antes de expô-las no modo simples.

Critério de saída para catálogo remoto: manifesto assinado verificável em build de teste, sem chave privada no repositório/build e com revisão independente de licenças e hashes.

### 8.2 P1 — integrar a prévia ao aplicativo

Concluído nesta etapa:

- serviço orquestrador que carrega o envelope assinado no processo principal;
- download/reutilização de cada componente pelo staging seguro;
- IPC específico de prévia, separado do IPC destrutivo legado;
- progresso e erros sem expor caminhos internos;
- cancelamento que interrompe download/hash e limpa parciais;
- contrato do renderer limitado a identidade do USB e confirmações do console;
- checklist em português;
- relatório resumido da prévia;
- smoke test Electron confirmando preload isolado, prévia disponível na superfície de IPC e gravador legado ausente.

Ainda pendente:

- retry controlado de falhas transitórias de download;
- completar o wizard em português:
  1. requisitos do console;
  2. seleção do dispositivo;
  3. confirmação de componentes;
  4. download e verificação;
  5. prévia do plano e capacidade;
  6. resultado/diagnóstico;
- mostrar todos os componentes, tamanhos e licenças na interface;
- mostrar arquivos novos, idênticos e diferentes;
- permitir limpar sessões de staging antigas com segurança;
- adicionar testes de IPC para concorrência, erros de rede e troca de USB;
- testar novamente o fluxo remoto com um manifesto assinado de laboratório antes de reativar downloads de componentes.

Critério de saída para a rota remota: usuário consegue chegar a uma prévia completa com catálogo assinado de laboratório. A preparação física atual já usa a rota fixa incorporada.

### 8.3 P2 — configurar Aurora sem intervenção manual

Este ponto é essencial para cumprir a promessa de “plugou, ativou o exploit, abriu o Aurora”.

- escolher uma distribuição Aurora autorizada;
- definir configurações mínimas limpas;
- configurar caminhos de scan para jogos no USB/HD;
- validar que `Usb:\Aurora\default.xex` inicia com o payload escolhido;
- validar bancos/configurações Aurora sem dados específicos de outro console;
- definir comportamento quando mais de um USB estiver conectado;
- confirmar janela de cancelamento do AutoStart com botão B;
- decidir localização de GOD, XEX, XBLA, DLC, emuladores e ROMs;
- testar primeiro boot, scans posteriores e atualização/reparo;
- documentar recuperação quando Aurora ou configuração estiver corrompida.

Critério de saída: em console de laboratório compatível, o Aurora inicia e encontra conteúdo sem configuração manual e sem escrever NAND.

### 8.4 P3 — executor transacional para dispositivo físico

Concluído no código:

- executor novo sem reutilizar a extração direta do serviço BadStick legado;
- dispositivo Windows aprovado, impressão digital atual e revalidação antes da escrita;
- área temporária exclusiva no próprio dispositivo;
- cópia com criação exclusiva, releitura e verificação SHA-256;
- backup de arquivo anterior diferente;
- promoção após verificação;
- diário atual e anterior no dispositivo;
- retomada de transação;
- recusa de troca física do dispositivo;
- bloqueio de links/reparse points e destinos fora das raízes aprovadas;
- idempotência de arquivo idêntico;
- mensagens de IPC ligadas ao novo fluxo fixo.

Ainda pendente: ensaio destrutivo em mídias descartáveis de laboratório, inclusive remoção física durante a cópia e retomada no mesmo dispositivo.

### 8.5 P4 — formatação FAT32 segura

Concluído no código:

- formatação opcional integrada ao fluxo fixo;
- UAC solicitado somente no momento necessário;
- revalidação do disco antes da operação;
- bloqueio herdado da política de dispositivo seguro;
- confirmação de FAT32/capacidade antes da escrita.

Ainda pendente: testes destrutivos em mídia identificada de laboratório, especialmente troca de letra após formatação, controladoras diferentes, HDD/SSD USB e recuperação de falha/cancelamento.

### 8.6 P5 — instalação de jogos no pendrive/HD

- escolher fluxo inicial: arquivos locais autorizados antes de downloads públicos;
- reutilizar conversores ISO→GOD e ISO→XEX do backend Go;
- criar saída local para o staging do preparador, em vez de FTP direto;
- gerar plano transacional também para jogos;
- validar Title ID, Media ID, tipo de conteúdo e layout de destino;
- suportar GOD, XEX, XBLA, DLC/content e, quando aprovado, ROMs;
- aplicar limite de arquivo FAT32 de 4 GiB;
- tratar arquivos XEX soltos maiores que o limite ou recusar com explicação;
- calcular capacidade antes de baixar/converter e novamente antes de gravar;
- suportar pausa, cancelamento, retomada e limpeza de temporários;
- verificar downloads por hashes confiáveis quando houver catálogo;
- preservar jogos já existentes e permitir reparo idempotente;
- implementar multidisco e discos de conteúdo;
- integrar caminhos de scan Aurora;
- decidir política de capas/metadados sem exigir conexão do console;
- adicionar fila simples adequada a usuário leigo;
- impedir exclusão automática de conteúdo não pertencente ao aplicativo.

Critério de saída: jogos locais de teste são convertidos, planejados, gravados e detectados pelo Aurora em hardware de laboratório.

### 8.7 P6 — experiência para público leigo

- renomear/remover textos herdados em inglês do preparador;
- reduzir opções técnicas e oferecer padrões seguros;
- separar “verificar”, “preparar”, “adicionar jogos” e “reparar”;
- usar confirmações curtas, claras e não ambíguas;
- mostrar sempre dispositivo físico, não apenas letra de unidade;
- oferecer modo diagnóstico sem habilitar ações perigosas;
- explicar que o exploit é temporário e pode exigir tentativas;
- instruir desconexão de rede e uso correto do perfil do exploit;
- explicar que “pronto” não significa modificação permanente;
- incluir acessibilidade, navegação por teclado e leitores de tela;
- registrar logs úteis sem serial completo, credenciais ou outros dados sensíveis;
- criar documentação de primeiro uso e solução de problemas;
- incluir procedimento de atualização/reparo do pendrive sem formatar.

### 8.8 P7 — qualidade, hardware e segurança de lançamento

- testes E2E do wizard e IPC;
- testes de rede: timeout, redirect, download truncado, CDN indisponível e cache adulterado;
- fuzz/property tests para manifesto, ZIP, caminhos e diário;
- testes com antivírus bloqueando/colocando arquivos em quarentena;
- testes com pouco espaço, cluster incomum, arquivos existentes e filesystem corrompido;
- testes de remoção do USB em todos os pontos de escrita;
- testes de queda de energia simulada e real controlada;
- testes em diferentes controladoras USB, hubs e portas;
- matriz de pendrives, HDDs e SSDs USB;
- matriz de modelos/revisões Xbox 360 compatíveis;
- validação específica no dashboard 17559 com dados de Avatar;
- medir taxa/tempo de sucesso do exploit sem prometer resultado;
- revisão de segurança independente;
- revisão de licenças e marcas;
- assinatura de código do instalador e executáveis;
- atualização assinada com rollback;
- política de privacidade e retenção de logs;
- build reproduzível e SBOM;
- processo de resposta a componente revogado/comprometido.

## 9. Ordem recomendada de implementação

```text
P0 componentes/chaves/licenças
             |
             v
P1 prévia integrada na interface
             |
             v
P2 Aurora realmente autônomo no console
             |
             v
P3 escritor físico transacional
             |
             v
P4 formatação FAT32 auditada (ou adiada)
             |
             v
P5 jogos no dispositivo
             |
             v
P6 UX pública + P7 QA/release
```

P0 remoto, P1 remoto e P2 podem avançar sem depender de nova escrita física. A rota fixa atual já habilita preparação no Windows, mas a liberação pública deve continuar condicionada aos testes destrutivos e ao console de laboratório.

## 10. Barreiras que devem continuar fail-closed

Estas condições nunca devem ser contornadas mudando apenas uma constante:

- chaveiro vazio quando a rota de catálogo remoto estiver ativa;
- manifesto remoto ausente, expirado ou com assinatura inválida quando downloads remotos estiverem ativos;
- componente sem licença/redistribuição aprovada;
- tamanho ou SHA-256 divergente;
- dispositivo físico inseguro ou trocado;
- destino diferente de FAT32;
- unidade de alocação desconhecida;
- espaço livre insuficiente;
- console sem confirmações obrigatórias;
- falha de revalidação do executor físico;
- formatação sem confirmação/revalidação;
- arquivos NAND/KV/MAC na imagem;
- origem de jogo sem autorização definida.

## 11. Critérios mínimos antes de liberar publicamente a gravação real

Todos devem estar concluídos:

- pacote fixo catalogado e verificado no build entregue;
- licenças e autorizações registradas para os componentes distribuídos;
- prévia/verificação disponível na interface;
- Aurora/AutoStart validados em console de laboratório;
- executor físico transacional implementado e revisado;
- revalidação física antes das mutações confirmada em hardware real;
- retomada testada em mídia real;
- nenhuma dependência do escritor BadStick legado;
- revisão de segurança do fluxo;
- teste de que nenhum caminho toca NAND/KV/MAC;
- documentação de recuperação disponível.

Para reativar catálogo remoto, somam-se chave pública de release, manifesto real assinado, componentes baixados/verificados pelo pipeline seguro e revisão independente de licenças/hashes.

Para habilitar formatação, somam-se todos os critérios específicos de P4.

## 12. Definição de “pronto” do produto público

O produto somente poderá ser anunciado como pronto quando:

- um usuário leigo conseguir preparar e reparar um dispositivo seguindo um wizard curto;
- cada arquivo for autenticado e verificável;
- o aplicativo não puder selecionar disco interno/sistema por engano;
- interrupções não destruírem arquivos fora do plano;
- Aurora iniciar e detectar jogos sem configuração manual no console;
- instalação de jogos usar somente fontes/arquivos autorizados;
- os limites do exploit forem comunicados sem promessa indevida;
- instalador e atualizações forem assinados;
- testes de hardware e uma revisão independente tiverem sido concluídos.

“Dispositivo pronto” significará: arquivos autorizados preparados e verificados para tentativa no console compatível. Não significará desbloqueio permanente nem garantia de execução do exploit.

## 13. Mapa da documentação

- `docs/PLANEJAMENTO.md`: visão, arquitetura e fases originais;
- `docs/STATUS.md`: resumo curto do marco atual;
- `docs/UPSTREAM.md`: origem e revisão do GODSend-360;
- `docs/MANIFESTO-DE-COMPONENTES.md`: esquema, assinatura e custódia;
- `docs/EXTRACAO-ZIP-SEGURA.md`: regras do extrator;
- `docs/IMAGEM-LIMPA.md`: composição ABadAvatar/XeUnshackle/Aurora;
- `docs/ESCRITA-TRANSACIONAL.md`: plano, diário e simulação;
- `docs/CAPACIDADE-E-ESPACO.md`: política FAT32 e reserva;
- `docs/PREVIA-DE-PREPARACAO.md`: ensaio completo sem gravação;
- `docs/SEGURANCA-ELECTRON.md`: hardening da aplicação;
- `docs/features.md`: recursos herdados do GODSend-360;
- `docs/building.md`: compilação do projeto herdado.
