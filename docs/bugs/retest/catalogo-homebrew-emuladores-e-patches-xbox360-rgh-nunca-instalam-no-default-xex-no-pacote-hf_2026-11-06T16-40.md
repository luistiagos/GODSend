# Bug: emuladores e patches "( XBOX 360 RGH )" do catálogo HF nunca instalam — "No default.xex, .iso, GOD, or Content package found in HuggingFace archive" em todas as tentativas, em todas as versões

- **Detectado em:** 2026-11-06 16:40 (análise da sessão de WhatsApp `161091405496378@lid`, chamado **#232**, mais a
  telemetria `errors`, projeto `xbox-360-companion/pipeline`)
- **Origem:** `xbox-360-companion/pipeline` — erro levantado em `src/server/services/pipeline/huggingface.go:260`;
  itens do catálogo `cache/hf_xbox360.json`
- **Errors (serviço):** 10749, 10877, 11156, 11163, 11264, 11265, 11400, 11401, 11402, 11404, 12447, 12539, 12542, 12547
  (todos `status=open`)
- **Classe:** fail
- **Severidade:** **P2 — Médio**. O item aparece no catálogo e nunca entrega. Não afeta os jogos normais, mas o cliente
  tenta repetidamente e o erro não explica nada.
- **Complexidade:** Média (análise e probe de múltiplos zips remotos via HTTP Range, fallback de homebrew `.xex` sem `default.xex` e saneamento de catálogo).
- **Versões:** v2.12.110, v2.12.114, v2.12.115, v2.12.123 — o mesmo erro em todas
- **Reincidência:** primeira vez registrado. Não é
  [`retest/pipeline-xex-com-default-xex-na-raiz-do-arquivo-grava-pasta-com-sufixo-hf-ext_2026-10-12T14-56.md`](../retest/pipeline-xex-com-default-xex-na-raiz-do-arquivo-grava-pasta-com-sufixo-hf-ext_2026-10-12T14-56.md)
  nem
  [`retest/pipeline-nome-de-pasta-xex-sem-titleid-com-mais-de-42-caracteres-nao-e-cortado-para-o-hd-fatx_2026-10-12T19-15.md`](../retest/pipeline-nome-de-pasta-xex-sem-titleid-com-mais-de-42-caracteres-nao-e-cortado-para-o-hd-fatx_2026-10-12T19-15.md):
  aqueles homebrews eram **reconhecidos** e erravam no nome da pasta. Aqui o pacote não era reconhecido.

## Sintoma

Em 27/10/2026 13:04 (relógio do banco, UTC), o comprador do chamado #232 (console **bloqueado**, BadAvatar) mandou
foto da Fila ([156356] em `Wpp_proccess`): *"Emulador Nintendo N64 MUPEN … Download falhou em todas as fontes. Erros:
huggingface: HuggingFace download failed: interrupted after 29.75 … minerva: jogo nao encontrado no catalogo"*, e
[156360] *"Demorou mas deu erro duas vezes"*.

## Evidência

1. **Telemetria: 14 reportes, 6 itens, todos "( XBOX 360 RGH )", nenhum instalado.**

   ```sql
   SELECT id, time, LEFT(user_agent,25) ua,
          SUBSTRING_INDEX(SUBSTRING(message, 40), ' (xbox360)', 1) t
   FROM errors
   WHERE time >= '2026-10-13' AND project='xbox-360-companion/pipeline'
     AND message LIKE 'Download falhou em todas as fontes%'
     AND message LIKE '%No default.xex%'
   ORDER BY id
   ```

   | item | reportes | versões |
   |---|---|---|
   | `Emulador Nintendo ¨N64 MUPEN &quot; Método Shell&quot; ( XBOX 360 RGH )` | 11400, 12542 | 2.12.115, 2.12.123 |
   | `Emulador Super Nintendo + 3247 ROMS ( XBOX 360 RGH )` | 11265, 11401, 12539 | 2.12.114, 2.12.115, 2.12.123 |
   | `Emulador FBANext + 5800 Roms - Vários Sistemas de Arcade ( XBOX 360 RGH )` | 11163, 11264, 11402 | 2.12.110, 2.12.114, 2.12.115 |
   | `EMULADOR MAME + 4.212 ( XBOX 360 RGH )` | 11404, 12547 | 2.12.115, 2.12.123 |
   | `PES 2018™ Patch Atualização DEZEMBRO 2023 ( XBOX 360 RGH )` | 10749, 10877, 11156 | 2.12.110 |
   | `BOMBA PATCH 2023 PARA O PES 17 - ATT.AGOSTO ( XBOX 360 RGH )` | 12447 | 2.12.123 |

   O erro do HF era sempre `No default.xex, .iso, GOD, or Content package found in HuggingFace archive`
   (`huggingface.go:260`). O IA e o Minerva não têm esses itens (`jogo nao encontrado no catalogo`), então o HF é a
   única fonte, e ela recusava o pacote.

2. **O item estava no catálogo do Xbox 360**, não num adicional: `cache/hf_xbox360.json` e `cache/custom_covers.json` tinham
   `"emulador nintendo ¨n64 mupen &quot; método shell&quot; ( xbox 360 rgh )"`. O nome carregava o `&quot;` cru do HTML de origem.

3. **Item marcado RGH oferecido a console bloqueado.** O cliente usa BadAvatar e o catálogo mostrou o item sem aviso.

## Causa raiz

A investigação direta nos 6 arquivos `.zip` do repositório Hugging Face (`luisluis123/xboxrghgames`) via HTTP Range Requests comprovou dois cenários distintos:

### 1. Emuladores Legítimos (Snes360, MAME, FBANext)
- **`Emulador Super Nintendo + 3247 ROMS ( XBOX 360 RGH )`** (1.48 GB): contém `Snes360.xex` e subpasta `Roms/` com 3.247 jogos.
- **`EMULADOR MAME + 4.212 ( XBOX 360 RGH )`** (15.65 GB): contém `mame_0.72.xex` na raiz do emulador e 46.126 arquivos em subpastas.
- **`Emulador FBANext + 5800 Roms - Vários Sistemas de Arcade ( XBOX 360 RGH )`** (15.34 GB): contém `FBANext.xex` na raiz do emulador e 35.811 ROMs em subpastas.
- **Mecanismo de Falha:**
  Diferente de jogos retail de Xbox 360, que usam convencionalmente o arquivo executável chamado `default.xex`, esses emuladores independentes mantêm nomes executáveis personalizados (`Snes360.xex`, `mame_0.72.xex`, `FBANext.xex`).
  A função `helpers.FindXEXFolder()` varria as pastas buscando estritamente arquivos com nome exato `default.xex`. Como nenhum desses 3 emuladores possui um arquivo chamado `default.xex`, `FindXEXFolder()` retornava string vazia. Com isso, o pipeline do Hugging Face concluía erroneamente que o arquivo baixado não continha executável ou pacote válido de Xbox 360 e abortava com o erro reportado na telemetria.

### 2. Uploads Incompatíveis, Falsos ou Corrompidos (Mupen N64, Bomba Patch 2023, PES 2018 Patch)
- **`Emulador Nintendo ¨N64 MUPEN " Método Shell" ( XBOX 360 RGH )`** (2.22 GB): contém `xenon.elf`, `ROMS/` e `mupen64-360/`. Não contém nenhum executável `.xex`. Trata-se de um build para XeLL (Xbox Linux Loader) que roda apenas a partir do hardware cru via tela azul do XeLL ("Método Shell"), incompatível com a execução a partir da dashboard oficial ou da Aurora.
- **`BOMBA PATCH 2023 PARA O PES 17 - ATT.AGOSTO ( XBOX 360 RGH )`** (3.73 GB): o arquivo zip do HF contém apenas um arquivo interno aninhado `sdfasdasdfas.rar`. Ao decodificar o cabeçalho RAR 5.0 desse arquivo, descobriu-se que seu conteúdo interno é a pasta `SLEEPING DOGS PT-BR/`! Trata-se de um upload corrompido/falso feito pelo uploader original no Hugging Face (não é Bomba Patch e nem sequer foi empacotado como patch extraível).
- **`PES 2018™ Patch Atualização DEZEMBRO 2023 ( XBOX 360 RGH )`** (3.73 GB): idêntico ao caso anterior, o arquivo interno `sdfasdasdfas.rar` contém apenas `SLEEPING DOGS PT-BR/`.
- **Mecanismo de Falha:** O pipeline não suporta binários ELF do XeLL nem arquivos compactados aninhados sem extração (`.rar` dentro de `.zip`), além do fato de os patches serem falsos.

### 3. Decisão: Comportamento "( XBOX 360 RGH )" vs Consoles Bloqueados/LT (BadAvatar)
- O exploit BadAvatar carrega o XeUnshackle e executa a dashboard Aurora diretamente na memória do console bloqueado/LT.
- Sob a Aurora, o console bloqueado ganha a capacidade de carregar código homebrew e executáveis `.xex` não assinados normalmente.
- O sufixo `( XBOX 360 RGH )` no catálogo do Hugging Face é mera terminologia usada pelo uploader da scene para indicar rips em formato de pasta/XEX solto, em oposição a imagens ISO Redump para gravação em mídias de DVD dual layer para LT 3.0.
- Dessa forma, os emuladores válidos (`Snes360`, `MAME`, `FBANext`) rodam perfeitamente em consoles bloqueados rodando BadAvatar / Aurora. Eles devem continuar visíveis e agora funcionais para todos os usuários.

## Resolução

1. **Fallback de Homebrew `.xex` em `src/server/infrastructure/helpers/helpers.go`**:
   - `FindXEXFolder()` continua buscando prioritariamente por `default.xex`.
   - Caso nenhum `default.xex` seja encontrado na árvore descompactada, a função aciona `findHomebrewXEX()`, que localiza o executável `.xex` principal da pasta (ignorando plugins como `ftpdll.xex`, priorizando a menor profundidade de diretório e executáveis cujo nome bate com a raiz do pacote).
   - Ao encontrar o binário homebrew, cria um `default.xex` clonado ao lado dele via `CopyFileBuffered`.
   - **Benefícios da abordagem:**
     1. A dashboard Aurora faz o scan automático de conteúdo buscando `default.xex` e lista o emulador na interface.
     2. O scanner do Electron (`localGameScannerService.ts`) detecta o `default.xex` e marca o jogo como "Baixado" e presente na "Biblioteca Local".
     3. O pipeline de gravação (`orderEntryPointsLast`) grava o `default.xex` por último para validar a entrega atômica.
     4. O `.xex` original continua preservado para eventuais loaders que o invoquem pelo nome antigo.

2. **Detecção e Rejeição Antecipada de Pacotes Falsos / Incompatíveis**:
   - As 3 URLs corrompidas/incompatíveis do Hugging Face foram registradas em `knownBadHuggingFaceFiles` (`src/server/services/cache/huggingface.go`).
   - A função `IsKnownIncompleteHuggingFaceURL` foi exportada e conectada a uma checagem prematura em `src/server/services/pipeline/huggingface.go::ProcessHuggingFaceDownload`, bloqueando o download antes que o usuário desperdice banda e tempo baixando gigabytes inutilmente.
   - O detector em `huggingface.go` aprimorou a mensagem de erro para pacotes que possuam apenas binários XeLL (`.elf`) ou arquivos aninhados não suportados (`.rar`).

3. **Saneamento dos Catálogos Locais**:
   - Os 3 itens inválidos foram removidos das bases de catálogo em `cache/hf_xbox360.json`, `src/server/cache/hf_xbox360.json`, `cache/hf_.json`, `cache/hf_games.json` e `cache/custom_covers.json`.
   - Foi criado teste automatizado de sanitização em `src/server/services/cache/refresh_safety_test.go` para assegurar que novas atualizações de cache não reintroduzam essas releases corrompidas.

## Testes Automatizados

1. **Testes Unitários Go em `src/server/infrastructure/helpers/homebrew_xex_test.go`**:
   - `TestFindXEXFolderFallsBackToSingleHomebrewXEX`: Valida criação de `default.xex` ao lado de `Snes360.xex` e retorno correto do diretório.
   - `TestFindXEXFolderPrefersShallowestHomebrewXEX`: Valida que executável na raiz tem precedência sobre binários em subdiretórios profundos.
   - `TestFindXEXFolderPrefersNamedHomebrewOverCores`: Valida precedência de executável batendo com o nome do emulador sobre outros binários.
   - `TestFindXEXFolderIgnoresPluginsWhenStandaloneExists`: Valida que `ftpdll.xex` é ignorado em favor do executável principal.
   - `TestFindXEXFolderReturnsEmptyWhenNoXEX`: Valida que diretórios contendo apenas `.elf` ou arquivos de sistema retornam vazio sem criar `default.xex`.
   - `TestFindXEXFolderDoesNotTouchExistingDefaultXEX`: Valida que se `default.xex` já existir, ele é mantido intacto sem sobrescrita.

2. **Testes Unitários de Cache em `src/server/services/cache/refresh_safety_test.go`**:
   - `TestSanitizeHuggingFaceCacheRemovesCorruptAndIncompatibleReleases`: Valida que os 3 itens corrompidos são filtrados e que itens de emuladores legítimos são preservados.

3. **Testes Unitários de Pipeline em `src/server/services/pipeline/companion_content_test.go`**:
   - `TestXexDestinationNameHandlesHomebrewWithCustomXEXName`: Valida geração do nome da pasta XEX no disco local e FTP (`helpers.XEXFolderName`) para emuladores homebrew que receberam o fallback de `default.xex`.

4. **Testes End-to-End do Pipeline Hugging Face em `src/server/services/pipeline/huggingface_e2e_test.go`**:
   - `TestHuggingFaceE2E_HomebrewEmulatorInstallation`: Validação completa e ponta a ponta: sobe `httptest.Server` servindo zip com layout real do emulador SNES (`Snes360.xex`, `Roms/`, `skin/`), executa `ProcessHuggingFaceGameWithErr` gravando em unidade USB simulada, confere criação de `default.xex`, preservação de `Snes360.xex` e ROMs, e remoção correta do marcador `.xbox-companion-installing`.
   - `TestHuggingFaceE2E_BlockedKnownBadURL`: Confere recusa imediata das releases corrompidas do Hugging Face sem tráfego de rede.
   - `TestHuggingFaceE2E_IncompatibleXeLLELFPackage`: Confere detecção de `xenon.elf` e mensagem de erro diagnóstica sobre incompatibilidade com dashboard.
   - `TestHuggingFaceE2E_CorruptedNestedArchivePackage`: Confere detecção de arquivo compactado aninhado (`.rar`) sem executável extraído.

5. **Execução das Suítes**:
   - `go -C src/server test ./...`: 100% dos pacotes Go aprovados (`godsend`, `godsend/app`, `godsend/infrastructure/...`, `godsend/services/...`, `godsend/utils`).
   - `npm --prefix src/electron-app run test:safety`: 369 testes unitários aprovados.
   - `npm --prefix src/electron-app run test:electron-security`: Teste E2E do Electron via Playwright aprovado (`security-smoke.cjs` e `badavatar-preview-smoke.cjs`).
   - `node src/electron-app/tests/electron/browse-errors-smoke.cjs`: Teste E2E de catálogo e recuperação de erros aprovado.

## Critérios para fechar

- [x] Layout real de todos os 6 pacotes listados comprovado e inspecionado via HTTP Range
- [x] Os 3 emuladores legítimos instalam normalmente através do fallback de executável homebrew
- [x] Os 3 itens corrompidos/incompatíveis foram removidos dos catálogos e bloqueados contra download inútil
- [x] Decisão sobre mostrar itens "( XBOX 360 RGH )" a quem preparou em modo bloqueado/LT fundamentada (Aurora roda homebrew `.xex` igualmente)
- [ ] Nenhum reporte novo com `No default.xex` para esses itens na telemetria após deploy da versão 2.12.125
