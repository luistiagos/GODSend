# Bug: não existe Companion 32 bits publicado, e uma cópia 32 bits se atualizaria para o x64

## Status

- Movido de `open/` para `retest/` em 2026-10-12 a pedido do dono, depois da execucao 20261010-2242 do pipeline (planning: correcao ja em `origin/main`, sem codigo a mudar).
- **Corrigido em:** 2026-10-07; **publicado** em 2026-10-08 (~02:10 UTC): `xboxcompanion32.exe` 2.12.109 ia32 no R2/HF e bloco `ia32` no `version.json`.
- **Commits:** `2743a2b` [T1] fix(update) (copia 32 bits so atualiza pelo bloco ia32), `d4cce82` chore(release) 2.12.109 (build-and-upload publica o 32 bits).
- **Onde:** `src/electron-app/services/autoUpdateService.ts::selectManifestBuild`; `build-and-upload.ps1` (`-Arch ia32`).
- **Evidencia:** secoes "Execucao da T3" e "Publicacao" abaixo — PE `0x14c` em todos os binarios; app ia32 real em WOW64 recusou o x64 (`no ia32 build in the manifest`); sha256 do publicado igual ao build.
- **Falta para `closed/`:** prova num Windows 32 bits nativo (nao ha maquina aqui) e confirmacao de um cliente 32 bits (ex.: chamado #157). Achado lateral: sondagem de integridade estoura o prazo fixo de 3 s no PowerShell 32 bits (secao "Execucao da T3").

- **Detectado em:** 2026-10-07 (chamado #157 do painel, sessão `255490944716923@lid`)
- **Origem:** conversa de suporte. Doc do lado do agente de WhatsApp:
  `digitalstoregamesproject/docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-10-07-agente-xbox-diz-que-companion-nao-roda-em-windows-32-bits-e-existe-versao-32.md`
- **Classe:** falha de distribuição/release, sem crash
- **Severidade:** P2 — o cliente do #157 (Windows 32 bits) ficou 4 h parado até conseguir outro notebook.
- **Decisão do dono (2026-10-07):** publicar a versão 32 bits.

## Sintoma

Cliente baixou `https://versions.digitalstoregames.com/xboxcompanion.exe` num Windows 32 bits e o
launcher mostrou *"requer windows 64bits"*. O agente de suporte não tinha link alternativo.

## Evidência

- O build `ia32` existe no código (`scripts/build-portable.js --ia32`, `build-portable-local.ps1 -Arch ia32`),
  mas **nenhum** portátil ia32 foi publicado ou sequer gerado: `dist/` não tem nenhum
  `*-ia32.exe` do portátil; a pasta `XBOX360Companion/` do HuggingFace (listada pela API) só tem
  x64, da 2.12.26 à 2.12.107; no R2, 9 nomes de 32 bits devolvem 404.
- `build-and-upload.ps1` só gera e envia o x64 (`build:electron:win:portable` = `--x64`).
- O link ia32 do `readme.md` (2.12.43) é o mesmo `gofile.io/d/pnHMrf` do x64 da linha de cima.
- `templates/nsis/common.nsh::check64BitAndSetRegView` (chamado em `build/portable.nsi::.onInit`)
  é a caixa "Requer Windows 64 bits" — só aparece num pacote sem `APP_32`.

## Causa raiz

1. **Distribuição:** o pipeline de release (`build-and-upload.ps1`) nunca incluiu o ia32.
2. **Atualizador sem arquitetura** — o que impede só subir um `.exe` 32 bits:
   `services/autoUpdateService.ts::checkForUpdates` lê `XBOX360Companion/version.json` e devolve
   `manifest.downloadUrl || manifest.portableUrl`, um link único (o x64). Uma cópia 32 bits
   baixaria o x64 na primeira versão nova, substituiria a si mesma (`buildReplaceScript`) e
   voltaria a mostrar "requer Windows 64 bits" — o mesmo bug, uma versão depois.

## Viabilidade do 32 bits (conferida)

- `electron` 42.4.1 tem `electron-v42.4.1-win32-ia32.zip` publicado (HTTP 200).
- `extraResources` do Windows já é por arquitetura (`godsend-windows-${arch}.exe`,
  `tools/aria2c-${arch}.exe`). PE machine conferido: `godsend-windows-ia32.exe`,
  `aria2c-ia32.exe` e `fat32format.exe` são `0x14c` (x86).
- Dependências de runtime são JS/wasm (`sql.js`, `yauzl`, `basic-ftp`, React/three): nenhum
  addon nativo para recompilar.

## Hipóteses descartadas

- **"Já existe link 32 bits, falta achar"**: R2, HuggingFace e readme conferidos acima.
- **"Basta publicar o .exe ia32 e pôr o link no guia"**: cai no item 2 da causa.

## Correção planejada

1. **T1 — atualizador ciente da arquitetura** (`services/autoUpdateService.ts`): o manifesto
   ganha um bloco opcional `ia32: { version, downloadUrl, sha256, size, releaseDate }`. Uma
   função pura `selectManifestBuild(manifest, arch)` escolhe: `ia32` → só o bloco `ia32`; sem
   bloco, **nenhuma** atualização (nunca o x64). Demais arquiteturas → campos de topo, como hoje
   (clientes x64 antigos não mudam: leem os mesmos campos). Teste:
   `tests/unit/autoUpdate.test.cjs` — ia32 com bloco usa o bloco; ia32 sem bloco não atualiza
   nem devolve o link x64; x64 ignora o bloco.
2. **T2 — release publica o ia32** (`build-and-upload.ps1`): parâmetro `-Arch x64|ia32|all`
   (padrão `all`); envia `xbox-360-companion-Portable-<v>-ia32.exe` ao HuggingFace e
   `XBOX360Companion/xboxcompanion32.exe` (+ `.sha256`) ao R2; o `version.json` é **mesclado**
   com o publicado (quem publica só uma arquitetura preserva o bloco da outra).
3. **T3 — prova ponta a ponta do ia32**: gerar o portátil ia32 a partir do commit, abrir e
   passar pela tela de preparo neste PC (x64, WOW64). **Limite conhecido:** não há Windows
   32 bits nativo aqui; registrar isso, não esconder.
4. Versão 2.12.109 (regra de bump), `CHANGELOG.md` e linha do ia32 no `readme.md`.

## Tarefas

| # | tarefa | estado |
|---|---|---|
| T1 | atualizador ciente da arquitetura + testes | feito (`2743a2b`) |
| T2 | `build-and-upload.ps1` publica ia32 e mescla o `version.json` | feito (`be4dd5c`) |
| T3 | build ia32 + prova de abertura e preparo | feito com limites (ver "Execução da T3"); versão 2.12.109 em `d4cce82` |
| T4 | publicação (com o dono) e link para o guia do agente | publicado só o 32 bits (ver "Publicação"); guia do agente aguarda aprovação do texto |

## Passagem de bastão (2026-10-07 ~23:00, a pedido do dono)

A tabela de Tarefas acima está desatualizada. Estado conferido no git:

| # | estado real | prova |
|---|---|---|
| T1 | **feito**: `selectManifestBuild` + testes em `tests/unit/autoUpdate.test.cjs` | commit `2743a2b` |
| T2 | **feito**: `build-and-upload.ps1 -Arch x64\|ia32\|all` (padrão `all`), R2 `XBOX360Companion/xboxcompanion32.exe` + raiz, HF `xbox-360-companion-Portable-<v>-ia32.exe`, `version.json` mesclado com bloco `ia32` | commit `be4dd5c` |
| T3 | **pendente**: nenhum portátil ia32 gerado (`dist/` só tem o backend `godsend-windows-ia32.exe`, de 12:35) | `ls dist \| grep ia32` |
| T4 | **pendente**: nada publicado (`https://versions.digitalstoregames.com/xboxcompanion32.exe` → 404) | `curl -r 0-0 -w "%{http_code}"` |

Situação do repo: `main` está **7 commits à frente de `origin/main`**, sem push. Isso inclui a
2.12.108 (correção da enumeração USB em PC lento) e os dois commits acima. `package.json` está
em **2.12.108**; o item 4 da Correção planejada pede bump para **2.12.109**, `CHANGELOG.md` e a
linha ia32 no `readme.md`.

**Autorização:** o dono deu OK em 2026-10-07 para alterar o script e **gerar e publicar** a versão
com o 32 bits ("tem ok", na sessão retrobatnew-1b). A sessão anterior (retrobatnew-5f) pediu a
confirmação na própria sessão. **Confirme com o dono antes do upload**, porque o upload publica
também a 2.12.108/109 x64 para todos os clientes.

**Próximos passos, nesta ordem:**

1. Bump para 2.12.109 + `CHANGELOG.md` + `readme.md` (linha ia32), um commit.
2. `.\build-and-upload.ps1 -Arch all -DryRun` e conferir no `version.json` que o bloco `ia32`
   aponta para `xboxcompanion32.exe` e que os campos de topo continuam x64.
3. Gerar o ia32 (`-SkipUpload`, se o script tiver; senão
   `npm run build:electron:win:portable:ia32`) e fazer a **T3**: abrir o portátil ia32 neste PC
   (x64/WOW64) e passar pela tela de preparo. Registrar aqui o limite de não haver Windows 32 bits
   nativo para teste.
4. Com o OK do dono: push + `.\build-and-upload.ps1 -Arch all`. Conferir que
   `https://versions.digitalstoregames.com/xboxcompanion32.exe` dá 200 e que o `.sha256` confere.
5. **T4, lado do agente:** pôr a URL final no doc
   `digitalstoregamesproject/docs/modules/chatbot-whatsapp/areas/prompt-kb/bugs/2026-10-07-agente-xbox-diz-que-companion-nao-roda-em-windows-32-bits-e-existe-versao-32.md`.
   A mudança no guia `xbox360_companion.md` está sob a moratória de prompts (exige caso de eval
   e OK do dono).

## Execução da T3 (2026-10-07 22:50–23:00, sessão que fez T1/T2)

Passos 1–3 da passagem de bastão acima estão feitos.

- **Build a partir do commit, não da árvore:** worktree limpa em `d4cce82` (`C:\cc32wt`), para
  que mudanças sem commit de outras sessões não entrem num binário publicado.
  `npm run build:server` + `npm run build:electron:win:portable:ia32` →
  `dist/xbox-360-companion-Portable-2.12.109-ia32.exe`, **511.227.349 bytes**.
- **Armadilha encontrada:** `src/electron-app/assets/badavatar-1.1/` (726 MB, o pacote do preparo)
  está no `.gitignore`. Sem copiá-lo para a worktree o portátil sai com 151 MB e **sem o pacote do
  preparo**. Quem gerar o ia32 fora da árvore principal precisa copiar essa pasta.
- **Achado fora do escopo:** `npm run build:server:win:ia32` (só 386) falha no `verify` exigindo o
  `godsend.exe` x64. O `build-and-upload.ps1` usa `build:server` (todas), então não bloqueia.
- **Arquitetura dos binários** (PE machine `0x14c`): `Xbox360Companion.exe`, `godsend-backend.exe`,
  `aria2c.exe`, `fat32format.exe`, `elevate.exe` do `win-ia32-unpacked`.
- **Abertura real** (este PC é x64; o ia32 roda em WOW64): launcher → `Xbox360Companion.exe` →
  `godsend-backend.exe` próprio (filho do app, escutando em 127.0.0.1:8080 com conexões do app);
  janela "Xbox 360 Companion" aberta. Log do app: `arch: ia32` e
  `APP_UPDATE Check result: no ia32 build in the manifest (latest x64=2.12.107)` — **o app real
  recusou o x64** do `version.json` publicado (prova da T1 fora do teste unitário).
- **USB:** `enumeracao nativa encontrou 1 unidade(s): E:\` e `lista enviada à interface: ... E:\:permitida`
  a cada 5 s. O preparo em si **não foi executado** (formata a mídia; `E:` não é mídia de teste).
- **Limite medido — diagnóstico de integridade estoura no 32 bits:** a sondagem best-effort
  (`windowsUsbDeviceService.ts::annotateRemovableHealth`, prazo fixo `HEALTH_PROBE_TIMEOUT_MS` = 3 s)
  excedeu o prazo 2 de 2 vezes no ia32. Mesmo `Get-Volume -DriveLetter E`, 3 execuções:
  PowerShell 64 bits 2352/2028/1878 ms; **PowerShell 32 bits (SysWOW64) 5064/3690/4086 ms**.
  Efeito: a unidade aparece sem a dica "precisa de reparo" (fica Healthy/OK neutro); a lista e a
  permissão não mudam. Candidato a bug próprio: usar o prazo adaptativo da 2.12.108 também aqui.
- **Não provado:** Windows 32 bits nativo (não há máquina/VM aqui) e preparo completo de pendrive
  no ia32.

## Publicação (2026-10-08 ~02:10 UTC)

Decisão do dono: **publicar só o 32 bits**; clientes x64 continuam na 2.12.107.

- Comando: `.\build-and-upload.ps1 -Arch ia32 -SkipBuild -PortablePath C:\cc32wt\dist\xbox-360-companion-Portable-2.12.109-ia32.exe`
  (antes, o mesmo com `-DryRun`). Saída: HF `XBOX360Companion/xbox-360-companion-Portable-2.12.109-ia32.exe`,
  R2 `xboxcompanion32.exe` (511.227.349 bytes) e `version.json` publicados, exit 0.
- Conferência externa:
  - `curl -r 0-0` em `https://versions.digitalstoregames.com/xboxcompanion32.exe` e em
    `.../XBOX360Companion/xboxcompanion32.exe` → `206`, `0-0/511227349`.
  - `curl -s .../xboxcompanion32.exe | sha256sum` → `e8a7c965…009f`, igual ao `.sha256` publicado
    e ao build.
  - `version.json`: topo `2.12.107` / `29d4b703…` (x64 intacto), `ia32.version` `2.12.109` /
    `e8a7c965…`.
- **Push do `main`:** não feito por esta sessão (bloqueado pela permissão da ferramenta); fica com o
  dono. O binário publicado é o commit `d4cce82`.

## Planejamento (pipeline 20261010-2242, 2026-10-10)

**Veredito:** sem-codigo — a correção (T1 atualizador, T2 release) está em `origin/main` e publicada
na 2.12.109 para x64 **e** ia32, e o lado do agente (T4) está no ar; falta só mover o doc para
`retest/` (pipeline) e a prova de campo de um cliente 32 bits (cliente/dono).
**Complexidade:** media — empacotamento (`build-and-upload.ps1`) + lógica nova num serviço Electron.
**Severidade:** medio — atinge só o subconjunto Windows 32 bits, com contorno (outro PC).
**Arquivos a alterar (reserva da onda):** nenhum.

### Causa raiz (simbolos abertos: `arquivo::simbolo` — faz X; em erro, Y)

A da seção "Causa raiz" acima, já corrigida. Conferido no código atual (`d7bd9ad` = `origin/main`):
- `src/electron-app/services/autoUpdateService.ts::selectManifestBuild` — `arch === "ia32"` devolve
  só o bloco `ia32` se tiver `version` e `downloadUrl`, senão `null`; demais arquiteturas usam os
  campos de topo (`downloadUrl || portableUrl`), `null` sem `version`/link.
- `autoUpdateService.ts::checkForUpdates` (call-site, linha ~226: `selectManifestBuild(manifest, process.arch)`) —
  com `null` registra `Check result: no <arch> build in the manifest` e devolve `updateAvailable: false`;
  nunca cai no link x64.
- `src/electron-app/tests/unit/autoUpdate.test.cjs` — 3 testes de `selectManifestBuild` (ia32 com
  bloco, ia32 sem bloco/bloco incompleto → `null`, x64 ignora o bloco e manifesto legado).

### Provas (comando literal -> resultado)

- `git branch -r --contains 2743a2b` / `be4dd5c` / `d4cce82` → `origin/main` nos três; `HEAD` da lane = `origin/main` = `d7bd9ad`.
- `curl -s "https://versions.digitalstoregames.com/XBOX360Companion/version.json?t=..."` → topo
  `2.12.109` (x64, `xboxcompanion.exe`, sha `233b219d…`), bloco `ia32` `2.12.109`
  (`xboxcompanion32.exe`, sha `73980933…523d`, 572.043.159 bytes). O x64 também já foi para a 2.12.109
  (a seção "Publicação" acima, de 02:10 UTC, ainda dizia x64 em 2.12.107).
- `curl -r 0-0 -w "%{http_code}"` em `xboxcompanion32.exe` e `XBOX360Companion/xboxcompanion32.exe` → `200`;
  `curl -sI` → `Content-Length: 572043159`, `Last-Modified: Thu, 08 Oct 2026 15:21:56 GMT` (republicado
  junto com o x64; não é mais o binário de 511 MB/`e8a7c965…` da T3).
- `curl -s .../xboxcompanion32.exe.sha256` (raiz e `XBOX360Companion/`) → `73980933…523d`, igual ao `version.json`.
- Lado do agente (`digitalstoregamesproject/.../2026-10-07-agente-xbox-diz-que-companion-nao-roda-em-windows-32-bits-e-existe-versao-32.md`):
  `status: no-ar`, texto aprovado em `7e2c66e`, eval 12/12 PASS (`017b45ee`), deploy conferido
  (`00ab6a5a`); verificação em prod pendente por volume (nenhum caso 32 bits desde o deploy).

### Hipoteses descartadas (e por que)

- **"Falta código neste repo":** T1/T2 estão em `origin/main` e a T3 provou no app real
  (`no ia32 build in the manifest`) que a cópia 32 bits recusa o x64.
- **"Falta publicar":** `version.json` e os dois `.exe` estão no ar e consistentes (provas acima).
- **Sondagem de integridade estourando 3 s no ia32 (`windowsUsbDeviceService.ts::annotateRemovableHealth`,
  `HEALTH_PROBE_TIMEOUT_MS = 3_000`) como bug novo:** o prazo fixo é deliberado (comentário no
  call-site: dica best-effort, não deve atrasar a lista) e o efeito (sem a dica "precisa de reparo")
  já está registrado no doc `electron-main-powershell-lento-estoura-prazo-fixo-da-enumeracao-usb-...`.
  Não abri doc novo.

### Tarefas

- [ ] (pipeline/teste) mover para `retest/` com `## Status`: commits `2743a2b`, `be4dd5c`, `d4cce82`;
  publicado 2.12.109 x64+ia32 em 2026-10-08.
- [ ] (cliente/dono) prova de campo: um cliente Windows 32 bits baixa `xboxcompanion32.exe` e abre.

### Plano de teste

- **Offline (sem slot):** `node --test src/electron-app/tests/unit/autoUpdate.test.cjs` (após o `tsc`
  do helper) — os 3 testes de `selectManifestBuild` passam; e o `curl` do `version.json` acima
  (bloco `ia32` presente, topo x64).
- **T2 reproducao como o usuario (E2E, no slot):** dispensada — o caminho do cliente é baixar e abrir
  o portátil num Windows 32 bits nativo; não há máquina/VM 32 bits (manual: `bloqueado` para
  Windows 32 bits). A abertura em WOW64 e a recusa do x64 pelo atualizador já foram provadas na
  T3 (seção "Execução da T3"). Opcional, se o slot sobrar: o app x64 da lane em Configurações →
  verificar atualização mostra `latest=2.12.109` lido dos campos de topo (prova que o bloco `ia32`
  não afeta o x64).
- **Controle positivo:** antes do fix, `checkForUpdates` devolvia `manifest.downloadUrl || manifest.portableUrl`
  para qualquer arquitetura; o teste "cópia 32 bits sem bloco ia32 não atualiza" falharia nessa versão.
  Não há como reproduzir o "requer Windows 64 bits" sem Windows 32 bits.
- **T3 regressao direcionada:** `npm --prefix src/electron-app run test:safety` (contém `autoUpdate.test.cjs`)
  sem `fail` novo.
- **Falta para close:** prova de um cliente 32 bits real (e a verificação em prod do agente, no outro projeto).

### Sessoes seguintes

- dev: nenhuma (sem código).
- teste: effort low, ultrathink nao — só conferir provas já existentes e mover para `retest/`.

### Achado lateral registrado

- [build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30.md](build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30.md)
  (o "Achado fora do escopo" da T3, agora com causa no `scripts/build-server.js`).
