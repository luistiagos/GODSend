---
name: auditar-payloads-xbox360
description: >-
  Audita o conteudo interno de pacotes remotos de Xbox 360 RGH (.zip/.rar/.7z) via
  HTTP Range — sem baixar gigabytes — para localizar itens que retornam HTTP 200,
  mas estao quebrados ou inutilizaveis: arquivos aninhados isca (ex.: .rar interno
  como sdfasdasdfas.rar), pacotes so de saves/CON, patches/CPK/DLC/trainers sem jogo
  base (sem default.xex nem GOD 00007000/XBLA 0000D000), homebrews ELF (xenon.elf) ou
  payload de outro jogo. Cruza ocorrencias entre Xbox Companion, romsrepository e
  RetroBatNew. Use quando um jogo do catalogo falhar ao instalar/iniciar, quando o
  usuario pedir para localizar releases defeituosas, patch-only ou quebradas no acervo
  Xbox 360 RGH, ou para auditar categorias inteiras (ex.: FIFA, PES, Bomba Patch).
---

# Auditar Payloads Xbox 360 RGH

Ferramentas tradicionais de sanitizacao (`validar-links-roms`, `sanitizar-acervo`) validam
apenas HTTP `200`/`404` e existencia do arquivo no servidor. Esta skill inspeciona o
**Diretorio Central remoto do ZIP via HTTP `Range`** (gastando poucos KB por release de
varios GB) para provar se o pacote realmente entrega um jogo Xbox 360 RGH executavel.

Esta skill mora em `.claude/skills/auditar-payloads-xbox360/` do repositorio GODSend
(`Downloader-XBOX360-XEX-HDD-Games`) e aparece em `~\.gemini\config\skills\` via
`C:\projects\agentes-config\antigravity\skills-de-projeto.json`.

---

## Regras Inegociaveis

1. **Auditoria e somente leitura:** `auditar_payloads.py` nunca altera codigo, cache nem banco.
2. **Nunca presumir defeito sem abrir o header/CD:** sempre confirmar por `HTTP Range` ou teste direto antes de propor remocao.
3. **Respeitar fronteira de sistema:** `BOMBA PATCH 2025` existe em PS2 (`catalog_manifest_ps2.txt`) e Xbox 360 RGH (`luisluis123/xboxrghgames`); nunca remova item de outro console por nome parecido.
4. **Limpeza no `romsrepository` exige analise de risco previa e pos-validacao:** siga `d:\projects\romsrepository\AGENTS.md` (checar `ROM_EQUIVALENCE`, compartilhamento de `INFO` e contagem exata antes e depois).
5. **Arvore compartilhada:** se houver edicoes de outra sessao no repo, nunca use `git add -A` ou `git checkout --`.

---

## Passo 1 — Localizar itens problematicos (HTTP Range)

Da raiz do Xbox Companion (`C:\projects\Downloader-XBOX360-XEX-HDD-Games`) ou informando
os caminhos por flag:

### Auditar categoria ou termo no cache local do Xbox Companion
```powershell
python .claude/skills/auditar-payloads-xbox360/scripts/auditar_payloads.py `
  --source hf-cache `
  --xb-root . `
  --filter "FIFA|PES|BOMBA|ONFIRE" `
  --cross-check `
  --rb-root C:\projects\retrobatnew `
  --out-json C:\Users\$env:USERNAME\.gemini\antigravity\brain\temp\audit_xbox360.json
```

### Auditar diretamente a API viva do romsrepository
```powershell
python .claude/skills/auditar-payloads-xbox360/scripts/auditar_payloads.py `
  --source api `
  --api-url "https://emuladores.pythonanywhere.com/api/rom/list?system=xbox360rgh&source_id=1" `
  --xb-root C:\projects\Downloader-XBOX360-XEX-HDD-Games `
  --rb-root C:\projects\retrobatnew `
  --exclude-known-bad `
  --cross-check
```

### Auditar uma URL suspeita avulsa (chamado de suporte)
```powershell
python .claude/skills/auditar-payloads-xbox360/scripts/auditar_payloads.py `
  --source url `
  --url "https://huggingface.co/datasets/luisluis123/xboxrghgames/resolve/main/..."
```

---

## Passo 2 — Interpretar a classificacao

| Status | Significado | Acao recomendada |
|---|---|---|
| `OK_XEX` / `OK_GOD` / `OK_XBLA` | Contem `default.xex`, `00007000` (GOD) ou `0000D000` (XBLA) compativel | Manter |
| `OK_*_WITH_WARNINGS` | Tem executavel jogavel, mas pasta/extras suspeitos (ex.: `SLEEPING DOGS` extra) | Revisar manualmente antes de decidir |
| `BROKEN_NESTED_ARCHIVE` | So contem arquivo compactado interno (ex.: `sdfasdasdfas.rar`) sem jogo direto | Inspecionar/Confirmar isca e remover |
| `BROKEN_PATCH_ONLY` | So contem DLC/TU/`.cpk`/`DpFileList.bin`/`4A3007D3`/Trainers (`Trainer.xex`), sem `default.xex` nem GOD `00007000` | Remover / bloquear (nao roda sozinho) |
| `BROKEN_SAVE_ONLY` | So contem perfil `E000...`, save/elenco CON ou `< 50 MiB` sem executavel | Remover / bloquear |
| `BROKEN_HOMEBREW_ELF` | So contem binario ELF (`xenon.elf` XeLL), sem `.xex` / GOD | Remover / bloquear |
| `BROKEN_TITLE_MISMATCH` | `default.xex` pertence claramente a outro jogo | Remover / bloquear ou realocar se aplicavel |
| `BROKEN_NO_EXECUTABLE` / `ERROR_HTTP_*` | Sem executavel ou HTTP morto (`404`/`410`) | Remover / bloquear |
| `NON_ZIP_RAR` / `NON_ZIP_7Z` | Arquivo remoto `.rar` ou `.7z` direto (nao ZIP) | Validar com `unrar`/`7z` ou amostra se necessario |

---

## Passo 3 — Limpeza coordenada (quando o dono aprovar)

Apos confirmar a lista exata dos itens quebrados:

1. **Xbox Companion (`Downloader-XBOX360-XEX-HDD-Games`):**
   - Adicionar os nomes exatos (em minusculas, unescaped) em `knownBadHuggingFaceFiles` dentro de `src/server/services/cache/huggingface.go`.
   - Adicionar caso de teste em `src/server/services/cache/refresh_safety_test.go`.
   - Remover as entradas dos 5 JSONs de cache:
     `cache/hf_xbox360.json`, `cache/hf_.json`, `cache/hf_games.json`,
     `src/server/cache/hf_xbox360.json` e `cache/custom_covers.json`.
   - Rodar `go -C src/server test ./services/cache/... ./models/...`.

2. **Banco `romsrepository` (`emuladores$Roms`):**
   - Cumprir `d:\projects\romsrepository\AGENTS.md`:
     1. Confirmar por `SELECT` os `rom_id` e `info_id` exatos (`console_id = 43321854`), checar `ROM_EQUIVALENCE` (`0` refs) e verificar se algum `info_id` tem `COUNT(*) > 1` em `ROM`.
     2. Deletar por PK exata: `DELETE FROM ROM WHERE rom_id IN (...) AND console_id = 43321854`.
     3. Deletar apenas `INFO` orfaos (`NOT EXISTS (SELECT 1 FROM ROM r WHERE r.info_id = INFO.info_id)`).
     4. Validar contagem antes/depois e conferir `GET https://emuladores.pythonanywhere.com/api/rom/list?system=xbox360rgh&source_id=1`.
   - Verificar `.csv` locais em `d:\projects\romsrepository` e alertar o dono se os `.zip` continuam no dataset Hugging Face (`luisluis123/xboxrghgames`), pois `feed_romsrepository_xbox360rgh.py` os reinseriria no proximo sync.

3. **RetroBatNew (`retrobatnew`):**
   - Conferir se ha linhas exatas do mesmo sistema em `source/catalogs/catalog_manifest_*.txt` (atualmente RGH do Hugging Face nao esta nos manifestos ativos do RetroBatNew).

---

## Testes da propria skill

```powershell
python -m unittest discover -s .claude/skills/auditar-payloads-xbox360/tests -v
```
