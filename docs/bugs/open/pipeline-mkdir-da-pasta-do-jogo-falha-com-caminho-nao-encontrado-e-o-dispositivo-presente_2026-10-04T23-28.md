# Bug: gravar no HD falha em `mkdir D:\Games\<jogo>` com "O sistema não pode encontrar o caminho especificado", com o dispositivo presente, e a mensagem manda o cliente (e o agente) procurar um pendrive desconectado

- **Detectado em:** 2026-10-04 23:28 (chamado #144 do painel, sessão `165291833184337@lid`, telefone `553196998502`)
- **Origem:** conversa de suporte + telemetria `xbox-360-companion/pipeline` (`fallback.go::ProcessGameWithFallback`) + leitura de `src/server/services/pipeline/local_resilient.go` (`Service.copyTreeLocal` / `Service.copyFileLocal`, `copyLocalEntry`, `localDeviceMatches`)
- **Errors (serviço):** 6938, 7026, 7031, 7162, 7166, 7169, 7202, 8560, 8565 (9 reports, 2026-09-16 12:28 → 2026-09-25 13:49 UTC, todos com `status = close` na telemetria e **nenhum** citado em doc: grep pelos ids em `docs/` = 0)
- **Classe:** falha funcional (recorrente, sem crash)
- **Severidade:** **P2 — Médio** (matriz de [`bug-triage.md`](../../agents/skills/bug-triage.md)): o download é preservado para nova tentativa, mas a cliente do #144 ficou pelo menos 2 dias sem conseguir gravar jogos no HD, com 5 jogos diferentes. Subir para P1 se a medição mostrar que o volume fica inutilizável.
- **Complexidade:** média — a causa não está provada; o primeiro passo é instrumentar
- **Versões:** desconhecidas. O report do pipeline não carrega versão nem máquina (`user_agent = 'pipeline'`, `screen = NULL`), e o log anexo (`error_logs`) dos ids 7026, 7202 e 8565 é um segmento único de ~181 caracteres, igual à mensagem
- **Reincidência:** primeira vez como sintoma próprio. Vizinhos, sem cobrir este caso: [[backend-volume-temp-autoselecionado-indisponivel-derruba-backend_2026-09-13T15-59]] (scratch em `D:\godsend-temp`, dispositivo **ausente**) e [[electron-main-multiplas-instancias-sem-single-instance-lock_2026-09-15T14-44]] (instâncias simultâneas; ids não listados lá)

## Sintoma, na ordem que o cliente viveu

1. 2026-09-14: preparou o HD externo de 2 TB no modo Bloqueado/LT; o volume aparece como
   `BADAVATAR (D:)`. No preparo já houve um erro de `mkdir` no mesmo volume (ver
   [[electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28]]).
2. 2026-09-16 22:53 UTC: *"hoje não estou conseguindo baixar nenhum jogo novamente"*. Print da
   fila: "Disney-Pixar Up" baixando, **erro em "F1 2014"**, "UFC Undisputed 3" pendente.
3. 22:56: print do erro: *"Falha no dispositivo local. O download concluído foi preservado para
   nova tentativa: Gravação local falha no dispositivo local. gravar AvatarAssetPack: mkdir
   D:\Games\F1.2014.USA.X360-ZTM - 434D0852: O sistema não pode encontrar o caminho
   especificado."*
4. 23:01: print do destino do jogo, *"Pendrive (USB)"* e *"D:—BADAVATAR · 1887.7 GB livres"*:
   o destino estava certo.
5. 23:05: print de Este Computador com *"BADAVATAR (D:)"* presente.

## Evidencia

**Telemetria** (`/diag/query`, tabela `errors`, `project LIKE 'xbox-360-companion%'`, mensagem com
`AvatarAssetPack` ou `mkdir` + `caminho especificado`; 9 linhas, todas no mesmo formato):

| id | hora (UTC) | arquivo que falhou | pasta do `mkdir` |
|---|---|---|---|
| 6938 | 09-16 12:28 | `0L` | `D:\Games\College.Hoops.2K8.USA.X360-ZTM - 54540818` |
| **7026** | **09-16 22:51** | `AvatarAssetPack` | `D:\Games\F1.2014.USA.X360-ZTM - 434D0852` |
| 7031 | 09-16 23:42 | `AvatarAssetPack` | `D:\Games\Dragon.Ball.Z.USA.X360-ZTM - 4E4D084E` |
| 7162 | 09-17 14:27 | `AvatarAssetPack` | `D:\Games\Dragon.Ball.Z.USA.X360-ZTM - 4E4D084E` |
| 7166 | 09-17 15:04 | `Data00.packed` | `D:\Games\Castlevania.Lords.of.Shadow.2…` |
| 7169 | 09-17 15:14 | `8E0A912724F258B7EFC5` (GOD) | `D:\Games\Toy Story 3 - 425607E5` |
| 7202 | 09-17 19:03 | `AvatarAssetPack` | `D:\Games\UFC.Undisputed.2010.USA.X360-ZT - 54510851` |
| 8560 | 09-25 13:28 | `destructionsound.lxb` | `D:\Games\Kung.Fu.Panda.1.USA.X360-ZTM…` |
| 8565 | 09-25 13:49 | `AvatarAssetPack` | `D:\Games\Left 4 Dead 2 (4.33) - 454108D4` |

O **7026** é o print da cliente: mesmo jogo, mesma pasta, 5 min antes do print. Os demais não
têm como ser atribuídos a uma máquina (sem versão nem id no report).

**O dispositivo estava presente na falha. Provado pelo código**, não pelo relato:
`local_resilient.go` só monta `"%w: gravar %s: %v"` com `ErrLocalDelivery` depois de
`localDeviceMatches(root, expectedID)` devolver **true**, ou seja, depois de o marcador de
identidade gravado na raiz da mídia ser lido e bater. Isso vale nos dois laços
(`copyTreeLocal` e `copyFileLocal`). Com o dispositivo ausente ou trocado, o caminho é
`waitForLocalDevice`. Ainda houve 3 novas tentativas de 1 s (`transientRetries < 3`). O que falha
é o `os.MkdirAll(filepath.Dir(dst), 0755)` de `copyLocalEntry`. `AvatarAssetPack` é só o
primeiro arquivo do jogo (o nome varia entre os 9 reports), então **quem falha é a criação da
pasta do jogo**, não um arquivo.

**Efeito no atendimento:** "Falha no **dispositivo local**" foi lido pelo agente de WhatsApp como
"pasta do computador" e "pendrive desconectou". Os três diagnósticos que ele deu estão errados
(evidência anexada a
`digitalstoregamesproject/docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-08-15-agente-inventa-procedimento-tecnico-sem-regra-de-abstencao.md`).
A mensagem não diz ao cliente o que fazer.

## Hipoteses — nenhuma verificada

1. **Volume FAT32 inconsistente.** A mesma mídia já tinha falhado em `mkdir` no preparo, dois
   dias antes, com um erro `UNKNOWN` do Node. Um `mkdir` com `ERROR_PATH_NOT_FOUND` e o pai
   presente é compatível com estrutura de diretório corrompida. Medir: `chkdsk D:` na mídia de
   um cliente afetado; tamanho/sistema de arquivos dos volumes nos reports (hoje não reportado).
2. **Instâncias simultâneas** (corrigido na v2.12.95 por
   [[electron-main-multiplas-instancias-sem-single-instance-lock_2026-09-15T14-44]]): uma instância
   removendo ou renomeando a pasta do jogo enquanto a outra a cria. Medir: se os reports de 09-25
   (8560, 8565) vierem de versão ≥ v2.12.95, a hipótese cai para eles. Hoje o report não diz a
   versão.
3. **Descartada: o nome da pasta.** São 8 jogos diferentes, com e sem espaço, parênteses e
   ponto; nenhum padrão comum além de `D:\Games\`.

## Escopo — o que NAO e este bug

- Dispositivo **ausente** ou trocado de letra: tem caminho próprio (`waitForLocalDevice`) e doc
  próprio (o do `D:\godsend-temp`).
- A cota do Google Drive de 09-14 (`[108943]`): caminho da planilha, não do Companion.
- A falha do preparo não chegar à telemetria: doc irmão
  [[electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28]].

## Tarefas propostas / Proximos passos

1. Report do pipeline com **versão do app, id anônimo da máquina e sistema de arquivos/tamanho do
   volume de destino**. Sem isso nenhuma das hipóteses se mede.
2. Na falha de `MkdirAll` com o dispositivo presente, anexar ao report o `os.Stat` de cada
   componente do caminho (`D:\`, `D:\Games`) e o código Win32 original (`errors.As` para
   `syscall.Errno`).
3. Mensagem ao usuário que diga o que fazer quando o dispositivo está presente e a gravação
   falha (hoje "Falha no dispositivo local" sugere desconexão). Ex.: verificar o disco
   (`chkdsk`) ou preparar a mídia de novo, conforme a causa que (1) e (2) apontarem.
