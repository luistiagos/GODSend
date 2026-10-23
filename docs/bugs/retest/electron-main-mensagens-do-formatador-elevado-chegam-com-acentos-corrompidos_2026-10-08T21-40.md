## Status

- **Corrigido:** 2026-10-10, commit `8668b6f` (pipeline 20261010-2242); testado em 2026-10-11 (rodada de teste 1, aprovado).
- **Onde:** `src/electron-app/infrastructure/fat32Format.ts::writePowerShellScript` (grava o `.ps1` com BOM UTF-8) usado por
  `::formatWindowsFat32`; harness `scripts/vhd-format-test/run-elevated.ps1` grava a cópia com BOM.
- **Evidência:** `C:/projects/.bugfix-xbox360/evidencia/20261011-2220-electron-main-mensagens-do-formatador-elevado-chegam-com-acentos-corrompidos_2026-10-08T21-40`
  - T2 (equivalente executável, UI dispensada pelo motivo do Planejamento: disco real proibido e UAC sem dono): teste (b)
    `PowerShell 5.1 com -File le acento do texto e do caminho...` — com o fix 20 pass / 0 fail (`T2-fix.txt`).
    Controle positivo (o `.js` da lane sem o BOM, restaurado em seguida): 18 pass / 2 fail, o (b) com
    `Out-File : Nao foi possível localizar uma parte do caminho '...fat32-A?rea...'` (`T2-base-sem-bom.txt`).
  - T3: `go test -count=1 ./...` rc 0, 9 pacotes ok (`T3-go.txt`); `test:safety` 321 pass / 0 fail (`T3-safety.txt`).
  - T4: não aplicável — o app não foi aberto (o caminho do fix só roda formatando disco real).
- **Falta para `closed/`:** versão publicada; formatação real (pendrive ≤ 32 GB e HD > 32 GB) com mensagem de falha legível;
  cliente com perfil do Windows com acento formatando HD > 32 GB pelo portátil; complemento do harness VHD elevado (não rodado:
  sessão sem elevação).

# Bug: as mensagens do formatador elevado (Windows) chegam ao usuário com acentos corrompidos

- **Detectado em:** 2026-10-08 21:40, no teste em VHD do bug
  [`badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09.md`](../open/badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09.md)
  (seção "Teste em VHD")
- **Origem:** logs do formatador nos 7 cenários do teste, mais a leitura de `infrastructure/fat32Format.ts::formatWindowsFat32`
- **Errors (serviço):** N/A. A mensagem corrompida só aparece quando a formatação falha, e o texto do erro é o mesmo que vai para o report
- **Classe:** cosmético/diagnóstico. O texto da falha fica ilegível, mas o resultado da formatação não muda
- **Severidade:** P3 (baixo)
- **Estado:** só o sintoma e a causa provável. Causa não confirmada por teste; correção não planejada

## Sintoma

Em todos os logs do teste (`S1.format.log` … `S7.format.log`), a linha que o script grava como
`"Formatação FAT32 concluída com sucesso."` saiu como:

```
FormataÃ§Ã£o FAT32 concluÃ­da com sucesso.
```

As linhas sem acento saíram certas. A saída do `diskpart` também (`DiskPart está limpando o disco.`), porque ela
vem do processo externo e não do texto do script.

## Causa provável (lida no código, não testada)

- `formatWindowsFat32` grava o script com `fs.writeFileSync(ps1Path, innerScript, "utf8")`
  ([`fat32Format.ts:654`](../../../src/electron-app/infrastructure/fat32Format.ts#L654)). Isso é UTF-8 **sem BOM**.
- `runPs1Elevated` roda o arquivo com `-File` no Windows PowerShell 5.1 (System32). O 5.1 lê `.ps1` sem BOM na
  página de código ANSI, e cada caractere acentuado do script vira dois.
- Na falha, o `catch` do script grava `($_ | Out-String)` no log. `formatWindowsFat32` lê o fim do log
  (`readLogTail`, [linha 657](../../../src/electron-app/infrastructure/fat32Format.ts#L657)) e o lança como `Error`
  ([linha 669](../../../src/electron-app/infrastructure/fat32Format.ts#L669)). As mensagens de `throw` com
  acento chegam assim ao usuário e ao report. Exemplos: `O destino não é um disco USB externo seguro`, `A unidade
  X: mudou antes da formatação`, `Para unidades maiores que 32 GB é necessário o utilitário fat32format.exe`.

Correção provável: gravar o `.ps1` com BOM (`"\uFEFF" + innerScript`). Antes de mudar, conferir se algum
teste ou leitor depende do arquivo sem BOM. `readFormattedPartitionBytes` já tolera `\uFEFF`.

## Como reproduzir

`node src/electron-app/scripts/vhd-format-test/generate.cjs <dir>` e, elevado,
`run-elevated.ps1 -WorkDir <dir>`. Depois, procurar `concluÃ` em `<dir>/S1.format.log`.

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** corrigir — gravar o `.ps1` do formatador elevado com BOM UTF-8; a causa provável do doc foi confirmada no PowerShell 5.1 desta máquina.
**Complexidade:** alta — pelo critério do `docs/bugs/open/README.md` (`fat32Format.ts`, formatação de disco). A mudança em si é de uma linha e não toca a lógica do script.
**Severidade:** medio — além do texto ilegível (cosmético), a mesma causa quebra **caminhos com acento** embutidos no script: em perfil do Windows com acento (`C:\Users\João`), o log não é gravado e o `fat32format.exe` do portátil (extraído em `%TEMP%`) não é achado, então HD > 32 GB não formata e a mensagem que chega é a genérica. Atinge só esse subconjunto e há contorno (formatar fora do app).
**Arquivos a alterar (reserva da onda):**
- `src/electron-app/infrastructure/fat32Format.ts` — `formatWindowsFat32` grava o script com BOM (por um helper exportado, para o teste chegar nele)
- `src/electron-app/tests/unit/fat32FormatGuard.test.cjs` — testes do BOM e da execução real no PowerShell 5.1 com acento no texto e no caminho
- `src/electron-app/scripts/vhd-format-test/run-elevated.ps1` — o harness do VHD regrava a cópia de teste sem BOM (`$utf8NoBom`); precisa gravar com BOM para reproduzir o app

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

- `src/electron-app/infrastructure/fat32Format.ts::formatWindowsFat32` (l. 626-700) — monta o script com
  `buildGuardedWindowsFat32Script` e o grava com `fs.writeFileSync(ps1Path, innerScript, "utf8")` (l. 654): UTF-8
  **sem BOM**. Roda com `runPs1Elevated` e, com `code !== 0`, lança `Error(detail)` onde `detail = readLogTail(logPath)`
  (l. 657, 668-670); com `detail` vazio, a mensagem é a genérica `"A formatação falhou. Feche outros programas..."`. No
  sucesso, `partitionBytes = readFormattedPartitionBytes(readLogTail(logPath, Infinity))` (l. 672); `finally` apaga `.ps1` e `.log`.
- `fat32Format.ts::runPs1Elevated` (l. 578-602) — `powerShellExe()` (o `powershell.exe` do System32, **5.1**) com
  `buildElevationScript`, que faz `Start-Process ... -Verb RunAs ... -File '<ps1>'` (l. 567-575). O 5.1 lê `-File` sem BOM
  na página ANSI (1252 em pt-BR): cada caractere UTF-8 de 2 bytes vira 2 caracteres (`ç` → `Ã§`).
- `fat32Format.ts::buildGuardedWindowsFat32Script` (l. 63-528) — embute no texto do script, como literais: `$log` (caminho
  em `os.tmpdir()`), `$exePath` (de `resolveFat32FormatExe`, sob `getBundledRoot()`), `$targetLabel`, e as mensagens de
  `throw` com acento (l. 267, 275, 278, 282, 402, 424, 515). O `catch` (l. 516-519) grava `($_ | Out-String)` no log e
  `exit 1`; o `finally` restaura o Defender. Todo `Out-File` usa `-Encoding utf8` (5.1 grava BOM só na criação; o `-Append`
  não repete — medido abaixo).
- `fat32Format.ts::readLogTail` (l. 550-559) — lê o log como UTF-8; em erro devolve `""`. `trim()` remove o BOM inicial.
- `fat32Format.ts::readFormattedPartitionBytes` (l. 38-42) — regex `^\uFEFF?Particao final:` já tolera BOM.
- `src/electron-app/infrastructure/fileSystem.ts::getBundledRoot` — empacotado: `path.dirname(process.execPath)`. No portátil
  é `%TEMP%\ns<aleatório>.tmp\app` (AGENTS.md, `build/portable.nsi`), ou seja, dentro do perfil do usuário.
- `services/fixedBadAvatarPreparationService.ts:527` — `waitForFormattedDevice(..., formatted.partitionBytes ?? expectedVolumeBytes)`:
  sem log, cai para o tamanho de antes da formatação, que diverge quando a tabela foi recriada.

### Provas (comando literal -> resultado)

Script gerado por Node exatamente como o app (`fs.writeFileSync(p, s, "utf8")`, e a variante com `"\uFEFF" + s`),
contendo `"Formatação FAT32 concluída com sucesso." | Out-File $log -Append -Encoding utf8` e
`throw "O destino não é um disco USB externo seguro (disco=1)."` dentro de `try/catch` igual ao do formatador; rodado com
`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File <ps1>`:

```
sem BOM -> log: "FormataÃ§Ã£o FAT32 concluÃ­da com sucesso." / "O destino nÃ£o Ã© um disco USB externo seguro (disco=1)."  exit 1
com BOM -> log: "Formatação FAT32 concluída com sucesso."     / "O destino não é um disco USB externo seguro (disco=1)."     exit 1
BOMs no log (efbbbf) nos dois casos: 1   (Out-File -Append -Encoding utf8 não repete o BOM)
```

Caminho com acento (`...\tmp\bom\Área de Trabalho\`), `$log` e `$exePath` (arquivo existente) embutidos no script:

```
sem BOM -> Out-File : Nao foi possível localizar uma parte do caminho '...\A?rea de Trabalho\nobom.log'.  (log não existe)
com BOM -> log criado; "exe existe: True"
```

### Hipoteses descartadas (e por que)

- **Mesma causa do bug do CHKDSK** (`retest/electron-main-saida-do-chkdsk-...`): lá é a saída de processo externo lida como
  UTF-8 (`�`, um por letra); aqui é o script lido como ANSI pelo PowerShell (`Ã§`, dois por letra). Correções diferentes.
- **Trocar o `-Encoding utf8` dos `Out-File` ou o `readLogTail`**: a gravação e a leitura do log já concordam (UTF-8); o
  texto chega errado ao log porque a string já nasceu errada na leitura do `.ps1`. Provado acima: só o BOM muda o resultado.
- **Tirar os acentos do script (ASCII)**: resolveria as mensagens, mas não os caminhos (`$log`, `$exePath`) com acento, que
  vêm do sistema do usuário.
- **`windowsUsbDeviceService.ts::runPowerShell` (grava `usb.ps1` sem BOM)**: mesmo padrão, mas o texto do script não tem
  caractere fora do ASCII (os acentos do arquivo estão em mensagens TS, l. 57/83/186/558) e não embute caminho do usuário. Não é bug hoje; não entra.
- **Algum leitor depende do `.ps1` sem BOM**: o `.ps1` só é lido pelo `-File` do PowerShell (5.1 e 7 aceitam BOM) e é apagado
  no `finally`. O `generate.cjs` do harness grava o template à parte (não usa `formatWindowsFat32`), e o `run-elevated.ps1` o lê
  com `ReadAllText`, que descarta BOM.

### Tarefas

- [ ] `src/electron-app/infrastructure/fat32Format.ts` — novo `export function writePowerShellScript(filePath, script)` que grava
  `"\uFEFF" + script` em UTF-8 (comentário citando `[[electron-main-mensagens-do-formatador-elevado-chegam-com-acentos-corrompidos_2026-10-08T21-40]]`
  e o porquê: PowerShell 5.1 lê `-File` sem BOM na página ANSI); `formatWindowsFat32` l. 654 passa a usá-lo. — teste: os bytes do arquivo começam com `EF BB BF` e o resto é o script.
- [ ] `src/electron-app/tests/unit/fat32FormatGuard.test.cjs` — (a) BOM no arquivo gravado pelo helper; (b) só win32 (`t.skip` fora):
  numa pasta temporária com acento (`Área ç`), gravar pelo helper um script com `$log` e um `throw "O destino não é..."` em
  `try/catch` + `Out-File -Encoding utf8`, rodar `powershell.exe` do System32 com `-File` (sem elevação) e conferir que o log
  existe e contém `não é` e não contém `Ã`. Controle: o mesmo teste com `fs.writeFileSync(p, s, "utf8")` tem de falhar (o dev
  confere uma vez à mão, revertendo a linha).
- [ ] `src/electron-app/scripts/vhd-format-test/run-elevated.ps1` l. 83 — gravar `$ps1` com `New-Object System.Text.UTF8Encoding($true)` (BOM), para a
  cópia de teste ser lida como a do app. — prova: `generate.cjs --verify` de uma rodada elevada (opcional; ver Plano de teste).
- [ ] `CHANGELOG.md` `[Unreleased]` / `### Fixed` (não reservado; `merge=union`).

### Plano de teste

- **Offline (sem slot):** `npm --prefix src/electron-app run test:safety` com os testes novos (o (b) roda PowerShell 5.1 real, sem
  elevação nem disco). Conferir também que o teste existente `o tamanho final da particao chega ao app pela linha do log` segue verde.
- **T2 reproducao como o usuario (E2E, no slot):** **dispensa a UI, com motivo:** o caminho do cliente é BadAvatar USB → escolher o
  disco → marcar "Formatar antes" → Preparar; isso exige disco real (proibido pelo manual: nenhum disco liberado) e aceitar o UAC
  (sessão sem dono). O equivalente executável é o teste (b) acima, que roda o script gravado pelo MESMO helper do app no MESMO
  `powershell.exe` do System32 com `-File`, com acento no texto e no caminho; sinal: log presente, `não é` legível, sem `Ã`.
  Complemento, só se a sessão de teste já estiver elevada: `node src/electron-app/scripts/vhd-format-test/generate.cjs <dir>`
  (depois do `tsc` da lane) + `run-elevated.ps1 -WorkDir <dir>` + `generate.cjs --verify <dir>`; sinal: `S1.format.log` com
  `Formatação FAT32 concluída com sucesso.` e sem `concluÃ`, e os 7 cenários sem regressão.
- **Controle positivo:** sem o fix (linha 654 com `writeFileSync(..., "utf8")`), o teste (b) falha: log com `nÃ£o Ã©`, e com acento
  no caminho o log nem é criado (provado acima nesta máquina). Sem `deploy --at-base` neste projeto: o controle é o teste na base.
- **T3 regressao direcionada:** o formatador como um todo (`fat32FormatGuard.test.cjs` inteiro, que valida sintaxe do script e as
  funções dentro do PowerShell), `readFormattedPartitionBytes` com o BOM do log, e a bateria do manual (`go test -count=1 ./...` em
  `src/server`, `test:safety`). Fluxos vizinhos que o fix não toca mas usam PowerShell: enumeração de USB (`usb.ps1`) — sem mudança.
- **Falta para close:** formatação real num disco (pendrive ≤ 32 GB e HD > 32 GB) com mensagem de falha legível, e um cliente com
  perfil do Windows com acento formatando HD > 32 GB pelo portátil.

### Sessoes seguintes

- dev: effort medium, ultrathink nao — troca mecânica e localizada (um helper de gravação + testes); não mexe na lógica do script de formatação.
- teste: effort low, ultrathink nao — T2 é o teste automatizado com PowerShell real; o sinal é binário (`Ã` presente ou não).

## Correcao (pipeline 20261010-2242, rodada 1)

- `src/electron-app/infrastructure/fat32Format.ts::writePowerShellScript` (novo, exportado) — grava o `.ps1` com BOM UTF-8
  (`"\uFEFF" + script`). `::formatWindowsFat32` passa a gravar o script elevado por ele, no lugar do
  `fs.writeFileSync(ps1Path, innerScript, "utf8")`. Comentario no codigo cita o slug. Nada mais mudou no script de formatacao.
- `src/electron-app/tests/unit/fat32FormatGuard.test.cjs` — dois testes novos: (a) `o script elevado e gravado com BOM UTF-8`
  (bytes `EF BB BF` + o texto intacto); (b) `PowerShell 5.1 com -File le acento do texto e do caminho do script gravado pelo app`
  (so win32): pasta temporaria `fat32-Área ç-*`, script gravado pelo helper com `$log` embutido e `throw "O destino não é..."` em
  `try/catch` + `Out-File -Encoding utf8`, rodado no `powershell.exe` do System32 com `-File`; confere exit 1, log existente, texto
  legivel e sem `Ã`.
- `src/electron-app/scripts/vhd-format-test/run-elevated.ps1` — novo `$utf8Bom`; a copia `<id>.run.ps1` e gravada com ele (antes
  `$utf8NoBom`), para o harness do VHD ler o script como o app.
- `CHANGELOG.md` `[Unreleased]` / `### Fixed` — entrada nova.

**Provas (dev, nesta lane, apos `build` do helper rc 0):**
- `node --test tests/unit/fat32FormatGuard.test.cjs` -> 20 pass / 0 fail (inclui `o tamanho final da particao chega ao app pela linha do log`).
- Controle: no `.js` compilado, `"\uFEFF" + script` trocado por `script` (sem BOM) -> 18 pass / 2 fail, os dois novos; o (b) falha com
  `Out-File : Nao foi possível localizar uma parte do caminho '...\fat32-A?rea ...'` (o log nem e criado). `.js` restaurado em seguida.
- `node --test tests/unit/*.test.cjs` -> 321 pass / 0 fail.

**Ajustes ao Plano de teste:** nenhum. O T2 segue sendo o teste (b) (dispensa de UI pelo motivo do Planejamento); o complemento do
harness VHD so se a sessao de teste estiver elevada.
