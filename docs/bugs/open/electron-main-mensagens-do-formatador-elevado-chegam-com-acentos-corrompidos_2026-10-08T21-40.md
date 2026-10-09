# Bug: as mensagens do formatador elevado (Windows) chegam ao usuário com acentos corrompidos

- **Detectado em:** 2026-10-08 21:40, no teste em VHD do bug
  [`badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09.md`](badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09.md)
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

Correção provável: gravar o `.ps1` com BOM (`"﻿" + innerScript`). Antes de mudar, conferir se algum
teste ou leitor depende do arquivo sem BOM. `readFormattedPartitionBytes` já tolera `﻿`.

## Como reproduzir

`node src/electron-app/scripts/vhd-format-test/generate.cjs <dir>` e, elevado,
`run-elevated.ps1 -WorkDir <dir>`. Depois, procurar `concluÃ` em `<dir>/S1.format.log`.
