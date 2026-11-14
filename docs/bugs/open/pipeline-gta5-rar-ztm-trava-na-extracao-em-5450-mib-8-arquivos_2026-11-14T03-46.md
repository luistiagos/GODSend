# Bug: extração do `GTA 5` (`Grand.Theft.Auto.5.EUR.X360-ZTM.rar`) congela em `~5,41–5,47 GiB` (`8 arquivos concluídos`) na `v2.12.128`

- **Detectado em:** 2026-11-14 03:46 (Chamado `#371`, `+55 69 9979-3860`, e-mail `weslenamaral76@gmail.com`, máquina `DESKTOP-H1NAROL`, `v2.12.128`)
- **Origem:** `src/server/utils/iso2god.go` (`extractRarFilter`, `drainRAR`, `extractFileAtomically` com `github.com/nwaples/rardecode/v2 v2.4.1`), `src/server/services/pipeline/huggingface.go` (`ProcessHuggingFaceGameWithErr`), `src/server/cache/hf_xbox360.json` (`GTA 5` → `Grand.Theft.Auto.5.EUR.X360-ZTM.rar`)
- **Errors (serviço):** `13720` (`2026-11-12T22:51:59Z`), `13721` (`2026-11-12T23:00:04Z`), `13726` (`2026-11-12T23:45:52Z`) — sessão do mesmo job na máquina `DESKTOP-H1NAROL`; a extração em si não lançou erro capturado pela telemetria
- **Classe:** falha funcional / travamento silencioso de descompressão
- **Severidade:** P1 - Alto — impediu a instalação do `GTA 5` pelo Companion em 4 tentativas seguidas em dois dias; o cliente só conseguiu instalar baixando o mesmo `.rar` no navegador e extraindo pelo WinRAR
- **Complexidade:** alta — pipeline RAR (`rardecode/v2`), gerenciamento de staging em `D:\godsend-temp` e verificação com o pacote real de `14,36 GiB`
- **Versões:** `v2.12.128` (atual em produção)
- **Reincidência:** primeiro relato específico de travamento na extração `.rar` do `GTA 5` ZTM (distinto do problema antigo de layout/Conteúdo do Disco 1 em [[pipeline-gta5-multidisco-termina-pronto-e-nao-inicia-no-console-reincidencia_2026-10-15T15-40]])

## Sintoma

No Chamado `#371`, o cliente conseguiu baixar e instalar outros jogos normalmente pelo Companion (`Call of Duty 4 - Modern Warfare` `6518.9 MB` em `12/11`, `Call of Duty Classic` em `13/11`). Porém, ao tentar instalar o `GTA 5` (`Grand.Theft.Auto.5.EUR.X360-ZTM.rar`, `14700.1 MB`):

1. O download concluiu `100.0%` às `2026-11-12T21:24:18Z` e passou na verificação de integridade às `21:28:01Z` (`DOWNLOAD VERIFY [GTA 5]: concluido em 3m18.189s` em `err_13720_seq0.txt:1058-1059`). `ensureScratchSpace` em `D:\godsend-temp` também passou.
2. Apesar disso, a extração travou/degradou repetidamente sempre na mesma faixa (**`8 arquivos concluídos`, `5413–5468 MiB`**) em **4 execuções** nos dias 12 e 13/11:
   - `[178387]` (`12/11 21:50:10Z`): `Extraindo arquivos: 5448.6 MiB; 8 arquivos concluídos`
   - `[178408]` (`12/11 21:59:12Z`, +9 min): `5458.0 MiB; 8 arquivos concluidos` (apenas `+9.4 MiB` em 9 min ≈ `17.7 KiB/s`)
   - `[178585]` (`12/11 22:41:06Z`, +42 min): `5458.0 MiB; 8 arquivos concluidos` (`+0 MiB` em 42 min)
   - `[178716]` (`12/11 23:34:01Z`, 7 min após retomar): `5413.2 MiB; 8 arquivos concluídos` (não terminou até `13/11 18:44Z`)
   - `[179627]` / `[179640]` (`13/11 20:11Z` → `20:19Z`, após liberar `40 GB` no `C:`): `5468.7 MiB; 8 arquivos concluídos`
   - `[179711]` (`13/11 20:49:09Z`, imagem que abriu o Chamado `#371`, após mover `.exe` para `E:\Companion`): `5465.3 MiB; 8 arquivos concluidos`
3. Quando o cliente fechou o app via **Quit** durante o travamento às `22:48:20Z`, o processo `godsend-backend.exe` (`pid=11072`) permaneceu ativo mais de 3 min depois (`22:51:40Z`), causando `error_id=13719`.
4. Na noite de `13/11` para `14/11`, o cliente baixou manualmente o **mesmo arquivo `Grand.Theft.Auto.5.EUR.X360-ZTM.rar` (14,4 GB)** pelo navegador a partir do Archive.org, extraiu com **WinRAR** direto para `E:\Games` em ~17 min (`[180251]`), copiou `Disc2\content` para `E:\Content` e rodou o GTA 5 no console (`[180436]`).

## Causa raiz (parcialmente isolada; depende de reprodução no `.rar` real)

O que já está confirmado no código e logs:

1. `GTA 5` em `src/server/cache/hf_xbox360.json:4634-4636` aponta para `https://archive.org/download/mx360gcpt3-x360-ztm/Grand.Theft.Auto.5.EUR.X360-ZTM.rar`, extraído por `ProcessHuggingFaceGameWithErr` → `extractArchiveResilient` → `extractRarFilter` → `drainRAR` (`src/server/utils/iso2god.go:1051-1088`) usando `github.com/nwaples/rardecode/v2 v2.4.1`.
2. Em todas as sessões logadas (`13656`, `13720`, `13726`), o diretório de trabalho selecionado por `bestFixedVolume()` (`staging_windows.go:156`) foi `D:\godsend-temp` (inclusive mesmo que o `.exe` fosse movido para `E:\Companion`, porque `E:` é USB/FAT32 e é ignorado).
3. `drainRAR` passa `allowReuse = false` (`iso2god.go:1084`), fazendo cada tentativa reextrair todos os arquivos desde o byte 0, e a extração não emite logs diagnósticos nem detector de stall em `BACKEND_OUT` (ver [[pipeline-extracao-sem-log-diagnostico-nem-detector-de-stall_2026-11-14T03-46]]).

**Hipóteses a isolar na reprodução local com o `Grand.Theft.Auto.5.EUR.X360-ZTM.rar`:**

* **H1 (gargalo/loop ou falha de `rardecode/v2` na entrada ~9 do `.rar` ZTM):** o arquivo possui `sfx/audio_misc.rpf` (`2.76 GB`), `sfx/audio_radio.rpf` (`1.39 GB`), `sfx/audio_music.rpf` (`1.14 GB`) e os 4 pacotes `545408A700000000..3` (`~2.14 GB` cada). Caso seja RAR sólido ou use filtro/dicionário específico (ex.: áudio/VM/PPMd) onde `rardecode/v2` degrada drasticamente ou entra em loop sem progresso por volta de `~5,45 GiB`, isso explicaria por que **todas** as 4 tentativas pararam na mesma marca (`8 arquivos concluídos`) enquanto o WinRAR extraiu o mesmo arquivo em ~17 min.
* **H2 (travamento de escrita/I/O em `D:\godsend-temp`):** após escrever ~5,45 GiB somados aos 14,7 GB do `.rar`, alguma contenção de escrita/antivírus/disco em `D:` pode bloquear `Write`/`Sync` (o que também explicaria `pid=11072` continuar vivo após `kill()`).

## Como reproduzir

1. Baixar `Grand.Theft.Auto.5.EUR.X360-ZTM.rar` (`14.36 GiB`, `https://archive.org/download/mx360gcpt3-x360-ztm/Grand.Theft.Auto.5.EUR.X360-ZTM.rar`) e inspecionar headers RAR (`solid`, método, filtros, ordem real das entradas no `.rar`).
2. Rodar `utils.ExtractArchiveWithProgress` isoladamente medindo tempo/MB/s por entrada e uso de CPU/goroutines vs disco até concluir ou travar por volta de `5,45 GiB; 8 arquivos concluídos`.

## Resolução (vX.Y.Z)

*(Pendente de reprodução com o `.rar` real e implementação das correções de instrumentação/cancelamento)*

Caminhos possíveis após o diagnóstico:
1. Se confirmado gargalo/bug em `rardecode/v2`: corrigir/atualizar ou substituir o caminho de descompressão RAR problemático (ou avaliar empacotamento alternativo do `GTA 5` no catálogo caso seja limitação específica desse `.rar`).
2. Se confirmado problema de I/O/espaço no disco de trabalho durante a extração: garantir diagnóstico e falha rápida antes de congelar a fila.

## Testes Automatizados

*(Pendente — adicionar benchmark/teste de regressão cobrindo o padrão de entrada RAR que causou a degradação ou travamento)*

## Critérios para fechar

- [ ] Reprodução e causa raiz isoladas (`rardecode/v2` vs I/O em `D:`) no `Grand.Theft.Auto.5.EUR.X360-ZTM.rar`
- [ ] Correção implementada permitindo extração completa em tempo compatível (ou falha explícita sem congelar)
- [ ] Teste automatizado cobrindo o caso raiz
- [ ] Validação completa da suíte Go (`go test -count=1 ./...`)
