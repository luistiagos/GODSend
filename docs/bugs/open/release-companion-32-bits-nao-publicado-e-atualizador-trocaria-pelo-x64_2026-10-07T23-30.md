# Bug: não existe Companion 32 bits publicado, e uma cópia 32 bits se atualizaria para o x64

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
| T1 | atualizador ciente da arquitetura + testes | pendente |
| T2 | `build-and-upload.ps1` publica ia32 e mescla o `version.json` | pendente |
| T3 | build ia32 + prova de abertura e preparo | pendente |
| T4 | publicação (com o dono) e link para o guia do agente | pendente |
