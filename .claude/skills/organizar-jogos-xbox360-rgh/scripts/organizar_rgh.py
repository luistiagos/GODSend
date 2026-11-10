#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Organizador e Preparador de Jogos para Xbox 360 RGH (Aurora Dashboard)
======================================================================
Prepara pastas de jogos de Xbox 360 para ficarem 100% prontas para copiar
diretamente para HD externo / pendrive USB e serem reconhecidas no Xbox 360 RGH:
  1. Remove arquivos lixo (URLs de canais, HTMLs, atalhos, promo TXTs, desktop.ini).
  2. Jogos XEX: Desaninha subpastas para deixar 'default.xex' na raiz do jogo.
  3. Jogos Content/GOD/XBLA: Garante estrutura 'Content\\0000000000000000\\<TitleID>'.
  4. Unifica todas as DLCs em uma única pasta '00000002'.
  5. Title Updates são movidos para '000B0000'.
  6. Perfis e Option Files (E000...) são organizados sob 'Content\\<ProfileID>'.
  7. Opcional (--extract): Extrai compactados pendentes com senha e apaga os .rar/.zip.
"""

import os
import sys
import shutil
import subprocess
import argparse
import time
import re
from typing import List, Tuple, Dict, Optional

# Suporte UTF-8 no terminal Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# Constantes de detecção de lixo
JUNK_EXTS = {'.url', '.html', '.htm', '.lnk', '.desktop'}
JUNK_FILES = {'thumbs.db', 'desktop.ini', '.ds_store'}
PROMO_TXT_RE = re.compile(
    r'^(leia[\s_-]*me|atencao|atenção|canal|gorozinho|tiktok|youtube|xex[\s_-]*brasil|site|links?|redes?[\s_-]*sociais?|creditos?|apoie|pix)\.txt$',
    re.IGNORECASE
)

# Containers oficiais do Xbox 360
XBOX_CONTAINER_DIRS = {'00007000', '0000d000', '00000002', '000b0000', '00000001', '00009000'}
TITLE_ID_RE = re.compile(r'^[0-9A-Fa-f]{8}$')
PROFILE_ID_RE = re.compile(r'^E[0-9A-Fa-f]{15}$', re.IGNORECASE)
TU_FILE_RE = re.compile(r'^(tu[0-9a-f_]+|tu_.*)$', re.IGNORECASE)

DEFAULT_PASSWORDS = ["gorozinhobr", ""]
# Pasta da biblioteca quando --target nao vem: fica na maquina, nao no codigo (o disco muda de uma maquina para outra).
BIBLIOTECA_ENV = "XBOX360_BIBLIOTECA"


def format_bytes(b: int) -> str:
    """Formata tamanho em bytes para leitura humana."""
    if b < 1024:
        return f"{b} B"
    elif b < 1024 * 1024:
        return f"{b / 1024:.1f} KB"
    elif b < 1024 * 1024 * 1024:
        return f"{b / (1024 * 1024):.1f} MB"
    else:
        return f"{b / (1024 * 1024 * 1024):.2f} GB"


def get_7z_executable() -> Optional[str]:
    """Localiza o binário do 7-Zip: pasta padrao do instalador (%ProgramFiles%), depois o PATH."""
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramW6432")):
        if base and os.path.exists(os.path.join(base, "7-Zip", "7z.exe")):
            return os.path.join(base, "7-Zip", "7z.exe")
    return shutil.which("7z") or shutil.which("7za")


def remove_junk(dest_dir: str, dry_run: bool = False) -> List[str]:
    """
    Remove arquivos e links inúteis de propaganda e lixo do Windows/Mac.
    Preserva arquivos de configuração válidos (como config.txt).
    """
    deleted_files = []
    for root, dirs, files in os.walk(dest_dir, topdown=False):
        for f in files:
            fp = os.path.join(root, f)
            ext = os.path.splitext(f)[1].lower()
            fname_lower = f.lower()

            is_junk = False
            if ext in JUNK_EXTS or fname_lower in JUNK_FILES:
                is_junk = True
            elif PROMO_TXT_RE.match(fname_lower):
                is_junk = True
            elif ext == '.txt':
                try:
                    if os.path.getsize(fp) < 4096:
                        with open(fp, 'r', encoding='utf-8', errors='ignore') as tf:
                            content = tf.read().lower()
                            if any(k in content for k in ['gorozinho', 'youtube.com', 'tiktok.com', 'xex brasil', 'se inscreva', 'deixe o like']):
                                is_junk = True
                except Exception:
                    pass

            if is_junk:
                rel = os.path.relpath(fp, dest_dir)
                deleted_files.append(rel)
                if not dry_run:
                    try:
                        os.remove(fp)
                    except Exception as e:
                        print(f"    [!] Erro ao remover lixo '{f}': {e}")

    if deleted_files:
        action = "[DRY-RUN] Lixo detectado:" if dry_run else "[LIMPEZA] Removidos lixos:"
        print(f"  {action} {len(deleted_files)} arquivo(s): {deleted_files[:3]}...")
    return deleted_files


def move_all_contents(src_dir: str, dst_dir: str, dry_run: bool = False):
    """Move todos os arquivos e pastas de src_dir para dst_dir, mesclando pastas existentes."""
    if os.path.abspath(src_dir) == os.path.abspath(dst_dir):
        return
    if not os.path.exists(src_dir):
        return
    if not dry_run:
        os.makedirs(dst_dir, exist_ok=True)
    for item in os.listdir(src_dir):
        s = os.path.join(src_dir, item)
        d = os.path.join(dst_dir, item)
        if os.path.isdir(s):
            if os.path.exists(d):
                if os.path.isdir(d):
                    move_all_contents(s, d, dry_run=dry_run)
                    if not dry_run:
                        try:
                            os.rmdir(s)
                        except Exception:
                            pass
                else:
                    if not dry_run:
                        os.remove(d)
                        shutil.move(s, d)
            else:
                if not dry_run:
                    shutil.move(s, d)
        else:
            if os.path.exists(d):
                if not dry_run:
                    try:
                        os.remove(d)
                    except Exception:
                        pass
            if not dry_run:
                shutil.move(s, d)


def remove_empty_folders(dest_dir: str, dry_run: bool = False):
    """Remove pastas vazias recursivamente de baixo para cima."""
    for root, dirs, files in os.walk(dest_dir, topdown=False):
        if os.path.abspath(root) == os.path.abspath(dest_dir):
            continue
        try:
            if not os.listdir(root):
                if not dry_run:
                    os.rmdir(root)
        except Exception:
            pass


def organize_content_and_dlcs(dest_dir: str, dry_run: bool = False) -> bool:
    """
    Identifica e organiza estruturas de Content, TitleID, DLCs (00000002), GOD (00007000), XBLA (0000D000)
    garantindo que fiquem no padrao oficial do Xbox 360:
    dest_dir\\Content\\0000000000000000\\<TitleID>\\...
    """
    standard_content_root = os.path.join(dest_dir, "Content")
    target_zeros = os.path.join(standard_content_root, "0000000000000000")
    found_any_content = False

    def under_profile(path: str) -> bool:
        """Saves/perfis (Content\\E000...\\...) sao presos ao perfil e NAO podem ir para 0000000000000000."""
        rel = os.path.relpath(path, dest_dir)
        return any(PROFILE_ID_RE.match(part) for part in rel.split(os.sep))

    def under(path: str, parent: str) -> bool:
        return os.path.normcase(os.path.abspath(path) + os.sep).startswith(os.path.normcase(os.path.abspath(parent) + os.sep))

    # 1. Pastas de 16 zeros ('0000000000000000')
    zero_folders = []
    for root, dirs, files in os.walk(dest_dir):
        for d in dirs:
            if d == '0000000000000000':
                zero_folders.append(os.path.join(root, d))

    for zf in zero_folders:
        found_any_content = True
        if os.path.abspath(zf) != os.path.abspath(target_zeros):
            print(f"  -> Organizando Content de '{os.path.relpath(zf, dest_dir)}' para 'Content\\0000000000000000'...")
            move_all_contents(zf, target_zeros, dry_run=dry_run)

    # 2. TitleIDs hexadecimais de 8 caracteres contendo subpastas de conteudo do Xbox
    for root, dirs, files in os.walk(dest_dir):
        if under(root, target_zeros) or under_profile(root):
            continue
        for d in dirs:
            dp = os.path.join(root, d)
            if TITLE_ID_RE.match(d):
                subdirs = [s.lower() for s in os.listdir(dp) if os.path.isdir(os.path.join(dp, s))]
                if any(s in XBOX_CONTAINER_DIRS for s in subdirs):
                    found_any_content = True
                    target_tid = os.path.join(target_zeros, d.upper())
                    print(f"  -> Mesclando TitleID '{d}' para 'Content\\0000000000000000\\{d.upper()}'...")
                    move_all_contents(dp, target_tid, dry_run=dry_run)

    # 3. Perfis do Xbox (16 hex comecando com E000)
    for root, dirs, files in os.walk(dest_dir):
        if under(root, standard_content_root) or under_profile(root):
            continue
        for d in dirs:
            if PROFILE_ID_RE.match(d):
                found_any_content = True
                dp = os.path.join(root, d)
                target_prof = os.path.join(standard_content_root, d.upper())
                print(f"  -> Movendo perfil/save '{d}' para 'Content\\{d.upper()}'...")
                move_all_contents(dp, target_prof, dry_run=dry_run)

    # 4. Title Updates soltos (arquivos comecando com tu/TU_), move para 000B0000 do TitleID
    for root, dirs, files in os.walk(dest_dir):
        if under(root, standard_content_root) or under_profile(root):
            continue
        for f in files:
            if TU_FILE_RE.match(f):
                target_tids = []
                if os.path.exists(target_zeros):
                    target_tids = [d for d in os.listdir(target_zeros) if TITLE_ID_RE.match(d)]
                if target_tids:
                    found_any_content = True
                    tu_dst_dir = os.path.join(target_zeros, target_tids[0], "000B0000")
                    src_f = os.path.join(root, f)
                    dst_f = os.path.join(tu_dst_dir, f)
                    print(f"  -> Movido Title Update '{f}' para 'Content\\0000000000000000\\{target_tids[0]}\\000B0000'...")
                    if not dry_run:
                        os.makedirs(tu_dst_dir, exist_ok=True)
                        if os.path.exists(src_f):
                            shutil.move(src_f, dst_f)

    # 5. Pastas soltas chamadas DLC / DLCs / 00000002
    for root, dirs, files in os.walk(dest_dir):
        if under(root, standard_content_root) or under_profile(root):
            continue
        for d in dirs:
            if d.lower() in {'dlc', 'dlcs', '00000002'}:
                target_tids = []
                if os.path.exists(target_zeros):
                    target_tids = [td for td in os.listdir(target_zeros) if TITLE_ID_RE.match(td)]
                if target_tids:
                    found_any_content = True
                    dlc_dst_dir = os.path.join(target_zeros, target_tids[0], "00000002")
                    src_dlc_dir = os.path.join(root, d)
                    print(f"  -> Mesclando DLCs de '{os.path.relpath(src_dlc_dir, dest_dir)}' para 'Content\\0000000000000000\\{target_tids[0]}\\00000002'...")
                    move_all_contents(src_dlc_dir, dlc_dst_dir, dry_run=dry_run)

    return found_any_content


def organize_xbox360_game_folder(dest_dir: str, dry_run: bool = False) -> bool:
    """
    Deixa a pasta principal pronta para copiar para o HD/pendrive e jogar no Xbox 360 RGH com Aurora.
    - Remove arquivos lixo (HTMLs, URLs, promo TXTs, etc.)
    - Para jogos XEX: Coloca default.xex e seus arquivos na raiz da pasta principal.
    - Para jogos GOD / XBLA / DLCs: Garante a estrutura Content\\0000000000000000\\<TitleID>\\...
    - Consolida todas as DLCs em uma única pasta 00000002.
    - Remove todas as subpastas vazias ou intermediárias desnecessárias.
    """
    if not os.path.exists(dest_dir) or not os.path.isdir(dest_dir):
        return False

    folder_name = os.path.basename(os.path.abspath(dest_dir))
    print(f"\n[ORGANIZAR RGH] Processando pasta: '{folder_name}'...")

    # 1. Limpeza de lixo
    remove_junk(dest_dir, dry_run=dry_run)

    # 2. Busca por default.xex
    xex_paths = []
    for root, dirs, files in os.walk(dest_dir):
        for f in files:
            if f.lower() == 'default.xex':
                xex_paths.append(os.path.join(root, f))

    # CASO A: Jogo XEX encontrado
    if xex_paths:
        xex_dirs = sorted({os.path.dirname(p) for p in xex_paths})
        if len(xex_dirs) > 1:
            # Multi-disco (Disco 1 / Disco 2...) ou varios jogos: NAO desaninhar, cada disco fica na sua pasta
            print(f"  [MULTI-XEX] {len(xex_dirs)} pastas com default.xex (multi-disco?). Mantendo cada uma separada:")
            for xd in xex_dirs:
                print(f"     - {os.path.relpath(xd, dest_dir)}")
            organize_content_and_dlcs(dest_dir, dry_run=dry_run)
            remove_empty_folders(dest_dir, dry_run=dry_run)
            return True

        primary_xex = xex_paths[0]
        xex_folder = os.path.dirname(primary_xex)

        if os.path.abspath(xex_folder) != os.path.abspath(dest_dir):
            print(f"  [XEX DETECTADO] default.xex em subpasta: '{os.path.relpath(xex_folder, dest_dir)}'")
            print(f"  -> Desaninhando jogo XEX diretamente para a raiz da pasta principal...")
            move_all_contents(xex_folder, dest_dir, dry_run=dry_run)
            remove_empty_folders(dest_dir, dry_run=dry_run)

        organize_content_and_dlcs(dest_dir, dry_run=dry_run)
        remove_empty_folders(dest_dir, dry_run=dry_run)
        print(f"  [OK RGH] Jogo XEX pronto com default.xex na raiz!")
        return True

    # CASO B: Jogo Content / GOD / XBLA / DLC (sem default.xex)
    has_content = organize_content_and_dlcs(dest_dir, dry_run=dry_run)
    if has_content:
        remove_empty_folders(dest_dir, dry_run=dry_run)
        print(f"  [OK RGH] Conteudo Xbox 360 / GOD / DLCs organizado com sucesso!")
        return True

    # CASO C: Subpasta unica envolvendo tudo
    entries = os.listdir(dest_dir)
    if len(entries) == 1 and os.path.isdir(os.path.join(dest_dir, entries[0])):
        sub = os.path.join(dest_dir, entries[0])
        print(f"  [DESENROLAR] Subpasta unica detectada: '{entries[0]}'. Desaninhando...")
        move_all_contents(sub, dest_dir, dry_run=dry_run)
        remove_empty_folders(dest_dir, dry_run=dry_run)
        return organize_xbox360_game_folder(dest_dir, dry_run=dry_run)

    remove_empty_folders(dest_dir, dry_run=dry_run)
    return True


# ----------------------------------------------------------------------
# Modulo de Extracao Automatica Opcional (--extract)
# ----------------------------------------------------------------------

XBOX_DATA_DIR_NAMES = {'content', '0000000000000000', '00007000', '0000d000', '00000002', '000b0000', '00000001', '00009000'}


def is_inside_game_data(path: str, base: str) -> bool:
    """
    True se o arquivo esta dentro dos dados de um jogo ja extraido: alguma pasta entre 'base'
    e o arquivo contem default.xex, ou o caminho passa por Content/0000000000000000/perfil.
    Compactados nesses locais (ex.: DAT\\stage\\stage.zip do UFC) sao ARQUIVOS DO JOGO e
    nunca devem ser extraidos nem apagados.
    """
    base_abs = os.path.abspath(base)
    cur = os.path.dirname(os.path.abspath(path))
    while True:
        if os.path.normcase(cur) == os.path.normcase(base_abs):
            return os.path.isfile(os.path.join(cur, 'default.xex'))
        name = os.path.basename(cur).lower()
        if name in XBOX_DATA_DIR_NAMES or re.match(r'^e[0-9a-f]{15}$', name):
            return True
        if os.path.isfile(os.path.join(cur, 'default.xex')):
            return True
        parent = os.path.dirname(cur)
        if parent == cur or not os.path.normcase(cur).startswith(os.path.normcase(base_abs)):
            return False
        cur = parent


def has_incomplete_download(folder: str) -> bool:
    """True se existe algum .part (download incompleto/em andamento) na pasta."""
    for _, _, files in os.walk(folder):
        if any(f.endswith('.part') for f in files):
            return True
    return False


def find_primary_archives(folder: str) -> List[str]:
    """Identifica os arquivos compactados principais (.rar, .zip, .7z, .part1.rar, .001).
    Ignora compactados que fazem parte dos dados do jogo (ver is_inside_game_data)."""
    if not os.path.exists(folder):
        return []
    primary = []
    handled_bases = set()
    multipart_part_re = re.compile(r'^(.*?)(?:\.part(\d+))\.rar$', re.IGNORECASE)
    multipart_num_re = re.compile(r'^(.*?)\.(\d{3})$', re.IGNORECASE)
    subsidiary_re = re.compile(r'\.(r\d+|z\d+)$', re.IGNORECASE)

    for root, dirs, files in os.walk(folder):
        for f in sorted(files):
            p = os.path.join(root, f)
            ext = os.path.splitext(f)[1].lower()
            if f.endswith('.part'):
                continue
            if is_inside_game_data(p, folder):
                continue
            m_part = multipart_part_re.match(f)
            if m_part:
                base = os.path.join(root, m_part.group(1).lower())
                if base not in handled_bases:
                    primary.append(p)
                    handled_bases.add(base)
                continue
            m_num = multipart_num_re.match(f)
            if m_num:
                base = os.path.join(root, m_num.group(1).lower())
                num = int(m_num.group(2))
                if num == 1 and base not in handled_bases:
                    primary.append(p)
                    handled_bases.add(base)
                continue
            if subsidiary_re.search(f):
                continue
            if ext in {".rar", ".zip", ".7z", ".iso"}:
                primary.append(p)
    return primary


def delete_archive_and_parts(primary_arc: str) -> int:
    """Remove o arquivo compactado e todas as suas partes (.part*.rar, .001, etc.)."""
    freed = 0
    folder = os.path.dirname(primary_arc)
    fname = os.path.basename(primary_arc)
    m_part = re.match(r'^(.*?)(?:\.part\d+)\.rar$', fname, re.IGNORECASE)
    m_num = re.match(r'^(.*?)\.\d{3}$', fname, re.IGNORECASE)

    targets = []
    if m_part:
        prefix = m_part.group(1).lower()
        for f in os.listdir(folder):
            if re.match(r'^' + re.escape(prefix) + r'(?:\.part\d+)\.rar$', f, re.IGNORECASE) or re.search(r'\.(r\d+)$', f, re.IGNORECASE):
                targets.append(os.path.join(folder, f))
    elif m_num:
        prefix = m_num.group(1).lower()
        for f in os.listdir(folder):
            if re.match(r'^' + re.escape(prefix) + r'\.\d{3}$', f, re.IGNORECASE):
                targets.append(os.path.join(folder, f))
    else:
        base, _ = os.path.splitext(fname)
        for f in os.listdir(folder):
            if f == fname or re.match(r'^' + re.escape(base) + r'\.(r\d+|z\d+)$', f, re.IGNORECASE):
                targets.append(os.path.join(folder, f))

    if not targets and os.path.exists(primary_arc):
        targets.append(primary_arc)

    for t in set(targets):
        try:
            if os.path.isfile(t):
                sz = os.path.getsize(t)
                os.remove(t)
                freed += sz
                print(f"    [LIMPEZA] Removido compactado: {os.path.basename(t)} ({format_bytes(sz)})")
        except Exception as e:
            print(f"    [!] Erro ao remover {os.path.basename(t)}: {e}")
    return freed


def extract_archives_and_cleanup(dest_dir: str, passwords: List[str] = None) -> bool:
    """Extrai arquivos compactados recursivamente utilizando 7-Zip e apaga os arquivos após o sucesso."""
    if passwords is None:
        passwords = DEFAULT_PASSWORDS
    z_exe = get_7z_executable()
    if not z_exe:
        print("[!] ERRO: 7-Zip nao encontrado (nem em %ProgramFiles%\\7-Zip nem no PATH). "
              "Instale com: winget install --id 7zip.7zip --exact")
        return False

    total_freed = 0
    max_passes = 5
    pass_num = 0

    while pass_num < max_passes:
        pass_num += 1
        primary_archives = find_primary_archives(dest_dir)
        if not primary_archives:
            break

        print(f"\n[EXTRACAO] Ciclo {pass_num}: {len(primary_archives)} arquivo(s) compactado(s) para extrair...")

        for arc in primary_archives:
            arc_name = os.path.basename(arc)
            target_dir = os.path.dirname(arc)
            print(f"  -> Extraindo: {arc_name}...")
            extracted_ok = False

            for pwd in passwords:
                pwd_flag = f"-p{pwd}" if pwd else "-p"
                cmd = [z_exe, "x", pwd_flag, arc, f"-o{target_dir}", "-aoa", "-y"]
                start = time.time()
                res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
                elapsed = time.time() - start

                if res.returncode in (0, 1):
                    extracted_ok = True
                    pwd_info = f" (com senha '{pwd}')" if pwd else " (sem senha)"
                    print(f"  [OK] Extraido com sucesso em {elapsed:.1f}s{pwd_info}!")
                    break

            if not extracted_ok:
                print(f"  [!] ERRO: Falha ao extrair {arc_name} com todas as senhas testadas.")
                return False

            freed = delete_archive_and_parts(arc)
            total_freed += freed

    if total_freed > 0:
        print(f"  [OK] Total de compactados liberados em disco: {format_bytes(total_freed)}.")
    return True


# ----------------------------------------------------------------------
# Execucao em Lote ou Diretorio Unico
# ----------------------------------------------------------------------

def is_single_game_folder(folder: str) -> bool:
    """Detecta se uma pasta parece ser um jogo individual ou uma pasta com varios jogos."""
    entries = os.listdir(folder)
    # Se contem default.xex ou Content ou arquivos .img/.rpf/containers
    has_xex = any(f.lower() == 'default.xex' for f in entries)
    has_content = any(f.lower() in {'content', '0000000000000000'} for f in entries)
    has_game_data = any(f.lower().endswith(('.rpf', '.img', '.xex', '.podlzx', '.fpt')) for f in entries)
    if has_xex or has_content or has_game_data:
        return True
    # Se todas as subpastas sao pastas e contem mais de 3 pastas de jogos
    subdirs = [e for e in entries if os.path.isdir(os.path.join(folder, e))]
    if len(subdirs) >= 2:
        return False
    return True


def run_organizer(target: str, extract: bool = False, dry_run: bool = False, passwords: List[str] = None):
    """Executa a organizacao completa para uma pasta de jogo ou pasta de biblioteca."""
    target = os.path.abspath(target)
    if not os.path.exists(target):
        print(f"[!] Caminho nao encontrado: {target}")
        return

    print("=" * 80)
    print(" ORGANIZADOR DE JOGOS PARA XBOX 360 RGH (AURORA)")
    print(f" Alvo: {target}")
    print(f" Extrair compactados: {extract} | Dry-run (simulação): {dry_run}")
    print("=" * 80)

    # Verifica se o target e um jogo unico ou uma colecao de jogos
    if is_single_game_folder(target):
        game_folders = [target]
    else:
        game_folders = [os.path.join(target, d) for d in sorted(os.listdir(target)) if os.path.isdir(os.path.join(target, d))]

    print(f"[*] Total de pastas de jogos a processar: {len(game_folders)}\n")

    success_count = 0
    for idx, gf in enumerate(game_folders, start=1):
        print(f"[{idx}/{len(game_folders)}] {os.path.basename(gf)}")
        if has_incomplete_download(gf):
            print("  [PULADO] Download incompleto (.part) nesta pasta. Aguarde terminar o download antes de organizar.")
            continue
        if extract:
            extract_ok = extract_archives_and_cleanup(gf, passwords=passwords)
            if not extract_ok:
                print(f"  [!] Falha na extracao de {gf}. Compactado possivelmente corrompido: NAO organizado.")
                continue
        ok = organize_xbox360_game_folder(gf, dry_run=dry_run)
        if ok:
            success_count += 1

    print("\n" + "=" * 80)
    print(f" CONCLUIDO! {success_count}/{len(game_folders)} pastas organizadas com sucesso para Xbox 360 RGH!")
    print("=" * 80)


def main():
    parser = argparse.ArgumentParser(
        description="Organizador de Jogos para Xbox 360 RGH (Aurora Dashboard) - Limpa lixos, desaninha e unifica DLCs"
    )
    parser.add_argument(
        "--target", "-t",
        default=os.environ.get(BIBLIOTECA_ENV) or None,
        help=f"Caminho da pasta do jogo ou da pasta de biblioteca (padrao: variavel de ambiente {BIBLIOTECA_ENV})"
    )
    parser.add_argument(
        "--extract", "-e",
        action="store_true",
        help="Extrai previamente compactados pendentes (.rar, .zip, .7z) com senha e apaga os arquivos"
    )
    parser.add_argument(
        "--password", "-p",
        action="append",
        help="Senha(s) adicional(is) para descompactacao (padrao: 'gorozinhobr')"
    )
    parser.add_argument(
        "--dry-run", "-d",
        action="store_true",
        help="Apenas simula a organizacao e lista as alteracoes sem modificar arquivos"
    )

    args = parser.parse_args()
    if not args.target:
        parser.error(f"informe --target <pasta> ou defina a variavel de ambiente {BIBLIOTECA_ENV}")
    if not os.path.exists(args.target):
        # Antes saia com 0 e parecia sucesso.
        print(f"[!] Caminho nao encontrado: {os.path.abspath(args.target)}")
        sys.exit(1)
    passwords =list(dict.fromkeys((args.password or []) + DEFAULT_PASSWORDS))
    run_organizer(
        target=args.target,
        extract=args.extract,
        dry_run=args.dry_run,
        passwords=passwords
    )


if __name__ == "__main__":
    main()
