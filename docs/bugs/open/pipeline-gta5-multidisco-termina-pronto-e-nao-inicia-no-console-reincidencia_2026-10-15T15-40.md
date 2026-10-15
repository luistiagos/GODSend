# Bug: GTA V (2 discos) termina "Pronto" na fila e não inicia no console — reincidência depois da correção 2.12.102/2.12.105

- **Detectado em:** 2026-10-15 18:10 UTC (relato de cliente no WhatsApp, sessão `161091405496378@lid`)
- **Origem:** `xbox-360-companion/pipeline` — `services/pipeline/disc_layout.go::resolveISOInstallType`,
  `services/pipeline/companion_content.go::requireInstallContent` / `::pendingInstallDiscJob`,
  `utils/iso2god.go::ExtractXDVDFSContentToDir`, catálogo remoto `emuladores.pythonanywhere.com` (`xbox360rgh`)
- **Errors (serviço):** 10005, 10008, 10033 (Disco 1 Redump, versões antigas); nenhum da 2.12.110 na janela do cliente
- **Classe:** fail (entrega silenciosa de jogo que não dá boot)
- **Severidade:** P1 - Alto — o cliente recebe "Pronto" e o jogo não abre; é o título mais pedido do catálogo
- **Complexidade:** alta — pipeline multidisco + catálogo remoto
- **Versões:** cliente na 2.12.110 (build publicado em 13/10 17:46 UTC, contém `0230c7d` e `df3827c`)
- **Reincidência:** reincidente de [catalogo-gta5-hf-incompleto-sem-disco-instalacao-trava-boot_2026-09-26T01-05](catalogo-gta5-hf-incompleto-sem-disco-instalacao-trava-boot_2026-09-26T01-05.md).
  A correção anterior validou de ponta a ponta **só** o caminho HuggingFace "GTA 5" → release ZTM. O catálogo tem
  outras seis entradas de GTA V que nunca foram conferidas (abaixo), e o veredito "sem-codigo" de 2026-10-10 olhou só
  aquele caminho.

## Sintoma

Cliente comprador da Plataforma Xbox 360 (tx 63970, 13/10), Xbox bloqueado, HD externo de 500 GB preparado pelo
Companion, app baixado em 14/10 por `https://versions.digitalstoregames.com/xboxcompanion.exe`.

1. 14/10 13:57 UTC: baixou "Max Payne 3 + PT BR (XBOX 360 RGH)" (fonte `luisluis123/xboxrghgames`), que funciona.
2. 14/10 15:27 UTC (`Wpp_proccess` 142439): pediu "GTA". O agente orientou buscar GTA V no catálogo.
3. 15/10 18:10 UTC (143512): *"deu erro em uns jogos tipo alien isolation não abre e o GTA 5 também não"*.
4. 143514: *"O primeiro ali pede disco"*; 143516: *"GTA tá abrindo outro jogo"*; 143522: *"Max Paine e Batman deu beleza"*.
5. O agente pediu print da tela do console e da Fila do Companion; até 15/10 18:15 UTC o cliente não tinha enviado.

## Evidência

Coleta: skill `sessao-whatsapp` (`python .claude/skills/sessao-whatsapp/scripts/sessao.py 161091405496378@lid`, no repo
`digitalstoregamesproject`) e `/diag/query`. Horários do banco em UTC.

1. **Telemetria — Disco 1 Redump falha na extração do conteúdo, de forma determinística, em duas fontes:**
   ```sql
   SELECT id, time, user_agent, message FROM errors
   WHERE time BETWEEN '2026-10-14 14:00:00' AND '2026-10-15 19:00:00'
     AND (message LIKE '%GTA%' OR message LIKE '%Grand Theft%' OR message LIKE '%Alien%' OR message LIKE '%545408A7%')
   ```
   | id | time (UTC) | user_agent | mensagem | logs anexos (`error_logs`) |
   |---|---|---|---|---|
   | 10005 | 14/10 14:39 | `pipeline` | Download falhou em todas as fontes para `Grand Theft Auto V (World) (En,Fr,De,Es,It,Pt,Zh,Ko,Pl,Ru) (Disc 1) (Install)` | hf: não encontrado; ia: HTTP 500; **minerva: `contentExtract: no content/ dir in ISO`** |
   | 10008 | 14/10 16:03 | `pipeline` | idem | hf: não encontrado; **ia e minerva: `no content/ dir in ISO`** |
   | 10033 | 14/10 23:44 | `pipeline` | idem | idem |
   | 10074 | 15/10 17:52 | `pipeline` | `GTA 5` (huggingface/ZTM): espaço insuficiente (7,69 GB, 6,64 livres) | outro cliente, pendrive pequeno |

2. **Esses três erros não são do cliente.** Desde `df3827c` (12/10) o report do backend leva `user_agent = "pipeline v<versão>"`.
   O binário publicado (`xboxcompanion.exe`, `Last-Modified: Tue, 13 Oct 2026 17:46:24 GMT`, mesmo ETag nas duas URLs) é posterior a
   `ed5943b` (13/10 14:27 -03), e `git merge-base --is-ancestor` confirma `df3827c` e `0230c7d` em `ed5943b`. Reports sem versão vêm de
   builds anteriores. Em `errors` desde 10/10: 181 `pipeline` x 11 `pipeline v2.12.110`.
3. **O caso do cliente terminou sem erro.** `SELECT ... FROM errors WHERE user_agent IN ('pipeline v2.12.110','ElectronApp v2.12.110') AND time >= '2026-10-14 11:00:00'`
   → 13 linhas, nenhuma de GTA V ou Alien. A tarefa terminou em "Ready" e o jogo não abre.
4. **O Disco 1 retail tem a árvore que o leitor não achou.** A tabela do Iso2God (r4dius,
   https://github.com/r4dius/Iso2God): *"Grand Theft Auto V — Disk 1 — No GOD — Extract ISO and copy
   content\0000000000000000\545408A7\00000002 directory to HDD"*; Alien Isolation Disk 1 idem com `5345085E`.
5. **Catálogo remoto (`curl -s "https://emuladores.pythonanywhere.com/api/rom/list?system=xbox360rgh&source_id=1"`, 1.932 itens, 15/10)** —
   entradas de GTA V:
   | path | tamanho | conferida? |
   |---|---|---|
   | `Grand Theft Auto 5.rar` (ZTM, archive.org) | 14.36 GiB | sim, E2E em 28/09 (2.12.105) |
   | `GTA 5 7z` (`luistiagos/xbx`, só Disco 2) | 6758 MB | filtrada no app (`isKnownIncompleteHuggingFaceURL`), ainda na API |
   | `GTA 5 PT-BR + DLC + TU + SAVE 100 % .GOD ( XBOX 360 RGH ).zip` | 21.96 GiB | **não** |
   | `Grand Theft Auto V™ OG ONLINE + DLC FULL ( XBOX 360 RGH ).zip` | 4.98 GiB | **não** — pequena demais para o jogo |
   | `Grand Theft Auto V + MOD Definitive Edition 1.5.1 ( COPIA E COLA ).zip` | 16.34 GiB | **não** |
   | `GTA V MOD DARK V25 ( XBOX 360 RGH _ XPLOIT ).zip` | 16.61 GiB | **não** |
   Além delas, o catálogo Redump (`cache/xbox360.json` / `minerva_xbox360.json`) tem o par
   `Grand Theft Auto V (World) (...) (Disc 1) (Install)` + `(Disc 2) (Play)`, cujo Disco 1 é o dos erros acima.
   Alien Isolation: `ALIEN ISOLATION + DUBLAGEM PT BR + DLC ( XBOX 360 RGH ).zip` (10.67 GiB, não conferida), `Alien Isolation.rar`
   (ZTM, 8.48 GiB) e, no Redump, Disco 1 só como `(USA, Europe)` e Disco 2 como `(USA)`.
6. **O ISO Redump do Disco 1 não pôde ser lido nesta sessão:** `archive.org/download/microsoft_xbox360_g/...(Disc 1) (Install).zip`
   responde 401 sem login, e não há cópia local.

## Causa raiz

**Comprovado pelo código (abertos nesta sessão):**

1. `services/pipeline/disc_layout.go::resolveISOInstallType` (L37-51): `rec := models.DiscCompat(...)`; com
   `rec.InstallType == "content"` (`models/compat.go:46`, `{0x545408A7, 1}`; `:26` para Alien) o disco vira `content` **mesmo com
   `layout.HasInstallableContent == false`**, isto é, mesmo quando `utils.ProbeISOInstallLayout` não achou `content/0000000000000000/...`.
   O comentário da função diz que a ISO manda, mas o código deixa a tabela decidir. Depois disso,
   `utils/iso2god.go::ExtractXDVDFSContentToDir` (L1279-1281) devolve `contentExtract: no content/ dir in ISO`, e
   `pipeline/digital.go::processContentInstallFromISO` (L77-83) falha o job. O erro sai como "download falhou em todas as fontes",
   sem dizer o que a raiz da ISO tinha.
2. `services/pipeline/companion_content.go::requireInstallContent` (L210-224) + `::pendingInstallDiscJob` (L367-391): cada disco Redump
   é um job e eles rodam em qualquer ordem. Se o disco jogável roda antes, com a tarefa do Disco 1 ainda em `Queued`/`Processing`,
   ele é **entregue** e só ganha `IncompleteRelease.Store(gameName, "ATENCAO: o conteudo ... ainda sera gravado pela tarefa ...")`,
   anexado à mensagem de "Ready" em `app/app.go::LogStatus` (L145-150). Se o Disco 1 falha depois, nada reavalia o jogo já entregue:
   ele fica no dispositivo, a fila mostra "Pronto" com uma promessa que não vai se cumprir, e o jogo trava ou pede disco no console.
   Para os clientes dos erros 10005/10008/10033 (versões antigas), essa é a sequência provável.
3. As seis entradas de GTA V da tabela da Evidência 5 nunca foram conferidas.

**Não provado — o que falta medir:**

- **Qual GTA o cliente baixou.** Ele escolheu Max Payne da fonte `luisluis123` (PT-BR), então o candidato natural é
  `GTA 5 PT-BR + DLC + TU + SAVE 100 % .GOD`. O print da Fila resolve.
- ~~**Por que o leitor não vê `content/` no Disco 1 Redump.**~~ **Provado em T1:** é o defeito corrigido em `0230c7d`. A raiz
  começa por `disc1.rsn` (0 B), e o leitor antigo devolvia a raiz vazia. A 2.12.110 instala os quatro pacotes (seção T1).
- **"Pede disco" e "abre outro jogo".** Pode ser o Disco 1 (instalador) listado no Aurora como se fosse o jogo, ou o Disco 2 sem o
  conteúdo de instalação. Depende do item acima.
- **Alien Isolation.** Saiu de `mandatoryInstallDiscs` na correção anterior (conjunto de pacotes não verificado), e os discos Redump
  não se reconhecem como irmãos ([multi-disc-compatibility.md:46](../../reference/multi-disc-compatibility.md)). Sem telemetria.

## Hipóteses descartadas

- **Defeito do agente de WhatsApp:** descartada. As respostas 143513-143525 pedem a evidência certa (print da tela e da Fila) e não
  mandam apagar nada.
- **Hardware, exploit ou HD do cliente:** descartada. Max Payne 3 e Batman, gravados no mesmo HD, abrem.
- **Os erros 10005/10008/10033 são do cliente:** descartada. `user_agent` sem versão = build anterior ao publicado em 13/10
  (Evidência 2), e o cliente instalou o app em 14/10.
- **Disco 1 retail sem `content/` (o instalador geraria os pacotes no HDD):** descartada pela tabela do Iso2God (Evidência 4) e pelo
  layout medido da release ZTM, cujo instalador traz `content/0000000000000000/545408A7/00000002/` com os quatro PIRS.
- **Diferença de maiúsculas em `Content`:** descartada. `utils/iso2god.go::findInDir` (L357-365) compara com `strings.ToLower`.
- **Partição XGD errada:** descartada em T1. A ISO é XGD3 e é detectada como XGD3. O `default.xex` "sumia" porque a raiz
  inteira vinha vazia no leitor antigo (`disc1.rsn` de 0 B em primeiro), não por causa de partição errada.

## Correção planejada

| # | o quê | onde | prova |
|---|---|---|---|
| T1 | Medir, sem código: enfileirar o par Redump `Grand Theft Auto V (World)` Disc 1 + Disc 2 na 2.12.110 (backend isolado, destino local vazio, login IA do app) | — | log `MULTI-DISC [...]: conteúdo de instalação do Disco 1 ...` + os quatro `545408A70000000[0-3]` no destino; se falhar, listar a raiz XDVDFS da ISO (`readXDVDFSDirTable`) e anexar aqui |
| T2 | Quando a tarefa do disco de instalação de uma release falha ou é cancelada, reavaliar o disco jogável entregue "com aviso": a fila e a telemetria passam a dizer que o jogo não inicia, em vez de "Pronto" | `companion_content.go::requireInstallContent` (onde grava o aviso) e o ponto onde o job do Disco 1 termina em `Error` (`app.go::LogStatus` / `persistJobState` — abrir antes de desenhar) | teste novo: Disco 2 entregue com o Disco 1 em fila → Disco 1 falha → status do Disco 2 deixa de ser "Ready" limpo e um report sai; falha contra o código atual |
| T3 | `resolveISOInstallType`: tabela diz `content` e a ISO não tem árvore → falhar logo, com mensagem que lista a raiz da ISO, em vez de deixar a extração dizer "download falhou em todas as fontes" | `disc_layout.go::resolveISOInstallType` | teste com ISO sintética sem `content/` para um TitleID da tabela: o erro traz as entradas da raiz |
| T4 | Conferir as entradas de GTA V não validadas (Evidência 5) e tirar da API/do app as que não trazem o conjunto do Disco 1. `OG ONLINE` (4,98 GiB) é suspeita imediata | catálogo remoto (ação do dono) + `services/cache/huggingface.go::isKnownIncompleteHuggingFaceURL` se for filtrar no app | inspeção de cada arquivo (`default.xex` disco N de M, pacotes PIRS 545408A7 tipo 0x2) |
| T5 | Alien Isolation: verificar o conjunto de pacotes do Disco 1 e decidir a volta a `mandatoryInstallDiscs` e o casamento de irmãos entre regiões | `models/compat.go::mandatoryInstallDiscs`, `models.ExtractReleaseTitle` | teste de irmãos com os nomes reais do catálogo |

Antes de T2-T5, pedir ao cliente o print da Fila e da tela do Aurora (ação do dono/suporte). Isso decide qual caminho o atingiu e
pode reordenar as tasks.

## T1 — medição do par Redump na 2.12.110 (2026-10-15)

**Resultado: na 2.12.110 o Disco 1 Redump instala os quatro pacotes. Os erros 10005/10008/10033 vêm do defeito do leitor
XDVDFS corrigido em `0230c7d`: a raiz desse disco começa por um arquivo de 0 byte.**

### Como foi medido

- Backend compilado de `ed5943b` (= fonte da 2.12.110 publicada, Evidência 2; `src/server` limpo no `git status`), rodando
  isolado: `GODSEND_HOME` no scratchpad, `GODSEND_PORT=18431`, `GODSEND_BIND_HOST=127.0.0.1`, `GODSEND_ERROR_REPORTING=0`
  (nenhum report saiu para a telemetria). Cache de catálogo = cópia de `cache/` do repo. Nenhum outro backend rodando.
- Destino = pasta vazia no papel do pendrive. Chamadas iguais às do Electron (`ipc/browseHandlers.ts::browse:queue-game`):
  `/register?...&mode=local&install_type=god&local_root=<pasta>` para os dois discos, depois
  `/trigger?game=<Disc 1 (Install)>&platform=xbox360&install_type=god&priority=huggingface,ia,minerva` (prioridade padrão).
- Login do IA: o automático da conta compartilhada (`ia_auth.go`), como no app: `automatic shared-account login succeeded`.

### O que o log mostrou (Disco 1)

```
19:28:06 FALLBACK ERROR: huggingface falhou ... (Disc 1) (Install): jogo nao encontrado no catalogo — alternando provedor
19:28:06 IA Download: ... (Disc 1) (Install).zip            -> 8220 MB, chunked, 16 conexões
19:28:11 TRIGGER MULTI-DISC: Auto-enqueuing companion disc '... (Disc 2) (Play)'
19:59:44 DOWNLOAD VERIFY [...]: concluido em 42.342s
20:03:34 DISC LAYOUT [... (Disc 1) (Install)]: pedido=god corrigido=content TitleID=545408A7 disco=1/2 conteudo=true
20:04:23 LOCAL Content: 4 arquivos (7.69 GB) -> <destino>\Content\0000000000000000\545408A7\00000002
20:05:25 FALLBACK SUCCESS: ia for ... (Disc 1) (Install)      -> estado Ready, "Gravado no dispositivo!"
```

`conteudo=true`: `ProbeISOInstallLayout` achou a árvore, então o `content` não veio só da tabela (`DiscCompat`). O Disco 2
ficou `Queued` ("Aguardando a tarefa anterior liberar o armazenamento temporario...") até o Disco 1 terminar, então nesta
rodada a ordem foi a boa (instalador antes do jogável).

### Pacotes no destino

Conferidos com o cabeçalho STFS (magia em `0x0`, tipo em `0x344`, tamanho declarado em `0x34C`, TitleID em `0x360`):

| arquivo | magia | TitleID | tipo | tamanho real − declarado |
|---|---|---|---|---|
| `545408A700000000` | `PIRS` | `545408A7` | `0x2` | 2.146.643.968 − 2.146.598.912 = 45.056 |
| `545408A700000001` | `PIRS` | `545408A7` | `0x2` | 2.147.262.464 − 2.147.217.408 = 45.056 |
| `545408A700000002` | `PIRS` | `545408A7` | `0x2` | 2.146.807.808 − 2.146.762.752 = 45.056 |
| `545408A700000003` | `PIRS` | `545408A7` | `0x2` | 1.817.518.080 − 1.817.473.024 = 45.056 |

Mesmo padrão (declarado + 45.056 B de cabeçalho) dos pacotes da release ZTM medidos em 28/09.

### Por que os builds antigos falhavam: a raiz da ISO

O `.zip` do Disco 1 foi preservado por hardlink antes de a pipeline apagá-lo, e a raiz XDVDFS foi lida direto do membro
`.iso` (8.738.846.720 B) por um script do scratchpad que repete `detectXGDPartition` (ordem XSF, XGD2, XGD1, XGD3),
`readXDVDFSVolDesc` e `parseDirSector` nas duas versões, a de antes e a de depois de `0230c7d`:

- partição **XGD3** (offset 0x2080000); raiz no setor 5209, 2.048 B (um setor);
- **regra antiga** (`if size == 0 { break }`): **0 entradas**, sem `content`;
- **regra atual** (`if nameLen == 0 { break }`): 10 entradas, em ordem: `disc1.rsn` (**0 B**), `common.rpf`, `common/`,
  `$SystemUpdate/`, `default.xex`, `content/`, `xbox360a.rpf`, `nxeart`, `install_music.wma`, `xbox360b.rpf`.

O primeiro arquivo da raiz tem 0 byte, então o leitor antigo devolvia a raiz vazia. Sem `default.xex`, o
`ProbeISODiscInfo` dava `ErrNoExecutable`, que o caminho `content` tolera. Sem `content/`, o layout vinha
`HasInstallableContent=false`, mas a tabela (`DiscCompat` `{0x545408A7, 1}` → `content`) forçava o tipo `content` mesmo assim
(Causa raiz, item 1). A extração então falhava com `contentExtract: no content/ dir in ISO`. Isso fecha três pontos que estavam em
aberto: a causa dos erros 10005/10008/10033; a hipótese "Partição XGD errada" (descartada: XGD3 detectada certo); e por que o
`default.xex` também "sumia".

**O que isso muda no plano:** o Disco 1 Redump funciona na versão que o cliente tem. Se o cliente baixou esse par na 2.12.110,
não foi este caminho que o atingiu. Os candidatos que sobram são as entradas de GTA V não conferidas (T4) e a ordem
jogável-antes-do-instalador com o Disco 1 falhando por outro motivo (T2). T3 continua valendo como diagnóstico, mas deixa de
ser urgente.

### Disco 2 (Play)

```
20:05:26 IA Download: ... (Disc 2) (Play).zip                -> 7391 MB (alguns HTTP 500 em chunks, recuperados no retry)
20:35:21 DOWNLOAD VERIFY [...]: concluido em 12.804s
20:37:19 MULTI-DISC [... (Disc 2) (Play)]: conteúdo de instalação do Disco 1 conferido no destino (Content/0000000000000000/545408A7/00000002)
20:38:07 LOCAL GOD: 51 arquivos (7.89 GB) -> <destino>\Games\GTA V - 545408A7
20:38:35 FALLBACK SUCCESS: ia for ... (Disc 2) (Play)        -> estado Ready, "Gravado no dispositivo!"
```

No destino: `Games/GTA V - 545408A7/00007000/79E465C5` (`LIVE`, TitleID `545408A7`, tipo `0x7000`, MediaID `79E465C5`, o
mesmo do disco jogável da ZTM, disco **2/2** em `0x366`/`0x367`) + `79E465C5.data` com 50 `Data` (8.476.164.096 B). Nenhum
`ATENCAO`/`incompleta` no log. Nos dois jobs, o estado final foi `Ready` sem aviso.

**Ressalva sobre a ordem:** nesta rodada o Disco 2 esperou o Disco 1 por causa da fila do armazenamento temporário
("Aguardando a tarefa anterior liberar..."), e não por uma regra de "instalador primeiro". A medição não cobre o caso de T2
(jogável antes, instalador falhando depois). Esse caso continua aberto.

**Limpeza:** backend parado; o destino, o `GODSEND_HOME` e o `.zip` preservado (≈ 24 GB no scratchpad) foram apagados. Para
repetir, são ~1 h de download (IA a 4–4,5 MB/s). O script que lê a raiz (`xdvdfs_root.py`: lê o `.iso` de dentro do `.zip` e
aplica as duas regras de `parseDirSector`) ficou só no scratchpad desta sessão. Se T3 precisar dele, reescrever a partir da
descrição acima.

## Tasks
| # | task | commit | estado | modelo | revisao |
|---|---|---|---|---|---|
| T1 | reproduzir o par Redump GTA V na 2.12.110 (medição) | -- (sem código) | medido: par entregue (4 PIRS do Disco 1 + GOD disco 2/2), `Ready` sem aviso; causa dos erros antigos = `0230c7d` (seção T1) | claude-opus-5-5 | -- |
| T2 | reavaliar disco jogável entregue "com aviso" quando o Disco 1 falha | -- | -- | -- | -- |
| T3 | resolveISOInstallType falha cedo e lista a raiz quando a tabela diz content e a ISO não tem árvore | -- | -- | -- | -- |
| T4 | validar/remover entradas de GTA V não conferidas do catálogo | -- | -- | -- | -- |
| T5 | Alien Isolation: conjunto do Disco 1 e irmãos entre regiões | -- | -- | -- | -- |

## Critérios para fechar
- [ ] Caminho que atingiu o cliente identificado (print da Fila) e coberto por uma das tasks
- [x] T1 medido: Disco 1 Redump instala na versão atual, ou causa isolada e corrigida (instala na 2.12.110; causa antiga = `0230c7d`)
- [ ] Nenhum caminho entrega GTA V como "Pronto" sem os quatro pacotes do Disco 1 no destino (teste automatizado)
- [ ] Entradas de GTA V do catálogo conferidas ou retiradas
- [ ] Boot no console (o cliente desta sessão é o candidato natural)
