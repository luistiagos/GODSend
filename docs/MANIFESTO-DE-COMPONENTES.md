# Manifesto confiável de componentes

## Finalidade

Aurora, XeUnshackle, ABadAvatar e qualquer outro componente do dispositivo somente poderão ser usados quando descritos por um manifesto assinado. O manifesto não concede autorização jurídica: ele registra uma autorização já confirmada e impede que o aplicativo aceite silenciosamente arquivos ou origens diferentes.

## Envelope

```json
{
  "schemaVersion": 1,
  "algorithm": "Ed25519",
  "keyId": "release-2026-01",
  "manifest": {},
  "signature": "BASE64_DA_ASSINATURA"
}
```

A assinatura cobre a representação JSON canônica de `manifest`: chaves de objetos ordenadas, sem espaços e preservando a ordem de arrays. Campos desconhecidos são recusados.

## Estrutura do manifesto

```json
{
  "schemaVersion": 1,
  "manifestId": "xbox360-components.production",
  "release": "0.1.0",
  "createdAt": "2026-06-22T00:00:00.000Z",
  "expiresAt": "2026-09-22T00:00:00.000Z",
  "components": [
    {
      "id": "aurora",
      "role": "dashboard-aurora",
      "displayName": "Aurora",
      "version": "VERSAO_CONFIRMADA",
      "required": true,
      "source": {
        "url": "https://ORIGEM_AUTORIZADA/arquivo.zip",
        "redirectHosts": ["HOST_CDN_EXPLICITAMENTE_AUTORIZADO"],
        "fileName": "aurora.zip",
        "sizeBytes": 123456,
        "sha256": "64_DIGITOS_HEXADECIMAIS"
      },
      "license": {
        "spdx": "LICENCA_CONFIRMADA",
        "projectUrl": "https://PROJETO_OFICIAL",
        "redistributionApproved": true,
        "attribution": "Crédito e aviso exigidos pelo projeto."
      },
      "archive": {
        "format": "zip",
        "installPath": "Aurora",
        "maxExtractedBytes": 500000000,
        "maxEntries": 5000
      }
    }
  ]
}
```

O exemplo é documental e propositalmente inválido para produção. Não contém URLs, versões ou hashes presumidos.

## Regras implementadas

- somente Ed25519;
- chave pública precisa estar incorporada ao aplicativo;
- URL inicial e todos os redirecionamentos precisam usar HTTPS;
- hosts de redirecionamento precisam constar no conteúdo assinado;
- credenciais em URL são proibidas;
- tamanho máximo de download por componente: 2 GiB;
- SHA-256 obrigatório;
- manifesto expirado ou criado no futuro é recusado;
- IDs duplicados são recusados;
- cada componente declara um papel funcional fechado;
- licença, projeto, atribuição e autorização de redistribuição são obrigatórios;
- caminhos absolutos, letras de unidade, barras invertidas e `..` são recusados;
- limites de quantidade de entradas e expansão são assinados;
- arquivo em cache somente é reutilizado depois de tamanho e SHA-256 conferirem.

## Chaves

O código possui um chaveiro de produção vazio em `src/electron-app/infrastructure/trustedManifestKeyring.ts`. Isso é intencional: nenhuma chave deve ser criada informalmente apenas para liberar o botão.

Antes da primeira chave ser incorporada, devem existir:

1. responsável formal pela assinatura;
2. geração da chave privada em ambiente offline;
3. backup e recuperação definidos;
4. procedimento de rotação e revogação;
5. ao menos duas pessoas revisando o manifesto;
6. chave privada ausente do repositório, build e computador de desenvolvimento comum.

## Staging

Os componentes são baixados para uma área no computador, nunca diretamente para o USB. O nome de destino é gerado a partir de identificadores validados. Downloads parciais usam nomes aleatórios e são removidos em falha. O arquivo só é promovido no staging após:

1. resposta HTTPS válida;
2. host permitido;
3. limite de redirecionamentos;
4. `Content-Length`, quando presente, igual ao manifesto;
5. contagem real de bytes exata;
6. sincronização do arquivo;
7. SHA-256 exato.

Downloads e hashes aceitam cancelamento explícito. O cancelamento destrói os streams ativos e a rotina de staging remove o arquivo parcial antes de retornar controle à interface.
