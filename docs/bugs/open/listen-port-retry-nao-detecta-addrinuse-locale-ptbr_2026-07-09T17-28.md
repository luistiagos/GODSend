# Bug: retry de porta do servidor local nunca dispara — `IsTCPAddrInUse` nao reconhece erro em locale PT-BR (e possivelmente nem em ingles no Windows)

- **Detectado em:** 2026-06-10 -> 2026-07-14 (telemetria de producao)
- **Origem:** telemetria `xbox-360-companion/backend` (`main.go::main`); causa real em
  `app/listen.go::IsTCPAddrInUse`
- **Errors (servico):** 467, 466, 465, 464, 463, 456, 454, 453, 410, 409, 403, 398, 392
  (13 ocorrencias)
- **Classe:** fail (o app falha ao iniciar; usuario fica sem o backend rodando)
- **Reincidencia:** recorrente ao longo de mais de um mes, multiplas sessoes

## Sintoma

O backend (`main.go`) tenta abrir o servidor HTTP local e morre com `os.Exit(1)` logo na
inicializacao, sem nunca subir:

```
[FATAL] Listen failed on host 127.0.0.1 port 8080: listen 127.0.0.1:8080: listen tcp
127.0.0.1:8080: bind: Normalmente e permitida apenas uma utilizacao de cada endereco de soquete
(protocolo/endereco de rede/porta).
```

(2 variantes de mensagem no grupo: a acima — WSAEADDRINUSE/10048, porta ja em uso — e uma
segunda, `bind: Foi feita uma tentativa de acesso a um soquete de uma maneira que e proibida
pelas permissoes de acesso.` — WSAEACCES/10013, bloqueio de permissao/seguranca no bind.)

## Causa raiz (confirmada no codigo)

O app **ja tem** logica de retry de porta — [app/listen.go:41-64](../../../src/server/app/listen.go#L41)
(`ListenOnAvailablePortAt`) tenta `start`, `start+1`, ... ate 65535, e so propaga erro fatal se
`IsTCPAddrInUse(err)` retornar `false`. O problema esta no proprio detector,
[app/listen.go:15-31](../../../src/server/app/listen.go#L15):

```go
func IsTCPAddrInUse(err error) bool {
    var opErr *net.OpError
    if errors.As(err, &opErr) && opErr.Err != nil {
        if errno, ok := opErr.Err.(syscall.Errno); ok {   // (1)
            if errno == syscall.EADDRINUSE { return true }
            if runtime.GOOS == "windows" && int(errno) == 10048 { return true }
        }
    }
    msg := strings.ToLower(err.Error())
    return strings.Contains(msg, "address already in use") ||        // (2)
        strings.Contains(msg, "only one usage of each socket address") ||
        strings.Contains(msg, "wsaeaddrinuse")
}
```

Duas falhas independentes, e a combinacao das duas faz o detector nunca casar em producao:

1. **(1) A asserção de tipo direta `opErr.Err.(syscall.Errno)` normalmente falha no Windows.**
   O pacote `net` do Go envolve o erro de `bind` do Windows num `*os.SyscallError` (via
   `os.NewSyscallError("bind", ...)`) antes de colocá-lo em `OpError.Err` — ou seja,
   `opErr.Err` costuma ser `*os.SyscallError`, nao `syscall.Errno` diretamente. A asserção
   `.( syscall.Errno)` sem passar por `errors.As`/`Unwrap` falha (`ok=false`) nesse caso, entao o
   caminho (1) **nunca reconhece o erro por errno** e o codigo sempre cai no fallback de string
   (2).

2. **(2) O fallback de string só reconhece mensagens em INGLES.** A mensagem real capturada em
   producao (Windows em locale PT-BR, comum nos usuarios deste app — ver outros bugs do mesmo
   projeto com "Area de trabalho"/"Nova pasta" em portugues) e:
   `"Normalmente e permitida apenas uma utilizacao de cada endereco de soquete..."` — nenhuma das
   3 substrings verificadas (`"address already in use"`, `"only one usage of each socket
   address"`, `"wsaeaddrinuse"`) bate com o texto localizado. Resultado: em qualquer Windows
   PT-BR, `IsTCPAddrInUse` retorna **sempre `false`** para um EADDRINUSE genuino, o retry nunca
   acontece, e o app morre fatal na PRIMEIRA porta ocupada — mesmo a logica de retry (que existe
   e está correta) nunca chega a rodar.

A segunda variante de mensagem (WSAEACCES/10013, "proibida pelas permissoes de acesso") e um
erro **diferente** de EADDRINUSE por design — hoje `IsTCPAddrInUse` corretamente NAO trata como
"em uso" (nao ha checagem de 10013 em lugar nenhum). Isso pode ser correto (bloqueio de
seguranca real nao se resolve tentando outra porta) ou pode ser candidato a tambem entrar no
retry (uma porta especifica bloqueada por reserva do SO/antivirus enquanto outras portas
funcionariam) — ver Proximos passos.

## Como reproduzir

```powershell
# 1. Ocupar a porta padrao com outro listener:
#    (ex.: iniciar uma segunda instancia do proprio app, ou `python -m http.server 8080`)
# 2. Rodar o backend numa maquina/VM com Windows em locale PT-BR e conferir que ele morre
#    imediatamente com "[FATAL] Listen failed..." em vez de subir na porta 8081.
```

Ou unit test direto: chamar `IsTCPAddrInUse` com o erro real que `net.Listen("tcp",
"127.0.0.1:8080")` produz numa porta ja ocupada, numa goroutine/processo rodando com
`LC_ALL`/locale do SO forcado para `pt-BR`, e confirmar que hoje retorna `false`.

## Proximos passos

- Trocar a asserção direta por unwrap correto: usar `errors.As(opErr.Err, &errnoVar)` (ou
  `errors.Is(err, syscall.EADDRINUSE)` direto no erro original, que já percorre a cadeia
  `OpError -> SyscallError -> Errno` via `Unwrap()`) em vez de `opErr.Err.(syscall.Errno)`. Isso
  resolve o caso de forma independente de locale/idioma do SO.
- Manter o fallback de string como ultima linha de defesa, mas isso deixa de ser o caminho
  principal depois do fix do errno.
- Decidir se `WSAEACCES`/10013 tambem deveria entrar no retry (tentar a proxima porta) ou se deve
  seguir fatal — hoje sao 13 ocorrencias combinando os dois casos; util separar nos proximos
  eventos de telemetria uma vez que o fix do errno estiver ativo (o volume real de EADDRINUSE vai
  cair a zero, sobrando so os WSAEACCES genuinos para decidir).
- Adicionar teste de unidade cobrindo `IsTCPAddrInUse` com o erro real do Windows (nao só string
  fabricada em inglês) para travar a regressão.
