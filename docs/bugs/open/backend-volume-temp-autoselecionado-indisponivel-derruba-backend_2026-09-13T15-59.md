# Bug: volume de trabalho escolhido automaticamente some e derruba o backend (ou todos os jobs da sessão)

- **Detectado em:** 2026-09-13 15:59 (telemetria de produção)
- **Origem:** telemetria `xbox-360-companion/backend` (`main.go::main`) e `xbox-360-companion/pipeline` (`fallback.go::ProcessGameWithFallback`)
- **Errors (serviço):** 6276 (boot, 2026-09-13 15:59:40); 6023, 6025, 6026, 6027, 6028, 6029, 6032, 6035, 6037, 6046 (10 jobs seguidos, 2026-09-12 02:14–02:46)
- **Classe:** crash no boot (6276, `os.Exit(1)`) + fail em sequência (os outros 10)
- **Versões:** `backend`/`pipeline` não mandam versão; o trecho está igual no código atual (v2.12.93)
- **Reincidência:** 11 reports, 2 dias

## Sintoma

Boot:

```
SetupPaths failed: processing temp dir: mkdir D:\godsend-temp: The device is not ready.
```

Na véspera, dez jogos da fila, um atrás do outro por 32 minutos, todos no primeiro arquivo
que a extração tenta gravar no scratch:

```
Falha de armazenamento local para Lego Batman 1 (xbox360) em huggingface: Extract failed:
falha no dispositivo local: fase extract-archive:
open D:\godsend-temp\proc\Lego Batman 1_hf_ext.xbox-stage-source.json.new:
The system cannot find the path specified.
```

(o mesmo para `Lego Batman 2`, `Lego Batman 3`, `Lego Dimensions`, `Lego Harry Potter Years
1-4`, `5-7`, `Lego Indiana Jones 1`, `2`, `Lego Jurassic World`, `Lego Star Wars 2`).

A pasta que não existe é `D:\godsend-temp\proc` inteira, não um arquivo dentro dela.

## Causa raiz

`D:\godsend-temp` não é configuração do usuário: é o volume que o app **escolheu sozinho**.

1. **Seleção automática.** `SetupPaths` (`app/config.go:423-429`) troca `TempDir` para
   `<volume>\godsend-temp\proc` sempre que `bestFixedVolume()` acha um volume diferente do
   do app com mais espaço livre. `fixedLargeFileVolumes()` (`app/staging_windows.go:20-67`)
   só filtra por `GetDriveTypeW == DRIVE_FIXED` e NTFS/exFAT. **HD e SSD externos por USB se
   apresentam como `DRIVE_FIXED`**, então o comentário "Removable drives ... are skipped"
   (`staging_windows.go:70-72`) não os exclui.
2. **Falha no volume escolhido é fatal no boot.** `config.go:442-444` chama
   `markScratchOwner(a.TempDir)` e devolve o erro; `main.go:27-32` faz `os.Exit(1)`. Não há
   volta para o `ToolsDir/Temp` padrão, que é exatamente o que o app usaria se o volume nem
   tivesse sido listado. Uma otimização de espaço vira backend fora do ar.
   Note que o volume **passou** em `GetVolumeInformationW` e `GetDiskFreeSpaceExW`
   (`staging_windows.go:43-63`) — senão teria sido pulado — e o `MkdirAll` falhou logo em
   seguida com `ERROR_NOT_READY`: o disco estava saindo ou dormindo naquele instante.
3. **O volume é decidido uma vez por sessão e nunca revalidado.** Se ele some com o backend
   rodando, `outputRoot()` (`services/pipeline/workspace.go:18-20`) continua devolvendo
   `D:\godsend-temp\proc` e **todo** job seguinte falha na primeira gravação. A falha é
   classificada como "falha no dispositivo local" e para aquele job; a fila passa para o
   próximo, que falha igual — os 10 reports de 02:14 a 02:46.

### Descartado

`handlers.go:1191-1195` (limpar tudo) faz `RemoveAll(d.App.TempDir)`, mas recria a pasta na
linha seguinte; não explica 32 minutos seguidos sem ela. `cleanupStaleScratchDir` apaga
entradas **dentro** de `proc`, nunca `proc`.

### Máquina

Os dez jogos são a mesma fila de Legos que a máquina C do bug
[`electron-main-multiplas-instancias-sem-single-instance-lock`](electron-main-multiplas-instancias-sem-single-instance-lock_2026-09-15T14-44.md)
tentou na véspera com o `C:` cheio (`...\runtime\Temp\Lego Batman 1_hf_ext\...`, 2026-09-11)
— ou seja, muito provavelmente o usuário ligou um disco `D:` para ganhar espaço, o app passou
a usá-lo, e o disco caiu. A mesma máquina tinha 7 instâncias simultâneas às 01:53 desse dia
(6016); instâncias que subiram antes e depois de o `D:` aparecer têm `TempDir` diferentes,
o que só piora. 6276 não traz log nem usuário: é compatível, não comprovado.

## Como reproduzir

1. Máquina com `C:` apertado e um HD/SSD externo USB em NTFS com mais espaço livre.
2. Abrir o app: o log mostra `Processing/torrent temp auto-selected roomiest drive: X:\godsend-temp`.
3. **Boot:** fechar o app, ejetar o disco sem remover a letra (ou deixar dormir) e reabrir →
   `SetupPaths failed ... The device is not ready`, backend não sobe.
4. **Sessão:** com o app aberto, enfileirar 2 jogos e desconectar o disco durante o download
   do primeiro → os dois falham em `fase extract-archive: open X:\godsend-temp\proc\...`.

## Próximos passos

1. Em `SetupPaths`, se `markScratchOwner` falhar no volume **auto-selecionado**, logar,
   voltar para `ToolsDir/Temp` e seguir. Continuar fatal só quando for o `ToolsDir` ou um
   caminho explícito (`GODSEND_TORRENT_TEMP`).
2. Excluir da seleção automática discos no barramento USB (`IOCTL_STORAGE_QUERY_PROPERTY` →
   `BusType == BusTypeUsb`), ou pelo menos preferi-los por último. O comentário de
   `staging_windows.go:70-72` promete isso e o filtro por `DRIVE_FIXED` não entrega.
3. Revalidar o volume de trabalho no início de cada job (existe e aceita escrita); se sumiu,
   voltar para `ToolsDir/Temp` e avisar, em vez de derrubar a fila inteira.
4. Critério de reabertura depois do fix: `SetupPaths failed` com `godsend-temp` na mensagem,
   ou `fase extract-*` com `cannot find the path` em `godsend-temp` num build com o item 1/3.
