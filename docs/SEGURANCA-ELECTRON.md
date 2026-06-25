# Segurança da aplicação Electron

## Dependências

- Electron atualizado de 37.x para 42.4.1 e fixado no lockfile.
- Jimp 0.22 removido: não havia qualquer importação ou uso no código.
- A remoção também eliminou as dependências vulneráveis de `file-type` trazidas pelo Jimp antigo.
- `npm audit` retorna zero vulnerabilidades conhecidas no conjunto instalado.

## Isolamento da janela

A janela principal utiliza:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true`;
- `webSecurity: true`;
- conteúdo inseguro desabilitado;
- navegação por arrastar e soltar desabilitada;
- diálogos seguros;
- DevTools somente em desenvolvimento.

Novas janelas são negadas. Navegações da janela principal são limitadas ao mesmo arquivo local em produção ou à origem exata do servidor Vite em desenvolvimento. Protocolos `javascript:`, `data:`, páginas web e arquivos locais diferentes são recusados.

Todas as permissões Chromium são negadas por padrão. O renderer continua acessando funções privilegiadas somente pelo `contextBridge` do preload.

## Política de conteúdo

O HTML declara CSP com:

- scripts somente da própria aplicação;
- objetos e frames bloqueados;
- formulários bloqueados;
- `base-uri` bloqueado;
- conexões limitadas à aplicação e ao backend loopback;
- imagens locais, `data`, `blob`, HTTPS e protocolo interno do cache Aurora.

## Smoke test

O comando abaixo inicia uma instância real do Electron em um diretório de dados temporário:

```powershell
npm run test:electron-security
```

O teste confirma que:

- a janela abre;
- o preload sandboxed expõe `window.godsendApi`;
- `window.require` não existe;
- `window.process` não existe.

