"""Helper deterministico do pipeline de correcao de bugs (skill pipeline-correcao-bugs).

Etapas: 1 Planning (paralelo) -> 2 Elencar (ondas de arquivos disjuntos, AQUI, mecanico) ->
3 Desenvolvimento (uma worktree por bug) -> 4 Testes (fase offline livre, fase E2E no slot
exclusivo; a sessao de teste integra no fluxo principal) -> 5 Finalizacao.

Toda transicao passa por este script; o ledger (.bugfix-pipeline/state.json) e a unica verdade
sobre etapa de cada bug, ondas, reservas de arquivo, slot de teste e sessoes do gerenciador.
Racional: ../DESIGN.md. Uso: python pipeline.py <comando> --help
"""
from __future__ import annotations

import argparse
import contextlib
import ctypes
import datetime as dt
import getpass
import glob
import io
import json
import msvcrt
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT = Path(__file__).resolve()
SKILL = SCRIPT.parent.parent                    # <repo>/.../pipeline-correcao-bugs (versionada; fora de docs/: e codigo)
FRESH_MIN = 10                                   # arquivo mexido ha menos que isso: outra sessao editando AGORA
DSG = Path(r"C:\projects\digitalstoregamesproject")

COMPLEXITY_RANK = {"baixa": 0, "media": 1, "alta": 2}
EFFORTS = ("low", "medium", "high", "xhigh", "max")
SEVERITIES = ("critico", "alto", "medio", "baixo")
VERDICTS = ("corrigir", "sem-codigo", "outro-projeto", "bloqueado")
TERMINAL = ("retest", "documentado", "open-falhou")
ACTIVE_DEV = ("dev", "aguardando-arquivo", "teste", "aguardando-slot", "teste-e2e")


# --------------------------------------------------------------------------- projeto (projeto.json)
# O motor e IDENTICO em todo repo que usa a skill; o que e do projeto mora em `projeto.json`, ao lado do
# SKILL.md, que a sincronizacao nunca sobrescreve (DESIGN secao 22). `configure` preenche os globais
# abaixo; os testes os trocam direto no modulo (P.SRC = ...) ou chamam `configure` com outra config.

def git_out(cwd: Path, *args) -> str:
    """git SO de leitura antes de SRC existir (o `run` consulta SRC na trava da arvore principal)."""
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise SystemExit(f"ERRO: git {' '.join(args)} em {cwd}: {p.stderr.strip()}")
    return p.stdout.strip()


def configure(cfg: dict, skill: Path = SKILL):
    """SRC = raiz do repo onde a skill mora (`--show-toplevel`; pode ser WORKTREE, como o ARMSX2-forkv2: o
    `.git` dela e resolvido na hora por `git_dir`). ROOT = `raiz` relativa a SRC (o retrobatnew usa "..":
    deploy.ps1 e dist/ ficam fora do repo). PIPE fica FORA de SRC: o `guard_wt` recusa lane dentro da
    arvore principal."""
    global CFG, NOME, ROOT, SRC, PIPE, STATE, WTS, ETAPAS, REMOTO, BASE, RODIZIO, COMMIT_DOCS
    global BUILD, DEPLOY_CFG, DIST_ES, DEPLOYED, GENERATED, WT_IGNORED_INPUTS, E2E, PROIBIDO, SRC_PREFIX, MANUAL
    CFG = cfg
    NOME = cfg["nome"]
    SRC = Path(git_out(skill, "rev-parse", "--show-toplevel")).resolve()
    ROOT = (SRC / cfg.get("raiz", ".")).resolve()
    PIPE = (ROOT / cfg["pipe_dir"]).resolve() if cfg.get("pipe_dir") else SRC.parent / f".bugfix-pipeline-{SRC.name}"
    if PIPE == SRC or SRC in PIPE.parents:
        raise SystemExit(f"ERRO: pipe_dir {PIPE} esta dentro do repo {SRC}; as lanes tem de ficar fora dele")
    STATE = PIPE / "state.json"
    WTS = PIPE / "lanes"                         # worktrees: wt-planning e wt-1..N
    ETAPAS = skill / "etapas"
    MANUAL = skill / "projeto.md"                # o especifico do projeto que as etapas citam (DESIGN 22.4)
    REMOTO = cfg.get("remoto", "origin")
    BASE = cfg["base"]
    if not BASE.startswith(REMOTO + "/"):
        raise SystemExit(f"ERRO: base {BASE} nao e do remoto {REMOTO}")
    RODIZIO = bool(cfg.get("rodizio_contas"))
    COMMIT_DOCS = cfg.get("commit_docs", "docs(bugs)")
    BUILD = cfg["build"]
    DEPLOY_CFG = cfg.get("deploy")
    # Artefato deployado (por NOME: e a chave de final.deploy.files no ledger) -> saida do build dele,
    # relativa a worktree. O `final-deploy` grava o MD5 de cada um e o portao do `final-done` confere o
    # destino contra ele. Sem deploy: nada a conferir.
    DIST_ES = ROOT / DEPLOY_CFG["destino"] if DEPLOY_CFG and DEPLOY_CFG.get("destino") else None
    DEPLOYED = dict((DEPLOY_CFG or {}).get("artefatos") or {})
    # Gerados pelo build numa worktree (caminho absoluto da worktree, saida de build versionada). Nunca vao
    # para commit e sao os UNICOS que o helper descarta. Sem gerados: regex que nunca casa.
    GENERATED = re.compile("|".join(f"(?:{x})" for x in cfg.get("gerados") or []) or r"(?!)")
    # Entradas de build IGNORADAS pelo git (logo ausentes numa worktree), copiadas da arvore principal.
    WT_IGNORED_INPUTS = list(cfg.get("entradas_ignoradas") or [])
    E2E = cfg.get("e2e") or {}
    PROIBIDO = cfg.get("proibido_na_sessao", "")
    # O planning pode citar arquivo pelo caminho a partir de ROOT ('source/...'): o ledger guarda relativo a SRC.
    SRC_PREFIX = (SRC.relative_to(ROOT).as_posix() + "/") if ROOT != SRC and ROOT in SRC.parents else ""
    # Itens do tipo task e task exigida pelo fix de bug (DESIGN 22.9). Ausente = so bugs, como antes.
    global TAREFAS, TASK_RE, RETEST_FLAT, COMMIT_DOCS_OUTROS, COMMIT_TERCEIROS, ANTES_DO_PUSH
    t = cfg.get("tarefas")
    TAREFAS = {"minimo": 1, "campo_status": "Status", "abertas": ["aberta"], "em_andamento": ["em andamento"],
               "concluida": "concluída", "campo_concluida_em": None, "bug_exige_task": False, **t} if t else None
    TASK_RE = re.compile(TAREFAS["arquivo"]) if TAREFAS else None
    # retest/ e done/ sem as subpastas de open/ (no ARMSX2: open/<area>/x.md -> retest/x.md)
    RETEST_FLAT = bool(cfg.get("retest_sem_subpasta"))
    COMMIT_DOCS_OUTROS = cfg.get("commit_docs_outros", "docs")
    COMMIT_TERCEIROS = cfg.get("commit_terceiros", "chore(terceiros)")
    ANTES_DO_PUSH = cfg.get("antes_do_push") or None


def load_config(skill: Path = SKILL) -> dict:
    path = skill / "projeto.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SystemExit(f"ERRO: {path} ausente ou invalido ({e}); e a config do projeto (DESIGN secao 22)")


configure(load_config())


# --------------------------------------------------------------------------- copias (DESIGN 22.4 / 22.8 A2)
# A fonte da skill e a do retrobatnew; os outros repos tem copia versionada. So os arquivos abaixo sao
# sincronizados (`scripts/sync_copias.py`, so na fonte); `projeto.json`/`projeto.md` sao de cada repo.
FONTE = Path(r"C:\projects\retrobatnew\source\skills\pipeline-correcao-bugs")
SYNCED = ("SKILL.md", "DESIGN.md", "etapas/*.md",
          "scripts/pipeline.py", "scripts/sim_pipeline.py", "scripts/git_pipeline.py")


def synced_files(skill: Path) -> set[str]:
    return {p.relative_to(skill).as_posix() for pat in SYNCED for p in skill.glob(pat) if p.is_file()}


def copy_diff(src: Path, dst: Path) -> list[tuple[str, str]]:
    """[(caminho, 'falta'|'sobra'|'difere')] da copia `dst` contra a fonte `src`. Fim de linha nao conta: o
    autocrlf do repo da copia regrava CRLF no checkout e isso nao e divergencia."""
    a, b = synced_files(src), synced_files(dst)
    out = []
    for rel in sorted(a | b):
        if rel not in b:
            out.append((rel, "falta"))
        elif rel not in a:
            out.append((rel, "sobra"))
        elif (src / rel).read_bytes().replace(b"\r\n", b"\n") != (dst / rel).read_bytes().replace(b"\r\n", b"\n"):
            out.append((rel, "difere"))
    return out


def copy_warning() -> str | None:
    """Linha do preflight sobre a copia (None na propria fonte, ou com a fonte fora desta maquina)."""
    if not FONTE.is_dir() or FONTE.resolve() == SKILL:
        return None
    diff = copy_diff(FONTE, SKILL)
    if not diff:
        return f"[OK]   copia da skill igual a fonte {FONTE}"
    items = ", ".join(f"{r} ({k})" for r, k in diff[:6]) + (", ..." if len(diff) > 6 else "")
    return (f"[AVISO] copia da skill difere da fonte {FONTE}: {items}\n"
            f"        -> python {FONTE / 'scripts' / 'sync_copias.py'} --commit")


# --------------------------------------------------------------------------- utilidades

def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def die(msg: str, code: int = 1):
    print(f"ERRO: {msg}", file=sys.stderr)
    sys.exit(code)


# Subcomandos git que ESCREVEM na arvore/indice/branches. Nenhum deles roda na arvore principal.
GIT_WRITES = {"reset", "checkout", "clean", "rebase", "rm", "stash", "restore", "switch", "commit",
              "add", "mv", "merge", "cherry-pick", "revert", "apply", "am", "pull"}
_MAIN_SYNC = False                               # so True dentro de main_sync_window() (sync_main)


@contextlib.contextmanager
def main_sync_window():
    global _MAIN_SYNC
    _MAIN_SYNC = True
    try:
        yield
    finally:
        _MAIN_SYNC = False


def refuse_main_tree(cmd, cwd):
    """Segunda trava (a primeira e guard_wt): vale para QUALQUER git do helper, inclusive um
    escrito no futuro sem cwd — o padrao do git() e a arvore principal, entao e ali que o erro cairia."""
    if not cmd or Path(str(cmd[0])).stem.lower() != "git" or len(cmd) < 2:
        return
    sub, rest = str(cmd[1]), [str(x) for x in cmd[2:]]
    writes = (sub in GIT_WRITES
              or (sub == "branch" and any(f in rest for f in ("-D", "-d", "-f", "--delete", "--force", "-m", "-M"))))
    target = Path(cwd or SRC).resolve()
    main = SRC.resolve()
    if writes and (target == main or main in target.parents):
        # UNICA excecao (decisao do dono, 2026-10-03): dentro de `sync_main`, e so o que nao destroi
        # trabalho nao commitado: commit por pathspec, fast-forward, e `reset --keep` (que aborta
        # inteiro se um arquivo modificado difere entre HEAD e o alvo).
        if _MAIN_SYNC and target == main and (
                sub in ("add", "commit") or (sub == "merge" and rest[:1] == ["--ff-only"])
                or (sub == "reset" and rest[:1] == ["--keep"])):
            return
        die(f"TRAVA: `git {sub}` na arvore principal {main} e proibido ao pipeline.", 13)
    # `worktree remove/move` roda A PARTIR de qualquer arvore; o que importa e o ALVO.
    if sub == "worktree" and rest[:1] in (["remove"], ["move"]):
        alvos = [Path(x).resolve() for x in rest[1:] if not x.startswith("-")]
        if not alvos or any(t == main or main in t.parents or t in main.parents
                            or WTS.resolve() not in t.parents for t in alvos):
            die(f"TRAVA: `git worktree {rest[0]}` so em worktree de {WTS}; nunca na principal {main}.", 13)


def clean_env() -> dict:
    """O helper roda DENTRO de uma sessao (Bash/PowerShell dela) e herda CLAUDECODE,
    CLAUDE_CODE_SESSION_ID, CLAUDE_CODE_CHILD_SESSION, CLAUDE_EFFORT, o socket de mensagens...
    A sessao nova nao pode nascer achando que e a sessao que a chamou."""
    return {k: v for k, v in os.environ.items() if not k.upper().startswith("CLAUDE")}


def run(cmd, cwd=None, check=True, timeout=None, token=None) -> subprocess.CompletedProcess:
    """`token`: so o `validate_account` passa. Vai como CLAUDE_CODE_OAUTH_TOKEN DEPOIS do clean_env
    (que apaga toda CLAUDE*); toda outra sessao usa a conta do arquivo de credenciais. A saida volta
    MASCARADA antes do die/return, para todo chamador (inclusive check=False): um token que o CLI
    imprima nao chega ao ledger, ao log nem ao terminal (rodizio de contas, R5)."""
    refuse_main_tree(cmd, cwd)
    env = clean_env() if cmd and Path(str(cmd[0])).stem.lower() == "claude" else None
    if token:
        env = {**clean_env(), "CLAUDE_CODE_OAUTH_TOKEN": token}
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=timeout, env=env)
    p.stdout, p.stderr = mask(p.stdout), mask(p.stderr)
    if check and p.returncode != 0:
        die(f"falhou ({p.returncode}): {' '.join(map(str, cmd))}\n{p.stdout}\n{p.stderr}")
    return p


def git_dir() -> Path | None:
    """O `.git` da arvore principal, pelo git (numa worktree, como o ARMSX2-forkv2, `SRC/.git` e ARQUIVO e o
    estado do rebase mora em <comum>/worktrees/<nome>). None se o git nao reconhece mais SRC como raiz."""
    p = run(["git", "rev-parse", "--show-toplevel", "--git-dir"], cwd=SRC, check=False)
    lines = p.stdout.strip().splitlines()
    if p.returncode or len(lines) != 2 or Path(lines[0]).resolve() != Path(SRC).resolve():
        return None
    gd = Path(lines[1])
    return gd if gd.is_absolute() else (Path(SRC) / gd).resolve()


def git(*args, cwd=None, check=True) -> str:
    tries = 3 if args and args[0] == "fetch" else 1   # fetch concorrente entre worktrees: "cannot lock ref"
    for i in range(tries):
        p = run(["git", *args], cwd=cwd or SRC, check=check and i == tries - 1)
        if p.returncode == 0 or i == tries - 1:
            return p.stdout.strip()
        time.sleep(2)
    return ""


def porcelain_paths(path: Path, untracked: bool = True) -> list[str]:
    """Arquivos alterados da worktree. Saida CRUA com -z: o git() faz strip() e comeria o espaco
    inicial de ' M arquivo', cortando a 1a letra do 1o caminho (bug real achado na revisao)."""
    out = run(["git", "status", "--porcelain=v1", "-z", f"--untracked-files={'all' if untracked else 'no'}"],
              cwd=path).stdout
    entries, paths, i = out.split("\0"), [], 0
    while i < len(entries):
        e = entries[i]
        if len(e) > 3:
            paths.append(e[3:])
            if e[0] in "RC":                      # rename/copy: o caminho de origem vem na entrada seguinte
                i += 1
        i += 1
    return paths


def dirty_split(path: Path) -> tuple[list[str], list[str]]:
    """(mudancas de verdade, gerados do CMake) na worktree."""
    real, gen = [], []
    for f in porcelain_paths(path):
        (gen if GENERATED.search(f.replace("\\", "/")) else real).append(f)
    return real, gen


def skill_rel() -> str:
    """Pasta da skill relativa ao repo (`skills/...` aqui, `.claude/skills/...` nas copias). Fora do repo
    (os testes trocam o SRC por um repo temporario): o caminho que ela tem na fonte."""
    return SKILL.relative_to(SRC).as_posix() if SRC in SKILL.parents else f"skills/{SKILL.name}"


def discard_generated(path: Path, what: str):
    """Descarta SO os gerados do CMake. Mudanca de verdade nao commitada -> recusa (saida 2):
    `git checkout -- .` aqui ja apagaria edicao de dev retomado."""
    real, gen = dirty_split(path)
    if real:
        die(f"{what}: ha mudanca NAO commitada na worktree (nada foi descartado):\n  " +
            "\n  ".join(real[:20]) + "\nCommite (ou desfaca voce mesmo) e repita.", 2)
    tracked_gen = [f for f in gen if f in porcelain_paths(path, untracked=False)]
    if tracked_gen:
        git("checkout", "--", *tracked_gen, cwd=path, check=False)


class PreserveFailed(Exception):
    pass


def preserve_leftovers(path: Path, label: str) -> bool:
    """Fim de bug / inicio de onda: sobra nao commitada vira stash (refs compartilhadas entre
    worktrees), nunca e apagada. True se guardou algo. Se o stash NAO se confirmar (revisao,
    achado 1: `refs/stash.lock` de outro processo), levanta PreserveFailed ANTES de qualquer
    reset/checkout: quem chama nao pode limpar a worktree."""
    real, gen = dirty_split(path)
    if real:
        n0 = len(git("stash", "list", cwd=path).splitlines())
        p = run(["git", "stash", "push", "--include-untracked", "-m", f"pipeline-sobra {label}", "--", *real],
                cwd=path, check=False)
        n1 = len(git("stash", "list", cwd=path).splitlines())
        still = [f for f in dirty_split(path)[0] if f in real]
        if p.returncode != 0 or n1 != n0 + 1 or still:
            raise PreserveFailed(f"stash da sobra de {label} NAO confirmado (saida {p.returncode}, stashes "
                                 f"{n0}->{n1}, ainda sujo: {still[:5]}): {(p.stderr or p.stdout).strip()[:200]}")
        print(f"AVISO: sobra nao commitada guardada em `git stash list` ('pipeline-sobra {label}'): {real[:10]}")
    tracked_gen = [f for f in gen if f in porcelain_paths(path, untracked=False)]
    if tracked_gen:
        git("checkout", "--", *tracked_gen, cwd=path, check=False)
    return bool(real)


def norm(path: str) -> str:
    """Caminho relativo ao repo (SRC), com '/'. O planning pode escrever 'source/...' (a partir de ROOT) ou com '\\'."""
    p = path.strip().strip("`").replace("\\", "/")
    return p[len(SRC_PREFIX):] if SRC_PREFIX and p.startswith(SRC_PREFIX) else p


def fk(path: str) -> str:
    """Chave de comparacao de arquivo: NTFS nao diferencia maiusculas."""
    return norm(path).lower()


# --------------------------------------------------------------------------- itens: bug ou task (DESIGN 22.9)
# O item do ledger (`st["bugs"][slug]`) e um bug (padrao; ledger antigo sem `tipo`) ou uma task do projeto
# (`tarefas` no projeto.json). O doc de bug muda de PASTA com o estado (open -> retest -> done); a task nao:
# o estado dela e um CAMPO no cabecalho. Bug cujo fix exige task carrega a task no plano (`plan.task`).

def stage_path(doc: str, stage: str) -> str:
    """Caminho do doc de bug na pasta `stage` do ciclo. Com `retest_sem_subpasta`, a subpasta de open/ cai.
    Doc fora de /open/ (task) nao tem ciclo de pasta: volta o proprio caminho."""
    if stage == "open" or "/open/" not in doc:
        return doc
    head, rest = doc.split("/open/", 1)
    return f"{head}/{stage}/{rest.rsplit('/', 1)[-1] if RETEST_FLAT else rest}"


def retest_path(doc: str) -> str | None:
    """Onde o doc fica quando o item passa. None = nao muda de pasta (task)."""
    return stage_path(doc, "retest") if "/open/" in doc else None


def task_field(text: str, name: str) -> str | None:
    """'- **Nome:** valor', como o validador do projeto le (`field` do check_traceability do ARMSX2)."""
    m = re.search(r"^-\s+\*\*%s:\*\*[ \t]*(.*?)[ \t]*\r?$" % re.escape(name), text, re.M)
    return m.group(1) if m else None


def set_task_field(text: str, name: str, value: str) -> str:
    return re.sub(r"^(-\s+\*\*%s:\*\*)[^\r\n]*" % re.escape(name), lambda m: f"{m.group(1)} {value}", text,
                  count=1, flags=re.M)


def task_status(text: str) -> str:
    return task_field(text, TAREFAS["campo_status"]) or ""


def item_kind(b: dict) -> str:
    return b.get("tipo", "bug")


def task_of(b: dict) -> str | None:
    """A task do item: o proprio doc (item task) ou a do plano (bug cujo fix exige task)."""
    if item_kind(b) == "task":
        return b["doc"]
    return (b.get("plan") or {}).get("task")


def task_number(path: str) -> int | None:
    m = TASK_RE.match(Path(path).name) if TAREFAS else None
    return int(m.group(1)) if m else None


def task_id(path: str) -> str | None:
    n = task_number(path)
    return None if n is None else TAREFAS["id"].format(n=n)


def task_commits(path: Path, tid: str, rng: str) -> list[str]:
    """Assuntos `<id>: ...` em `rng`: o vinculo task -> commit e o prefixo do assunto."""
    return [s for s in git("log", "--format=%s", rng, cwd=path, check=False).splitlines() if s.startswith(tid + ":")]


@contextlib.contextmanager
def file_lock(name: str, timeout: float = 1200):
    """Lock entre processos por msvcrt.locking. O SO solta o lock se o processo morrer.
    Timeout longo: abrir uma onda faz ate 4 spawns (~1 min cada esperando o registro) com o lock."""
    PIPE.mkdir(parents=True, exist_ok=True)
    f = open(PIPE / f"{name}.lock", "a+b")
    deadline = time.time() + timeout
    while True:
        try:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            break
        except OSError:
            if time.time() > deadline:
                f.close()
                die(f"timeout esperando o lock '{name}'")
            time.sleep(0.5)
    try:
        yield
    finally:
        unlock(f)


def unlock(f):
    f.seek(0)
    msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
    f.close()


def try_lock(name: str):
    """Variante NAO bloqueante de file_lock: devolve o handle travado (soltar com `unlock`) ou None,
    sem esperar e sem die. O lock do msvcrt e por handle: outro try_lock do mesmo nome, mesmo neste
    processo, devolve None. Instancia unica do vigia de cota (rodizio de contas, secao 6.5)."""
    PIPE.mkdir(parents=True, exist_ok=True)
    f = open(PIPE / f"{name}.lock", "a+b")
    try:
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        return f
    except OSError:
        f.close()
        return None


def replace_retry(src: Path, dst: Path, tries: int = 5, pause: float = 0.2):
    """os.replace repetido em PermissionError. No Windows, quem abre o destino para LER sem lock (um
    `status`, o CLI relendo o arquivo de credenciais) nao compartilha DELETE, e o replace de quem
    grava falha nesse instante. Comportamento conhecido do Windows, nao medido aqui (rodizio, N3)."""
    for i in range(tries):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if i == tries - 1:
                raise
            time.sleep(pause)


def load() -> dict:
    if not STATE.exists():
        die("sem execucao ativa (.bugfix-pipeline/state.json nao existe). Rode `init` primeiro.")
    return json.loads(STATE.read_text(encoding="utf-8"))


def save(st: dict):
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=2, ensure_ascii=False), encoding="utf-8")
    replace_retry(tmp, STATE)


def bug_of(st: dict, slug: str) -> dict:
    if slug not in st["bugs"]:
        die(f"bug desconhecido no ledger: {slug}")
    return st["bugs"][slug]


def move(st: dict, slug: str, to: str, note: str = ""):
    b = bug_of(st, slug)
    b["history"].append({"ts": now(), "from": b["state"], "to": to, "note": note})
    b["state"] = to


def wt_path(st: dict, slug: str) -> Path:
    b = bug_of(st, slug)
    if not b.get("wt"):
        die(f"{slug} nao tem worktree (estado {b['state']})")
    return Path(st["worktrees"][b["wt"]]["path"])


def planning_wt(st: dict) -> Path:
    return Path(st["worktrees"]["wt-planning"]["path"])


# --------------------------------------------------------------------------- claude CLI

def claude_exe() -> str:
    hits = glob.glob(os.path.expandvars(
        r"%USERPROFILE%\.vscode\extensions\anthropic.claude-code-*-win32-x64\resources\native-binary\claude.exe"))
    for extra in (r"%USERPROFILE%\.local\bin\claude.exe", r"%APPDATA%\npm\claude.cmd"):
        p = os.path.expandvars(extra)
        if os.path.exists(p):
            hits.append(p)
    if not hits:
        die("claude.exe nao encontrado (nem no PATH, nem na extensao do VS Code)")
    return max(hits, key=os.path.getmtime)


def agents() -> list[dict]:
    p = run([claude_exe(), "agents", "--json", "--all"], cwd=ROOT, check=False)
    try:
        return json.loads(p.stdout or "[]")
    except json.JSONDecodeError:
        return []


class Busy(Exception):
    pass


# Status de `claude agents --json` em que a sessao comprovadamente NAO esta trabalhando nem esperando
# alguem. Vistos em 2026-10-02: so `idle` e `busy`. Qualquer outro (ex.: esperando permissao) e tratado
# como "precisa do dono": nunca damos `stop` nele, que descartaria o pedido pendente.
RESUMABLE = {"idle", "done", "exited", "stopped", "completed", "finished"}


def job_id(session_id: str, live: list[dict] | None = None) -> str:
    """`claude stop` so casa pelo id CURTO do job (`id` no `claude agents --json`); com o sessionId
    inteiro responde "No job matching" e nao para nada (DESIGN secao 16)."""
    for x in agents() if live is None else live:
        if x.get("sessionId") == session_id and x.get("id"):
            return x["id"]
    return session_id[:8]


def resume_cmd(exe: str, session_id: str, prompt: str) -> list[str]:
    """`--bg --resume` so continua a MESMA sessao (mesmo id, o que o gerenciador deve mostrar) com ela
    PARADA e SEM flag nenhuma: a sessao acorda com as opcoes com que nasceu (-n, --add-dir,
    --allowedTools, --disallowedTools, --permission-mode, --effort, --model). Qualquer flag, mesmo igual
    a salva, ou sessao ainda viva -> o CLI abre uma COPIA com outro id (medido em 2026-10-03, CLI
    2.1.288; bug pipeline-resume-com-flags-abre-copia-e-ledger-perde-a-sessao_2026-10-02).
    Status None = ja parada/concluida: resume direto (`claude stop --help`: "resume it later")."""
    live = [x for x in agents() if x.get("sessionId") == session_id]
    st_ = live[0].get("status") if live else None
    if st_ is not None and st_ not in RESUMABLE:
        raise Busy(f"{session_id} status={st_}")
    if st_ is not None:
        run([exe, "stop", job_id(session_id, live)], cwd=ROOT, check=False)
        for _ in range(15):                      # viva ainda = copia, e a copia nasce SEM as flags
            if not any(x.get("sessionId") == session_id and x.get("status") is not None for x in agents()):
                break
            time.sleep(2)
        else:
            raise Busy(f"{session_id} nao parou com `claude stop`")
    return [exe, "--bg", "--resume", session_id, prompt]


def stop_sessions(b: dict, except_stage: str | None = None):
    """Fim do bug: encerra planning/dev/teste. `stop` mantem a conversa no gerenciador.
    NUNCA a sessao que esta chamando o helper (`except_stage`): parar o chamador mata este
    processo antes do save. Ela termina o proprio turno, e o `tick` a encerra depois."""
    exe, live = claude_exe(), agents()
    for stage, rec in b["sessions"].items():
        if stage == except_stage or not rec or not rec.get("id") or rec.get("stopped"):
            continue
        run([exe, "stop", job_id(rec["id"], live)], cwd=ROOT, check=False)
        rec["stopped"] = now()


def bg_id(out: str) -> str | None:
    """Id curto que o `claude --bg` imprime ("backgrounded · <id> · nome"). Com `--resume` + flags ele e
    de uma COPIA, com sessionId novo e as vezes nome novo (titulo gerado), mesmo com a sessao parada
    (medido em 2026-10-02, CLI 2.1.288): so por este id se acha a copia."""
    m = re.search(r"backgrounded\W+([0-9a-f]{8})\b", re.sub(r"\x1b\[[0-9;]*m", "", out or ""))
    return m.group(1) if m else None


def stop_live(name: str, ids) -> list[str]:
    """Para toda sessao VIVA (`status` presente) com este nome ou com um destes ids curtos (`bg_id`).
    Sessao viva com cwd numa lane trava a pasta no Windows (bug
    pipeline-daemon-claude-bg-orfao-trava-pasta-da-lane_2026-10-02). Devolve os ids parados."""
    exe, live, ids = claude_exe(), agents(), {i for i in ids if i}
    hit = [job_id(x["sessionId"], live) for x in live if x.get("status") is not None and x.get("sessionId")
           and (x.get("name") == name or x["sessionId"][:8] in ids)]
    for i in hit:
        run([exe, "stop", i], cwd=ROOT, check=False)
    return hit


# --------------------------------------------------------------------------- cota (rodizio de contas)
# Deteccao pelo transcript: docs/backlog/rodizio-automatico-de-contas-no-pipeline.md, secao 6.3 e F1.

CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"   # <pasta do cwd>/<sessionId>.jsonl
TAIL_BYTES = 64 * 1024
SYNTHETIC = "<synthetic>"                         # modelo das mensagens que o CLI escreve sozinho (limite, erro)
LIMIT_TEXT = re.compile(r"You['’]ve hit your (\w+ )?limit")
AUTH_TEXT = re.compile(r"Please run /login|Failed to authenticate|API Error: 401\b")


def transcript_ts(e: dict) -> float:
    try:
        return dt.datetime.fromisoformat(str(e["timestamp"]).replace("Z", "+00:00")).timestamp()
    except (KeyError, ValueError):
        return 0.0


def transcript_tail(session_id: str | None, enough) -> list[dict]:
    """Entradas `user`/`assistant` do FIM do transcript, da ultima para tras. So esses dois tipos
    decidem: o CLI intercala muitos outros (system, attachment, cost-state, mode, atis-latch...) e
    inventa tipo novo; lista de ignorados ficaria velha. Le os ultimos TAIL_BYTES e cresce a janela
    (x4) ate `enough(entradas)` ou o comeco do arquivo: um `attachment` sozinho passa de 190 KB
    (medido no 112b10ea). A 1a linha da janela e parcial e a ultima pode estar sendo escrita: as que
    nao sao JSON caem fora. Sem transcript ou erro de leitura: []."""
    if not session_id:
        return []
    hits = glob.glob(str(CLAUDE_PROJECTS / "*" / (glob.escape(session_id) + ".jsonl")))
    if not hits:
        return []
    path = max(hits, key=os.path.getmtime)
    try:
        with open(path, "rb") as f:
            size, n = os.fstat(f.fileno()).st_size, TAIL_BYTES
            while True:
                start = max(0, size - n)
                f.seek(start)
                lines = f.read(size - start).split(b"\n")[1 if start else 0:]
                out = []
                for line in reversed(lines):
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(e, dict) and e.get("type") in ("user", "assistant"):
                        out.append(e)
                if start == 0 or enough(out):
                    return out
                n *= 4
    except OSError:
        return []


def entry_text(e: dict) -> str:
    c = (e.get("message") or {}).get("content")
    if isinstance(c, list):
        return " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return c if isinstance(c, str) else ""


def quota_state(session_id: str | None) -> dict:
    """A sessao parou por limite de cota? A ULTIMA entrada user/assistant decide: depois de uma
    retomada ha `user` novo, e o hit antigo deixa de valer. Forma medida (fato 1 e B3): `assistant`,
    model <synthetic>, `quotaLimits.status == "rejected"`, `resetsAt` em epoch s, `rateLimitType`
    five_hour/seven_day. Reserva para mudanca de formato do CLI: <synthetic> sem quotaLimits mas com
    o texto "You've hit your ... limit" -> limit com reset estimado em ts + 5 h (`estimated`).
    Token invalido (C1 da F0-ter, sessao --bg): <synthetic> com `error == "authentication_failed"` e
    `apiErrorStatus == 401`; reserva pelo texto ("Please run /login", "Failed to authenticate").
    Devolve {"kind": None}, {"kind": "limit", "resets_at", "type", "ts"} ou {"kind": "auth", "ts", "text"}."""
    tail = transcript_tail(session_id, bool)
    if not tail or tail[0].get("type") != "assistant":
        return {"kind": None}
    e, ts = tail[0], transcript_ts(tail[0])
    q = e.get("quotaLimits")
    if isinstance(q, dict) and q.get("status") == "rejected" and isinstance(q.get("resetsAt"), (int, float)):
        return {"kind": "limit", "resets_at": int(q["resetsAt"]), "type": q.get("rateLimitType"), "ts": ts}
    if (e.get("message") or {}).get("model") != SYNTHETIC:
        return {"kind": None}
    text = entry_text(e)
    if LIMIT_TEXT.search(text):
        return {"kind": "limit", "resets_at": int(ts) + 5 * 3600, "type": None, "ts": ts, "estimated": True}
    if (e.get("error") == "authentication_failed" or e.get("apiErrorStatus") == 401
            or (e.get("isApiErrorMessage") and AUTH_TEXT.search(text))):
        return {"kind": "auth", "ts": ts, "text": text[:200]}
    return {"kind": None}


def answered_since(session_id: str | None, ts: float) -> bool:
    """A conta RESPONDEU depois de `ts`: ha `assistant` de modelo real (nao <synthetic>) com timestamp
    maior. Prova de que uma entrega passou (R8). A ausencia de hit NAO prova isso: a sessao pode nem
    ter sido entregue."""
    def real(e):
        return e.get("type") == "assistant" and (e.get("message") or {}).get("model") not in (None, SYNTHETIC)
    tail = transcript_tail(session_id, lambda es: any(transcript_ts(e) <= ts or real(e) for e in es))
    return any(real(e) and transcript_ts(e) > ts for e in tail)


# Guarda das contas: docs/backlog/rodizio-automatico-de-contas-no-pipeline.md, secoes 6.2 e 6.3, F2.
# O arquivo de credenciais do CLI so e gravado mais abaixo (apply_account/restore_login, F3).

ACCOUNTS_DIR = Path.home() / ".claude-accounts"   # fora do repo, de .bugfix-pipeline e de ~/.claude
LABEL = re.compile(r"[A-Za-z0-9_-]{1,32}")       # vira nome de arquivo (<label>.token)
TOKEN_RE = re.compile(r"sk-ant-[A-Za-z0-9_\-]+")  # questao 9: 108 caracteres, so [A-Za-z0-9_-]; cobre o par do /login
VALIDATE_MODEL = "claude-haiku-4-5-20251001"
_SECRETS: set[str] = set()                        # todo token decifrado neste processo, inclusive os trocados (R14)
_TOKENS: dict[str, tuple[float, str]] = {}        # label -> (mtime do .token, token)


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data: bytes, protect: bool) -> bytes:
    """DPAPI no escopo do usuario Windows: so o mesmo usuario, na mesma maquina, decifra. Sem
    dependencia nova. Falha -> OSError, sem o dado na mensagem."""
    buf = ctypes.create_string_buffer(data, len(data))
    src, out = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), _Blob()
    crypt32 = ctypes.windll.crypt32
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    if not fn(ctypes.byref(src), None, None, None, None, 0x1, ctypes.byref(out)):   # 0x1: CRYPTPROTECT_UI_FORBIDDEN
        raise OSError(f"DPAPI falhou (erro {ctypes.GetLastError()})")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.cast(out.pbData, ctypes.c_void_p))


def dpapi_protect(data: bytes) -> bytes:
    return _dpapi(data, True)


def dpapi_unprotect(data: bytes) -> bytes:
    return _dpapi(data, False)


def accounts_default() -> dict:
    return {"order": [], "active": None, "switched_at": None, "paused": False, "applied": False,
            "wake_at": None, "switch_error": None, "login_saved_at": None, "login_restored_at": None,
            "file_repairs": 0, "last_repair": None, "armed": None, "accounts": {}}


def accounts_load() -> dict:
    """`accounts.json` (sem segredo). Le sem lock; quem GRAVA chama isto DENTRO de
    file_lock("accounts") e grava com accounts_save (N3). Sem arquivo: nenhuma conta."""
    path = ACCOUNTS_DIR / "accounts.json"
    acc = accounts_default()
    if path.exists():
        try:
            acc.update(json.loads(path.read_text(encoding="utf-8")))
        except ValueError as e:
            die(f"{path} invalido ({e}); conserte-o ou apague-o e cadastre as contas de novo")
    return acc


def accounts_save(acc: dict):
    ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)
    path = ACCOUNTS_DIR / "accounts.json"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(acc, indent=2, ensure_ascii=False), encoding="utf-8")
    replace_retry(tmp, path)


def rotation_on(acc: dict) -> bool:
    """A UNICA definicao de "rodizio ligado" (R18): o projeto usa rodizio (`rodizio_contas`), >= 2 contas
    cadastradas e sem `accounts restore`."""
    return RODIZIO and len(acc.get("order") or []) >= 2 and not acc.get("paused")


def rotation_owner() -> bool:
    """A guarda de contas e o arquivo de credenciais sao da MAQUINA. Projeto sem `rodizio_contas` nunca
    escreve neles: o `restore_login` daqui devolveria o /login no meio da execucao de OUTRO projeto, que
    gira as contas (DESIGN secao 22.6)."""
    return RODIZIO


def armed_idle(acc: dict, cur: dict | None) -> float | None:
    """Instante do `accounts activate` que pos a conta no arquivo para uma execucao que ainda nao comecou,
    ou None. A marca `armed` ({at, run_id do state.json da hora, ou None}) e gravada so pelo activate sem
    execucao aberta e apagada por quem passa a usar a conta (`init`, `spawn`, vigia) e pelo restore. Sem
    ela, "conta no arquivo sem execucao e sem vigia" nao diz se o vigia morreu ou se o dono armou o
    rodizio [[pipeline-preflight-alarme-falso-vigia-morto-apos-accounts-activate_2026-10-07]]."""
    m = acc.get("armed")
    if not acc.get("applied") or not rotation_on(acc) or not isinstance(m, dict):   # pausado: nao ha vigia a subir
        return None
    return m.get("at") if m.get("run_id") == (cur or {}).get("run_id") else None


def idle_cred_warning(acc: dict, cur: dict | None) -> str:
    """O aviso de "conta do rodizio no arquivo, sem execucao aberta e sem vigia" (preflight e reconcile)."""
    who, at = acc.get("active") or "?", armed_idle(acc, cur)
    if at:
        return (f"o arquivo de credenciais esta na conta {who} desde o `accounts activate` de {when(at)}, e "
                "nenhuma execucao comecou depois: se vai iniciar uma (`init` + `start`), siga, o vigia sobe no "
                "`start`; se nao vai, `accounts restore` num PowerShell comum devolve o /login")
    return (f"o arquivo de credenciais tem uma conta do rodizio ({who}) sem execucao ativa e sem vigia: se o "
            "vigia morreu sem devolver o /login, rode `accounts restore` num PowerShell comum; se foi um "
            "`accounts activate` seu para iniciar uma execucao, siga (`init` + `start`)")


def token_path(label: str) -> Path:
    return ACCOUNTS_DIR / f"{label}.token"


def token_write(label: str, token: str) -> float:
    """Grava o token cifrado e devolve a versao nova: o mtime do .token (R14). A versao SEMPRE sobe:
    duas gravacoes no mesmo tick do relogio do NTFS teriam o mesmo mtime, e o cache do token_of
    devolveria o token velho."""
    ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)
    path = token_path(label)
    prev = path.stat().st_mtime if path.exists() else 0.0
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(dpapi_protect(token.encode("utf-8")))
    replace_retry(tmp, path)
    _SECRETS.add(token)
    if path.stat().st_mtime <= prev:
        os.utime(path, (prev + 0.001, prev + 0.001))
    return path.stat().st_mtime


def token_of(label: str) -> tuple[str, float]:
    """(token, versao) da conta, versao = mtime do .token. Cache por (label, mtime): relido quando
    outro processo troca o token (`accounts add`), sem reiniciar um vigia de horas (R14). Todo token
    decifrado entra no `mask`. Falha -> die SEM o segredo."""
    path = token_path(label)
    try:
        ver = path.stat().st_mtime
    except OSError:
        die(f"conta {label}: sem {path} (cadastre com `accounts add --label {label}`)")
    hit = _TOKENS.get(label)
    if hit and hit[0] == ver:
        return hit[1], ver
    try:
        token = dpapi_unprotect(path.read_bytes()).decode("utf-8")
    except (OSError, UnicodeDecodeError):
        die(f"conta {label}: nao consegui decifrar {path} (a DPAPI e por usuario e maquina; cadastre de novo)")
    _SECRETS.add(token)
    _TOKENS[label] = (ver, token)
    return token, ver


def mask(text):
    """Troca por *** todo token ja decifrado neste processo (inclusive os trocados, R14) e qualquer
    trecho com a forma sk-ant-... (questao 9). None passa direto."""
    if not text:
        return text
    for s in sorted(_SECRETS, key=len, reverse=True):
        text = text.replace(s, "***")
    return TOKEN_RE.sub("***", text)


def probe(token: str | None) -> tuple[str, str]:
    """`claude -p` barato no Haiku, com cwd fora do projeto (o -p nao carrega CLAUDE.md nem memoria).
    Com `token`, a conta e a do env; sem, a do arquivo de credenciais. Devolve (resultado, texto
    mascarado e cortado em 200): ok | limit | auth | transitorio. O texto do 401 muda com a origem
    do token (env: "Invalid bearer token"; arquivo: "OAuth access token is invalid", C1.1):
    AUTH_TEXT cobre os dois."""
    try:
        p = run([claude_exe(), "-p", "responda ok", "--model", VALIDATE_MODEL], cwd=tempfile.gettempdir(),
                check=False, timeout=120, token=token)
    except subprocess.TimeoutExpired:
        return "transitorio", "sem resposta em 120 s"
    text = " ".join(x.strip() for x in (p.stdout, p.stderr) if x and x.strip())
    if LIMIT_TEXT.search(text):
        res = "limit"
    elif AUTH_TEXT.search(text):
        res = "auth"
    elif p.returncode == 0 and text:
        res = "ok"
    else:
        res = "transitorio"
    return res, text[:200]


def validate_account(label: str) -> tuple[str, float, str]:
    """A conta responde? `probe` com o token no ENV: no -p o env vence o /login (questao 2), entao
    valida QUALQUER conta sem trocar a ativa e sem tocar o arquivo de credenciais (S56). E o UNICO
    claude que recebe token. ~5 s (questao 8); roda fora de lock. Devolve (resultado, versao testada,
    texto mascarado). Quem grava o resultado so o aplica se a token_version da conta ainda e a
    testada (R14)."""
    token, ver = token_of(label)
    res, text = probe(token)
    return res, ver, text


# Arquivo de credenciais do CLI (D7): secao 6.7 e F3. So o bloco `claudeAiOauth` e trocado; o
# `mcpOAuth` e qualquer outra chave de topo ficam como estao (B1). Quem grava segura `state` e depois
# `accounts` (R11). Contra o CLI, que nao respeita esses locks: releitura antes do os.replace e
# conferencia depois. Nada aqui loga ou devolve valor do arquivo: so motivos.

CRED_FILE = Path.home() / ".claude" / ".credentials.json"
OAUTH = "claudeAiOauth"
V1_DAYS = 300                                     # expiresAt do bloco v1: so o que o CLI usa para decidir renovar (B5)


class CredError(Exception):
    """Falha de leitura/gravacao/conferencia do arquivo de credenciais. A mensagem e so o motivo."""


def login_bak() -> Path:
    return ACCOUNTS_DIR / "login.bak"


def cred_stat() -> tuple[int | None, int]:
    try:
        s = CRED_FILE.stat()
        return s.st_mtime_ns, s.st_size
    except FileNotFoundError:
        return None, 0


def cred_read() -> tuple[dict, tuple[int | None, int]]:
    """(dados, (mtime_ns, tamanho)). Ausente: ({}, (None, 0)). JSON invalido: rele uma vez depois de
    1 s (gravacao do CLI no meio); continua invalido -> CredError, e ninguem grava sobre ele
    (perderia o mcpOAuth)."""
    for i in range(2):
        seen = cred_stat()
        if seen[0] is None:
            return {}, seen
        try:
            data = json.loads(CRED_FILE.read_bytes().decode("utf-8-sig"))
            if isinstance(data, dict):
                return data, seen
        except (ValueError, UnicodeDecodeError):
            pass
        except OSError as e:
            raise CredError(f"arquivo de credenciais ilegivel ({type(e).__name__})")
        if i == 0:
            time.sleep(1)
    raise CredError("arquivo de credenciais ilegivel (JSON invalido duas vezes)")


def cred_token(data: dict) -> str | None:
    blk = data.get(OAUTH)
    return blk.get("accessToken") if isinstance(blk, dict) else None


def cred_write(data: dict, seen: tuple, block: dict) -> str:
    """Grava `data` com SO o claudeAiOauth trocado por `block` (secao 6.7, item 1, passos 3-5).
    Devolve "ok", ou "mudou" se o arquivo mudou desde a leitura (quem chama recomeca da leitura).
    Falha de gravacao ou de conferencia -> CredError. O temporario sai no finally."""
    if os.environ.get("CLAUDE_CONFIG_DIR"):
        raise CredError("CLAUDE_CONFIG_DIR definido: o CLI le outro arquivo de credenciais (S58)")
    new = {**data, OAUTH: block}
    tmp = CRED_FILE.with_name(f"{CRED_FILE.name}.rodizio-{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(new, indent=2, ensure_ascii=False), encoding="utf-8")
        if cred_stat() != seen:
            return "mudou"
        try:
            replace_retry(tmp, CRED_FILE)
        except PermissionError:
            raise CredError("gravacao do arquivo de credenciais: PermissionError em 5 tentativas")
        got, _ = cred_read()
        rest = lambda d: {k: v for k, v in d.items() if k != OAUTH}
        if cred_token(got) != block.get("accessToken") or rest(got) != rest(data):
            raise CredError("conferencia do arquivo de credenciais falhou depois de gravar")
        return "ok"
    finally:
        tmp.unlink(missing_ok=True)


def known_tokens(acc: dict) -> set[str]:
    """Tokens das contas cadastradas, inclusive os antigos de uma conta trocada (`_SECRETS`): um bloco
    com eles NAO e "de fora" e nunca vai para o login.bak."""
    for label in acc.get("order") or []:
        if token_path(label).exists():
            token_of(label)
    return set(_SECRETS)


def apply_account(acc: dict, label: str, ts: float) -> tuple[str | None, str]:
    """A TROCA (secao 6.7, item 1). Exige `state` e `accounts` presos por quem chama, que grava o
    `acc`. Devolve (erro ou None, classe do bloco que estava: "ja estava", "outra conta cadastrada",
    "bloco de fora" ou "sem bloco"). Bloco de fora (o /login) vai para o login.bak ANTES de ser
    sobrescrito. NAO mexe em `active`: quem chama decide."""
    cls = "sem bloco"
    try:
        if os.environ.get("CLAUDE_CONFIG_DIR"):
            raise CredError("CLAUDE_CONFIG_DIR definido: o CLI le outro arquivo de credenciais (S58)")
        if not token_path(label).exists():
            raise CredError(f"conta {label} sem .token")
        try:
            mine, known = token_of(label)[0], known_tokens(acc)
        except SystemExit:
            raise CredError(f"conta {label}: .token nao decifra")
        for _ in range(3):
            data, seen = cred_read()
            cur, blk = cred_token(data), data.get(OAUTH)
            if cur == mine:
                acc["switch_error"] = None
                return None, "ja estava"
            if cur in known:
                cls = "outra conta cadastrada"
            elif cur:
                cls = "bloco de fora"
                tmp = login_bak().with_name("login.bak.tmp")
                ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)
                tmp.write_bytes(dpapi_protect(json.dumps(blk).encode("utf-8")))
                replace_retry(tmp, login_bak())
                acc["login_saved_at"] = ts
            old = blk if isinstance(blk, dict) else {}
            block = {"accessToken": mine, "expiresAt": int((ts + V1_DAYS * 86400) * 1000),
                     "scopes": ["user:inference"], "subscriptionType": old.get("subscriptionType") or "pro",
                     "rateLimitTier": old.get("rateLimitTier") or "default_claude_ai"}
            try:
                res = cred_write(data, seen, block)
            except CredError:
                if cred_token(cred_read()[0]) == mine:   # o os.replace aconteceu: o restore tem o que devolver
                    acc["applied"] = True
                raise
            if res == "ok":
                acc["applied"], acc["switch_error"] = True, None
                return None, cls
        raise CredError("arquivo de credenciais mudando sem parar (3 releituras)")
    except (CredError, OSError) as e:
        acc["switch_error"] = mask(str(e))
        return acc["switch_error"], cls


def ensure_active(acc: dict, ts: float):
    """Conferencia de integridade (B2): o arquivo tem a conta `active`? Exige `state` e `accounts`
    presos; quem chama grava o `acc`. Rodizio desligado (ou sem ativa): nada. Ativa INVALIDA: nada, porque
    o token dela quebraria tambem as sessoes do dono, e sem credencial o vigia devolveu o /login (6.5.1,
    item 8); com outra valida, o passo 4 gira. Devolve "ok", "regravado" ou ("erro", motivo). Com
    `applied` ja ligado, regravar e um REPARO (file_repairs)."""
    label = acc.get("active")
    if not rotation_on(acc) or not label or (acc["accounts"].get(label) or {}).get("invalid"):
        return "ok"
    was = acc.get("applied")
    err, cls = apply_account(acc, label, ts)
    if err:
        return "erro", err
    if cls == "ja estava":
        return "ok"
    if was:
        acc["file_repairs"] = (acc.get("file_repairs") or 0) + 1
        acc["last_repair"] = {"ts": ts, "motivo": cls}
        print(f"AVISO: arquivo de credenciais reparado para a conta {label} ({cls})")
    return "regravado"


def cred_matches(label: str) -> bool:
    """Leitura SEM lock: o accessToken do arquivo e o de `label`? Compara na memoria, sem logar."""
    try:
        return bool(label) and token_path(label).exists() and cred_token(cred_read()[0]) == token_of(label)[0]
    except (CredError, SystemExit):
        return False


def restore_login(acc: dict, ts: float, why: str) -> str:
    """Devolve a maquina ao /login (secao 6.7, item 4). Exige `state` e `accounts` presos; quem chama
    grava o `acc` e, DEPOIS de soltar os locks, roda `restore_sanity` se o resultado for "devolvido".
    Devolve "nada" (applied desligado), "ja no /login" (o arquivo ja tem um bloco de fora, mais novo
    que o login.bak, ou o proprio), "sem login.bak" (S57: nao grava), "devolvido" ou "erro: ...".
    Nunca sobrescreve um bloco de fora. Projeto sem rodizio: "nada" sempre (rotation_owner)."""
    if not acc.get("applied") or not rotation_owner():
        return "nada"
    if not login_bak().exists():
        print(f"AVISO ({why}): sem /login guardado: o arquivo continua com a conta "
              f"{acc.get('active') or '?'}; faca /login")
        return "sem login.bak"
    try:
        try:
            block = json.loads(dpapi_unprotect(login_bak().read_bytes()).decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            raise CredError("login.bak nao decifra")
        try:
            known = known_tokens(acc)
        except SystemExit:
            raise CredError("um .token das contas nao decifra")
        for _ in range(3):
            data, seen = cred_read()
            cur = cred_token(data)
            if (cur and cur not in known) or data.get(OAUTH) == block:
                acc["applied"], acc["login_restored_at"], acc["switch_error"], acc["armed"] = False, ts, None, None
                return "ja no /login"
            if cred_write(data, seen, block) == "ok":
                acc["applied"], acc["login_restored_at"], acc["switch_error"], acc["armed"] = False, ts, None, None
                print(f"/login devolvido ao arquivo de credenciais ({why})")
                return "devolvido"
        raise CredError("arquivo de credenciais mudando sem parar (3 releituras)")
    except (CredError, OSError) as e:
        acc["switch_error"] = mask(str(e))
        return f"erro: {acc['switch_error']}"


def restore_sanity() -> str:
    """Depois de devolver o /login, FORA dos locks: o arquivo responde? `probe` SEM token (pelo arquivo).
    ok/limit: o /login voltou. auth: o par guardado morreu (faca /login). O login.bak fica."""
    res, text = probe(None)
    if res == "auth":
        print(f"AVISO: o /login devolvido nao vale mais: faca /login ({text})")
    else:
        print(f"sanidade do /login devolvido: {res}")
    return res


# Atribuicao e giro: secao 6.4 e F4. So `attribute` escreve a SITUACAO de uma conta (exhausted_until,
# last_*, late_retries, invalid); `rotate` so escolhe a proxima e grava o arquivo (R9).

LATE_MAX = 3                                      # recusas DEPOIS do reset ate a espera extra (R8, S6)
LATE_WAIT = 30 * 60
HITS_MAX = 3                                      # hits incertos / auth nao confirmados SEGUIDOS de uma etapa (R21)
RESET_TEXT = re.compile(r"resets (?:([A-Za-z]{3})[a-z]* (\d{1,2}), )?(\d{1,2})(?::(\d{2}))?\s*([ap]m)", re.I)
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
LIMIT_KIND = {"session": "five_hour", "weekly": "seven_day"}


def limit_reset(text: str | None, ts: float) -> tuple[int, str | None] | None:
    """(resets_at, tipo) lidos do texto de limite que o `claude -p` devolve: `... session limit · resets
    11:10pm (America/Sao_Paulo)` ou `... weekly limit · resets Oct 7, 4am (...)`. A hora e lida como
    hora LOCAL: o Python do Windows nao tem a base de fusos, e o CLI escreve no fuso da maquina (os dois
    pares medidos batem). Sem data: hoje, ou amanha se a hora ja passou. Nao deu para ler: None."""
    m = RESET_TEXT.search(text or "")
    if not m:
        return None
    mon, day, hh, mm, ap = m.groups()
    base = dt.datetime.fromtimestamp(ts)
    try:
        at = base.replace(hour=int(hh) % 12 + (12 if ap.lower() == "pm" else 0), minute=int(mm or 0),
                          second=0, microsecond=0)
        if mon:
            at = at.replace(month=MONTHS.index(mon.lower()) + 1, day=int(day))
            if at < base - dt.timedelta(days=1):  # "Jan 2" lido em dezembro
                at = at.replace(year=at.year + 1)
        elif at <= base:
            at += dt.timedelta(days=1)
    except ValueError:
        return None
    kind = LIMIT_TEXT.search(text)
    return int(at.timestamp()), LIMIT_KIND.get((kind.group(1) or "").strip().lower()) if kind else None


def pick_account(acc: dict, ts: float) -> tuple[str | None, float | None]:
    """A PROXIMA conta disponivel (`invalid` nulo e `exhausted_until <= ts`) em `order`, circular a
    partir da ativa, que nunca e candidata. Devolve (conta, None). Nenhuma disponivel: (None, menor
    `exhausted_until` entre as validas, a ativa inclusive): a hora de acordar. Nenhuma valida:
    (None, None): sem credencial, nao ha reset a esperar."""
    order, active, accs = acc.get("order") or [], acc.get("active"), acc.get("accounts") or {}
    i = order.index(active) + 1 if active in order else 0
    for label in order[i:] + order[:i]:
        e = accs.get(label)
        if e and label != active and not e.get("invalid") and (e.get("exhausted_until") or 0) <= ts:
            return label, None
    valid = [e.get("exhausted_until") or 0 for e in map(accs.get, order) if e and not e.get("invalid")]
    return None, (min(valid) if valid else None)


def rotate(acc: dict, ts: float) -> str | None:
    """ESCOLHE a proxima e TROCA (R9). Exige `state` e `accounts` presos; quem chama grava o `acc`. So
    com o arquivo gravado e conferido: `active`, `switched_at` e `wake_at = None`. Devolve a conta.
    Rodizio desligado, nenhuma disponivel ou gravacao falhando (`switch_error`): None, e `active` fica.
    Nao le hit e nao escreve exhausted_until/invalid de ninguem."""
    if not rotation_on(acc):
        return None
    label, _ = pick_account(acc, ts)
    if not label:
        return None
    prev = acc.get("active")
    err, _ = apply_account(acc, label, ts)
    if err:
        print(f"AVISO: giro de {prev or '-'} para {label} falhou ({err}); a ativa continua {prev or '-'}")
        return None
    acc.update(active=label, switched_at=ts, wake_at=None)
    print(f"rodizio: conta ativa {prev or '-'} -> {label}")
    return label


def attribute(acc: dict, rec: dict, hit: dict, ts: float, ctx: dict) -> str:
    """Regra da secao 6.4: de que conta e o hit (`quota_state`) da sessao `rec`, e o que ele muda. O hit
    pertence a conta gravada no `rec`, nao ao relogio. Exige `state` e `accounts` presos; quem chama
    grava o `acc`. `ctx` e o estado da PASSADA: `vals` = {conta: validate_account(conta)} (R14, R21),
    `late` = contas cuja recusa ja contou (R8), `rotated` = o giro ja foi tentado. Devolve o caso:
    ignorar | incerto | residuo | novo | conhecido | atrasado | auth (confirmado: conta invalidada) |
    auth-nao-confirmado. Todo caso menos `ignorar` pede retomada, que e do vigia."""
    def spin():                                  # no maximo UM giro por passada, mesmo falhando: o passo 4 tenta de novo
        if not ctx.get("rotated"):
            ctx["rotated"] = True
            rotate(acc, ts)

    sent = rec.get("sent_ts") or 0               # rec adotado ou anterior a feature: 0 (R23)
    if hit["ts"] <= sent:
        return "ignorar"                         # anterior a ultima entrega a esta sessao (R13, S19)
    if rec.get("account_uncertain"):
        return "incerto"                         # nao se sabe com que conta a sessao leu (S55)
    x = rec.get("account")
    if x is None and hit["ts"] >= (acc.get("switched_at") or 0):
        x = acc.get("active")                    # reserva (S18)
    e = acc["accounts"].get(x) if x else None
    if not e:
        return "residuo"                         # sem conta atribuivel, ou conta ja removida (R23)
    if hit["kind"] == "auth":                    # vale para QUALQUER conta: quem decide e a validacao de X
        res, ver, text = (ctx.get("vals") or {}).get(x) or (None, None, "")
        if res and ver != e.get("token_version"):
            print(f"validacao da conta {x} descartada: o token foi trocado depois do teste (R14)")
            res = None
        if res == "auth":
            if not e.get("invalid"):             # invalida UMA vez; so esse hit gira
                e["invalid"] = {"since": ts, "reason": text or hit.get("text") or "erro de autenticacao"}
                print(f"conta {x} INVALIDA: {e['invalid']['reason']}")
                if x == acc.get("active"):
                    spin()
            return "auth"
        read = limit_reset(text, ts) if res == "limit" else None
        if not read:
            return "auth-nao-confirmado"         # ok, transitorio, sem validacao ou limite sem hora: so retomar (R7)
        hit = {"kind": "limit", "resets_at": read[0], "type": read[1], "ts": hit["ts"]}
    if x != acc.get("active"):
        return "residuo"                         # S2: nao marca X (incerteza 2 da secao 6.4) nem gira
    until = e.get("exhausted_until") or 0
    if hit["resets_at"] > until:
        e.update(exhausted_until=hit["resets_at"], last_limit_type=hit.get("type"), last_hit=hit["ts"],
                 late_retries=0)
        print(f"conta {x} esgotada ate {when(hit['resets_at'])} ({hit.get('type') or '?'})")
        spin()
        return "novo"
    if sent < until:
        return "conhecido"                       # entregue ANTES do reset: nao e recusa de tentativa nova (R8, S37)
    late = ctx.setdefault("late", set())
    if x not in late:                            # a recusa conta 1 por conta por passada (S36)
        late.add(x)
        e["late_retries"] = (e.get("late_retries") or 0) + 1
        print(f"conta {x} recusou uma entrega feita depois do reset ({e['late_retries']}/{LATE_MAX})")
        if e["late_retries"] >= LATE_MAX:        # o reset nao efetivou: espera extra, que o rotate nao sobrescreve (S39)
            e.update(exhausted_until=ts + LATE_WAIT, late_retries=0)
            spin()
    return "atrasado"


def late_answered(acc: dict, recs) -> list[str]:
    """`late_retries` so volta a 0 quando a conta RESPONDE (R8): uma sessao entregue nela DEPOIS do reset
    (`sent_ts >= exhausted_until`) tem resposta real posterior a entrega. Passada sem hit nao prova nada
    (S38). Quem chama segura `accounts` e grava o `acc`. Devolve as contas zeradas."""
    recs, done = list(recs), []
    for label, e in acc["accounts"].items():
        if (e.get("late_retries") or 0) > 0 and any(
                r.get("account") == label and (r.get("sent_ts") or 0) >= (e.get("exhausted_until") or 0)
                and answered_since(r.get("id"), r.get("sent_ts") or 0) for r in recs):
            e["late_retries"] = 0
            done.append(label)
    return done


def count_hit(st: dict, slug: str | None, stage: str, case: str, kind: str) -> str | None:
    """Contadores da ETAPA no ledger (R21, secao 6.2), como `nudges`: `uncertain_hits` (caso incerto) e
    `auth_hits` (auth que a validacao nao confirmou) sobem 1; um hit de limite zera os dois. Devolve o
    motivo quando a sessao NAO deve mais ser retomada (HITS_MAX seguidos: precisa do dono), senao None."""
    box = bug_of(st, slug) if slug else st["final"]
    key = {"incerto": "uncertain_hits", "auth-nao-confirmado": "auth_hits"}.get(case)
    if key:
        box.setdefault(key, {})[stage] = box.get(key, {}).get(stage, 0) + 1
    elif kind == "limit" and case != "ignorar":
        for k in ("auth_hits", "uncertain_hits"):
            box.get(k, {}).pop(stage, None)
    return needs_owner(st, slug, stage)


def needs_owner(st: dict, slug: str | None, stage: str) -> str | None:
    """Motivo de "precisa do dono" da etapa: HITS_MAX hits seguidos que o vigia nao resolve (R21), ou
    None. So leitura: o `tick` mostra o mesmo motivo sem mexer nos contadores."""
    box = bug_of(st, slug) if slug else st["final"]
    if box.get("uncertain_hits", {}).get(stage, 0) >= HITS_MAX:
        return "arquivo de credenciais disputado"
    if box.get("auth_hits", {}).get(stage, 0) >= HITS_MAX:
        return "erro de autenticacao que a validacao da conta nao confirma"
    return None


# Portao do `spawn` e desvio da cutucada do `tick`: secao 6.3 e F5. Tudo aqui e LEITURA: quem gira e
# quem retoma sessao parada por cota e o vigia (F6).

WHY_QUOTA, WHY_NOCRED = "aguardando cota", "sem credencial valida"    # motivos de pending_spawns[].why
WHY_FILE = "arquivo de credenciais nao confere"                       # seguido de ": <motivo>"
RESET_SLACK = 120                                 # sem rodizio, a cutucada so volta 2 min DEPOIS do reset


def account_for_spawn(acc: dict, ts: float) -> tuple[str | None, str | None]:
    """O PORTAO: uma chamada nova ao CLI pode sair agora? (conta, None): aberto, na ativa (`invalid` nulo
    e `exhausted_until <= ts`). (None, motivo): fechado, "aguardando cota" ou, sem nenhuma conta valida,
    "sem credencial valida". (None, None): rodizio desligado, sem portao (compat, R18). NAO gira."""
    if not rotation_on(acc):
        return None, None
    label = acc.get("active")
    e = (acc.get("accounts") or {}).get(label)
    if e and not e.get("invalid") and (e.get("exhausted_until") or 0) <= ts:
        return label, None
    return None, WHY_NOCRED if pick_account(acc, ts) == (None, None) else WHY_QUOTA


def gate_now() -> tuple[bool, str | None, str | None]:
    """(rodizio ligado, conta, motivo) do portao AGORA, pelo accounts.json lido sem lock. Nunca `die`: no
    meio de uma transicao, abortar deixaria git feito e ledger sem registro. Guarda ilegivel: fechado.
    Projeto sem rodizio: sem portao, nem le a guarda."""
    if not rotation_owner():
        return False, None, None
    try:
        acc = accounts_load()
    except (SystemExit, OSError):
        return True, None, f"{WHY_FILE}: guarda de contas indisponivel (accounts.json ilegivel)"
    return rotation_on(acc), *account_for_spawn(acc, time.time())


def session_hit(rec: dict) -> dict:
    """O hit de cota (`quota_state`) da sessao do `rec`, so se POSTERIOR a ultima entrega a ela (R13,
    R23): logo depois de uma entrega, a ultima entrada do transcript ainda e o hit antigo. `rec` adotado
    ou anterior a feature nao tem `sent_ts`: vale 0."""
    q = quota_state(rec.get("id"))
    return q if q["kind"] and q["ts"] > (rec.get("sent_ts") or 0) else {"kind": None}


def nudge_hold(st: dict, slug: str | None, stage: str, rec: dict, gate: tuple, force: bool) -> str | None:
    """Desvio do `tick` ANTES de cutucar: a nota, se a cutucada NAO deve sair; senao None. `gate` e o
    gate_now() da passada. Rodizio ligado: sessao parada por limite/auth, ou portao fechado -> nao cutuca
    nem gasta `nudges`, nem com `force`: quem retoma e o vigia de cota, pela fila. HITS_MAX hits seguidos
    da etapa: precisa do dono (R21). Rodizio desligado (R18): so ADIA, e so o limite, ate RESET_SLACK
    depois do reset. `force` (`reconcile --fix`) nao adia: o dono pode ter trocado de conta a mao."""
    rot, _, why = gate
    hit = session_hit(rec)
    who = f"{slug or 'finalizacao'}: sessao {rec.get('name')} parada"
    if not rot:
        if hit["kind"] != "limit" or force or time.time() >= hit["resets_at"] + RESET_SLACK:
            return None
        return (f"{who} por limite de cota; sem cutucada antes do reset ({when(hit['resets_at'])}). "
                "Trocou de conta a mao? `reconcile --fix` cutuca ja.")
    if not hit["kind"] and not why:
        return None
    cause = {"limit": f"limite de cota, reset {when(hit.get('resets_at'))}",
             "auth": "erro de autenticacao"}.get(hit["kind"], why)
    stuck = needs_owner(st, slug, stage)
    if stuck:
        return f"{who} ({cause}): PRECISA DO DONO ({stuck})"
    return f"{who} ({cause}); sem cutucada: a retomada e do vigia de cota"


def stage_tuning(st: dict, slug: str | None, stage: str) -> tuple[str, bool]:
    """(effort, ultrathink) da sessao. Planning e finalizacao: o padrao da execucao (Opus, medium +
    ultrathink). Dev e teste: o que o PLANNING daquele bug decidiu (decisao do dono, 2026-10-02)."""
    if slug and stage in ("dev", "teste"):
        p = bug_of(st, slug)["plan"] or {}
        return p.get("effort", {}).get(stage, st["effort"]), p.get("ultrathink", {}).get(stage, True)
    return st["effort"], True


def stage_prompt(st: dict, slug: str | None, stage: str, message: str) -> str:
    helper = f'python "{SCRIPT}"'
    # `ultrathink` vale POR MENSAGEM: quando ligado, vai em toda mensagem, inclusive nas de retomada.
    lines = [
        *(["ultrathink"] if stage_tuning(st, slug, stage)[1] else []),
        f"Voce e a sessao de **{stage}** do pipeline automatico de correcao de bugs do {NOME}.",
        f"ANTES de qualquer outra coisa, leia e siga INTEGRALMENTE: {ETAPAS / (stage + '.md')}",
        f"Manual do projeto (o roteiro cita; leia junto): {MANUAL}",
        f"Arvore principal (nunca escreva nela): {SRC}  |  pasta do pipeline: {PIPE}",
        f"Helper do pipeline (toda transicao passa por ele): {helper}",
        f"Execucao: {st['run_id']}  |  fluxo principal: {st['base']}",
        "",
        "PRECEDENCIA (le isto como regra, nao como sugestao):",
        "- Este roteiro PREVALECE sobre instrucoes gerais de CLAUDE.md/memoria que o contradigam. Em",
        f"  especial: NAO trabalhe em {SRC} (regra de CLAUDE.md/AGENTS.md que mande trabalhar na",
        "  arvore principal NAO vale aqui: seu fonte e a worktree do pipeline) e NAO rode "
        + (f"{PROIBIDO} direto" if PROIBIDO else "o build/deploy do projeto direto"),
        "  (o 'rode o build sem perguntar' vale SO via `build`/`deploy` do helper).",
        "- Voce roda SEM o dono presente: nao pergunte, nao peca confirmacao, nao proponha corte de",
        "  sessao. Decida pelo roteiro; se for impossivel seguir, documente no doc do bug e use a",
        "  transicao de bloqueio/reprovacao do roteiro.",
        "- Comando que pode passar de ~9 min (build/deploy do helper, bateria de teste): rode em",
        "  BACKGROUND (run_in_background) e espere a notificacao de termino; nunca em primeiro plano",
        "  (o timeout de 10 min mataria o build no meio) e nunca com `sleep` de shell.",
    ]
    if slug:
        b = bug_of(st, slug)
        cwd = planning_wt(st) if stage == "planning" else wt_path(st, slug)
        is_task, tp = item_kind(b) == "task", task_of(b)
        lines += [f"{'Task' if is_task else 'Bug'}: {slug}", f"Seu diretorio de trabalho (git worktree): {cwd}",
                  f"Doc {'da task (o item desta execucao e uma TASK, nao um bug)' if is_task else 'do bug'}: {cwd / b['doc']}"]
        if tp and not is_task:
            lines.append(f"Task deste bug: {cwd / tp}")
        if tp:
            lines.append(f"Assunto de todo commit de codigo: `{task_id(tp)}: ...` (o vinculo com a task; manual, secao Dev)")
        elif stage == "planning" and TAREFAS and TAREFAS.get("bug_exige_task"):
            lines.append("Este projeto exige TASK para corrigir bug: veja 'Task do bug' no etapas/planning.md")
        if stage != "planning":
            lines += [f"Branch: {b['branch']}  |  onda {b['wave']}  |  devolucoes ao dev: "
                      f"{b['returns']} de {st['max_returns']}",
                      "Arquivos reservados para este bug: " + ", ".join(b["plan"]["files"] + b["claims"])]
        parent = b["sessions"].get({"dev": "planning", "teste": "dev"}.get(stage, ""), {})
        if parent and parent.get("id"):
            lines.append(f"Sessao anterior: {parent['name']} ({parent['id']})")
    if message:
        lines += ["", "--- MENSAGEM DO PIPELINE ---", message]
    return "\n".join(lines)


def queue_pending(st: dict, slug: str | None, stage: str, message: str, why: str):
    """Mensagem que nao pode ser entregue agora (sessao busy, CLI falhou). O `tick` reentrega.
    A transicao NAO aborta por isso: abortar no meio deixa git feito e ledger sem registro."""
    pend = st.setdefault("pending_spawns", [])
    for e in pend:
        if e["slug"] == slug and e["stage"] == stage:
            if message and message not in e["message"]:
                e["message"] = (e["message"] + "\n\n" + message).strip()
            e["why"], e["ts"] = why, now()
            break
    else:
        pend.append({"slug": slug, "stage": stage, "message": message, "why": why, "ts": now()})
    print(f"AVISO: mensagem para {slug or 'pipeline'}/{stage} PENDENTE ({why}); o pipeline reentrega.")


def spawn_account() -> tuple[str | None, str | None]:
    """(conta que o arquivo tem agora, motivo se nao confere). Passo 2 do portao do `spawn`, so com ele
    aberto. Roda dentro do file_lock("state") do `spawn` e pega `accounts` (ordem state -> accounts,
    R11). Sem rodizio ou sem ativa: (None, None). Nunca `die`: no meio de uma transicao, abortar
    deixaria git feito e ledger sem registro."""
    try:
        if not rotation_on(accounts_load()):
            return None, None
        with file_lock("accounts"):
            acc = accounts_load()
            before = json.dumps(acc, sort_keys=True)
            r = ensure_active(acc, time.time())
            acc["armed"] = None                  # a execucao passou a usar a conta: o activate deixa de ser "armado"
            if json.dumps(acc, sort_keys=True) != before:
                accounts_save(acc)
    except SystemExit:
        return None, "guarda de contas indisponivel (accounts.json ilegivel ou lock preso)"
    except OSError as e:
        return None, f"accounts.json nao gravou ({type(e).__name__})"
    if isinstance(r, tuple):
        return None, r[1]
    return acc.get("active") if rotation_on(acc) else None, None


def spawn(st: dict, slug: str | None, stage: str, message: str = "") -> dict | None:
    """Abre (ou retoma) a sessao da etapa em background. Ela aparece em `claude agents`."""
    exe = claude_exe()
    prompt = stage_prompt(st, slug, stage, message)
    if slug:
        b = bug_of(st, slug)
        cwd = planning_wt(st) if stage == "planning" else wt_path(st, slug)
        name = f"bug{b['order']:02d}-{stage}-{slug[:38]}"
        prev = b["sessions"].get(stage)
    else:
        cwd, name, prev = ROOT, f"pipeline-{stage}-{st['run_id']}", st["final"].get("session")
    dirs = [str(ROOT)] + ([str(DSG)] if DSG.exists() else [])   # DSG: bug do agente de WhatsApp vai para la
    helper_rules = [f'Bash(python "{SCRIPT}":*)', f'Bash(python "{SCRIPT.as_posix()}":*)',
                    f'PowerShell(python "{SCRIPT}":*)']
    # --add-dir e --allowedTools aceitam VARIOS valores: tem que vir antes de uma opcao simples,
    # senao o CLI engole o prompt como mais um diretorio/ferramenta.
    # Sem dono presente: pergunta ou plan mode deixaria a sessao parada para sempre.
    # As flags valem SO no nascimento: a retomada vai sem nenhuma (resume_cmd) e a sessao as mantem.
    common = ["--add-dir", *dirs, "--allowedTools", *helper_rules,
              "--disallowedTools", "AskUserQuestion", "EnterPlanMode",
              "--permission-mode", st["permission_mode"],
              "--model", st["model"], "--effort", stage_tuning(st, slug, stage)[0]]
    # Portao unico (rodizio, F5), ANTES do resume_cmd: fechado, a mensagem vira pendencia e nenhuma sessao
    # e parada a toa pelo `stop`. Vale para todo chamador. Sem rodizio, `label` = None e nada muda.
    _, label, why = gate_now()
    if why:
        queue_pending(st, slug, stage, message, why)
        return None
    t0 = int(time.time() * 1000) - 2000
    try:
        cmd = resume_cmd(exe, prev["id"], prompt) if prev and prev.get("id") else \
            [exe, "--bg", "-n", name, *common, prompt]
    except Busy as e:
        queue_pending(st, slug, stage, message, f"sessao busy ({e})")
        return None
    # Conferencia (F3): o arquivo de credenciais tem de estar na `active` ANTES de chamar o CLI. Portao,
    # conferencia e chamada ficam dentro do file_lock("state") de quem chamou: nenhuma troca cai no meio (R11).
    if label:
        label, why = spawn_account()
        if why:
            queue_pending(st, slug, stage, message, f"{WHY_FILE}: {why}")
            return None
    sent_ts = time.time()                        # DEPOIS do resume_cmd, que pode esperar 30 s pelo stop (R13)
    p = run(cmd, cwd=cwd, check=False)
    if p.returncode != 0:
        queue_pending(st, slug, stage, message, f"claude --bg saiu {p.returncode}: {(p.stderr or p.stdout).strip()[:200]}")
        return None
    if prev:
        prev.pop("stopped", None)
    # A sessao que vale e a do id que o CLI IMPRIMIU: uma copia pode ter nome novo (titulo gerado), e a
    # original parada continua no `agents --all`. Nome/id anterior: so se a saida nao trouxer o id.
    short, sess = bg_id(p.stdout), None
    for _ in range(30):                          # a sessao demora alguns segundos para registrar
        live = agents()
        if short:
            hits = [x for x in live if (x.get("sessionId") or "")[:8] == short]
        elif prev:
            hits = [x for x in live if x.get("sessionId") == prev["id"]
                    or (x.get("name") == prev["name"] and x.get("startedAt", 0) >= t0)]
        else:
            hits = [x for x in live if x.get("name") == name and x.get("startedAt", 0) >= t0]
        sess = max(hits, key=lambda x: x.get("startedAt", 0)) if hits else None
        if sess:
            break
        time.sleep(2)
    rec = {"name": (sess or {}).get("name", prev["name"] if prev else name),
           "id": (sess or {}).get("sessionId") or (prev or {}).get("id"),
           "spawned": now(), "cli_output": (p.stdout or "").strip()[-300:],
           "account": label, "sent_ts": sent_ts}
    if label and not cred_matches(label):        # alguem de fora regravou o bloco no meio (B2, S55)
        rec["account_uncertain"] = True
        print(f"AVISO: o arquivo de credenciais saiu da conta {label} durante o registro da sessao {stage}: "
              "conta da sessao incerta")
    if prev and prev.get("id") and rec["id"] != prev["id"]:
        rec["copy_of"] = prev["id"]              # o ledger segue quem recebeu a mensagem
        print(f"AVISO: o CLI abriu uma COPIA ({rec['id']}) em vez de continuar {prev['id']}; o ledger segue a copia.")
    if slug:
        bug_of(st, slug)["sessions"][stage] = rec
    else:
        st["final"]["session"] = rec
    print(f"sessao {stage}: {rec['name']} id={rec['id']}")
    return rec


# --------------------------------------------------------------------------- worktrees

def guard_wt(path) -> Path:
    """TRAVA: a arvore principal (source/) JAMAIS e alvo de operacao destrutiva do pipeline
    (reset, checkout, clean, rebase, branch -D, worktree remove). Ela e compartilhada com outras
    sessoes e com o dono, tem trabalho nao commitado de terceiros, e nada disso se recupera.
    Quatro testes independentes; qualquer um que falhe aborta ANTES de tocar no disco."""
    p = Path(path).resolve()
    main = SRC.resolve()
    if p == main or main in p.parents or p in main.parents:
        die(f"TRAVA: {p} e (ou contem) a arvore principal {main}. Operacao recusada.", 13)
    if WTS.resolve() not in p.parents:
        die(f"TRAVA: {p} esta fora de {WTS}; o pipeline so mexe nas worktrees dele.", 13)
    if not (p / ".git").is_file():
        die(f"TRAVA: {p} nao e worktree vinculada (o .git dela tem que ser ARQUIVO; na arvore "
            "principal e pasta).", 13)
    listed = [l[len("worktree "):] for l in git("worktree", "list", "--porcelain").splitlines()
              if l.startswith("worktree ")]
    if listed and Path(listed[0]).resolve() == p:
        die(f"TRAVA: o git diz que {p} e a worktree PRINCIPAL. Operacao recusada.", 13)
    return p


def guard_branch(st: dict, name: str) -> str:
    """So branches do proprio pipeline podem ser apagados; nunca o fluxo principal."""
    if not name.startswith("bugfix/") or name in (st["branch"], st["base"]) or "-wip" in name:
        die(f"TRAVA: branch '{name}' nao e descartavel pelo pipeline.", 13)
    return name


# Entradas de build IGNORADAS pelo git (`entradas_ignoradas` do projeto.json). No RetroBat, medido em
# 2026-10-02: `win32-libs` (158 MB: SDL2, SDL2_mixer, curl, FreeImage, freetype, libvlc, rapidjson). Sem
# ela o CMakeLists.txt do ES BAIXA as libs do GitHub (origin/master): falha offline ou compila contra
# versao diferente da arvore principal. COPIA, nunca junction: remover a worktree com um link dentro
# poderia apagar a pasta da arvore principal atraves dele.

def provision_wt(path: Path):
    import shutil
    for rel in WT_IGNORED_INPUTS:
        src, dst = SRC / rel, path / rel
        if src.is_dir() and not dst.exists():
            print(f"copiando entrada de build ignorada pelo git: {rel}")
            shutil.copytree(src, dst, symlinks=True)


def hollow_out(path: Path) -> bool:
    """Lane sem .git e sem ARQUIVO nenhum (so pastas vazias: resto de um `worktree remove` que parou no
    meio por causa de um processo numa subpasta): apaga as subpastas e devolve True. O `worktree add`
    recusa pasta que tenha qualquer coisa dentro, mesmo subpasta vazia."""
    if (path / ".git").exists() or any(not f.is_dir() for f in path.rglob("*")):
        return False
    for d in sorted(path.rglob("*"), key=lambda f: len(f.parts), reverse=True):
        with contextlib.suppress(OSError):
            d.rmdir()
    return True


def ensure_wt(st: dict, name: str):
    path = WTS / name
    st["worktrees"].setdefault(name, {"path": str(path), "bug": None})
    if not (path / ".git").exists():
        git("fetch", REMOTO)
        WTS.mkdir(parents=True, exist_ok=True)
        if path.is_dir():
            hollow_out(path)
        git("worktree", "add", "--detach", str(path), st["base"])
        print(f"worktree criada: {path}")
    provision_wt(path)
    return path


def checkout_fresh(path: Path, base: str, branch: str | None):
    path = guard_wt(path)
    git("fetch", REMOTO, cwd=path)
    try:
        preserve_leftovers(path, f"{path.name} antes de {branch or base}")
    except PreserveFailed as e:
        die(f"{e}\nNada foi resetado em {path}.", 15)
    git("reset", "--hard", cwd=path)              # so sobram os .vcxproj regenerados do bug anterior
    if branch:
        git("checkout", "-B", branch, base, cwd=path)
    else:
        git("checkout", "--detach", base, cwd=path)


# --------------------------------------------------------------------------- etapa 1: planning

def start_plannings(st: dict):
    running = sum(1 for b in st["bugs"].values() if b["state"] == "planning")
    for slug, b in sorted(st["bugs"].items(), key=lambda kv: kv[1]["order"]):
        if running >= st["max_planning"]:
            break
        if b["state"] == "pendente":
            move(st, slug, "planning")
            spawn(st, slug, "planning", "Comece pelo Passo 1 do etapas/planning.md.")
            running += 1


def validate_plan(st: dict, slug: str, plan: dict) -> dict:
    errs = []
    if plan.get("verdict") not in VERDICTS:
        errs.append(f"verdict deve ser um de {VERDICTS}")
    if plan.get("complexity") not in COMPLEXITY_RANK:
        errs.append(f"complexity deve ser um de {tuple(COMPLEXITY_RANK)}")
    if plan.get("severity") not in SEVERITIES:
        errs.append(f"severity deve ser um de {SEVERITIES}")
    files = [norm(f) for f in plan.get("files", [])]
    absolute = [f for f in files if re.match(r"^[A-Za-z]:/|^/", f)]
    if absolute:
        errs.append(f"use caminho RELATIVO a source/ (ex.: emulatorlauncher/...), nao absoluto: {absolute}")
    if plan.get("verdict") == "corrigir":
        if not files:
            errs.append("verdict corrigir exige a lista `files` (relativa a source/)")
        missing_dirs = [f for f in files if not (planning_wt(st) / f).parent.exists()]
        if missing_dirs:
            errs.append(f"pasta inexistente para: {missing_dirs}")
    effort = plan.get("effort", {})
    ultra = plan.get("ultrathink", {})
    if plan.get("verdict") == "corrigir":
        for stage in ("dev", "teste"):
            if effort.get(stage) not in EFFORTS:
                errs.append(f"effort.{stage} deve ser um de {EFFORTS}")
            if not isinstance(ultra.get(stage), bool):
                errs.append(f"ultrathink.{stage} deve ser true/false")
    deps = plan.get("depende_de", [])
    if not isinstance(deps, list) or any(d not in st["bugs"] or d == slug for d in deps):
        errs.append(f"depende_de: so slugs DESTA execucao, sem o proprio: {sorted(set(st['bugs']) - {slug})}")
    b = st["bugs"][slug]
    task, status = None, None
    if item_kind(b) == "task":                   # o proprio doc e a task
        status = task_status((planning_wt(st) / b["doc"]).read_text(encoding="utf-8", errors="replace")) \
            if (planning_wt(st) / b["doc"]).is_file() else None
        if status is None:
            errs.append(f"o doc da task {b['doc']} nao existe na wt-planning")
        elif status not in TAREFAS["abertas"] + TAREFAS["em_andamento"]:
            errs.append(f"a task esta '{status}': so {TAREFAS['abertas'] + TAREFAS['em_andamento']} se planejam")
    elif plan.get("task"):
        task = norm(plan["task"])
        e, status = task_plan_errors(st, slug, task)
        errs += e
    elif TAREFAS and TAREFAS.get("bug_exige_task") and plan.get("verdict") == "corrigir":
        errs.append("este projeto exige task para corrigir bug: `task` no plano (uma que ja cite o doc do bug, "
                    "ou nova com o numero do `task-reserve`; etapas/planning.md)")
    if errs:
        die("plano invalido:\n  " + "\n  ".join(errs), 2)
    return {"verdict": plan["verdict"], "complexity": plan["complexity"], "severity": plan["severity"],
            "files": files, "effort": effort, "ultrathink": ultra,
            "new_docs": [norm(f) for f in plan.get("new_docs", [])],
            "external_docs": plan.get("external_docs", []), "summary": plan.get("summary", ""),
            "task": task, "task_status": status, "depende_de": deps}


def task_plan_errors(st: dict, slug: str, task: str) -> tuple[list[str], str | None]:
    """A task que o plano de um BUG cita (DESIGN 22.9, decisao 4): existe na wt-planning, na pasta, com o nome
    do projeto; numero da base (reaproveitada) ou reservado para ESTE item (nova), sem repetir; nao concluida;
    link cruzado (a task cita o doc do bug, o bug cita o id). Devolve (erros, status lido)."""
    if not TAREFAS:
        return ["`task` no plano, mas o projeto nao tem `tarefas` no projeto.json"], None
    pw, pasta, n = planning_wt(st), TAREFAS["pasta"].strip("/"), task_number(task)
    if n is None or Path(task).parent.as_posix() != pasta:
        return [f"task {task}: tem de ser {pasta}/<nome que casa {TAREFAS['arquivo']}>"], None
    f = pw / task
    if not f.is_file():
        return [f"task {task} nao existe na wt-planning"], None
    errs, res = [], st.get("task_reservas") or {}
    others = [s for s, m in res.items() if m == n and s != slug]
    in_base = run(["git", "cat-file", "-e", f"{st['base']}:{task}"], cwd=pw, check=False).returncode == 0
    if others:
        errs.append(f"o numero {n} esta reservado para {others}")
    elif not in_base and res.get(slug) != n:
        errs.append(f"task nova {task} sem reserva deste item: rode `task-reserve --bug {slug}` e use o numero dele")
    twins = sorted(x.name for x in (pw / pasta).iterdir() if task_number(x.name) == n and x.name != f.name)
    if twins:
        errs.append(f"numero {n} repetido em {pasta}: {twins}")
    text = f.read_text(encoding="utf-8", errors="replace")
    status = task_status(text)
    if status == TAREFAS["concluida"]:
        errs.append(f"a task {task} ja esta '{status}': crie outra (task-reserve)")
    elif status not in TAREFAS["abertas"] + TAREFAS["em_andamento"]:
        errs.append(f"a task {task} esta '{status}': {TAREFAS['campo_status']} tem de ser um de "
                    f"{TAREFAS['abertas'] + TAREFAS['em_andamento']}")
    doc = st["bugs"][slug]["doc"]
    if Path(doc).name not in text:
        errs.append(f"a task {task} nao cita o doc do bug ({Path(doc).name})")
    bug_text = (pw / doc).read_text(encoding="utf-8", errors="replace") if (pw / doc).is_file() else ""
    if task_id(task) not in bug_text:
        errs.append(f"o doc do bug nao cita {task_id(task)}")
    return errs, status


def task_numbers(st: dict) -> dict[int, list[str]]:
    """Numero de task -> onde aparece: (a) na base, (b) em toda arvore do `worktree list` (principal, lanes,
    outros checkouts: pega task nao commitada de sessao humana e dos planners), (c) assunto `<id>:` de
    `git log --all`, (d) reservas do ledger."""
    pasta, seen = TAREFAS["pasta"].strip("/"), {}
    add = lambda n, where: n is not None and seen.setdefault(n, []).append(where)
    for name in git("ls-tree", "--name-only", f"{st['base']}:{pasta}", check=False).splitlines():
        add(task_number(name), f"{st['base']}:{pasta}/{name}")
    for l in git("worktree", "list", "--porcelain").splitlines():
        d = Path(l[9:]) / pasta if l.startswith("worktree ") else None
        for x in (d.iterdir() if d and d.is_dir() else ()):
            add(task_number(x.name), str(x))
    head = re.compile(re.escape(TAREFAS["id"].split("{", 1)[0]) + r"(\d+):")
    for s in git("log", "--all", "--format=%s", check=False).splitlines():
        m = head.match(s)
        add(int(m.group(1)) if m else None, f"commit '{s[:60]}'")
    for s, n in (st.get("task_reservas") or {}).items():
        add(n, f"reserva de {s}")
    return seen


def cmd_task_reserve(a):
    """Planning: numero novo de task para o item (DESIGN 22.9, decisao 3) = 1 + o maior visto em `task_numbers`,
    nunca abaixo de `minimo`. Idempotente por item. O lock `state` serializa os planners em paralelo; sessao
    humana que crie arquivo DEPOIS nao usa o lock: o `plan-done` e o `test-done pass` recusam numero repetido."""
    if not TAREFAS:
        die("este projeto nao tem `tarefas` no projeto.json", 2)
    with file_lock("state"):
        st = load()
        b = bug_of(st, a.bug)
        res = st.setdefault("task_reservas", {})
        if a.bug not in res:
            if b["state"] != "planning":
                die(f"{a.bug} esta em '{b['state']}': task se reserva no planning", 2)
            res[a.bug] = max([TAREFAS["minimo"] - 1, *task_numbers(st)]) + 1
            save(st)
        n = res[a.bug]
    tid = TAREFAS["id"].format(n=n)
    print(f"{tid} reservado para {a.bug}: crie {TAREFAS['pasta'].strip('/')}/{tid}-<slug>.md no modelo do manual")


def commit_external(st: dict) -> list[str]:
    """Docs abertos no digitalstoregamesproject (planning, dev ou teste os registram). Checkout
    compartilhado: commit so com pathspec, sem push/deploy (memoria
    backend-repo-local-commits-go-live-via-other-sessions-deploy). Idempotente."""
    if not DSG.exists():
        return []
    paths = set(st.get("external_docs", []))
    paths |= {p for b in st["bugs"].values() if b.get("plan") for p in b["plan"]["external_docs"]}
    rel = [os.path.relpath(p, DSG) for p in sorted(paths) if os.path.exists(p)]
    pending = [r for r in rel if run(["git", "status", "--porcelain", "--", r], cwd=DSG, check=False).stdout.strip()]
    if pending:
        run(["git", "add", "--", *pending], cwd=DSG, check=False)
        run(["git", "commit", "-m", f"docs(bugs): abertos pelo pipeline do {NOME.lower()} {st['run_id']}",
             "--", *pending], cwd=DSG, check=False)
        print(f"digitalstoregamesproject: commitados (sem push) {pending}")
    return pending


def elencar(st: dict):
    """Etapa 2. Publica os docs do planning e abre a primeira onda. Idempotente: se a integracao
    falhou antes, o commit ja existe e a arvore esta limpa — por isso o teste e 'ha commit fora do
    origin', nao 'ha arquivo sujo'."""
    if st.get("elencado"):
        return
    pw = planning_wt(st)
    try:
        if git("status", "--porcelain", "--", "docs", cwd=pw):
            git("add", "--", "docs", cwd=pw)
            git("commit", "-m", f"{COMMIT_DOCS}: planejamento da execucao {st['run_id']} do pipeline", cwd=pw)
        git("fetch", REMOTO, cwd=pw)
        if git("rev-list", "--count", f"{st['base']}..HEAD", cwd=pw) != "0":
            publish_head(st, pw)
    except SystemExit as e:
        if e.code == 13:
            raise
        st["elencar_erro"] = f"{now()}: integracao dos docs do planning falhou (saida {e.code}); " \
                             "veja o erro acima, resolva e rode `elencar`"
        print("ERRO: " + st["elencar_erro"])
        return
    st.pop("elencar_erro", None)
    commit_external(st)
    st["elencado"] = now()
    next_wave(st)


# --------------------------------------------------------------------------- etapa 2/3: ondas

def compute_wave(st: dict) -> list[str]:
    """Gulosa: menor complexidade restante; depois cada um, na ordem, cujos arquivos sejam disjuntos
    da UNIAO dos ja escolhidos. Severidade fora da ordem por decisao do dono (2026-10-02)."""
    ready = lambda b: all(st["bugs"][d]["state"] == "retest" for d in b["plan"].get("depende_de") or [])
    rest = sorted((s for s, b in st["bugs"].items() if b["state"] == "planejado" and ready(b)),
                  key=lambda s: (COMPLEXITY_RANK[st["bugs"][s]["plan"]["complexity"]], st["bugs"][s]["order"]))
    wave, used = [], set()
    for s in rest:
        files = {fk(f) for f in st["bugs"][s]["plan"]["files"]}
        if not wave or files.isdisjoint(used):
            wave.append(s)
            used |= files
        if len(wave) >= st["max_dev"]:
            break
    return wave


def fail_dependents(st: dict):
    """Item cuja dependencia terminou fora de `retest` nao tem onda (DESIGN 22.9, decisao 10): open-falhou com o
    motivo. Repete ate estabilizar (dependente de dependente)."""
    changed = True
    while changed:
        changed = False
        for s, b in st["bugs"].items():
            bad = [d for d in ((b["plan"] or {}).get("depende_de") or []) if b["state"] == "planejado"
                   and st["bugs"][d]["state"] in TERMINAL and st["bugs"][d]["state"] != "retest"]
            if bad:
                move(st, s, "open-falhou", f"dependencia {bad[0]} terminou em {st['bugs'][bad[0]]['state']}")
                changed = True


def next_wave(st: dict):
    if not st.get("elencado") or any(b["state"] in ("pendente", "planning") for b in st["bugs"].values()):
        return                                    # planning ainda rodando / docs ainda nao integrados
    current = st["waves"][-1] if st["waves"] else []
    # terminou = estado terminal, ou ADIADO para a proxima onda (ciclo de espera, volta a 'planejado')
    if any(st["bugs"][s]["state"] not in TERMINAL + ("planejado",) for s in current):
        return                                    # onda atual nao terminou
    fail_dependents(st)
    wave = compute_wave(st)
    if not wave:
        # nada escolhivel com item `planejado` sobrando = ciclo em `depende_de` (as dependencias estao todas
        # planejadas); sem isto a finalizacao abriria com item `planejado` no ledger
        for s, b in st["bugs"].items():
            if b["state"] == "planejado":
                move(st, s, "open-falhou", "ciclo em depende_de: " + ", ".join(b["plan"].get("depende_de") or []))
        start_final(st)
        return
    st["waves"].append(wave)
    n = len(st["waves"])
    for wt in st["worktrees"].values():
        if wt.get("bug") and st["bugs"][wt["bug"]]["state"] in TERMINAL + ("planejado",) and not wt.get("blocked"):
            wt["bug"] = None
    k = 0
    for slug in wave:
        b = bug_of(st, slug)
        while True:                              # proxima worktree livre e nao bloqueada
            k += 1
            name = f"wt-{k}"
            w = st["worktrees"].get(name, {})
            if w.get("blocked") or w.get("bug"):
                continue
            path = ensure_wt(st, name)
            try:
                checkout_fresh(path, st["base"], b["branch"])
                break
            except SystemExit as e:
                if e.code != 15:
                    raise
                st["worktrees"][name]["blocked"] = f"{now()}: sobra nao preservada ao abrir a onda {n}"
        st["worktrees"][name]["bug"] = slug
        b["wave"], b["wt"] = n, name
        move(st, slug, "dev", f"onda {n}")
        msg = "Planejamento concluido e publicado. Comece pelo Passo 1 do etapas/dev.md."
        if b.get("deferred"):
            msg = (f"Voce foi ADIADO da onda anterior (ciclo de espera por arquivo). Sua tentativa esta "
                   f"no branch local `{b['branch']}-wip-adiado`; reaproveite o que servir "
                   f"(`git checkout {b['branch']}-wip-adiado -- <arquivo>` ou cherry-pick) sobre o fluxo atual. "
                   f"Reserva agora inclui: {', '.join(b['plan']['files'])}. " + msg)
        spawn(st, slug, "dev", msg)
    write_waves_md(st)
    print(f"onda {n}: {wave}")


def write_waves_md(st: dict):
    out = [f"# Ondas da execucao {st['run_id']}", ""]
    for n, wave in enumerate(st["waves"], 1):
        out.append(f"## Onda {n}")
        for s in wave:
            p = st["bugs"][s]["plan"]
            out.append(f"- `{s}` — {p['complexity']} / {p['severity']} — " + ", ".join(f"`{f}`" for f in p["files"]))
        out.append("")
    (PIPE / "runs").mkdir(parents=True, exist_ok=True)
    (PIPE / "runs" / f"{st['run_id']}-ondas.md").write_text("\n".join(out), encoding="utf-8")


def owner_of(st: dict, path: str, me: str) -> str | None:
    for s, b in st["bugs"].items():
        if s != me and b["state"] in ACTIVE_DEV and fk(path) in {fk(f) for f in b["plan"]["files"] + b["claims"]}:
            return s
    return None


def release_waiters(st: dict, owner: str, why: str):
    """Quem esperava arquivo de `owner` volta ao dev."""
    for s, other in st["bugs"].items():
        if other["state"] == "aguardando-arquivo" and other.get("parked_on") == owner:
            other["parked_on"] = None
            move(st, s, "dev", f"{owner} liberou o arquivo ({why})")
            spawn(st, s, "dev", (f"O bug {owner} liberou o arquivo que voce esperava ({why}). Rode "
                                 "`sync --bug <seu slug>` (traz o que ele publicou), depois `claim` de novo e siga."))


def clean_wt(st: dict, slug: str):
    """Fim do bug: a worktree volta ao fluxo principal e os branches do bug somem (o codigo ja esta
    no origin, ou em <branch>-wip se ficou em open). A PASTA fica para a proxima onda reaproveitar o
    build incremental do ES; quem remove as worktrees e o `cleanup` da finalizacao."""
    b = bug_of(st, slug)
    if not b.get("wt"):
        return
    path = guard_wt(wt_path(st, slug))
    try:
        if preserve_leftovers(path, slug):
            b["leftover_stash"] = f"pipeline-sobra {slug}"
    except PreserveFailed as e:
        # Nao limpar NADA: a worktree fica como esta, fora do rodizio, e o dono decide.
        st["worktrees"][b["wt"]]["blocked"] = f"{now()}: {e}"
        b["note"] = f"worktree {b['wt']} intocada: sobra nao preservada"
        print(f"ERRO: {e}\nWorktree {path} deixada INTACTA e fora do rodizio.")
        return
    git("fetch", REMOTO, cwd=path, check=False)
    git("checkout", "--detach", st["base"], cwd=path, check=False)
    for br in (b["branch"], f"{b['branch']}-docs"):
        git("branch", "-D", guard_branch(st, br), cwd=path, check=False)
    st["worktrees"][b["wt"]]["bug"] = None


def finish_bug(st: dict, slug: str, to: str, note: str, caller_stage: str):
    b = bug_of(st, slug)
    move(st, slug, to, note)
    if st["test_slot"] == slug:
        st["test_slot"] = None
    if slug in st["test_queue"]:
        st["test_queue"].remove(slug)
    save(st)                                     # o essencial gravado antes de qualquer efeito externo
    stop_sessions(b, except_stage=caller_stage)
    clean_wt(st, slug)
    release_waiters(st, slug, f"terminou em {to}")
    dispatch_slot(st)
    next_wave(st)


def defer_bug(st: dict, slug: str, extra_file: str, owner: str):
    """Ciclo de espera (A espera B que espera A): o bug que pediu por ultimo sai da onda, com a
    reserva ampliada, e volta numa onda posterior. Nada se perde: o branch vira <branch>-wip-adiado."""
    b = bug_of(st, slug)
    path = guard_wt(wt_path(st, slug))
    discard_generated(path, "park/adiar")
    # nome proprio: o `-wip` e o backup de quem termina em open e nao pode ser sobrescrito por este
    git("branch", "-f", f"{b['branch']}-wip-adiado", "HEAD", cwd=path)
    keys = {fk(f) for f in b["plan"]["files"]}
    for f in b["claims"] + [extra_file]:
        if fk(f) not in keys:
            b["plan"]["files"].append(norm(f))
            keys.add(fk(f))
    b["claims"], b["deferred"] = [], True
    move(st, slug, "planejado", f"adiado: ciclo de espera com {owner} por {extra_file}")
    save(st)
    clean_wt(st, slug)
    b["wt"] = None
    release_waiters(st, slug, "adiado para a proxima onda")


# --------------------------------------------------------------------------- etapa 4: slot

def dispatch_slot(st: dict):
    if st["test_slot"]:
        return
    ready = [s for s in st["test_queue"] if (bug_of(st, s).get("retry_after") or "") <= now()]
    if not ready:
        return
    slug = ready[0]
    st["test_queue"].remove(slug)
    b = bug_of(st, slug)
    b["retry_after"] = None
    st["test_slot"] = slug
    move(st, slug, "teste-e2e")
    spawn(st, slug, "teste", "SLOT CONCEDIDO: o ambiente de teste E2E e seu agora. Continue no Passo 3 do etapas/teste.md.")


def require_slot(st: dict, slug: str):
    if st["test_slot"] != slug:
        die(f"{slug} nao segura o slot de teste (dono atual: {st['test_slot']}). "
            "Deploy no dist e teste E2E so com o slot (`slot-request`).", 2)


def start_final(st: dict):
    if st["final"]["state"] != "pendente":
        return
    st["final"]["state"] = "rodando"
    st["final"]["since"] = now()
    spawn(st, None, "finalizacao", "Todas as ondas terminaram. Comece pelo Passo 1 do etapas/finalizacao.md.")


STAGE_OF = {"planning": "planning", "dev": "dev", "teste": "teste", "teste-e2e": "teste"}
MAX_NUDGES = 2
# Mensagem de INICIO de cada etapa de bug (as mesmas de start_plannings/next_wave/cmd_enqueue_test).
START_MSG = {"planning": "Comece pelo Passo 1 do etapas/planning.md.",
             "dev": "Planejamento concluido e publicado. Comece pelo Passo 1 do etapas/dev.md.",
             "teste": "Rodada de teste {round}. Comece pelo Passo 1 do etapas/teste.md (fase offline, sem slot)."}


NOBODY = object()      # "ninguem chamou" (reconcile do dono). Nao confundir com slug=None da finalizacao.


def pending_is_current(st: dict, e: dict) -> bool:
    """Mensagem pendente so vale se o destinatario AINDA esta na etapa dela (revisao, achado 3:
    reentregar a bug que ja terminou abria sessao para nada)."""
    if e["slug"] is None:
        return e["stage"] == "finalizacao" and st["final"]["state"] == "rodando"
    b = st["bugs"].get(e["slug"])
    return bool(b) and b["state"] not in TERMINAL and STAGE_OF.get(b["state"]) == e["stage"]


def deliver_pending(st: dict, caller, report: bool, only=None) -> list[str]:
    """Reentrega as mensagens pendentes e devolve as notas. Obsoleta: descartada. Do proprio chamador:
    fica. A lista e consumida ANTES dos spawns, que re-enfileiram sozinhos se falharem: `tick` e vigia
    de cota nunca entregam a mesma pendencia duas vezes (R3). `only=(slug, stage)`: so essa entrada e
    tocada, as outras ficam como estao (o vigia, um alvo por lock, R19). report=True: so as notas."""
    notes, deliver, keep = [], [], []
    for e in st.get("pending_spawns", []):
        who = f"{e['slug'] or 'pipeline'}/{e['stage']}"
        if only is not None and (e["slug"], e["stage"]) != tuple(only):
            keep.append(e)
            continue
        if not pending_is_current(st, e):
            notes.append(f"mensagem obsoleta para {who} descartada (o destinatario mudou de etapa)")
            if report:
                keep.append(e)
            continue
        if e["slug"] == caller:                  # NOBODY nunca e igual a slug nenhum, nem a None
            keep.append(e)
            continue
        notes.append(f"reentregando mensagem pendente para {who}")
        (keep if report else deliver).append(e)
    if not report:
        st["pending_spawns"] = keep
        for e in deliver:                         # spawn re-enfileira sozinho se falhar de novo
            spawn(st, e["slug"], e["stage"], e["message"])
    return notes


def tick(st: dict, caller=NOBODY, grace_min: float = 60, force: bool = False,
         report: bool = False) -> list[str]:
    """Vigia SEM agendamento: roda no fim de toda transicao chamada por qualquer sessao (e no
    `reconcile` a pedido do dono). Reentrega mensagens pendentes, encerra sessoes de bugs que
    terminaram, cutuca etapa parada (sessao ociosa sem chamar transicao) ate MAX_NUDGES vezes,
    despacha o slot e abre a proxima onda. Nunca mexe na sessao do proprio chamador. Sessao parada
    por cota nao e cutucada (`nudge_hold`).

    report=True e LEITURA PURA (revisao, achado 3): nenhum spawn, nenhum stop, nenhuma mudanca em
    `st`. Tudo que seria feito vira so nota."""
    live = agents()
    status = {x.get("sessionId"): x.get("status") for x in live}
    notes = deliver_pending(st, caller, report)
    gate, watch = gate_now(), False              # watch: abrir o vigia de cota no fim (rodizio ligado, F6)
    for slug, b in st["bugs"].items():
        if b["state"] in TERMINAL and slug != caller:
            for stage, rec in b["sessions"].items():
                if rec and rec.get("id") and not rec.get("stopped") and status.get(rec["id"]) in RESUMABLE:
                    notes.append(f"encerrar sessao {rec['name']} ({slug} terminou)")
                    if not report:
                        run([claude_exe(), "stop", job_id(rec["id"], live)], cwd=ROOT, check=False)
                        rec["stopped"] = now()
            continue
        stage = STAGE_OF.get(b["state"])
        if not stage or slug == caller:
            continue
        rec = b["sessions"].get(stage)
        if not (rec and rec.get("id")):
            # transicao morta entre o save e o spawn (DESIGN secao 16): abrir JA, com a mensagem de
            # inicio, sem esperar tolerancia nem gastar cutucada. Com pendencia, a reentrega cuida.
            # O spawn pode ter ABERTO a sessao e morrido antes de registra-la: adotar, nunca duplicar.
            pend = st.get("pending_spawns", [])
            since = b["history"][-1]["ts"] if b["history"] else st["created"]
            t_ms = int(dt.datetime.fromisoformat(since).timestamp() * 1000) - 5000
            want = f"bug{b.get('order', 0):02d}-{stage}-{slug[:38]}"
            orphan = [x for x in live if x.get("name") == want and x.get("startedAt", 0) >= t_ms]
            if orphan:
                o = max(orphan, key=lambda x: x.get("startedAt", 0))
                notes.append(f"{slug}: sessao de {stage} {o.get('sessionId')} viva e fora do ledger; adotando")
                if not report:
                    b["sessions"][stage] = {"name": want, "id": o.get("sessionId"), "spawned": now(), "adopted": True}
            elif not any(e["slug"] == slug and e["stage"] == stage for e in pend):
                notes.append(f"{slug}: em '{b['state']}' sem sessao de {stage} registrada (spawn interrompido); abrindo")
                if not report:
                    spawn(st, slug, stage, START_MSG[stage].format(round=b.get("test_round", 0)))
            continue
        sst = status.get(rec.get("id"))
        if sst == "busy":
            continue
        if sst is not None and sst not in RESUMABLE:
            notes.append(f"{slug}: sessao {rec.get('name')} com status '{sst}' (talvez esperando permissao): "
                         "precisa do dono, `claude attach`; o pipeline nao mexe nela")
            continue
        last = b["history"][-1]["ts"] if b["history"] else st["created"]
        idle = (dt.datetime.now() - dt.datetime.fromisoformat(last)).total_seconds() / 60
        if idle < grace_min:
            continue
        hold = nudge_hold(st, slug, stage, rec, gate, force)
        if hold:                                 # parada por cota: cutucar gastaria `nudges` a toa
            notes.append(hold)
            watch = watch or gate[0]
            continue
        nudges = b.get("nudges", {}).get(stage, 0)
        if nudges >= MAX_NUDGES and not force:
            notes.append(f"PARADO e sem mais cutucoes: {slug} em '{b['state']}' ha {idle:.0f} min "
                         f"(sessao {rec and rec.get('name')}). Precisa do dono: claude attach.")
            continue
        notes.append(f"PARADO: {slug} em '{b['state']}' ha {idle:.0f} min; cutucando a sessao ({nudges + 1})")
        if not report:
            b.setdefault("nudges", {})[stage] = nudges + 1
            b["history"].append({"ts": now(), "from": b["state"], "to": b["state"], "note": "cutucada"})
            spawn(st, slug, stage, (
                "O pipeline detectou que esta etapa parou sem chamar a transicao do helper. "
                f"Releia o etapas/{stage}.md, veja no doc do bug e no `git log` ate onde chegou, "
                "termine a etapa e chame o comando de transicao correspondente."))
    fin = st["final"]
    if fin["state"] == "rodando":
        rec = fin.get("session")
        pending_final = any(e["slug"] is None for e in st.get("pending_spawns", []))
        if not (rec and rec.get("id")):
            # o 1o spawn falhou antes de registrar a sessao (revisao, achado 6): abrir de novo
            if not pending_final or report:
                notes.append("finalizacao sem sessao registrada; abrindo")
                if not report:
                    spawn(st, None, "finalizacao", "Todas as ondas terminaram. Comece pelo Passo 1 do etapas/finalizacao.md.")
        elif status.get(rec["id"]) not in ("busy",) and (status.get(rec["id"]) is None or status.get(rec["id"]) in RESUMABLE):
            idle = (dt.datetime.now() - dt.datetime.fromisoformat(fin.get("since", st["created"]))).total_seconds() / 60
            hold = nudge_hold(st, None, "finalizacao", rec, gate, force) if idle >= grace_min else None
            if hold:
                notes.append(hold)
                watch = watch or gate[0]
            elif idle >= grace_min and (fin.get("nudges", 0) < MAX_NUDGES or force):
                notes.append(f"finalizacao parada ha {idle:.0f} min; cutucando")
                if not report:
                    fin["nudges"], fin["since"] = fin.get("nudges", 0) + 1, now()
                    spawn(st, None, "finalizacao", "A finalizacao parou sem `final-done`. Retome de onde parou.")
    if not report:
        dispatch_slot(st)
        next_wave(st)
        # quem retoma o que ficou parado por cota e o vigia: abre se nao houver um vivo (ele confere o rodizio)
        if watch or any(str(e.get("why", "")).startswith((WHY_QUOTA, WHY_NOCRED, WHY_FILE))
                        for e in st.get("pending_spawns", [])):
            schedule_quota_watch("tick")
    for n in notes:
        print("tick: " + n)
    return notes


def foreign_processes() -> list[dict]:
    """O que tira o E2E do ar (`e2e` do projeto.json): os `processos` em QUALQUER lugar (no RetroBat,
    SendInput e foco sao da maquina toda) e qualquer processo rodando de dentro das `pastas`. Projeto sem
    nenhum dos dois: o ambiente esta sempre livre."""
    names, dirs = E2E.get("processos") or [], [str(ROOT / d) for d in E2E.get("pastas") or []]
    if not names and not dirs:
        return []
    conds = ([f"$_.ProcessName -in @({','.join(repr(n) for n in names)})"] if names else []) + \
            [f"($_.Path -and $_.Path -like '{d}\\*')" for d in dirs]
    ps = (f"Get-Process | Where-Object {{ {' -or '.join(conds)} }} | Select-Object Id,ProcessName,Path | "
          "ConvertTo-Json -Compress")
    p = run(["powershell", "-NoProfile", "-Command", ps], check=False)
    try:
        data = json.loads(p.stdout or "[]")
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else [data]


# --------------------------------------------------------------------------- publicacao

def publish_head(st: dict, path: Path, synced_base: str | None = None, code_check: bool = False) -> str:
    """Rebase sobre o fluxo principal + push fast-forward (historico linear, como o repo)."""
    path = guard_wt(path)
    with file_lock("push", timeout=600):
        discard_generated(path, "publish")
        for attempt in range(3):
            git("fetch", REMOTO, cwd=path)
            head_base = git("rev-parse", st["base"], cwd=path)
            if code_check and synced_base and head_base != synced_base:
                changed = git("diff", "--name-only", synced_base, st["base"], cwd=path).splitlines()
                code = [f for f in changed if not f.startswith("docs/")]
                if code:
                    die("o fluxo principal andou com CODIGO depois do seu sync:\n  " + "\n  ".join(code[:20]) +
                        "\nRode sync + deploy de novo e refaca a T2 antes de publicar.", 3)
            # [[pipeline-publish-recusa-branch-que-remove-gerado-do-indice-saida-5_2026-10-07]] gerado que o
            # branch tirou do indice sem .gitignore fica `??` e o checkout da base no rebase recusaria
            # (saida 4); o replay do branch o apagaria de todo modo. Nao rastreado ausente da base fica.
            tracked = set(porcelain_paths(path, untracked=False))
            for f in [f for f in dirty_split(path)[1] if f not in tracked and (path / f).is_file()]:
                if run(["git", "rev-parse", "-q", "--verify", f"{st['base']}:{f}"], cwd=path, check=False).returncode == 0:
                    (path / f).unlink()
                    print(f"gerado nao rastreado que a base rastreia removido antes do rebase: {f}")
            p = run(["git", "rebase", st["base"]], cwd=path, check=False)
            if p.returncode != 0:
                run(["git", "rebase", "--abort"], cwd=path, check=False)
                die(f"rebase com conflito ao integrar:\n{p.stdout}\n{p.stderr}", 4)
            # --diff-filter=d: tirar gerado do indice e a correcao, nao o defeito (so A/M/R/C/T commitam gerado)
            gen = [f for f in git("diff", "--name-only", "--diff-filter=d", f"{st['base']}..HEAD", cwd=path).splitlines()
                   if GENERATED.search(f)]
            if gen:
                die("o branch commita arquivos GERADOS pelo CMake (caminho absoluto da worktree):\n  " +
                    "\n  ".join(gen) + "\nTire-os do commit.", 5)
            extra = before_push(path)
            p = run(["git", "push", REMOTO, f"HEAD:{st['branch']}"], cwd=path, check=False)
            if p.returncode == 0:
                sha = git("rev-parse", "HEAD", cwd=path)
                print(f"integrado no fluxo principal: {git('log', '--oneline', '-1', cwd=path)}")
                return sha
            if extra:                            # refeito sobre a base nova na proxima tentativa
                git("reset", "-q", "--keep", "HEAD~1", cwd=path)
            if not PUSH_RACE.search(p.stdout + "\n" + p.stderr):
                die("push RECUSADO e nao foi corrida (gancho do repo, pre-receive ou rede); nada a repetir:\n"
                    + (p.stdout + "\n" + p.stderr).strip()[-3000:], 17)
            print(f"push rejeitado (tentativa {attempt + 1}), refazendo rebase: {p.stderr.strip()[:200]}")
        die("push rejeitado 3 vezes", 6)


# Corrida no push: o remoto andou (`! [rejected] ... (fetch first|non-fast-forward)`). `[remote rejected]` e recusa.
PUSH_RACE = re.compile(r"^\s*!\s*\[rejected\]", re.M)


def before_push(path: Path) -> str | None:
    """`antes_do_push` do projeto.json (DESIGN 22.9, decisao 6), DEPOIS do rebase e dentro do lock `push`:
    sequencial, entao dois itens da onda nao conflitam no arquivo que ele gera (no ARMSX2, o indice das tasks).
    So pode mexer em docs/: commita com o `assunto`. Falhou ou mexeu fora -> desfaz o que ele fez e sai 17.
    Devolve o SHA do commit, ou None se nao mudou nada."""
    if not ANTES_DO_PUSH:
        return None
    before = set(porcelain_paths(path))
    cmd = [x.replace("{wt}", str(path)).replace("{root}", str(ROOT)) for x in ANTES_DO_PUSH["cmd"]]
    p = run(cmd, cwd=path, check=False)
    changed = sorted(set(porcelain_paths(path)) - before)
    outside = [f for f in changed if not f.startswith("docs/")]
    if p.returncode or outside:
        tracked = set(porcelain_paths(path, untracked=False))
        for f in changed:
            if f in tracked:
                git("checkout", "--", f, cwd=path)
            elif (path / f).is_file():
                (path / f).unlink()
        why = f"saiu {p.returncode}" if p.returncode else f"mexeu fora de docs/: {outside[:10]}"
        die(f"antes_do_push ({' '.join(cmd)}) {why}; desfeito, nada publicado:\n"
            + (p.stdout + "\n" + p.stderr).strip()[-2000:], 17)
    if not changed:
        return None
    git("add", "--", *changed, cwd=path)
    git("commit", "-q", "-m", ANTES_DO_PUSH["assunto"], cwd=path)
    print(f"antes_do_push commitou: {', '.join(changed[:5])}")
    return git("rev-parse", "HEAD", cwd=path)


def normalize_doc_open(st: dict, slug: str, path: Path) -> bool:
    """Bug que NAO passou: o doc tem que estar em open/. O Passo 8 do teste move para retest/ ANTES
    do publish; uma reprovacao depois disso (base mudou, conflito, rodada nova) deixaria um bug
    reprovado com cara de aprovado (revisao, achado 5). Move de volta e marca no topo. True se moveu."""
    b = bug_of(st, slug)
    open_doc, retest_doc = b["doc"], retest_path(b["doc"])
    if not retest_doc or not (path / retest_doc).exists():    # task: nao muda de pasta (normalize_task_status)
        return False
    if (path / open_doc).exists():
        git("rm", "-q", "--", retest_doc, cwd=path)
    else:
        git("mv", retest_doc, open_doc, cwd=path)
    lines = (path / open_doc).read_text(encoding="utf-8").splitlines(keepends=True)
    note = (f"\n> **Pipeline {st['run_id']} ({now()[:10]}): REPROVADO depois de preparado para retest.** "
            "O codigo desta tentativa NAO foi integrado; o doc voltou para `open/`. Qualquer `## Status` de "
            "aprovacao abaixo vale so como historico da tentativa.\n\n")
    (path / open_doc).write_text("".join(lines[:1]) + note + "".join(lines[1:]), encoding="utf-8")
    git("add", "--", open_doc, cwd=path)
    print(f"doc de {slug} devolvido de retest/ para open/")
    return True


def task_concluded_at(path: Path, rev: str, task: str) -> bool | None:
    """A task esta `concluida` em `rev`? None = nao existe la."""
    p = run(["git", "show", f"{rev}:{task}"], cwd=path, check=False)
    return None if p.returncode else task_status(p.stdout) == TAREFAS["concluida"]


def task_done_errors(st: dict, b: dict, path: Path) -> list[str]:
    """`test-done pass` de item com task (DESIGN 22.9, decisao 5): no HEAD integrado a task esta `concluida`,
    ha commit `<id>:` desde o sync, e o numero nao se repete na pasta (sessao humana fora do lock)."""
    tp = task_of(b)
    if not tp or not TAREFAS:
        return []
    errs, tid, pasta = [], task_id(tp), TAREFAS["pasta"].strip("/")
    done = task_concluded_at(path, "HEAD", tp)
    if done is None:
        return [f"{tp} nao existe no HEAD integrado"]
    if not done:
        errs.append(f"{tp}: {TAREFAS['campo_status']} nao e `{TAREFAS['concluida']}` no HEAD integrado (Passo 8)")
    if not task_commits(path, tid, f"{b.get('synced_base') or st['base']}..HEAD"):
        errs.append(f"nenhum commit `{tid}: ...` integrado desde o sync")
    twins = [n for n in git("ls-tree", "--name-only", f"HEAD:{pasta}", cwd=path, check=False).splitlines()
             if task_number(n) == task_number(tp) and n != Path(tp).name]
    if twins:
        errs.append(f"numero de {tid} repetido em {pasta}: {twins} (renumere a task nova)")
    return errs


def normalize_task_status(st: dict, slug: str, path: Path) -> bool:
    """O irmao do `normalize_doc_open` para a task (o estado dela e um campo): item que NAO passou nao fica com a
    task `concluida`. Volta ao Status lido no planning, com nota no topo. Se a BASE ja a tem concluida (sessao
    humana concluiu por fora), nao e desta tentativa: fica. True se mudou (e ja deu `git add`)."""
    b = bug_of(st, slug)
    tp = task_of(b)
    f = path / tp if tp and TAREFAS else None
    if not f or not f.is_file() or task_concluded_at(path, st["base"], tp):
        return False
    raw = f.read_bytes().decode("utf-8")         # bytes: preserva o fim de linha do arquivo
    if task_status(raw) != TAREFAS["concluida"]:
        return False
    back = (b.get("plan") or {}).get("task_status") or TAREFAS["abertas"][0]
    text = set_task_field(raw, TAREFAS["campo_status"], back)
    if TAREFAS.get("campo_concluida_em"):
        text = set_task_field(text, TAREFAS["campo_concluida_em"], "—")
    eol = "\r\n" if "\r\n" in raw else "\n"
    first, _, rest = text.partition(eol)
    note = (f"{eol}> **Pipeline {st['run_id']} ({now()[:10]}): REPROVADO depois de marcada `{TAREFAS['concluida']}`.** "
            f"O codigo desta tentativa NAO foi integrado; o {TAREFAS['campo_status']} voltou para `{back}`.{eol}")
    f.write_bytes((first + eol + note + rest).encode("utf-8"))
    git("add", "--", tp, cwd=path)
    print(f"task de {slug} devolvida de {TAREFAS['concluida']} para {back}")
    return True


def publish_docs_only(st: dict, slug: str) -> str:
    """Bug que termina em open: o CODIGO nao vai para o fluxo principal, so os docs. O trabalho
    fica guardado em <branch>-wip (local). Feito pelo helper para nenhuma sessao reverter na mao.

    Idempotente (revisao, achado 2): o SHA da tentativa e gravado no ledger na 1a chamada, e toda
    repeticao reaponta o -wip para ELE — nunca para o HEAD, que depois da 1a tentativa ja e o
    branch -docs, so com documentacao."""
    b = bug_of(st, slug)
    path = guard_wt(wt_path(st, slug))
    discard_generated(path, "integrar so os docs")
    if not b.get("wip_sha"):
        b["wip_sha"] = git("rev-parse", "HEAD", cwd=path)
        save(st)                                 # antes de trocar de branch: sobrevive a qualquer falha
    wip, wip_br = b["wip_sha"], f"{b['branch']}-wip"
    git("branch", "-f", wip_br, wip, cwd=path)
    git("fetch", REMOTO, cwd=path)
    docs = git("diff", "--name-only", "--no-renames", f"{st['base']}...{wip}", "--", "docs", cwd=path).splitlines()
    git("checkout", "-B", f"{b['branch']}-docs", st["base"], cwd=path)
    for f in docs:
        if run(["git", "cat-file", "-e", f"{wip}:{f}"], cwd=path, check=False).returncode == 0:
            git("checkout", wip, "--", f, cwd=path)
        else:
            git("rm", "-q", "--ignore-unmatch", "--", f, cwd=path)
    normalize_doc_open(st, slug, path)
    normalize_task_status(st, slug, path)
    if git("diff", "--cached", "--name-only", cwd=path):
        git("commit", "-m", f"{COMMIT_DOCS}: {slug} fica em open (pipeline {st['run_id']}); "
            f"codigo guardado em {wip_br}", cwd=path)
    retest_doc = retest_path(b["doc"])
    if retest_doc and git("ls-tree", "--name-only", "HEAD", retest_doc, cwd=path):
        die(f"TRAVA: {retest_doc} continuaria em retest/ para um bug que fica em open.", 2)
    tp = task_of(b)
    if tp and TAREFAS and task_concluded_at(path, "HEAD", tp) and not task_concluded_at(path, st["base"], tp):
        die(f"TRAVA: {tp} continuaria `{TAREFAS['concluida']}` para um item que fica em open.", 2)
    if git("rev-list", "--count", f"{st['base']}..HEAD", cwd=path) != "0":
        return publish_head(st, path)
    return git("rev-parse", "HEAD", cwd=path)


# --------------------------------------------------------------------------- comandos

CLAUDE_JSON = Path.home() / ".claude.json"


def worktrees_trusted() -> bool:
    """Trust de uma worktree git = o do REPOSITORIO PRINCIPAL (`source`), medido em 2026-10-02 (DESIGN
    secao 15): a raiz confiavel nao vale para o repo abaixo dela, e pasta comum herda da raiz. So LE o
    ~/.claude.json; editar para contornar e proibido (SKILL.md)."""
    try:
        projects = json.loads(CLAUDE_JSON.read_text(encoding="utf-8")).get("projects", {})
    except (OSError, json.JSONDecodeError):
        projects = {}
    trusted = {k.replace("\\", "/").rstrip("/").lower() for k, v in projects.items()
               if isinstance(v, dict) and v.get("hasTrustDialogAccepted")}
    return SRC.as_posix().rstrip("/").lower() in trusted


TOKEN_DAYS = 365                                  # validade do token do setup-token (B5; a data exata e a questao 10)
TOKEN_WARN_DAYS = 30


def preflight_accounts(check):
    """Itens do rodizio no preflight (secao 6.8, F8). `check` e o do preflight: falso = [FALHA] e
    VERMELHO. Le a guarda sem lock; a unica escrita e marcar/desmarcar `invalid` pela validacao, com
    R14. Nunca troca a ativa nem toca o arquivo de credenciais (S56)."""
    warn = lambda msg: print(f"[AVISO] contas: {msg}")
    if not rotation_owner():
        check(True, f"rodizio de contas desligado neste projeto (projeto.json): no limite de uso a execucao espera "
                    "o reset; a guarda de contas e o arquivo de credenciais da maquina nao sao tocados")
        return
    try:
        acc = accounts_load()
    except SystemExit:
        check(False, "guarda de contas legivel (accounts.json)", "conserte ou apague o accounts.json e cadastre de novo")
        return
    n, t = len(acc.get("order") or []), time.time()
    if not n:
        warn("nenhuma conta cadastrada: o pipeline roda sem rodizio")
    elif n == 1:
        warn("1 conta cadastrada: rodizio desligado (precisa de 2); a conta e ignorada e o pipeline roda sem rodizio")
    elif acc.get("paused"):
        warn("rodizio pausado (accounts restore): roda sem rodizio ate um `accounts activate --label X`")
    if acc.get("switch_error"):
        warn(f"erro de troca gravado: {mask(acc['switch_error'])}")
    idle, cur = False, None
    if acc.get("applied"):
        try:
            idle = (cur := peek_state()) is None or not run_open(cur)
        except ValueError:                       # state.json no meio de um replace: nao da para dizer
            pass
    if idle and not watch_alive():
        warn(idle_cred_warning(acc, cur))
    if not rotation_on(acc):
        return
    check(not os.environ.get("CLAUDE_CONFIG_DIR"), "CLAUDE_CONFIG_DIR nao definido (o CLI le ~/.claude/.credentials.json)",
          "tire o CLAUDE_CONFIG_DIR do ambiente: com ele o CLI le outro arquivo de credenciais (S58)")
    try:
        exists = cred_read()[1][0] is not None
        check(exists, f"arquivo de credenciais presente ({CRED_FILE})", "faca /login: o rodizio guarda o /login para devolver no fim")
    except CredError as e:
        check(False, f"arquivo de credenciais legivel ({e})", "faca /login de novo (regrava o arquivo)")
    for label in acc["order"]:
        err = io.StringIO()
        try:
            with contextlib.redirect_stderr(err):
                token_of(label)
        except SystemExit:
            check(False, f"conta {label}: token decifra", err.getvalue().strip().removeprefix("ERRO: "))
            continue
        res, tested, text = validate_account(label)
        if res == "ok":
            check(True, f"conta {label}: responde")
            if accounts_mark_valid(label, tested) == "zerada":
                print(f"        conta {label}: deixou de ser invalida")
        elif res == "limit":
            reset = limit_reset(text, t)
            warn(f"{label} esgotada ate {when(reset[0]) if reset else '?'} ({text})")
        elif res == "auth":
            if accounts_mark_invalid(label, tested, text) == "marcada":
                print(f"        conta {label}: marcada INVALIDA pela validacao")
        else:
            warn(f"{label}: nao deu para validar agora ({res}: {text or 'sem saida'})")
    acc = accounts_load()
    accs = acc["accounts"]
    bad = [k for k in acc["order"] if (accs.get(k) or {}).get("invalid")]
    check(len(bad) < n, "alguma conta valida", "todas as contas estao invalidas: gere tokens novos (`claude setup-token`) "
          "e cadastre com `accounts add --label X` num PowerShell comum")
    for k in bad:
        warn(f"{k} INVALIDA ({mask(accs[k]['invalid'].get('reason')) or '?'}): token novo com `accounts add --label {k}`")
    today = dt.date.today()
    for k in acc["order"]:
        e = accs.get(k) or {}
        if not e.get("invalid") and (e.get("exhausted_until") or 0) > t:
            warn(f"{k} marcada esgotada ate {when(e['exhausted_until'])}")
        try:
            left = (dt.date.fromisoformat(e.get("token_created") or "") + dt.timedelta(days=TOKEN_DAYS) - today).days
        except ValueError:
            continue
        if left < TOKEN_WARN_DAYS:
            warn(f"o token de {k} {'venceu' if left < 0 else f'vence em {left} dia(s)'} (criado em "
                 f"{e['token_created']}, validade de {TOKEN_DAYS} dias): `claude setup-token` e `accounts add --label {k}`")
    warn("durante a execucao, TODA sessao desta maquina, inclusive as interativas ja abertas, usa a conta ativa "
         "do pipeline (e fica sem os conectores do claude.ai); um /login manual e desfeito; `accounts restore` "
         "devolve o /login e pausa o rodizio; no fim da execucao o /login volta sozinho")


def preflight_project(check):
    """Os itens `preflight` do projeto.json: {"existe": <relativo a raiz>, "contem": [textos], "msg"} ou
    {"cmd": [...], "msg"} (saida 0 = ok; `{root}` trocado). `fix`, opcional, e a dica da falha."""
    for item in CFG.get("preflight") or []:
        if "cmd" in item:
            cmd = [x.replace("{root}", str(ROOT)) for x in item["cmd"]]
            try:
                good = run(cmd, check=False).returncode == 0
            except OSError:
                good = False
        else:
            path = ROOT / item["existe"]
            good = path.exists()
            if good and item.get("contem"):
                text = path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""
                good = all(x in text for x in item["contem"])
        check(good, item.get("msg") or str(item), item.get("fix", ""))


def cmd_preflight(a):
    ok = True

    def check(cond, msg, fix=""):
        nonlocal ok
        print(("[OK]   " if cond else "[FALHA] ") + msg + ("" if cond or not fix else f"\n        -> {fix}"))
        ok &= bool(cond)

    exe = claude_exe()
    check(True, f"claude.exe: {exe}")
    check(True, f"projeto {NOME}: repo {SRC}, raiz {ROOT}, base {BASE}, lanes em {WTS}")
    check(MANUAL.is_file(), f"manual do projeto {MANUAL}", "crie o projeto.md (DESIGN secao 22.4)")
    if w := copy_warning():
        print(w)
    preflight_project(check)
    branch = git("branch", "--show-current")
    git("fetch", REMOTO, check=False)
    # A arvore principal e compartilhada e raramente esta limpa: nao e VERMELHO, mas o dono tem que ver
    # ANTES de iniciar (decisao de 2026-10-03). A linha antiga era `check(True, ...)`: nao podia falhar.
    base = f"{REMOTO}/{branch}"
    s = main_tree_state(base)
    check(bool(branch), f"arvore principal em {branch or 'HEAD destacado'}")
    warn = []
    if s["ahead"]:
        warn.append(f"{s['ahead']} commit(s) local(is) nao publicado(s): o pipeline parte de {base} e NAO os ve")
    if s["behind"]:
        warn.append(f"{s['behind']} commit(s) atras de {base}: docs e skill que estao aqui estao velhos")
    if s["real"]:
        warn.append(f"{len(s['real'])} arquivo(s) real(is) nao commitado(s) ({', '.join(s['real'][:5])}"
                    f"{', ...' if len(s['real']) > 5 else ''}): a finalizacao commita docs e so publica codigo "
                    "se compilar; o resto vira pendencia sua")
    if run(["git", "diff", "--quiet", base, "--", skill_rel()], cwd=SRC, check=False).returncode:
        warn.append(f"a skill que vai RODAR (a desta arvore) difere da de {base}")
    for w in warn:
        print("[AVISO] arvore principal: " + w)
    if not warn:
        print(f"[OK]   arvore principal igual a {base} ({s['generated']} gerado(s) de build modificado(s))")
    check(isinstance(agents(), list), "claude agents --json responde")
    check(worktrees_trusted(), f"trust aceito no repositorio {SRC} (vale para toda worktree dele)",
          f"o dono roda o claude.exe acima num terminal em {SRC}, aceita e sai")
    preflight_accounts(check)                    # rodizio de contas (secao 6.8 do backlog do rodizio, F8)
    if not a.skip_spawn:
        name = f"pipeline-preflight-{int(time.time())}"
        t0 = int(time.time() * 1000) - 2000
        lane = WTS / "wt-planning"                 # onde o planning nasce
        created = not lane.exists()                # so a pasta que ESTA chamada criou e removida no fim
        lane.mkdir(parents=True, exist_ok=True)
        opened = []                                # id curto de cada sessao que a sonda abriu (bg_id)
        try:
            # Mesmos modelo/effort que o pipeline usa: prova que o CLI aceita os dois. O helper roda
            # dentro desta sessao, entao isto tambem prova sessao abrindo sessao (o caso real).
            p = run([exe, "--bg", "-n", name, "--model", "claude-opus-5-5", "--effort", "low",
                     "--permission-mode", "auto", "Responda apenas OK1, sem usar ferramentas."], cwd=lane, check=False)
            opened.append(bg_id(p.stdout))
            trusted = "not trusted" not in (p.stderr + p.stdout).lower()
            check(trusted and p.returncode == 0, f"spawn de sessao --bg em {lane}",
                  f"rode `claude` uma vez em {lane} (trust e por pasta exata) e aceite. Saida: {(p.stderr or p.stdout).strip()[:200]}")
            s = None
            for _ in range(30):
                hits = [x for x in agents() if x.get("name") == name and x.get("startedAt", 0) >= t0]
                s = hits[0] if hits else None
                if s:
                    break
                time.sleep(2)
            check(s is not None, f"sessao '{name}' aparece no gerenciador (claude agents)")
            if s:
                time.sleep(20)
                # O E2E precisa da AREA DE TRABALHO do dono (SendInput, janela do ES em foreground): a
                # sessao em background tem que rodar na mesma sessao interativa do Windows.
                probe = PIPE / "preflight-desktop.json"
                probe.unlink(missing_ok=True)
                ps_cmd = ("powershell -NoProfile -Command \"@{session=(Get-Process -Id $PID).SessionId; "
                          "interactive=[Environment]::UserInteractive} | ConvertTo-Json | "
                          f"Out-File -Encoding utf8 '{probe}'\"")
                # Sem flags, como o `spawn` retoma: o comando abaixo so roda se a sessao acordar com o
                # --permission-mode com que nasceu.
                r = run(resume_cmd(exe, s["sessionId"],
                                   f"Rode exatamente este comando no PowerShell e depois responda OK2: {ps_cmd}"),
                        cwd=lane, check=False)
                woke = bg_id(r.stdout)             # copia = outro id, e as vezes outro nome
                opened.append(woke)
                check(r.returncode == 0, "stop + resume --bg da mesma sessao (canal teste -> dev)",
                      (r.stderr or r.stdout).strip()[:200])
                time.sleep(10)
                check(woke == s["sessionId"][:8],
                      f"o resume continuou a MESMA sessao (o CLI acordou {woke}, a sonda e {s['sessionId'][:8]})",
                      f"o CLI abriu uma copia. Saida: {' '.join((r.stdout or '').split())[-240:]}")
                seen = set()
                for _ in range(60):                   # ate 2 min para a sessao rodar o comando
                    seen |= {x.get("status") for x in agents() if x.get("sessionId") == s["sessionId"]}
                    if probe.exists():
                        break
                    time.sleep(2)
                print(f"        status vistos para a sessao em background: {sorted(map(str, seen))}")
                unknown = {x for x in seen if x not in RESUMABLE | {"busy", None}}
                check(not unknown, "status de sessao conhecidos pelo vigia",
                      f"status novos {unknown}: avalie se sao 'esperando o dono' e ajuste RESUMABLE no pipeline.py")
                me = run(["powershell", "-NoProfile", "-Command", f"(Get-Process -Id {os.getpid()}).SessionId"],
                         check=False).stdout.strip()
                got = json.loads(probe.read_text(encoding="utf-8-sig")) if probe.exists() else {}
                check(bool(got), "sessao em background executou comando (permissao no modo auto)",
                      "a sessao nao rodou o comando em 2 min: provavelmente esperando permissao — `claude logs` "
                      "dela (o preflight a encerra no fim)")
                if got and E2E.get("desktop"):   # so o projeto cujo E2E usa a area de trabalho (SendInput/foco)
                    check(str(got.get("session")) == me and got.get("interactive"),
                          f"sessao em background roda na area de trabalho do dono (sessao Windows {got.get('session')} "
                          f"vs a sua {me}, interativa={got.get('interactive')}) — requisito do teste E2E",
                          "o E2E (SendInput/foco) nao vai funcionar a partir de sessao em background")
        finally:
            # Sonda viva com cwd na lane trava a pasta (o `worktree remove` deixa pasta vazia presa).
            # Vale tambem em erro/Ctrl-C no meio do preflight. `stop` mantem a conversa no gerenciador.
            stopped = stop_live(name, opened)
            print(f"        sessao de preflight encerrada ({', '.join(stopped) or 'nenhuma viva'}; "
                  f"conversa fica no gerenciador: claude logs / claude rm)")
            for _ in range(5 if created else 0):   # a sessao parada leva alguns segundos para soltar a pasta
                try:
                    lane.rmdir()                   # so apaga VAZIA
                    break
                except OSError:
                    time.sleep(2)
            if created and lane.exists():
                print(f"[AVISO] {lane} ficou (presa ou nao vazia); o `cleanup` e a proxima worktree lidam com ela")
    print("\nPREFLIGHT " + ("VERDE" if ok else "VERMELHO"))
    sys.exit(0 if ok else 1)


def cmd_init(a):
    plan = json.loads(Path(a.bugs).read_text(encoding="utf-8"))
    for bug in plan["bugs"]:                     # antes de tocar o ledger
        tipo = bug.get("tipo", "bug")
        if tipo not in ("bug", "task") or (tipo == "task" and not TAREFAS):
            die(f"{bug['slug']}: tipo {tipo!r} invalido (bug | task; task exige `tarefas` no projeto.json)", 2)
        if tipo == "task" and task_number(bug["doc"]) is None:
            die(f"{bug['slug']}: {bug['doc']} nao casa `tarefas.arquivo` ({TAREFAS['arquivo']})", 2)
    with file_lock("state"):
        if STATE.exists() and not a.force:
            old = json.loads(STATE.read_text(encoding="utf-8"))
            if run_open(old):
                live = [s for s, b in old["bugs"].items() if b["state"] not in TERMINAL]
                die(f"execucao {old['run_id']} ainda ativa ({live or 'finalizacao'}). Use `status`/`reconcile`, ou --force.")
        if STATE.exists():
            (PIPE / "runs").mkdir(parents=True, exist_ok=True)
            old_id = json.loads(STATE.read_text(encoding="utf-8"))["run_id"]
            os.replace(STATE, PIPE / "runs" / f"state-{old_id}.json")
        (PIPE / "reports").mkdir(parents=True, exist_ok=True)
        run_id = dt.datetime.now().strftime("%Y%m%d-%H%M")
        base = a.base or BASE
        if not base.startswith(REMOTO + "/") or not base.split("/", 1)[1]:
            die(f"--base {base}: tem de ser um branch do remoto do projeto ({REMOTO}/<branch>)", 2)
        st = {"run_id": run_id, "created": now(), "base": base, "branch": base.split("/", 1)[1],
              "permission_mode": a.permission_mode, "model": a.model, "effort": a.effort,
              "max_returns": a.max_returns, "max_planning": a.max_planning, "max_dev": a.max_dev,
              "bugs": {}, "waves": [], "worktrees": {}, "test_slot": None, "test_queue": [],
              "final": {"state": "pendente", "session": None}, "excluded": plan.get("excluded", [])}
        for order, bug in enumerate(plan["bugs"], 1):
            slug = bug["slug"]
            st["bugs"][slug] = {"doc": norm(bug["doc"]), "tipo": bug.get("tipo", "bug"),
                                "title": bug.get("title", slug), "order": order,
                                "state": "pendente", "plan": None, "wave": None, "wt": None,
                                "branch": f"bugfix/{slug[:60]}", "claims": [], "parked_on": None,
                                "returns": 0, "test_round": 0, "sessions": {}, "history": [],
                                "synced_base": None, "commit": None, "retry_after": None}
        save(st)
        # a execucao nova consome o `accounts activate` que armou o rodizio, mesmo que nenhum spawn/vigia rode
        # e mesmo com o run_id repetido (um por minuto) [[pipeline-preflight-alarme-falso-vigia-morto-apos-accounts-activate_2026-10-07]]
        # Projeto sem rodizio nao toca a guarda: a marca e do projeto que gira as contas.
        try:
            with file_lock("accounts") if rotation_owner() else contextlib.nullcontext():   # ordem state -> accounts (R11)
                acc = accounts_load() if rotation_owner() else {}
                if acc.get("armed"):
                    acc["armed"] = None
                    accounts_save(acc)
        except (SystemExit, OSError) as e:      # a guarda nunca derruba o init: o ledger ja foi gravado
            print(f"AVISO: a marca do `accounts activate` na guarda de contas nao foi apagada "
                  f"({type(e).__name__}); o primeiro spawn da execucao a apaga")
    print(f"execucao {run_id}: {len(st['bugs'])} bug(s) para planejar (ate {a.max_planning} em paralelo)")


def cmd_start(a):
    with file_lock("state"):
        st = load()
        path = ensure_wt(st, "wt-planning")
        checkout_fresh(path, st["base"], None)
        start_plannings(st)
        save(st)
    schedule_quota_watch("start")                # DEPOIS do save: um vigia saindo rele o state.json (R12)


def cmd_plan_done(a):
    with file_lock("state"):
        st = load()
        b = bug_of(st, a.bug)
        if b["state"] != "planning":
            die(f"{a.bug} esta em '{b['state']}', nao em 'planning'")
        b["plan"] = validate_plan(st, a.bug, json.loads(Path(a.json).read_text(encoding="utf-8")))
        if b["plan"]["verdict"] == "corrigir":
            move(st, a.bug, "planejado", b["plan"]["summary"])
        else:
            move(st, a.bug, "documentado", f"{b['plan']['verdict']}: {b['plan']['summary']}")
        save(st)                                 # o plano fica gravado antes de qualquer efeito externo
        start_plannings(st)
        if not any(x["state"] in ("pendente", "planning") for x in st["bugs"].values()):
            elencar(st)
        tick(st, caller=a.bug)
        save(st)
    print(f"{a.bug}: plano registrado ({b['plan']['verdict']}). Termine o turno.")


def cmd_claim(a):
    with file_lock("state"):
        st = load()
        b = bug_of(st, a.bug)
        files = [norm(f) for f in a.file]
        taken = {f: owner_of(st, f, a.bug) for f in files}
        busy = {f: o for f, o in taken.items() if o}
        if busy:
            for f, o in busy.items():
                print(f"OCUPADO: {f} -> {o}")
            die("arquivo reservado por outro bug da onda. Rode `park --bug <seu> --on <dono>` e termine o turno.", 8)
        mine = {fk(f) for f in b["plan"]["files"] + b["claims"]}
        for f in files:
            if fk(f) not in mine:
                b["claims"].append(f)
                mine.add(fk(f))
        save(st)
    print(f"reservado(s): {files}")


def cmd_park(a):
    with file_lock("state"):
        st = load()
        b = bug_of(st, a.bug)
        if b["state"] != "dev":
            die(f"{a.bug} esta em '{b['state']}', nao em 'dev'")
        owner = bug_of(st, a.on)
        if owner["state"] not in ACTIVE_DEV:
            die(f"{a.on} nao esta mais ativo ({owner['state']}): rode `sync` e `claim` de novo.", 2)
        chain, seen = a.on, set()                # A espera B que espera ... A = ciclo, ninguem anda
        while chain and chain not in seen:
            if chain == a.bug:
                break
            seen.add(chain)
            chain = st["bugs"][chain].get("parked_on")
        if chain == a.bug:
            defer_bug(st, a.bug, a.file, a.on)
            tick(st, caller=a.bug)
            save(st)
            print(f"CICLO de espera com {a.on}: {a.bug} foi ADIADO para a proxima onda, com a reserva "
                  f"ampliada; seu trabalho esta em {b['branch']}-wip-adiado. Termine o turno.")
            sys.exit(12)
        b["parked_on"] = a.on
        move(st, a.bug, "aguardando-arquivo", f"espera {a.on} por {a.file}")
        tick(st, caller=a.bug)
        save(st)
    print(f"{a.bug} aguardando {a.on}; o pipeline retoma esta sessao quando ele terminar. Termine o turno.")


def cmd_enqueue_test(a):
    with file_lock("state"):
        st = load()
        b = bug_of(st, a.bug)
        if b["state"] != "dev":
            die(f"{a.bug} esta em '{b['state']}', nao em 'dev'")
        path = wt_path(st, a.bug)
        dirty, _ = dirty_split(path)
        if dirty:
            die("ha mudanca nao commitada (fora dos gerados do CMake), inclusive arquivo novo:\n  "
                + "\n  ".join(dirty), 2)
        touched = [f for f in git("diff", "--name-only", f"{st['base']}...HEAD", cwd=path).splitlines()
                   if not f.startswith("docs/")]
        if not touched:
            die("nenhum commit de codigo no branch: commite a correcao antes", 2)
        allowed = {fk(f) for f in b["plan"]["files"] + b["claims"]}
        extra = [f for f in touched if fk(f) not in allowed]
        if extra:
            die("o branch altera arquivo NAO reservado (rode `claim` antes, para a onda nao colidir):\n  "
                + "\n  ".join(extra), 9)
        tp = task_of(b)
        if tp and not task_commits(path, task_id(tp), f"{st['base']}..HEAD"):
            die(f"nenhum commit `{task_id(tp)}: ...` no branch: o assunto do commit de codigo e o vinculo com a "
                "task (manual, secao Dev). Corrija o assunto (commit novo ou reword do seu, antes de publicar).", 2)
        b["test_round"] += 1
        move(st, a.bug, "teste", f"rodada {b['test_round']}")
        msg = (f"Rodada de teste {b['test_round']}. Comece pelo Passo 1 do etapas/teste.md (fase offline, "
               "sem slot).")
        if b["sessions"].get("teste"):
            msg = "NOVA RODADA apos correcao do dev: refaca TODOS os testes. " + msg
        save(st)
        spawn(st, a.bug, "teste", msg)
        tick(st, caller=a.bug)
        save(st)
    print(f"{a.bug}: enviado para teste (rodada {b['test_round']}). Termine o turno.")


def cmd_slot_request(a):
    with file_lock("state"):
        st = load()
        b = bug_of(st, a.bug)
        if st["test_slot"] == a.bug:
            print("SLOT CONCEDIDO (ja era seu)")
            return
        if b["state"] != "teste":
            die(f"{a.bug} esta em '{b['state']}', nao em 'teste'")
        ready_ahead = [s for s in st["test_queue"] if (bug_of(st, s).get("retry_after") or "") <= now()]
        if not st["test_slot"] and not ready_ahead:   # fila so com bug em espera de ambiente nao trava ninguem
            st["test_slot"] = a.bug
            move(st, a.bug, "teste-e2e")
            save(st)
            print("SLOT CONCEDIDO: siga para o Passo 3")
            return
        move(st, a.bug, "aguardando-slot")
        st["test_queue"].append(a.bug)
        tick(st, caller=a.bug)
        save(st)
        print(f"NA FILA (posicao {len(st['test_queue'])}, slot com {st['test_slot']}). "
              "Termine o turno: o pipeline retoma esta sessao quando o slot for seu.")
        sys.exit(10)


def cmd_sync(a):
    with file_lock("state"):
        st = load()
        path = guard_wt(wt_path(st, a.bug))
        git("fetch", REMOTO, cwd=path)
        discard_generated(path, "sync")                      # .vcxproj regenerados atrapalham o rebase
        p = run(["git", "rebase", st["base"]], cwd=path, check=False)
        if p.returncode != 0:
            run(["git", "rebase", "--abort"], cwd=path, check=False)
            die(f"rebase no fluxo principal com CONFLITO:\n{p.stdout}\n{p.stderr}", 4)
        bug_of(st, a.bug)["synced_base"] = git("rev-parse", st["base"], cwd=path)
        save(st)
    print(f"branch sobre {st['base']} @ {bug_of(st, a.bug)['synced_base'][:10]}")


def project_cmd(path: Path, kind: str, extra: list[str] = ()):
    """`build` (compile-check, sem tocar o instalado) ou `deploy` do projeto.json, na worktree `path`.
    `{wt}`/`{root}` trocados; `extra` (as `build.flags`) vai no fim. Um por vez por `lock` (no RetroBat,
    um build de ES por vez: OOM, /m:1). Falha -> saida 3."""
    spec = BUILD if kind == "build" else DEPLOY_CFG
    if not spec:
        die(f"este projeto nao tem `{kind}` no projeto.json", 2)
    lock = spec.get("lock") or BUILD.get("lock") or "build"
    with file_lock(lock, timeout=float(spec.get("timeout_h", 3)) * 3600):
        cmd = [x.replace("{wt}", str(path)).replace("{root}", str(ROOT)) for x in spec["cmd"]] + list(extra)
        print("> " + " ".join(cmd), flush=True)
        p = subprocess.run(cmd, cwd=ROOT)
        if p.returncode != 0:
            die(f"{kind} saiu {p.returncode}: {' '.join(cmd)}", 3)


def cmd_build(a):
    st = load()
    extra = [x for flag, args in (BUILD.get("flags") or {}).items()
             if getattr(a, flag.lstrip("-").replace("-", "_"), False) for x in args]
    project_cmd(wt_path(st, a.bug), "build", extra)


def cmd_deploy(a):
    """Deploy no dist (so com o slot). --at-base: deploya o fluxo principal SEM o fix (controle
    positivo: o sintoma tem que aparecer ai, senao o teste nao sabe detecta-lo) e volta ao branch.
    Projeto sem `deploy` no projeto.json: recusa (saida 2); o teste roda da worktree (projeto.md)."""
    st = load()
    require_slot(st, a.bug)
    if not DEPLOY_CFG:
        die("este projeto nao tem `deploy` no projeto.json: o teste roda direto da worktree (veja o projeto.md)", 2)
    b = bug_of(st, a.bug)
    path = guard_wt(wt_path(st, a.bug))
    if not a.at_base:
        project_cmd(path, "deploy")
        return
    if not b["synced_base"]:
        die("rode `sync` antes do controle positivo", 2)
    discard_generated(path, "deploy --at-base")
    git("checkout", "--detach", b["synced_base"], cwd=path)
    try:
        project_cmd(path, "deploy")
    finally:
        # A volta ao branch do bug e tentada SEMPRE, mesmo se a limpeza dos gerados falhar (revisao,
        # achado 4): senao a worktree fica destacada na base e o proximo passo testa a coisa errada.
        cleanup_err = None
        try:
            discard_generated(path, "volta do --at-base")  # o build da base regenerou os gerados
        except SystemExit as e:
            cleanup_err = e
        run(["git", "checkout", b["branch"]], cwd=path, check=False)
        if git("branch", "--show-current", cwd=path) != b["branch"]:
            die(f"TRAVA: a worktree {path} NAO voltou para {b['branch']} depois do controle positivo "
                f"(continua na base). Nada foi descartado. Veja `git -C \"{path}\" status`.", 16)
        if cleanup_err:
            raise cleanup_err
    print(f"dist com o fluxo principal {b['synced_base'][:10]} (sem o fix); worktree de volta em {b['branch']}")


def cmd_publish(a):
    st = load()
    b = bug_of(st, a.bug)
    require_slot(st, a.bug)
    sha = publish_head(st, wt_path(st, a.bug), b["synced_base"], code_check=True)
    with file_lock("state"):
        st = load()
        st["bugs"][a.bug]["commit"] = sha
        save(st)


def cmd_test_done(a):
    with file_lock("state"):
        st = load()
        b = bug_of(st, a.bug)
        path = wt_path(st, a.bug)
        offline = b["state"] == "teste"           # reprovou na fase offline, ainda sem slot
        if b["state"] not in ("teste", "teste-e2e"):
            die(f"{a.bug} esta em '{b['state']}', nao em teste")
        if a.result in ("pass", "ambiente") or not offline:
            require_slot(st, a.bug)
        report = Path(a.report).read_text(encoding="utf-8") if a.report else ""
        final = a.result == "fail" and b["returns"] >= st["max_returns"]
        # Na ultima reprovacao o slot fica com o bug ate o finish_bug, que o libera: publish_docs_only
        # grava o ledger ANTES de publicar, e se a publicacao falhar o bug tem que continuar dono do
        # slot para o mesmo test-done refazer (revalidacao, achado 7).
        if st["test_slot"] == a.bug and not final:   # so libera o slot se for DESTE bug
            st["test_slot"] = None
        if a.result == "pass":
            if not b["commit"]:
                die("pass sem integrar: rode `publish` antes de `test-done --result pass`", 2)
            retest = retest_path(b["doc"])
            if retest and not git("ls-tree", "--name-only", "HEAD", retest, cwd=path):
                die(f"o doc nao esta em retest/ no HEAD integrado ({retest})", 2)
            errs = task_done_errors(st, b, path)
            if errs:
                die("pass recusado:\n  " + "\n  ".join(errs), 2)
            finish_bug(st, a.bug, "retest", a.note, caller_stage="teste")
        elif a.result == "ambiente":
            move(st, a.bug, "aguardando-slot", "ambiente indisponivel: " + a.note)
            b["retry_after"] = (dt.datetime.now() + dt.timedelta(minutes=30)).isoformat(timespec="seconds")
            st["test_queue"].append(a.bug)
            dispatch_slot(st)
        else:  # fail
            if final:
                b["commit"] = publish_docs_only(st, a.bug)
                finish_bug(st, a.bug, "open-falhou",
                           f"reprovado apos {b['returns']} devolucoes ao dev; ultimo relatorio: {a.report}",
                           caller_stage="teste")
            else:
                discard_generated(path, "reprovacao")
                moved = normalize_doc_open(st, a.bug, path)  # o dev recebe o doc em open/, nunca em retest/
                if normalize_task_status(st, a.bug, path) or moved:   # ... e a task nunca concluida
                    git("commit", "-m", f"{COMMIT_DOCS}: {a.bug} volta para open (teste reprovado)", cwd=path)
                b["returns"] += 1
                move(st, a.bug, "dev", f"reprovado; devolucao {b['returns']} de {st['max_returns']}")
                save(st)
                spawn(st, a.bug, "dev", (
                    f"Os testes REPROVARAM (devolucao {b['returns']} de {st['max_returns']}). A falha esta "
                    "documentada no doc do bug. Corrija o que e pertinente, commite e reenfileire "
                    "(Passo 5 do etapas/dev.md).\n\nRELATORIO DO TESTE:\n" + report))
                dispatch_slot(st)
        tick(st, caller=a.bug)
        save(st)
    print(f"{a.bug}: rodada encerrada ({a.result}), slot liberado. Termine o turno.")


def cmd_blocked(a):
    """Dev conclui que nao da para corrigir aqui (hardware, telemetria, ambiente): doc em open."""
    with file_lock("state"):
        st = load()
        b = bug_of(st, a.bug)
        if b["state"] != "dev":
            die(f"{a.bug} esta em '{b['state']}', nao em 'dev'")
        b["commit"] = publish_docs_only(st, a.bug)
        finish_bug(st, a.bug, "open-falhou", "bloqueado: " + a.note, caller_stage="dev")
        tick(st, caller=a.bug)
        save(st)
    print(f"{a.bug}: documentado e deixado em open. Termine o turno.")


def lane_sessions(path: Path, live: list[dict]) -> list[dict]:
    """Sessoes VIVAS (`status` presente) com cwd na lane ou abaixo dela. Viva com cwd na pasta, ela
    trava a pasta no Windows: o `worktree remove` apaga o conteudo e deixa a pasta vazia presa. So o
    `claude agents --json` mostra o cwd; a linha de comando do processo nao (o `daemon run
    --spawned-by` que cita a lane e so metadado e NAO trava nada: medido em 2026-10-02)."""
    key = lambda p: os.path.normcase(os.path.normpath(str(p)))
    p = key(path)
    return [x for x in live if x.get("status") is not None and x.get("cwd") and x.get("sessionId")
            and (key(x["cwd"]) == p or key(x["cwd"]).startswith(p + os.sep))]


def cmd_cleanup(a):
    """Finalizacao: remove as worktrees da execucao. Recusa se algo ainda nao esta integrado."""
    st = load()
    live = agents()
    to_stop, foreign = [], []                    # sessoes ociosas com cwd numa lane: background / interativa
    problems = [f"{s} ainda em '{b['state']}'" for s, b in st["bugs"].items() if b["state"] not in TERMINAL]
    git("fetch", REMOTO)
    for s, b in st["bugs"].items():
        if b["state"] == "retest" and b.get("commit") and run(
                ["git", "merge-base", "--is-ancestor", b["commit"], st["base"]], cwd=SRC, check=False).returncode:
            problems.append(f"{s}: commit {b['commit'][:10]} NAO esta em {st['base']}")
    # Lanes do ledger MAIS as que estao em `lanes\` fora dele (sobras de execucoes antigas: ninguem as
    # removia). Passam pelas mesmas recusas; pasta sem .git e com conteudo nunca e apagada.
    lanes = {name: Path(wt["path"]) for name, wt in st["worktrees"].items()}
    if WTS.is_dir():
        known = {os.path.normcase(str(p.resolve())) for p in lanes.values()}
        lanes.update({d.name: d for d in sorted(WTS.iterdir())
                      if d.is_dir() and os.path.normcase(str(d.resolve())) not in known})
    verified = []                                # worktrees conferidas limpas aqui: a sobra de um remove parcial pode sair
    for name, path in lanes.items():
        if (path / ".git").exists():
            guard_wt(path)                       # antes de qualquer remocao, todas passam na trava
            dirty, _ = dirty_split(path)
            if dirty:
                problems.append(f"{name} tem mudanca nao commitada: {dirty[:5]}")
            # commit que so existe nesta worktree (HEAD fora do origin e sem branch) sumiria com ela
            in_origin = run(["git", "merge-base", "--is-ancestor", "HEAD", st["base"]], cwd=path, check=False).returncode == 0
            if not in_origin and not git("branch", "--points-at", "HEAD", cwd=path):
                problems.append(f"{name}: HEAD {git('rev-parse', '--short', 'HEAD', cwd=path)} nao esta em "
                                f"{st['base']} nem em branch nenhum (seria perdido)")
            verified.append(path)
        elif not path.exists() or WTS.resolve() not in path.resolve().parents:
            continue                             # sem pasta, ou fora das lanes: nenhuma sessao a olhar
        # Tambem na lane SEM .git (pasta vazia do preflight, ou sobra de um remove que saiu 255): sessao
        # viva la dentro e o que prende a pasta.
        for x in lane_sessions(path, live):
            who = f"sessao '{x.get('name')}' ({x['sessionId'][:8]})"
            if x.get("status") not in RESUMABLE:     # trabalhando ou esperando o dono: nunca parar por cima
                problems.append(f"{name}: {who} esta '{x.get('status')}' com cwd na lane — espere terminar "
                                "ou `claude stop` nela")
            elif x.get("kind") == "interactive":     # terminal/IDE do dono: `claude stop` so para background
                foreign.append(f"{name}: {who} e interativa (nao e do pipeline) e tem cwd na lane; `claude stop` "
                               "nao a alcanca — a pasta fica presa ate ela fechar")
            else:
                to_stop.append((name, x))
    if problems:
        die("cleanup recusado (nada foi apagado):\n  " + "\n  ".join(problems), 2)
    for f in foreign:
        print("AVISO: " + f)
    if to_stop:
        exe = claude_exe()
        for name, x in to_stop:
            run([exe, "stop", job_id(x["sessionId"], live)], cwd=ROOT, check=False)
            print(f"sessao encerrada (cwd na lane {name}): {x.get('name')} {x['sessionId'][:8]}")
        time.sleep(3)
    # Branch de bug TERMINADO que o `clean_wt` nao conseguiu apagar (ele roda com check=False): o codigo
    # ja esta no origin (retest, conferido acima) ou no -wip (open). De dentro de uma lane, como o clean_wt.
    if verified:
        have = set(git("branch", "--list", "bugfix/*", "--format=%(refname:short)", cwd=verified[0]).split())
        on = {git("branch", "--show-current", cwd=p): p for p in verified}
        for s, b in st["bugs"].items():
            for br in (b["branch"], b["branch"] + "-docs"):
                if br in have:
                    if br in on:                 # branch em uso numa lane: o git nao apaga
                        git("checkout", "--detach", cwd=on[br], check=False)
                    git("branch", "-D", guard_branch(st, br), cwd=verified[0], check=False)
                    print(f"branch de bug terminado apagado: {br}")
    import shutil
    for name, path in lanes.items():
        if (path / ".git").exists():
            path = guard_wt(path)
            p = run(["git", "worktree", "remove", "--force", str(path)], cwd=SRC, check=False)
            # Pasta presa pelo cwd de um processo: o git apaga o conteudo, desregistra a worktree e sai
            # 255 ("failed to delete ... Permission denied"), medido em 2026-10-02. Sem .git = removida;
            # a pasta vazia que sobrou e tratada abaixo. Qualquer outra falha continua fatal.
            if p.returncode != 0 and (path / ".git").exists():
                die(f"falhou ({p.returncode}): git worktree remove --force {path}\n{p.stdout}\n{p.stderr}")
            # Processo numa SUBPASTA da lane: o git para no meio e deixa arquivos (medido em 2026-10-03), e
            # o `worktree add` seguinte falharia ali. A lane foi conferida limpa acima: o resto pode sair.
            if p.returncode != 0 and path.exists() and any(path.iterdir()):
                shutil.rmtree(path, ignore_errors=True)
                print(f"sobra do remove parcial apagada em {name} (a lane estava limpa e integrada)")
            print(f"worktree removida: {name}")
    git("worktree", "prune")
    gd = git_dir()                               # SRC/.git e pasta, ou (SRC e worktree) .git/worktrees/<nome>
    if not gd or not gd.is_dir():
        die(f"ALERTA: o .git de {SRC} ({gd or 'o git nao o acha mais'}) nao e mais pasta depois do cleanup. "
            "Pare tudo e avise o dono.", 14)
    for name, path in lanes.items():
        if not path.exists() or WTS.resolve() not in path.resolve().parents:
            continue
        hollow = hollow_out(path)
        try:
            path.rmdir()                         # so apaga pasta VAZIA (sobra do remove)
            print(f"pasta vazia da lane removida: {name}")
        except OSError:
            n = sum(1 for _ in path.iterdir())
            if n and not hollow:
                print(f"AVISO: {path} nao e worktree e nao esta vazia ({n} item(ns)); nada apagado nela.")
                continue
            held_by = [f"{x.get('name')} ({x['sessionId'][:8]}, {x.get('status')})"
                       for x in lane_sessions(path, agents())]
            print(f"AVISO: {path} ficou vazia e presa: algum processo tem cwd nela. Sessoes claude com cwd "
                  f"ali: {held_by or 'nenhuma'}. A linha de comando NAO mostra cwd — nao culpe o `daemon run` "
                  "que cita a lane no --spawned-by. Nada se perde: a proxima worktree reaproveita a pasta vazia.")
    wip = git("branch", "--list", "bugfix/*-wip*")
    print("branches -wip mantidos (tentativas de bugs que ficaram em open):\n" + (wip or "  nenhum"))


def cmd_env_wait(a):
    """Passo 3 do teste: espera o ambiente E2E ficar livre (ate 9 min por chamada, cabe no timeout
    de uma ferramenta). Sai 0 livre, 11 ainda ocupado. Python dormindo nao e `sleep` de shell."""
    deadline = time.time() + min(a.minutes, 9) * 60
    while True:
        procs = foreign_processes()
        if not procs:
            print("AMBIENTE LIVRE")
            return
        if time.time() >= deadline:
            for p in procs:
                print(f"OCUPADO: {p.get('ProcessName')} pid={p.get('Id')} {p.get('Path') or ''}")
            sys.exit(11)
        time.sleep(30)


def cmd_register_external(a):
    """Doc aberto no digitalstoregamesproject por qualquer etapa: registrar para ser commitado."""
    f = str(Path(a.file).resolve())
    if not (DSG.exists() and Path(f).is_relative_to(DSG.resolve())):
        die(f"{f} nao esta em {DSG}", 2)
    with file_lock("state"):
        st = load()
        lst = st.setdefault("external_docs", [])
        if f not in lst:
            lst.append(f)
        save(st)
    print(f"registrado: {f} (commitado com pathspec, sem push, pelo pipeline)")


def cmd_commit_external(a):
    with file_lock("state"):
        st = load()
        commit_external(st)


def cmd_elencar(a):
    """Retenta a Etapa 2 depois de uma falha de integracao dos docs do planning."""
    with file_lock("state"):
        st = load()
        if any(b["state"] in ("pendente", "planning") for b in st["bugs"].values()):
            die("ainda ha planning em andamento", 2)
        elencar(st)
        save(st)
        if st.get("elencar_erro"):
            sys.exit(4)


def cmd_final_prepare(a):
    """Finalizacao: a wt-planning volta ao fluxo principal atual para receber as correcoes de docs."""
    st = load()
    if st["final"]["state"] != "rodando":
        die("so na finalizacao", 2)
    path = planning_wt(st)
    checkout_fresh(path, st["base"], None)
    print(f"edite os docs em: {path}")


def cmd_final_docs(a):
    st = load()
    if st["final"]["state"] != "rodando":
        die("so na finalizacao", 2)
    path = guard_wt(planning_wt(st))
    real, _ = dirty_split(path)
    outside = [f for f in real if not f.replace("\\", "/").startswith("docs/")]
    if outside:
        die(f"a finalizacao so publica docs; ha mudanca fora de docs/: {outside}", 2)
    if real:
        git("add", "--", "docs", cwd=path)
        git("commit", "-m", a.message, cwd=path)
    publish_head(st, path)


def require_final(st: dict):
    if st["final"]["state"] != "rodando":
        die("so na finalizacao", 2)


def save_final(st: dict, key: str, value):
    """Grava um resultado da finalizacao no ledger em disco (sem segurar o lock durante um build)."""
    with file_lock("state"):
        disk = load()
        disk["final"][key] = value
        for name, wt in st["worktrees"].items():  # lane criada pelo ensure_wt desta chamada
            disk["worktrees"].setdefault(name, wt)
        save(disk)


def final_lane(st: dict) -> Path:
    """Lane livre para a finalizacao: de preferencia uma de bug (build quente do ES); senao a wt-planning."""
    warm = [n for n, wt in st["worktrees"].items()
            if n != "wt-planning" and not wt.get("blocked") and (Path(wt["path"]) / ".git").exists()]
    return ensure_wt(st, warm[0] if warm else "wt-planning")


def md5_of(path: Path) -> str | None:
    import hashlib
    try:
        return hashlib.md5(path.read_bytes()).hexdigest()
    except OSError:
        return None


def main_tree_state(base: str) -> dict:
    """LEITURA da arvore principal contra `base`: o que a separa do origin."""
    real, gen = dirty_split(SRC)
    count = lambda rng: int(git("rev-list", "--count", rng, check=False) or 0)
    return {"branch": git("branch", "--show-current"), "ahead": count(f"{base}..HEAD"),
            "behind": count(f"HEAD..{base}"), "real": real, "generated": len(gen)}


def unpublished(base: str) -> list[str]:
    """Commits da arvore principal SEM patch equivalente em `base` (`git cherry`: '+'). Os duplicados
    recommitados por outro caminho (bug da finalizacao, E4) saem como '-' e nao contam."""
    return [l[2:] for l in git("cherry", base, "HEAD", check=False).splitlines() if l.startswith("+ ")]


def sync_main(st: dict, fresh_min: float = FRESH_MIN) -> dict:
    """Deixa a arvore principal igual ao origin (decisao do dono, 2026-10-03): commita o trabalho de
    terceiros (um commit por doc; codigo num commit so, publicado SE compilar; o da pasta da propria skill
    nunca: o build nao o valida), publica os commits locais por uma lane e avanca a arvore com
    `merge --ff-only`/`reset --keep`. Nunca descarta nem
    reescreve arquivo modificado (unica excecao: gerado de build que o proprio alvo apaga): o que nao da
    para resolver vira item de `pending` (decisao do dono)."""
    base, pend, commits = st["base"], [], []
    git("fetch", REMOTO)
    cur, gd = git("branch", "--show-current"), git_dir() or SRC / ".git"
    ops = [n for n in ("rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD")
           if (gd / n).exists()]
    if cur != st["branch"] or ops:
        return {"at": now(), "commits": [], "published": None, "blocked": True,
                "head": git("rev-parse", "HEAD"), "base": git("rev-parse", base), "pending": [
            f"arvore principal em '{cur or 'HEAD destacado'}'" + (f" com operacao em curso ({', '.join(ops)})" if ops else "")
            + f": nada foi tocado. Cabe ao dono terminar/abortar e voltar para {st['branch']}."]}

    def mtime(f):
        try:
            return (SRC / f).stat().st_mtime
        except OSError:
            return 0.0                             # apagado: nao ha edicao em curso
    stamp = lambda f: dt.datetime.fromtimestamp(mtime(f)).isoformat(sep=" ", timespec="minutes") if mtime(f) else "apagado"
    tracked = set(porcelain_paths(SRC, untracked=False))
    real = dirty_split(SRC)[0]
    # nao rastreado IGUAL ao que chega do origin (mesmo blob): sai, senao o fast-forward recusa
    for f in [f for f in real if f not in tracked and (SRC / f).is_file()]:
        blob = run(["git", "rev-parse", "-q", "--verify", f"{base}:{f}"], cwd=SRC, check=False)
        if blob.returncode == 0 and blob.stdout.strip() == git("hash-object", "--", f):
            (SRC / f).unlink()
            real.remove(f)
            print(f"nao rastreado identico ao do origin removido: {f}")
    limit = time.time() - fresh_min * 60
    fresh = [f for f in real if mtime(f) > limit]
    if fresh:
        pend.append(f"arquivo(s) mexido(s) ha menos de {fresh_min:g} min (outra sessao editando agora), nao "
                    "commitado(s): " + ", ".join(f"{f} ({stamp(f)})" for f in fresh[:10]))
    is_doc = lambda f: f.replace("\\", "/").startswith("docs/")
    stray = [f for f in real if f not in fresh and f not in tracked and not is_doc(f)]
    if stray:
        pend.append("arquivo(s) novo(s) fora de docs/, de origem desconhecida, nao commitado(s): "
                    + ", ".join(f"{f} ({stamp(f)})" for f in stray[:10]))
    # [[pipeline-final-sync-main-publica-codigo-da-skill-em-edicao-por-outra-sessao_2026-10-09]] o portao do
    # commit de codigo e o `build` do projeto, que nao valida o helper: o modo tasks da B2, pela metade e sem
    # os testes, foi publicado assim (a361a1b). A idade do arquivo nao prova que a edicao terminou; so quem
    # edita sabe. O arquivo NOVO da skill ja saiu acima, em `stray`.
    skill = skill_rel() + "/"
    own = [f for f in real if f not in fresh and f not in stray and f.replace("\\", "/").startswith(skill)]
    if own:
        pend.append(f"arquivo(s) da propria skill ({skill}) nao commitado(s): o build do projeto nao os valida e o "
                    "helper e replicado nas copias; quem edita commita: " + ", ".join(f"{f} ({stamp(f)})" for f in own[:10]))
    todo = [f for f in real if f not in fresh and f not in stray and f not in own]
    docs, code = [f for f in todo if is_doc(f)], [f for f in todo if not is_doc(f)]
    why = f"trabalho local de outra sessao publicado pela finalizacao do pipeline {st['run_id']}"
    groups = [([f], f"{COMMIT_DOCS if f.replace(chr(92), '/').startswith('docs/bugs/') else COMMIT_DOCS_OUTROS}: "
               f"{Path(f).stem[:80]} - {why} ({f})") for f in docs]
    if code:                                       # por ultimo: se nao compilar, so ele fica sem publicar
        groups.append((code, f"{COMMIT_TERCEIROS}: codigo local nao commitado de outra sessao; a finalizacao do "
                             f"pipeline {st['run_id']} so publica se compilar\n\n" + "\n".join(code)))
    with main_sync_window():
        for files, msg in groups:
            run(["git", "add", "-A", "--", *files], cwd=SRC, check=False)
            p = run(["git", "commit", "-q", "-m", msg, "--", *files], cwd=SRC, check=False)
            if p.returncode == 0:
                commits.append({"sha": git("rev-parse", "--short", "HEAD"), "files": files})
                print(f"commit de terceiros: {commits[-1]['sha']} {', '.join(files[:5])}")
            elif any(f in dirty_split(SRC)[0] for f in files):
                pend.append(f"commit de {files[:5]} falhou: {(p.stderr or p.stdout).strip()[:200]}")

    head, published, full = git("rev-parse", "HEAD"), None, False
    if unpublished(base):
        lane = final_lane(st)
        try:
            checkout_fresh(lane, head, None)
            p = run(["git", "rebase", base], cwd=lane, check=False)
            if p.returncode != 0:
                run(["git", "rebase", "--abort"], cwd=lane, check=False)
                where = [l.strip() for l in (p.stdout + p.stderr).splitlines() if "CONFLICT" in l or l.startswith("Could not apply")]
                pend.append("conflito ao rebasear os commits locais da arvore principal sobre o origin (nada publicado; "
                            "os commits continuam so nela): " + " | ".join(where)[:400])
            else:
                seq = git("rev-list", "--reverse", f"{base}..HEAD", cwd=lane).splitlines()
                touches_code = lambda c: any(not x.startswith("docs/") for x in git(
                    "diff-tree", "--no-commit-id", "--name-only", "-r", c, cwd=lane).splitlines())
                first_code = next((c for c in seq if touches_code(c)), None)
                target = seq[-1] if seq else None
                if first_code:
                    try:
                        project_cmd(lane, "build")
                    except SystemExit:
                        i = seq.index(first_code)
                        target = seq[i - 1] if i else None
                        pend.append(f"codigo local NAO compila (`build` do projeto na lane {lane.name}): "
                                    f"{len(seq) - i} commit(s) a partir de '{git('log', '-1', '--format=%h %s', first_code, cwd=lane)[:90]}' "
                                    "ficaram so na arvore principal, sem publicar. Cabe ao dono corrigir ou desfazer.")
                    discard_generated(lane, "final-sync-main")
                if target:
                    git("checkout", "--detach", target, cwd=lane)
                    published = publish_head(st, lane)
                    full = target == seq[-1]
        except SystemExit as e:                   # o die() ja imprimiu o motivo
            pend.append(f"publicacao dos commits locais da arvore principal falhou (saida {e.code}); veja o erro acima")

    git("fetch", REMOTO)
    if git("rev-parse", "HEAD") != git("rev-parse", base):
        left = unpublished(base)
        if left and not (full and git("rev-parse", "HEAD") == head):
            pend.append(f"{len(left)} commit(s) local(is) sem equivalente no origin: a arvore principal nao pode "
                        "ser igualada sem perde-los: " + "; ".join(left[:5]))
        else:
            ff = run(["git", "merge-base", "--is-ancestor", "HEAD", base], cwd=SRC, check=False).returncode == 0
            # [[pipeline-publish-recusa-branch-que-remove-gerado-do-indice-saida-5_2026-10-07]] gerado de build
            # rastreado e regravado aqui que o alvo APAGA faz o ff/reset --keep abortar inteiros. O comando o
            # apagaria de todo modo e nao ha versao a preservar; unlink, porque `checkout --` e saida 13 aqui.
            # Gerado que o alvo MANTEM continua intacto.
            dirty = set(porcelain_paths(SRC, untracked=False))
            for f in [f for f in dirty_split(SRC)[1] if f in dirty and (SRC / f).is_file()]:
                gone = run(["git", "rev-parse", "-q", "--verify", f"{base}:{f}"], cwd=SRC, check=False).returncode != 0
                if gone and run(["git", "rev-parse", "-q", "--verify", f"HEAD:{f}"], cwd=SRC, check=False).returncode == 0:
                    (SRC / f).unlink()
                    print(f"gerado de build modificado que o origin apaga removido: {f}")
            with main_sync_window():
                p = run(["git", "merge", "--ff-only", base] if ff else ["git", "reset", "--keep", base],
                        cwd=SRC, check=False)
            if p.returncode != 0:
                pend.append(f"`git {'merge --ff-only' if ff else 'reset --keep'} {base}` recusou (arquivo local no "
                            f"caminho; nada foi sobrescrito): {(p.stderr or p.stdout).strip()[:300]}")
            else:
                print(f"arvore principal em {git('rev-parse', '--short', 'HEAD')} = {base}")
    # blocked: a arvore NAO pode ser igualada por algo que so o dono decide (conflito, codigo que nao
    # compila, arquivo no caminho). Sem isso, um "behind" visto depois e so o origin que andou: mecanico.
    # head/base: se um dos dois mudou depois, este resultado esta velho e o portao manda rodar de novo.
    tips = {"head": git("rev-parse", "HEAD"), "base": git("rev-parse", base)}
    return {"at": now(), "commits": commits, "published": published, "pending": pend,
            "blocked": tips["head"] != tips["base"], **tips}


def cmd_final_sync_main(a):
    st = load()
    require_final(st)
    res = sync_main(st, a.fresh_min)
    save_final(st, "sync", res)
    s = main_tree_state(st["base"])
    print(f"arvore principal: ahead {s['ahead']}, behind {s['behind']}, {len(s['real'])} arquivo(s) real(is) "
          f"modificado(s), {s['generated']} gerado(s) de build (ficam)")
    for x in res["pending"]:
        print("PENDENCIA DO DONO: " + x)
    sys.exit(7 if res["pending"] else 0)


def needs_deploy(st: dict) -> bool:
    """O dist so e tocado pela etapa de teste (`deploy`, com o slot). Projeto sem deploy: nunca."""
    return bool(DEPLOY_CFG) and any(b.get("test_round") for b in st["bugs"].values())


def cmd_final_deploy(a):
    """Build + deploy do fluxo principal integrado no dist, de uma lane; MD5 do que ficou vai para o ledger.
    Projeto sem `deploy` no projeto.json: nada a fazer (sai 0; o C3 do portao nao se aplica)."""
    st = load()
    require_final(st)
    if not DEPLOY_CFG:
        print("projeto sem `deploy` no projeto.json: nada a deployar (o C3 do portao nao se aplica)")
        return
    busy = foreign_processes()
    if busy:
        for p in busy:
            print(f"OCUPADO: {p.get('ProcessName')} pid={p.get('Id')} {p.get('Path') or ''}")
        sys.exit(11)
    lane = final_lane(st)
    checkout_fresh(lane, st["base"], None)
    sha = git("rev-parse", "HEAD", cwd=lane)
    project_cmd(lane, "deploy")
    files = {name: md5_of(DIST_ES / name) for name in DEPLOYED}
    bad = [name for name, rel in DEPLOYED.items() if not files[name] or files[name] != md5_of(lane / rel)]
    if bad:
        die(f"o deploy saiu 0 mas {DIST_ES} NAO tem o artefato do build da lane: {bad}", 3)
    save_final(st, "deploy", {"sha": sha, "at": now(), "lane": lane.name, "files": files})
    print(f"dist com o fluxo principal {sha[:10]}: " + ", ".join(f"{n} md5 {m[:8]}" for n, m in files.items()))


def briefing_path(st: dict) -> Path:
    return PIPE / "runs" / f"{st['run_id']}-briefing.md"


def final_report(st: dict) -> list[tuple[str, str, str]]:
    """LEITURA: o estado ao fim da execucao contra C1-C5 (bug
    pipeline-finalizacao-nao-entrega-estado-organizado-..._2026-10-02). Cada item e (criterio, tipo,
    texto); tipo `ok`, `mecanico` (a finalizacao resolve: o portao recusa) ou `dono` (decisao dele)."""
    out, base, fin = [], st["base"], st["final"]
    add = lambda c, kind, msg: out.append((c, kind, msg))
    git("fetch", REMOTO, check=False)
    is_anc = lambda a_, b_: run(["git", "merge-base", "--is-ancestor", a_, b_], cwd=SRC, check=False).returncode == 0
    brief = briefing_path(st)
    text = brief.read_text(encoding="utf-8", errors="replace") if brief.exists() else ""

    # C1: tudo no origin; nenhum branch de bug sobrando; -wip e stash so listados
    n = len(out)
    for s, b in st["bugs"].items():
        if b["state"] == "retest" and not (b.get("commit") and is_anc(b["commit"], base)):
            add("C1", "mecanico", f"{s}: commit {(b.get('commit') or '?')[:10]} nao esta em {base}")
    have = git("branch", "--list", "bugfix/*", "--format=%(refname:short)").split()
    stashes = git("log", "-g", "--format=%gs", "refs/stash", check=False)   # = `stash list`, que a trava recusa aqui
    for s, b in st["bugs"].items():
        for br in (b["branch"], b["branch"] + "-docs"):
            if br in have:
                add("C1", "mecanico", f"branch {br} sobrou (rode `cleanup`)")
        keep = [br for br in have if br.startswith(b["branch"] + "-wip")]
        keep += [f"pipeline-sobra {s}"] if f"pipeline-sobra {s}" in stashes else []
        for k in keep:
            if k not in text:
                add("C1", "mecanico", f"'{k}' foi mantido de proposito e tem que estar citado no briefing, com o motivo")
    if len(out) == n:
        add("C1", "ok", f"commits da execucao em {base}; nenhum branch de bug sobrando")

    # C2: arvore principal igual ao origin
    s, sync = main_tree_state(base), fin.get("sync")
    diverged = bool(s["ahead"] or s["behind"])
    fresh_sync = bool(sync) and (sync.get("head"), sync.get("base")) == (git("rev-parse", "HEAD"), git("rev-parse", base))
    main_kind = "dono" if fresh_sync and sync.get("blocked") else "mecanico"
    if (diverged or s["real"]) and not fresh_sync:
        add("C2", "mecanico", f"arvore principal ahead {s['ahead']}, behind {s['behind']}, {len(s['real'])} arquivo(s) "
                              f"nao commitado(s): rode `final-sync-main`{' de novo (algo mudou depois do ultimo)' if sync else ''}")
    elif diverged or s["real"]:
        for x in sync["pending"]:
            add("C2", "dono", x)
        add("C2", "dono", f"arvore principal ahead {s['ahead']}, behind {s['behind']}; nao commitado(s): "
                          f"{', '.join(s['real'][:10]) or 'nenhum'}" + ("" if diverged else f" — no mais, igual a {base}"))
    else:
        add("C2", "ok", f"arvore principal = {base} ({git('rev-parse', '--short', 'HEAD')}); "
                        f"{s['generated']} gerado(s) de build modificado(s), que nao sao da execucao")

    # C3: o dist roda o codigo integrado
    dep = fin.get("deploy")
    if not DEPLOY_CFG:
        add("C3", "ok", "projeto sem `deploy` no projeto.json: nao ha instalado a conferir")
    elif not needs_deploy(st):
        add("C3", "ok", "nenhum bug chegou a etapa de teste: a execucao nao tocou o dist")
    elif not dep:
        add("C3", "mecanico", "dist sem deploy final (rode `final-deploy`)")
    else:
        n = len(out)
        for slug, b in st["bugs"].items():
            if b["state"] == "retest" and b.get("commit") and not is_anc(b["commit"], dep["sha"]):
                add("C3", "mecanico", f"o deploy final ({dep['sha'][:10]}) nao contem o fix de {slug} (rode `final-deploy`)")
        moved = [f for f in git("diff", "--name-only", dep["sha"], base, check=False).splitlines() if not f.startswith("docs/")]
        if moved:
            add("C3", "mecanico", f"o origin andou com codigo depois do deploy final ({moved[:5]}): rode `final-deploy` de novo")
        for name, md5 in dep["files"].items():
            if md5_of(DIST_ES / name) != md5:
                add("C3", "mecanico", f"{name} no dist mudou depois do deploy final (rode `final-deploy` de novo)")
        if len(out) == n:
            add("C3", "ok", f"dist = build de {dep['sha'][:10]} ({dep['at']}): " +
                ", ".join(f"{k} md5 {v[:8]}" for k, v in dep["files"].items()))

    # C4: doc na pasta do estado (origin e arvore principal); links do briefing resolvem. Doc que outra sessao
    # moveu ADIANTE no ciclo (open -> retest -> done) vale, com nota; para tras nao (retest com doc em open/ e
    # trabalho do `final-docs`). Sem isso a finalizacao so passava editando o state.json a mao
    # ([[pipeline-portao-c4-recusa-doc-documentado-movido-por-outra-sessao-finalizacao-edita-ledger_2026-10-08]]).
    n = len(out)
    cycle = ("open", "retest", "done")
    exists = lambda p: run(["git", "cat-file", "-e", f"{base}:{p}"], cwd=SRC, check=False).returncode == 0
    for slug, b in st["bugs"].items():
        # task (item ou a do bug): sem pasta; aprovada = o campo `concluida` no fluxo principal (DESIGN 22.9, decisao 11)
        tp = task_of(b) if TAREFAS else None
        if tp and b["state"] == "retest":
            shown = run(["git", "show", f"{base}:{tp}"], cwd=SRC, check=False)
            if shown.returncode or task_status(shown.stdout) != TAREFAS["concluida"]:
                add("C4", "mecanico", f"{slug} (retest): a task {tp} nao esta `{TAREFAS['concluida']}` em {base}")
        want = "retest" if b["state"] == "retest" else "open"
        doc = stage_path(b["doc"], want)
        found = next((p for p in (stage_path(b["doc"], f) for f in cycle[cycle.index(want):]) if exists(p)), None)
        if found and found != doc:
            add("C4", "ok", f"{slug} ({b['state']}): doc movido por fora do pipeline para {found}")
        if not found:
            add("C4", "mecanico", f"{slug} ({b['state']}): {doc} nao existe em {base}")
        elif not (SRC / found).exists():
            add("C4", main_kind, f"{slug}: {found} nao existe na arvore principal (ela nao esta igual ao origin)")
        if text and slug not in text:
            add("C4", "mecanico", f"o briefing nao cita o bug {slug}")
    if not text:
        add("C4", "mecanico", f"briefing nao encontrado: {brief}")
    for link in re.findall(r"\]\(<?([^)>#\s]+)", text):
        if not re.match(r"[a-z][a-z0-9+.-]*:", link, re.I) and not (brief.parent / link).exists():
            add("C4", "mecanico", f"link morto no briefing: {link}")
    if all(k == "ok" for _, k, _ in out[n:]):   # a nota de doc movido e `ok`: nao suprime o ok geral
        add("C4", "ok", "docs na pasta do estado; links do briefing resolvem na arvore principal")

    # C5: sem residuo
    n = len(out)
    key = lambda p: os.path.normcase(os.path.normpath(str(p)))
    wts = key(WTS)
    for l in git("worktree", "list", "--porcelain").splitlines():
        if l.startswith("worktree ") and key(l[9:]).startswith(wts + os.sep):
            add("C5", "mecanico", f"worktree {l[9:]} ainda registrada (rode `cleanup`)")
    live = agents()
    for d in sorted(WTS.iterdir()) if WTS.exists() else []:
        if not (d / ".git").exists():
            held = [f"{x.get('name')} ({x['sessionId'][:8]}, {x.get('kind', '?')})" for x in lane_sessions(d, live)]
            n_items = sum(1 for _ in d.iterdir()) if d.is_dir() else 1
            add("C5", "dono", f"{d} ficou ({n_items} item(ns)): " + (f"presa pela(s) sessao(oes) {held}" if held else
                "conteudo que o pipeline nao criou nesta execucao, ou pasta presa por processo que nao e sessao claude"))
    mine = (fin.get("session") or {}).get("id")
    alive = {x.get("sessionId"): x for x in live if x.get("status") is not None}
    for slug, b in st["bugs"].items():
        for stage, rec in b["sessions"].items():
            if rec and rec.get("id") in alive and rec["id"] != mine:
                add("C5", "mecanico", f"sessao {rec.get('name')} ({rec['id'][:8]}) ainda viva "
                                      f"({alive[rec['id']].get('status')}): rode `cleanup` (ou espere ela terminar o turno)")
    if len(out) == n:
        add("C5", "ok", "nenhuma lane, worktree ou sessao de etapa da execucao sobrando")
    return out


BLOCK = ("<!-- helper:estado -->", "<!-- /helper:estado -->")


def write_briefing_block(st: dict, items: list) -> None:
    """C6: o que o HELPER mediu vai para o briefing por ele mesmo (erro/AVISO nao dependem de a sessao copiar)."""
    brief = briefing_path(st)
    text = brief.read_text(encoding="utf-8", errors="replace") if brief.exists() else ""
    dono = [m for _, k, m in items if k == "dono"]
    body = [BLOCK[0], "## Estado verificado pelo helper", "",
            f"Medido em {now()} por `pipeline.py final-done` (nao e texto da sessao).", "",
            "| Criterio | Resultado | O que foi medido |", "|---|---|---|",
            *[f"| {c} | {'OK' if k == 'ok' else 'PENDENCIA DO DONO' if k == 'dono' else 'FALTA'} | {m.replace('|', '/')} |"
              for c, k, m in items], "",
            "**Pendencias do dono (so decisao; nada mecanico):** " + ("nenhuma." if not dono else ""),
            *[f"- {m}" for m in dono], BLOCK[1]]
    block = "\n".join(body)
    if BLOCK[0] in text and BLOCK[1] in text:
        text = text[:text.index(BLOCK[0])] + block + text[text.index(BLOCK[1]) + len(BLOCK[1]):]
    else:
        text = text.rstrip("\n") + "\n\n" + block + "\n"
    brief.parent.mkdir(parents=True, exist_ok=True)
    brief.write_text(text, encoding="utf-8")


def print_report(items: list):
    for c, k, m in items:
        print(f"[{ {'ok': 'OK', 'dono': 'DONO', 'mecanico': 'FALTA'}[k]:<5}] {c}: {m}")


def cmd_final_check(a):
    """So leitura: o que o portao do `final-done` vai ver. Sai 2 se falta algo que a finalizacao resolve."""
    items = final_report(load())
    print_report(items)
    sys.exit(2 if any(k == "mecanico" for _, k, _ in items) else 0)


def launch_detached(args: list[str]):
    """`python pipeline.py <args>` destacado, com stdio DEVNULL. Sobrevive ao `claude stop` da sessao
    `--bg` que o abriu, com e sem breakaway (Fase 0 do rodizio, item 11)."""
    flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    cmd, kw = [sys.executable, str(SCRIPT), *args], dict(
        cwd=ROOT, env=clean_env(), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:                                           # fora do job da sessao, se o job deixar
        subprocess.Popen(cmd, creationflags=flags | subprocess.CREATE_BREAKAWAY_FROM_JOB, **kw)
    except OSError:
        subprocess.Popen(cmd, creationflags=flags, **kw)


def schedule_stop_final():
    """A sessao da finalizacao e quem chama o `final-done`: nao pode ser parada daqui (mataria este
    processo). Um processo destacado espera ela ficar ociosa e a encerra (`stop-final`)."""
    launch_detached(["stop-final"])


def cmd_stop_final(a):
    """Encerra a sessao da finalizacao (e copias abertas por resume: mesmo nome ou id impresso) quando
    ela fica ociosa. Nunca para sessao trabalhando nem interativa."""
    st = load()
    rec = st["final"].get("session") or {}
    name = f"pipeline-finalizacao-{st['run_id']}"
    ids = {i for i in (bg_id(rec.get("cli_output")), (rec.get("id") or "")[:8]) if i}
    deadline, stopped = time.time() + a.wait * 60, []
    while True:
        live = agents()
        mine = [x for x in live if x.get("status") is not None and x.get("sessionId")
                and x["sessionId"][:8] not in stopped      # ja parada aqui: o gerenciador demora a refletir
                and x.get("kind") != "interactive" and (x.get("name") == name or x["sessionId"][:8] in ids)]
        for x in [x for x in mine if x.get("status") in RESUMABLE]:
            run([claude_exe(), "stop", job_id(x["sessionId"], live)], cwd=ROOT, check=False)
            stopped.append(x["sessionId"][:8])
        if all(x.get("status") in RESUMABLE for x in mine) or time.time() > deadline:
            break
        time.sleep(a.interval)
    if stopped:
        with file_lock("state"):
            st = load()
            if st["final"].get("session"):
                st["final"]["session"]["stopped"] = now()
                save(st)
    print(f"sessao(oes) da finalizacao encerrada(s): {stopped or 'nenhuma viva'}")


# --------------------------------------------------------------------------- vigia de cota (rodizio)
# Secao 6.5 e F6 de docs/backlog/rodizio-automatico-de-contas-no-pipeline.md. Um so por maquina (lock
# "quota-watch"), destacado, acompanhando o state.json ATUAL (nao pertence a uma execucao, R12). Passos
# 1-4 (saida, integridade, deteccao, atribuicao, giro; F6a) e 5 (retomada e entrega das pendencias; F6b).

def run_open(st: dict) -> bool:
    """A execucao do ledger nao terminou: algum bug fora de TERMINAL, ou a finalizacao rodando."""
    return any(b["state"] not in TERMINAL for b in st["bugs"].values()) or st["final"]["state"] == "rodando"


def peek_state() -> dict | None:
    """O state.json SEM lock e sem die (o vigia nunca chama `load` sem saber que o arquivo existe, R20).
    None so se ele NAO existe; ilegivel agora (o replace de quem grava, N3) levanta, e a passada repete."""
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def watch_alive() -> bool:
    """Ha vigia vivo? Pelo lock, nunca pelo PID: o SO solta o lock de quem morreu (N3, H12)."""
    h = try_lock("quota-watch")
    if h is None:
        return True
    unlock(h)
    return False


def schedule_quota_watch(origin: str) -> bool:
    """Abre o vigia destacado, so com o rodizio ligado (R18) e sem vigia vivo. Quem chama JA gravou o
    state.json (a saida do vigia o rele, R12). Dois chamadores juntos podem abrir dois: o segundo nao
    pega o lock e sai. Nunca `die`: roda no meio de transicao. Devolve se abriu."""
    try:
        if not rotation_on(accounts_load()):
            return False
    except SystemExit:
        return False
    if watch_alive():
        return False
    launch_detached(["quota-watch", "--origem", origin])
    return True


def current_recs(st: dict) -> list[tuple]:
    """(slug, etapa, rec) das sessoes das etapas ATUAIS, na ordem do ledger: bug fora de TERMINAL na etapa
    de STAGE_OF, depois a finalizacao rodando (slug None). So `rec` com id."""
    out = []
    for slug, b in sorted(st["bugs"].items(), key=lambda kv: kv[1].get("order", 0)):
        stage = STAGE_OF.get(b["state"]) if b["state"] not in TERMINAL else None
        rec = b["sessions"].get(stage) if stage else None
        if rec and rec.get("id"):
            out.append((slug, stage, rec))
    rec = st["final"].get("session")
    if st["final"]["state"] == "rodando" and rec and rec.get("id"):
        out.append((None, "finalizacao", rec))
    return out


def limited_sessions(st: dict) -> list[dict]:
    """Passo 2 do vigia: sessoes das etapas atuais PARADAS (status None ou RESUMABLE, como no `tick`) com
    hit de cota posterior a ultima entrega (`session_hit`, R13/R23). Busy ou status desconhecido (talvez
    esperando permissao) nao entra. [{"slug", "stage", "rec", "hit"}], na ordem do ledger."""
    recs = current_recs(st)
    if not recs:
        return []
    status = {x.get("sessionId"): x.get("status") for x in agents()}
    out = []
    for slug, stage, rec in recs:
        sst = status.get(rec["id"])
        if sst is not None and sst not in RESUMABLE:
            continue
        hit = session_hit(rec)
        if hit["kind"]:
            out.append({"slug": slug, "stage": stage, "rec": rec, "hit": hit})
    return out


def quota_log_path(run_id: str | None) -> Path:
    return PIPE / "runs" / f"{run_id or 'sem-execucao'}-cota.log"


class QuotaLog:
    """stdout/stderr do vigia durante a passada: cada linha vai, mascarada e com hora, ao log de cota da
    execucao CORRENTE (`path` muda com o run_id, R12) e ao terminal (DEVNULL no vigia destacado). Os avisos
    de attribute/rotate/ensure_active/restore_login saem por `print` e so chegam ao log por aqui."""

    def __init__(self, path: Path, echo):
        self.path, self.echo, self.buf = path, echo, ""

    def write(self, s: str) -> int:
        self.buf += s
        while "\n" in self.buf:
            text, self.buf = self.buf.split("\n", 1)
            self.line(text)
        return len(s)

    def flush(self):
        if self.buf:
            text, self.buf = self.buf, ""
            self.line(text)

    def line(self, text: str):
        text = mask(text)
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(f"{now()} {text}\n")
        except OSError:
            pass
        try:
            self.echo.write(text + "\n")
        except (OSError, ValueError, AttributeError):
            pass


# Secao 6.6: nao afirma que a conta foi trocada (R22); em residuo, incerto, conhecido, atrasado e auth a
# sessao pode voltar na MESMA conta. Entra pela fila, fundida a pendencia da etapa (queue_pending).
QUOTA_MSG = (
    "RETOMADA APOS LIMITE DE USO: esta sessao parou por limite de uso (ou erro de credencial) da\n"
    "conta Claude e foi retomada, talvez em outra conta.\n"
    "Comandos em segundo plano que voce tinha aberto (build, deploy, bateria de teste, ES)\n"
    "MORRERAM com o processo. Antes de seguir: confira onde parou (doc do bug, `git status` e\n"
    "`git log` da sua worktree; `env-wait` do helper se estava no E2E) e refaca o que estava\n"
    "rodando. Depois continue o roteiro da sua etapa normalmente.")
WHY_RESUME = "retomada apos limite"


def stage_rec(st: dict, slug: str | None, stage: str) -> dict | None:
    """O `rec` da etapa no ledger `st` (finalizacao: slug None), ou None."""
    if slug is None:
        return st["final"].get("session")
    return ((st["bugs"].get(slug) or {}).get("sessions") or {}).get(stage)


def count_hit_once(st: dict, slug: str | None, stage: str, case: str, hit: dict) -> str | None:
    """`count_hit` UMA vez por hit: uma retomada que falhou (CLI, Busy) nao muda `sent_ts`, e a passada
    seguinte ve o mesmo hit. Sem a guarda, 3 falhas do CLI dariam "precisa do dono" a uma sessao que
    bateu uma vez so. `quota_hit_seen[stage]` = ts do ultimo hit contado da etapa."""
    box = bug_of(st, slug) if slug else st["final"]
    seen = box.setdefault("quota_hit_seen", {})
    if seen.get(stage) == hit["ts"]:
        return needs_owner(st, slug, stage)
    seen[stage] = hit["ts"]
    return count_hit(st, slug, stage, case, hit["kind"])


def watch_resume(w: dict, t: float):
    """Passo 5 do vigia (secao 6.5), so com o portao aberto: retoma as sessoes paradas por cota (`w["hits"]`
    menos `ignorar`) e entrega as pendencias, cada alvo UMA vez por passada (R19), com um file_lock("state")
    POR ALVO (H22). Hit revalidado depois do lock (R2): a etapa, a sessao (mesmo id) e o hit (mesmo ts,
    posterior a ultima entrega) tem de ser os da coleta. Tudo pela fila (R3)."""
    if not account_for_spawn(accounts_load(), t)[0]:
        return
    st = peek_state()
    if st is None:
        return
    rank = {slug: b.get("order", 0) for slug, b in st["bugs"].items()}
    found = {(h["slug"], h["stage"]): h for h in w["hits"] if h.get("case") and h["case"] != "ignorar"}
    keys = dict.fromkeys([*found, *((e["slug"], e["stage"]) for e in st.get("pending_spawns", []))])
    for slug, stage in sorted(keys, key=lambda k: (k[0] is None, rank.get(k[0], 0))):
        h, who = found.get((slug, stage)), f"{slug or 'finalizacao'}/{stage}"
        with file_lock("state"):                 # UM lock por alvo: uma transicao entra entre dois (R19)
            cur = load()
            if h:
                rec = stage_rec(cur, slug, stage)
                now_hit = session_hit(rec) if rec and rec.get("id") == h["rec"].get("id") else {"kind": None}
                if (not pending_is_current(cur, {"slug": slug, "stage": stage})
                        or (now_hit["kind"], now_hit.get("ts")) != (h["hit"]["kind"], h["hit"]["ts"])):
                    print(f"{who}: candidato obsoleto (etapa, sessao ou hit mudou desde a coleta); sem retomada")
                else:
                    why = count_hit_once(cur, slug, stage, h["case"], h["hit"])
                    if why:
                        print(f"{who}: PRECISA DO DONO ({why}); sem retomada")
                    else:
                        queue_pending(cur, slug, stage, QUOTA_MSG, WHY_RESUME)
            for n in deliver_pending(cur, NOBODY, report=False, only=(slug, stage)):
                print(f"{who}: {n}")
            save(cur)


def clear_answered(st: dict):
    """Passo 5, antes da retomada: `auth_hits`/`uncertain_hits` da etapa voltam a 0 quando a sessao RESPONDEU
    depois da ultima entrega (R21: o teto e de hits SEGUIDOS). Antes, e nao depois: resposta e hit novo na
    mesma passada contariam o hit sobre a sequencia ja quebrada. Le o `st` da passada; lock so se ha o que zerar."""
    def boxes(s):
        for slug, stage, rec in current_recs(s):
            box = bug_of(s, slug) if slug else s["final"]
            if any(box.get(k, {}).get(stage) for k in ("auth_hits", "uncertain_hits")):
                yield slug, stage, rec, box
    if not any(answered_since(rec.get("id"), rec.get("sent_ts") or 0) for _, _, rec, _ in boxes(st)):
        return
    with file_lock("state"):
        cur, done = load(), []
        for slug, stage, rec, box in list(boxes(cur)):
            if answered_since(rec.get("id"), rec.get("sent_ts") or 0):
                for k in ("auth_hits", "uncertain_hits"):
                    box.get(k, {}).pop(stage, None)
                done.append(f"{slug or 'finalizacao'}/{stage}")
        if done:
            save(cur)
            print(f"sessao respondeu: contadores de hits zerados em {', '.join(done)}")


# Modo acordar e "sem credencial" (secao 6.5.1, F7). A tarefa avulsa do Agendador (item 2) espera o item 8
# da secao 5.2: sem ela, quem religa um vigia morto e o `reconcile --fix` (item 6).

def earliest_account(acc: dict) -> str | None:
    """A conta valida de MENOR exhausted_until (a que volta primeiro); no empate, a ativa (sem gravacao) e
    depois a ordem de `order`. Nenhuma valida: None."""
    accs, active, order = acc["accounts"], acc.get("active"), acc.get("order") or []
    valid = [x for x in order if accs.get(x) and not accs[x].get("invalid")]
    return min(valid, key=lambda x: (accs[x].get("exhausted_until") or 0, x != active, order.index(x)), default=None)


def watch_sanity(back: str, t: float):
    """Fora dos locks, depois de uma devolucao do vigia: a sanidade do /login. `auth` (o par guardado
    morreu, S54) fica em `login_dead`, que o `status` mostra: o vigia roda sem terminal."""
    if back == "devolvido" and restore_sanity() == "auth":
        with file_lock("accounts"):
            acc = accounts_load()
            acc["login_dead"] = t
            accounts_save(acc)


def watch_wake(t: float):
    """Passo 4, ENTRADA no modo acordar (6.5.1, item 1): nenhuma conta valida com saldo. `wake_at` = menor
    reset + RESET_SLACK, e o arquivo ja passa para a conta desse reset: quando o relogio passar dele, o
    portao abre sozinho e qualquer transicao entrega sem esperar o vigia. Idempotente: com `wake_at` igual
    e a conta ja ativa, nao grava nem loga. Troca que falhou e tentada de novo na passada seguinte."""
    with file_lock("state"), file_lock("accounts"):
        acc = accounts_load()
        nxt, first = pick_account(acc, t)
        if not account_for_spawn(acc, t)[1] or nxt or not first:
            return                               # mudou desde a leitura sem lock: a passada seguinte decide
        before, x, prev = json.dumps(acc, sort_keys=True), earliest_account(acc), acc.get("active")
        wake, moved = first + RESET_SLACK, acc.get("wake_at") != first + RESET_SLACK
        acc["wake_at"] = wake
        if x != prev:
            err, _ = apply_account(acc, x, t)
            if err:
                print(f"AVISO: modo acordar: troca de {prev or '-'} para {x} falhou ({err}); a ativa continua {prev or '-'}")
            else:
                acc.update(active=x, switched_at=t)
                print(f"rodizio: conta ativa {prev or '-'} -> {x} (a primeira a voltar)")
        if json.dumps(acc, sort_keys=True) != before:
            accounts_save(acc)
    if moved:
        print(f"todas as contas esgotadas; acordo as {when(wake)} com a conta {x}")


def watch_nocred(t: float):
    """Passo 4, SEM CREDENCIAL (6.5.1, item 8): todas as contas invalidas. Nao ha reset a esperar
    (`wake_at` nulo) e o /login volta ao arquivo: o token de uma conta invalida quebraria tambem as
    sessoes do dono. A ativa invalida nao e regravada pela integridade (`ensure_active`)."""
    with file_lock("state"), file_lock("accounts"):
        acc = accounts_load()
        if pick_account(acc, t) != (None, None):
            return
        before = json.dumps(acc, sort_keys=True)
        acc["wake_at"] = None
        back = restore_login(acc, t, "vigia de cota: todas as contas invalidas")
        if json.dumps(acc, sort_keys=True) != before:
            accounts_save(acc)
    watch_sanity(back, t)


def watch_pass(w: dict) -> bool:
    """UMA passada do vigia (secao 6.5, passos 1-5). `w`: estado entre passadas (`h` = handle do lock,
    `run_id`, `log`, `origin`, `note`, `hits`). Devolve False quando o vigia deve sair. Nada aqui chama
    `load` sem o state.json existir, e a saida e por `return`: quem chama captura BaseException (R20)."""
    t = time.time()
    st = peek_state()
    # 1. sem execucao ativa com rodizio ligado: devolve o /login e sai, sem janela para uma execucao nova
    if st is None or not run_open(st) or not rotation_on(accounts_load()):
        why = "sem execucao" if st is None else "fim da execucao" if not run_open(st) else "rodizio desligado"
        with file_lock("state"), file_lock("accounts"):
            acc = accounts_load()
            before = json.dumps(acc, sort_keys=True)
            back = restore_login(acc, t, f"vigia de cota: {why}")
            acc["wake_at"] = None                # sem execucao, nao ha o que acordar (S16)
            if json.dumps(acc, sort_keys=True) != before:
                accounts_save(acc)
        watch_sanity(back, t)
        print(f"vigia saindo ({why}); devolucao do /login: {back}")
        unlock(w["h"])
        w["h"] = None
        st = peek_state()                        # quem abre execucao grava o state.json ANTES de schedule_quota_watch
        if st is None or not run_open(st) or not rotation_on(accounts_load()):
            return False
        w["h"] = try_lock("quota-watch")
        if w["h"] is None:
            print(f"execucao {st['run_id']} aberta durante a saida; outro vigia ja a acompanha")
            return False
        print(f"execucao {st['run_id']} aberta durante a saida: o vigia continua")
    if st["run_id"] != w.get("run_id"):          # subiu agora, ou execucao nova (R12): log e st.quota passam para ela
        old, w["run_id"] = w.get("run_id"), st["run_id"]
        w["log"].path = quota_log_path(st["run_id"])
        print(f"execucao nova: {old} -> {st['run_id']}" if old else
              f"vigia de cota subiu (origem={w['origin']}, pid {os.getpid()}) na execucao {st['run_id']}")
        with file_lock("state"):
            cur = load()
            cur["quota"] = {**(cur.get("quota") or {}), "watch_pid": os.getpid(), "origin": w["origin"],
                            "log": w["log"].path.relative_to(PIPE).as_posix()}
            save(cur)
    with file_lock("state"), file_lock("accounts"):   # integridade do arquivo de credenciais (B2)
        acc = accounts_load()
        before = json.dumps(acc, sort_keys=True)
        r = ensure_active(acc, t)
        acc["armed"] = None                      # o vigia acompanha uma execucao aberta: o activate foi consumido
        if json.dumps(acc, sort_keys=True) != before:
            accounts_save(acc)
    if isinstance(r, tuple):
        print(f"conferencia do arquivo de credenciais falhou: {r[1]}")
    elif r == "regravado":
        print(f"arquivo de credenciais na conta ativa {acc.get('active')}")
    # 2. sessoes paradas por cota; 3. UMA validacao por conta com hit auth (R21), fora de lock
    hits, vals, tried = limited_sessions(st), {}, set()
    for h in hits:
        x = h["rec"].get("account") or acc.get("active")
        if h["hit"]["kind"] != "auth" or h["rec"].get("account_uncertain") or x not in acc["accounts"] or x in tried:
            continue
        tried.add(x)
        try:
            vals[x] = validate_account(x)
            print(f"validacao da conta {x}: {vals[x][0]} ({vals[x][2] or 'sem saida'})")
        except SystemExit:
            print(f"validacao da conta {x} impossivel (.token ausente ou nao decifra)")
    if hits or any((e.get("late_retries") or 0) > 0 for e in acc["accounts"].values()):
        with file_lock("state"), file_lock("accounts"):
            acc, ctx = accounts_load(), {"vals": vals}
            for h in hits:
                h["case"] = attribute(acc, h["rec"], h["hit"], t, ctx)
                print(f"{h['slug'] or 'finalizacao'}/{h['stage']}: sessao {h['rec'].get('name')} parada "
                      f"({h['hit']['kind']}): caso {h['case']}")
            for x in late_answered(acc, [r_ for _, _, r_ in current_recs(st)]):
                print(f"conta {x} respondeu depois do reset: tentativas recusadas zeradas")
            accounts_save(acc)
    w["hits"] = hits                             # o passo 5 (retomada) parte destes
    # 4. portao fechado: gira para uma disponivel, mesmo sem hit (R10); sem nenhuma, modo acordar ou sem
    # credencial (6.5.1). Portao aberto com wake_at gravado: o despertar
    acc, note = accounts_load(), None
    if account_for_spawn(acc, t)[1]:
        nxt, wake = pick_account(acc, t)
        if nxt:
            with file_lock("state"), file_lock("accounts"):
                acc = accounts_load()
                waiting = acc.get("wake_at")
                if account_for_spawn(acc, t)[1] and rotate(acc, t) and waiting:
                    print(f"modo acordar encerrado antes da hora: conta {acc['active']} disponivel (item 9)")
                accounts_save(acc)
        elif wake:
            watch_wake(t)
        else:
            watch_nocred(t)
            note = "todas as contas invalidas: precisa do dono (`accounts add --label X` com token novo)"
    elif acc.get("wake_at"):
        with file_lock("state"), file_lock("accounts"):
            acc = accounts_load()
            if acc.get("wake_at") and account_for_spawn(acc, t)[0]:
                print(f"acordei: a conta {acc['active']} voltou (wake_at era {when(acc['wake_at'])}); retomando")
                acc["wake_at"] = None
                accounts_save(acc)
    if note and note != w.get("note"):           # uma vez, nao a cada passada
        print(note)
    w["note"] = note
    w["wake"] = accounts_load().get("wake_at")    # o sono termina em wake_at (6.5.1, item 3)
    # 5. contadores de hits de quem respondeu (ANTES de contar o hit novo: a resposta quebra a sequencia),
    # depois a retomada e a entrega das pendencias (portao aberto)
    clear_answered(st)
    watch_resume(w, t)
    return True


def cmd_quota_watch(a):
    """O vigia de cota (secao 6.5), aberto destacado por schedule_quota_watch. Uma passada a cada
    --interval s, ate nao haver execucao ativa com rodizio ligado. Erro numa passada (inclusive o
    SystemExit de um die) vai ao log e a st.quota.last_error, e o laco segue (N2). Projeto sem rodizio:
    sai na hora (o passo 1 devolveria o /login de uma execucao de outro projeto, DESIGN 22.6)."""
    if not rotation_owner():
        print("rodizio de contas desligado neste projeto (projeto.json): sem vigia de cota")
        return
    h = try_lock("quota-watch")
    if h is None:
        print("ja ha um vigia de cota rodando")
        return
    log = QuotaLog(quota_log_path(None), sys.stdout)
    w = {"h": h, "run_id": None, "log": log, "origin": a.origem, "note": None, "hits": [], "wake": None}
    try:
        while True:
            try:
                with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
                    go = watch_pass(w)
            except KeyboardInterrupt:
                raise
            except BaseException as e:
                go, msg = True, mask(f"{type(e).__name__}: {e}")
                log.flush()
                log.line(f"ERRO na passada: {msg}")
                try:
                    with contextlib.redirect_stderr(log), file_lock("state", timeout=30):
                        cur = load()
                        cur.setdefault("quota", {})["last_error"] = f"{now()} {msg}"
                        save(cur)
                except BaseException:
                    pass
            log.flush()
            if not go or a.once:
                return
            end = time.time() + a.interval
            if w.get("wake") and w["wake"] > time.time():
                end = min(end, w["wake"])        # modo acordar: a passada seguinte e a do despertar
            while time.time() < end:             # passos de ate 60 s pelo relogio de parede (PC suspenso, 6.5.1)
                time.sleep(min(60.0, max(0.0, end - time.time())))
    finally:
        if w["h"] is not None:
            unlock(w["h"])


def cmd_final_done(a):
    """PORTAO do fim da execucao: so fecha com C1-C5 medidos. Falta mecanica -> recusa (saida 2)."""
    with file_lock("state"):
        st = load()
        left = [n for n, wt in st["worktrees"].items() if (Path(wt["path"]) / ".git").exists()]
        if left:
            die(f"rode `cleanup` antes: worktrees ainda existem: {left}", 2)
        items = final_report(st)
        print_report(items)
        if any(k == "mecanico" for _, k, _ in items):
            die("final-done recusado: ha item [FALTA] acima, que e trabalho da finalizacao (nao do dono). "
                "Resolva e rode de novo.", 2)
        write_briefing_block(st, items)
        dono = [m for _, k, m in items if k == "dono"]
        st["final"]["state"] = "concluido-com-pendencias" if dono else "concluido"
        st["final"]["note"], st["final"]["pendencias"] = a.note, dono
        save(st)
    print(f"finalizacao: {st['final']['state']}. Termine o turno: esta sessao sera encerrada quando ficar ociosa.")
    schedule_stop_final()


def session_status(rec: dict | None, live: list[dict]) -> str:
    if not rec or not rec.get("id"):
        return "-"
    hits = [x for x in live if x.get("sessionId") == rec["id"]]
    return hits[0].get("status", "?") if hits else "encerrada"


def cmd_status(a):
    if not STATE.exists():                       # antes do primeiro `init`: as contas ainda contam (inclusive "armado")
        print("sem execucao: .bugfix-pipeline/state.json nao existe (o `init` cria)")
        for line in quota_status(None):
            print(line)
        return
    st = load()
    live = agents()
    print(f"execucao {st['run_id']}  fluxo principal {st['base']}  ondas: {len(st['waves'])}  "
          f"slot de teste: {st['test_slot'] or 'livre'}  fila: {st['test_queue'] or '-'}")
    for s, b in sorted(st["bugs"].items(), key=lambda kv: kv[1]["order"]):
        stage = STAGE_OF.get(b["state"])
        rec = b["sessions"].get(stage) if stage else None
        p = b["plan"] or {}
        print(f"  {b['order']:>2} {b['state']:<18} onda {b['wave'] or '-'} dev<-{b['returns']} "
              f"{p.get('complexity', '?'):<6} {s[:58]:<58} {(rec or {}).get('name', '')} {session_status(rec, live) if rec else ''}")
    print(f"\nfinalizacao: {st['final']['state']}")
    for x in st["final"].get("pendencias", []):
        print("PENDENCIA DO DONO: " + x)
    for e in st.get("pending_spawns", []):
        print(f"MENSAGEM PENDENTE: {e['slug'] or 'pipeline'}/{e['stage']} desde {e['ts']} ({e['why']})")
    if st.get("elencar_erro"):
        print(f"ETAPA 2 TRAVADA: {st['elencar_erro']}")
    waiting = [f"{s} espera {b['parked_on']}" for s, b in st["bugs"].items() if b["state"] == "aguardando-arquivo"]
    if waiting:
        print("esperando arquivo: " + "; ".join(waiting))
    if st.get("excluded"):
        print(f"fora desta execucao: {len(st['excluded'])} (ver plano do maestro)")
    for line in quota_status(st):
        print(line)


def quota_status(st: dict | None) -> list[str]:
    """Linhas do rodizio no `status` (secao 6.3). Sem contas cadastradas: nenhuma (compat). Leitura sem lock.
    `st` None: nao ha state.json (antes do primeiro `init`)."""
    if not rotation_owner():
        return ["contas: rodizio desligado neste projeto (projeto.json); no limite de uso a execucao espera o reset"]
    try:
        acc = accounts_load()
    except SystemExit:
        return ["contas: accounts.json ILEGIVEL (guarda de contas indisponivel; o portao do spawn fica fechado)"]
    n, t, out = len(acc.get("order") or []), time.time(), []
    accs, active = acc.get("accounts") or {}, acc.get("active")
    if n >= 2 and acc.get("paused"):
        out.append("contas: rodizio pausado (accounts restore): a maquina esta no /login")
    elif n == 1:
        out.append("contas: rodizio desligado (1 conta)")
    elif n:
        where = ("confere" if cred_matches(active) else "DIVERGE") if acc.get("applied") else "no /login, ainda nao gravado"
        out.append(f"contas: ativa={active or '-'} (arquivo {where})")
        gone = [f"{k} ate {when(e['exhausted_until'])}" for k, e in accs.items()
                if not e.get("invalid") and (e.get("exhausted_until") or 0) > t]
        bad = [f"{k} ({mask((e['invalid'] or {}).get('reason')) or '?'})" for k, e in accs.items() if e.get("invalid")]
        if gone or bad:
            out.append(f"contas: esgotadas: {', '.join(gone) or '-'}; invalidas: {', '.join(bad) or '-'}")
        if pick_account(acc, t) == (None, None):
            out.append("contas: SEM CREDENCIAL VALIDA: precisa do dono (`accounts add --label X` com token novo)")
        elif acc.get("wake_at"):
            out.append(f"contas: acordar as {when(acc['wake_at'])}")
    if not n:
        return out
    if acc.get("login_saved_at") or acc.get("login_restored_at"):
        out.append(f"contas: /login guardado {when(acc.get('login_saved_at'))}; devolvido {when(acc.get('login_restored_at'))}")
    armed = armed_idle(acc, st) if st is None or not run_open(st) else None
    if armed:
        out.append(f"contas: armado por `accounts activate` em {when(armed)}, esperando execucao (`init` + `start`)")
    dead = acc.get("login_dead")
    if dead and not acc.get("applied") and dead >= (acc.get("login_saved_at") or 0):
        out.append(f"contas: o /login devolvido as {when(dead)} nao respondeu (auth): faca /login (S54)")
    if acc.get("file_repairs"):
        last = acc.get("last_repair") or {}
        out.append(f"contas: reparos do arquivo: {acc['file_repairs']} (ultimo: {last.get('motivo', '?')}, {when(last.get('ts'))})")
    if acc.get("switch_error"):
        out.append(f"contas: erro de troca: {mask(acc['switch_error'])}")
    q = (st or {}).get("quota") or {}
    out.append(f"vigia de cota: {'vivo' if watch_alive() else 'parado'} (origem {q.get('origin') or '-'}; "
               f"ultimo erro: {mask(q.get('last_error')) or '-'})")
    if acc.get("applied") and not rotation_on(acc):
        out.append("AVISO: o arquivo de credenciais tem uma conta do rodizio com o rodizio desligado: rode `accounts restore`")
    for slug, stage, _ in current_recs(st) if st else []:
        why = needs_owner(st, slug, stage)
        if why:
            out.append(f"{slug or 'finalizacao'}/{stage} precisa do dono ({why})")
    return out


def cmd_reconcile(a):
    """A pedido do dono: o mesmo vigia do `tick`, com tolerancia propria. Sem --fix so relata. Com --fix,
    tambem abre o vigia de cota se o rodizio esta ligado e nao ha um vivo."""
    cur = peek_state()
    if rotation_owner() and (cur is None or not run_open(cur)):
        try:
            acc = accounts_load()
        except SystemExit:
            acc = {}
        if acc.get("applied") and not watch_alive():
            print("AVISO: " + idle_cred_warning(acc, cur))
    with file_lock("state"):
        st = load()
        if a.fix and st.get("elencar_erro"):
            elencar(st)
        notes = tick(st, grace_min=a.grace, force=a.fix, report=not a.fix)
        if a.fix:
            save(st)
        if not notes:
            print("nada parado alem do periodo de tolerancia")
    if a.fix:
        schedule_quota_watch("reconcile")


# --------------------------------------------------------------------------- contas (subcomando)

def when(ts) -> str:
    return dt.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else "-"


def accounts_mark_valid(label: str, tested: float) -> str:
    """`ok` da validacao: zera `invalid`, so se o token testado ainda e o da conta (R14). Devolve
    'zerada', 'ja valida' ou 'descartada' (o token foi trocado durante a validacao)."""
    with file_lock("accounts"):
        acc = accounts_load()
        e = acc["accounts"].get(label)
        if not e or e.get("token_version") != tested:
            return "descartada"
        if not e.get("invalid"):
            return "ja valida"
        e["invalid"] = None
        accounts_save(acc)
        return "zerada"


def accounts_mark_invalid(label: str, tested: float, reason: str) -> str:
    """`auth` da validacao do preflight (secao 6.8): marca `invalid`, so se o token testado ainda e o da
    conta (R14). Nao gira nem toca o arquivo: o portao do `spawn` e o passo 4 do vigia cuidam. Devolve
    'marcada', 'ja invalida' ou 'descartada'."""
    with file_lock("accounts"):
        acc = accounts_load()
        e = acc["accounts"].get(label)
        if not e or e.get("token_version") != tested:
            return "descartada"
        if e.get("invalid"):
            return "ja invalida"
        e["invalid"] = {"since": time.time(), "reason": mask(reason) or "erro de autenticacao"}
        accounts_save(acc)
        return "marcada"


def accounts_add(label: str, email: str | None):
    # stdin, nunca argumento: argumento aparece na linha de comando do processo
    token = (getpass.getpass("token do `claude setup-token` (nao aparece): ") if sys.stdin.isatty()
             else sys.stdin.readline()).strip()
    if not TOKEN_RE.fullmatch(token):
        die("isso nao e um token do `claude setup-token` (esperado sk-ant-..., so [A-Za-z0-9_-]); nada gravado", 2)
    err = None
    with file_lock("state"), file_lock("accounts"):              # ordem fixa state -> accounts (R11)
        acc = accounts_load()
        old = acc["accounts"].get(label)
        if old and token_path(label).exists():
            # o token antigo entra no _SECRETS: no arquivo de credenciais ele e "outra conta", nunca o /login
            with contextlib.suppress(OSError, UnicodeDecodeError):
                _SECRETS.add(dpapi_unprotect(token_path(label).read_bytes()).decode("utf-8"))
        e = old or {"email": None, "added": now(), "exhausted_until": 0, "last_limit_type": None,
                    "last_hit": None, "late_retries": 0, "invalid": None}
        e.update(token_created=dt.date.today().isoformat(), token_version=token_write(label, token))
        if email:
            e["email"] = email
        acc["accounts"][label] = e
        if label not in acc["order"]:
            acc["order"].append(label)
        if label == acc.get("active") and rotation_on(acc) and acc.get("applied"):
            err, _ = apply_account(acc, label, time.time())      # o arquivo passa a ter o token novo
        accounts_save(acc)
    print(f"conta {label}: token {'trocado' if old else 'cadastrado'}; contas: {len(acc['order'])}, "
          f"rodizio {'ligado' if rotation_on(acc) else 'desligado'}")
    if err:
        print(f"AVISO: {label} e a ativa e o arquivo de credenciais NAO recebeu o token novo ({err})")
    if old and old.get("invalid"):
        res, tested, text = validate_account(label)
        if res == "ok" and accounts_mark_valid(label, tested) == "zerada":
            print(f"conta {label}: validada; deixou de ser invalida")
        else:
            print(f"conta {label}: continua invalida (validacao: {res}: {text or 'sem saida'})")


def accounts_remove(label: str):
    """A ATIVA (R23): com o rodizio seguindo depois da remocao (>= 2 contas restantes, sem `paused`) e o
    arquivo de credenciais com ele (`applied`), gira ANTES de tirar a conta, na mesma gravacao. Nos
    outros casos nenhuma conta vai para o arquivo, e nao fica conta ativa."""
    back = "nada"
    with file_lock("state"), file_lock("accounts"):
        acc = accounts_load()
        if label not in acc["accounts"]:
            die(f"conta desconhecida: {label}", 2)
        t, was_active = time.time(), label == acc.get("active")
        rest = [x for x in acc["order"] if x != label]
        known_tokens(acc)                        # o token dela segue "outra conta" para o restore_login abaixo
        if was_active and len(rest) >= 2 and not acc.get("paused") and acc.get("applied"):
            if not pick_account(acc, t)[0]:
                die(f"{label} e a conta ativa e nenhuma outra esta disponivel agora (esgotadas ou invalidas); "
                    "nada removido. Troque antes com `accounts activate --label <outra>`", 2)
            if not rotate(acc, t):
                accounts_save(acc)               # fica o switch_error
                die(f"{label} e a conta ativa e o giro para a proxima falhou ({acc.get('switch_error')}); "
                    "nada removido", 1)
        acc["order"] = rest
        del acc["accounts"][label]
        if not rotation_on(acc):                 # < 2 contas ou pausado: o arquivo volta ao /login (R18, R23)
            back = restore_login(acc, t, "accounts remove")
        if acc.get("active") == label:           # nenhuma conta foi gravada no lugar dela
            acc["active"] = None
        accounts_save(acc)
        token_path(label).unlink(missing_ok=True)
        _TOKENS.pop(label, None)
    print(f"conta {label}: removida; contas: {len(acc['order'])}, rodizio {'ligado' if rotation_on(acc) else 'desligado'}"
          + (f"; conta ativa: {acc.get('active') or '-'}" if was_active else ""))
    finish_restore(back)


def finish_restore(back: str):
    """Depois de soltar os locks: a sanidade do /login devolvido, ou o erro da devolucao."""
    if back == "devolvido":
        restore_sanity()
    elif back.startswith("erro"):
        die(f"o /login NAO foi devolvido ({back}); o arquivo continua com uma conta do rodizio", 1)


def accounts_activate(label: str):
    """Troca manual: grava a conta no arquivo e, so com a gravacao conferida, `active = label`.
    Desliga `paused`. Exige 2 contas: o arquivo so e emprestado com o rodizio possivel. Sem execucao
    aberta, grava a marca `armed` (ver armed_idle): o vigia so sobe no `start`, e ate la a conta no
    arquivo sem vigia e o rodizio armado, nao um vigia morto."""
    with file_lock("state"), file_lock("accounts"):
        acc = accounts_load()
        if label not in acc["accounts"]:
            die(f"conta desconhecida: {label}", 2)
        if len(acc["order"]) < 2:
            die("o rodizio precisa de 2 contas cadastradas: com 1, nada devolveria o /login sozinho", 2)
        prev, t = acc.get("active"), time.time()
        err, cls = apply_account(acc, label, t)
        if not err:
            acc.update(active=label, switched_at=t, paused=False)
            try:                                 # o lock `state` esta preso: ninguem o regrava agora
                cur = peek_state()
                acc["armed"] = ({"at": t, "run_id": cur["run_id"] if cur else None}
                                if cur is None or not run_open(cur) else None)
            except (ValueError, KeyError, TypeError, AttributeError):
                acc["armed"] = None              # ledger ilegivel: nao da para dizer, e o accounts_save abaixo nao pode falhar
        accounts_save(acc)                       # (o arquivo de credenciais ja foi gravado); sem marca, o aviso diz as duas leituras
    if err:
        die(f"troca para {label} falhou ({err}); a ativa continua {prev or '-'}", 1)
    if acc["accounts"][label].get("invalid"):
        print(f"AVISO: {label} esta marcada como invalida")
    print(f"conta ativa: {label} (antes: {prev or '-'}; o arquivo tinha: {cls}); rodizio "
          f"{'ligado' if rotation_on(acc) else 'desligado'}"
          + ("; nenhuma execucao aberta: armado ate o `init` + `start` (o vigia sobe no `start`)" if acc.get("armed") else ""))


def accounts_restore():
    """Devolve a maquina ao /login e pausa o rodizio ate o proximo `activate` (secao 6.7, item 4)."""
    with file_lock("state"), file_lock("accounts"):
        acc = accounts_load()
        back = restore_login(acc, time.time(), "accounts restore")
        acc["paused"] = True
        accounts_save(acc)
    print(f"rodizio pausado; devolucao do /login: {back}")
    finish_restore(back)


def accounts_validate(label: str):
    if label not in accounts_load()["accounts"]:
        die(f"conta desconhecida: {label}", 2)
    res, tested, text = validate_account(label)
    print(f"conta {label}: {res} ({text or 'sem saida'})")
    if res == "ok" and accounts_mark_valid(label, tested) == "descartada":
        print("o token foi trocado durante a validacao: resultado descartado; valide de novo")
    elif res == "auth":
        print(f"o token nao vale: gere outro (`claude setup-token`) e troque com `accounts add --label {label}`")


def accounts_list():
    acc, t = accounts_load(), time.time()
    n = len(acc["order"])
    mode = ("PAUSADO (accounts restore): a maquina esta no /login" if acc.get("paused") and n >= 2
            else f"{'ligado' if rotation_on(acc) else 'desligado'} ({n} conta{'' if n == 1 else 's'})")
    print(f"rodizio {mode}; ativa: {acc.get('active') or '-'}")
    for label in acc["order"]:
        e = acc["accounts"].get(label) or {}
        inv = e.get("invalid")
        if inv:
            sit = f"INVALIDA desde {when(inv.get('since'))} ({mask(inv.get('reason')) or '?'})"
        elif (e.get("exhausted_until") or 0) > t:
            sit = f"esgotada ate {when(e['exhausted_until'])} ({e.get('last_limit_type') or '?'})"
        else:
            sit = "disponivel"
        if not token_path(label).exists():
            sit += "; SEM .token"
        print(f"  {'*' if label == acc.get('active') else ' '} {label:<12} {e.get('email') or '-':<32} "
              f"token de {e.get('token_created') or '?'}  {sit}")
    if acc.get("applied"):
        print(f"arquivo de credenciais: conta {acc.get('active') or '?'} "
              f"({'confere' if cred_matches(acc.get('active')) else 'DIVERGE'})")
    elif n:
        print("arquivo de credenciais: o /login (o rodizio nao o esta usando)")
    if acc.get("login_saved_at") or acc.get("login_restored_at"):
        print(f"/login guardado: {when(acc.get('login_saved_at'))}; devolvido: {when(acc.get('login_restored_at'))}")
    if acc.get("switch_error"):
        print(f"erro de troca: {acc['switch_error']}")


def cmd_accounts(a):
    """Cadastro das contas do rodizio. Os que GRAVAM recusam rodar dentro de sessao do Claude (R15, R23):
    as sessoes do pipeline podem chamar qualquer subcomando do helper; o dono cadastra num PowerShell
    comum. `list` e leitura e roda em qualquer lugar."""
    if a.acmd == "list":
        return accounts_list()
    if not rotation_owner():
        die(f"`accounts {a.acmd}` grava a guarda de contas da MAQUINA, e o rodizio esta desligado neste projeto "
            f"({NOME}, projeto.json): gerencie as contas pelo helper do projeto que tem `rodizio_contas`", 2)
    if os.environ.get("CLAUDE_CODE_SESSION_ID"):
        die(f"`accounts {a.acmd}` grava as contas: rode num PowerShell comum, fora de sessao do Claude "
            "(CLAUDE_CODE_SESSION_ID presente)", 2)
    if a.acmd == "restore":
        return accounts_restore()
    if not LABEL.fullmatch(a.label):
        die("--label: so letras, numeros, _ e - (ate 32): vira nome de arquivo", 2)
    {"add": lambda: accounts_add(a.label, a.email), "remove": lambda: accounts_remove(a.label),
     "validate": lambda: accounts_validate(a.label), "activate": lambda: accounts_activate(a.label)}[a.acmd]()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("preflight", help="confere CLI, trust, spawn/resume e os itens `preflight` do projeto.json")
    p.add_argument("--skip-spawn", action="store_true")
    p.set_defaults(fn=cmd_preflight)

    p = sub.add_parser("init", help="cria a execucao com a lista de bugs do maestro")
    p.add_argument("--bugs", required=True, help='JSON {"bugs":[{"slug","doc","title"}], "excluded":[...]}')
    p.add_argument("--base", default=None, help=f"padrao: a `base` do projeto.json ({BASE})")
    p.add_argument("--model", default="claude-opus-5-5")
    p.add_argument("--effort", default="medium", help="planning/finalizacao; dev/teste vem do planning")
    p.add_argument("--max-returns", type=int, default=3, help="devolucoes teste->dev antes de ficar open")
    p.add_argument("--max-planning", type=int, default=4, help="sessoes de planning simultaneas")
    p.add_argument("--max-dev", type=int, default=4, help="bugs por onda")
    p.add_argument("--permission-mode", default="auto")
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_init)

    sub.add_parser("start", help="abre as sessoes de planning").set_defaults(fn=cmd_start)

    p = sub.add_parser("plan-done", help="planning conclui (JSON do plano)")
    p.add_argument("--bug", required=True)
    p.add_argument("--json", required=True)
    p.set_defaults(fn=cmd_plan_done)

    p = sub.add_parser("task-reserve", help="planning: numero novo de task para o item (projeto com `tarefas`)")
    p.add_argument("--bug", required=True)
    p.set_defaults(fn=cmd_task_reserve)

    p = sub.add_parser("claim", help="reserva arquivo fora do plano antes de edita-lo")
    p.add_argument("--bug", required=True)
    p.add_argument("--file", required=True, action="append")
    p.set_defaults(fn=cmd_claim)

    p = sub.add_parser("park", help="espera outro bug da onda liberar um arquivo (ciclo -> adia)")
    p.add_argument("--bug", required=True)
    p.add_argument("--on", required=True)
    p.add_argument("--file", required=True, help="o arquivo esperado (relativo a source/)")
    p.set_defaults(fn=cmd_park)

    p = sub.add_parser("env-wait", help="teste: espera o ambiente E2E livre (saida 11 = ocupado)")
    p.add_argument("--minutes", type=float, default=9)
    p.set_defaults(fn=cmd_env_wait)

    p = sub.add_parser("register-external", help="registra doc aberto no digitalstoregamesproject")
    p.add_argument("--bug", required=True)
    p.add_argument("--file", required=True)
    p.set_defaults(fn=cmd_register_external)

    sub.add_parser("commit-external", help="commita (pathspec, sem push) os docs externos registrados").set_defaults(fn=cmd_commit_external)
    sub.add_parser("elencar", help="retenta a Etapa 2 apos falha de integracao").set_defaults(fn=cmd_elencar)
    sub.add_parser("final-prepare", help="finalizacao: wt-planning no fluxo atual para editar docs").set_defaults(fn=cmd_final_prepare)

    p = sub.add_parser("final-docs", help="finalizacao: commita e integra os docs editados na wt-planning")
    p.add_argument("--message", required=True)
    p.set_defaults(fn=cmd_final_docs)

    for name, fn in (("enqueue-test", cmd_enqueue_test), ("slot-request", cmd_slot_request),
                     ("sync", cmd_sync), ("publish", cmd_publish)):
        p = sub.add_parser(name)
        p.add_argument("--bug", required=True)
        p.set_defaults(fn=fn)

    p = sub.add_parser("blocked", help="dev: impossivel corrigir aqui; doc fica em open")
    p.add_argument("--bug", required=True)
    p.add_argument("--note", required=True)
    p.set_defaults(fn=cmd_blocked)

    p = sub.add_parser("build", help="compile-check na worktree (o `build` do projeto.json), sem tocar o instalado")
    p.add_argument("--bug", required=True)
    for flag, args in (BUILD.get("flags") or {}).items():
        p.add_argument(flag, action="store_true", help="acrescenta " + " ".join(args) + " ao build")
    p.set_defaults(fn=cmd_build)

    p = sub.add_parser("deploy", help="deploy no dist (exige o slot); --at-base = controle positivo")
    p.add_argument("--bug", required=True)
    p.add_argument("--at-base", action="store_true")
    p.set_defaults(fn=cmd_deploy)

    p = sub.add_parser("test-done", help="fim da rodada de teste; libera o slot")
    p.add_argument("--bug", required=True)
    p.add_argument("--result", required=True, choices=["pass", "fail", "ambiente"])
    p.add_argument("--report", help="arquivo com o relatorio (obrigatorio em fail)")
    p.add_argument("--note", default="")
    p.set_defaults(fn=cmd_test_done)

    sub.add_parser("cleanup", help="finalizacao: remove as worktrees (so se tudo integrado)").set_defaults(fn=cmd_cleanup)

    p = sub.add_parser("final-sync-main", help="finalizacao: commita terceiros, publica e iguala a arvore principal ao origin (saida 7 = ficou pendencia do dono)")
    p.add_argument("--fresh-min", type=float, default=FRESH_MIN, help="arquivo mexido ha menos que isto nao e commitado")
    p.set_defaults(fn=cmd_final_sync_main)
    sub.add_parser("final-deploy", help="finalizacao: build + deploy do fluxo principal no dist, de uma lane (saida 11 = ambiente ocupado)").set_defaults(fn=cmd_final_deploy)
    sub.add_parser("final-check", help="finalizacao: o que o portao do final-done ve (so leitura; saida 2 = falta algo)").set_defaults(fn=cmd_final_check)

    p = sub.add_parser("final-done", help="portao do fim: recusa (2) com item mecanico pendente")
    p.add_argument("--note", default="")
    p.set_defaults(fn=cmd_final_done)

    p = sub.add_parser("stop-final", help="(interno) encerra a sessao da finalizacao quando ela fica ociosa")
    p.add_argument("--wait", type=float, default=15, help="minutos esperando ela sair de busy")
    p.add_argument("--interval", type=float, default=20)
    p.set_defaults(fn=cmd_stop_final)

    p = sub.add_parser("quota-watch", help="(interno) vigia de cota do rodizio de contas; aberto pelo proprio helper")
    p.add_argument("--interval", type=float, default=300, help="segundos entre passadas")
    p.add_argument("--once", action="store_true", help="uma passada so")
    p.add_argument("--origem", default="manual", help="quem abriu: tick, start, reconcile, agendador, manual (R17)")
    p.set_defaults(fn=cmd_quota_watch)

    sub.add_parser("status").set_defaults(fn=cmd_status)

    p = sub.add_parser("reconcile", help="acha etapas paradas; --fix retoma a sessao")
    p.add_argument("--fix", action="store_true")
    p.add_argument("--grace", type=float, default=45, help="minutos sem transicao antes de considerar parado")
    p.set_defaults(fn=cmd_reconcile)

    p = sub.add_parser("accounts", help="contas do rodizio (num PowerShell comum; so `list` roda dentro de sessao)")
    asub = p.add_subparsers(dest="acmd", required=True)
    q = asub.add_parser("add", help="cadastra ou troca o token de uma conta (le do stdin, nunca de argumento)")
    q.add_argument("--label", required=True)
    q.add_argument("--email")
    for name, h in (("remove", "descadastra a conta e apaga o .token (a ativa: gira para a proxima; com < 2 contas, devolve o /login)"),
                    ("validate", "a conta responde? (claude -p com o token no env; nao toca o arquivo de credenciais)"),
                    ("activate", "troca manual: grava a conta no arquivo de credenciais e despausa o rodizio")):
        asub.add_parser(name, help=h).add_argument("--label", required=True)
    asub.add_parser("restore", help="devolve o /login ao arquivo de credenciais e pausa o rodizio")
    asub.add_parser("list", help="contas e situacao de cada uma (sem token)")
    p.set_defaults(fn=cmd_accounts)

    a = ap.parse_args()
    if getattr(a, "cmd", "") == "test-done" and a.result == "fail" and not a.report:
        die("--result fail exige --report <arquivo>")
    a.fn(a)


if __name__ == "__main__":
    main()
