# Bug: as chaves do R2 vao na linha de comando do `rclone` na publicacao

- **Achado em:** 2026-11-10, no repo irmao `retrobatnew` (bug `montaversao-chaves-do-r2-na-linha-de-comando-do-rclone`,
  onde um monitor de sessao imprimiu a linha do `rclone` inteira, com as duas chaves, numa transcricao). Uma busca nos
  outros projetos achou a mesma forma aqui.
- **Classe:** seguranca / ferramentas de publicacao. **Gravidade:** media.
- **Estado:** corrigido e testado em 2026-11-10, em `retest/`. Vai para `closed/` quando a proxima publicacao real
  (`build-and-upload.ps1` ou `upload-r2.ps1`) passar pelo R2 sem erro.

## Sintoma

`upload-r2.ps1` e `build-and-upload.ps1` montavam `$s3Flags` com `--s3-access-key-id=<chave>` e
`--s3-secret-access-key=<chave>`. A linha de comando de um processo e legivel por qualquer processo do mesmo usuario
(Gerenciador de Tarefas, `Get-CimInstance Win32_Process`, `wmic`, antivirus, ferramentas de agente) enquanto o upload
roda, e ferramentas de diagnostico a gravam em log.

## Correcao

Funcao `Invoke-R2Rclone $rclone $cfg <args>` nos dois scripts (texto identico ao dos outros repos que publicam no
mesmo R2): poe `RCLONE_S3_ACCESS_KEY_ID` / `RCLONE_S3_SECRET_ACCESS_KEY` (nomes de `rclone help backend s3`, v1.75.0)
no ambiente **so durante a chamada**, tira as `RCLONE_*` herdadas (em DEBUG o rclone imprime o valor que leu do
ambiente) e devolve tudo no `finally`. Nao e `$env:` uma vez no comeco porque o script roda dentro do PowerShell de
quem o chama, e a chave ficaria no console depois. `$s3Flags` perdeu as duas flags; todo `& $rclone` virou
`Invoke-R2Rclone $rclone $cfg`.

## Validacao

Harness descartavel (fora do repo) sobre cada script editado, com as chaves do R2 so no ambiente do harness e
`RCLONE_VERBOSE=2` + `RCLONE_LOG_LEVEL=DEBUG` simulando quem publica com DEBUG:

- estatico: nenhuma flag de chave no script, nenhum `& $rclone` direto, `Invoke-R2Rclone` definida uma vez; o script
  inteiro passa pelo parser do PowerShell sem erro;
- a funcao extraida do script, contra o R2 de verdade (pasta `_teste-montaversao/` do bucket `versions`): `lsjson -R`
  rc 0; segredo errado -> 403 `SignatureDoesNotMatch` (controle negativo); `copyto` de 32 KB com `--header-upload` e
  `--progress` rc 0 e tamanho conferido no remoto; `deletefile` rc 0; pasta com 0 objetos no fim;
- nos 6 `rclone` de cada script, lidos pelo SO (psutil, mesma fonte do `Win32_Process`): chave fora da linha de
  comando, as duas no ambiente, nenhuma `RCLONE_*` herdada; depois, nenhuma chave no ambiente do PowerShell e as
  `RCLONE_*` dele restauradas. Zero vazamentos na saida.

Limite: o build/publicacao inteiro nao foi rodado (publicaria uma versao). Por isso o `closed/` espera a proxima
publicacao real.

## Licao

Chave nunca vai em argumento de processo filho; vai no ambiente dele, e so dele.
