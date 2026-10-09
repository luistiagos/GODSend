"""Exercita as funcoes git REAIS do pipeline contra um origin bare temporario."""
import importlib.util, subprocess, sys, tempfile, types
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "pipeline", Path(__file__).with_name("pipeline.py"))
P = importlib.util.module_from_spec(spec); spec.loader.exec_module(P)

tmp = Path(tempfile.mkdtemp())
def sh(*a, cwd=None):
    p = subprocess.run(a, cwd=cwd, capture_output=True, text=True)
    if p.returncode: raise SystemExit(f"{a}: {p.stderr}")
    return p.stdout.strip()
def check(cond, msg):
    print(("OK   " if cond else "FAIL ") + msg)
    if not cond: sys.exit(1)
def expect_exit(code, fn, msg):
    try: fn(); check(False, msg + " (nao saiu)")
    except SystemExit as e: check(e.code == code, f"{msg} (exit {e.code})")

origin = tmp / "origin.git"; sh("git", "init", "-q", "--bare", "-b", "versao3", str(origin))
src = tmp / "source"; sh("git", "clone", "-q", str(origin), str(src))
for k, v in (("user.email", "t@t"), ("user.name", "t")):
    sh("git", "config", k, v, cwd=src)
(src / "launcher").mkdir(); (src / "es").mkdir(); (src / "docs/bugs/open").mkdir(parents=True); (src / "docs/bugs/retest").mkdir()
(src / "launcher/A.cs").write_text("a\n"); (src / "es/C.cpp").write_text("c\n")
(src / "emulationstation-source/es-app").mkdir(parents=True)
(src / "emulationstation-source/es-app/emulationstation.vcxproj").write_text("<C:/main/path>\n")
(src / "launcher/batocera-ports.sln").write_text("sln mantido a mao\n")
(src / "emulationstation-source/.gitignore").write_text("win32-libs\nbin\n")  # como no repo real
(src / "emulationstation-source/win32-libs/SDL2").mkdir(parents=True)
(src / "emulationstation-source/win32-libs/SDL2/SDL2.lib").write_text("lib da arvore principal\n")
(src / "docs/bugs/open/a.md").write_text("# a\n"); (src / "docs/bugs/open/c.md").write_text("# c\n"); (src / "docs/bugs/retest/README.md").write_text("r\n")
sh("git", "checkout", "-q", "-b", "versao3", cwd=src); sh("git", "add", ".", cwd=src)
sh("git", "commit", "-q", "-m", "base", cwd=src); sh("git", "push", "-q", "origin", "versao3", cwd=src)

P.SRC = src; P.PIPE = tmp / "pipe"; P.WTS = tmp / "pipe/lanes"
P.STATE = tmp / "pipe/state.json"                   # NUNCA o ledger real (.bugfix-pipeline/state.json)
P.PIPE.mkdir(parents=True)
assert str(P.STATE).startswith(str(tmp)) and str(P.SRC).startswith(str(tmp))
st = {"base": "origin/versao3", "branch": "versao3", "worktrees": {}, "run_id": "t",
      "bugs": {s: {"branch": f"bugfix/{s}", "wt": w, "doc": f"docs/bugs/open/{s}.md", "synced_base": None}
               for s, w in (("a", "wt-1"), ("c", "wt-2"))}}
w1 = P.ensure_wt(st, "wt-1"); w2 = P.ensure_wt(st, "wt-2")
for w in (w1, w2):
    for k, v in (("user.email", "t@t"), ("user.name", "t")):
        sh("git", "config", k, v, cwd=w)
P.checkout_fresh(w1, "origin/versao3", "bugfix/a"); P.checkout_fresh(w2, "origin/versao3", "bugfix/c")
check(sh("git", "branch", "--show-current", cwd=w1) == "bugfix/a", "worktree por bug no seu branch")
check((w1 / "emulationstation-source/win32-libs/SDL2/SDL2.lib").read_text() == "lib da arvore principal\n",
      "[prontidao] win32-libs (ignorada pelo git) copiada para a worktree")

# so o GERADO do CMake e descartado; edicao de verdade nao commitada nunca
vcx = w1 / "emulationstation-source/es-app/emulationstation.vcxproj"
vcx.write_text("<caminho da worktree>\n"); (w1 / "launcher/A.cs").write_text("edicao do dev nao commitada\n")
expect_exit(2, lambda: P.discard_generated(w1, "sync"), "edicao nao commitada -> recusa (nada descartado)")
check((w1 / "launcher/A.cs").read_text() == "edicao do dev nao commitada\n", "edicao do dev intacta")
sh("git", "checkout", "--", "launcher/A.cs", cwd=w1)
P.discard_generated(w1, "sync")
check(vcx.read_text() == "<C:/main/path>\n", ".vcxproj regenerado do ES descartado")
(w1 / "launcher/batocera-ports.sln").write_text("projeto novo adicionado a mao\n")
expect_exit(2, lambda: P.discard_generated(w1, "sync"), ".sln do launcher e edicao REAL (nao e tratado como gerado)")
sh("git", "checkout", "--", "launcher/batocera-ports.sln", cwd=w1)

# a e c em paralelo, arquivos disjuntos
(w1 / "launcher/A.cs").write_text("a fix\n"); sh("git", "mv", "docs/bugs/open/a.md", "docs/bugs/retest/a.md", cwd=w1)
sh("git", "commit", "-qam", "fix a", cwd=w1)
(w2 / "es/C.cpp").write_text("c fix\n"); sh("git", "commit", "-qam", "fix c", cwd=w2)
sync_c = sh("git", "rev-parse", "origin/versao3", cwd=w2)

P.publish_head(st, w1, sh("git", "rev-parse", "origin/versao3", cwd=w1), code_check=True)
check(sh("git", "--git-dir", str(origin), "log", "-1", "--format=%s", "versao3") == "fix a", "a integrado no fluxo principal")

expect_exit(3, lambda: P.publish_head(st, w2, sync_c, code_check=True),
            "c recusado: o fluxo principal andou com CODIGO depois do sync de c")
P.publish_head(st, w2, sh("git", "rev-parse", "origin/versao3", cwd=w2), code_check=False)
log = sh("git", "--git-dir", str(origin), "log", "--format=%s", "versao3").splitlines()
check(log[:2] == ["fix c", "fix a"], f"c rebaseado e integrado, historico linear: {log}")
check(sh("git", "--git-dir", str(origin), "rev-list", "--merges", "--count", "versao3") == "0", "nenhum merge commit")

# gerado do CMake no commit -> recusado
P.checkout_fresh(w1, "origin/versao3", "bugfix/g")
vcx.write_text("<caminho da worktree>\n"); sh("git", "commit", "-qam", "gen", cwd=w1)
expect_exit(5, lambda: P.publish_head(st, w1), ".vcxproj gerado no commit e recusado")

# [[pipeline-publish-recusa-branch-que-remove-gerado-do-indice-saida-5_2026-10-07]] tirar gerado do indice
# (`git rm --cached`) e a CORRECAO de gerado versionado, nao commitar gerado: publica. `outro` e um clone
# que faz o fluxo principal andar por fora, para o rebase do publish trocar de base de verdade.
outro = tmp / "outro"; sh("git", "clone", "-q", "-b", "versao3", str(origin), str(outro))
for k, v in (("user.email", "t@t"), ("user.name", "t")):
    sh("git", "config", k, v, cwd=outro)
def anda(rel, text, msg):
    sh("git", "pull", "-q", "--ff-only", cwd=outro)
    f = outro / rel; f.parent.mkdir(parents=True, exist_ok=True); f.write_text(text)
    sh("git", "add", rel, cwd=outro); sh("git", "commit", "-qm", msg, cwd=outro); sh("git", "push", "-q", "origin", "versao3", cwd=outro)
otree = lambda f: sh("git", "--git-dir", str(origin), "ls-tree", "--name-only", "versao3", "--", f)
dll, cache = "rgs/bin/Release/f.dll", "rgs/obj/Release/f.cache"
anda(dll, "saida de build\n", "dll versionada"); anda(cache, "saida de build\n", "cache versionado")
P.checkout_fresh(w1, "origin/versao3", "bugfix/g")
sh("git", "rm", "-q", "--cached", dll, cwd=w1); (w1 / "rgs/.gitignore").write_text("bin/\n")
sh("git", "add", "rgs/.gitignore", cwd=w1); sh("git", "commit", "-qm", "tira a dll do indice", cwd=w1)
anda("docs/t1.md", "x\n", "fluxo principal andou (t1)")
P.publish_head(st, w1)
check(otree(dll) == "" and otree("rgs/.gitignore") == "rgs/.gitignore" and otree(cache) == cache,
      "[publish-remove-gerado] branch que TIRA gerado do indice (com .gitignore) publica (antes: saida 5)")
P.checkout_fresh(w1, "origin/versao3", "bugfix/g")
sh("git", "rm", "-q", "--cached", cache, cwd=w1); sh("git", "commit", "-qm", "tira o cache do indice, sem .gitignore", cwd=w1)
(w1 / "rgs/obj/Release/so-da-lane.cache").write_text("nao existe na base\n")
check(f"?? {cache}" in sh("git", "status", "--porcelain", "--untracked-files=all", cwd=w1),
      "[publish-remove-gerado] cenario: gerado fora do indice, nao ignorado, no disco da lane")
anda("docs/t2.md", "x\n", "fluxo principal andou (t2)")
P.publish_head(st, w1)
check(otree(cache) == "" and sh("git", "--git-dir", str(origin), "log", "-1", "--format=%s", "versao3")
      == "tira o cache do indice, sem .gitignore",
      "[publish-remove-gerado] sem .gitignore o rebase sobre a base nova passa (antes: saida 4)")
check((w1 / "rgs/obj/Release/so-da-lane.cache").exists(),
      "[publish-remove-gerado] gerado nao rastreado que a base NAO tem fica no disco")
(w1 / "rgs/obj/Release/so-da-lane.cache").unlink()
P.checkout_fresh(w1, "origin/versao3", "bugfix/g")
(w1 / "rgs/bin/Release").mkdir(parents=True, exist_ok=True); (w1 / "rgs/bin/Release/novo.dll").write_text("dll nova\n"); sh("git", "add", "-f", "rgs/bin/Release/novo.dll", cwd=w1)
sh("git", "commit", "-qm", "adiciona dll", cwd=w1)
expect_exit(5, lambda: P.publish_head(st, w1), "[publish-remove-gerado] ADICIONAR gerado bin/Release continua recusado")
P.checkout_fresh(w1, "origin/versao3", "bugfix/g")
(w1 / "launcher/bin/Release").mkdir(parents=True); sh("git", "mv", "launcher/A.cs", "launcher/bin/Release/A.cs", cwd=w1)
sh("git", "commit", "-qm", "renomeia fonte para saida de build", cwd=w1)
expect_exit(5, lambda: P.publish_head(st, w1), "[publish-remove-gerado] RENOMEAR fonte para bin/Release continua recusado")

# bug que termina em open: so docs vao para o fluxo principal, codigo fica no -wip
P.checkout_fresh(w1, "origin/versao3", "bugfix/a")
(w1 / "launcher/A.cs").write_text("tentativa ruim\n"); sh("git", "commit", "-qam", "wip a", cwd=w1)
(w1 / "docs/bugs/retest/a.md").write_text("# a\n## Rodada 4 reprovada: motivo\n"); sh("git", "commit", "-qam", "doc a", cwd=w1)
(w1 / "docs/bugs/open/novo-lateral.md").write_text("# lateral\n"); sh("git", "add", ".", cwd=w1); sh("git", "commit", "-qm", "lateral", cwd=w1)
P.publish_docs_only(st, "a")
show = lambda f: subprocess.run(["git", "--git-dir", str(origin), "show", f"versao3:{f}"], capture_output=True, text=True).stdout
check(show("launcher/A.cs") == "a fix\n", "codigo da tentativa reprovada NAO foi para o fluxo principal")
check("Rodada 4 reprovada" in show("docs/bugs/open/a.md") and show("docs/bugs/open/novo-lateral.md"),
      "docs (falha documentada + bug lateral) integrados")
check(show("docs/bugs/retest/a.md") == "" and "REPROVADO depois de preparado para retest" in show("docs/bugs/open/a.md"),
      "[revisao 5] bug reprovado termina com o doc em open/, marcado, e nada em retest/")
check(sh("git", "rev-parse", "--verify", "bugfix/a-wip", cwd=w1) != "", "tentativa guardada em bugfix/a-wip")

# [revisao 2] falha na 1a publicacao + repeticao: o -wip continua sendo a TENTATIVA, nao o branch -docs
st["bugs"]["r"] = {"branch": "bugfix/r", "wt": "wt-1", "doc": "docs/bugs/open/r.md", "synced_base": None,
                   "state": "open-falhou", "commit": None}
st["worktrees"]["wt-1"]["bug"] = "r"
P.checkout_fresh(w1, "origin/versao3", "bugfix/r")
(w1 / "launcher/R.cs").write_text("attempted fix\n"); (w1 / "docs/bugs/open/r.md").write_text("# r\n## Teste rodada 4 reprovado\n")
sh("git", "add", ".", cwd=w1); sh("git", "commit", "-qm", "tentativa r", cwd=w1)
attempt = sh("git", "rev-parse", "HEAD", cwd=w1)
real_publish, calls = P.publish_head, [0]
def flaky(*a, **k):
    calls[0] += 1
    if calls[0] == 1:
        P.die("simulado: push rejeitado", 6)
    return real_publish(*a, **k)
P.publish_head = flaky
expect_exit(6, lambda: P.publish_docs_only(st, "r"), "[revisao 2] 1a publicacao so-docs falha")
P.publish_docs_only(st, "r")
P.publish_head = real_publish
check(sh("git", "rev-parse", "bugfix/r-wip", cwd=w1) == attempt
      and sh("git", "show", "bugfix/r-wip:launcher/R.cs", cwd=w1) == "attempted fix",
      "[revisao 2] repeticao mantem o SHA e o conteudo da tentativa em -wip")
check(show("docs/bugs/open/r.md") and show("launcher/R.cs") == "", "[revisao 2] so os docs foram integrados")

# [revisao 1] stash que falha NAO pode ser seguido de reset
(w1 / "launcher/A.cs").write_text("trabalho do dev\n"); (w1 / "docs/novo.md").write_text("novo\n")
lock = Path(sh("git", "rev-parse", "--git-common-dir", cwd=w1))
lock = (lock if lock.is_absolute() else (w1 / lock)).resolve() / "refs" / "stash.lock"
lock.parent.mkdir(parents=True, exist_ok=True); lock.write_text("")
expect_exit(15, lambda: P.checkout_fresh(w1, "origin/versao3", "bugfix/x"), "[revisao 1] stash falhou -> erro ANTES do reset")
check((w1 / "launcher/A.cs").read_text() == "trabalho do dev\n" and (w1 / "docs/novo.md").exists(),
      "[revisao 1] modificado e nao rastreado intactos")
lock.unlink()
n_stash = len(sh("git", "stash", "list", cwd=w1).splitlines())
P.checkout_fresh(w1, "origin/versao3", "bugfix/x")   # branch descartavel: -B recriaria bugfix/r
sh("git", "checkout", "-q", "bugfix/r", cwd=w1)
check(len(sh("git", "stash", "list", cwd=w1).splitlines()) == n_stash + 1
      and "trabalho do dev" in sh("git", "stash", "show", "-p", "stash@{0}", cwd=w1),
      "[revisao 1] caminho normal: sobra recuperavel pelo stash")

# [revisao 4] saidas de build versionadas reais sao geradas; fonte nao
for f, exp in [("emulationstation-source/external/pugixml/pugixml-config.cmake", True),
               ("emulationstation-source/external/pugixml/pugixml.pc", True),
               ("rgs-fullset-gui/RGSFullset/bin/Release/EmulatorLauncher.Common.dll", True),
               ("rgs-fullset-gui/RGSFullset/obj/Release/RGSFullset.csproj.AssemblyReference.cache", True),
               ("emulationstation-source/external/pugixml/CMakeLists.txt", False),
               ("retrobat-executable/RetroBat/RetroBat/EmulationStationLauncher.cs", False)]:
    check(bool(P.GENERATED.search(f)) == exp, f"[revisao 4] gerado={exp}: {f}")

# [revisao 4] controle positivo: se limpar os gerados falhar, a volta ao branch NAO e pulada
st.update(test_slot="r")
st["bugs"]["r"]["synced_base"] = sh("git", "rev-parse", "origin/versao3", cwd=w1)
P.load = lambda: st
real_deploy = P.project_cmd
P.project_cmd = lambda path, kind, extra=(): (Path(path) / "lixo-do-build.txt").write_text("x\n")
expect_exit(2, lambda: P.cmd_deploy(types.SimpleNamespace(bug="r", at_base=True)),
            "[revisao 4] limpeza falha no --at-base (mudanca real) -> erro")
check(sh("git", "branch", "--show-current", cwd=w1) == "bugfix/r" and (w1 / "lixo-do-build.txt").exists(),
      "[revisao 4] mesmo assim voltou para o branch do bug, sem descartar nada")
(w1 / "lixo-do-build.txt").unlink()
P.project_cmd = lambda path, kind, extra=(): (Path(path) / "launcher/R.cs").write_text("sujou na base\n")
expect_exit(16, lambda: P.cmd_deploy(types.SimpleNamespace(bug="r", at_base=True)),
            "[revisao 4] volta impossivel (conflito) -> TRAVA explicita, nao silencio")
check((w1 / "launcher/R.cs").read_text() == "sujou na base\n", "[revisao 4] nada descartado na TRAVA")
(w1 / "launcher/R.cs").unlink(); sh("git", "checkout", "-q", "bugfix/r", cwd=w1)   # na base o R.cs e nao rastreado
P.project_cmd = real_deploy
st["worktrees"]["wt-1"]["bug"] = "a"

# [revalidacao 8] a skill e CODIGO: nao pode morar sob docs/, que o helper trata como documentacao
check(not P.SKILL.relative_to(Path(sh("git", "rev-parse", "--show-toplevel", cwd=P.SKILL))).as_posix().startswith("docs/"),
      f"[revalidacao 8] a skill nao mora sob source/docs/ ({P.SKILL})")

# [revalidacao 7] ultima reprovacao com falha na publicacao: o mesmo test-done refaz, pelo ledger em DISCO
import json
SKILL_PY = "skills/pipeline-correcao-bugs/scripts/pipeline.py"
P.checkout_fresh(w1, "origin/versao3", "bugfix/z")
(w1 / "launcher/Z.cs").write_text("tentativa z reprovada\n"); (w1 / "docs/bugs/open/z.md").write_text("# z\n## Teste reprovado\n")
(w1 / SKILL_PY).parent.mkdir(parents=True); (w1 / SKILL_PY).write_text("VALUE = 999  # mudanca reprovada\n")
sh("git", "add", ".", cwd=w1); sh("git", "commit", "-qm", "tentativa z", cwd=w1)
attempt_z = sh("git", "rev-parse", "HEAD", cwd=w1)
stz = {"base": "origin/versao3", "branch": "versao3", "run_id": "t", "max_returns": 3, "test_slot": "z",
       "test_queue": ["q"], "worktrees": {"wt-1": {"path": str(w1), "bug": "z"}},
       "bugs": {"z": {"state": "teste-e2e", "returns": 3, "commit": None, "doc": "docs/bugs/open/z.md",
                      "branch": "bugfix/z", "wt": "wt-1", "sessions": {}, "history": [], "claims": []},
                "q": {"state": "aguardando-slot", "retry_after": None, "sessions": {}, "history": []}}}
P.save(stz)
fakes = {k: getattr(P, k) for k in ("load", "spawn", "tick", "stop_sessions", "clean_wt", "next_wave", "publish_head")}
P.load = lambda: json.loads(P.STATE.read_text(encoding="utf-8"))
P.spawn = lambda st, slug, stage, message="": None
P.tick = lambda st, **k: None
P.stop_sessions = lambda b, except_stage=None: None
P.clean_wt = P.next_wave = lambda *a: None
calls = [0]
def flaky_z(*a, **k):
    calls[0] += 1
    if calls[0] == 1:
        P.die("simulado: push rejeitado", 6)
    return fakes["publish_head"](*a, **k)
P.publish_head = flaky_z
done_z = lambda: P.cmd_test_done(types.SimpleNamespace(bug="z", result="fail", report=None, note="x"))
expect_exit(6, done_z, "[revalidacao 7] ultima reprovacao: 1a publicacao so-docs falha")
disk = P.load()
check(disk["bugs"]["z"]["state"] == "teste-e2e" and disk["test_slot"] == "z" and disk["bugs"]["z"].get("wip_sha"),
      "[revalidacao 7] ledger em disco: bug ainda DONO do slot (retomavel), wip_sha gravado")
done_z()
disk = P.load()
check(disk["bugs"]["z"]["state"] == "open-falhou" and disk["test_slot"] == "q" and disk["bugs"]["q"]["state"] == "teste-e2e",
      "[revalidacao 7] repeticao pelo comando publico: open-falhou, slot liberado e a fila andou")
check(sh("git", "rev-parse", "bugfix/z-wip", cwd=w1) == attempt_z, "[revalidacao 7] tentativa preservada em bugfix/z-wip")
check("Teste reprovado" in show("docs/bugs/open/z.md") and show("launcher/Z.cs") == "",
      "[revalidacao 7] docs integrados, codigo da tentativa nao")
check(show(SKILL_PY) == "", "[revalidacao 8] script da skill numa tentativa reprovada NAO vai para o fluxo principal")
for k, v in fakes.items():
    setattr(P, k, v)
P.load = lambda: st

# limpeza: fim de bug apaga os branches dele; cleanup da finalizacao remove as worktrees
branches = lambda: sh("git", "branch", "--list", "bugfix/*", "--format=%(refname:short)", cwd=src).split()

# TRAVA da arvore principal: sujo de "outra sessao" na principal, e tudo tem que ser recusado
(src / "launcher/A.cs").write_text("trabalho nao commitado de outra sessao\n")
(src / "rascunho-humano.txt").write_text("nao apagar\n")
main_before = (sh("git", "status", "--porcelain", cwd=src), sh("git", "rev-parse", "HEAD", cwd=src))
expect_exit(13, lambda: P.guard_wt(src), "guard_wt recusa a arvore principal")
expect_exit(13, lambda: P.guard_wt(tmp), "guard_wt recusa pasta que CONTEM a principal")
expect_exit(13, lambda: P.guard_wt(src / "launcher"), "guard_wt recusa subpasta da principal")
expect_exit(13, lambda: P.checkout_fresh(src, "origin/versao3", "bugfix/x"), "checkout_fresh na principal recusado")
expect_exit(13, lambda: P.git("reset", "--hard"), "git reset sem cwd (padrao = principal) recusado")
expect_exit(13, lambda: P.git("clean", "-fdx", cwd=src / "launcher"), "git clean em subpasta da principal recusado")
expect_exit(13, lambda: P.git("branch", "-D", "versao3"), "branch -D na principal recusado")
expect_exit(13, lambda: P.guard_branch(st, "versao3"), "guard_branch recusa o fluxo principal")
expect_exit(13, lambda: P.guard_branch(st, "bugfix/a-wip"), "guard_branch recusa apagar -wip")
expect_exit(13, lambda: P.git("worktree", "remove", "--force", str(src), cwd=w1), "worktree remove da principal recusado (de qualquer cwd)")
st_evil = dict(st, worktrees={"wt-x": {"path": str(src), "bug": None}}, bugs={})
P.load = lambda: st_evil
expect_exit(13, lambda: P.cmd_cleanup(None), "cleanup com ledger apontando para a principal recusado")
check((sh("git", "status", "--porcelain", cwd=src), sh("git", "rev-parse", "HEAD", cwd=src)) == main_before
      and (src / "rascunho-humano.txt").exists() and (src / ".git").is_dir(),
      "arvore principal intacta: mesmo HEAD, mesmo sujo, rascunho preservado, .git e pasta")
st["bugs"]["c"].update(state="retest", commit=sh("git", "rev-parse", "HEAD", cwd=w2))
st["bugs"]["a"].update(state="open-falhou", commit=None)
st["worktrees"]["wt-1"]["bug"], st["worktrees"]["wt-2"]["bug"] = "a", "c"
P.load = lambda: st
(w2 / "es/C.cpp").write_text("sobra que ninguem commitou\n"); (w2 / "es/novo.cpp").write_text("arquivo novo\n")
P.clean_wt(st, "c"); P.clean_wt(st, "a")
stash = sh("git", "stash", "list", cwd=src)
check("pipeline-sobra c" in stash and st["bugs"]["c"].get("leftover_stash"), "sobra nao commitada vai para stash, nao e apagada")
check("sobra que ninguem commitou" in sh("git", "stash", "show", "-p", "stash@{0}", cwd=src)
      and "arquivo novo" in sh("git", "show", "stash@{0}^3:es/novo.cpp", cwd=src), "stash guarda modificado E arquivo novo")
check("bugfix/c" not in branches() and "bugfix/a" not in branches() and "bugfix/a-docs" not in branches(),
      f"fim de bug apaga os branches dele: {branches()}")
check("bugfix/a-wip" in branches(), "branch -wip do bug que ficou em open e mantido")
check(sh("git", "branch", "--show-current", cwd=w2) == "" and w2.exists(), "worktree volta ao fluxo principal e fica para a proxima onda")
(w2 / "es/C.cpp").write_text("lixo nao integrado\n")
expect_exit(2, lambda: P.cmd_cleanup(None), "cleanup recusa worktree com mudanca nao integrada")
check(w2.exists(), "nada apagado na recusa")
sh("git", "checkout", "--", ".", cwd=w2)

# [piloto lane presa] sessao --bg viva com cwd na lane trava a pasta no Windows (bug
# pipeline-daemon-claude-bg-orfao-trava-pasta-da-lane_2026-10-02): cleanup para as ociosas, recusa as que
# trabalham, nunca toca sessao de outra pasta, e confere que a pasta sumiu
import contextlib, io, os, time
real_run, cli_calls = P.run, []
def run_cli(cmd, cwd=None, check=True, timeout=None):
    if cmd[0] == "claude-falso":
        cli_calls.append(list(cmd)); return types.SimpleNamespace(returncode=0, stdout="", stderr="")
    return real_run(cmd, cwd=cwd, check=check, timeout=timeout)
P.run, P.claude_exe = run_cli, (lambda: "claude-falso")
up = lambda p: str(p).upper().replace("/", "\\")             # caixa/barra do claude agents nao importam
P.agents = lambda: [{"name": "teste-a", "sessionId": "aaaa0001-x", "status": "busy", "cwd": up(w1)},
                    {"name": "outra", "sessionId": "ffff0001-x", "status": "idle", "cwd": str(tmp)}]
expect_exit(2, lambda: P.cmd_cleanup(None), "[piloto lane presa] sessao TRABALHANDO com cwd na lane -> recusa")
check(w1.exists() and w2.exists() and not cli_calls, "[piloto lane presa] recusa: nada apagado, ninguem parado")
# `kind` do claude agents (medido em 2026-10-02): "interactive" = terminal/IDE do dono; `claude stop` so para background
P.agents = lambda: [{"name": "dono", "sessionId": "dddd0001-x", "kind": "interactive", "status": "busy", "cwd": str(w1)}]
expect_exit(2, lambda: P.cmd_cleanup(None), "[piloto lane presa] sessao INTERATIVA trabalhando na lane -> recusa")
check(w1.exists() and w2.exists() and not cli_calls, "[piloto lane presa] recusa (interativa): nada apagado, ninguem parado")
P.agents = lambda: [{"name": "teste-a", "sessionId": "aaaa0002-x", "kind": "background", "status": "idle",
                     "state": "done", "cwd": up(w1 / "es")},
                    {"name": "dono", "sessionId": "dddd0002-x", "kind": "interactive", "status": "idle", "cwd": str(w1)},
                    {"name": "vizinha", "sessionId": "bbbb0002-x", "status": "idle", "cwd": str(w1) + "0"},  # wt-10
                    {"name": "encerrada", "sessionId": "cccc0002-x", "state": "done", "cwd": str(w2)},
                    {"name": "outra", "sessionId": "ffff0002-x", "status": "busy", "cwd": str(src)}]
holder = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], cwd=w2)  # processo REAL com cwd na lane
time.sleep(1)
out = io.StringIO()
try:
    try:
        with contextlib.redirect_stdout(out):
            P.cmd_cleanup(None)
    finally:
        print(out.getvalue().rstrip())
    check(cli_calls == [["claude-falso", "stop", "aaaa0002"]],
          f"[piloto lane presa] para SO a background ociosa com cwd dentro da lane, pelo id curto ({cli_calls})")
    aviso_dono = [l for l in out.getvalue().splitlines() if l.startswith("AVISO") and "dddd0002" in l]
    check(len(aviso_dono) == 1 and "interativa" in aviso_dono[0] and "sessao encerrada" not in aviso_dono[0]
          and "dddd0002" not in "".join(l for l in out.getvalue().splitlines() if l.startswith("sessao encerrada")),
          "[piloto lane presa] interativa ociosa na lane: sem stop, sem 'sessao encerrada' falso, AVISO com o id")
    check(not w1.exists(), "[piloto lane presa] lane sem processo: pasta some")
    check(w2.exists() and not any(w2.iterdir()) and "AVISO" in out.getvalue() and str(w2) in out.getvalue(),
          "[piloto lane presa] lane com processo real: git sai 255, cleanup segue; pasta vazia fica, com AVISO")
    check("wt-2" not in sh("git", "worktree", "list", cwd=src), "[piloto lane presa] a lane presa saiu do git worktree list")
    sh("git", "worktree", "add", "-q", "--detach", str(w2), "origin/versao3", cwd=src)
    check((w2 / ".git").is_file(), "[piloto lane presa] proxima execucao reaproveita a pasta vazia presa (worktree add ok)")
finally:
    holder.kill(); holder.wait()
P.agents = lambda: []
P.cmd_cleanup(None)
check(not w1.exists() and not w2.exists(), "cleanup remove as worktrees (2a passada apaga a pasta vazia que ficou)")
check(cli_calls == [["claude-falso", "stop", "aaaa0002"]], "[piloto lane presa] sem sessao na lane: nenhum stop")
# lane do ledger SEM .git (pasta vazia do preflight, ou sobra de um remove que saiu 255) com sessao viva dentro
w1.mkdir()
P.agents = lambda: [{"name": "copia-da-sonda", "sessionId": "eeee0003-x", "kind": "background", "status": "idle",
                     "state": "done", "cwd": str(w1)}]
P.cmd_cleanup(None)
check(cli_calls[-1] == ["claude-falso", "stop", "eeee0003"] and len(cli_calls) == 2 and not w1.exists(),
      f"[piloto lane presa] lane sem .git: background ociosa e parada e a pasta vazia some ({cli_calls})")
P.run = real_run
check((src / "emulationstation-source/win32-libs/SDL2/SDL2.lib").exists(),
      "[prontidao] remover a worktree NAO apaga a win32-libs da arvore principal")
check("bugfix/a-wip" in branches() and len(sh("git", "worktree", "list", cwd=src).splitlines()) == 1,
      "so a arvore principal sobra; -wip preservado")

# ---- [finalizacao] bug pipeline-finalizacao-nao-entrega-estado-organizado-..._2026-10-02: a finalizacao
# entrega C1-C5 medidos. Ponto de partida REAL do bug: a arvore principal esta varios commits atras do
# origin, com trabalho nao commitado de terceiros (A.cs modificado, rascunho-humano.txt), stash e -wip.
import shutil
ns = types.SimpleNamespace
olog = lambda fmt="%s": sh("git", "--git-dir", str(origin), "log", f"--format={fmt}", "versao3").splitlines()
oshow = lambda f: sh("git", "--git-dir", str(origin), "show", f"versao3:{f}")
head_o = lambda: sh("git", "--git-dir", str(origin), "rev-parse", "versao3")
header = lambda: sh("git", "status", "-sb", cwd=src).splitlines()[0]
P.agents = lambda: []
P.foreign_processes = lambda: []
P.DIST_ES = tmp / "dist"; P.DIST_ES.mkdir()
deploys = []
def fake_deploy(path, kind, extra=()):
    path = Path(path); deploys.append((path.name, kind))
    if "NAO COMPILA" in (path / "launcher/batocera-ports.sln").read_text():
        P.die("deploy.ps1 saiu 1", 3)
    if kind == "deploy":
        for name, rel in P.DEPLOYED.items():
            out = path / rel; out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(f"{name} de {sh('git', 'rev-parse', 'HEAD', cwd=path)}\n"); shutil.copy(out, P.DIST_ES / name)
P.project_cmd = fake_deploy
stf = {"base": "origin/versao3", "branch": "versao3", "run_id": "t", "worktrees": {},
       "final": {"state": "rodando", "session": None},
       "bugs": {"c": {"state": "retest", "commit": olog("%H")[olog().index("fix c")], "branch": "bugfix/c",
                      "doc": "docs/bugs/open/c.md", "sessions": {}, "test_round": 1},
                "a": {"state": "open-falhou", "commit": None, "branch": "bugfix/a",
                      "doc": "docs/bugs/open/a.md", "sessions": {}, "test_round": 4}}}
P.save(stf)
P.load = lambda: json.loads(P.STATE.read_text(encoding="utf-8"))
falta = lambda c, kind="mecanico": [m for cc, k, m in P.final_report(P.load()) if cc == c and k == kind]
sync = lambda: P.cmd_final_sync_main(ns(fresh_min=10))
old = time.time() - 3600
def third(rel, text, aged=True):                 # arquivo que OUTRA sessao deixou na arvore principal
    f = src / rel; f.parent.mkdir(parents=True, exist_ok=True); f.write_text(text)
    if aged: os.utime(f, (old, old))

# a excecao da trava e estreita: fora da janela nada mudou; dentro dela, so o que nao destroi
expect_exit(13, lambda: P.git("commit", "-m", "x", "--", "launcher/A.cs"), "[finalizacao] fora do final-sync-main: commit na principal continua recusado")
expect_exit(13, lambda: P.git("reset", "--keep", "origin/versao3"), "[finalizacao] fora do final-sync-main: reset --keep na principal recusado")
with P.main_sync_window():
    expect_exit(13, lambda: P.git("reset", "--hard"), "[finalizacao] DENTRO da janela: reset --hard continua recusado")
    expect_exit(13, lambda: P.git("checkout", "--", "."), "[finalizacao] DENTRO da janela: checkout continua recusado")
    expect_exit(13, lambda: P.git("merge", "origin/versao3"), "[finalizacao] DENTRO da janela: merge sem --ff-only recusado")
    expect_exit(13, lambda: P.git("stash"), "[finalizacao] DENTRO da janela: stash continua recusado")
expect_exit(13, lambda: P.git("add", "-A"), "[finalizacao] a janela fecha na saida")
check((sh("git", "status", "--porcelain", cwd=src), sh("git", "rev-parse", "HEAD", cwd=src)) == main_before,
      "[finalizacao] arvore principal intacta depois das recusas")

# o portao: no estado em que o piloto fechou como `concluido`, agora recusa
check(falta("C2") and falta("C3") and any("briefing nao encontrado" in m for m in falta("C4"))
      and any("c.md nao existe em origin" in m for m in falta("C4")),
      "[finalizacao] portao ve: principal atras, dist sem deploy final, doc do retest em open/, sem briefing")
expect_exit(2, lambda: P.cmd_final_done(ns(note="x")), "[finalizacao] final-done RECUSA com item mecanico")
check(P.load()["final"]["state"] == "rodando", "[finalizacao] recusa nao grava concluido")

# final-sync-main, caso real: doc novo, doc modificado, codigo, gerado de build, `??` igual ao do origin,
# arquivo sendo editado agora, arquivo novo fora de docs/
sh("git", "checkout", "--", "launcher/A.cs", cwd=src)   # este conflitaria; o conflito e testado adiante
third("docs/notas-terceiro.md", "notas\n")
third("docs/bugs/open/c.md", "# c\ntriagem de outra sessao\n")
third("launcher/batocera-ports.sln", "sln de terceiro\n")
third("emulationstation-source/es-app/emulationstation.vcxproj", "<gerado por build na principal>\n")
third("docs/bugs/open/novo-lateral.md", "# lateral\n")   # ja publicado: mesmo conteudo do origin
third("docs/fresco.md", "sendo editado agora\n", aged=False)
os.utime(src / "rascunho-humano.txt", (old, old))
n0 = len(olog())
expect_exit(7, sync, "[finalizacao] final-sync-main termina com pendencia do dono (saida 7)")
new = olog()[:len(olog()) - n0]
check(len(new) == 3 and new[0].startswith("chore(terceiros)") and any("(docs/notas-terceiro.md)" in m for m in new)
      and any(m.startswith("docs(bugs):") and "(docs/bugs/open/c.md)" in m for m in new),
      f"[finalizacao] terceiros no origin: um commit por doc e o codigo por ultimo ({new})")
check(all(len(sh("git", "--git-dir", str(origin), "show", "--name-only", "--format=", h).split()) == 1 for h in olog("%H")[1:3]),
      "[finalizacao] cada commit de doc tem UM arquivo")
check(deploys == [("wt-planning", "build")] and oshow("launcher/batocera-ports.sln") == "sln de terceiro",
      f"[finalizacao] codigo de terceiro so foi publicado depois de compilar numa lane ({deploys})")
check(header() == "## versao3...origin/versao3" and sh("git", "rev-parse", "HEAD", cwd=src) == head_o()
      and (src / "launcher/A.cs").read_text() == "a fix\n",
      f"[finalizacao] C2: arvore principal = origin, sem ahead/behind ({header()})")
check((src / "emulationstation-source/es-app/emulationstation.vcxproj").read_text() == "<gerado por build na principal>\n",
      "[finalizacao] gerado de build modificado na principal fica INTACTO (nao precisa ser descartado)")
porc = sh("git", "status", "--porcelain", cwd=src)
check("?? docs/fresco.md" in porc and "?? rascunho-humano.txt" in porc and "novo-lateral" not in porc
      and (src / "docs/bugs/open/novo-lateral.md").exists(),
      "[finalizacao] arquivo recente e arquivo novo fora de docs/ NAO commitados; `??` identico ao do origin virou rastreado")
rec = P.load()["final"]["sync"]
check(not rec["blocked"] and len(rec["pending"]) == 2 and "fresco.md" in rec["pending"][0] and "rascunho-humano.txt" in rec["pending"][1],
      f"[finalizacao] as duas sobras viram pendencia do dono, com arquivo e data ({rec['pending']})")

P.cmd_final_deploy(None)
dep = P.load()["final"]["deploy"]
check(dep["sha"] == head_o() and deploys[-1] == ("wt-planning", "deploy")
      and dep["files"]["emulatorLauncher.exe"] == P.md5_of(P.DIST_ES / "emulatorLauncher.exe") and not falta("C3"),
      "[finalizacao] C3: final-deploy grava SHA e MD5 do que ficou no dist; portao aceita")

# E4: commit feito direto na principal cujo patch chegou ao origin por outro caminho (duplicado)
lane = P.planning_wt(P.load())
(src / "docs/dup.md").write_text("duplicado\n"); sh("git", "add", "docs/dup.md", cwd=src)
sh("git", "commit", "-q", "-m", "docs: dup (original na principal)", "--", "docs/dup.md", cwd=src)
sh("git", "checkout", "-q", "--detach", "origin/versao3", cwd=lane)
sh("git", "cherry-pick", sh("git", "rev-parse", "HEAD", cwd=src), cwd=lane)
sh("git", "commit", "-q", "--amend", "-m", "docs: dup (recommitado por outro caminho)", cwd=lane)
(lane / "docs/outro.md").write_text("x\n"); sh("git", "add", ".", cwd=lane); sh("git", "commit", "-q", "-m", "docs: outro", cwd=lane)
sh("git", "push", "-q", "origin", "HEAD:versao3", cwd=lane); sh("git", "fetch", "-q", "origin", cwd=src)
check("ahead 1, behind 2" in header(), f"[finalizacao] cenario E4 montado: {header()}")
n0 = len(olog())
expect_exit(7, sync, "[finalizacao] E4: final-sync-main com duplicado")
check(header() == "## versao3...origin/versao3" and len(olog()) == n0 and (src / "docs/dup.md").exists(),
      "[finalizacao] E4: duplicado some com `reset --keep`, nada e republicado, arquivo intacto")

# codigo de terceiro que NAO compila: os docs vao, o codigo fica local e vira pendencia
third("launcher/batocera-ports.sln", "NAO COMPILA\n"); third("docs/notas-terceiro.md", "notas v2\n")
expect_exit(7, sync, "[finalizacao] codigo que nao compila")
rec = P.load()["final"]["sync"]
check("(docs/notas-terceiro.md)" in olog()[0] and oshow("launcher/batocera-ports.sln") == "sln de terceiro"
      and sh("git", "rev-list", "--count", "origin/versao3..HEAD", cwd=src) == "1"
      and (src / "launcher/batocera-ports.sln").read_text() == "NAO COMPILA\n"
      and rec["blocked"] and any("NAO compila" in x for x in rec["pending"]),
      "[finalizacao] nao compila: so o doc foi publicado; o codigo fica em commit local, intacto, com pendencia")
check(falta("C2", "dono") and not falta("C2"), "[finalizacao] portao: principal a frente por codigo que nao compila e decisao do DONO")
(src / "launcher/batocera-ports.sln").write_text("compila agora\n")
sh("git", "commit", "-q", "-m", "conserto do dono", "--", "launcher/batocera-ports.sln", cwd=src)
check(falta("C2") and not falta("C2", "dono"), "[finalizacao] portao: sync velho (a principal mudou) -> manda rodar de novo")
expect_exit(7, sync, "[finalizacao] depois do conserto")
check(olog()[0] == "conserto do dono" and oshow("launcher/batocera-ports.sln") == "compila agora"
      and header() == "## versao3...origin/versao3", "[finalizacao] conserto publicado e principal = origin")
check(any("andou com codigo" in m for m in falta("C3")), "[finalizacao] C3: o origin andou com CODIGO depois do deploy final -> refazer")

# conflito: o origin mexeu na mesma linha que a edicao nao commitada de terceiro
sh("git", "fetch", "-q", "origin", cwd=lane); sh("git", "checkout", "-q", "--detach", "origin/versao3", cwd=lane)
(lane / "es/C.cpp").write_text("c fix v2\n"); sh("git", "commit", "-qam", "fix c v2", cwd=lane)
sh("git", "push", "-q", "origin", "HEAD:versao3", cwd=lane)
third("es/C.cpp", "edicao de terceiro em conflito\n")
h0 = head_o()
expect_exit(7, sync, "[finalizacao] conflito ao rebasear o trabalho de terceiro")
rec = P.load()["final"]["sync"]
check(head_o() == h0 and rec["blocked"] and any("conflito" in x for x in rec["pending"])
      and (src / "es/C.cpp").read_text() == "edicao de terceiro em conflito\n"
      and sh("git", "log", "-1", "--format=%s", cwd=src).startswith("chore(terceiros)"),
      "[finalizacao] conflito: nada publicado, nada perdido (commit local), pendencia do dono")
sh("git", "reset", "-q", "--hard", "origin/versao3", cwd=src)     # o dono decide (aqui: descarta)

P.cmd_final_deploy(None)
P.cmd_final_prepare(None)
sh("git", "mv", "docs/bugs/open/c.md", "docs/bugs/retest/c.md", cwd=lane)
P.cmd_final_docs(ns(message="docs(bugs): c em retest"))
check(not falta("C3"), "[finalizacao] C3: origin andou so com docs depois do deploy final -> nao exige outro build")

# [[pipeline-portao-c4-recusa-doc-documentado-movido-por-outra-sessao-finalizacao-edita-ledger_2026-10-08]]:
# bug `documentado` cujo doc OUTRA sessao moveu de open/ para retest/ (caso real: 234fcb1). Antes, o C4
# recusava e so passava editando o state.json a mao. Controle: `e`, sem doc em pasta nenhuma.
sh("git", "fetch", "-q", "origin", cwd=lane); sh("git", "checkout", "-q", "--detach", "origin/versao3", cwd=lane)
(lane / "docs/bugs/retest/d.md").write_text("# d\nmovido por outra sessao\n")
sh("git", "add", "docs/bugs/retest/d.md", cwd=lane); sh("git", "commit", "-q", "-m", "docs(bugs): d -> retest (outra sessao)", cwd=lane)
sh("git", "push", "-q", "origin", "HEAD:versao3", cwd=lane)
st = P.load()
for s in ("d", "e"):
    st["bugs"][s] = {"state": "documentado", "commit": None, "branch": f"bugfix/{s}",
                     "doc": f"docs/bugs/open/{s}.md", "sessions": {}, "test_round": 0}
P.save(st)
rep = P.final_report(P.load())
c4 = [m for c, k, m in rep if c == "C4" and k == "mecanico"]
check(not any("d (documentado)" in m and "nao existe em" in m for m in c4),
      f"[finalizacao] C4: documentado com doc movido por fora para retest/ NAO e falta no origin ({c4})")
check(any(c == "C4" and k == "ok" and "movido por fora" in m and "retest/d.md" in m for c, k, m in rep),
      "[finalizacao] C4: o doc movido aparece como OK, com o caminho achado")
check(any("retest/d.md nao existe na arvore principal" in m for m in c4),
      "[finalizacao] C4: a conferencia da arvore principal usa o caminho ACHADO (a principal esta atras)")
check(any("e (documentado): docs/bugs/open/e.md nao existe em origin" in m for m in c4),
      "[finalizacao] C4 controle: documentado sem doc em pasta nenhuma continua mecanico")
st = P.load(); del st["bugs"]["e"]; P.save(st)
brief = P.briefing_path(P.load()); brief.parent.mkdir(parents=True, exist_ok=True)
brief.write_text("# Briefing t\n- c: [retest](../../source/docs/bugs/retest/c.md)\n- a: [open](../../source/docs/bugs/open/a.md)"
                 " [morto](../../source/docs/bugs/retest/nao-existe.md)\n", encoding="utf-8")
sh("git", "branch", "bugfix/c", "origin/versao3", cwd=src)          # branch de bug que o clean_wt nao apagou
c1, c4 = falta("C1"), falta("C4")
check(any("bugfix/c sobrou" in m for m in c1) and any("bugfix/a-wip" in m for m in c1) and any("pipeline-sobra c" in m for m in c1),
      f"[finalizacao] C1: branch de bug sobrando; -wip e stash mantidos tem que estar no briefing ({c1})")
check(any("link morto" in m and "nao-existe.md" in m for m in c4) and any("retest/c.md nao existe na arvore principal" in m for m in c4)
      and falta("C2"), f"[finalizacao] C4: link morto e doc ausente na principal (atras de novo: mecanico) ({c4})")
expect_exit(7, sync, "[finalizacao] final-sync-main de novo")

# [[pipeline-publish-recusa-branch-que-remove-gerado-do-indice-saida-5_2026-10-07]] gerado rastreado que o
# build regravou na principal e que o origin APAGA: antes o ff abortava inteiro (pendencia "recusou").
anda("rgs/obj/Release/t3.cache", "saida de build\n", "cache versionado (t3)")
expect_exit(7, sync, "[finalizacao] principal recebe o gerado versionado")
check(sh("git", "rev-parse", "HEAD", cwd=src) == head_o() and (src / "rgs/obj/Release/t3.cache").exists(),
      "[finalizacao] cenario: gerado rastreado na principal")
third("rgs/obj/Release/t3.cache", "regravado pelo build na principal\n")
third("emulationstation-source/es-app/emulationstation.vcxproj", "<gerado por build na principal>\n")
sh("git", "pull", "-q", "--ff-only", cwd=outro); sh("git", "rm", "-q", "rgs/obj/Release/t3.cache", cwd=outro)
sh("git", "commit", "-qm", "tira o cache do indice (t3)", cwd=outro); sh("git", "push", "-q", "origin", "versao3", cwd=outro)
expect_exit(7, sync, "[finalizacao] origin apaga gerado que a principal tem modificado")
rec = P.load()["final"]["sync"]
check(sh("git", "rev-parse", "HEAD", cwd=src) == head_o() and not rec["blocked"]
      and not any("recusou" in x for x in rec["pending"]) and not (src / "rgs/obj/Release/t3.cache").exists(),
      f"[finalizacao] gerado modificado que o origin apaga sai do disco e a principal = origin ({rec['pending']})")
check((src / "emulationstation-source/es-app/emulationstation.vcxproj").read_text() == "<gerado por build na principal>\n",
      "[finalizacao] gerado modificado que o origin MANTEM continua intacto")
(P.DIST_ES / "emulatorLauncher.exe").write_text("launcher de OUTRO deploy, sem o fix\n")
check(any("mudou depois do deploy final" in m for m in falta("C3")), "[finalizacao] C3: dist trocado depois do deploy final (E6) -> portao ve")
P.cmd_final_deploy(None)
check(not falta("C3") and not falta("C2"), "[finalizacao] C2 e C3 de volta")

# C5: lanes fora do ledger, resto de remove parcial (processo numa SUBPASTA), pasta de origem desconhecida
wt9 = P.WTS / "wt-9"
sh("git", "worktree", "add", "-q", "--detach", str(wt9), "origin/versao3", cwd=src)
(P.WTS / "vazia").mkdir(); (P.WTS / "desconhecida").mkdir(); (P.WTS / "desconhecida/arquivo.txt").write_text("de quem?\n")
check(any("wt-9" in m for m in falta("C5")), "[finalizacao] C5: worktree fora do ledger ainda registrada -> portao ve")
holder = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], cwd=wt9 / "docs")
time.sleep(1)
try:
    P.cmd_cleanup(None)
    check(not lane.exists() and not (P.WTS / "vazia").exists() and "wt-9" not in sh("git", "worktree", "list", cwd=src),
          "[finalizacao] cleanup remove a lane do ledger, a worktree FORA do ledger e a pasta vazia")
    check(wt9.exists() and not any(f.is_file() for f in wt9.rglob("*")),
          "[finalizacao] processo em subpasta: os arquivos que o git deixou saem; so a pasta presa fica")
    check((P.WTS / "desconhecida/arquivo.txt").exists(), "[finalizacao] pasta de origem desconhecida NAO e apagada")
    check("bugfix/c" not in branches() and "bugfix/a-wip" in branches(), "[finalizacao] cleanup apaga o branch do bug terminado; -wip fica")
finally:
    holder.kill(); holder.wait()
time.sleep(1)
P.ensure_wt({"worktrees": {}, "base": "origin/versao3"}, "wt-9")
check((wt9 / ".git").is_file(), "[finalizacao] a lane que ficou so com subpasta vazia e reaproveitada (worktree add ok)")
P.cmd_cleanup(None)
check(not wt9.exists() and [d.name for d in P.WTS.iterdir()] == ["desconhecida"], "[finalizacao] 2a passada: so a pasta desconhecida sobra")

# o portao fecha: com pendencia que e decisao do dono, e depois sem nenhuma
stops = []
P.schedule_stop_final = lambda: stops.append(1)
expect_exit(2, lambda: P.cmd_final_done(ns(note="x")), "[finalizacao] final-done ainda recusa: link morto e -wip/stash fora do briefing")
kept = [b for b in branches() if "-wip" in b] + ["pipeline-sobra c"]
brief.write_text("# Briefing t\n- c: [retest](../../source/docs/bugs/retest/c.md)\n- a: [open](../../source/docs/bugs/open/a.md)\n"
                 "Mantidos de proposito: " + ", ".join(kept) + "\n", encoding="utf-8")
P.cmd_final_done(ns(note="fim"))
d, text = P.load(), brief.read_text(encoding="utf-8")
check(d["final"]["state"] == "concluido-com-pendencias" and stops == [1]
      and all(any(w in x for x in d["final"]["pendencias"]) for w in ("fresco.md", "rascunho-humano.txt", "desconhecida")),
      f"[finalizacao] fecha como concluido-com-pendencias, so com decisao do dono ({d['final']['pendencias']})")
check(text.count(P.BLOCK[0]) == 1 and "PENDENCIA DO DONO" in text and "| C3 | OK |" in text and "Mantidos de proposito" in text,
      "[finalizacao] C6: o helper grava no briefing o estado que ELE mediu, sem apagar o texto da sessao")
(src / "docs/fresco.md").unlink(); (src / "rascunho-humano.txt").unlink(); shutil.rmtree(P.WTS / "desconhecida")
d["final"]["state"] = "rodando"; P.save(d)
expect_exit(0, sync, "[finalizacao] sem sobra de terceiros: final-sync-main sai 0")
P.cmd_final_done(ns(note="fim"))
d, text = P.load(), brief.read_text(encoding="utf-8")
check(d["final"]["state"] == "concluido" and not d["final"]["pendencias"] and text.count(P.BLOCK[0]) == 1
      and "nenhuma." in text and "FALTA" not in text and header() == "## versao3...origin/versao3",
      "[finalizacao] tudo medido e sem pendencia -> concluido; bloco do briefing substituido, nao duplicado")
check("| C4 | OK | d (documentado): doc movido por fora do pipeline para docs/bugs/retest/d.md |" in text
      and "| C4 | OK | docs na pasta do estado" in text,
      "[finalizacao] C4: final-done fecha com o documentado movido por fora, sem editar o ledger; nota e ok geral no briefing")

# ---- [outro projeto] DESIGN secao 22 (T1): o motor com a config de OUTRO projeto, numa copia nova do modulo.
# Cenario do ARMSX2-forkv2: a skill mora num repo que e WORKTREE de outro checkout; remoto `fork`, base
# `fork/main`; sem deploy, sem gerados, sem e2e, sem rodizio.
Q = importlib.util.module_from_spec(spec); spec.loader.exec_module(Q)
origin2 = tmp / "origin2.git"; sh("git", "init", "-q", "--bare", "-b", "main", str(origin2))
mainrepo = tmp / "play2-main"; sh("git", "init", "-q", "-b", "master", str(mainrepo))
for k, v in (("user.email", "t@t"), ("user.name", "t")):
    sh("git", "config", k, v, cwd=mainrepo)
(mainrepo / "docs/bugs/open").mkdir(parents=True); (mainrepo / "docs/bugs/open/o.md").write_text("# o\n")
(mainrepo / "x/bin/Release").mkdir(parents=True); (mainrepo / "x/bin/Release/a.dll").write_text("dll versionada\n")
sh("git", "add", ".", cwd=mainrepo); sh("git", "commit", "-qm", "base2", cwd=mainrepo)
sh("git", "remote", "add", "fork", str(origin2), cwd=mainrepo); sh("git", "push", "-q", "fork", "master:main", cwd=mainrepo)
sh("git", "fetch", "-q", "fork", cwd=mainrepo)
forkv2 = tmp / "forkv2"; sh("git", "worktree", "add", "-q", "-b", "main", str(forkv2), "fork/main", cwd=mainrepo)
skill2 = forkv2 / "skills" / "pipeline-correcao-bugs"; skill2.mkdir(parents=True)
cfg2 = {"nome": "Outro", "remoto": "fork", "base": "fork/main", "rodizio_contas": False, "commit_docs": "chore(bugs)",
        "build": {"cmd": [sys.executable, "-c", "import sys,pathlib; pathlib.Path(sys.argv[1],'built.txt').write_text('ok')", "{wt}"],
                  "lock": "outro-build"}}
Q.configure(cfg2, skill2)
check(Q.SRC == forkv2.resolve() and Q.ROOT == Q.SRC and Q.PIPE == tmp.resolve() / ".bugfix-pipeline-forkv2"
      and Q.SRC not in Q.PIPE.parents, f"[outro projeto] SRC = a worktree, PIPE fora do repo ({Q.SRC}, {Q.PIPE})")
check((Q.SRC / ".git").is_file() and Q.git_dir() and Q.git_dir().is_dir()
      and (mainrepo / ".git" / "worktrees").resolve() in Q.git_dir().parents,
      f"[outro projeto] .git da arvore principal pelo git (worktree: .git e arquivo): {Q.git_dir()}")
check(not Q.GENERATED.search("x/bin/Release/a.dll") and Q.DEPLOY_CFG is None and Q.DIST_ES is None and not Q.DEPLOYED
      and Q.norm("source/x.cpp") == "source/x.cpp", "[outro projeto] sem gerados, sem deploy, sem prefixo 'source/'")
check(Q.foreign_processes() == [], "[outro projeto] sem e2e: ambiente sempre livre (nem chama o PowerShell)")
expect_exit(2, lambda: Q.project_cmd(forkv2, "deploy"), "[outro projeto] sem deploy no projeto.json: deploy recusa")
check(not Q.needs_deploy({"bugs": {"o": {"test_round": 2}}}), "[outro projeto] C3: sem deploy, nao ha instalado a conferir")
# rodizio desligado: nada escreve na guarda de contas da MAQUINA (o restore_login devolveria o /login de outro projeto)
check(not Q.rotation_on({"order": ["c1", "c2"]}) and Q.gate_now() == (False, None, None)
      and Q.restore_login({"applied": True}, 0, "t") == "nada",
      "[outro projeto] rodizio_contas falso: sem rodizio, sem portao, restore_login nao toca o arquivo de credenciais")
expect_exit(2, lambda: Q.cmd_accounts(types.SimpleNamespace(acmd="activate", label="c1")),
            "[outro projeto] accounts que grava recusa num projeto sem rodizio")
out = io.StringIO()
with contextlib.redirect_stdout(out):
    Q.cmd_quota_watch(types.SimpleNamespace(origem="t"))
check("sem vigia de cota" in out.getvalue(), "[outro projeto] quota-watch sai na hora num projeto sem rodizio")
# init: base do projeto.json; base de outro remoto recusada
plan2 = tmp / "plan2.json"; plan2.write_text(json.dumps({"bugs": [{"slug": "o", "doc": "docs/bugs/open/o.md"}]}))
init2 = lambda base: Q.cmd_init(types.SimpleNamespace(bugs=str(plan2), base=base, model="m", effort="medium", max_returns=3,
                                                      max_planning=1, max_dev=1, permission_mode="auto", force=True))
expect_exit(2, lambda: init2("origin/main"), "[outro projeto] init --base de outro remoto recusa")
init2(None)
st2 = json.loads(Q.STATE.read_text(encoding="utf-8"))
check(st2["base"] == "fork/main" and st2["branch"] == "main" and Q.STATE.parent == Q.PIPE,
      "[outro projeto] init sem --base usa a base do projeto.json, ledger no PIPE do projeto")
# lane, build da config, publish pelo remoto `fork`
st2["bugs"]["o"].update(wt="wt-1")
lane2 = Q.ensure_wt(st2, "wt-1")
for k, v in (("user.email", "t@t"), ("user.name", "t")):
    sh("git", "config", k, v, cwd=lane2)
Q.checkout_fresh(lane2, "fork/main", "bugfix/o")
Q.project_cmd(lane2, "build")
check((lane2 / "built.txt").read_text() == "ok", "[outro projeto] build = o cmd do projeto.json, com {wt} trocado")
(lane2 / "built.txt").unlink()
Q.BUILD = dict(cfg2["build"], cmd=[sys.executable, "-c", "raise SystemExit(4)"])
expect_exit(3, lambda: Q.project_cmd(lane2, "build"), "[outro projeto] build que falha -> saida 3")
(lane2 / "x/bin/Release/a.dll").write_text("dll regravada\n"); sh("git", "commit", "-qam", "fix o", cwd=lane2)
Q.publish_head(st2, lane2)
check(sh("git", "--git-dir", str(origin2), "log", "-1", "--format=%s", "main") == "fix o",
      "[outro projeto] publish rebaseia e empurra no remoto `fork` (sem gerados: a dll em bin/Release e fonte aqui)")
expect_exit(13, lambda: Q.guard_wt(forkv2), "[outro projeto] guard_wt recusa a arvore principal (a worktree)")
expect_exit(13, lambda: Q.git("reset", "--hard"), "[outro projeto] git que escreve na arvore principal (worktree) recusado")
expect_exit(13, lambda: Q.guard_wt(mainrepo), "[outro projeto] guard_wt recusa o checkout principal do repo comum")
# sync_main ve operacao em curso no .git DA WORKTREE (antes: SRC/.git/rebase-merge, que numa worktree nao existe)
(Q.git_dir() / "rebase-merge").mkdir()
rec2 = Q.sync_main({"base": "fork/main", "branch": "main", "run_id": "o", "worktrees": {}})
(Q.git_dir() / "rebase-merge").rmdir()
check(rec2["blocked"] and "rebase-merge" in rec2["pending"][0], f"[outro projeto] sync_main ve o rebase da worktree ({rec2['pending']})")

# ---- [copias] DESIGN 22.8 A2 (T3): sync_copias.py + aviso do preflight. Fonte = repo temporario com os
# arquivos sincronizados da skill real (o --commit exige fonte commitada); destino = outro repo com projeto.json.
sspec = importlib.util.spec_from_file_location("sync_copias", Path(__file__).with_name("sync_copias.py"))
S = importlib.util.module_from_spec(sspec); sspec.loader.exec_module(S)
def mkrepo(path):
    sh("git", "init", "-q", "-b", "main", str(path))
    for k, v in (("user.email", "t@t"), ("user.name", "t"), ("core.autocrlf", "false")):
        sh("git", "config", k, v, cwd=path)
fonte_repo = tmp / "fonte-repo"; mkrepo(fonte_repo)
fonte = fonte_repo / "skills" / "pipeline-correcao-bugs"
for rel in P.synced_files(P.SKILL):
    (fonte / rel).parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(P.SKILL / rel, fonte / rel)
(fonte / "projeto.json").write_text('{"nome": "fonte"}'); (fonte / "projeto.md").write_text("manual da fonte\n")
sh("git", "add", ".", cwd=fonte_repo); sh("git", "commit", "-qm", "fonte", cwd=fonte_repo)
dst_repo = tmp / "dst-repo"; mkrepo(dst_repo)
dst = dst_repo / ".claude" / "skills" / "pipeline-correcao-bugs"; dst.mkdir(parents=True)
(dst / "projeto.json").write_text('{"nome": "destino"}\n'); (dst / "projeto.md").write_text("manual do destino\n")
sh("git", "add", ".", cwd=dst_repo); sh("git", "commit", "-qm", "base dst", cwd=dst_repo)
sync = lambda *a: S.main(["--fonte", str(fonte), "--destino", str(dst), *a])
def quiet(fn):
    o = io.StringIO()
    with contextlib.redirect_stdout(o):
        rc = fn()
    return rc, o
rc, out = quiet(lambda: sync("--check"))
check(rc == 1 and "scripts/pipeline.py (falta)" in out.getvalue() and "etapas/dev.md (falta)" in out.getvalue(),
      "[copias] destino vazio: --check sai 1 e lista o que falta")
rc, out = quiet(lambda: S.main(["--fonte", str(fonte), "--destino", str(tmp / "nao-instalado"), "--check"]))
check(rc == 0 and "T4 pendente" in out.getvalue(), "[copias] destino sem projeto.json e pulado (skill nao instalada)")
(fonte / "SKILL.md").write_text("fonte suja\n")
rc, out = quiet(lambda: sync("--commit"))
check(rc == 2 and "[RECUSA]" in out.getvalue() and not (dst / "SKILL.md").exists(),
      "[copias] --commit recusa fonte com mudanca nao commitada (a copia cita o commit da fonte)")
sh("git", "checkout", "--", "skills/pipeline-correcao-bugs/SKILL.md", cwd=fonte_repo)
rc, out = quiet(lambda: sync("--commit"))
check(rc == 0 and P.copy_diff(fonte, dst) == [] and (dst / "projeto.json").read_text() == '{"nome": "destino"}\n'
      and (dst / "projeto.md").read_text() == "manual do destino\n",
      "[copias] sync --commit: copia igual a fonte, projeto.json/projeto.md do destino intactos")
check(sh("git", "log", "-1", "--format=%s", cwd=dst_repo).startswith("chore: skill pipeline-correcao-bugs copiada da fonte (")
      and sh("git", "status", "--porcelain", cwd=dst_repo) == "",
      "[copias] commit no destino com assunto chore: (passa no check_traceability do ARMSX2), arvore limpa")
# divergencia plantada numa copia commitada e depois editada (trabalho de outra sessao): aponta e nao sobrescreve
(dst / "etapas/dev.md").write_text("editada no destino\n")
rc, out = quiet(lambda: sync("--check"))
check(rc == 1 and "etapas/dev.md (difere)" in out.getvalue(), "[copias] --check aponta a divergencia plantada")
rc, out = quiet(lambda: sync())
check(rc == 2 and (dst / "etapas/dev.md").read_text() == "editada no destino\n",
      "[copias] arquivo rastreado com mudanca nao commitada no destino: sync recusa e nao toca")
sh("git", "checkout", "--", ".claude/skills/pipeline-correcao-bugs/etapas/dev.md", cwd=dst_repo)
(dst / "etapas/dev.md").write_bytes((fonte / "etapas/dev.md").read_bytes().replace(b"\n", b"\r\n"))
check(P.copy_diff(fonte, dst) == [], "[copias] so fim de linha diferente (autocrlf do destino) nao e divergencia")
sh("git", "checkout", "--", ".claude/skills/pipeline-correcao-bugs/etapas/dev.md", cwd=dst_repo)
(dst / "etapas/velha.md").write_text("etapa que a fonte apagou\n"); sh("git", "add", ".", cwd=dst_repo)
sh("git", "commit", "-qm", "velha", cwd=dst_repo)
(fonte / "etapas/teste.md").write_text("teste mudou na fonte\n"); sh("git", "commit", "-qam", "fonte 2", cwd=fonte_repo)
rc, out = quiet(lambda: sync("--commit"))
check(rc == 0 and not (dst / "etapas/velha.md").exists() and P.copy_diff(fonte, dst) == []
      and sh("git", "status", "--porcelain", cwd=dst_repo) == ""
      and sh("git", "show", "--name-status", "--format=", "HEAD", cwd=dst_repo).split()
          == ["M", ".claude/skills/pipeline-correcao-bugs/etapas/teste.md", "D", ".claude/skills/pipeline-correcao-bugs/etapas/velha.md"],
      "[copias] sobra apagada e mudanca da fonte levada, no mesmo commit")
# aviso do preflight: na fonte nada; numa copia igual [OK]; divergente [AVISO] com o comando
P.FONTE, skill0 = fonte, P.SKILL
check(P.copy_warning() and P.copy_warning().startswith("[AVISO]") and "sync_copias.py" in P.copy_warning(),
      "[copias] preflight de uma skill que difere da fonte: [AVISO] com o comando de sincronizar")
P.SKILL = dst.resolve()
check(P.copy_warning().startswith("[OK]"), "[copias] preflight de copia igual a fonte: [OK]")
(dst / "SKILL.md").write_text("velha\n")
check("SKILL.md (difere)" in P.copy_warning(), "[copias] preflight aponta o arquivo que difere")
P.SKILL = P.FONTE = fonte.resolve()
check(P.copy_warning() is None, "[copias] preflight na propria fonte: sem linha")
P.SKILL = skill0
# ---- [tasks] DESIGN 22.9 (B2): itens do tipo task e task exigida pelo fix de bug, numa copia nova do modulo com
# config ARMSX2-like: bugs em open/<area>/ e retest/ plano; task = campo `Status`, numero unico no ramo; gancho
# pre-push REAL que recusa assunto fora de `TASK-NNNN:`/`chore:`; `antes_do_push` que escreve o indice.
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
R.agents = lambda: []; R.spawn = lambda *a, **k: None; R.tick = lambda *a, **k: None
origin3 = tmp / "origin3.git"; sh("git", "init", "-q", "--bare", "-b", "main", str(origin3))
src3 = tmp / "arm3"; sh("git", "clone", "-q", str(origin3), str(src3))
for k, v in (("user.email", "t@t"), ("user.name", "t"), ("core.autocrlf", "false")):
    sh("git", "config", k, v, cwd=src3)
def put(root, rel, text, crlf=False):
    f = root / rel; f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes((text.replace("\n", "\r\n") if crlf else text).encode("utf-8")); return f
def task_md(n, slug, status, bug=""):
    return (f"# TASK-{n:04d}: {slug}\n\n- **Status:** {status}\n- **Criada em:** 2026-10-09\n- **Concluída em:** —\n"
            f"- **Bugs que resolve:** {bug or 'nenhum'}\n- **Commit:** —\n\n## Objetivo\n\n{slug}\n")
put(src3, "code/x.c", "x\n"); put(src3, "code/w.c", "w\n"); put(src3, "docs/bugs/retest/README.md", "r\n"); put(src3, "docs/task/README.md", "| Task | Commit |\n|---|---|\n| [TASK-0202] | x |\n")
put(src3, "docs/bugs/open/area/b1.md", "# b1\n- **Tasks que o resolvem:** TASK-0200\n")
put(src3, "docs/bugs/open/area/b2.md", "# b2\n")
put(src3, "docs/task/TASK-0200-velha.md", task_md(200, "velha", "aberta", "[b1](../bugs/open/area/b1.md)"), crlf=True)
put(src3, "docs/task/TASK-0201-item.md", task_md(201, "item", "aberta"))
put(src3, "docs/task/TASK-0202-feita.md", task_md(202, "feita", "concluída"))
skill3 = src3 / "skills" / "pipeline-correcao-bugs"; put(skill3, "projeto.md", "manual\n")
sh("git", "add", ".", cwd=src3); sh("git", "commit", "-qm", "chore: base3", cwd=src3); sh("git", "push", "-q", "origin", "main", cwd=src3)
hooks3 = tmp / "hooks3"; hooks3.mkdir()
(hooks3 / "pre-push").write_bytes(
    b"#!/bin/sh\n"
    b"if [ -f \"" + str(tmp / "corrida-uma-vez").replace("\\", "/").encode() + b"\" ]; then rm -f \"" +
    str(tmp / "corrida-uma-vez").replace("\\", "/").encode() + b"\"; echo ' ! [rejected]        HEAD -> main (fetch first)' >&2; exit 1; fi\n"
    b"while read l ls r rs; do\n"
    b"  case $rs in 0000000000000000000000000000000000000000) range=$ls;; *) range=$rs..$ls;; esac\n"
    b"  if git log --format=%s \"$range\" | grep -vqE '^(TASK-[0-9]{4}:|chore:)'; then\n"
    b"    echo 'gancho: assunto fora de TASK-NNNN:/chore:' >&2; exit 1; fi\n"
    b"done\nexit 0\n")
sh("git", "config", "core.hooksPath", str(hooks3).replace("\\", "/"), cwd=src3)
index_py = ("import pathlib,re\n"
            "idx=pathlib.Path('docs/task/README.md'); t=idx.read_text(encoding='utf-8')\n"
            "for f in sorted(pathlib.Path('docs/task').glob('TASK-*.md')):\n"
            "    tid=f.name[:9]\n"
            "    if '- **Status:** concluída' in f.read_text(encoding='utf-8') and '['+tid+']' not in t: t+='| ['+tid+'] | x |\\n'\n"
            "idx.write_bytes(t.encode('utf-8'))\n")
cfg3 = {"nome": "Arm3", "remoto": "origin", "base": "origin/main", "rodizio_contas": False, "commit_docs": "chore",
        "commit_docs_outros": "chore", "commit_terceiros": "chore", "retest_sem_subpasta": True,
        "build": {"cmd": [sys.executable, "-c", "pass"], "lock": "arm3-build"},
        "tarefas": {"pasta": "docs/task", "arquivo": r"^TASK-(\d{4})-.+\.md$", "id": "TASK-{n:04d}", "minimo": 200,
                    "campo_concluida_em": "Concluída em", "bug_exige_task": True},
        "antes_do_push": {"cmd": [sys.executable, "-c", index_py], "assunto": "chore: indice das tasks (pipeline)"}}
R.configure(cfg3, skill3)
check(R.retest_path("docs/bugs/open/area/b1.md") == "docs/bugs/retest/b1.md"
      and R.stage_path("docs/bugs/open/area/b1.md", "done") == "docs/bugs/done/b1.md"
      and R.retest_path("docs/task/TASK-0201-item.md") is None
      and P.retest_path("docs/bugs/open/area/x.md") == "docs/bugs/retest/area/x.md",
      "[tasks] retest/done sem subpasta so com `retest_sem_subpasta`; task nao muda de pasta")
olog = lambda: sh("git", "--git-dir", str(origin3), "log", "--format=%s", "main").splitlines()
oshow = lambda f: subprocess.run(["git", "--git-dir", str(origin3), "show", f"main:{f}"], capture_output=True, text=True,
                                 encoding="utf-8").stdout
# init: tipo do item; task sem `tarefas` ou com nome errado recusa ANTES de tocar o ledger
plan3 = tmp / "plan3.json"
def init3(items):
    plan3.write_text(json.dumps({"bugs": items}))
    R.cmd_init(types.SimpleNamespace(bugs=str(plan3), base=None, model="m", effort="medium", max_returns=3,
                                     max_planning=4, max_dev=4, permission_mode="auto", force=True))
expect_exit(2, lambda: init3([{"slug": "t", "doc": "docs/task/sem-numero.md", "tipo": "task"}]),
            "[tasks] init: item task cujo doc nao casa `tarefas.arquivo` recusa")
plan3.write_text(json.dumps({"bugs": [{"slug": "t", "doc": "docs/task/TASK-0201-item.md", "tipo": "task"}]}))
expect_exit(2, lambda: P.cmd_init(types.SimpleNamespace(bugs=str(plan3), base=None, model="m", effort="m", max_returns=3,
                                                        max_planning=1, max_dev=1, permission_mode="auto", force=True)),
            "[tasks] init: item task num projeto sem `tarefas` recusa")
init3([{"slug": "b1", "doc": "docs/bugs/open/area/b1.md"}, {"slug": "b2", "doc": "docs/bugs/open/area/b2.md"},
       {"slug": "t1", "doc": "docs/task/TASK-0201-item.md", "tipo": "task"}])
st3 = R.load()
check([st3["bugs"][s].get("tipo") for s in ("b1", "b2", "t1")] == ["bug", "bug", "task"], "[tasks] init grava o tipo do item")
pw3 = R.ensure_wt(st3, "wt-planning"); R.checkout_fresh(pw3, "origin/main", None)
for s in st3["bugs"]:
    st3["bugs"][s]["state"] = "planning"
R.save(st3)
st3["bugs"]["t1"].update(plan={"files": [], "effort": {}, "ultrathink": {}}, wave=1, wt="wt-planning")
txt = R.stage_prompt(st3, "t1", "dev", "")
check("Task: t1" in txt and "Doc da task" in txt and "`TASK-0201: ...`" in txt, "[tasks] prompt do item task: Task, doc da task e o assunto do commit")
st3["bugs"]["t1"].update(plan=None, wt=None)
check("exige TASK" in R.stage_prompt(st3, "b2", "planning", ""), "[tasks] prompt do planning de bug avisa que o projeto exige task")
R.save(st3)
# task-reserve: maior entre base (200-202), arquivo NAO commitado na arvore principal (205), assunto de commit
# noutro ramo (207) e reservas do ledger, + 1; idempotente; so no planning
put(src3, "docs/task/TASK-0205-humana.md", "sessao humana, sem commit\n")
outro3 = tmp / "outro3"; sh("git", "clone", "-q", str(origin3), str(outro3))
for k, v in (("user.email", "t@t"), ("user.name", "t")):
    sh("git", "config", k, v, cwd=outro3)
sh("git", "checkout", "-q", "-b", "feature", cwd=outro3); put(outro3, "f.txt", "f\n"); sh("git", "add", ".", cwd=outro3)
sh("git", "commit", "-qm", "TASK-0207: noutro ramo", cwd=outro3); sh("git", "push", "-q", "origin", "feature", cwd=outro3)
sh("git", "fetch", "-q", "origin", cwd=src3)
reserve = lambda s: R.cmd_task_reserve(types.SimpleNamespace(bug=s))
reserve("b1"); reserve("b2"); reserve("b1")
res3 = R.load()["task_reservas"]
check(res3 == {"b1": 208, "b2": 209}, f"[tasks] task-reserve: 1 + maior de base/arvores/log/ledger, idempotente ({res3})")
(src3 / "docs/task/TASK-0205-humana.md").unlink()
# plan-done: task reaproveitada, task nova com a reserva, e as recusas
pl = lambda **kw: {"verdict": "corrigir", "complexity": "baixa", "severity": "alto", "files": ["code/x.c"],
                   "effort": {"dev": "low", "teste": "low"}, "ultrathink": {"dev": False, "teste": False}, **kw}
st3 = R.load()
p1 = R.validate_plan(st3, "b1", pl(task="docs/task/TASK-0200-velha.md"))
check(p1["task"] == "docs/task/TASK-0200-velha.md" and p1["task_status"] == "aberta",
      "[tasks] plan-done: task existente que cita o bug reaproveitada (sem reserva)")
expect_exit(2, lambda: R.validate_plan(st3, "b2", pl()), "[tasks] plan-done: bug sem task num projeto que exige task recusa")
put(pw3, "docs/bugs/open/area/b2.md", "# b2\n- **Tasks que o resolvem:** TASK-0209\n")
put(pw3, "docs/task/TASK-0208-b2.md", task_md(208, "b2", "aberta", "[b2](../bugs/open/area/b2.md)"))
expect_exit(2, lambda: R.validate_plan(st3, "b2", pl(task="docs/task/TASK-0208-b2.md")),
            "[tasks] plan-done: task nova com o numero reservado para OUTRO item recusa")
(pw3 / "docs/task/TASK-0208-b2.md").unlink()
new = put(pw3, "docs/task/TASK-0209-b2.md", task_md(209, "b2", "concluída", "[b2](../bugs/open/area/b2.md)"))
expect_exit(2, lambda: R.validate_plan(st3, "b2", pl(task="docs/task/TASK-0209-b2.md")), "[tasks] plan-done: task concluida recusa")
put(pw3, "docs/task/TASK-0209-b2.md", task_md(209, "b2", "aberta"))
expect_exit(2, lambda: R.validate_plan(st3, "b2", pl(task="docs/task/TASK-0209-b2.md")),
            "[tasks] plan-done: task que nao cita o doc do bug recusa (link cruzado)")
put(pw3, "docs/task/TASK-0209-b2.md", task_md(209, "b2", "aberta", "[b2](../bugs/open/area/b2.md)"))
put(pw3, "docs/task/TASK-0209-outra.md", "colisao\n")
expect_exit(2, lambda: R.validate_plan(st3, "b2", pl(task="docs/task/TASK-0209-b2.md")), "[tasks] plan-done: numero repetido na pasta recusa")
(pw3 / "docs/task/TASK-0209-outra.md").unlink()
expect_exit(2, lambda: R.validate_plan(st3, "b2", pl(task="docs/task/TASK-0209-b2.md", depende_de=["zz"])),
            "[tasks] plan-done: depende_de com slug fora da execucao recusa")
p2 = R.validate_plan(st3, "b2", pl(task="docs/task/TASK-0209-b2.md", depende_de=["b1"]))
pt = R.validate_plan(st3, "t1", pl())
check(p2["task"].endswith("TASK-0209-b2.md") and p2["depende_de"] == ["b1"] and pt["task"] is None
      and pt["task_status"] == "aberta", "[tasks] plan-done: task nova reservada aceita; item task nao precisa de `task`")
# os docs do planning (task nova inclusa) passam pelo gancho com o assunto `chore:`
sh("git", "add", "docs", cwd=pw3); sh("git", "commit", "-qm", f"{R.COMMIT_DOCS}: planejamento da execucao", cwd=pw3)
R.publish_head(st3, pw3)
check(olog()[0] == "chore: planejamento da execucao" and "TASK-0209" in oshow("docs/task/TASK-0209-b2.md"),
      "[tasks] docs do planning (task nova) publicados com `chore:`, o gancho aceita")
st3["bugs"]["b1"].update(plan=p1, state="dev", wt="wt-1", branch="bugfix/b1", synced_base=None)
st3["bugs"]["b2"].update(plan=p2, state="dev", wt="wt-2", branch="bugfix/b2", synced_base=None)
lb1, lb2 = R.ensure_wt(st3, "wt-1"), R.ensure_wt(st3, "wt-2"); R.save(st3)
# gancho recusa o assunto `fix ...`: saida 17 na hora, sem as 3 tentativas de corrida, origin intocado
R.checkout_fresh(lb2, "origin/main", "bugfix/ruim")
put(lb2, "code/x.c", "fix sem task\n"); sh("git", "commit", "-qam", "fix b2", cwd=lb2)
before3, out = olog(), io.StringIO()
with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
    expect_exit(17, lambda: R.publish_head(st3, lb2), "[tasks] push recusado pelo gancho -> saida 17")
check("tentativa" not in out.getvalue() and "gancho: assunto" in out.getvalue() and olog() == before3,
      "[tasks] saida 17 sem repetir, com a saida do gancho; nada publicado")
# enqueue-test exige o commit `<id>:` no branch
R.checkout_fresh(lb2, "origin/main", "bugfix/b2")
put(lb2, "code/x.c", "fix b2\n"); sh("git", "commit", "-qam", "conserta b2", cwd=lb2)
expect_exit(2, lambda: R.cmd_enqueue_test(types.SimpleNamespace(bug="b2")), "[tasks] enqueue-test sem commit `TASK-0209:` recusa")
sh("git", "reset", "-q", "--hard", "origin/main", cwd=lb2)
put(lb2, "code/x.c", "fix b2\n"); sh("git", "commit", "-qam", "TASK-0209: conserta b2", cwd=lb2)
R.cmd_enqueue_test(types.SimpleNamespace(bug="b2"))
check(R.load()["bugs"]["b2"]["state"] == "teste", "[tasks] enqueue-test com `TASK-0209:` no branch segue para o teste")
# Passo 8: bug para retest/ (plano) e task `concluída`; o `antes_do_push` poe a linha no indice; corrida 1 vez:
# o commit do indice e desfeito e refeito, e o push passa no gancho
st3 = R.load(); st3["bugs"]["b2"]["synced_base"] = sh("git", "rev-parse", "origin/main", cwd=lb2); R.save(st3)
(lb2 / "docs/bugs/retest").mkdir(parents=True, exist_ok=True)
sh("git", "mv", "docs/bugs/open/area/b2.md", "docs/bugs/retest/b2.md", cwd=lb2)
f9 = lb2 / "docs/task/TASK-0209-b2.md"; f9.write_bytes(f9.read_bytes().replace("aberta".encode(), "concluída".encode()))
sh("git", "commit", "-qam", "chore: b2 corrigido e testado -> retest", cwd=lb2)
check(R.task_done_errors(st3, st3["bugs"]["b2"], lb2) == [], "[tasks] test-done pass: task concluida + commit TASK-0209: -> sem erro")
(tmp / "corrida-uma-vez").write_text("1")
out = io.StringIO()
with contextlib.redirect_stdout(out):
    sha3 = R.publish_head(st3, lb2)
log3 = olog()
check("tentativa 1" in out.getvalue() and log3[:3] == ["chore: indice das tasks (pipeline)", "chore: b2 corrigido e testado -> retest",
      "TASK-0209: conserta b2"] and "[TASK-0209]" in oshow("docs/task/README.md") and log3.count("chore: indice das tasks (pipeline)") == 1,
      f"[tasks] antes_do_push: indice commitado com `chore:` antes do push; corrida desfaz e refaz (1 commit so): {log3[:4]}")
check(oshow("docs/bugs/retest/b2.md") and not oshow("docs/bugs/open/area/b2.md"), "[tasks] doc do bug em retest/ SEM a subpasta de open/")
put(lb2, "docs/task/TASK-0209-dup.md", "colisao de sessao humana\n"); sh("git", "add", ".", cwd=lb2); sh("git", "commit", "-qm", "chore: dup", cwd=lb2)
check(any("repetido" in e for e in R.task_done_errors(st3, st3["bugs"]["b2"], lb2)), "[tasks] test-done pass recusa numero repetido na pasta")
sh("git", "reset", "-q", "--hard", "origin/main", cwd=lb2)
st3["bugs"]["b2"]["synced_base"] = sha3
errs3 = R.task_done_errors(st3, st3["bugs"]["b2"], lb2)
check(any("nenhum commit" in e for e in errs3), f"[tasks] test-done pass recusa sem commit `TASK-0209:` desde o sync ({errs3})")
# antes_do_push que mexe fora de docs/: desfeito, saida 17
ap0 = R.ANTES_DO_PUSH
R.ANTES_DO_PUSH = {"cmd": [sys.executable, "-c", "open('code/y.c','w').write('x')"], "assunto": "chore: x"}
R.checkout_fresh(lb2, "origin/main", "bugfix/y"); put(lb2, "docs/n.md", "n\n"); sh("git", "add", ".", cwd=lb2); sh("git", "commit", "-qm", "chore: n", cwd=lb2)
expect_exit(17, lambda: R.publish_head(st3, lb2), "[tasks] antes_do_push que mexe fora de docs/ -> saida 17")
check(not (lb2 / "code/y.c").exists(), "[tasks] ... e o que ele fez foi desfeito")
R.ANTES_DO_PUSH = ap0
# reprovacao de b1 depois do Passo 8: a task volta ao Status do planning (CRLF preservado), o doc da task NAO e
# apagado, so os docs vao para o fluxo principal e a TRAVA ve task concluida
R.checkout_fresh(lb1, "origin/main", "bugfix/b1")
put(lb1, "code/x.c", "tentativa b1\n"); sh("git", "commit", "-qam", "TASK-0200: tentativa", cwd=lb1)
f0 = lb1 / "docs/task/TASK-0200-velha.md"; f0.write_bytes(f0.read_bytes().replace("aberta".encode(), "concluída".encode()))
sh("git", "commit", "-qam", "chore: b1 -> concluida", cwd=lb1)
st3 = R.load()
check(R.normalize_task_status(st3, "b1", lb1), "[tasks] reprovacao: normalize_task_status devolve a task")
raw0 = f0.read_bytes().decode("utf-8")
check(raw0.startswith("# TASK-0200: velha\r\n") and "- **Status:** aberta\r\n" in raw0 and "REPROVADO depois de marcada" in raw0
      and "\n" not in raw0.replace("\r\n", ""), "[tasks] ... Status do planning, nota abaixo do titulo, CRLF preservado")
sh("git", "commit", "-qm", "chore: b1 volta", cwd=lb1)
R.publish_docs_only(st3, "b1")
check(R.task_status(oshow("docs/task/TASK-0200-velha.md")) == "aberta" and oshow("code/x.c") == "fix b2\n"
      and oshow("docs/bugs/open/area/b1.md"), "[tasks] so docs integrados: task aberta (nao apagada), codigo da tentativa fora")
st3["bugs"]["t1"]["wt"] = "wt-1"
check(not R.normalize_task_status(st3, "t1", lb1), "[tasks] task que nao foi concluida nesta tentativa: nada a devolver")
f2 = put(lb1, "docs/task/TASK-0202-feita.md", task_md(202, "feita", "concluída"))
st3["bugs"]["t1"]["doc"] = "docs/task/TASK-0202-feita.md"
check(not R.normalize_task_status(st3, "t1", lb1), "[tasks] task ja concluida NA BASE (por fora): nao e revertida")
st3["bugs"]["t1"]["doc"] = "docs/task/TASK-0201-item.md"
# sync_main com os assuntos do projeto: doc e codigo de terceiro com `chore:`, publicados pelo gancho
put(src3, "docs/notas.md", "nota de outra sessao\n"); put(src3, "code/w.c", "edicao de terceiro\n")
old3 = time.time() - 3600
for f in ("docs/notas.md", "code/w.c"):
    os.utime(src3 / f, (old3, old3))
rec3 = R.sync_main({"base": "origin/main", "branch": "main", "run_id": "t3", "worktrees": R.load()["worktrees"]})
subs3 = olog()
check(any(s.startswith("chore: notas - ") for s in subs3) and any(s.startswith("chore: codigo local") for s in subs3),
      f"[tasks] sync_main: assuntos `commit_docs_outros`/`commit_terceiros` do projeto passam no gancho ({rec3['pending']})")
# C4 por tipo: item task em retest com Status aberta -> mecanico; bug com task concluida -> sem item da task
st4 = {"base": "origin/main", "branch": "main", "run_id": "t4", "final": {}, "worktrees": {}, "bugs": {
    "b2": {"doc": "docs/bugs/open/area/b2.md", "tipo": "bug", "state": "retest", "plan": {"task": "docs/task/TASK-0209-b2.md"},
           "branch": "bugfix/b2", "commit": sha3, "sessions": {}},
    "t1": {"doc": "docs/task/TASK-0201-item.md", "tipo": "task", "state": "retest", "plan": {}, "branch": "bugfix/t1",
           "commit": sha3, "sessions": {}}}}
c4 = [m for c, k, m in R.final_report(st4) if c == "C4" and k == "mecanico" and "briefing" not in m]
check(any("t1 (retest): a task docs/task/TASK-0201-item.md nao esta" in m for m in c4) and not any(m.startswith("b2") for m in c4),
      f"[tasks] C4: task em retest com Status aberta -> mecanico; bug com task concluida e doc em retest/ plano -> ok ({c4})")

print("GIT VERDE")
