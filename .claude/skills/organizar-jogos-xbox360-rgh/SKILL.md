---
name: organizar-jogos-xbox360-rgh
description: >-
  Audita, limpa arquivos lixo, desaninha e prepara pastas de jogos de Xbox 360 para ficarem 100% prontas para copiar para o HD externo ou pendrive USB e serem reconhecidas no Xbox 360 RGH com Aurora Dashboard. Coloca o default.xex na raiz (jogos XEX), estrutura Content\0000000000000000\<TitleID> (jogos GOD/XBLA), unifica todas as DLCs em uma única pasta 00000002, move Title Updates para 000B0000, organiza perfis E000... e remove links/propagandas (.url, .html, .lnk, .txt de promo, thumbs.db). Pode também extrair compactados (.rar/.zip/.7z) com senha gorozinhobr. Ative esta skill quando o usuário pedir para organizar jogos de xbox 360, preparar para RGH/Aurora, limpar lixos/subpastas ou unificar DLCs de jogos de Xbox 360.
---

# Skill: Preparação e Organização de Jogos para Xbox 360 RGH (Aurora Dashboard)

Esta skill audita, limpa, desaninha e padroniza pastas de jogos de Xbox 360 para que fiquem **100% prontas para serem copiadas diretamente para o HD externo ou pendrive USB** e serem reconhecidas imediatamente no **Xbox 360 RGH rodando a Aurora Dashboard**.

---

## 1. Padrões de Estrutura do Xbox 360 RGH e Aurora

### A. Jogos em Formato XEX (JTAG / Extraído)
- **Como o Aurora reconhece**: O Aurora busca pelo executável `default.xex`. Se o executável estiver enterrado em subpastas intermediárias criadas na extração (ex: `Jogo\Subpasta 1\Subpasta 2\default.xex`), o Aurora pode ignorar o jogo ou gerar caminhos confusos.
- **Estrutura Final Exigida**:
  ```text
  <biblioteca>\Nome_Do_Jogo\
  ├── default.xex              <-- OBRIGATÓRIO na raiz da pasta do jogo
  ├── media\                   <-- Pastas e arquivos do jogo na raiz
  ├── data\
  └── Content\                 <-- Se o jogo contiver DLCs/TUs (ver abaixo)
  ```
- **Como Jogar**: O usuário copia a pasta `Nome_Do_Jogo` para `Usb0:\Games\` ou `Hdd1:\Games\`. O Aurora escaneia e adiciona capa instantaneamente.

### B. Jogos em Formato GOD (Games on Demand) e XBLA (Xbox Live Arcade)
- **Estrutura Oficial do Xbox**:
  ```text
  Content\0000000000000000\<TitleID>\
  ├── 00007000\       <-- Jogo Base GOD (ex: 6E5C0D4425B5800CA270 e .data)
  ├── 0000D000\       <-- Jogo Base XBLA Arcade
  ├── 00000002\       <-- TODAS as DLCs reunidas aqui
  └── 000B0000\       <-- Title Updates (patches de atualização)
  ```
- **Como Jogar**: O usuário copia a pasta `Content` para a partição de conteúdo (`Hdd1:\Content` ou `Usb0:\Content`).

### C. Unificação Obrigatória de DLCs (`00000002`)
- Frequentemente, lançamentos de internet trazem DLCs em pastas separadas (`DLC`, `DLCs`, `Addons`, ou em múltiplos pacotes).
- **Regra**: Todas as DLCs do mesmo TitleID são consolidadas em **uma única pasta** `00000002`. Nunca deixar pastas de DLC duplicadas ou soltas fora do TitleID.

### D. Title Updates e Perfis de Save
- **Title Updates**: Arquivos nomeados `tu*` ou `TU_*` são movidos para `000B0000` do respectivo TitleID.
- **Perfis / Option Files** (como em patches de PES, Bomba Patch e FIFA): Pastas iniciadas com `E` e 16 caracteres hexadecimais (ex: `E00039D75217C032`) são preservadas diretamente sob `Content\<ProfileID>\`.

### E. Limpeza Estrita de Lixo
- **Remover sem exceção**:
  - Atalhos de rede: `.url`, `.html`, `.htm`, `.lnk`, `.desktop`
  - Arquivos de sistema do Windows/Mac: `thumbs.db`, `desktop.ini`, `.ds_store`
  - Arquivos de propaganda: `LEIA-ME.txt`, links de canais YouTube, TikTok, sites de mods.
  - *Atenção*: Preservar arquivos de configuração legítimos do jogo, como `config.txt` ou arquivos `.ini`.

---

## 2. Como Executar a Skill

A skill dispõe do utilitário automatizado [organizar_rgh.py](scripts/organizar_rgh.py), em `scripts/` dentro da
pasta desta skill. A skill mora no repo do GODSend (`.claude/skills/organizar-jogos-xbox360-rgh/`); no Antigravity ela
aparece em `~\.gemini\config\skills\` por junction, criada pelo `instalar.ps1` do repo `agentes-config`. Nos comandos
abaixo, `<skill>` é a pasta desta skill.

**Pasta da biblioteca (`<biblioteca>`):** a pasta onde o dono baixa os jogos (na máquina original, a do TeraBox). Não é
fixa no código: passe `--target`, ou defina a variável de ambiente `XBOX360_BIBLIOTECA` para usá-la quando `--target`
faltar. Sem nenhum dos dois, o script para dizendo isso. Se o dono não disser a pasta, pergunte.

### 2.1. Organizar Biblioteca Completa

Varre todas as pastas de jogos no diretório destino, remove lixos, desaninha e unifica DLCs. Quando a biblioteca contiver múltiplos jogos (2 ou mais), a detecção é automática:

```powershell
python "<skill>\scripts\organizar_rgh.py" --target "<biblioteca>"
```

**Biblioteca com apenas 1 jogo (`--biblioteca` / `-b`):** Se a biblioteca contiver exatamente uma pasta de jogo e nenhum executável na raiz, a estrutura é ambígua em relação a um jogo com subpasta única. O script para preventivamente sem modificar nada e solicita a confirmação do modo. Use `--biblioteca` para forçar o tratamento como biblioteca:

```powershell
python "<skill>\scripts\organizar_rgh.py" --target "<biblioteca>" --biblioteca
```

### 2.2. Organizar um Jogo Específico

```powershell
python "<skill>\scripts\organizar_rgh.py" --target "<biblioteca>\Grand Theft Auto V + MOD Definitive Edition 1.5.1 ( COPIA E COLA )"
```

**Jogo aninhado em subpasta única (`--jogo` / `-j`):** Se a pasta do jogo contiver apenas uma subpasta (ex: `Jogo\Sub 1\default.xex`) e nenhum arquivo de jogo na raiz, use `--jogo` para indicar explicitamente que a pasta é o jogo e desaninhar os arquivos diretamente para ela:

```powershell
python "<skill>\scripts\organizar_rgh.py" --target "<pasta_do_jogo>" --jogo
```

### 2.3. Extrair Compactados Pendentes com Senha e Organizar (`--extract`)

Se a pasta contiver arquivos `.rar`, `.zip`, `.7z` ou volumes múltiplos (`.part1.rar`, `.001`), o script extrai utilizando 7-Zip com as senhas padrão (`gorozinhobr` e sem senha), apaga os arquivos compactados para liberar disco e em seguida executa a organização RGH:

```powershell
python "<skill>\scripts\organizar_rgh.py" --target "<biblioteca>" --extract
```

### 2.4. Modo Simulação / Auditoria (`--dry-run`)

Lista exatamente o que seria limpo, desaninhado ou movido sem alterar nenhum arquivo em disco:

```powershell
python "<skill>\scripts\organizar_rgh.py" --target "<biblioteca>" --dry-run
```

---

## 3. Tabela de Parâmetros do Utilitário

| Parâmetro | Atalho | Padrão | Descrição |
|---|---|---|---|
| `--target` | `-t` | `XBOX360_BIBLIOTECA` (variável de ambiente; sem ela, obrigatório) | Caminho de uma pasta individual de jogo ou de uma biblioteca contendo múltiplos jogos. Caminho inexistente sai com código 1. |
| `--jogo` | `-j` | `False` | Força o tratamento do alvo como pasta de um único jogo. |
| `--biblioteca` | `-b` | `False` | Força o tratamento do alvo como biblioteca de jogos (processa cada subpasta como jogo individual). Obrigatório quando a biblioteca tem exatamente 1 jogo. |
| `--extract` | `-e` | `False` | Extrai arquivos compactados pendentes antes de organizar e remove os arquivos de arquivo (.rar/.zip). |
| `--password` | `-p` | `gorozinhobr` | Senha adicional para testar na extração pelo 7-Zip. |
| `--dry-run` | `-d` | `False` | Executa apenas a análise sem mover ou apagar arquivos. |

---

## 4. Integração em Scripts Python

Para utilizar a lógica da skill diretamente dentro de outros scripts (ex: pipelines de download):

```python
import sys
sys.path.append(r"<skill>\scripts")
from organizar_rgh import organize_xbox360_game_folder, extract_archives_and_cleanup

game_path = r"<biblioteca>\Nome_Do_Jogo"

# 1. Extração com limpeza de compactados
extract_archives_and_cleanup(game_path, passwords=["gorozinhobr", ""])

# 2. Organização completa para Xbox 360 RGH
organize_xbox360_game_folder(game_path)
```
