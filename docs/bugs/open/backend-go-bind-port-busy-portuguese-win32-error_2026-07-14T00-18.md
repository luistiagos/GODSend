# Bug: Falha de bind de porta em Windows localizado (Porta ocupada não detectada em Português)

- **Detectado em:** 2026-07-14 00:18 (telemetria de produção)
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

A função `IsTCPAddrInUse` no arquivo [listen.go](file:///E:/projects/GODSend/src/server/app/listen.go) verifica se o erro de escuta é causado por porta ocupada para avançar para a próxima porta disponível:

```go
func IsTCPAddrInUse(err error) bool {
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Err != nil {
		if errno, ok := opErr.Err.(syscall.Errno); ok {
			if errno == syscall.EADDRINUSE {
				return true
			}
			if runtime.GOOS == "windows" && int(errno) == 10048 { // WSAEADDRINUSE
				return true
			}
		}
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "address already in use") ||
		strings.Contains(msg, "only one usage of each socket address") ||
		strings.Contains(msg, "wsaeaddrinuse")
}
```

Há dois problemas nessa verificação:
1. **Type Assertion do Erro no Go/Windows:** No Windows, o campo `opErr.Err` retornado por `net.Listen` não é do tipo direto `syscall.Errno`, mas sim envelopado em um `*os.SyscallError`. Portanto, a asserção `opErr.Err.(syscall.Errno)` falha silenciosamente, nunca executando a validação numérica do código do erro (como `10048` ou `WSAEACCES` / `10013`).
2. **Checagem de String Localizada em Inglês:** Como o type assertion falha, a função recorre a `strings.Contains(strings.ToLower(err.Error()), ...)` usando strings fixas em inglês. Quando o sistema operacional do usuário está configurado em Português, as mensagens de erro retornadas pelo sistema operacional são traduzidas pelo Windows e a validação de strings falha (não encontrando `"address already in use"` ou `"only one usage of each socket address"`).

Como resultado, o erro de bind é tratado como um erro crítico fatal de escuta de rede genérico, interrompendo a inicialização do app.

## Como reproduzir

1. Em uma máquina Windows com idioma configurado em Português, utilize qualquer processo (ex: um servidor web) para escutar na porta 8080.
2. Inicie o backend Go (`npm run start` ou executando o binário `godsend.exe`).
3. O servidor Go irá falhar no bind com `Foi feita uma tentativa de acesso a um soquete...` e fechará de forma abrupta em vez de tentar a porta 8081.

## Próximos passos

1. Corrigir a extração do código numérico de erro em `IsTCPAddrInUse` desembrulhando adequadamente o `*os.SyscallError` se ele existir, ou usando `errors.As(opErr.Err, &syscallErr)` para obter a `syscall.Errno`.
2. Tratar tanto o erro de porta em uso (`WSAEADDRINUSE` / `10048`) quanto o erro de acesso proibido/porta restrita (`WSAEACCES` / `10013` / `10049`) no Windows.
3. Adicionar suporte para verificar as strings em português ou basear-se puramente nos códigos nativos de erro do Windows (`WSAEADDRINUSE` / `WSAEACCES`).
