# Prévia de preparação sem gravação

Atualizado em 2026-06-23.

## Objetivo

O modo de prévia executa o mesmo encadeamento técnico que antecederá uma preparação real, mas não formata nem grava o pendrive/HD. Ele cria uma sessão exclusiva na área de trabalho do aplicativo, extrai componentes já verificados, monta a imagem limpa, produz o plano transacional e apenas lê o destino para inventariar arquivos e calcular espaço.

O contrato retorna explicitamente `mode: "read-only-preview"` e `targetWritesPerformed: false`. O executor real continua desabilitado.

O usuário pode cancelar uma prévia em andamento. O `AbortSignal` chega ao pedido HTTPS, à cópia, ao hash e ao staging; arquivos `.partial` são removidos pela mesma rotina fail-closed. O canal de cancelamento não recebe caminhos ou URLs do renderer.

## Fluxo implementado

```text
manifesto já verificado + arquivos locais com hash fixado
                         |
                         v
                 extração segura no PC
                         |
                         v
          imagem limpa + launch.ini + AutoStart
                         |
                         v
              plano imutável com SHA-256
                         |
                         v
       inventário somente leitura do destino FAT32
                         |
                         v
           relatório pronto/bloqueado + motivos
```

A sessão usa um UUID e nunca sobrescreve uma sessão anterior. A raiz de trabalho precisa existir, ser absoluta e não pode ser link simbólico ou redirecionamento. Se qualquer etapa falhar, a sessão parcial é removida.

Componentes ZIP passam pelo extrator seguro existente. Componentes declarados como `raw` são copiados somente para o staging do PC e têm tamanho e SHA-256 conferidos antes e depois da cópia. O mapa de componentes rejeita itens desconhecidos, propriedades herdadas e ausência de qualquer componente obrigatório.

## Confirmações obrigatórias do console

A prévia só fica com `ready: true` quando, além da capacidade aprovada, o usuário confirma:

- dashboard `17559`/`2.0.17559.0`;
- dados oficiais de Avatar da atualização instalados;
- Wi-Fi e cabo de rede desconectados;
- ciência de que o exploit não persiste após desligar ou reiniciar;
- ciência de que nunca deve entrar no perfil do exploit, sobretudo na Xbox Live.

Essas condições vêm das instruções dos projetos originais. O Xbox360BadUpdate declara suporte ao dashboard 17559, natureza não persistente e possibilidade de várias tentativas. O ABadAvatar exige os dados de Avatar, alerta para não entrar no perfil do exploit e recomenda desconectar rede e Wi-Fi para evitar banimento: [Xbox360BadUpdate](https://github.com/grimdoomer/Xbox360BadUpdate) e [ABadAvatar](https://github.com/shutterbug2000/ABadAvatar).

Uma prévia aprovada significa somente que a composição de arquivos, o plano e o espaço passaram nas verificações. Não garante que o exploit será bem-sucedido no console.

## Arquivos

- `src/electron-app/infrastructure/preparationPreview.ts`: avaliação de pré-requisitos e orquestração do ensaio;
- `src/electron-app/services/preparationPreviewService.ts`: carrega o manifesto, baixa componentes e revalida o USB;
- `src/electron-app/ipc/badAvatarHandlers.ts`: canal exclusivo, progresso e trava de concorrência;
- `src/electron-app/renderer/components/BadAvatarUsbPage.tsx`: checklist e relatório para o usuário;
- `src/electron-app/tests/unit/preparationPreview.test.cjs`: confirma bloqueios, composição completa, insuficiência de espaço, componente ausente e ausência de alterações no destino.
- `src/electron-app/tests/unit/preparationPreviewService.test.cjs`: valida o contrato estreito e a remoção de caminhos internos;
- `src/electron-app/tests/electron/badavatar-preview-smoke.cjs`: confirma visualmente o checklist e os dois bloqueios.

## Limites atuais

- o chamador deve fornecer um manifesto já autenticado por `verifySignedComponentManifest`;
- o chaveiro de produção permanece vazio até a definição da custódia das chaves;
- ainda não existem URLs, hashes nem licenças reais aprovadas no manifesto de produção;
- o relatório foi ligado à interface, mas permanece bloqueado pelo chaveiro vazio até existirem componentes autorizados;
- retry e detalhamento de licenças/arquivos na interface ainda estão pendentes;
- nenhuma chamada ao formatador ou ao executor de dispositivo físico foi adicionada.
