# Bug: Falha de bind de porta em Windows localizado (Porta ocupada não detectada em Português)

- **Detectado em:** 2026-07-14 00:18 (telemetria de produção)
- **Status:** **Resolvido** (v2.12.44)
- **Origem:** telemetria `xbox-360-companion/backend` (`main.go::main` -> `app/listen.go::ListenOnAvailablePortAt` -> `IsTCPAddrInUse`)
- **Errors (serviço):** 392, 398, 403, 409, 410, 453, 454, 456 (8 ocorrências)
- **Classe:** fail (bug de código claro)
- **Reincidência:** recorrente (8 ocorrências)

## Sintoma

O backend Go falha em iniciar e aborta a execução inteira lançando o erro abaixo, em vez de prosseguir tentando a próxima porta disponível (ex: 8081, 8082...):

```
Listen failed on host 127.0.0.1 port 8080: listen 127.0.0.1:8080: listen tcp 127.0.0.1:8080: bind: Foi feita uma tentativa de acesso a um soquete de uma maneira que é proibida pelas permissões de acesso.
```

Ou:

```
Listen failed on host 127.0.0.1 port 8080: listen 127.0.0.1:8080: listen tcp 127.0.0.1:8080: bind: Normalmente é permitida apenas uma utilização de cada endereço de soquete (protocolo/endereço de rede/porta).
```

## Causa raiz

A função `IsTCPAddrInUse` no arquivo [`listen.go`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/server/app/listen.go) verifica se o erro de escuta é causado por porta ocupada para avançar para a próxima porta disponível:

1. **Type Assertion do Erro no Go/Windows:** No Windows, o campo `opErr.Err` retornado por `net.Listen` é envelopado em um `*os.SyscallError`. O `errors.As(err, &errno)` agora desembrulha corretamente toda a cadeia de erros até o `syscall.Errno`, identificando os códigos de erro nativos do Winsock (`WSAEADDRINUSE` 10048, `WSAEACCES` 10013, `WSAEADDRNOTAVAIL` 10049, `ERROR_ACCESS_DENIED` 5, `ERROR_SHARING_VIOLATION` 32).
2. **Checagem de String Localizada em Múltiplos Idiomas:** Anteriormente a checagem por substring buscava apenas textos em inglês. Quando o sistema operacional estava configurado em Português (ou Espanhol, Francês, Alemão, Italiano), as mensagens traduzidas da Win32 API causavam a rejeição do erro como sendo não recuperável, abortando o bootstrap do servidor sem avançar para a próxima porta.

## Resolução Implementada

1. **Extração de `syscall.Errno` com suporte a múltiplos códigos Winsock (`listen.go`):**
   - Em [`src/server/app/listen.go`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/server/app/listen.go), `IsTCPAddrInUse` extrai `syscall.Errno` usando `errors.As` sobre a árvore de erros.
   - Trata os códigos POSIX (`EADDRINUSE`, `EACCES`, `EPERM`) e do Windows (`10048` WSAEADDRINUSE, `10013` WSAEACCES, `10049` WSAEADDRNOTAVAIL, `5` ERROR_ACCESS_DENIED, `32` ERROR_SHARING_VIOLATION).
2. **Fallback abrangente de strings em múltiplos idiomas:**
   - Adicionadas verificações defensivas para mensagens localizadas do Windows em Português (`"permissões de acesso"`, `"tentativa de acesso a um soquete"`, `"utilização de cada endereço"`, `"endereço já em uso"`, `"endereço de soquete"`, `"acesso negado"`), Espanhol, Francês, Alemão, Italiano e códigos numéricos literais.
3. **Testes Unitários Automatizados (`listen_test.go`):**
   - Em [`src/server/app/listen_test.go`](file:///c:/projects/Downloader-XBOX360-XEX-HDD-Games/src/server/app/listen_test.go), foram implementados testes para erros `nil`, `syscall.Errno` puros e envelopados em `*os.SyscallError` / `*net.OpError`, casos com strings exatas de telemetria em português e outras línguas, e teste de integração verificando o salto dinâmico para a porta seguinte (`TestListenOnAvailablePortAtHopsOverOccupiedPort`).
4. **Version Bump:** Atualizado para `v2.12.44` em todos os 4 arquivos obrigatórios e no `CHANGELOG.md`.
