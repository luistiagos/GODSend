# Atualização manual do pacote BadAvatar

O aplicativo não baixa nem troca o pacote automaticamente. Uma nova versão só se torna ativa quando o mantenedor executa o comando de importação no projeto e gera um novo build.

## Atualizar

1. Extraia a nova versão completa em uma pasta fora do projeto.
2. Feche o GODsend e qualquer build em andamento.
3. No diretório `src/electron-app`, execute:

```powershell
npm run payload:update -- "E:\caminho\para\nova-versao" "1.2"
```

O segundo argumento é um identificador de versão. Use somente letras, números, ponto, hífen ou sublinhado e nunca reutilize um identificador já importado.

O comando:

- exige `BadUpdatePayload`, `Content`, `games`, Aurora, `lhelper.xex` e `UsbdSecPatch.xex`;
- recusa links simbólicos;
- copia primeiro para uma área temporária;
- calcula SHA-256 de todos os arquivos;
- cria o manifesto da nova versão;
- altera `assets/badavatar-package.json` somente depois da validação;
- remove a versão anterior somente após a ativação bem-sucedida.

Depois, execute `npm run test:safety` e gere normalmente o instalador. O diretório e o manifesto ativos são incluídos automaticamente pelo `electron-builder`.

## Preservar temporariamente a versão anterior

Para manter os arquivos anteriores durante uma validação:

```powershell
npm run payload:update -- "E:\caminho\para\nova-versao" "1.2-rc1" --keep-previous
```

Isso aumenta o tamanho do próximo build porque as duas versões permanecerão em `assets`. Após validar, remova manualmente somente o diretório e o manifesto antigos que não estiverem indicados por `assets/badavatar-package.json`.

Para voltar a uma versão preservada, informe o identificador usado na importação:

```powershell
npm run payload:activate -- "1.1"
```

Esse comando apenas muda a versão ativa; ele não copia, baixa ou remove arquivos.

## Falha durante a atualização

Se a cópia, a validação ou a geração dos hashes falhar, o arquivo `badavatar-package.json` não é alterado e a versão anterior continua ativa. Não edite o manifesto à mão: importe novamente a pasta com um novo identificador.
