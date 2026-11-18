#!/usr/bin/env python3
"""
Audit remote Xbox 360 RGH archives via HTTP Range without full downloads.

Inspects ZIP Central Directories remotely to detect payloads that return HTTP 200
but cannot deliver a playable Xbox 360 RGH game (nested decoy RAR/ZIPs, save-only
packages, DLC/CPK/Trainer patch-only packs without base game, XeLL ELF homebrews,
missing executables, or title mismatches), and cross-checks presence across
Xbox Companion caches, romsrepository API/DB, and RetroBatNew manifests.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from typing import Any


GOD_BASE_RE = re.compile(r"(?:^|/)content/0{16}/[0-9a-f]{8}/00007000/", re.IGNORECASE)
XBLA_BASE_RE = re.compile(r"(?:^|/)content/0{16}/[0-9a-f]{8}/0000d000/", re.IGNORECASE)
CONTENT_TITLE_RE = re.compile(r"(?:^|/)content/0{16}/([0-9a-f]{8})/([0-9a-f]{8})/", re.IGNORECASE)
PROFILE_CON_RE = re.compile(r"(?:^|/)content/e[0-9a-f]{15,16}/", re.IGNORECASE)
TRAINER_PATH_RE = re.compile(
    r"(?:trainer|xyzpatcher|dashlaunch|xexmenu|freestyle|aurora.*trainer)",
    re.IGNORECASE,
)

JUNK_BASENAMES = {
    "thumbs.db",
    "desktop.ini",
    ".ds_store",
    "leia-me.txt",
    "readme.txt",
}
JUNK_EXTENSIONS = (".url", ".lnk", ".htm", ".html")
ARCHIVE_EXTENSIONS = (".rar", ".zip", ".7z")
GENERIC_XEX_PARENTS = {
    "",
    "game",
    "games",
    "xex",
    "root",
    "iso",
    "data",
    "disc 1",
    "disc 2",
    "dvd 1",
    "dvd 2",
    "cd 1",
    "cd 2",
}
TITLE_STOPWORDS = {
    "xbox",
    "360",
    "rgh",
    "jtag",
    "xploit",
    "god",
    "xex",
    "xbla",
    "iso",
    "pt",
    "br",
    "ptbr",
    "dublado",
    "legendado",
    "full",
    "og",
    "dlc",
    "dlcs",
    "tu",
    "save",
    "pack",
    "patch",
    "att",
    "atualizacao",
    "atualização",
    "para",
    "com",
    "the",
    "of",
    "and",
    "edition",
    "edicao",
    "classico",
    "hd",
    "disc",
    "dvd",
    "zip",
    "rar",
    "7z",
}

SUSPICIOUS_CROSS_TITLES = [
    ("sleeping dogs", {"sleeping", "dogs"}),
    ("grand theft auto", {"grand", "theft", "gta"}),
    ("fifa", {"fifa"}),
    ("pes", {"pes", "evolution", "bomba", "onfire", "joker", "arrow", "brazukas"}),
]


def _normalize_ascii_tokens(text: str) -> set[str]:
    import unicodedata

    nfkd = unicodedata.normalize("NFKD", text or "")
    ascii_txt = "".join(c for c in nfkd if not unicodedata.combining(c)).lower()
    raw = re.findall(r"[a-z0-9]+", ascii_txt)
    return {t for t in raw if len(t) >= 2 and t not in TITLE_STOPWORDS}


def _is_junk(rel_path: str) -> bool:
    norm = rel_path.replace("\\", "/").lstrip("/")
    if not norm or norm.endswith("/"):
        return True
    low = norm.lower()
    if low.startswith("__macosx/"):
        return True
    base = low.rsplit("/", 1)[-1]
    if base in JUNK_BASENAMES or base.endswith(JUNK_EXTENSIONS):
        return True
    return False


def check_title_mismatch(title: str, default_xex_paths: list[str]) -> tuple[bool, list[str]]:
    """
    Detect obvious mismatches where a folder containing default.xex names an
    unrelated game (e.g., SLEEPING DOGS PT-BR/default.xex inside GTA V or PES).
    Returns (has_critical_mismatch, warnings).
    """
    title_tokens = _normalize_ascii_tokens(title)
    if not title_tokens or not default_xex_paths:
        return False, []

    warnings: list[str] = []
    matched_any = False
    has_meaningful_parent = False

    for path in default_xex_paths:
        norm = path.replace("\\", "/").strip("/")
        parts = [p for p in norm.split("/")[:-1] if p]
        parent_str = " ".join(p for p in parts if p.lower() not in GENERIC_XEX_PARENTS)
        parent_tokens = _normalize_ascii_tokens(parent_str)
        if not parent_tokens:
            continue
        has_meaningful_parent = True
        if parent_tokens & title_tokens:
            matched_any = True
        else:
            parent_low = parent_str.lower()
            for label, required in SUSPICIOUS_CROSS_TITLES:
                if label in parent_low and not (title_tokens & required):
                    warnings.append(f"unexpected executable path `{path}` for title `{title}`")
                    break
            else:
                warnings.append(f"parent folder `{parent_str}` has 0 token overlap with title")

    critical = has_meaningful_parent and not matched_any and any("unexpected executable path" in w for w in warnings)
    return critical, warnings


def classify_zip_entries(title: str, entries: list[dict[str, Any]], total_archive_size: int = 0) -> dict[str, Any]:
    """
    Classify an archive payload from its file listing (`[{"name": ..., "size": ...}]`).
    """
    files = [e for e in entries if not _is_junk(e.get("name", ""))]
    if not files:
        return {
            "status": "BROKEN_EMPTY_ARCHIVE",
            "is_broken": True,
            "reason": "Archive contains no non-junk files",
            "file_count": 0,
            "default_xex": [],
            "god_title_ids": [],
            "xbla_title_ids": [],
            "warnings": [],
            "sample": [],
        }

    game_default_xex: list[str] = []
    trainer_xex: list[str] = []
    other_xex: list[str] = []
    god_title_ids: set[str] = set()
    xbla_title_ids: set[str] = set()
    dlc_or_tu_hits: list[str] = []
    cpk_hits: list[str] = []
    save_hits: list[str] = []
    elf_hits: list[str] = []
    nested_archives: list[str] = []

    for e in files:
        raw_name = e["name"].replace("\\", "/")
        low = raw_name.lower()
        base = low.rsplit("/", 1)[-1]
        size = int(e.get("size") or 0)

        if base.endswith(".xex"):
            if TRAINER_PATH_RE.search(low):
                trainer_xex.append(raw_name)
            elif base == "default.xex":
                game_default_xex.append(raw_name)
            else:
                other_xex.append(raw_name)

        if base.endswith(".elf"):
            elf_hits.append(raw_name)

        if base.endswith(ARCHIVE_EXTENSIONS):
            nested_archives.append(raw_name)

        m_ct = CONTENT_TITLE_RE.search(low)
        if m_ct:
            tid, sub = m_ct.group(1).upper(), m_ct.group(2).lower()
            if sub == "00007000":
                god_title_ids.add(tid)
            elif sub == "0000d000":
                xbla_title_ids.add(tid)
            elif sub in ("00000002", "000b0000"):
                dlc_or_tu_hits.append(raw_name)
            elif sub == "00000001":
                if base.endswith(".cpk") or base in ("dpfilelist.bin",):
                    cpk_hits.append(raw_name)
                elif size < 50 * 1024 * 1024:
                    save_hits.append(raw_name)
                else:
                    dlc_or_tu_hits.append(raw_name)

        if base.endswith(".cpk") or base == "dpfilelist.bin" or base.startswith("tu0000"):
            cpk_hits.append(raw_name)

        if PROFILE_CON_RE.search(low) or base.startswith("edit0000"):
            save_hits.append(raw_name)

    sample = [e["name"] for e in files[:8]]
    base_info = {
        "file_count": len(files),
        "default_xex": game_default_xex[:10],
        "trainer_xex_count": len(trainer_xex),
        "god_title_ids": sorted(god_title_ids),
        "xbla_title_ids": sorted(xbla_title_ids),
        "nested_archives": nested_archives[:10],
        "sample": sample,
    }

    # 1. Pure nested decoy/archive container (no executables, no GOD/XBLA base)
    if nested_archives and not (game_default_xex or other_xex or god_title_ids or xbla_title_ids):
        if len(nested_archives) == len(files) or len(files) <= 3:
            return {
                **base_info,
                "status": "BROKEN_NESTED_ARCHIVE",
                "is_broken": True,
                "reason": f"Contains only nested archive(s): {', '.join(nested_archives[:3])}",
                "warnings": [],
            }

    # 2. Homebrew ELF only (e.g., xenon.elf without .xex / GOD / XBLA)
    if elf_hits and not (game_default_xex or other_xex or god_title_ids or xbla_title_ids):
        return {
            **base_info,
            "status": "BROKEN_HOMEBREW_ELF",
            "is_broken": True,
            "reason": f"XeLL/ELF binary only ({', '.join(elf_hits[:3])}), no Xbox 360 executable",
            "warnings": [],
        }

    # 3. Playable game candidate (default.xex, GOD 00007000, or XBLA 0000D000)
    if game_default_xex or god_title_ids or xbla_title_ids:
        critical_mismatch, mismatch_warnings = check_title_mismatch(title, game_default_xex)
        if critical_mismatch and not (god_title_ids or xbla_title_ids):
            return {
                **base_info,
                "status": "BROKEN_TITLE_MISMATCH",
                "is_broken": True,
                "reason": "; ".join(mismatch_warnings[:3]),
                "warnings": mismatch_warnings,
            }

        kinds = []
        if game_default_xex:
            kinds.append("XEX")
        if god_title_ids:
            kinds.append("GOD")
        if xbla_title_ids:
            kinds.append("XBLA")
        status = f"OK_{'_'.join(kinds)}"
        if mismatch_warnings:
            status = f"{status}_WITH_WARNINGS"
        return {
            **base_info,
            "status": status,
            "is_broken": False,
            "reason": f"Playable {'/'.join(kinds)} payload detected",
            "warnings": mismatch_warnings,
        }

    # 4. Patch/DLC/CPK/Trainer-only without base game
    if dlc_or_tu_hits or cpk_hits or trainer_xex:
        return {
            **base_info,
            "status": "BROKEN_PATCH_ONLY",
            "is_broken": True,
            "reason": (
                f"Patch/DLC/CPK/Trainer files only (cpk={len(cpk_hits)}, "
                f"dlc_tu={len(dlc_or_tu_hits)}, trainers={len(trainer_xex)}), "
                "missing default.xex and GOD 00007000"
            ),
            "warnings": [],
        }

    # 5. Save / profile / option files only
    payload_bytes = total_archive_size or sum(int(e.get("size") or 0) for e in files)
    if save_hits or payload_bytes < 50 * 1024 * 1024:
        return {
            **base_info,
            "status": "BROKEN_SAVE_ONLY",
            "is_broken": True,
            "reason": f"Saves/small data only ({payload_bytes} bytes), no game executable",
            "warnings": [],
        }

    # 6. Other non-trainer .xex (e.g., custom launch.xex) -> manual review
    if other_xex:
        return {
            **base_info,
            "status": "REVIEW_OTHER_XEX",
            "is_broken": False,
            "reason": f"Non-standard .xex found without default.xex: {', '.join(other_xex[:3])}",
            "warnings": ["No default.xex; manual check advised"],
        }

    return {
        **base_info,
        "status": "BROKEN_NO_EXECUTABLE",
        "is_broken": True,
        "reason": "No default.xex, GOD 00007000, or XBLA 0000D000 found in archive",
        "warnings": [],
    }


class RangeHTTPFile:
    """File-like object backed by HTTP Range requests (follows redirects)."""

    def __init__(self, url: str, timeout: int = 25, opener: Any = None):
        self.original_url = url
        self.timeout = timeout
        self.opener = opener or urllib.request
        self.bytes_fetched = 0
        self.range_requests = 0
        self.pos = 0

        head_req = urllib.request.Request(url, method="HEAD")
        with self.opener.urlopen(head_req, timeout=timeout) as resp:
            self.resolved_url = resp.geturl()
            self.status_code = getattr(resp, "status", 200)
            cl = resp.headers.get("Content-Length")
            if cl is None:
                raise ValueError("Missing Content-Length header on HEAD response")
            self.size = int(cl)
            self.accept_ranges = (resp.headers.get("Accept-Ranges") or "").lower()

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence == 0:
            self.pos = offset
        elif whence == 1:
            self.pos += offset
        elif whence == 2:
            self.pos = self.size + offset
        else:
            raise ValueError(f"Unsupported whence: {whence}")
        if self.pos < 0:
            self.pos = 0
        return self.pos

    def tell(self) -> int:
        return self.pos

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def read(self, n: int = -1) -> bytes:
        if n == 0 or self.pos >= self.size:
            return b""
        if n < 0:
            n = self.size - self.pos
        end = min(self.size - 1, self.pos + n - 1)
        req = urllib.request.Request(
            self.resolved_url,
            headers={"Range": f"bytes={self.pos}-{end}"},
        )
        with self.opener.urlopen(req, timeout=self.timeout) as resp:
            data = resp.read()
        self.bytes_fetched += len(data)
        self.range_requests += 1
        self.pos += len(data)
        return data


def audit_remote_item(item: dict[str, Any], timeout: int = 25) -> dict[str, Any]:
    """Audit a single item `{title, url, size?}` using HTTP Range."""
    title = item.get("title") or ""
    url = item.get("url") or ""
    out: dict[str, Any] = {"title": title, "url": url, "reported_size": item.get("size", "")}

    try:
        rf = RangeHTTPFile(url, timeout=timeout)
        out["content_length"] = rf.size
        out["http_status"] = rf.status_code

        # Check magic header if not .zip or as a quick probe
        magic = rf.read(8)
        rf.seek(0)
        if magic.startswith(b"PK"):
            with zipfile.ZipFile(rf) as zf:
                entries = [{"name": info.filename, "size": info.file_size} for info in zf.infolist()]
            cls = classify_zip_entries(title, entries, total_archive_size=rf.size)
            out.update(cls)
        elif magic.startswith(b"Rar!"):
            out.update(
                {
                    "status": "NON_ZIP_RAR",
                    "is_broken": False,
                    "reason": "Direct RAR archive (Range ZIP audit N/A; inspect with unrar/7z if needed)",
                    "warnings": [],
                }
            )
        elif magic.startswith(b"7z\xbc\xaf\x27\x1c"):
            out.update(
                {
                    "status": "NON_ZIP_7Z",
                    "is_broken": False,
                    "reason": "Direct 7z archive (Range ZIP audit N/A; inspect tail/header separately)",
                    "warnings": [],
                }
            )
        else:
            out.update(
                {
                    "status": "BROKEN_NOT_AN_ARCHIVE",
                    "is_broken": True,
                    "reason": f"Unexpected magic header {magic!r} (not ZIP/RAR/7z)",
                    "warnings": [],
                }
            )
        out["bytes_fetched"] = rf.bytes_fetched
        out["range_requests"] = rf.range_requests
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            out.update(
                {
                    "status": f"AUTH_REQUIRED_HTTP_{exc.code}",
                    "is_broken": False,
                    "http_status": exc.code,
                    "reason": f"Authentication required ({exc.code}); cannot inspect without session",
                    "warnings": [str(exc)],
                }
            )
        else:
            out.update(
                {
                    "status": f"ERROR_HTTP_{exc.code}",
                    "is_broken": True,
                    "http_status": exc.code,
                    "reason": str(exc),
                    "warnings": [],
                }
            )
    except zipfile.BadZipFile as exc:
        out.update(
            {
                "status": "BROKEN_BAD_ZIP",
                "is_broken": True,
                "reason": f"BadZipFile: {exc}",
                "warnings": [],
            }
        )
    except Exception as exc:
        out.update(
            {
                "status": "ERROR_INSPECTION",
                "is_broken": False,
                "reason": f"{type(exc).__name__}: {exc}",
                "warnings": [str(exc)],
            }
        )
    return out


def parse_known_bad_go(go_path: str) -> set[str]:
    """Extract lowercased filenames from `knownBadHuggingFaceFiles` in huggingface.go."""
    if not os.path.exists(go_path):
        return set()
    with open(go_path, "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"var knownBadHuggingFaceFiles\s*=\s*map\[string\]bool\{(.*?)\n\}", text, re.DOTALL)
    if not m:
        return set()
    return {k.lower() for k in re.findall(r'"((?:[^"\\]|\\.)+)"\s*:\s*true', m.group(1))}


def load_items_from_hf_cache(cache_path: str) -> list[dict[str, Any]]:
    with open(cache_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    entries = data.get("game_entries", {})
    items = []
    for key, val in entries.items():
        if not isinstance(val, dict):
            continue
        title = key.split("\x00", 1)[-1]
        url = val.get("filename") or ""
        if url:
            items.append({"title": title, "url": url, "size": val.get("collection_id", "")})
    return items


def load_items_from_api(api_url: str, timeout: int = 30) -> list[dict[str, Any]]:
    req = urllib.request.Request(api_url, headers={"User-Agent": "auditar-payloads-xbox360/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    raw_list = payload if isinstance(payload, list) else payload.get("roms", payload.get("data", []))
    items = []
    for row in raw_list:
        if not isinstance(row, dict):
            continue
        url = row.get("link") or ""
        path = row.get("path") or ""
        title = path[:-4] if path.lower().endswith(ARCHIVE_EXTENSIONS) else (row.get("name") or path)
        if url:
            items.append(
                {
                    "title": title,
                    "path": path,
                    "url": url,
                    "size": row.get("size", ""),
                    "rom_id": row.get("rom_id"),
                    "info_id": row.get("info_id"),
                }
            )
    return items


def cross_check_repos(
    broken_urls: list[str],
    xb_root: str | None,
    rb_root: str | None,
    api_url: str | None,
) -> dict[str, Any]:
    """Check where target URL basenames/titles still exist across repos."""
    basenames_lower = {urllib.parse.unquote(u.rsplit("/", 1)[-1]).lower() for u in broken_urls}
    titles_lower = {b.rsplit(".", 1)[0] if "." in b else b for b in basenames_lower}

    summary: dict[str, Any] = {}
    if xb_root and os.path.isdir(xb_root):
        go_bad = parse_known_bad_go(os.path.join(xb_root, "src/server/services/cache/huggingface.go"))
        missing_in_go = sorted(b for b in basenames_lower if b not in go_bad)
        cache_hits: dict[str, int] = {}
        for rel in (
            "cache/hf_xbox360.json",
            "cache/hf_.json",
            "cache/hf_games.json",
            "cache/custom_covers.json",
            "src/server/cache/hf_xbox360.json",
        ):
            p = os.path.join(xb_root, rel)
            if not os.path.exists(p):
                continue
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            if rel.endswith("custom_covers.json"):
                hits = sum(1 for k in data if k.lower() in titles_lower)
            else:
                hits = sum(1 for g in data.get("games", []) if str(g).lower() in titles_lower)
            cache_hits[rel] = hits
        summary["xbox_companion"] = {
            "missing_from_knownBadHuggingFaceFiles": missing_in_go,
            "cache_hits": cache_hits,
        }

    if rb_root and os.path.isdir(rb_root):
        cat_dir = os.path.join(rb_root, "source/catalogs")
        manifest_hits: dict[str, int] = {}
        if os.path.isdir(cat_dir):
            for fn in sorted(os.listdir(cat_dir)):
                if fn.startswith("catalog_manifest_") and fn.endswith(".txt"):
                    p = os.path.join(cat_dir, fn)
                    cnt = 0
                    with open(p, "r", encoding="utf-8", errors="ignore") as f:
                        for line in f:
                            low = line.lower()
                            if any(b in low for b in basenames_lower):
                                cnt += 1
                    if cnt:
                        manifest_hits[fn] = cnt
        summary["retrobatnew"] = {"active_manifest_exact_filename_hits": manifest_hits}

    if api_url:
        try:
            api_items = load_items_from_api(api_url)
            api_hits = [
                it["path"]
                for it in api_items
                if urllib.parse.unquote(it["url"].rsplit("/", 1)[-1]).lower() in basenames_lower
                or (it.get("path") or "").lower() in basenames_lower
            ]
            summary["romsrepository_api"] = {"live_hits_count": len(api_hits), "live_hits": sorted(api_hits)}
        except Exception as exc:
            summary["romsrepository_api"] = {"error": str(exc)}

    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit Xbox 360 RGH remote archive payloads via HTTP Range.")
    parser.add_argument(
        "--source",
        choices=("hf-cache", "api", "url", "urls-file"),
        required=True,
        help="Input catalog source to audit.",
    )
    parser.add_argument("--cache-file", help="Path to hf_xbox360.json when --source=hf-cache.")
    parser.add_argument(
        "--api-url",
        default="https://emuladores.pythonanywhere.com/api/rom/list?system=xbox360rgh&source_id=1",
        help="romsrepository API endpoint when --source=api or --cross-check.",
    )
    parser.add_argument("--url", help="Single URL to inspect when --source=url.")
    parser.add_argument("--urls-file", help="Newline-separated URLs file when --source=urls-file.")
    parser.add_argument("--filter", help="Case-insensitive regex to filter titles/URLs.")
    parser.add_argument("--limit", type=int, default=0, help="Optional max items to inspect (0 = all matching).")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent HTTP workers (default: 8).")
    parser.add_argument("--timeout", type=int, default=25, help="HTTP timeout in seconds (default: 25).")
    parser.add_argument("--xb-root", help="Path to Downloader-XBOX360-XEX-HDD-Games repo.")
    parser.add_argument("--rb-root", help="Path to retrobatnew repo.")
    parser.add_argument("--exclude-known-bad", action="store_true", help="Skip files already in knownBadHuggingFaceFiles.")
    parser.add_argument("--cross-check", action="store_true", help="Check where broken items exist across repos.")
    parser.add_argument("--out-json", help="Optional path to save full JSON audit output.")
    args = parser.parse_args(argv)

    if args.source == "hf-cache":
        cache_path = args.cache_file or (os.path.join(args.xb_root, "cache/hf_xbox360.json") if args.xb_root else "")
        if not cache_path or not os.path.exists(cache_path):
            print("Error: --cache-file or valid --xb-root is required for hf-cache.", file=sys.stderr)
            return 2
        items = load_items_from_hf_cache(cache_path)
    elif args.source == "api":
        items = load_items_from_api(args.api_url, timeout=args.timeout)
    elif args.source == "url":
        if not args.url:
            print("Error: --url is required for --source=url.", file=sys.stderr)
            return 2
        name = urllib.parse.unquote(args.url.rsplit("/", 1)[-1])
        items = [{"title": name.rsplit(".", 1)[0], "url": args.url}]
    else:
        with open(args.urls_file, "r", encoding="utf-8") as f:
            urls = [l.strip() for l in f if l.strip() and not l.strip().startswith("#")]
        items = [
            {"title": urllib.parse.unquote(u.rsplit("/", 1)[-1]).rsplit(".", 1)[0], "url": u}
            for u in urls
        ]

    if args.filter:
        pat = re.compile(args.filter, re.IGNORECASE)
        items = [it for it in items if pat.search(it.get("title", "")) or pat.search(it.get("url", ""))]

    if args.exclude_known_bad and args.xb_root:
        known_bad = parse_known_bad_go(os.path.join(args.xb_root, "src/server/services/cache/huggingface.go"))
        items = [
            it
            for it in items
            if urllib.parse.unquote(it["url"].rsplit("/", 1)[-1]).lower() not in known_bad
        ]

    if args.limit and args.limit > 0:
        items = items[: args.limit]

    print(f"Auditing {len(items)} item(s) with workers={args.workers}...", file=sys.stderr)
    results: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futs = [pool.submit(audit_remote_item, it, args.timeout) for it in items]
        for fut in concurrent.futures.as_completed(futs):
            results.append(fut.result())

    results.sort(key=lambda r: (not r.get("is_broken", False), r.get("status", ""), r.get("title", "")))
    broken = [r for r in results if r.get("is_broken")]
    warnings = [r for r in results if not r.get("is_broken") and r.get("warnings")]

    status_counts: dict[str, int] = {}
    total_fetched = 0
    for r in results:
        st = r.get("status", "UNKNOWN")
        status_counts[st] = status_counts.get(st, 0) + 1
        total_fetched += int(r.get("bytes_fetched") or 0)

    report: dict[str, Any] = {
        "total_audited": len(results),
        "broken_count": len(broken),
        "warning_count": len(warnings),
        "bytes_fetched_total": total_fetched,
        "status_counts": status_counts,
        "broken": broken,
        "warnings": warnings,
        "all": results,
    }

    if args.cross_check and broken:
        report["cross_check"] = cross_check_repos(
            [b["url"] for b in broken],
            xb_root=args.xb_root,
            rb_root=args.rb_root,
            api_url=args.api_url if (args.api_url) else None,
        )

    if args.out_json:
        os.makedirs(os.path.dirname(os.path.abspath(args.out_json)), exist_ok=True)
        with open(args.out_json, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

    print(
        f"Summary: audited={len(results)} broken={len(broken)} warnings={len(warnings)} "
        f"fetched={total_fetched / 1024:.1f} KiB"
    )
    print("Status counts:", json.dumps(status_counts, ensure_ascii=False))
    if broken:
        print("\nBroken items:")
        for b in broken:
            sz_mb = (b.get("content_length") or 0) / (1024 * 1024)
            print(f"  - [{b['status']}] {b['title']} ({sz_mb:.1f} MiB) -> {b['reason']}")
    if warnings:
        print("\nPlayable with warnings (review manually):")
        for w in warnings:
            print(f"  - [{w['status']}] {w['title']} -> {'; '.join(w['warnings'][:2])}")
    if "cross_check" in report:
        print("\nCross-check:", json.dumps(report["cross_check"], indent=2, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
