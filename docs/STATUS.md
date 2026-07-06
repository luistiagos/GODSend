# Estado da implementação

Atualizado em 2026-06-25.

O inventário completo, incluindo todos os itens parciais, bloqueados e pendentes, está em `docs/IMPLEMENTACAO-E-PENDENCIAS.md`.

## Concluído nesta fundação

- GODSend-360 importado com remoto `upstream` preservado.
- Revisão-base registrada em `docs/UPSTREAM.md`.
- Planejamento e critérios de liberação registrados em `docs/PLANEJAMENTO.md`.
- Política pura e testável de segurança para dispositivos Windows.
- Enumeração por disco e partição física usando apenas um script PowerShell constante.
- Impressão digital SHA-256 da seleção.
- Revalidação obrigatória do dispositivo pelo processo principal.
- Bloqueio de discos não USB, boot, sistema, disco zero, offline, somente leitura, sem identidade ou com múltiplas partições montadas.
- Interface passa a mostrar modelo, serial, capacidade, disco físico e motivo de bloqueio.
- Proto e Freestyle deixam de ser opções pré-selecionadas.
- Pipeline legado de gravação BadAvatar desabilitado em código.
- Backend passa a escutar somente em `127.0.0.1` por padrão.
- Oitenta e cinco testes unitários de prévia, capacidade, imagem limpa, dispositivo, navegação, manifesto, staging, ZIP, plano, diário, pacote fixo e executor transacional.
- Dois testes Go do endereço de escuta.
- Manifesto de componentes com esquema fechado e validação fail-closed.
- Verificação de assinatura Ed25519 com chaveiro incorporado.
- Validação de autorização de redistribuição, HTTPS, hosts de redirecionamento, tamanho, SHA-256 e caminhos.
- Download para staging com arquivo parcial exclusivo, limite de bytes, sincronização e promoção após hash.
- Diagnóstico de prontidão integrado à tela de preparação.
- Plano de escrita imutável com hash canônico e lista restrita de destinos.
- Validação de cada origem contra troca de conteúdo após o staging.
- Diário transacional com transições monotônicas, checksum e cópia anterior recuperável.
- Extrator ZIP integralmente validado antes da escrita, com proteção contra traversal, links e expansão excessiva.
- Executor transacional testado em raízes simuladas marcadas e ligado ao USB físico revalidado.
- Retomada testada após interrupção no meio da promoção e da substituição com backup.
- Electron 42.4.1 com sandbox, permissões negadas, navegação restrita e CSP.
- Smoke test real confirma preload isolado sem `require` ou `process` no renderer.
- Montador de imagem limpa gera `launch.ini`, AutoStart e manifesto de arquivos no staging.
- Componentes são vinculados a papéis explícitos e não podem fornecer configurações ou metadados reservados.
- Arquivos MAC, NAND e KV são recusados pela montagem.
- Política de capacidade calcula alocação FAT32, metadados e margem livre antes da escrita.
- Todos os pontos instrumentados de interrupção possuem teste de retomada.
- Prévia somente leitura encadeia extração, imagem limpa, plano transacional e avaliação de capacidade.
- Pré-requisitos do console bloqueiam dashboard diferente de 17559, dados de Avatar não confirmados, rede conectada e avisos do exploit não reconhecidos.
- Teste de integração confirma que a prévia não altera nenhum arquivo no destino.
- Serviço do processo principal liga manifesto assinado, staging, revalidação do USB e prévia.
- IPC da prévia aceita somente identidade do USB e confirmações do console; caminhos e URLs não vêm do renderer.
- Relatório público remove caminhos internos de staging.
- A aplicação abre diretamente em uma jornada simples de preparação: escolher o pendrive/HD, formatar opcionalmente e preparar.
- BadAvatar e Aurora aparecem como um único pacote automático; manifesto, fingerprint, número de disco e etapas internas ficam fora da jornada principal.
- Na tela principal, jogos, configurações, conversores e FTP ficam recolhidos em um único menu “Outras funções”; “Adicionar jogos” só aparece após o preparo terminar.
- Os cinco reconhecimentos técnicos foram consolidados em uma única confirmação legível para o usuário.
- O pacote fixo BadAvatar 1.1 foi incorporado com 643 arquivos e catálogo SHA-256 próprio.
- A versão ativa é definida por `assets/badavatar-package.json` e pode ser substituída manualmente com `npm run payload:update` sem alterar o código.
- Versões preservadas podem ser reativadas com `npm run payload:activate`; atualização incompleta mantém a versão anterior ativa.
- O escritor físico transacional foi ligado ao USB revalidado, com retomada, backup e verificação após a cópia.
- A formatação FAT32 opcional solicita UAC somente no momento necessário.
- O gravador BadStick legado continua inacessível; a interface usa exclusivamente o novo fluxo fixo e transacional.
- O canal IPC/preload do escritor BadStick legado foi removido; ele não pode ser solicitado pelo renderer.
- A prévia pode ser cancelada; o sinal interrompe download/hash e arquivos parciais são removidos.

## Estado operacional

O preparo físico está habilitado no Windows quando um dispositivo USB seguro é detectado e o usuário confirma os requisitos. O destino precisa estar em FAT32 ou a opção “Formatar antes” deve ser marcada. O pacote é validado, o espaço é conferido e a escrita usa diário transacional. O build empacotado foi verificado com os 643 arquivos e 759.225.234 bytes no diretório esperado. Ainda falta o ensaio final em um pendrive descartável e a validação do AutoStart/Aurora em um Xbox 360 de laboratório.

Validação local refeita em 2026-06-25: `npm run test:safety`, `npm run test:electron-security`, `npm audit --json`, `go test ./...` e `go vet ./...` aprovados.

Instalador NSIS x64 validado: `dist/godsend-Setup-2.12.24.exe`, 470,41 MB, SHA-256 `843454202fa8b3592926be4648a9bc6fcfdf5ff322e715b9811592e36444b0d2`.

Executável portátil x64 validado: `dist/godsend-Portable-2.12.24.exe`, 502,02 MB, SHA-256 `b8782ce41be9552cd32c5673a907a2818e2a4157ebcf47c4a43089b5e2932a38`. O build usa compressão 7-Zip nível 1 para não esgotar a memória virtual ao incluir o pacote fixo.

## Dependências

O primeiro `npm ci` encontrou 17 alertas: 1 baixo, 10 moderados e 6 altos. O Electron foi migrado para 42.4.1. O Jimp antigo foi removido porque não era utilizado. Atualizações compatíveis trataram os demais alertas. `npm audit` retorna zero vulnerabilidades conhecidas e não foi utilizado `npm audit fix --force`.

## Próximo marco

1. executar o fluxo completo em um pendrive descartável, com e sem formatação;
2. validar BadAvatar, AutoStart, Aurora, Freestyle, DashLaunch e XexMenu em console de laboratório;
3. testar remoção física do USB durante a cópia e confirmar a retomada no mesmo dispositivo;
4. assinar os executáveis de distribuição quando o certificado de assinatura de código estiver disponível;
5. integrar conversão e instalação de jogos locais autorizados ao mesmo plano transacional.
