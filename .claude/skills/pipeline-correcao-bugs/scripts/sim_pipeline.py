"""Simula o ledger do pipeline (5 etapas, ondas) com git/claude falsos. Uso: python sim_pipeline.py"""
import importlib.util, json, sys, time, types, tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("pipeline", Path(__file__).with_name("pipeline.py"))
P = importlib.util.module_from_spec(spec); spec.loader.exec_module(P)

tmp = Path(tempfile.mkdtemp())
P.PIPE = tmp; P.STATE = tmp / "state.json"; P.WTS = tmp / "lanes"; P.DSG = tmp / "nao-existe"
# nenhuma copia do modulo enxerga a guarda de contas nem o arquivo de credenciais reais (F3 do rodizio);
# o `tick` le o transcript da sessao parada antes de cutucar (F5): nunca o ~/.claude/projects real
P.ACCOUNTS_DIR = tmp / "contas-p"; P.CRED_FILE = tmp / "cred-p.json"; P.CLAUDE_PROJECTS = tmp / "projects"
spawned, stops, docs_only, publish_fail = [], [], [], [0]
def fake_spawn(st, slug, stage, message=""):
    eff, ut = P.stage_tuning(st, slug, stage)
    rec = {"name": f"{slug}-{stage}", "id": f"id-{slug}-{stage}"}
    (P.bug_of(st, slug)["sessions"] if slug else st["final"]).__setitem__(stage if slug else "session", rec)
    spawned.append((slug, stage, eff, ut, message[:90])); return rec
def fake_publish(st, path, synced_base=None, code_check=False):
    if publish_fail[0]:
        publish_fail[0] -= 1; P.die("simulado: rebase com conflito", 4)
    return "sha-pub"
P.spawn = fake_spawn
P.ensure_wt = lambda st, name: (st["worktrees"].setdefault(name, {"path": str(tmp / name), "bug": None}), tmp / name)[1]
P.checkout_fresh = lambda path, base, branch: None
P.stop_sessions = lambda b, except_stage=None: stops.append((b["title"], except_stage))
P.publish_head = fake_publish
P.guard_wt = lambda p: Path(p)
P.publish_docs_only = lambda st, slug: (docs_only.append(slug), "sha-docs")[1]
P.agents = lambda: []
GIT = {"status": "", "ls-tree": "x", "rev-parse": "abc", "rev-list": "1"}
def fake_git(*args, cwd=None, check=True):
    if args[0] == "diff":
        return GIT.get("diff_" + Path(str(cwd)).name, "")
    return GIT.get(args[0], "")
P.git = fake_git
P.porcelain_paths = lambda path, untracked=True: []   # worktrees de mentira: nada sujo (o real e testado no git_pipeline)
(tmp / "wt-planning" / "launcher").mkdir(parents=True); (tmp / "wt-planning" / "es").mkdir()

def call(cmd, **kw):
    getattr(P, "cmd_" + cmd.replace("-", "_"))(types.SimpleNamespace(**kw))
def state(): return json.loads(P.STATE.read_text(encoding="utf-8"))
def check(cond, msg):
    print(("OK   " if cond else "FAIL ") + msg)
    if not cond: sys.exit(1)
def expect_exit(code, fn, msg):
    try: fn(); check(False, msg + " (nao saiu)")
    except SystemExit as e: check(e.code == code, f"{msg} (exit {e.code})")
def plan(slug, cx, files, verdict="corrigir", eff=("high", "medium"), ut=(True, False)):
    f = tmp / f"{slug}.json"
    f.write_text(json.dumps({"verdict": verdict, "complexity": cx, "severity": "alto", "files": files,
                             "effort": {"dev": eff[0], "teste": eff[1]},
                             "ultrathink": {"dev": ut[0], "teste": ut[1]}, "summary": slug}), encoding="utf-8")
    return str(f)

bugs = tmp / "bugs.json"
bugs.write_text(json.dumps({"bugs": [{"slug": s, "doc": f"docs/bugs/open/{s}.md", "title": s} for s in "abcdefg"]}),
                encoding="utf-8")
call("init", bugs=str(bugs), base="origin/versao3", model="claude-opus-5-5", effort="medium",
     max_returns=3, max_planning=4, max_dev=4, permission_mode="auto", force=False)
call("start")
s = state()
check([b["state"] for b in s["bugs"].values()].count("planning") == 4, "planning: 4 em paralelo, os outros esperam")
check(all(x[2] == "medium" and x[3] for x in spawned), "planning com effort medium + ultrathink")

bad = tmp / "bad.json"; bad.write_text(json.dumps({"verdict": "corrigir", "complexity": "baixa", "severity": "alto",
                                                   "files": ["launcher/A.cs"]}), encoding="utf-8")
expect_exit(2, lambda: call("plan-done", bug="a", json=str(bad)), "plano sem effort/ultrathink recusado")
expect_exit(2, lambda: call("plan-done", bug="a", json=plan("a", "baixa", ["C:/x/launcher/A.cs"])), "caminho absoluto recusado")

# a, c, g baixa; b colide com a (case diferente); d colide com c; e sem codigo; f colide com g
call("plan-done", bug="a", json=plan("a", "baixa", ["launcher/A.cs", "launcher/Shared.cs"]))
check(state()["bugs"]["e"]["state"] == "planning", "terminou 1 planning -> o 5o comeca (janela de 4)")
call("plan-done", bug="b", json=plan("b", "media", ["source/launcher/shared.CS"]))
call("plan-done", bug="c", json=plan("c", "baixa", ["es/C.cpp"]))
call("plan-done", bug="d", json=plan("d", "alta", ["es/C.cpp", "es/D.cpp"]))
call("plan-done", bug="e", json=plan("e", "baixa", [], verdict="sem-codigo"))
call("plan-done", bug="f", json=plan("f", "media", ["launcher/F.cs", "launcher/G.cs"]))
check(state()["waves"] == [], "nenhuma onda enquanto ha planning rodando")
publish_fail[0] = 1                                  # integracao dos docs do planning falha 1x
call("plan-done", bug="g", json=plan("g", "baixa", ["launcher/G.cs"]))
s = state()
check(s["bugs"]["g"]["state"] == "planejado" and s.get("elencar_erro") and s["waves"] == [],
      "falha ao integrar docs do planning: plano gravado, Etapa 2 travada e registrada (sem onda)")
call("elencar")
s = state()
check(not s.get("elencar_erro") and s["elencado"], "`elencar` retenta e integra (idempotente)")
check(s["bugs"]["e"]["state"] == "documentado", "sem-codigo -> documentado, fora das ondas")
check(s["waves"] == [["a", "c", "g"]], f"onda 1 = menor complexidade + disjuntos da uniao: {s['waves']}")
check(s["bugs"]["b"]["plan"]["files"] == ["launcher/shared.CS"], "caminho 'source/...' normalizado")
dev_a = [x for x in spawned if x[0] == "a" and x[1] == "dev"][-1]
check(dev_a[2] == "high" and dev_a[3] is True, "dev com effort/ultrathink decididos pelo planning")

# reserva + espera + ciclo
expect_exit(8, lambda: call("claim", bug="c", file=["LAUNCHER/shared.cs"]), "claim de arquivo de outro bug recusado (sem diferenciar maiusculas)")
call("park", bug="c", on="a", file="launcher/Shared.cs")
expect_exit(8, lambda: call("claim", bug="a", file=["es/C.cpp"]), "a precisa de arquivo de c")
expect_exit(12, lambda: call("park", bug="a", on="c", file="es/C.cpp"), "ciclo de espera detectado (exit 12)")
s = state()
check(s["bugs"]["a"]["state"] == "planejado" and s["bugs"]["a"]["deferred"]
      and "es/C.cpp" in s["bugs"]["a"]["plan"]["files"], "a ADIADO com reserva ampliada")
check(s["bugs"]["c"]["state"] == "dev" and s["bugs"]["c"]["parked_on"] is None, "c, que esperava a, foi liberado")
check(s["waves"] == [["a", "c", "g"]], "adiar nao abre onda nova enquanto c e g trabalham")

GIT["diff_wt-2"] = "es/C.cpp\nlauncher/Extra.cs"
expect_exit(9, lambda: call("enqueue-test", bug="c"), "enqueue com arquivo nao reservado recusado")
call("claim", bug="c", file=["launcher/Shared.cs", "launcher/Extra.cs"])
call("enqueue-test", bug="c")
s = state()
check(s["bugs"]["c"]["state"] == "teste" and s["test_slot"] is None, "teste comeca na fase offline, sem slot")
t = [x for x in spawned if x[0] == "c" and x[1] == "teste"][-1]
check(t[2] == "medium" and t[3] is False, "teste com effort/ultrathink do planning")

GIT["diff_wt-3"] = "launcher/G.cs"
call("enqueue-test", bug="g"); call("slot-request", bug="g")
check(state()["test_slot"] == "g", "g pega o slot livre")
rep = tmp / "r.md"; rep.write_text("offline falhou", encoding="utf-8")
call("test-done", bug="c", result="fail", report=str(rep), note="")
s = state()
check(s["bugs"]["c"]["state"] == "dev" and s["test_slot"] == "g",
      "reprovacao OFFLINE de c sem slot: volta ao dev e NAO tira o slot de g")
expect_exit(2, lambda: call("deploy", bug="c", at_base=False), "deploy sem slot recusado")

call("test-done", bug="g", result="ambiente", report=None, note="ES alheio")
check(state()["test_slot"] is None and state()["bugs"]["g"]["retry_after"], "ambiente: g em backoff, slot livre")
call("enqueue-test", bug="c"); call("slot-request", bug="c")
check(state()["test_slot"] == "c", "slot livre + fila so com g em backoff: c pega o slot (nao trava)")

for i in (2, 3):                                     # a 1a devolucao foi a offline, acima
    call("test-done", bug="c", result="fail", report=str(rep), note="")
    check(state()["bugs"]["c"]["returns"] == i and state()["test_slot"] is None, f"devolucao {i}, slot liberado")
    call("enqueue-test", bug="c"); call("slot-request", bug="c")
call("test-done", bug="c", result="fail", report=str(rep), note="")
s = state()
check(s["bugs"]["c"]["state"] == "open-falhou" and docs_only == ["c"], "4a reprovacao (3 devolucoes): open, so docs integrados")
check(("c", "teste") in stops, "fim do bug nao para a sessao CHAMADORA (teste)")

s = state(); s["bugs"]["g"]["retry_after"] = "2000-01-01T00:00:00"; P.save(s)
call("reconcile", fix=True, grace=99999)
check(state()["test_slot"] == "g", "reconcile despacha g depois do backoff")
s = state(); s["bugs"]["g"]["commit"] = "sha"; P.save(s)
call("test-done", bug="g", result="pass", report=None, note="")
s = state()
check(s["bugs"]["g"]["state"] == "retest", "g aprovado -> retest")
check(s["waves"][1:] == [["a", "f"]], f"onda 2 = a (adiado, baixa) + f; b e d colidem com a: {s['waves']}")
check("ADIADO" in [x for x in spawned if x[0] == "a" and x[1] == "dev"][-1][4], "dev de a retomado sabendo do -wip")

# pendencia de mensagem + cutucada de sessao parada (tick sem agendamento)
s = state()
s["pending_spawns"] = [{"slug": "f", "stage": "dev", "message": "msg perdida", "why": "busy", "ts": "x"}]
s["bugs"]["a"]["history"][-1]["ts"] = "2000-01-01T00:00:00"; P.save(s)
n0 = len(spawned)
GIT["diff_wt-1"] = "es/C.cpp"
call("enqueue-test", bug="a")                       # transicao de a dispara o tick
s = state()
check(any(x[0] == "f" and x[4].startswith("msg perdida") for x in spawned[n0:]), "tick reentrega mensagem pendente")
check(not s.get("pending_spawns"), "fila de pendencias vazia depois")
check(s["bugs"]["a"].get("nudges", {}).get("dev", 0) == 0, "tick nunca cutuca o proprio chamador")
for k in range(3):                                   # f parado ha muito: cutucado ate MAX_NUDGES
    s = state(); s["bugs"]["f"]["history"][-1]["ts"] = "2000-01-01T00:00:00"; P.save(s)
    call("slot-request", bug="a") if k == 0 else call("claim", bug="a", file=["es/C.cpp"])
    with P.file_lock("state"):
        st = P.load(); P.tick(st, caller="a"); P.save(st)
s = state()
check(s["bugs"]["f"]["nudges"]["dev"] == 2, f"sessao parada cutucada no maximo {P.MAX_NUDGES} vezes")
s = state(); s["bugs"]["f"]["history"][-1]["ts"] = "2000-01-01T00:00:00"; P.save(s)
with P.file_lock("state"):
    st = P.load(); notes = P.tick(st, caller="a"); P.save(st)
check(any("sem mais cutucoes" in n for n in notes), "depois do teto: relata que precisa do dono, sem cutucar")
s["bugs"]["a"]["commit"] = "sha"; P.save(s)
call("test-done", bug="a", result="pass", report=None, note="")
GIT["diff_wt-2"] = "launcher/F.cs"
call("enqueue-test", bug="f"); call("slot-request", bug="f")
s = state(); s["bugs"]["f"]["commit"] = "sha"; P.save(s)
call("test-done", bug="f", result="pass", report=None, note="")
s = state()
check(s["waves"][2:] == [["b", "d"]], f"onda 3 = b + d: {s['waves']}")
GIT["diff_wt-1"] = "launcher/shared.CS"; GIT["diff_wt-2"] = "es/C.cpp\nes/D.cpp"
call("enqueue-test", bug="b"); call("enqueue-test", bug="d")
call("slot-request", bug="b")
expect_exit(10, lambda: call("slot-request", bug="d"), "segundo E2E entra na fila (exit 10)")
s = state(); s["bugs"]["b"]["commit"] = "sha"; P.save(s)
call("test-done", bug="b", result="pass", report=None, note="")
check(state()["test_slot"] == "d" and "SLOT CONCEDIDO" in spawned[-1][4] or any("SLOT CONCEDIDO" in x[4] for x in spawned[-3:]),
      "slot passa a d e a sessao e retomada")
call("blocked", bug="d", note="precisa de GPU AMD") if state()["bugs"]["d"]["state"] == "dev" else None
s = state()
if s["bugs"]["d"]["state"] == "teste-e2e":
    s["bugs"]["d"]["state"] = "dev"; P.save(s)      # o dev de d conclui bloqueio (sim)
    call("blocked", bug="d", note="precisa de GPU AMD")
s = state()
check(s["bugs"]["d"]["state"] == "open-falhou" and s["final"]["state"] == "rodando"
      and spawned[-1][1] == "finalizacao", "ultima onda terminou -> finalizacao")
expect_exit(2, lambda: call("final-done", note="x"), "final-done recusa sem cleanup") if any(
    (Path(w["path"]) / ".git").exists() for w in s["worktrees"].values()) else check(True, "sem worktrees reais na sim")
# [finalizacao] o `final-done` e um PORTAO (bug pipeline-finalizacao-nao-entrega-estado-organizado-..._2026-10-02).
# Aqui so a decisao sobre o relatorio; o relatorio de verdade (git real) e testado no git_pipeline.py.
report, scheduled = [[("C2", "mecanico", "arvore principal behind 3")]], []
P.final_report = lambda st: report[0]
P.schedule_stop_final = lambda: scheduled.append(1)
expect_exit(2, lambda: call("final-done", note="x"), "[finalizacao] item mecanico -> final-done recusa")
check(state()["final"]["state"] == "rodando" and not scheduled, "[finalizacao] recusa: continua `rodando`, sessao nao e encerrada")
report[0] = [("C1", "ok", "tudo no origin")]
call("final-done", note="ok")
check(state()["final"]["state"] == "concluido" and scheduled == [1], "final-done: tudo ok -> concluido, encerramento da sessao agendado")
s = state(); s["final"]["state"] = "rodando"; P.save(s)
report[0] = [("C1", "ok", "tudo no origin"), ("C2", "dono", "codigo de terceiro nao compila")]
call("final-done", note="ok")
s = state()
check(s["final"]["state"] == "concluido-com-pendencias" and s["final"]["pendencias"] == ["codigo de terceiro nao compila"]
      and "PENDENCIA DO DONO" in P.briefing_path(s).read_text(encoding="utf-8"),
      "[finalizacao] so decisao do dono pendente -> concluido-com-pendencias, registrado no ledger e no briefing")
expect_exit(2, lambda: call("final-sync-main", fresh_min=10), "[finalizacao] final-sync-main fora da finalizacao recusado")
expect_exit(2, lambda: call("final-deploy"), "[finalizacao] final-deploy fora da finalizacao recusado")

# [finalizacao] `stop-final`: processo destacado que encerra a sessao da finalizacao quando ela fica ociosa
# (ninguem a encerrava: K4.4). Nunca para sessao trabalhando, interativa, nem de outro nome.
s = state(); fname = f"pipeline-finalizacao-{s['run_id']}"
s["final"]["session"] = {"name": fname, "id": "ffff0000-1111", "cli_output": "backgrounded · abcd1234 · x"}; P.save(s)
polls, sf_calls, real_run_sf, real_sleep = [0], [], P.run, time.sleep
def sf_agents():
    polls[0] += 1
    return [{"name": fname, "sessionId": "ffff0000-1111", "id": "ffff0000", "kind": "background",
             "status": "busy" if polls[0] <= 2 else "idle"},
            {"name": "titulo gerado", "sessionId": "abcd1234-2222", "id": "abcd1234", "kind": "background", "status": "idle"},
            {"name": fname, "sessionId": "dddd0000-3333", "id": "dddd0000", "kind": "interactive", "status": "idle"},
            {"name": "outra", "sessionId": "eeee0000-4444", "id": "eeee0000", "kind": "background", "status": "idle"}]
P.agents, P.claude_exe, time.sleep = sf_agents, (lambda: "claude"), (lambda s: None)
P.run = lambda cmd, cwd=None, check=True, timeout=None: (sf_calls.append(list(cmd)), types.SimpleNamespace(returncode=0, stdout="", stderr=""))[1]
call("stop-final", wait=15, interval=20)
P.run, time.sleep, P.agents = real_run_sf, real_sleep, (lambda: [])
stopped = [c[2] for c in sf_calls if c[:2] == ["claude", "stop"]]
check(stopped[0] == "abcd1234" and stopped[-1] == "ffff0000" and "dddd0000" not in stopped and "eeee0000" not in stopped,
      f"[finalizacao] stop-final: copia ociosa ja; a sessao so DEPOIS de sair de busy; interativa e alheia intocadas ({stopped})")
check(state()["final"]["session"].get("stopped"), "[finalizacao] stop-final registra o encerramento no ledger")

# ---- regressoes da revisao de 2026-10-02 (source/docs/revisao-skill-pipeline-correcao-bugs_2026-10-02.md)
claude_calls = []
real_run = P.run
P.run = lambda cmd, cwd=None, check=True, timeout=None: (claude_calls.append(list(map(str, cmd))),
                                                       types.SimpleNamespace(returncode=0, stdout="", stderr=""))[1]
P.agents = lambda: [{"sessionId": "old", "status": "idle"}]
def base_state(**kw):
    s = {"bugs": {}, "pending_spawns": [], "final": {"state": "pendente", "session": None},
         "created": "2000-01-01T00:00:00", "test_slot": None, "test_queue": [], "waves": [], "elencado": None,
         "effort": "medium", "model": "claude-opus-5-5"}
    s.update(kw)
    return s
st3 = base_state(bugs={
    "a": {"state": "retest", "plan": None, "sessions": {"dev": {"id": "old", "name": "a-dev"}}, "history": []},
    "b": {"state": "dev", "plan": None, "sessions": {}, "history": [{"ts": "2099-01-01T00:00:00"}]}},
    pending_spawns=[{"slug": "a", "stage": "dev", "message": "obsoleta", "why": "busy", "ts": "x"},
                    {"slug": "b", "stage": "dev", "message": "valida", "why": "busy", "ts": "x"}])
snapshot, n0 = json.dumps(st3, sort_keys=True), len(spawned)
notes = P.tick(st3, report=True)
check(json.dumps(st3, sort_keys=True) == snapshot and len(spawned) == n0 and not claude_calls,
      "[revisao 3] reconcile sem --fix: estado intacto, nenhum spawn, nenhum stop")
check(any("obsoleta" in n for n in notes) and any("encerrar" in n for n in notes), "[revisao 3] mas relata o que faria")
P.tick(st3)
check([x for x in spawned[n0:] if x[0] == "a"] == [] and any(x[0] == "b" and x[4] == "valida" for x in spawned[n0:]),
      "[revisao 3] com efeito: mensagem de bug TERMINADO descartada, a do bug ativo entregue")
check(["stop", "old"] == claude_calls[-1][-2:] and not st3["pending_spawns"], "[revisao 3] sessao do bug terminado encerrada")

st6 = base_state(final={"state": "rodando", "session": None},
                 pending_spawns=[{"slug": None, "stage": "finalizacao", "message": "Todas as ondas", "why": "cli", "ts": "x"}])
n0 = len(spawned)
P.tick(st6, force=True)                          # o que o `reconcile --fix` faz (caller = NOBODY)
check(spawned[n0:] and spawned[-1][:2] == (None, "finalizacao") and st6["final"]["session"]
      and not st6["pending_spawns"], "[revisao 6] finalizacao com 1o spawn falho e reentregue pelo reconcile")
st6b = base_state(final={"state": "rodando", "session": None})
n0 = len(spawned)
P.tick(st6b, force=True)
check(spawned[n0:] and spawned[-1][:2] == (None, "finalizacao"), "[revisao 6] finalizacao sem sessao e sem pendencia tambem e reaberta")

# [revalidacao 8] correcao SO no script da skill e codigo: entra em teste, e so com reserva
SKILL_PY = "skills/pipeline-correcao-bugs/scripts/pipeline.py"
GIT["diff_wt-s"] = SKILL_PY
st8 = base_state(base="origin/versao3", run_id="t", worktrees={"wt-s": {"path": str(tmp / "wt-s"), "bug": "s"}},
                 bugs={"s": {"state": "dev", "plan": {"files": []}, "claims": [], "test_round": 0, "wt": "wt-s",
                             "sessions": {}, "history": [], "title": "s"}})
P.save(st8)
expect_exit(9, lambda: call("enqueue-test", bug="s"), "[revalidacao 8] script da skill fora da reserva -> exige claim")
st8["bugs"]["s"]["plan"]["files"] = [SKILL_PY]
P.save(st8)
call("enqueue-test", bug="s")
check(state()["bugs"]["s"]["state"] == "teste", "[revalidacao 8] reservado -> entra em teste (nao e 'nenhum commit de codigo')")
P.run = real_run

# [piloto sessao perdida] transicao morta entre save e spawn (DESIGN secao 16): bug em 'teste' sem sessao
def lost(**kw):
    return base_state(bugs={"p": {"state": "teste", "plan": None, "sessions": {"planning": {"id": "pl", "name": "p-pl"},
                                                                         "dev": {"id": "dv", "name": "p-dev"}},
                                  "test_round": 1, "history": [{"ts": P.now(), "from": "dev", "to": "teste"}]}}, **kw)
st16 = lost()
snap16, n0 = json.dumps(st16, sort_keys=True), len(spawned)
notes = P.tick(st16, report=True)
check(json.dumps(st16, sort_keys=True) == snap16 and len(spawned) == n0
      and any("sem sessao de teste registrada" in n for n in notes),
      "[piloto sessao perdida] reconcile so relata: anota, nao abre")
P.tick(st16)
new = [x for x in spawned[n0:] if x[0] == "p"]
check(len(new) == 1 and new[0][1] == "teste" and new[0][4].startswith("Rodada de teste 1")
      and not st16["bugs"]["p"].get("nudges"),
      "[piloto sessao perdida] abre JA (sem tolerancia) a sessao de teste com a mensagem de inicio, sem cutucada")
n0 = len(spawned)
P.tick(st16)
check(not [x for x in spawned[n0:] if x[0] == "p"], "[piloto sessao perdida] sessao registrada -> nao abre de novo")
st16b = lost(pending_spawns=[{"slug": "p", "stage": "teste", "message": "Rodada de teste 1. pendente", "why": "x", "ts": "x"}])
n0 = len(spawned)
P.tick(st16b)
check([x[4] for x in spawned[n0:] if x[0] == "p"] == ["Rodada de teste 1. pendente"],
      "[piloto sessao perdida] com pendencia para a etapa: so a reentrega, sem sessao duplicada")

st16c = lost()
st16c["bugs"]["p"]["order"] = 1
orph = {"sessionId": "orf-1", "id": "orf", "name": "bug01-teste-p", "status": "busy", "startedAt": int(time.time() * 1000)}
old_ag, P.agents = P.agents, lambda: [orph, {**orph, "sessionId": "velha", "startedAt": 1000}]
n0 = len(spawned)
P.tick(st16c)
P.agents = old_ag
check(not [x for x in spawned[n0:] if x[0] == "p"] and st16c["bugs"]["p"]["sessions"]["teste"]["id"] == "orf-1",
      "[piloto sessao perdida] sessao viva com o nome da etapa (posterior a transicao) -> ADOTA, nao abre outra")

# [piloto stop] `claude stop` so casa pelo id curto do job (DESIGN secao 16): modulo novo, stop_sessions real
Q = importlib.util.module_from_spec(spec); spec.loader.exec_module(Q)
Q.ACCOUNTS_DIR = tmp / "contas-q"; Q.CRED_FILE = tmp / "cred-q.json"
calls = []
Q.claude_exe = lambda: "claude"
Q.run = lambda cmd, cwd=None, check=True, timeout=None: (calls.append(list(cmd)), types.SimpleNamespace(returncode=0, stdout="", stderr=""))[1]
Q.agents = lambda: [{"sessionId": "aaaa1111-2222", "id": "aaaa1111", "status": "idle"},
                    {"sessionId": "bbbb3333-4444", "id": "bbbb3333", "status": None}]
Q.stop_sessions({"sessions": {"dev": {"id": "aaaa1111-2222"}, "planning": {"id": "cccc5555-6666"}}})
check(["claude", "stop", "aaaa1111"] in calls and ["claude", "stop", "cccc5555"] in calls
      and not any("aaaa1111-2222" in c for c in calls if "stop" in c),
      "[piloto stop] stop_sessions para pelo id curto (do claude agents; senao os 8 primeiros)")
calls.clear(); Q.time.sleep = lambda s: None
# [resume] `--bg --resume` so continua a MESMA sessao com ela parada e sem flag nenhuma (bug
# pipeline-resume-com-flags-abre-copia-e-ledger-perde-a-sessao_2026-10-02). CLI falso: o `stop` para.
world = {"aaaa1111-2222": "idle", "bbbb3333-4444": None}
names, stop_works, cli_out = {"aaaa1111-2222": "bug01-dev-x"}, [True], [None]
def rs_run(cmd, cwd=None, check=True, timeout=None):
    cmd = list(map(str, cmd)); calls.append(cmd); out = ""
    if cmd[1] == "stop" and stop_works[0]:
        world.update({k: None for k in world if k.startswith(cmd[2])})
    if "--bg" in cmd:
        if "--resume" in cmd:
            sid = cmd[cmd.index("--resume") + 1]
            flags = [c for c in cmd[4:-1] if c.startswith("-")]
            if cli_out[0] or flags or world.get(sid) is not None:      # o CLI real: flag ou sessao viva -> copia
                world["cccc9999-0000"] = "busy"; names["cccc9999-0000"] = "titulo gerado pela ia"
                out = "backgrounded · \x1b[36mcccc9999\x1b[39m\nnote: ... started a copy as cccc9999"
            else:
                world[sid] = "busy"; out = f"backgrounded · \x1b[36m{sid[:8]}\x1b[39m · {names.get(sid)}\nnote: woke session"
        else:
            world["dddd0000-1111"] = "busy"; names["dddd0000-1111"] = cmd[cmd.index("-n") + 1]
            out = f"backgrounded · dddd0000 · {names['dddd0000-1111']}"
    return types.SimpleNamespace(returncode=0, stdout=out, stderr="")
Q.run = rs_run
Q.agents = lambda: [{"sessionId": k, "id": k[:8], "name": names.get(k), "startedAt": 5, **({"status": v} if v else {})}
                    for k, v in world.items()]
cmd = Q.resume_cmd("claude", "aaaa1111-2222", "msg")
check(calls == [["claude", "stop", "aaaa1111"]] and cmd == ["claude", "--bg", "--resume", "aaaa1111-2222", "msg"],
      "[resume] sessao ociosa: stop pelo id curto, resume pelo sessionId e SEM flag nenhuma")
calls.clear()
cmd = Q.resume_cmd("claude", "bbbb3333-4444", "msg")
check(calls == [] and cmd == ["claude", "--bg", "--resume", "bbbb3333-4444", "msg"],
      "[resume] sessao ja parada (status None): resume direto, sem Busy")
world["aaaa1111-2222"], stop_works[0] = "idle", False
try: Q.resume_cmd("claude", "aaaa1111-2222", "msg"); check(False, "[resume] sessao que nao parou devia dar Busy")
except Q.Busy: check(True, "[resume] `stop` nao parou a sessao -> Busy (retomar viva abriria copia sem as flags)")
stop_works[0] = True
# spawn REAL (so o CLI e falso): nasce com as flags, retoma sem elas, e o ledger segue o id impresso
Q.PIPE = tmp; Q.WTS = tmp / "lanes"; Q.DSG = tmp / "nao-existe"
def sp_state(sessions):
    return {"run_id": "t", "base": "origin/versao3", "model": "claude-opus-5-5", "effort": "medium",
            "permission_mode": "auto", "pending_spawns": [], "final": {"state": "pendente", "session": None},
            "worktrees": {"wt-planning": {"path": str(tmp / "wt-planning"), "bug": None}},
            "bugs": {"x": {"order": 1, "state": "planning", "plan": None, "sessions": sessions, "history": [], "doc": "d.md"}}}
calls.clear(); sp = sp_state({})
rec = Q.spawn(sp, "x", "planning", "oi")
born = [c for c in calls if "--bg" in c][-1]
check(rec["id"] == "dddd0000-1111" and "--model" in born and "--permission-mode" in born and "--resume" not in born,
      "[resume] spawn novo: nasce COM as flags e o ledger guarda o id que o CLI imprimiu")
world["aaaa1111-2222"] = "idle"; calls.clear()
sp = sp_state({"planning": {"id": "aaaa1111-2222", "name": "bug01-dev-x"}})
rec = Q.spawn(sp, "x", "planning", "de novo")
woke = [c for c in calls if "--bg" in c][-1]
check(woke[:4] == ["claude", "--bg", "--resume", "aaaa1111-2222"] and len(woke) == 5
      and rec["id"] == "aaaa1111-2222" and "copy_of" not in rec and "cccc9999-0000" not in world,
      "[resume] retomada pelo spawn: nenhuma flag, nenhuma copia, o ledger continua na mesma sessao")
world["aaaa1111-2222"], cli_out[0] = "idle", "copia"       # o CLI abre copia assim mesmo (nome novo)
sp = sp_state({"planning": {"id": "aaaa1111-2222", "name": "bug01-dev-x"}})
rec = Q.spawn(sp, "x", "planning", "de novo")
check(rec["id"] == "cccc9999-0000" and rec["copy_of"] == "aaaa1111-2222"
      and sp["bugs"]["x"]["sessions"]["planning"]["id"] == "cccc9999-0000",
      "[resume] se o CLI abrir COPIA renomeada, o ledger segue a copia (quem recebeu a mensagem), nao a original parada")

# [piloto trust] trust de worktree = o do repo principal SRC (DESIGN secao 15); raiz e lanes nao bastam
fake_cj = tmp / "claude.json"
P.CLAUDE_JSON = fake_cj
def cj(projects): fake_cj.write_text(json.dumps({"projects": projects}), encoding="utf-8")
yes = {"hasTrustDialogAccepted": True}
cj({P.ROOT.as_posix(): yes, P.WTS.as_posix(): yes, (P.WTS / "wt-planning").as_posix(): yes})
check(not P.worktrees_trusted(), "[piloto trust] raiz + lanes + wt-planning confiaveis, source nao -> falha")
cj({str(P.SRC).upper() + "\\": yes})
check(P.worktrees_trusted(), "[piloto trust] source confiavel (caixa/barra diferentes) -> ok")
cj({P.SRC.as_posix(): {"hasTrustDialogAccepted": False}})
check(not P.worktrees_trusted(), "[piloto trust] source com hasTrustDialogAccepted=False -> falha")
fake_cj.unlink()
check(not P.worktrees_trusted(), "[piloto trust] sem ~/.claude.json -> falha (nao quebra)")

# [piloto sonda] a sonda do preflight (cwd na lane wt-planning) e ENCERRADA no fim, inclusive em erro:
# viva, ela trava a pasta (bug pipeline-daemon-claude-bg-orfao-trava-pasta-da-lane_2026-10-02)
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
R.ACCOUNTS_DIR = tmp / "contas-r"; R.CRED_FILE = tmp / "cred-r.json"
R.PIPE = tmp; R.WTS = tmp / "lanes-sonda"; R.ROOT = tmp; R.CLAUDE_JSON = tmp / "nao-existe.json"
R.DEPLOY = tmp / "deploy.ps1"; R.DEPLOY.write_text("$SourceRoot $BuildOnly", encoding="utf-8")
R.claude_exe = lambda: "claude"
R.git = lambda *a, **k: "0"
probe_calls, boom, cli_copies = [], [False], [True]
def probe_run(cmd, cwd=None, check=True, timeout=None):
    probe_calls.append((list(cmd), cwd))
    if boom[0] and "--resume" in cmd:
        raise RuntimeError("simulado: falha no meio do preflight")
    out = "1"
    if "--bg" in cmd:      # formato real do CLI 2.1.288: copia = outro id impresso, sem nome
        out = "backgrounded \u00b7 \x1b[36mdddd7777\x1b[39m \u00b7 pipeline-preflight-x"
        if "--resume" in cmd:
            out = ("backgrounded \u00b7 \x1b[36meeee9999\x1b[39m\nnote: session dddd7777 ... started a copy"
                   if cli_copies[0] else out + "\nnote: woke session dddd7777 with its saved options")
    return types.SimpleNamespace(returncode=0, stdout=out, stderr="")
R.run = probe_run
def probe_agents():
    cmds = [c for c, _ in probe_calls]
    names = [c[c.index("-n") + 1] for c in cmds if "--bg" in c and "-n" in c]
    if not names:
        return []
    last = lambda pred: max([i for i, c in enumerate(cmds) if pred(c)], default=-1)
    stop_at, resume_at = last(lambda c: c[:3] == ["claude", "stop", "dddd7777"]), last(lambda c: "--resume" in c)
    woke = resume_at > stop_at and not cli_copies[0]       # `stop` para a sonda; so o resume SEM copia a acorda
    return [{"name": names[-1], "sessionId": "dddd7777-8888", "startedAt": 10**15,
             **({"status": "idle"} if stop_at < 0 or woke else {})},
            *([{"name": "titulo gerado pela ia", "sessionId": "eeee9999-0000", "status": "idle",   # copia do resume:
                "state": "done", "startedAt": 10**15}] if resume_at >= 0 and cli_copies[0] else []),  # nome novo (real)
            {"name": names[-1], "sessionId": "abab1212-3434", "state": "done", "id": "abab1212"},  # ja encerrada
            {"name": "sessao-de-outra-pessoa", "sessionId": "ffff1111-2222", "status": "idle", "startedAt": 10**15}]
R.agents = probe_agents
stops_of = lambda: [c[2] for c, _ in probe_calls if c[:2] == ["claude", "stop"]]
import contextlib, io
def probe_preflight():
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try: R.cmd_preflight(types.SimpleNamespace(skip_spawn=False)); code = 0
        except SystemExit as e: code = e.code
    return code, buf.getvalue()
code, out = probe_preflight()
check(code == 1, "[piloto sonda] preflight roda ate o fim (vermelho: sem dist/probe no teste)")
spawn_cwd = [cwd for c, cwd in probe_calls if "--bg" in c and "-n" in c]
check(spawn_cwd == [R.WTS / "wt-planning"], "[piloto sonda] a sonda nasce na lane wt-planning (cenario do bug)")
check(not (R.WTS / "wt-planning").exists(), "[finalizacao] o preflight remove a pasta de lane que ele mesmo criou")
check(stops_of()[-2:] == ["dddd7777", "eeee9999"],
      f"[piloto sonda] fim do preflight: stop na sonda E na copia RENOMEADA do resume, pelo id impresso ({stops_of()})")
check("ffff1111" not in stops_of() and "abab1212" not in stops_of(),
      "[piloto sonda] sessao de outro nome e sessao ja encerrada nao sao tocadas")
resumes = [c for c, _ in probe_calls if "--resume" in c]
check(len(resumes) == 1 and resumes[0][:4] == ["claude", "--bg", "--resume", "dddd7777-8888"] and len(resumes[0]) == 5,
      "[resume] preflight: a sonda e retomada SEM flag nenhuma, como o spawn retoma")
check("[FALHA] o resume continuou a MESMA sessao" in out and "eeee9999" in out,
      "[resume] preflight: CLI que abre copia RENOMEADA reprova o check (antes: [OK] com a copia viva)")
probe_calls.clear(); cli_copies[0] = False
code, out = probe_preflight()
check("[OK]   o resume continuou a MESMA sessao (o CLI acordou dddd7777, a sonda e dddd7777)" in out
      and stops_of() == ["dddd7777", "dddd7777"],
      f"[resume] preflight: CLI que acorda a mesma sessao passa; a sonda e parada antes do resume e no fim ({stops_of()})")
probe_calls.clear(); boom[0] = True
try:
    R.cmd_preflight(types.SimpleNamespace(skip_spawn=False)); check(False, "[piloto sonda] erro simulado nao subiu")
except RuntimeError:
    pass
check(stops_of() and stops_of()[-1] == "dddd7777" and "eeee9999" not in stops_of(),
      f"[piloto sonda] erro no resume (antes da copia existir): a sonda e encerrada mesmo assim ({stops_of()})")
check(R.bg_id("backgrounded \ufffd \x1b[36md2426956\x1b[39m \ufffd pipeline-finalizacao") == "d2426956"
      and R.bg_id("Error: workspace not trusted") is None and R.bg_id(None) is None,
      "[piloto sonda] bg_id: le o id com ANSI e separador corrompido (cli_output real do state.json); sem id -> None")
probe_calls.clear(); boom[0] = False
expect_exit(1, lambda: R.cmd_preflight(types.SimpleNamespace(skip_spawn=True)), "[piloto sonda] --skip-spawn")
# [finalizacao] o preflight MEDE a arvore principal (a linha antiga era check(True, ...): nao podia falhar)
import contextlib, io
def preflight_out():
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try: R.cmd_preflight(types.SimpleNamespace(skip_spawn=True))
        except SystemExit: pass
    return buf.getvalue()
check("[OK]   arvore principal igual a origin/0" in preflight_out(), "[finalizacao] preflight: arvore principal igual ao origin -> OK")
R.git = lambda *a, **k: "3" if a[0] == "rev-list" else "versao3"
R.dirty_split = lambda path: (["docs/de-outra-sessao.md"], ["x.vcxproj"])
out = preflight_out()
check(all(w in out for w in ("[AVISO] arvore principal: 3 commit(s) local(is)", "3 commit(s) atras de origin/versao3",
                             "1 arquivo(s) real(is) nao commitado(s) (docs/de-outra-sessao.md)")),
      "[finalizacao] preflight: ahead, behind e arquivo real nao commitado viram AVISO, com numero e nome")
R.git = lambda *a, **k: "0"
check(not stops_of() and not [c for c, _ in probe_calls if "--bg" in c], "[piloto sonda] --skip-spawn: sem sonda, sem stop")
# [cota] F1 do rodizio de contas (docs/backlog/rodizio-automatico-de-contas-no-pipeline.md): deteccao de
# limite pelo transcript, so leitura. Fixtures com a forma medida (fato 1, B3); nunca o ~/.claude real.
P.CLAUDE_PROJECTS = tmp / "projects"; (tmp / "projects" / "C--pasta").mkdir(parents=True)
def jl(sid, *entries, partial=""):
    (tmp / "projects" / "C--pasta" / f"{sid}.jsonl").write_text(
        "".join(json.dumps(e) + "\n" for e in entries) + partial, encoding="utf-8")
def u(t, text="msg"): return {"type": "user", "timestamp": t, "message": {"role": "user", "content": text}}
def a(t, model="claude-opus-5-5", text="feito"):
    return {"type": "assistant", "timestamp": t, "message": {"model": model, "content": [{"type": "text", "text": text}]}}
def hit(t, kind="five_hour", reset=1791079800):
    e = a(t, "<synthetic>", "You've hit your session limit · resets 11:10pm (America/Sao_Paulo)")
    e.update(error="rate_limit", isApiErrorMessage=True,
             quotaLimits={"status": "rejected", "resetsAt": reset, "rateLimitType": kind, "overageStatus": "rejected"})
    return e
noise = [{"type": "system", "subtype": "turn_duration", "timestamp": "2026-10-04T00:05:26Z"},
         {"type": "cost-state"}, {"type": "atis-latch"}, {"type": "mode"}, {"type": "last-prompt"}, {"type": "custom-title"}]
T0, T1, T2 = "2026-10-04T00:00:00.000Z", "2026-10-04T00:05:25.555Z", "2026-10-04T00:17:00.000Z"
t1 = P.transcript_ts({"timestamp": T1})
jl("lim", u(T0), a(T0), hit(T1), *noise)
check(P.quota_state("lim") == {"kind": "limit", "resets_at": 1791079800, "type": "five_hour", "ts": t1},
      "[cota] hit five_hour no fim (seguido de system/cost-state/mode/...): limit com resets_at, type e ts em epoch s")
jl("sem", u(T0), hit(T1), *noise, u(T2, "continue"), a(T2))
check(P.quota_state("sem") == {"kind": None}, "[cota] hit seguido de retomada (user + resposta): kind=None (controle negativo)")
jl("ret", u(T0), hit(T1), u(T2, "continue"))
check(P.quota_state("ret") == {"kind": None}, "[cota] hit seguido so do user da retomada: a ultima user/assistant decide -> None")
jl("sem7", u(T0), hit(T1, "seven_day", 1791356400), *noise)
check(P.quota_state("sem7")["type"] == "seven_day" and P.quota_state("sem7")["resets_at"] == 1791356400,
      "[cota] limite semanal: type seven_day com o resetsAt dele")
big = {"type": "attachment", "timestamp": T1, "attachment": {"content": "x" * 200_000}}
jl("grande", u(T0), hit(T1), big, *noise, partial='{"type": "assistant", "timest')
check(P.quota_state("grande")["kind"] == "limit",
      "[cota] linha de 200 KB depois do hit (attachment real do 112b10ea: 190 KB) + ultima linha pela metade: a janela cresce")
jl("txt", u(T0), a(T1, "<synthetic>", "You've hit your weekly limit · resets Oct 7"), *noise)
check(P.quota_state("txt") == {"kind": "limit", "resets_at": int(t1) + 5 * 3600, "type": None, "ts": t1, "estimated": True},
      "[cota] reserva: <synthetic> sem quotaLimits mas com o texto do limite -> limit com reset estimado (ts + 5 h)")
jl("real", u(T0), a(T1, text="You've hit your session limit, diz o usuario"))
check(P.quota_state("real") == {"kind": None}, "[cota] o texto do limite numa resposta de modelo REAL nao e hit")
jl("erro", u(T0), dict(a(T1, "<synthetic>", "API Error: 500 Internal server error"), isApiErrorMessage=True))
check(P.quota_state("erro") == {"kind": None}, "[cota] <synthetic> de erro transitorio (500): None, nem limit nem auth")
# auth: forma medida na C1 da F0-ter (b55f6b30, sessao --bg com token invalido no arquivo de credenciais)
AUTH_MSG = "Please run /login · API Error: 401 OAuth access token is invalid."
def auth(t):
    e = a(t, "<synthetic>", AUTH_MSG)
    e.update(error="authentication_failed", isApiErrorMessage=True, apiErrorStatus=401, sessionKind="bg")
    return e
jl("auth", u(T0), auth(T1), *noise)
check(P.quota_state("auth") == {"kind": "auth", "ts": t1, "text": AUTH_MSG},
      "[cota] auth: <synthetic> com error=authentication_failed/apiErrorStatus=401 -> kind=auth com ts e texto")
jl("auth-txt", u(T0), dict(a(T1, "<synthetic>", "Failed to authenticate. API Error: 401 Invalid bearer token"), isApiErrorMessage=True))
check(P.quota_state("auth-txt")["kind"] == "auth", "[cota] auth reserva: <synthetic> + isApiErrorMessage + texto de 401, sem campo error")
jl("auth-semflag", u(T0), a(T1, "<synthetic>", "Failed to authenticate. API Error: 401 Invalid bearer token"))
check(P.quota_state("auth-semflag") == {"kind": None}, "[cota] auth reserva exige isApiErrorMessage: so o texto de 401 nao basta")
jl("auth-ret", u(T0), auth(T1), *noise, u(T2, "responda so: ok"), a(T2, text="ok"))
check(P.quota_state("auth-ret") == {"kind": None} and P.answered_since("auth-ret", t1) is True,
      "[cota] auth seguido de retomada com resposta real (C1.4): None e answered_since=True")
jl("auth-real", u(T0), a(T1, text="Please run /login, disse o usuario"))
check(P.quota_state("auth-real") == {"kind": None}, "[cota] texto de /login numa resposta de modelo REAL nao e auth")
check(P.quota_state("nao-existe") == {"kind": None} and P.quota_state(None) == {"kind": None},
      "[cota] sem transcript (ou sem id): None, sem erro")
# answered_since (R8): so resposta de modelo real DEPOIS do ts prova que a conta respondeu
check(P.answered_since("sem", t1) is True, "[cota] answered_since: assistant real depois do ts -> True")
jl("so-hit", u(T0), a(T0), u(T2), hit(T2), *noise)
check(P.answered_since("so-hit", t1) is False, "[cota] answered_since: depois do ts so o <synthetic> do limite -> False")
check(P.answered_since("lim", t1) is False, "[cota] answered_since: assistant real so ANTES do ts -> False")
jl("resp-grande", u(T0), hit(T1), u(T2), a(T2), big, *noise)
check(P.answered_since("resp-grande", t1) is True,
      "[cota] answered_since: a resposta fica antes de uma linha de 200 KB (como as linhas 43-45 do 112b10ea)")

# [cota] F2: guarda das contas (DPAPI, accounts.json), run(token=)/mask, validate_account, try_lock e gravacao
# repetida. Copia C com o `run` REAL e o `subprocess` DELA trocado por um falso (o global nao muda).
# Nunca o %USERPROFILE%\.claude-accounts nem o ~/.claude reais: os dois sao conferidos no fim.
import io, os, subprocess
REAL_CRED, REAL_ACC = Path.home() / ".claude" / ".credentials.json", Path.home() / ".claude-accounts" / "accounts.json"
def mtime_ns(p): return p.stat().st_mtime_ns if p.exists() else None
real0 = (mtime_ns(REAL_CRED), mtime_ns(REAL_ACC))
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)
C.PIPE = tmp / "pipe-cota"; C.STATE = C.PIPE / "state.json"; C.ACCOUNTS_DIR = tmp / "contas"; C.DSG = tmp / "nao-existe"
C.PIPE.mkdir()
C.CRED_FILE = tmp / "cred-c.json"
C.claude_exe = lambda: "claude"
sp_calls, sp_reply = [], [(0, "", "")]
def fake_sp_run(cmd, **kw):
    sp_calls.append((list(map(str, cmd)), kw.get("env"), kw.get("cwd")))
    if isinstance(sp_reply[0], BaseException):
        raise sp_reply[0]
    rc, out, err = sp_reply[0]
    return types.SimpleNamespace(returncode=rc, stdout=out, stderr=err)
C.subprocess = types.SimpleNamespace(run=fake_sp_run, TimeoutExpired=subprocess.TimeoutExpired)
sess_env = os.environ.pop("CLAUDE_CODE_SESSION_ID", None)      # esta simulacao costuma rodar dentro de uma sessao
def acc_json(): return json.loads((C.ACCOUNTS_DIR / "accounts.json").read_text(encoding="utf-8"))
def captured(fn):
    old, buf, code = (sys.stdout, sys.stderr), io.StringIO(), None
    sys.stdout = sys.stderr = buf
    try: fn()
    except SystemExit as e: code = e.code
    finally: sys.stdout, sys.stderr = old
    return buf.getvalue(), code
def acc_cmd(acmd, label=None, email=None, stdin=""):
    old = sys.stdin; sys.stdin = io.StringIO(stdin)
    try: return captured(lambda: C.cmd_accounts(types.SimpleNamespace(acmd=acmd, label=label, email=email)))
    finally: sys.stdin = old
def tok(c): return "sk-ant-oat01-" + c * 95                    # forma da questao 9: 108 caracteres
blob = C.dpapi_protect(tok("A").encode())
check(C.dpapi_unprotect(blob) == tok("A").encode() and tok("A").encode() not in blob,
      "[cota] DPAPI: ida e volta devolve o token; o cifrado nao o contem")
check([C.rotation_on(x) for x in ({"order": []}, {"order": ["c1"]}, {"order": ["c1", "c2"]},
                                  {"order": ["c1", "c2"], "paused": True})] == [False, False, True, False],
      "[cota] rotation_on: 0 e 1 conta -> falso; 2 -> verdadeiro; 2 com paused -> falso (R18)")
out, code = acc_cmd("add", "c1", "um@x", stdin=tok("A") + "\n")
e1 = acc_json()["accounts"]["c1"]
check(code is None and acc_json()["order"] == ["c1"] and e1["email"] == "um@x"
      and e1["token_version"] == C.token_path("c1").stat().st_mtime and C.token_of("c1") == (tok("A"), e1["token_version"]),
      "[cota] add le o token do stdin, grava o .token cifrado e a token_version = mtime dele (R14)")
acc_cmd("add", "c2", stdin=tok("B") + "\n")
raw = b"".join(p.read_bytes() for p in C.ACCOUNTS_DIR.iterdir())
check(b"sk-ant-" not in raw and sorted(p.name for p in C.ACCOUNTS_DIR.iterdir()) == ["accounts.json", "c1.token", "c2.token"],
      "[cota] nenhum token em claro na pasta das contas (accounts.json e .token): grep = 0, sem .tmp sobrando")
out, code = acc_cmd("add", "c3", stdin="nao-e-um-token\n")
check(code == 2 and "c3" not in acc_json()["accounts"] and "nao-e-um-token" not in out,
      "[cota] add recusa o que nao tem a forma do token, sem gravar e sem repeti-lo na mensagem")
a_ = acc_json(); a_["accounts"]["c2"]["invalid"] = {"since": 1791080000, "reason": "API Error: 401 OAuth access token is invalid."}
(C.ACCOUNTS_DIR / "accounts.json").write_text(json.dumps(a_), encoding="utf-8")
out, code = acc_cmd("list")
check(code is None and "ligado (2 contas)" in out and "INVALIDA desde" in out and "OAuth access token is invalid" in out
      and "sk-ant-" not in out, "[cota] list: sem token, com a conta invalida e o motivo, e o rodizio ligado com 2 contas")
# S32 (R7, R14): token de conta invalida trocado pelo add; so um `ok` da versao NOVA zera o invalid
real_validate = C.validate_account
C.validate_account = lambda label: ("auth", C.token_of(label)[1], "Failed to authenticate. API Error: 401 Invalid bearer token")
acc_cmd("add", "c2", stdin=tok("C") + "\n")
inv_auth = acc_json()["accounts"]["c2"]["invalid"]
C.validate_account = lambda label: ("ok", C.token_of(label)[1] - 1, "ok")       # versao anterior a do .token atual
acc_cmd("add", "c2", stdin=tok("D") + "\n")
inv_old = acc_json()["accounts"]["c2"]["invalid"]
C.validate_account = lambda label: ("ok", C.token_of(label)[1], "ok")
acc_cmd("add", "c2", stdin=tok("E") + "\n")
check(inv_auth and inv_old and acc_json()["accounts"]["c2"]["invalid"] is None and acc_json()["order"] == ["c1", "c2"],
      "[cota] S32: add sobre conta invalida: validacao auth mantem; ok de versao antiga mantem (R14); ok da nova zera")
C.validate_account = real_validate
# token_of (R14): outro processo troca o .token; este (um vigia de horas) le o novo sem reiniciar
decrypts, real_unprotect = [0], C.dpapi_unprotect
C.dpapi_unprotect = lambda b: (decrypts.__setitem__(0, decrypts[0] + 1), real_unprotect(b))[1]
pth = C.token_path("c9")
pth.write_bytes(C.dpapi_protect(b"segredo-velho-111")); os.utime(pth, (1791000000, 1791000000))
v_old = C.token_of("c9"); C.token_of("c9")
pth.write_bytes(C.dpapi_protect(b"segredo-novo-222")); os.utime(pth, (1791000100, 1791000100))
v_new = C.token_of("c9")
check(v_old == ("segredo-velho-111", 1791000000) and v_new == ("segredo-novo-222", 1791000100) and decrypts[0] == 2,
      f"[cota] token_of (R14): cache por mtime (2 leituras = 1 decifragem); mtime novo -> token e versao novos ({decrypts[0]})")
check(C.mask("a segredo-velho-111 b segredo-novo-222 c") == "a *** b *** c",
      "[cota] mask cobre o token antigo e o novo, mesmo sem a forma sk-ant-")
C.dpapi_unprotect = real_unprotect
os.utime(C.token_path("c1"), (time.time() + 100, time.time() + 100))   # relogio do arquivo a frente (ou no mesmo tick)
before = C.token_path("c1").stat().st_mtime
check(C.token_write("c1", tok("A")) > before, "[cota] token_write: a versao sempre sobe, mesmo com o mtime anterior a frente")
# run: so o validate_account manda token, e pelo env; todo o resto vai com o env de hoje
os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = "herdado"; sp_calls.clear()
try:
    C.run(["claude", "agents"]); C.run(["claude", "-p", "x"], token=tok("A")); C.run(["git", "status"], cwd=tmp)
    C.run(["python", "-V"]); clean = C.clean_env()
finally:
    del os.environ["CLAUDE_CODE_OAUTH_TOKEN"]
envs = [c[1] for c in sp_calls]
check(envs[0] == clean and "CLAUDE_CODE_OAUTH_TOKEN" not in clean and envs[1] == {**clean, "CLAUDE_CODE_OAUTH_TOKEN": tok("A")}
      and envs[2] is None and envs[3] is None,
      "[cota] run: so com token= o env leva CLAUDE_CODE_OAUTH_TOKEN; outro claude vai com clean_env, git/python com o env herdado")
# validate_account: as tres saidas reais da questao 8 (e o 401 do arquivo, C1.1); o resto e transitorio
cases = [((0, "ok\n", ""), "ok"),
         ((1, "You've hit your weekly limit · resets Oct 7, 4am (America/Sao_Paulo)\n", ""), "limit"),
         ((1, "Failed to authenticate. API Error: 401 Invalid bearer token\n", ""), "auth"),
         ((1, "Failed to authenticate. API Error: 401 OAuth access token is invalid.\n", ""), "auth"),
         ((1, "API Error: 500 Internal server error\n", ""), "transitorio"), ((1, "", ""), "transitorio"),
         (subprocess.TimeoutExpired("claude", 120), "transitorio")]
got = []
for reply, _ in cases:
    sp_reply[0] = reply; got.append(C.validate_account("c1"))
check([g[0] for g in got] == [w for _, w in cases] and {g[1] for g in got} == {C.token_of("c1")[1]},
      f"[cota] validate_account: ok/limit/auth(env e arquivo)/500/vazio/timeout -> {[g[0] for g in got]}, com a versao testada")
cmd_, env_, cwd_ = sp_calls[-1]
check(cmd_ == ["claude", "-p", "responda ok", "--model", "claude-haiku-4-5-20251001"]
      and env_["CLAUDE_CODE_OAUTH_TOKEN"] == tok("A") and Path(cwd_) == Path(tempfile.gettempdir()),
      "[cota] validate_account: claude -p no haiku com o token DA CONTA no env e cwd fora do projeto")
# S24 (R5): o CLI devolve um token (um decifrado aqui e um sk-ant- desconhecido) -> mascarado nos quatro caminhos
KNOWN, UNKNOWN = tok("A"), "sk-ant-ort01-" + "Z" * 95
st24 = {"run_id": "r24", "base": "origin/versao3", "effort": "medium", "model": "m", "permission_mode": "auto",
        "bugs": {}, "final": {"state": "rodando", "session": None}, "pending_spawns": []}
C.agents = lambda: [{"sessionId": "abcd1234-0000", "name": "pipeline-finalizacao-r24", "startedAt": 9e12}]
# 2 contas e nenhuma ativa: desde a F5 o portao do spawn fecharia. O caso e a mascara: rodizio pausado.
a_ = acc_json(); a_["paused"] = True; (C.ACCOUNTS_DIR / "accounts.json").write_text(json.dumps(a_), encoding="utf-8")
sp_reply[0] = (0, f"backgrounded · abcd1234 · pipeline-finalizacao-r24\n{KNOWN} {UNKNOWN}", f"aviso {KNOWN}")
out_ok, _ = captured(lambda: C.spawn(st24, None, "finalizacao", "m1"))
st24["final"]["session"] = None
sp_reply[0] = (1, f"saida {UNKNOWN}", f"erro {KNOWN} {UNKNOWN}")
out_fail, _ = captured(lambda: C.spawn(st24, None, "finalizacao", "m2"))
a_["paused"] = False; (C.ACCOUNTS_DIR / "accounts.json").write_text(json.dumps(a_), encoding="utf-8")
C.save(st24)
sp_reply[0] = (2, f"out {KNOWN}", f"err {UNKNOWN}")
out_die, code_die = captured(lambda: C.run(["claude", "x"]))
sp_reply[0] = (1, f"Failed to authenticate. API Error: 401 {KNOWN}", f"{UNKNOWN}")
res24 = C.validate_account("c1")
leak = [w for w in (C.STATE.read_text(encoding="utf-8"), out_ok, out_fail, out_die, res24[2]) if KNOWN in w or UNKNOWN in w]
check(not leak and "***" in st24["pending_spawns"][0]["why"] and code_die == 1 and "***" in out_die
      and res24[0] == "auth" and "***" in res24[2],
      "[cota] S24: token mascarado no cli_output, na why da pendencia (ledger e aviso), no die do check=True e no validate_account")
# S51 (R23, R15): dentro de sessao, add/remove/validate recusam sem tocar accounts.json; list funciona
af = C.ACCOUNTS_DIR / "accounts.json"; snap = (af.read_bytes(), af.stat().st_mtime_ns); n_sp = len(sp_calls)
os.environ["CLAUDE_CODE_SESSION_ID"] = "sessao-do-pipeline"
try:
    codes = [acc_cmd("add", "c4", stdin=tok("F") + "\n")[1], acc_cmd("remove", "c1")[1], acc_cmd("validate", "c1")[1]]
    out51, code51 = acc_cmd("list")
finally:
    del os.environ["CLAUDE_CODE_SESSION_ID"]
check(codes == [2, 2, 2] and (af.read_bytes(), af.stat().st_mtime_ns) == snap and len(sp_calls) == n_sp
      and code51 is None and "c1" in out51 and not C.token_path("c4").exists(),
      "[cota] S51: com CLAUDE_CODE_SESSION_ID, add/remove/validate saem 2 sem tocar accounts.json nem o CLI; list funciona")
a_ = acc_json(); a_["active"] = "c1"; af.write_text(json.dumps(a_), encoding="utf-8")
out_rm, code_rm = acc_cmd("remove", "c2")
check(code_rm is None and acc_json()["order"] == ["c1"] and acc_json()["active"] == "c1"
      and not C.token_path("c2").exists() and "desligado" in out_rm,
      "[cota] remove (nao ativa): sai do order, perde o .token, a ativa fica e o rodizio desliga com 1 conta")
# try_lock: nao bloqueia; o lock e por handle (mesmo processo, outro handle -> None)
h1 = C.try_lock("quota-watch"); h2 = C.try_lock("quota-watch"); C.unlock(h1); h3 = C.try_lock("quota-watch"); C.unlock(h3)
with C.file_lock("state"):
    h4 = C.try_lock("state")
check(h1 is not None and h2 is None and h3 is not None and h4 is None,
      "[cota] try_lock: o 2o do mesmo nome devolve None; depois de soltar, consegue; com file_lock preso, None")
# S35 (N3): os.replace falha com PermissionError (leitor sem lock com o arquivo aberto) -> repete e conclui
real_replace, real_sleep, fails, sleeps = os.replace, time.sleep, [0], []
def flaky(src, dst):
    if fails[0]:
        fails[0] -= 1; raise PermissionError(13, "simulado: leitor sem lock com o destino aberto")
    return real_replace(src, dst)
os.replace, time.sleep = flaky, (lambda s: sleeps.append(s))
try:
    fails[0] = 2; C.save({"x": 1}); ok_save = fails[0] == 0 and json.loads(C.STATE.read_text(encoding="utf-8")) == {"x": 1}
    a_ = acc_json(); a_["paused"] = True
    fails[0] = 2; C.accounts_save(a_); ok_acc = fails[0] == 0 and acc_json()["paused"] is True
    fails[0] = 5
    try: C.save({"x": 2}); gave_up = False
    except PermissionError: gave_up = True
finally:
    os.replace, time.sleep = real_replace, real_sleep
check(ok_save and ok_acc and sleeps[:4] == [0.2] * 4,
      "[cota] S35: save e accounts_save gravam na 3a tentativa, com 0,2 s entre elas")
check(gave_up and json.loads(C.STATE.read_text(encoding="utf-8")) == {"x": 1},
      "[cota] S35: 5 falhas seguidas -> desiste com o PermissionError, e o arquivo fica como estava")
# [cota] F3: arquivo de credenciais (secao 6.7). CRED_FILE temporario com a forma de B1 (claudeAiOauth de
# /login falso + mcpOAuth com 2 entradas + outra chave de topo). Guarda nova, com as contas `s` e `e`.
F3 = tmp / "f3"; (F3 / "claude").mkdir(parents=True)
C.ACCOUNTS_DIR = F3 / "contas"; C.CRED_FILE = F3 / "claude" / ".credentials.json"
def login_blk(c): return {"accessToken": "sk-ant-oat01-" + c * 95, "refreshToken": "sk-ant-ort01-" + c * 95,
                          "expiresAt": 1791100000000, "refreshTokenExpiresAt": 1822600000000,
                          "scopes": ["user:file_upload", "user:inference", "user:mcp_servers", "user:plugins",
                                     "user:profile", "user:sessions:claude_code"],
                          "subscriptionType": "max", "rateLimitTier": "tier_x"}
MCP = {"trello|a1": {"accessToken": "t-1", "refreshToken": "r-1"}, "meta-ads|b2": {"accessToken": "t-2", "refreshToken": "r-2"}}
MCP2 = {**MCP, "trello|a1": {"accessToken": "t-1-renovado", "refreshToken": "r-1-girado"}}
L1, L2, L3 = login_blk("L"), login_blk("M"), login_blk("N")
def cred_put(d): C.CRED_FILE.write_text(json.dumps(d), encoding="utf-8")
def cred_get(): return json.loads(C.CRED_FILE.read_text(encoding="utf-8"))
def cred_tok(): return cred_get()["claudeAiOauth"]["accessToken"]
def cred_snap(): return (C.CRED_FILE.read_bytes(), C.CRED_FILE.stat().st_mtime_ns)
def bak(): return json.loads(C.dpapi_unprotect(C.login_bak().read_bytes()))
def bak_snap(): return (C.login_bak().read_bytes(), C.login_bak().stat().st_mtime_ns)
def tmps(): return [p.name for d in (C.CRED_FILE.parent, C.ACCOUNTS_DIR) for p in d.glob("*.tmp")]
def acc_set(**kw):
    a_ = acc_json(); a_.update(kw); (C.ACCOUNTS_DIR / "accounts.json").write_text(json.dumps(a_), encoding="utf-8")
box = {}
acc_cmd("add", "s", stdin=tok("S") + "\n"); acc_cmd("add", "e", stdin=tok("G") + "\n")
acc = C.accounts_load(); r0 = C.apply_account(acc, "s", 1791000000.0)
check(r0 == (None, "sem bloco") and list(cred_get()) == ["claudeAiOauth"] and cred_get()["claudeAiOauth"]["subscriptionType"] == "pro"
      and not C.login_bak().exists() and acc["applied"] is True,
      "[cota] apply_account: arquivo ausente -> grava so o bloco (sem bloco), sem login.bak")
cred_put({"claudeAiOauth": L1, "mcpOAuth": MCP, "outra": {"x": 1}})
acc = C.accounts_load(); r1 = C.apply_account(acc, "s", 1791000000.0); d = cred_get()
check(r1 == (None, "bloco de fora")
      and d["claudeAiOauth"] == {"accessToken": tok("S"), "expiresAt": (1791000000 + 300 * 86400) * 1000,
                                 "scopes": ["user:inference"], "subscriptionType": "max", "rateLimitTier": "tier_x"}
      and d["mcpOAuth"] == MCP and d["outra"] == {"x": 1} and list(d) == ["claudeAiOauth", "mcpOAuth", "outra"],
      "[cota] apply_account: bloco v1 com as chaves exatas (sem refreshToken); mcpOAuth e a outra chave de topo iguais")
check(bak() == L1 and acc["applied"] is True and acc["login_saved_at"] == 1791000000.0 and acc["switch_error"] is None
      and b"sk-ant-" not in C.login_bak().read_bytes() and not tmps(),
      "[cota] apply_account: o bloco do /login vai cifrado para o login.bak antes de ser sobrescrito; nenhum .tmp sobra")
snap = cred_snap(); r2 = C.apply_account(acc, "s", 1791000500.0)
check(r2 == (None, "ja estava") and cred_snap() == snap, "[cota] apply_account idempotente: arquivo ja na conta -> nenhuma gravacao (mtime igual)")
real_rr = C.replace_retry
def boom(src, dst, **kw): raise RuntimeError("simulado")
C.replace_retry = boom
try: C.apply_account(acc, "e", 1791000600.0); blew = False
except RuntimeError: blew = True
finally: C.replace_retry = real_rr
check(blew and cred_snap() == snap and not tmps(), "[cota] apply_account: excecao forcada no meio da gravacao -> arquivo intacto e nenhum .tmp")
bs = bak_snap(); r3 = C.apply_account(acc, "e", 1791000700.0)
check(r3 == (None, "outra conta cadastrada") and cred_tok() == tok("G") and bak_snap() == bs and cred_get()["mcpOAuth"] == MCP,
      "[cota] S26: arquivo com o token de outra conta cadastrada -> regrava sem tocar o login.bak")
d = cred_get(); d["claudeAiOauth"] = L2; cred_put(d); r4 = C.apply_account(acc, "e", 1791000800.0)
check(r4 == (None, "bloco de fora") and bak() == L2 and acc["login_saved_at"] == 1791000800.0 and cred_tok() == tok("G"),
      "[cota] S25: bloco de fora NOVO (renovacao do CLI ou /login manual) -> o login.bak passa a ser esse bloco")
real_replace, real_sleep = os.replace, time.sleep
def always_denied(src, dst): raise PermissionError(13, "simulado")
def lying(src, dst):                                # o os.replace "funciona", mas o arquivo fica com outra coisa
    real_replace(src, dst)
    if Path(dst) == C.CRED_FILE: cred_put({"claudeAiOauth": {"accessToken": tok("G")}, "mcpOAuth": MCP})
snap = cred_snap(); os.replace, time.sleep = always_denied, (lambda s: None)
try:
    r5 = C.apply_account(acc, "s", 1791000900.0)
    ok5 = bool(r5[0]) and "PermissionError" in r5[0] and acc["switch_error"] == r5[0] and cred_snap() == snap and not tmps()
    os.replace = real_replace
    C.CRED_FILE.write_text("{nao e json", encoding="utf-8"); snap = cred_snap()
    r6 = C.apply_account(acc, "s", 1791000910.0)
    ok6 = bool(r6[0]) and "ilegivel" in r6[0] and cred_snap() == snap and not tmps()
    cred_put({"claudeAiOauth": {"accessToken": tok("G")}, "mcpOAuth": MCP}); acc_set(active="e", applied=True)
    os.replace = lying
    out7, code7 = acc_cmd("activate", "s"); a7 = acc_json()
    ok7 = code7 == 1 and a7["active"] == "e" and "conferencia" in (a7["switch_error"] or "") and not tmps()
finally:
    os.replace, time.sleep = real_replace, real_sleep
check(ok5 and ok6 and ok7,
      f"[cota] S27: PermissionError em todas as tentativas, JSON invalido 2x (nada gravado) e conferencia falha -> switch_error, active igual ({ok5}, {ok6}, {ok7})")
calls, real_stat = [0], C.cred_stat
def racing():
    calls[0] += 1
    if calls[0] == 2:                               # o CLI renova o mcpOAuth entre a leitura e o os.replace
        d_ = cred_get(); d_["mcpOAuth"] = MCP2; cred_put(d_)
    return real_stat()
C.cred_stat = racing; acc = C.accounts_load()
try: r8 = C.apply_account(acc, "s", 1791001000.0)
finally: C.cred_stat = real_stat
check(r8[0] is None and cred_get()["mcpOAuth"] == MCP2 and cred_tok() == tok("S") and calls[0] >= 4 and not tmps(),
      "[cota] S28: o arquivo muda entre a leitura e o os.replace -> a gravacao recomeca e o mcpOAuth novo fica")
os.environ["CLAUDE_CONFIG_DIR"] = str(tmp); snap = cred_snap(); bs = bak_snap()
try: r9 = C.apply_account(acc, "e", 1791001100.0)
finally: del os.environ["CLAUDE_CONFIG_DIR"]
check(bool(r9[0]) and "CLAUDE_CONFIG_DIR" in r9[0] and cred_snap() == snap and bak_snap() == bs,
      "[cota] S58: com CLAUDE_CONFIG_DIR no env, apply_account recusa sem gravar")
acc = C.accounts_load(); acc["applied"] = True
captured(lambda: box.update(r=C.restore_login(acc, 1791002000.0, "teste"))); d = cred_get()
check(box["r"] == "devolvido" and d["claudeAiOauth"] == L2 and d["mcpOAuth"] == MCP2 and acc["applied"] is False
      and acc["login_restored_at"] == 1791002000.0 and C.login_bak().exists() and not tmps(),
      "[cota] restore_login: o arquivo volta ao bloco do login.bak, com o resto preservado; applied falso; o login.bak fica")
sp_calls.clear(); sp_reply[0] = (0, "ok\n", "")
captured(lambda: box.update(s1=C.restore_sanity()))
sp_reply[0] = (1, "Failed to authenticate. API Error: 401 OAuth access token is invalid.\n", "")
out_s2, _ = captured(lambda: box.update(s2=C.restore_sanity()))
check(box["s1"] == "ok" and box["s2"] == "auth" and "faca /login" in out_s2 and len(sp_calls) == 2
      and sp_calls[0][0][:2] == ["claude", "-p"] and all("CLAUDE_CODE_OAUTH_TOKEN" not in c[1] for c in sp_calls),
      "[cota] restore_login: a sanidade roda SEM token (pelo arquivo); auth -> pede /login")
d = cred_get(); d["claudeAiOauth"] = L3; cred_put(d); snap = cred_snap(); acc["applied"] = True
captured(lambda: box.update(r=C.restore_login(acc, 1791002100.0, "teste")))
check(box["r"] == "ja no /login" and cred_snap() == snap and acc["applied"] is False,
      "[cota] restore_login: o arquivo ja tem um bloco de fora (mais novo que o login.bak) -> nao sobrescreve")
C.apply_account(acc, "s", 1791002200.0); C.login_bak().unlink(); snap = cred_snap()
out57, _ = captured(lambda: box.update(r=C.restore_login(acc, 1791002300.0, "teste")))
check(box["r"] == "sem login.bak" and cred_snap() == snap and acc["applied"] is True and "faca /login" in out57
      and C.restore_login({**acc, "applied": False}, 0, "teste") == "nada" and cred_snap() == snap,
      "[cota] S57: sem login.bak, restore_login nao grava e pede /login; com applied falso, nada")
# S53: os comandos do dono. activate grava e despausa; restore devolve, pausa e roda a sanidade
cred_put({"claudeAiOauth": L1, "mcpOAuth": MCP})
acc_set(active=None, applied=False, paused=False, file_repairs=0, last_repair=None, switch_error=None)
out_a, code_a = acc_cmd("activate", "s"); a1 = acc_json(); f1 = cred_tok(); out_l, _ = acc_cmd("list")
sp_calls.clear(); sp_reply[0] = (0, "ok\n", "")
out_r, code_r = acc_cmd("restore"); a2 = acc_json()
check(code_a is None and a1["active"] == "s" and a1["applied"] is True and a1["paused"] is False and a1["switched_at"]
      and f1 == tok("S") and "conta s (confere)" in out_l and "sk-ant-" not in out_a + out_l,
      "[cota] S53: accounts activate grava a conta no arquivo, liga active/applied e o list mostra que o arquivo confere")
check(code_r is None and a2["paused"] is True and a2["applied"] is False and a2["active"] == "s" and cred_get() == {"claudeAiOauth": L1, "mcpOAuth": MCP}
      and len(sp_calls) == 1 and "sanidade" in out_r,
      "[cota] S53: accounts restore devolve o /login, liga paused e roda a sanidade")
acc_cmd("activate", "e"); a3 = acc_json()
check(a3["paused"] is False and a3["active"] == "e" and cred_tok() == tok("G") and bak() == L1,
      "[cota] S53: o activate seguinte desliga paused e grava de novo")
os.environ["CLAUDE_CODE_SESSION_ID"] = "sessao-do-pipeline"; snap = cred_snap()
try: codes = [acc_cmd("activate", "s")[1], acc_cmd("restore")[1]]
finally: del os.environ["CLAUDE_CODE_SESSION_ID"]
check(codes == [2, 2] and cred_snap() == snap and acc_json()["active"] == "e",
      "[cota] S51: dentro de sessao, activate e restore saem 2 sem tocar o arquivo")
# add da ativa, num processo novo (sem o token antigo na memoria): o arquivo recebe o token novo e o
# antigo NAO e confundido com o /login
C._SECRETS.clear(); C._TOKENS.clear(); bs = bak_snap()
out_t, _ = acc_cmd("add", "e", stdin=tok("T") + "\n"); a4 = acc_json()
check(cred_tok() == tok("T") and bak_snap() == bs and a4["file_repairs"] == 0 and "sk-ant-" not in out_t,
      "[cota] add da conta ativa: o arquivo passa a ter o token novo; o antigo nao vai para o login.bak nem conta reparo")
d = cred_get(); d["claudeAiOauth"] = L2; cred_put(d)
check("conta e (DIVERGE)" in acc_cmd("list")[0], "[cota] list: arquivo fora da conta ativa -> DIVERGE")
# spawn: conferencia depois do resume_cmd e antes do CLI; account e sent_ts no rec
events, clock, after_run = [], [1791003000.0], [None]
real_time, real_ensure, real_resume = C.time, C.ensure_active, C.resume_cmd
def fake_resume(exe, sid, prompt):
    events.append("resume"); clock[0] += 30; return [exe, "--bg", "--resume", sid, prompt]
def ev_run(cmd, **kw):
    events.append("run"); r = fake_sp_run(cmd, **kw)
    if after_run[0]: after_run[0]()
    return r
def outsider(): d_ = cred_get(); d_["claudeAiOauth"] = L3; cred_put(d_)
C.time = types.SimpleNamespace(time=lambda: clock[0], sleep=lambda s: None)
C.resume_cmd = fake_resume
C.ensure_active = lambda acc_, ts: (events.append("ensure"), real_ensure(acc_, ts))[1]
C.subprocess = types.SimpleNamespace(run=ev_run, TimeoutExpired=subprocess.TimeoutExpired)
st3 = {"run_id": "r3", "base": "origin/versao3", "effort": "medium", "model": "m", "permission_mode": "auto", "bugs": {},
       "final": {"state": "rodando", "session": {"name": "pipeline-finalizacao-r24", "id": "abcd1234-0000"}}, "pending_spawns": []}
sp_reply[0] = (0, "backgrounded · abcd1234 · pipeline-finalizacao-r24\n", ""); t_start = clock[0]
try:
    captured(lambda: box.update(rec=C.spawn(st3, None, "finalizacao", "retome")))
    rec, a5 = box["rec"], acc_json()
    check(events == ["resume", "ensure", "run"] and rec["account"] == "e" and "account_uncertain" not in rec and cred_tok() == tok("T")
          and a5["file_repairs"] == 1 and a5["last_repair"]["motivo"] == "bloco de fora" and bak() == L2,
          "[cota] spawn (retomada): ensure_active depois do resume_cmd e antes do CLI; repara o arquivo, conta o reparo e grava rec.account")
    check(rec["sent_ts"] == t_start + 30 and rec["sent_ts"] != (int(t_start * 1000) - 2000) / 1000,
          "[cota] sent_ts (R13): posterior ao retorno do resume_cmd (que levou 30 s) e diferente de t0 / 1000")
    st3["final"]["session"] = None; events.clear()
    captured(lambda: box.update(rec=C.spawn(st3, None, "finalizacao", "nasce")))
    check(events == ["ensure", "run"] and box["rec"]["account"] == "e" and box["rec"]["sent_ts"] == clock[0]
          and acc_json()["file_repairs"] == 1,
          "[cota] spawn (nascimento): grava rec.account e rec.sent_ts; arquivo ja certo -> sem reparo")
    good = C.CRED_FILE.read_bytes(); C.CRED_FILE.write_text("{quebrado", encoding="utf-8")
    st3["final"]["session"] = None; events.clear()
    captured(lambda: box.update(rec=C.spawn(st3, None, "finalizacao", "m3")))
    check(box["rec"] is None and "run" not in events and st3["final"]["session"] is None
          and st3["pending_spawns"][-1]["why"].startswith("arquivo de credenciais nao confere: ")
          and C.CRED_FILE.read_text(encoding="utf-8") == "{quebrado",
          "[cota] spawn: ensure_active falhando -> pendencia 'arquivo de credenciais nao confere' SEM chamar o CLI")
    C.CRED_FILE.write_bytes(good); st3["pending_spawns"].clear(); after_run[0] = outsider; events.clear()
    out55, _ = captured(lambda: box.update(rec=C.spawn(st3, None, "finalizacao", "m4")))
    after_run[0] = None
    check(box["rec"]["account"] == "e" and box["rec"].get("account_uncertain") is True and "incerta" in out55,
          "[cota] S55: o arquivo e trocado por fora entre a chamada ao CLI e o fim do registro -> rec.account_uncertain")
    acc_set(paused=True); snap = cred_snap(); st3["final"]["session"] = None; events.clear()
    captured(lambda: box.update(rec=C.spawn(st3, None, "finalizacao", "m5")))
    check(box["rec"]["account"] is None and "sent_ts" in box["rec"] and "account_uncertain" not in box["rec"]
          and events == ["run"] and cred_snap() == snap,
          "[cota] spawn sem rodizio (pausado): account nulo, nenhuma conferencia e nenhuma gravacao no arquivo")
    check(real_ensure(C.accounts_load(), clock[0]) == "ok" and cred_snap() == snap and cred_tok() != tok("T"),
          "[cota] ensure_active com o rodizio pausado: nada, mesmo com o arquivo fora da conta ativa")
finally:
    C.time, C.ensure_active, C.resume_cmd = real_time, real_ensure, real_resume
    C.subprocess = types.SimpleNamespace(run=fake_sp_run, TimeoutExpired=subprocess.TimeoutExpired)
# remove que deixa < 2 contas: o rodizio desliga e o mesmo comando devolve o /login
acc_set(paused=False); acc_cmd("activate", "e"); sp_calls.clear(); sp_reply[0] = (0, "ok\n", "")
out_rm3, code_rm3 = acc_cmd("remove", "s"); a6 = acc_json()
check(code_rm3 is None and a6["order"] == ["e"] and a6["applied"] is False and cred_get()["claudeAiOauth"] == L3
      and len(sp_calls) == 1 and "CLAUDE_CODE_OAUTH_TOKEN" not in sp_calls[0][1],
      "[cota] remove que deixa < 2 contas: devolve o /login no mesmo comando e roda a sanidade sem token")
snap = cred_snap(); out_one, code_one = acc_cmd("activate", "e")
check(code_one == 2 and cred_snap() == snap, "[cota] activate com 1 conta recusa sem gravar: nada devolveria o /login sozinho")
raw = b"".join(p.read_bytes() for p in C.ACCOUNTS_DIR.iterdir())
check(b"sk-ant-" not in raw and not tmps() and sorted(p.name for p in C.ACCOUNTS_DIR.iterdir()) == ["accounts.json", "e.token", "login.bak"],
      "[cota] guarda no fim da F3: accounts.json, e.token e login.bak, nenhum token em claro, nenhum .tmp")
# [cota] F4: pick_account, rotate, attribute (secao 6.4), late_answered, count_hit e o remove da ativa.
# Guarda nova (f4) com 4 contas; apply_account REAL sobre um CRED_FILE temporario.
F4 = tmp / "f4"; (F4 / "claude").mkdir(parents=True)
C.ACCOUNTS_DIR = F4 / "contas"; C.CRED_FILE = F4 / "claude" / ".credentials.json"; C.CLAUDE_PROJECTS = tmp / "projects"
TK = {k: tok(c) for k, c in zip("abcd", "1234")}
NOW = 1791100000.0; R1 = int(NOW) + 3600; INV = {"since": 1791080000, "reason": "401"}
D = C.dt.datetime
def f4_reset(active="a", applied=False, **over):
    """Guarda f4 no disco, com as 4 contas disponiveis. applied: o arquivo esta na ativa e o /login (L1)
    no login.bak; senao o arquivo esta no /login e nao ha login.bak. Devolve o acc carregado."""
    if not (C.ACCOUNTS_DIR / "accounts.json").exists() or acc_json()["order"] != list("abcd"):
        for p in C.ACCOUNTS_DIR.glob("*"): p.unlink()
        C._TOKENS.clear()
        for lab in "abcd": acc_cmd("add", lab, stdin=TK[lab] + "\n")
    C.login_bak().unlink(missing_ok=True)
    blk = L1
    if applied:
        C.login_bak().write_bytes(C.dpapi_protect(json.dumps(L1).encode("utf-8")))
        blk = {"accessToken": TK[active], "expiresAt": 1, "scopes": ["user:inference"], "subscriptionType": "max", "rateLimitTier": "tier_x"}
    cred_put({"claudeAiOauth": blk, "mcpOAuth": MCP})
    a_ = acc_json()
    a_.update(active=active, applied=applied, paused=False, switched_at=NOW - 1000, wake_at=NOW + 99, switch_error=None, armed=None)
    for k in a_["accounts"]:
        a_["accounts"][k].update(exhausted_until=0, last_limit_type=None, last_hit=None, late_retries=0, invalid=None)
    for k, v in over.items(): a_["accounts"][k].update(v)
    (C.ACCOUNTS_DIR / "accounts.json").write_text(json.dumps(a_), encoding="utf-8")
    return C.accounts_load()
def ex(t): return {"exhausted_until": t}
def frozen(acc_): return json.dumps(acc_, sort_keys=True)
def lim(ts, reset, typ="five_hour"): return {"kind": "limit", "resets_at": reset, "type": typ, "ts": ts}
def ah(ts): return {"kind": "auth", "ts": ts, "text": AUTH_MSG}                # hit de auth: sem resets_at
def rec_(account="a", sent=NOW - 600, **kw): return {"id": "s", "name": "n", "account": account, "sent_ts": sent, **kw}
def vals(acc_, **res): return {"vals": {k: (v, acc_["accounts"][k]["token_version"], f"validacao {v}") for k, v in res.items()}}
def attr(acc_, rec, hit_, ctx=None, now_=NOW):
    def go():
        try: box["c"] = C.attribute(acc_, rec, hit_, now_, {} if ctx is None else ctx)
        except Exception as e_: box["c"] = f"EXC {type(e_).__name__}"
    box["out"] = captured(go)[0]; return box["c"]
writes, real_rr4 = [0], C.replace_retry
def counting_rr(src, dst, **kw):                    # quantas vezes o arquivo de credenciais foi gravado
    if Path(dst) == C.CRED_FILE: writes[0] += 1
    return real_rr4(src, dst, **kw)
C.replace_retry = counting_rr
check([C.pick_account(f4_reset(x), NOW) for x in ("b", "d", None, "zz")] == [("c", None), ("a", None), ("a", None), ("a", None)],
      "[cota] pick_account: a proxima em order, circular a partir da ativa; sem ativa (ou com ela fora do order), a primeira")
check(C.pick_account(f4_reset("a", b=ex(NOW + 1), c={"invalid": INV}), NOW) == ("d", None)
      and C.pick_account(f4_reset("a", b=ex(NOW)), NOW) == ("b", None),
      "[cota] pick_account: pula a esgotada e a invalida; exhausted_until == agora ja e disponivel")
check(C.pick_account(f4_reset("a", a=ex(NOW + 500), b=ex(NOW + 300), c={"exhausted_until": NOW + 100, "invalid": INV}, d=ex(NOW + 400)), NOW) == (None, NOW + 300)
      and C.pick_account(f4_reset("a", a=ex(NOW + 250), b=ex(NOW + 300), c=ex(NOW + 900), d=ex(NOW + 400)), NOW) == (None, NOW + 250),
      "[cota] pick_account: todas esgotadas -> (None, menor reset entre as VALIDAS, a ativa inclusive)")
check(C.pick_account(f4_reset("a", **{k: {"invalid": INV} for k in "abcd"}), NOW) == (None, None)
      and C.pick_account(f4_reset("a", b=ex(NOW + 9), c=ex(NOW + 9), d=ex(NOW + 9)), NOW)[0] is None,
      "[cota] pick_account: todas invalidas -> (None, None); a ativa nunca e candidata, mesmo disponivel")
# rotate (R9): escolhe e troca; nao escreve a situacao de ninguem
acc = f4_reset("a"); sit = frozen(acc["accounts"]); writes[0] = 0
out_ro, _ = captured(lambda: box.update(y=C.rotate(acc, NOW)))
check(box["y"] == "b" and acc["active"] == "b" and acc["switched_at"] == NOW and acc["wake_at"] is None and acc["applied"] is True
      and cred_tok() == TK["b"] and bak() == L1 and writes[0] == 1 and frozen(acc["accounts"]) == sit and "a -> b" in out_ro,
      "[cota] rotate (R9): grava a proxima no arquivo e so entao active/switched_at/wake_at; a situacao das contas nao muda")
acc = f4_reset("a", b=ex(NOW + 60), c=ex(NOW + 60), d={"invalid": INV}); snap = cred_snap(); before = frozen(acc)
check(C.rotate(acc, NOW) is None and frozen(acc) == before and cred_snap() == snap and not C.login_bak().exists(),
      "[cota] rotate (R9): sem conta disponivel devolve None e deixa accounts e o arquivo iguais")
acc = f4_reset("a", applied=True); C.CRED_FILE.write_text("{quebrado", encoding="utf-8"); snap = cred_snap(); sit = frozen(acc["accounts"])
real_sleep = time.sleep; time.sleep = lambda s: None
try: out_rf, _ = captured(lambda: box.update(y=C.rotate(acc, NOW)))
finally: time.sleep = real_sleep
check(box["y"] is None and (acc["active"], acc["switched_at"], acc["wake_at"]) == ("a", NOW - 1000, NOW + 99)
      and "ilegivel" in (acc["switch_error"] or "") and cred_snap() == snap and frozen(acc["accounts"]) == sit and "falhou" in out_rf,
      "[cota] rotate (R9): com apply_account falhando, active/switched_at/wake_at iguais e switch_error com o motivo")
acc = f4_reset("a", applied=True); acc["paused"] = True; snap = cred_snap(); before = frozen(acc)
check(C.rotate(acc, NOW) is None and frozen(acc) == before and cred_snap() == snap,
      "[cota] rotate com o rodizio pausado (accounts restore do dono): None, sem gravar nada")
# attribute (secao 6.4): o hit pertence a conta do rec, nao ao relogio
acc = f4_reset("a", applied=True, a={"late_retries": 2}); writes[0] = 0; ctx = {}; bs = bak_snap()
cases = [attr(acc, rec_("a"), lim(NOW - 300 + i, R1), ctx) for i in range(8)]; ea = acc["accounts"]["a"]
check(cases == ["novo"] + ["residuo"] * 7 and writes[0] == 1 and acc["active"] == "b" and cred_tok() == TK["b"]
      and (ea["exhausted_until"], ea["last_limit_type"], ea["last_hit"], ea["late_retries"]) == (R1, "five_hour", NOW - 300, 0)
      and acc["accounts"]["b"]["exhausted_until"] == 0 and bak_snap() == bs,
      "[cota] S1: 8 hits da ativa com o mesmo resets_at -> 1 giro e 1 gravacao do arquivo; so a conta do hit e marcada")
before = frozen(acc); snap = cred_snap()
check(attr(acc, rec_("a"), lim(NOW + 30, R1 + 7200), {}, NOW + 60) == "residuo" and frozen(acc) == before and cred_snap() == snap,
      "[cota] S2: hit de A depois da troca para B (ts >= switched_at, resets_at novo) -> residuo: ninguem marcado, sem giro")
acc = f4_reset("b", applied=True); acc["switched_at"] = NOW - 100; before = frozen(acc)
old18 = attr(acc, {"id": "s", "name": "n", "adopted": True}, lim(NOW - 200, R1), {}); same18 = frozen(acc) == before
new18 = attr(acc, {"id": "s", "name": "n", "adopted": True}, lim(NOW - 50, R1), {})
check(old18 == "residuo" and same18 and new18 == "novo" and acc["accounts"]["b"]["exhausted_until"] == R1 and acc["active"] == "c",
      "[cota] S18: rec sem account -> e da ativa se ts >= switched_at (novo: marca e gira); antes disso, residuo")
acc = f4_reset("a", applied=True); before = frozen(acc); snap = cred_snap()
check([attr(acc, rec_("a", sent=NOW - 100, **kw), lim(t, R1), {}) for t, kw in ((NOW - 300, {}), (NOW - 100, {}), (NOW - 300, {"account_uncertain": True}))]
      == ["ignorar"] * 3 and frozen(acc) == before,
      "[cota] S19: hit com ts <= sent_ts (inclusive igual) -> ignorar, sem marcar; vale antes do incerto")
unc = [attr(acc, rec_("a", account_uncertain=True), h, vals(acc, a="auth")) for h in (lim(NOW - 50, R1), ah(NOW - 50))]
check(unc == ["incerto"] * 2 and frozen(acc) == before and cred_snap() == snap,
      "[cota] incerto (S55): hit de limite ou de auth num rec com account_uncertain -> nao marca, nao invalida, nao gira")
stc = {"bugs": {"x": {"state": "dev"}}, "final": {"state": "rodando"}}
ups = [C.count_hit(stc, "x", "dev", "incerto", "limit") for _ in range(3)]
other = C.count_hit(stc, "x", "teste", "incerto", "limit")             # outra etapa do mesmo bug: contador proprio
fin_ = [C.count_hit(stc, None, "finalizacao", "auth-nao-confirmado", "auth") for _ in range(3)]
check(ups[:2] == [None, None] and "disputado" in (ups[2] or "") and other is None and stc["bugs"]["x"]["uncertain_hits"] == {"dev": 3, "teste": 1}
      and fin_[:2] == [None, None] and "autenticacao" in (fin_[2] or "") and stc["final"]["auth_hits"] == {"finalizacao": 3},
      "[cota] count_hit (R21): incerto sobe uncertain_hits e auth nao confirmado sobe auth_hits, por etapa; no 3o seguido, precisa do dono")
keep_ = [C.count_hit(stc, "x", "dev", c, k) for c, k in (("auth", "auth"), ("residuo", "auth"), ("ignorar", "limit"))]
check(all(keep_) and C.count_hit(stc, "x", "dev", "conhecido", "limit") is None and stc["bugs"]["x"]["uncertain_hits"] == {"teste": 1}
      and C.count_hit(stc, None, "finalizacao", "novo", "limit") is None and stc["final"]["auth_hits"] == {},
      "[cota] count_hit: so um hit de LIMITE (que nao e incerto nem ignorado) zera os dois contadores da etapa")
acc = f4_reset("a", applied=True, a={"exhausted_until": R1, "late_retries": 1}); before = frozen(acc); ctx = {}
check([attr(acc, rec_("a"), lim(NOW - 300, R1), ctx, t) for t in (NOW, R1 + 300)] == ["conhecido"] * 2 and frozen(acc) == before,
      "[cota] conhecido (S37): entregue ANTES do reset -> nao marca nem conta tentativa, tambem com o agora depois do reset")
acc = f4_reset("a", applied=True, a=ex(R1)); ctx = {}
late8 = [attr(acc, rec_("a", sent=R1 + i), lim(R1 + 200 + i, R1), ctx, R1 + 400) for i in range(8)]; ea = acc["accounts"]["a"]
check(late8 == ["atrasado"] * 8 and (ea["late_retries"], ea["exhausted_until"]) == (1, R1) and acc["active"] == "a",
      "[cota] atrasado (S36): 8 sessoes entregues depois do reset (sent >= exhausted_until) e recusadas na MESMA passada contam 1")
p2 = attr(acc, rec_("a", sent=R1 + 500), lim(R1 + 600, R1), {}, R1 + 700); mid = ea["late_retries"]; writes[0] = 0
p3 = attr(acc, rec_("a", sent=R1 + 800), lim(R1 + 900, R1), {}, R1 + 1000)
check(p2 == p3 == "atrasado" and mid == 2 and (ea["exhausted_until"], ea["late_retries"]) == (R1 + 1000 + 1800, 0)
      and acc["active"] == "b" and writes[0] == 1 and cred_tok() == TK["b"],
      "[cota] S39/S6: a 3a recusa, em passadas diferentes, da exhausted_until = agora + 30 min, que continua depois do rotate")
iso = lambda t: D.fromtimestamp(t, C.dt.timezone.utc).isoformat()
jl("f4-resp", u(iso(R1 + 100)), a(iso(R1 + 130)))                      # entregue depois do reset, e respondeu
jl("f4-hit", u(iso(R1 + 100)), hit(iso(R1 + 130), reset=R1))           # entregue depois do reset, e so o hit
jl("f4-antes", u(iso(R1 - 500)), a(iso(R1 - 400)))                     # respondeu, mas a entrega foi ANTES do reset
def late_case(*recs):
    acc_ = f4_reset("a", applied=True, a={"exhausted_until": R1, "late_retries": 2}, b={"exhausted_until": R1, "late_retries": 1})
    return C.late_answered(acc_, recs), acc_["accounts"]["a"]["late_retries"], acc_["accounts"]["b"]["late_retries"]
r_ok = {"id": "f4-resp", "account": "a", "sent_ts": R1 + 100}
check(late_case(r_ok) == (["a"], 0, 1) and late_case() == ([], 2, 1)
      and late_case({"id": "f4-hit", "account": "a", "sent_ts": R1 + 100}) == ([], 2, 1)
      and late_case({"id": "f4-antes", "account": "a", "sent_ts": R1 - 500}) == ([], 2, 1)
      and late_case({**r_ok, "account": "c"}) == ([], 2, 1),
      "[cota] S38: late_retries so zera quando uma sessao entregue NA conta, DEPOIS do reset, responde; sem hit e sem resposta, nao zera")
acc = f4_reset("a", applied=True, a=ex(123)); writes[0] = 0; ctx = vals(acc, a="auth")
au = [attr(acc, rec_("a"), ah(NOW - 50 - i), ctx) for i in range(3)]; ea = acc["accounts"]["a"]
au.append(attr(acc, rec_("a"), ah(NOW + 500), vals(acc, a="auth"), NOW + 600))     # outra passada: a conta ja esta invalida
check(au == ["auth"] * 4 and ea["invalid"] == {"since": NOW, "reason": "validacao auth"} and ea["exhausted_until"] == 123
      and acc["active"] == "b" and writes[0] == 1 and acc["accounts"]["b"]["invalid"] is None,
      "[cota] S39/S14: hit auth (sem resets_at) confirmado pela validacao -> invalida a conta UMA vez (o `since` fica) e gira, sem KeyError")
snap = cred_snap()
check(attr(acc, rec_("c"), ah(NOW - 40), vals(acc, c="auth")) == "auth" and acc["accounts"]["c"]["invalid"] and acc["active"] == "b"
      and cred_snap() == snap,
      "[cota] auth confirmado de uma conta que NAO e a ativa: invalida, sem girar")
acc = f4_reset("a", applied=True); before = frozen(acc)
soft = [attr(acc, rec_("a"), ah(NOW - 50), c_) for c_ in (vals(acc, a="transitorio"), vals(acc, a="ok"), {}, vals(acc, a="limit"))]
check(soft == ["auth-nao-confirmado"] * 4 and frozen(acc) == before,
      "[cota] S30: auth que a validacao nao confirma (transitorio, ok, sem validacao, limit sem hora legivel) -> nao invalida; so retoma")
old_ver = {"vals": {"a": ("auth", acc["accounts"]["a"]["token_version"] - 1, "401 do token ANTIGO")}}
check(attr(acc, rec_("a"), ah(NOW - 50), old_ver) == "auth-nao-confirmado" and frozen(acc) == before and "descartada" in box["out"],
      "[cota] S45 (R14): validacao auth de uma versao que nao e mais a token_version da conta -> descartada; a conta nao e invalidada")
TXT5 = "You've hit your session limit · resets 11:10pm (America/Sao_Paulo)"      # fato 1: resetsAt 1791079800
TXT7 = "You've hit your weekly limit · resets Oct 7, 4am (America/Sao_Paulo)"    # secao 11: resetsAt 1791356400
t20 = D(2026, 10, 3, 20, 0).timestamp(); writes[0] = 0
lv = attr(acc, rec_("a", sent=t20 - 600), ah(t20 - 50), {"vals": {"a": ("limit", acc["accounts"]["a"]["token_version"], TXT5)}}, t20)
ea = acc["accounts"]["a"]
check(lv == "novo" and (ea["exhausted_until"], ea["last_limit_type"], ea["invalid"]) == (int(D(2026, 10, 3, 23, 10).timestamp()), "five_hour", None)
      and acc["active"] == "b" and writes[0] == 1,
      "[cota] auth com a validacao dando limit: trata como novo, com o resets_at lido do texto")
check(C.limit_reset(TXT5, t20) == (int(D(2026, 10, 3, 23, 10).timestamp()), "five_hour")
      and C.limit_reset(TXT5, D(2026, 10, 3, 23, 30).timestamp())[0] == int(D(2026, 10, 4, 23, 10).timestamp())
      and C.limit_reset(TXT7, D(2026, 10, 5, 9, 0).timestamp()) == (int(D(2026, 10, 7, 4, 0).timestamp()), "seven_day")
      and C.limit_reset(TXT7.replace("Oct 7", "Jan 2"), D(2026, 12, 30, 9, 0).timestamp())[0] == int(D(2027, 1, 2, 4, 0).timestamp())
      and C.limit_reset("resets 12:05am", t20) == (int(D(2026, 10, 4, 0, 5).timestamp()), None)
      and [C.limit_reset(x, NOW) for x in ("You've hit your weekly limit · resets Oct 7", "resets Xyz 7, 4am", "ok", None)] == [None] * 4
      and (time.timezone != 10800 or (C.limit_reset(TXT5, 1791079800 - 3600)[0], C.limit_reset(TXT7, 1791356400 - 86400)[0]) == (1791079800, 1791356400)),
      "[cota] limit_reset: hora local; 11:10pm hoje ou amanha, 'Oct 7, 4am', virada de ano, 12am = 0 h; sem hora legivel -> None")
acc = f4_reset("a", applied=True, a=ex(R1)); before = frozen(acc)
gone = [attr(acc, rec_("zz"), h, {"vals": {"zz": ("auth", 1.0, "401")}}) for h in (lim(NOW - 50, R1 + 9), ah(NOW - 50))]
check(gone == ["residuo"] * 2 and attr(acc, {"id": "s", "account": "a"}, lim(NOW - 50, R1), {}) == "conhecido" and frozen(acc) == before,
      "[cota] S50 (R23): hit de conta removida -> residuo sem KeyError; rec sem sent_ts vale 0 (conhecido, nao ignorar)")
acc = f4_reset("a", applied=True); tries, real_apply, ctx = [0], C.apply_account, {}
def failing_apply(acc_, label, ts): tries[0] += 1; acc_["switch_error"] = "simulado"; return "simulado", "sem bloco"
C.apply_account = failing_apply
try: est = [attr(acc, rec_("a"), {**lim(NOW - 300 + i, R1 + i, None), "estimated": True}, ctx) for i in range(8)]
finally: C.apply_account = real_apply
check(est == ["novo"] * 8 and tries[0] == 1 and acc["active"] == "a" and acc["accounts"]["a"]["exhausted_until"] == R1 + 7
      and acc["switch_error"] == "simulado",
      "[cota] corolario da 6.4: hits estimados (um resets_at por sessao) com o giro falhando -> 1 tentativa de giro na passada")
# accounts remove da ATIVA (R23, S50): gira antes de tirar a conta, na mesma gravacao
f4_reset("a", applied=True); bs = bak_snap(); writes[0] = 0
out_ra, code_ra = acc_cmd("remove", "a"); a8 = acc_json()
check(code_ra is None and a8["order"] == ["b", "c", "d"] and "a" not in a8["accounts"] and a8["active"] == "b" and a8["applied"] is True
      and cred_tok() == TK["b"] and writes[0] == 1 and bak_snap() == bs and not C.token_path("a").exists() and "conta ativa: b" in out_ra,
      "[cota] S50: accounts remove da ativa escolhe a proxima e grava o arquivo na mesma operacao; o login.bak nao muda")
f4_reset("a", applied=True, b=ex(time.time() + 3600), c={"invalid": INV}, d=ex(time.time() + 3600))
snap = cred_snap(); js = (C.ACCOUNTS_DIR / "accounts.json").read_bytes()
check(acc_cmd("remove", "a")[1] == 2 and (C.ACCOUNTS_DIR / "accounts.json").read_bytes() == js and cred_snap() == snap and C.token_path("a").exists(),
      "[cota] remove da ativa sem outra conta disponivel: recusa (2) sem mudar accounts.json, o arquivo nem o .token")
f4_reset("a", applied=True); C.CRED_FILE.write_text("{quebrado", encoding="utf-8"); time.sleep = lambda s: None
try: code_rf = acc_cmd("remove", "a")[1]
finally: time.sleep = real_sleep
a9 = acc_json()
check(code_rf == 1 and a9["active"] == "a" and a9["order"] == list("abcd") and "ilegivel" in (a9["switch_error"] or "") and C.token_path("a").exists(),
      "[cota] remove da ativa com o giro falhando: sai 1, a conta segue cadastrada e ativa, e o switch_error fica salvo")
f4_reset("a"); snap = cred_snap(); out_rp, code_rp = acc_cmd("remove", "a"); a10 = acc_json()
check(code_rp is None and (a10["active"], a10["applied"], a10["order"]) == (None, False, ["b", "c", "d"]) and cred_snap() == snap
      and not C.login_bak().exists() and "conta ativa: -" in out_rp,
      "[cota] remove da ativa com o arquivo no /login (applied desligado): nada e gravado no arquivo, e nao fica conta ativa")
f4_reset("a", applied=True); acc_set(paused=True); C.login_bak().unlink(); snap = cred_snap()
out_rq, code_rq = acc_cmd("remove", "a"); a11 = acc_json()
check(code_rq is None and (a11["active"], a11["paused"], a11["order"]) == (None, True, ["b", "c", "d"]) and cred_snap() == snap
      and "faca /login" in out_rq,
      "[cota] remove da ativa com o rodizio pausado: sem giro, nada gravado e nao fica conta ativa (sem login.bak: pede /login, S57)")
f4_reset("a", applied=True); snap = cred_snap(); code_rc = acc_cmd("remove", "c")[1]; a13 = acc_json()
check(code_rc is None and (a13["order"], a13["active"]) == (["a", "b", "d"], "a") and cred_snap() == snap,
      "[cota] remove de conta que NAO e a ativa, com o rodizio seguindo: a ativa e o arquivo nao mudam")
acc_cmd("remove", "d"); writes[0] = 0; sp_calls.clear(); sp_reply[0] = (0, "ok\n", "")
code_r2 = acc_cmd("remove", "a")[1]; a12 = acc_json()
check(code_r2 is None and (a12["order"], a12["active"], a12["applied"]) == (["b"], None, False) and cred_get()["claudeAiOauth"] == L1
      and writes[0] == 1 and len(sp_calls) == 1,
      "[cota] remove da ativa que deixa < 2 contas: sem giro (1 gravacao so: a devolucao do /login) e nao fica conta ativa")
raw = b"".join(p.read_bytes() for p in C.ACCOUNTS_DIR.iterdir())
check(b"sk-ant-" not in raw and not tmps(), "[cota] guarda no fim da F4: nenhum token em claro, nenhum .tmp")
# [cota] F5: portao no spawn, desvio da cutucada no tick e deliver_pending (secao 6.3). Copia C, guarda f4,
# spawn REAL com o subprocess falso: com o portao fechado, nenhuma chamada `claude --bg` sai.
T5, OLD, popens, resumes, live5 = time.time(), "2000-01-01T00:00:00", [], [], {}
C.subprocess = types.SimpleNamespace(run=fake_sp_run, TimeoutExpired=subprocess.TimeoutExpired,
                                     Popen=lambda *a_, **k_: popens.append(a_),   # o lancador do vigia de cota (F6) so registra
                                     **{k: getattr(subprocess, k) for k in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP",
                                                                            "CREATE_BREAKAWAY_FROM_JOB", "DEVNULL")})
real_resume5, real_ewt5, real_cof5 = C.resume_cmd, C.ensure_wt, C.checkout_fresh
C.resume_cmd = lambda exe, sid, prompt: (resumes.append(sid), [exe, "--bg", "--resume", sid, prompt])[1]
C.ensure_wt = lambda st, name: (st["worktrees"].setdefault(name, {"path": str(tmp / name), "bug": None}), tmp / name)[1]
C.checkout_fresh = lambda path, base, branch: None
C.agents = lambda: [{"sessionId": k, "id": k[:8], "name": n, "status": "idle", "startedAt": 9e12} for k, n in live5.items()]
def bug5(order, state, wt=None, sessions=None, **kw):
    return {"order": order, "state": state, "title": f"b{order}", "doc": "d.md", "branch": f"fix/b{order}", "wave": 1,
            "returns": 0, "test_round": 1, "wt": wt, "claims": [], "retry_after": None, "sessions": sessions or {},
            "plan": {"files": [f"es/F{order}.cpp"], "complexity": "baixa", "severity": "alto", "effort": {}, "ultrathink": {}},
            "history": [{"ts": OLD, "from": state, "to": state}], **kw}
def st5(bugs, **kw):
    s = {"run_id": "r5", "base": "origin/versao3", "effort": "medium", "model": "m", "permission_mode": "auto",
         "created": OLD, "max_returns": 3, "max_dev": 4, "elencado": None, "waves": [], "test_slot": None,
         "test_queue": [], "pending_spawns": [], "final": {"state": "pendente", "session": None},
         "worktrees": {"wt-planning": {"path": str(tmp / "wt-planning"), "bug": None}}, "bugs": bugs}
    for slug_, b_ in bugs.items():
        if b_.get("wt"): s["worktrees"][b_["wt"]] = {"path": str(tmp / b_["wt"]), "bug": slug_}
    s.update(kw); return s
def dev5(sid, account="a", sent=T5 - 7300): return {"dev": {"id": sid, "name": "bug01-dev-x", "account": account, "sent_ts": sent}}
def limited(sid, hit_ts, reset): jl(sid, u(iso(hit_ts - 60)), hit(iso(hit_ts), reset=reset))
def tick5(st, **kw):
    sp_calls.clear(); resumes.clear(); box["notes"] = None
    box["out"] = captured(lambda: box.update(notes=C.tick(st, **kw)))[0]; return box["notes"] or []
def bg_calls(): return [c[0] for c in sp_calls if "--bg" in c[0]]
def pend5(st): return [(e["slug"], e["stage"], e["why"]) for e in st["pending_spawns"]]
# account_for_spawn: o portao. Nao gira; so le
acc_p = f4_reset("a"); acc_p["paused"] = True
check(C.account_for_spawn(acc_p, T5) == (None, None) and C.account_for_spawn({**f4_reset("a"), "order": ["a"]}, T5) == (None, None),
      "[cota] F5 account_for_spawn: rodizio desligado (pausado, 1 conta) -> (None, None), sem portao (R18)")
got_g = [C.account_for_spawn(f4_reset("a"), T5), C.account_for_spawn(f4_reset("a", a=ex(T5)), T5),
         C.account_for_spawn(f4_reset("a", a=ex(T5 + 60)), T5), C.account_for_spawn(f4_reset("a", a={"invalid": INV}), T5),
         C.account_for_spawn(f4_reset(None), T5), C.account_for_spawn(f4_reset("zz"), T5),
         C.account_for_spawn(f4_reset("a", **{k: ex(T5 + 60) for k in "abcd"}), T5),
         C.account_for_spawn(f4_reset("a", **{k: {"invalid": INV} for k in "abcd"}), T5)]
check(got_g == [("a", None), ("a", None)] + [(None, "aguardando cota")] * 5 + [(None, "sem credencial valida")],
      f"[cota] F5 account_for_spawn: ativa disponivel abre; esgotada, invalida, sem ativa ou ativa removida fecham "
      f"('aguardando cota'); nenhuma valida -> 'sem credencial valida' ({got_g})")
# tick, rodizio ligado: sessao parada por limite ha 2 h -> sem cutucada, a retomada e do vigia
f4_reset("a", applied=True); snap = cred_snap()
limited("f5e0aaaa-lim", T5 - 7200, int(T5) + 3 * 3600)
sx = st5({"x": bug5(1, "dev", "wt-1", dev5("f5e0aaaa-lim"))})
notes = tick5(sx)
check(not sx["bugs"]["x"].get("nudges") and len(sx["bugs"]["x"]["history"]) == 1 and not bg_calls() and not resumes
      and any("limite de cota" in n and "vigia de cota" in n for n in notes) and cred_snap() == snap,
      "[cota] F5: sessao parada por limite ha 2 h, rodizio ligado: nudges continua 0, sem cutucada, e a nota diz que o vigia retoma")
notes = tick5(sx, force=True)
check(not sx["bugs"]["x"].get("nudges") and not bg_calls() and any("vigia de cota" in n for n in notes),
      "[cota] F5: com force (reconcile --fix) e o rodizio ligado o desvio vale: a retomada e do vigia, pela fila")
jl("f5e0bbbb-auth", u(iso(T5 - 7300)), auth(iso(T5 - 7200)))
sx["bugs"]["x"]["sessions"]["dev"]["id"] = "f5e0bbbb-auth"
notes = tick5(sx); ok_auth = any("erro de autenticacao" in n and "vigia de cota" in n for n in notes)
sx["bugs"]["x"]["auth_hits"] = {"dev": 3}
notes = tick5(sx)
check(ok_auth and any("PRECISA DO DONO" in n and "nao confirma" in n for n in notes) and not sx["bugs"]["x"].get("nudges")
      and not bg_calls(), "[cota] F5: hit auth com o rodizio ligado: sem cutucada; com 3 hits seguidos da etapa (R21), 'precisa do dono'")
sx = st5({"x": bug5(1, "dev", "wt-1", dev5("f5e0aaaa-lim", sent=T5 - 100))})       # entregue DEPOIS do hit
sp_reply[0] = (0, "backgrounded · f5e0aaaa · bug01-dev-x\n", ""); live5["f5e0aaaa-lim"] = "bug01-dev-x"
notes = tick5(sx)
check(sx["bugs"]["x"].get("nudges") == {"dev": 1} and resumes == ["f5e0aaaa-lim"] and len(bg_calls()) == 1
      and sx["bugs"]["x"]["sessions"]["dev"]["account"] == "a",
      "[cota] F5: hit anterior a ultima entrega (ts <= sent_ts) nao segura: com o portao aberto, a cutucada sai como hoje")
sf = st5({}, final={"state": "rodando", "since": OLD, "session": {"id": "f5e0aaaa-lim", "name": "pipeline-finalizacao-r5",
                                                                  "account": "a", "sent_ts": T5 - 7300}})
notes = tick5(sf)
check(not sf["final"].get("nudges") and sf["final"]["since"] == OLD and not bg_calls()
      and any(n.startswith("finalizacao: sessao") and "vigia de cota" in n for n in notes),
      "[cota] F5: finalizacao parada por limite, rodizio ligado: sem cutucada (nudges e since iguais)")
# portao fechado: o tick nao cutuca nem sessao SEM marcador
f4_reset(None); live5.clear()
sx = st5({"x": bug5(1, "dev", "wt-1", dev5("f5e0cccc-nada", account=None))})
notes = tick5(sx)
check(not sx["bugs"]["x"].get("nudges") and not bg_calls() and not resumes and any("aguardando cota" in n for n in notes),
      "[cota] F5: portao fechado (rodizio ligado sem ativa, o estado que o f2-contas.ps1 deixa): o tick nao cutuca nem sessao sem marcador")
# S13 (R18): rodizio desligado -> a cutucada de sessao limitada so e ADIADA ate resets_at + 2 min
f4_reset("a"); acc_set(paused=True); snap = cred_snap(); popens.clear()   # os casos acima, com o rodizio ligado, abrem o vigia
sx = st5({"x": bug5(1, "dev", "wt-1", dev5("f5e0dddd-s13", account=None))})
sp_reply[0] = (0, "backgrounded · f5e0dddd · bug01-dev-x\n", ""); live5["f5e0dddd-s13"] = "bug01-dev-x"
limited("f5e0dddd-s13", T5 - 7200, int(T5) + 3600)
notes = tick5(sx); held = not sx["bugs"]["x"].get("nudges") and not bg_calls() and "sem cutucada antes do reset" in " ".join(notes)
limited("f5e0dddd-s13", T5 - 7200, int(T5) - 60)                                  # reset ha 1 min: dentro da folga
tick5(sx); held2 = not sx["bugs"]["x"].get("nudges") and not bg_calls()
limited("f5e0dddd-s13", T5 - 7200, int(T5) - 200)                                 # passou da folga de 2 min
tick5(sx)
check(held and held2 and sx["bugs"]["x"].get("nudges") == {"dev": 1} and resumes == ["f5e0dddd-s13"] and len(bg_calls()) == 1
      and sx["bugs"]["x"]["sessions"]["dev"]["account"] is None and cred_snap() == snap and not popens,
      "[cota] S13 (R18): rodizio pausado: sessao limitada nao e cutucada antes de resets_at + 2 min e e depois; sem vigia, CRED_FILE intocado")
f4_reset("a"); a_ = acc_json(); a_["order"] = ["a"]; (C.ACCOUNTS_DIR / "accounts.json").write_text(json.dumps(a_), encoding="utf-8")
snap = cred_snap(); limited("f5e0dddd-s13", T5 - 7200, int(T5) + 3600)
sx = st5({"x": bug5(1, "dev", "wt-1", dev5("f5e0dddd-s13", account=None))})
tick5(sx); held = not sx["bugs"]["x"].get("nudges") and not bg_calls()
tick5(sx, force=True); forced = sx["bugs"]["x"].get("nudges") == {"dev": 1} and len(bg_calls()) == 1
jl("f5e0dddd-s13", u(iso(T5 - 7300)), auth(iso(T5 - 7200)))
sx = st5({"x": bug5(1, "dev", "wt-1", dev5("f5e0dddd-s13", account=None))})
tick5(sx)
check(held and forced and sx["bugs"]["x"].get("nudges") == {"dev": 1} and len(bg_calls()) == 1 and cred_snap() == snap and not popens,
      "[cota] S13 (R18): 1 conta: limite adia; `reconcile --fix` (force) cutuca ja; hit auth sem rodizio segue a cutucada de hoje")
# S21 (R3): todas esgotadas -> reentrega, ramo 'sem sessao registrada', dispatch_slot e next_wave viram pendencia, sem CLI
f4_reset("a", applied=True, **{k: ex(T5 + 3600) for k in "abcd"}); snap = cred_snap(); live5.clear()
s21 = st5({"v": bug5(1, "retest"), "w": bug5(2, "planejado"),
           "x": bug5(3, "dev", "wt-1", {"dev": {"id": "f5e0eeee-x", "name": "bug03-dev-x", "account": "a", "sent_ts": T5 - 9000}}),
           "y": bug5(4, "aguardando-slot", "wt-2"), "z": bug5(5, "teste", "wt-3", {"dev": {"id": "f5e0ffff-z", "name": "bug05-dev-z"}})},
          elencado=True, waves=[["v"]], test_queue=["y"],
          pending_spawns=[{"slug": "x", "stage": "dev", "message": "msg antiga", "why": "sessao busy (x)", "ts": "t"}])
notes = tick5(s21)
p1 = pend5(s21)
check(sorted(p1, key=str) == sorted([("x", "dev", "aguardando cota"), ("z", "teste", "aguardando cota"),
                                     ("y", "teste", "aguardando cota"), ("w", "dev", "aguardando cota")], key=str)
      and s21["bugs"]["w"]["state"] == "dev" and s21["test_slot"] == "y" and not bg_calls() and not resumes and cred_snap() == snap
      and s21["pending_spawns"][0]["message"] == "msg antiga" and not s21["bugs"]["x"].get("nudges"),
      f"[cota] S21: todas esgotadas: reentrega, sessao faltante, slot e onda viram pendencia 'aguardando cota'; nenhum --bg nem resume_cmd ({p1})")
notes = tick5(s21)
check(len(s21["pending_spawns"]) == 4 and len({(e["slug"], e["stage"]) for e in s21["pending_spawns"]}) == 4 and not bg_calls(),
      "[cota] S21: no tick seguinte o ramo 'sem sessao registrada' ve a pendencia e nao abre de novo (4 pendencias, sem duplicata)")
# deliver_pending(only=...): o vigia entrega UM alvo por lock (R19)
got5, real_spawn5 = [], C.spawn
C.spawn = lambda st, slug, stage, message="": got5.append((slug, stage, message))
so = st5({"x": bug5(1, "dev", "wt-1"), "y": bug5(2, "teste", "wt-2"), "q": bug5(3, "retest")}, final={"state": "rodando", "session": None},
         pending_spawns=[{"slug": s_, "stage": g_, "message": m_, "why": "w", "ts": "t"} for s_, g_, m_ in
                         (("x", "dev", "mx"), ("q", "dev", "obsoleta"), ("y", "teste", "my"), (None, "finalizacao", "mf"))])
n_only = C.deliver_pending(so, C.NOBODY, report=False, only=("y", "teste")); left = [(e["slug"], e["stage"]) for e in so["pending_spawns"]]
n_obs = C.deliver_pending(so, C.NOBODY, report=False, only=("q", "dev")); left2 = [(e["slug"], e["stage"]) for e in so["pending_spawns"]]
C.spawn = real_spawn5
check(got5 == [("y", "teste", "my")] and n_only == ["reentregando mensagem pendente para y/teste"]
      and left == [("x", "dev"), ("q", "dev"), (None, "finalizacao")],
      "[cota] F5 deliver_pending(only=...): entrega so a pedida; as outras ficam na lista, na ordem, inclusive a obsoleta")
check(len(got5) == 1 and left2 == [("x", "dev"), (None, "finalizacao")] and "obsoleta" in " ".join(n_obs),
      "[cota] F5 deliver_pending(only=...) numa pendencia obsoleta: descarta so ela, sem spawn")
# guarda ilegivel: portao fechado, sem die, sem resume_cmd
f4_reset("a", applied=True); (C.ACCOUNTS_DIR / "accounts.json").write_text("{quebrado", encoding="utf-8")
sx = st5({"x": bug5(1, "dev", "wt-1", dev5("f5e0cccc-nada"))})
_, code_g = captured(lambda: box.update(g=C.gate_now()))
sp_calls.clear(); resumes.clear()
_, code_s = captured(lambda: box.update(r=C.spawn(sx, "x", "dev", "m")))
spawned_s = list(resumes) + bg_calls(); tick5(sx)
check(code_g is None and box["g"][:2] == (True, None) and "guarda de contas indisponivel" in box["g"][2]
      and code_s is None and box["r"] is None and not spawned_s and not bg_calls()
      and pend5(sx)[0][2].startswith("arquivo de credenciais nao confere: guarda") and not sx["bugs"]["x"].get("nudges"),
      "[cota] F5: accounts.json ilegivel: portao fechado sem die; o spawn vira pendencia sem resume_cmd, e o tick nao cutuca")
(C.ACCOUNTS_DIR / "accounts.json").unlink()

# [cota] F6a: vigia de cota, passos 1-4 da secao 6.5 (saida, troca de execucao, integridade, deteccao,
# atribuicao, giro sem hit), lancador e ligacoes. Copia C, guarda f4, relogio falso (o sleep avanca o tempo).
# O passo 5 (retomada) e conferido no bloco F6b, mais abaixo.
import re as re6
T6, naps = [T5], []
def sleep6(s):
    T6[0] += s
    if naps: naps.pop(0)()
C.time = types.SimpleNamespace(time=lambda: T6[0], sleep=sleep6)
def st6(bugs, **kw): s_ = st5(bugs, **kw); C.save(s_); return s_
def state6(): return json.loads(C.STATE.read_text(encoding="utf-8"))
def watch(once=True, interval=60, origin="teste"):
    sp_calls.clear(); writes[0] = 0
    box["wout"], box["wcode"] = captured(lambda: C.cmd_quota_watch(types.SimpleNamespace(once=once, interval=interval, origem=origin)))
    return box["wout"]
def cases6(): return re6.findall(r"caso (\S+)", box["wout"])
def cota_log(run): p_ = C.quota_log_path(run); return p_.read_text(encoding="utf-8") if p_.exists() else ""
def bugs6(n, prefix, account="a", kind="limit", reset=None, sent=T5 - 7300):
    out = {}
    for i in range(n):
        sid = f"{prefix}{i:03d}-x"
        if kind == "limit": limited(sid, T5 - 7200 + 2 * i, reset)                  # 8 sessoes em 14 s (S1)
        elif kind == "auth": jl(sid, u(iso(T5 - 7300)), auth(iso(T5 - 7200 + 2 * i)))
        live5[sid] = f"bug{i + 1:02d}-dev-x"
        out[f"b{i}"] = bug5(i + 1, "dev", f"wt-{i + 1}", {"dev": {"id": sid, "name": live5[sid], "account": account, "sent_ts": sent}})
    return out
RB = int(T5) + 3 * 3600; live5.clear(); sp_reply[0] = (0, "ok\n", "")
# S34 (N3): um vigia por maquina, pelo lock; o lancador so abre com o rodizio ligado e sem vigia vivo
f4_reset("a", applied=True); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0s34a-x"))}); popens.clear()
hold6 = C.try_lock("quota-watch")
out_busy, sch_busy = watch(), C.schedule_quota_watch("tick")
C.unlock(hold6)
sch_free = C.schedule_quota_watch("tick"); acc_set(paused=True); sch_paused = C.schedule_quota_watch("tick")
check("ja ha um vigia" in out_busy and sch_busy is False and sch_free is True and sch_paused is False and len(popens) == 1
      and popens[0][0][-3:] == ["quota-watch", "--origem", "tick"],
      "[cota] S34: com o lock preso, o 2o vigia sai e o schedule_quota_watch nao abre; livre, abre 1 (--origem); pausado, nao abre")
# o tick abre o vigia com o rodizio ligado e sessao parada por cota; com report (reconcile sem --fix), nunca
f4_reset("a", applied=True); limited("f6e0tick-x", T5 - 7200, RB); live5["f6e0tick-x"] = "bug01-dev-x"; popens.clear()
sx = st5({"x": bug5(1, "dev", "wt-1", dev5("f6e0tick-x"))})
tick5(sx, report=True); n_rep = len(popens); tick5(sx)
check(n_rep == 0 and len(popens) == 1 and popens[0][0][-1] == "tick" and not bg_calls(),
      "[cota] F6 tick: sessao parada por cota com o rodizio ligado abre o vigia (1 Popen); com report=True, nenhum")
# S48 (R20) e S52: sem state.json, devolve o /login e sai por return, SEM chamar load(); o laco nao fica girando
f4_reset("a", applied=True); C.STATE.unlink(missing_ok=True); loads6, real_load6 = [], C.load
C.load = lambda: (loads6.append(1), real_load6())[1]
out = watch(once=False); C.load = real_load6; d6 = cred_get()
check(box["wcode"] is None and not loads6 and d6["claudeAiOauth"] == L1 and d6["mcpOAuth"] == MCP and acc_json()["applied"] is False
      and "vigia saindo (sem execucao)" in out and "sanidade do /login devolvido: ok" in out
      and "vigia saindo" in cota_log(None) and not C.watch_alive(),
      "[cota] S48/S52: sem state.json, o vigia devolve o /login (mcpOAuth preservado, sanidade no log), sai por return sem load() e solta o lock")
f4_reset("a", applied=True); st6({"v": bug5(1, "retest")}, final={"state": "concluido", "session": None})
out = watch(once=False)
check("vigia saindo (fim da execucao)" in out and cred_tok() == L1["accessToken"] and acc_json()["applied"] is False,
      "[cota] S52/S16: execucao terminada: o vigia devolve o /login e sai (a tarefa avulsa e da F7)")
f4_reset("a"); acc_set(paused=True); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0s34a-x"))}); snap = cred_snap()
out = watch(once=False)
check("vigia saindo (rodizio desligado)" in out and cred_snap() == snap and writes[0] == 0,
      "[cota] S13: rodizio pausado: o vigia sai sem gravar o arquivo de credenciais")
# S43 (R12): execucao nova enquanto o vigia dorme -> o MESMO vigia segue, com log e st.quota da nova
f4_reset("a", applied=True); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0s43a-x"))})
r6 = st5({"x": bug5(1, "dev", "wt-1", dev5("f6e0s43a-x"))}, run_id="r6")
naps[:] = [lambda: C.save(r6), lambda: (box.update(q6=state6().get("quota")), C.save(st5({"v": bug5(1, "retest")}, run_id="r6")))]
out = watch(once=False, interval=60)
check("subiu (origem=teste" in cota_log("r5") and "execucao nova: r5 -> r6" in cota_log("r6") and "vigia saindo (fim da execucao)" in cota_log("r6")
      and box["q6"]["log"] == "runs/r6-cota.log" and box["q6"]["origin"] == "teste" and box["q6"]["watch_pid"] == os.getpid() and not naps,
      "[cota] S43: execucao nova durante o sono: o mesmo vigia passa log e st.quota para o run_id novo, e sai no fim dela")
real_unlock6, hook6 = C.unlock, [None]
def unlock6(f):
    real_unlock6(f)
    if f.name.endswith("quota-watch.lock") and hook6[0]:
        h_, hook6[0] = hook6[0], None; h_()
C.unlock = unlock6
f4_reset("a", applied=True); st6({"v": bug5(1, "retest")})
hook6[0] = lambda: C.save(st5({"x": bug5(1, "dev", "wt-1", dev5("f6e0s43a-x"))}, run_id="r7"))
out = watch(once=True)
keep6 = "o vigia continua" in out and state6().get("quota", {}).get("log") == "runs/r7-cota.log"
f4_reset("a", applied=True); st6({"v": bug5(1, "retest")}); other6 = []
hook6[0] = lambda: (other6.append(C.try_lock("quota-watch")), C.save(st5({"x": bug5(1, "dev", "wt-1", dev5("f6e0s43a-x"))}, run_id="r8")))
out = watch(once=False); alive6 = C.watch_alive(); C.unlock(other6[0]); C.unlock = real_unlock6
check(keep6 and "outro vigia ja a acompanha" in out and other6[0] is not None and alive6 and not C.watch_alive(),
      "[cota] S43: state.json regravado entre soltar o lock e reler: o vigia retoma o lock; se outro vigia o pegou antes, sai. Sobra 1")
# S25/S26 (B2): integridade numa passada SEM hit
f4_reset("a", applied=True); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))})
d6 = cred_get(); d6["claudeAiOauth"] = L2; cred_put(d6); out = watch(); a6 = acc_json()
s25 = cred_tok() == TK["a"] and bak() == L2 and a6["file_repairs"] == 1 and a6["last_repair"]["motivo"] == "bloco de fora" and not sp_calls
bs = bak_snap(); d6 = cred_get(); d6["claudeAiOauth"]["accessToken"] = TK["b"]; cred_put(d6); out = watch(); a6 = acc_json()
check(s25 and cred_tok() == TK["a"] and bak_snap() == bs and a6["file_repairs"] == 2 and a6["last_repair"]["motivo"] == "outra conta cadastrada"
      and cred_get()["mcpOAuth"] == MCP and not cases6(),
      "[cota] S25/S26: passada sem hit: bloco de fora vai ao login.bak e o arquivo volta a ativa; token de outra conta: regrava sem tocar o login.bak")
# S1 + S2: a ativa esgota, 8 sessoes param em 14 s -> 1 giro, 1 gravacao; as outras 7 sao residuo (nenhuma conta a mais marcada)
f4_reset("a", applied=True); live5.clear(); st6(bugs6(8, "f6e0s1aa", reset=RB))
out = watch(); a6 = acc_json(); c6 = cases6()
check(writes[0] == 1 and a6["active"] == "b" and cred_tok() == TK["b"] and a6["accounts"]["a"]["exhausted_until"] == RB
      and c6.count("novo") == 1 and c6.count("residuo") == 7 and not (a6["accounts"]["b"].get("exhausted_until") or 0),
      f"[cota] S1/S2: 8 sessoes de 'a' com limite em 14 s: 1 giro (a -> b), 1 gravacao do arquivo, 1 novo + 7 residuo ({c6})")
s1_bg, s1_state = bg_calls(), state6()                  # a retomada (passo 5) e conferida no bloco F6b
# S3: a retomada na conta nova volta ao limite: novo de novo, marca b e gira para c
live5.clear(); st6(bugs6(1, "f6e0s3bb", account="b", reset=RB + 600, sent=T5 - 7300)); out = watch(); a6 = acc_json()
check(cases6() == ["novo"] and a6["active"] == "c" and a6["accounts"]["b"]["exhausted_until"] == RB + 600 and writes[0] == 1,
      "[cota] S3: sessao em b (a nova ativa) bate o limite: caso novo, b esgotada, giro para c")
# S12 e S44: sessao parada sem hit, e hit com ts <= sent_ts -> nada atribuido, nada girado
f4_reset("a", applied=True); acc_set(wake_at=None); live5.clear(); before = frozen(acc_json())   # wake_at velho: o despertar (F7) o zeraria
st6({**bugs6(1, "f6e0s44c", reset=RB, sent=T5 - 100), "y": bug5(9, "dev", "wt-9", dev5("f6e0s12d-x"))}); live5["f6e0s12d-x"] = "bug09-dev-x"
out = watch()
check(not cases6() and frozen(acc_json()) == before and writes[0] == 0 and not sp_calls,
      "[cota] S12/S44: sessao parada sem hit, e hit anterior a ultima entrega: nada atribuido, nenhuma gravacao, nenhum giro")
real_agents6 = C.agents; live5.clear(); st6(bugs6(2, "f6e0busy", reset=RB))
C.agents = lambda: [{"sessionId": k, "id": k[:8], "name": n, "status": s_, "startedAt": 9e12}
                    for (k, n), s_ in zip(live5.items(), ("busy", "aguardando permissao"))]
out = watch(); C.agents = real_agents6
check(not cases6() and frozen(acc_json()) == before and writes[0] == 0,
      "[cota] F6 limited_sessions: sessao busy, ou com status desconhecido, com hit de limite: o vigia nao a toca")
# cmd_start abre o vigia DEPOIS do save (R12), so com o rodizio ligado
st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))}, max_planning=4); popens.clear()
saved6 = []; real_save6 = C.save; C.save = lambda s_: (saved6.append(len(popens)), real_save6(s_))[1]
captured(lambda: C.cmd_start(types.SimpleNamespace())); C.save = real_save6
acc_set(paused=True); n_st = len(popens); captured(lambda: C.cmd_start(types.SimpleNamespace()))
check(n_st == 1 and popens[0][0][-1] == "start" and saved6 == [0] and len(popens) == 1,
      "[cota] F6 cmd_start: abre o vigia (--origem start) depois de gravar o state.json; com o rodizio pausado, nao abre")
# S29: arquivo em b, active = a (esgotada) -> a passada regrava a e o passo 4 gira para b; sem CLI; a 2a passada so confere
f4_reset("a", applied=True, a=ex(T5 + 3600)); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))})
d6 = cred_get(); d6["claudeAiOauth"]["accessToken"] = TK["b"]; cred_put(d6)
out = watch(); w1, a6 = writes[0], acc_json(); out = watch()
check(w1 == 2 and a6["active"] == "b" and cred_tok() == TK["b"] and writes[0] == 0 and not sp_calls and acc_json()["active"] == "b",
      "[cota] S29: 'arquivo em Y, active em X' corrigido: regrava X, gira para Y sem chamar o CLI; a passada seguinte nao grava nada")
# S40/S41 (R10): sem hit, a passada gira para a disponivel (ativa esgotada; ativa invalida com outra reparada); sem ativa, ativa a 1a
f4_reset("a", applied=True, a=ex(T5 + 3600)); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))}); watch(); s40 = acc_json()["active"]
f4_reset("a", applied=True, a={"invalid": INV}, b={"invalid": None}); watch(); s41 = acc_json()["active"]
f4_reset(None); watch(); s_none = (acc_json()["active"], cred_tok(), acc_json()["applied"])
check(s40 == "b" and s41 == "b" and s_none == ("a", TK["a"], True),
      f"[cota] S40/S41: sem hit, o vigia gira para a conta disponivel; sem ativa (o estado do f2-contas.ps1), grava a 1a ({s40}, {s41}, {s_none[0]})")
# todas esgotadas / todas invalidas (modo acordar e sem credencial): bloco F7, mais abaixo
# S49 (R21): 8 sessoes com hit auth na mesma conta -> UMA validacao; ok = auth-nao-confirmado, a conta nao e invalidada
f4_reset("a", applied=True); live5.clear(); st6(bugs6(8, "f6e0s49e", kind="auth")); vcalls = []
C.validate_account = lambda label: (vcalls.append(label), ("ok", C.token_of(label)[1], "ok"))[1]
out = watch(); C.validate_account = real_validate
check(vcalls == ["a"] and cases6() == ["auth-nao-confirmado"] * 8 and not acc_json()["accounts"]["a"].get("invalid") and acc_json()["active"] == "a",
      f"[cota] S49: 8 hits auth na mesma conta: 1 validacao; resultado ok -> auth-nao-confirmado nas 8, conta valida ({vcalls})")
# S33 (N2): a passada levanta SystemExit (accounts.json ilegivel) -> log + st.quota.last_error, e o laco segue
f4_reset("a", applied=True); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))})
good6 = (C.ACCOUNTS_DIR / "accounts.json").read_text(encoding="utf-8"); (C.ACCOUNTS_DIR / "accounts.json").write_text("{quebrado", encoding="utf-8")
naps[:] = [lambda: (box.update(q33=state6().get("quota")), (C.ACCOUNTS_DIR / "accounts.json").write_text(good6, encoding="utf-8"),
                    C.save(st5({"v": bug5(1, "retest")})))]
out = watch(once=False)
check("ERRO na passada: SystemExit" in out and "SystemExit" in (box["q33"] or {}).get("last_error", "")
      and "vigia saindo (fim da execucao)" in out and not naps,
      "[cota] S33: passada com SystemExit (die) vai ao log e a st.quota.last_error; o vigia segue e sai na passada seguinte")
# S45 (R14): outro processo troca o .token da ativa -> a passada seguinte grava o token novo, sem reiniciar o vigia
f4_reset("a", applied=True); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))}); C.token_of("a")
NEW6 = tok("Z"); v6 = C.token_write("a", NEW6); a6 = acc_json(); a6["accounts"]["a"]["token_version"] = v6
(C.ACCOUNTS_DIR / "accounts.json").write_text(json.dumps(a6), encoding="utf-8"); out = watch()
s45 = cred_tok() == NEW6 and NEW6 not in out and TK["a"] not in out
C.token_write("a", TK["a"]); a6 = acc_json(); a6["accounts"]["a"]["token_version"] = C.token_path("a").stat().st_mtime
(C.ACCOUNTS_DIR / "accounts.json").write_text(json.dumps(a6), encoding="utf-8")
check(s45, "[cota] S45: token da ativa trocado por outro processo: a passada seguinte grava o token novo (sem token no log)")
# status: as linhas do rodizio (secao 6.3); sem contas, nenhuma
f4_reset("a", applied=True, b=ex(T5 + 3600), c={"invalid": INV}); acc_set(file_repairs=2, last_repair={"ts": T5, "motivo": "bloco de fora"})
sx = st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"), auth_hits={"dev": 3})}, quota={"origin": "tick", "last_error": "t SystemExit: 1"})
out_st, _ = captured(lambda: C.cmd_status(types.SimpleNamespace()))
acc_set(paused=True); out_pz, _ = captured(lambda: C.cmd_status(types.SimpleNamespace()))
real_dir6 = C.ACCOUNTS_DIR; C.ACCOUNTS_DIR = tmp / "f6-sem-contas"; out_0, _ = captured(lambda: C.cmd_status(types.SimpleNamespace())); C.ACCOUNTS_DIR = real_dir6
check(all(x in out_st for x in ("contas: ativa=a (arquivo confere)", "esgotadas: b ate", "invalidas: c (401)", "reparos do arquivo: 2 (ultimo: bloco de fora",
                                "vigia de cota: parado (origem tick; ultimo erro: t SystemExit: 1)", "x/dev precisa do dono (erro de autenticacao"))
      and "rodizio pausado (accounts restore)" in out_pz and "contas:" not in out_0 and "vigia de cota" not in out_0,
      "[cota] F6 status: ativa e arquivo, esgotadas, invalidas, reparos, vigia e ultimo erro, 'precisa do dono'; pausado; sem contas, nada")
# reconcile: sem execucao e com applied (vigia morto) -> aviso; com vigia vivo, sem aviso; --fix abre o vigia
f4_reset("a", applied=True); C.STATE.unlink(); rc_ = lambda fix: captured(lambda: C.cmd_reconcile(types.SimpleNamespace(fix=fix, grace=45)))
out_r, code_r = rc_(False); hold6 = C.try_lock("quota-watch"); out_r2, _ = rc_(False); C.unlock(hold6)
st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))}); popens.clear(); out_r3, _ = rc_(True)
check("rode `accounts restore`" in out_r and "se foi um `accounts activate` seu" in out_r and code_r == 1 and "accounts restore" not in out_r2
      and len(popens) == 1 and popens[0][0][-1] == "reconcile",
      "[cota] F6 reconcile: sem execucao e com o arquivo numa conta do rodizio, avisa (so sem vigia vivo); --fix abre o vigia")
# [cota] F6b: passo 5 do vigia (secao 6.5): retomada das sessoes paradas por cota e entrega das pendencias,
# um file_lock("state") por alvo, revalidacao R2, count_hit (R21) e contadores zerados quando a sessao responde.
# Mesmo relogio falso e ajudantes do bloco F6a; o spawn e o REAL, com o subprocess falso.
import contextlib as ctx6b
QMARK = "RETOMADA APOS LIMITE DE USO"
def bg_sids(): return [c[3] for c in bg_calls()]                  # [claude, --bg, --resume, sid, prompt]
def rec6b(st_, slug, stage="dev"): return st_["bugs"][slug]["sessions"][stage]
# S1 (F6a acima): depois do giro a -> b, as 8 retomadas saem na conta b, cada uma com o MESMO sessionId e a QUOTA_MSG
s1_ids = [f"f6e0s1aa{i:03d}-x" for i in range(8)]
check([c[3] for c in s1_bg] == s1_ids and all(QMARK in c[-1] for c in s1_bg)
      and all(rec6b(s1_state, f"b{i}")["id"] == s1_ids[i] and rec6b(s1_state, f"b{i}")["account"] == "b" for i in range(8))
      and not s1_state["pending_spawns"],
      "[cota] S1 (F6b): as 8 sessoes sao retomadas na conta seguinte, com o mesmo sessionId e a mensagem de retomada; fila vazia")
# S11: a retomada falha (CLI saiu 1) -> pendencia; a passada seguinte entrega UMA vez, sem transicao
f4_reset("a", applied=True); live5.clear(); st6(bugs6(1, "f6b0s11a", reset=RB))
sp_reply[0] = (1, "", "erro x"); watch(); n1, p1 = len(bg_calls()), state6()["pending_spawns"]
sp_reply[0] = (0, "ok\n", ""); watch(); s11 = state6()
check(n1 == 1 and len(p1) == 1 and p1[0]["why"].startswith("claude --bg saiu 1") and QMARK in p1[0]["message"]
      and bg_sids() == ["f6b0s11a000-x"] and bg_calls()[0][-1].count(QMARK) == 1 and not s11["pending_spawns"]
      and rec6b(s11, "b0")["account"] == "b",
      "[cota] S11: retomada com o CLI saindo 1 vira pendencia; a passada seguinte a entrega uma vez (mensagem nao duplicada)")
# S23 (R3): Busy na retomada -> 1 pendencia; 1 entrega na passada seguinte; depois de entregue, nao reaparece
f4_reset("a", applied=True); live5.clear(); st6(bugs6(1, "f6b0s23a", reset=RB)); busy6 = [1]
def resume23(exe, sid, prompt):
    if busy6[0]: busy6[0] = 0; raise C.Busy("sessao ocupada")
    return real_resume23(exe, sid, prompt)
real_resume23 = C.resume_cmd; C.resume_cmd = resume23
watch(); n1, p1 = len(bg_calls()), state6()["pending_spawns"]
watch(); n2, msg2, p2 = len(bg_calls()), (bg_calls() or [[""]])[0][-1], state6()["pending_spawns"]
watch(); n3 = len(bg_calls()); C.resume_cmd = real_resume23
check(n1 == 0 and len(p1) == 1 and p1[0]["why"].startswith("sessao busy") and n2 == 1 and msg2.count(QMARK) == 1
      and not p2 and n3 == 0 and not state6()["pending_spawns"],
      "[cota] S23: Busy na retomada: 1 pendencia; na passada seguinte, 1 entrega (mensagem uma vez); na terceira, nada")
# S20 (R2): entre a coleta e o lock o ledger muda (bug concluido, etapa mudada, rec.id trocado por sessao com hit de
# MESMO ts, finalizacao encerrada, e uma entrega feita por fora depois do hit)
f4_reset("a", applied=True); live5.clear(); b20 = bugs6(5, "f6b0s20a", reset=RB); limited("f6b0s20z-x", T5 - 7200 + 4, RB)
limited("f6b0s20f-x", T5 - 7100, RB); live5["f6b0s20f-x"] = "pipeline-finalizacao-r5"
st6(b20, final={"state": "rodando", "since": OLD, "session": {"id": "f6b0s20f-x", "name": "pipeline-finalizacao-r5",
                                                              "account": "a", "sent_ts": T5 - 7300}})
real_ls20 = C.limited_sessions
def ls20(st_):
    out_ = real_ls20(st_); m_ = state6()
    m_["bugs"]["b0"]["state"] = "retest"; m_["bugs"]["b1"]["state"] = "teste"
    m_["bugs"]["b2"]["sessions"]["dev"]["id"] = "f6b0s20z-x"; m_["final"]["state"] = "concluido"
    m_["bugs"]["b4"]["sessions"]["dev"]["sent_ts"] = T6[0]
    C.save(m_); return out_
C.limited_sessions = ls20; out = watch(); C.limited_sessions = real_ls20
check(len(re6.findall(r"\S+: candidato obsoleto", out)) == 5 and bg_sids() == ["f6b0s20a003-x"]
      and all(f"{w_}: candidato obsoleto" in out for w_ in ("b0/dev", "b1/dev", "b2/dev", "b4/dev", "finalizacao/finalizacao")),
      f"[cota] S20: ledger mudado entre a coleta e o lock: 5 candidatos obsoletos, so o bug intacto e retomado ({bg_sids()})")
# S22 (R3): pendencia sem hit, todas as sessoes paradas, nenhuma transicao -> o vigia entrega
f4_reset("a", applied=True); live5.clear(); live5["f6b0s22a-x"] = "bug01-dev-x"
st6({"x": bug5(1, "dev", "wt-1", dev5("f6b0s22a-x"))},
    pending_spawns=[{"slug": "x", "stage": "dev", "message": "msg de antes", "why": "aguardando cota", "ts": "t"}])
watch()
check(bg_sids() == ["f6b0s22a-x"] and "msg de antes" in bg_calls()[0][-1] and QMARK not in bg_calls()[0][-1]
      and not state6()["pending_spawns"],
      "[cota] S22: pendencia sem marcador no transcript e sem transicao: o vigia entrega (sem mensagem de retomada)")
# S40 (R10): ativa esgotada de antes, sem hit, pendencia 'aguardando cota' -> gira para b e entrega nela
f4_reset("a", applied=True, a=ex(T6[0] + 3600)); live5.clear(); live5["f6b0s40a-x"] = "bug01-dev-x"
st6({"x": bug5(1, "dev", "wt-1", dev5("f6b0s40a-x"))},
    pending_spawns=[{"slug": "x", "stage": "dev", "message": "msg 40", "why": "aguardando cota", "ts": "t"}])
watch(); s40 = state6()
check(acc_json()["active"] == "b" and bg_sids() == ["f6b0s40a-x"] and rec6b(s40, "x")["account"] == "b" and not s40["pending_spawns"],
      "[cota] S40: ativa esgotada e nenhum hit: a passada gira para b e entrega a pendencia na conta b")
# portao fechado (todas esgotadas): o passo 5 nao roda, a pendencia fica
f4_reset("a", applied=True, **{k: ex(T6[0] + 3600 + i) for i, k in enumerate("abcd")})
st6({"x": bug5(1, "dev", "wt-1", dev5("f6b0s40a-x"))},
    pending_spawns=[{"slug": "x", "stage": "dev", "message": "msg 40", "why": "aguardando cota", "ts": "t"}])
out = watch()
check(not bg_calls() and len(state6()["pending_spawns"]) == 1 and "reentregando" not in out,
      "[cota] F6b: com o portao fechado (todas esgotadas) o passo 5 nao roda: nenhuma chamada, a pendencia fica")
# S42 (R11): um spawn de fora segura o file_lock("state") quando o vigia quer girar: o CLI dele sai na conta antiga
f4_reset("a", applied=True); live5.clear(); st6(bugs6(1, "f6b0s42y", reset=RB))
live5["f6b0s42z-x"] = "bug02-dev-z"
sz = st5({"z": bug5(2, "dev", "wt-2", {"dev": {"id": "f6b0s42z-x", "name": "bug02-dev-z", "account": "a", "sent_ts": T5 - 9000}})})
tok42, real_run42 = [], C.subprocess.run
def run42(cmd, **kw):
    c_ = list(map(str, cmd))
    if "--bg" in c_: tok42.append((c_[3], cred_tok()))
    return real_run42(cmd, **kw)
C.subprocess.run = run42; h42 = C.try_lock("state")
naps[:] = [lambda: (box.update(z42=C.spawn(sz, "z", "dev", "m")), C.unlock(h42))]
watch(); C.subprocess.run = real_run42
check(not naps and tok42 == [("f6b0s42z-x", TK["a"]), ("f6b0s42y000-x", TK["b"])] and box["z42"]["account"] == "a"
      and cred_tok() == TK["b"] and rec6b(state6(), "b0")["account"] == "b",
      f"[cota] S42: o spawn que segura o lock chama o CLI na conta antiga (rec.account = a); o giro vem depois, e a retomada sai em b ({[(s_, k_) for s_, t_ in tok42 for k_, v_ in TK.items() if v_ == t_]})")
# S47 (R19): 8 alvos -> o file_lock("state") fica livre entre uma entrega e a seguinte
f4_reset("a", applied=True); live5.clear(); probe47, real_fl47 = [], C.file_lock
st6(bugs6(8, "f6b0s47a", reset=RB), pending_spawns=[{"slug": f"b{i}", "stage": "dev", "message": f"msg 47-{i}", "why": "aguardando cota",
                                                     "ts": "t"} for i in range(8)])
@ctx6b.contextmanager
def fl47(name, timeout=1200):
    if name == "state" and 1 <= len(bg_calls()) < 8:
        h_ = C.try_lock("state"); probe47.append(h_ is not None)
        if h_: C.unlock(h_)
    with real_fl47(name, timeout): yield
C.file_lock = fl47; watch(); C.file_lock = real_fl47
check(len(bg_calls()) == 8 and len(probe47) == 7 and all(probe47)
      and all(f"msg 47-{i}" in c[-1] and QMARK in c[-1] for i, c in enumerate(bg_calls())),
      f"[cota] S47: 8 alvos: entre uma entrega e a seguinte o file_lock('state') esta livre (uma transicao entra) ({probe47})")
# S49 (R21): auth a cada retomada com a validacao dando ok -> retoma no 1o e no 2o hit; no 3o, nao, e o status diz "precisa do dono"
C.validate_account = lambda label: ("ok", C.token_of(label)[1], "ok")
f4_reset("a", applied=True); live5.clear(); live5["f6b0s49a-x"] = "bug01-dev-x"
st6({"x": bug5(1, "dev", "wt-1", dev5("f6b0s49a-x"))}); seq49 = []
for i in range(3):
    tt = (rec6b(state6(), "x").get("sent_ts") or 0) + 10 + i         # hits distintos: o relogio falso nao anda entre passadas
    jl("f6b0s49a-x", u(iso(tt - 5)), auth(iso(tt)))
    out = watch(); seq49.append((len(bg_calls()), state6()["bugs"]["x"].get("auth_hits", {}).get("dev")))
out_st, _ = captured(lambda: C.cmd_status(types.SimpleNamespace()))
check(seq49 == [(1, 1), (1, 2), (0, 3)] and "x/dev: PRECISA DO DONO (erro de autenticacao" in out
      and "x/dev precisa do dono (erro de autenticacao" in out_st and not acc_json()["accounts"]["a"].get("invalid"),
      f"[cota] S49: hit auth com validacao ok: retomada no 1o e no 2o; no 3o seguido nao, e o status mostra 'precisa do dono' ({seq49})")
# o MESMO hit nao conta duas vezes: a retomada falha 2x (CLI saiu 1), auth_hits continua 1
f4_reset("a", applied=True); live5.clear(); live5["f6b0dupa-x"] = "bug01-dev-x"
st6({"x": bug5(1, "dev", "wt-1", dev5("f6b0dupa-x"))}); jl("f6b0dupa-x", u(iso(T5 - 7300)), auth(iso(T5 - 7200)))
sp_reply[0] = (1, "", "erro"); watch(); watch(); watch(); dup = state6()["bugs"]["x"]; sp_reply[0] = (0, "ok\n", "")
watch()
check(dup.get("auth_hits") == {"dev": 1} and len(dup["quota_hit_seen"]) == 1 and len(bg_calls()) == 1
      and state6()["bugs"]["x"].get("auth_hits") == {"dev": 1},
      "[cota] F6b: o mesmo hit visto em 3 passadas (retomada falhando) conta 1 vez; a 4a passada entrega")
C.validate_account = real_validate
# S55 (B2): rec com account_uncertain -> caso incerto, so retoma (nenhuma conta marcada); com 2 antes, o 3o nao retoma
f4_reset("a", applied=True); acc_set(wake_at=None); live5.clear(); live5["f6b0s55a-x"] = "bug01-dev-x"; before55 = frozen(acc_json())
r55 = {"dev": {"id": "f6b0s55a-x", "name": "bug01-dev-x", "account": "a", "sent_ts": T5 - 7300, "account_uncertain": True}}
limited("f6b0s55a-x", T5 - 7200, RB); st6({"x": bug5(1, "dev", "wt-1", dict(r55))}); out1 = watch()
s55a = (cases6() == ["incerto"], len(bg_calls()), state6()["bugs"]["x"].get("uncertain_hits"), frozen(acc_json()) == before55)
st6({"x": bug5(1, "dev", "wt-1", dict(r55), uncertain_hits={"dev": 2})}); out = watch()
check(s55a == (True, 1, {"dev": 1}, True) and not bg_calls() and "PRECISA DO DONO (arquivo de credenciais disputado)" in out,
      f"[cota] S55: hit de sessao com conta incerta: so retoma, sem marcar conta; no 3o seguido, 'arquivo de credenciais disputado' ({s55a})")
# contadores zerados quando a sessao RESPONDE depois da ultima entrega; resposta + hit novo na mesma passada: o hit e o 1o
f4_reset("a", applied=True); live5.clear(); live5["f6b0zera-x"] = "bug01-dev-x"; S0 = T5 - 7300
jl("f6b0zera-x", u(iso(S0 + 1)), a(iso(S0 + 2))); jl("f6b0zerb-x", u(iso(S0 + 1))); live5["f6b0zerb-x"] = "bug02-dev-y"
st6({"x": bug5(1, "dev", "wt-1", dev5("f6b0zera-x", sent=S0), auth_hits={"dev": 2}),
     "y": bug5(2, "dev", "wt-2", dev5("f6b0zerb-x", sent=S0), auth_hits={"dev": 2})}); out = watch()
z1 = (not state6()["bugs"]["x"].get("auth_hits", {}).get("dev"), "contadores de hits zerados em x/dev" in out, len(bg_calls()),
      state6()["bugs"]["y"].get("auth_hits"))
C.validate_account = lambda label: ("ok", C.token_of(label)[1], "ok")
jl("f6b0zera-x", u(iso(S0 + 1)), a(iso(S0 + 2)), u(iso(S0 + 3)), auth(iso(S0 + 4)))
st6({"x": bug5(1, "dev", "wt-1", dev5("f6b0zera-x", sent=S0), auth_hits={"dev": 2})}); out = watch()
C.validate_account = real_validate
check(z1 == (True, True, 0, {"dev": 2}) and state6()["bugs"]["x"].get("auth_hits") == {"dev": 1} and len(bg_calls()) == 1,
      f"[cota] F6b: sessao que respondeu depois da entrega zera auth_hits; resposta e hit novo na mesma passada: conta 1, nao 3, e retoma; a etapa sem resposta fica com o contador ({z1})")
# [cota] F7: modo acordar e "sem credencial" (secao 6.5.1, itens 1, 3, 4, 7, 8 e 9), parte do vigia. A tarefa
# avulsa (item 2) espera o item 8 da secao 5.2. Mesmo relogio falso e ajudantes dos blocos F6a/F6b.
def run7(interval=300, jump=None, stop_after=None):
    """Vigia em laco (once=False) com um relogio proprio: registra a hora de cada `claude --bg` e de cada
    sono. Na 1a retomada (ou depois de `stop_after` sonos) o ledger termina, e o vigia sai na passada
    seguinte. `jump`: segundos que o relogio pula no 1o sono (PC suspenso, S7)."""
    at, sleeps, real_run7, done = [], [], C.subprocess.run, [False]
    def run_(cmd, **kw):
        if "--bg" in list(map(str, cmd)): at.append(T6[0]); box["wake7"] = acc_json()["wake_at"]
        return real_run7(cmd, **kw)
    def sleep_(s):
        sleeps.append(s); T6[0] += s
        if jump and len(sleeps) == 1: T6[0] += jump
        if not done[0] and (at or (stop_after and len(sleeps) >= stop_after)):
            done[0] = True; C.save(st5({"v": bug5(1, "retest")}))
        if len(sleeps) > 3000: raise RuntimeError("vigia nao saiu")
    old = C.time
    C.time, C.subprocess.run = types.SimpleNamespace(time=lambda: T6[0], sleep=sleep_), run_
    try: watch(once=False, interval=interval)
    finally: C.time, C.subprocess.run = old, real_run7
    return at, sleeps
def pend7(slug="x"): return [{"slug": slug, "stage": "dev", "message": "msg 7", "why": "aguardando cota", "ts": "t"}]
def s7(sid, account="a", reset=None, sent=None, slug="x"):
    """Um bug em dev com a sessao `sid` parada por limite (hit 100 s antes de agora, `reset`) e uma pendencia."""
    limited(sid, T6[0] - 100, reset); live5.clear(); live5[sid] = "bug01-dev-x"
    return st6({slug: bug5(1, "dev", "wt-1", {"dev": {"id": sid, "name": "bug01-dev-x", "account": account,
                                                       "sent_ts": T6[0] - 200 if sent is None else sent}})}, pending_spawns=pend7(slug))
# S4: as 4 esgotadas -> wake_at = menor reset + 2 min; o arquivo ja vai para a conta desse reset; nenhuma chamada ao CLI
T7 = T6[0]; RA, RB7, RC, RD = T7 + 3000, T7 + 1000, T7 + 2000, T7 + 4000
f4_reset("a", applied=True, a=ex(RA), b=ex(RB7), c=ex(RC), d=ex(RD)); acc_set(wake_at=None)
s7("f7s4sess-x", account="b", reset=RB7); out = watch(); a7 = acc_json()
s4 = (a7["active"], a7["wake_at"], cred_tok() == TK["b"], writes[0], len(bg_calls()), len(state6()["pending_spawns"]))
out2 = watch()
check(s4 == ("b", RB7 + 120, True, 1, 0, 1) and f"acordo as {C.when(RB7 + 120)} com a conta b" in out
      and cred_get()["mcpOAuth"] == MCP and a7["switched_at"] == T7
      and writes[0] == 0 and "acordo as" not in out2 and acc_json()["wake_at"] == RB7 + 120 and not bg_calls(),
      f"[cota] S4: todas esgotadas: wake_at = menor reset + 2 min, o arquivo vai ja para b (a de menor reset), sem CLI; a passada seguinte nao grava nem repete a linha ({s4})")
out_st, _ = captured(lambda: C.cmd_status(types.SimpleNamespace()))
check(f"contas: acordar as {C.when(RB7 + 120)}" in out_st, "[cota] S4: o status mostra a hora de acordar")
# S5 + S37: o vigia dorme em passos de ate 60 s e a passada seguinte e exatamente em wake_at: o portao abriu pelo
# relogio; wake_at zera, a sessao (entregue ANTES do reset) cai em conhecido e e retomada, e a pendencia e entregue
at7, sl7 = run7()
a7, s5 = acc_json(), state6()
check(at7 == [RB7 + 120] and box["wake7"] is None and max(sl7) <= 60 and "acordei: a conta b voltou" in box["wout"] and "caso conhecido" in box["wout"]
      and not a7["accounts"]["b"].get("late_retries") and len(bg_calls()) == 1 and QMARK in bg_calls()[0][-1] and "msg 7" in bg_calls()[0][-1]
      and a7["wake_at"] is None and "vigia saindo (fim da execucao)" in box["wout"],
      f"[cota] S5/S37: o vigia acorda em wake_at (sonos <= 60 s), zera wake_at; o hit antigo e 'conhecido' (sem tentativa); retomada e pendencia numa entrega so ({[x - T7 for x in at7]})")
# S6 (R8): reset atrasado -> cada passada que entregou em b depois do reset e recebeu recusa conta 1; na 3a, b fica
# esgotada por mais 30 min, e o giro cai no modo acordar com a proxima a voltar (c)
T6s = T6[0]; f4_reset("b", applied=True, a=ex(T6s + 5000), b=ex(T6s - 120), c=ex(T6s + 2000), d=ex(T6s + 6000)); acc_set(wake_at=None)
s7("f7s6sess-x", account="b", reset=T6s - 120, sent=T6s - 500); st_ = state6(); st_["pending_spawns"] = []; C.save(st_)
seq6 = []
for i in range(3):
    if i:
        T6[0] += 300; jl("f7s6sess-x", u(iso(T6[0] - 60)), hit(iso(T6[0] - 50), reset=T6s - 120))
    watch(); e7 = acc_json()["accounts"]["b"]; seq6.append((cases6(), e7.get("late_retries"), len(bg_calls())))
a7 = acc_json()
T6[0] += 300; jl("f7s6sess-x", u(iso(T6[0] - 60)), hit(iso(T6[0] - 50), reset=T6s - 120)); watch(); a7 = acc_json()
check(seq6 == [(["conhecido"], 0, 1), (["atrasado"], 1, 1), (["atrasado"], 2, 1)]
      and cases6() == ["atrasado"] and a7["accounts"]["b"]["exhausted_until"] == T6[0] + 1800 and a7["accounts"]["b"]["late_retries"] == 0
      and a7["active"] == "c" and a7["wake_at"] == T6s + 2120 and cred_tok() == TK["c"] and not bg_calls(),
      f"[cota] S6 (R8): o hit de antes do reset e conhecido; 3 recusas depois do reset em passadas diferentes: b esgotada por +30 min e o vigia entra no modo acordar com c (a proxima a voltar), sem entregar ({seq6})")
# S7: o PC suspende durante a espera -> a 1a checagem de 60 s depois de voltar ve o relogio passado e acorda
f4_reset("a", applied=True, **{k: ex(T6[0] + 600 + i) for i, k in enumerate("abcd")}); acc_set(wake_at=None)
T7s = T6[0]; s7("f7s7sess-x", account="a", reset=T7s + 600)
at7, sl7 = run7(jump=5 * 3600)
check(at7 == [T7s + 60 + 5 * 3600] and sl7[0] == 60 and acc_json()["wake_at"] is None,
      f"[cota] S7: PC suspenso 5 h no 1o sono: a passada seguinte (sem outro sono) acorda e entrega ({sl7})")
# S41 (R10) no modo acordar: b reparada antes de wake_at -> giro para b, wake_at zera, entrega
f4_reset("a", applied=True, a=ex(T6[0] + 3600), b={"invalid": INV}, c=ex(T6[0] + 3700), d=ex(T6[0] + 3800)); acc_set(wake_at=None)
s7("f7s41se-x", account="a", reset=T6[0] + 3600); watch(); w41 = acc_json()["wake_at"]
a7 = acc_json(); a7["accounts"]["b"]["invalid"] = None; (C.ACCOUNTS_DIR / "accounts.json").write_text(json.dumps(a7), encoding="utf-8")
out = watch(); a7 = acc_json()
check(w41 == T6[0] + 3720 and a7["active"] == "b" and a7["wake_at"] is None and cred_tok() == TK["b"] and "encerrado antes da hora" in out
      and bg_sids() == ["f7s41se-x"] and rec6b(state6(), "x")["account"] == "b" and not state6()["pending_spawns"],
      "[cota] S41: no modo acordar, b reparada antes de wake_at: a passada seguinte gira para b, zera wake_at e entrega")
# integridade com a ativa invalida: nao regrava o token dela; com outra valida, o passo 4 gira (1 gravacao, nao 2)
f4_reset("a", applied=True, a={"invalid": INV}); acc_set(wake_at=None); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))}); watch()
check(writes[0] == 1 and acc_json()["active"] == "b" and cred_tok() == TK["b"],
      "[cota] F7 ensure_active: ativa invalida nao e regravada; o passo 4 gira para b com 1 gravacao")
# limite semanal (item 7): o mesmo fluxo, com wake_at dias depois
f4_reset("b", applied=True, a=ex(T6[0] + 3 * 86400), b=ex(T6[0] + 3 * 86400), c=ex(T6[0] + 4 * 86400), d=ex(T6[0] + 5 * 86400))
acc_set(wake_at=None)
st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))}); out = watch()
check(acc_json()["wake_at"] == T6[0] + 3 * 86400 + 120 and acc_json()["active"] == "b" and writes[0] == 0
      and f"acordo as {C.when(T6[0] + 3 * 86400 + 120)} com a conta b" in out,
      "[cota] F7 limite semanal: wake_at 3 dias depois; a e b voltam juntas: fica a ativa (b), sem gravar")
# S16 (R20): a execucao termina durante a espera -> o vigia devolve o /login, zera wake_at e sai por return
st6({"v": bug5(1, "retest")}); out = watch(once=False); a7 = acc_json()
check(a7["wake_at"] is None and a7["applied"] is False and cred_get()["claudeAiOauth"] == L1 and "vigia saindo (fim da execucao)" in out,
      "[cota] S16: fim da execucao no modo acordar: /login devolvido, wake_at zerado, o vigia sai")
# S31 (R7): todas invalidas -> sem credencial: o /login volta, sem wake_at, sem giro, sem CLI alem da sanidade; a linha
# sai uma vez; a passada seguinte NAO regrava a ativa invalida
f4_reset("a", applied=True, **{k: {"invalid": INV} for k in "abcd"}); live5.clear(); live5["f7s31se-x"] = "bug01-dev-x"
st6({"x": bug5(1, "dev", "wt-1", dev5("f7s31se-x"))}, pending_spawns=pend7())
at7, sl7 = run7(interval=60, stop_after=2); a7 = acc_json(); out_st, _ = captured(lambda: C.cmd_status(types.SimpleNamespace()))
check(not at7 and box["wout"].count("todas as contas invalidas: precisa do dono") == 1 and "/login devolvido" in box["wout"]
      and a7["wake_at"] is None and a7["applied"] is False and cred_get()["claudeAiOauth"] == L1 and writes[0] == 1
      and [c[0][1] for c in sp_calls] == ["-p"] and a7["active"] == "a" and "SEM CREDENCIAL VALIDA" in out_st,
      f"[cota] S31: todas invalidas: o /login volta (1 gravacao), sem wake_at, sem giro nem --bg; a linha sai 1 vez em 3 passadas; status pede accounts add ({len(sl7)} sonos)")
# S32 (R7): accounts add com token que valida -> a passada seguinte gira para a conta (o /login volta ao login.bak) e entrega
st6({"x": bug5(1, "dev", "wt-1", {"dev": {"id": "f7s31se-x", "name": "bug01-dev-x", "account": "a", "sent_ts": T6[0] - 50}})},
    pending_spawns=pend7()); live5.clear(); live5["f7s31se-x"] = "bug01-dev-x"
sp_reply[0] = (0, "ok\n", ""); acc_cmd("add", "b", stdin=TK["b"] + "\n"); add_ok = not acc_json()["accounts"]["b"].get("invalid")
out = watch(); a7 = acc_json()
check(add_ok and a7["active"] == "b" and cred_tok() == TK["b"] and bak() == L1 and writes[0] == 1
      and bg_sids() == ["f7s31se-x"] and "msg 7" in bg_calls()[0][-1] and not state6()["pending_spawns"],
      "[cota] S32: accounts add repara b: a passada seguinte grava b (o /login vai ao login.bak) e entrega a pendencia")
# S54: sem credencial com o par do login.bak ja morto -> sanidade auth; log e status pedem /login; o login.bak fica
f4_reset("a", applied=True, **{k: {"invalid": INV} for k in "abcd"}); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))})
sp_reply[0] = (1, "", AUTH_MSG); out = watch(); sp_reply[0] = (0, "ok\n", ""); a7 = acc_json()
out_st, _ = captured(lambda: C.cmd_status(types.SimpleNamespace()))
check("faca /login" in out and a7["login_dead"] == T6[0] and a7["wake_at"] is None and C.login_bak().exists() and "nao respondeu (auth): faca /login" in out_st,
      "[cota] S54: o /login devolvido sem credencial nao responde: log e status pedem /login; o login.bak fica")
C.time = real_time
C.resume_cmd, C.ensure_wt, C.checkout_fresh = real_resume5, real_ewt5, real_cof5
C.replace_retry = real_rr4
# [cota] F8: itens do rodizio no preflight (secao 6.8). preflight_accounts direto na copia C (guarda f4, relogio
# real), com o `check` do preflight imitado; o `claude -p` falso responde pela conta do token no env.
import hashlib, datetime as dt8
pf_reply, pf_hook = {}, {}
def pf_run(cmd, **kw):
    sp_calls.append((list(map(str, cmd)), kw.get("env"), kw.get("cwd")))
    lab = next((k for k, v in TK.items() if v == (kw.get("env") or {}).get("CLAUDE_CODE_OAUTH_TOKEN")), None)
    if lab in pf_hook: pf_hook.pop(lab)()
    rc, out_, err_ = pf_reply.get(lab, (0, "ok\n", ""))
    return types.SimpleNamespace(returncode=rc, stdout=out_, stderr=err_)
C.subprocess = types.SimpleNamespace(run=pf_run, TimeoutExpired=subprocess.TimeoutExpired)
def pf(**over):
    red = [False]
    def chk(cond, msg, fix=""):
        print(("[OK]   " if cond else "[FALHA] ") + msg + ("" if cond or not fix else f"\n        -> {fix}")); red[0] |= not cond
    sp_calls.clear()
    out_ = captured(lambda: C.preflight_accounts(chk))[0]
    return out_, red[0]
def pf_probes(): return [c[1]["CLAUDE_CODE_OAUTH_TOKEN"] for c in sp_calls if c[0][1:2] == ["-p"] and c[1] and "CLAUDE_CODE_OAUTH_TOKEN" in c[1]]
def cred_hash(): return hashlib.sha256(C.CRED_FILE.read_bytes()).hexdigest() if C.CRED_FILE.exists() else None
def pf_acc(**kw):                                    # guarda f4 com campos de topo trocados (ex.: order de 1 conta)
    a_ = acc_json(); a_.update(kw); (C.ACCOUNTS_DIR / "accounts.json").write_text(json.dumps(a_), encoding="utf-8")
# 0 contas: o preflight inteiro (copia R, sem guarda) avisa e nao fica vermelho por isso
boom_f3, boom = boom, [False]                         # o probe_run da copia R le o `boom` do piloto, que a F3 redefiniu
out = preflight_out(); boom = boom_f3
check("[AVISO] contas: nenhuma conta cadastrada: o pipeline roda sem rodizio" in out and "FALHA] conta" not in out
      and not (tmp / "contas-r").exists(),
      "[cota] F8 preflight: 0 contas -> aviso 'nenhuma conta', pela chamada no cmd_preflight; a guarda nao e criada")
# 1 conta e paused: aviso, sem validar nada, sem vermelho (R18), mesmo com CLAUDE_CONFIG_DIR
f4_reset("a"); pf_acc(order=["a"]); os.environ["CLAUDE_CONFIG_DIR"] = str(tmp / "outro-config")
out1, red1 = pf()
f4_reset("a"); pf_acc(paused=True)
out2, red2 = pf(); os.environ.pop("CLAUDE_CONFIG_DIR")
check("1 conta cadastrada: rodizio desligado" in out1 and "rodizio pausado (accounts restore)" in out2 and not red1 and not red2
      and not pf_probes() and "durante a execucao, TODA sessao" not in out1 + out2,
      "[cota] F8 preflight: 1 conta e pausado -> aviso, sem validacao, sem vermelho, nem com CLAUDE_CONFIG_DIR (R18)")
# S56: rodizio ligado, as 4 respondem -> verde; o arquivo de credenciais e a ativa iguais; 1 claude -p por conta, pelo env
f4_reset("b", applied=True); h0, a0 = cred_hash(), acc_json()
out, red = pf(); a1 = acc_json()
check(not red and cred_hash() == h0 and a1["active"] == "b" and a1 == a0 and sorted(pf_probes()) == sorted(TK.values())
      and all(f"[OK]   conta {k}: responde" in out for k in "abcd") and "durante a execucao, TODA sessao" in out
      and "sk-ant-" not in out and "[OK]   alguma conta valida" in out,
      "[cota] F8 S56: 4 contas validas -> VERDE; hash do arquivo de credenciais e accounts.json iguais; 1 claude -p por conta (token so no env); aviso fixo da D7")
# CLAUDE_CONFIG_DIR, arquivo ausente e arquivo ilegivel: vermelho com o rodizio ligado (S58)
os.environ["CLAUDE_CONFIG_DIR"] = str(tmp / "outro-config"); out, red = pf(); os.environ.pop("CLAUDE_CONFIG_DIR")
check(red and "[FALHA] CLAUDE_CONFIG_DIR nao definido" in out and cred_hash() == h0,
      "[cota] F8 S58: CLAUDE_CONFIG_DIR com o rodizio ligado -> VERMELHO, sem gravar nada")
C.CRED_FILE.unlink(); out, red = pf()
check(red and "[FALHA] arquivo de credenciais presente" in out and "faca /login" in out and not C.CRED_FILE.exists(),
      "[cota] F8: arquivo de credenciais ausente com o rodizio ligado -> VERMELHO (pede /login), sem criar o arquivo")
C.CRED_FILE.write_text("{ nao e json", encoding="utf-8"); out, red = pf()
check(red and "[FALHA] arquivo de credenciais legivel (arquivo de credenciais ilegivel (JSON invalido duas vezes))" in out
      and C.CRED_FILE.read_text(encoding="utf-8") == "{ nao e json",
      "[cota] F8: arquivo de credenciais com JSON invalido -> VERMELHO, sem gravar sobre ele")
# validacao: auth marca invalida (sem girar nem gravar o arquivo), limit avisa com a hora (sem exhausted_until, R9),
# transitorio avisa; com uma valida, nao e vermelho
f4_reset("a", applied=True); h0 = cred_hash()
pf_reply.update(b=(1, "", AUTH_MSG), c=(1, "", "You've hit your session limit · resets 11:10pm (America/Sao_Paulo)"),
                d=(1, "", "Connection reset"))
out, red = pf(); a1 = acc_json(); pf_reply.clear()
check(not red and a1["accounts"]["b"]["invalid"]["reason"].startswith("Please run /login") and "conta b: marcada INVALIDA" in out
      and "[AVISO] contas: b INVALIDA (Please run /login" in out and "accounts add --label b" in out
      and "c esgotada ate " in out and "23:10" in out and a1["accounts"]["c"]["exhausted_until"] == 0
      and "d: nao deu para validar agora (transitorio" in out and not a1["accounts"]["d"]["invalid"]
      and a1["active"] == "a" and cred_hash() == h0,
      "[cota] F8 validacao: auth marca b invalida; limit avisa 'esgotada ate 23:10' sem gravar; transitorio avisa; ativa e arquivo iguais")
# ok desmarca a invalida (como o accounts validate); todas auth -> VERMELHO
out, red = pf(); a1 = acc_json()
check(not red and not a1["accounts"]["b"]["invalid"] and "conta b: deixou de ser invalida" in out and "INVALIDA (" not in out,
      "[cota] F8 validacao: a invalida que agora responde deixa de ser invalida")
pf_reply.update({k: (1, "", AUTH_MSG) for k in "abcd"}); out, red = pf(); pf_reply.clear()
check(red and "[FALHA] alguma conta valida" in out and "todas as contas estao invalidas" in out
      and all(acc_json()["accounts"][k]["invalid"] for k in "abcd") and cred_hash() == h0,
      "[cota] F8: todas as contas dao auth -> todas invalidas, VERMELHO, arquivo igual")
# R14: o token de a e trocado (accounts add) durante a validacao que da auth -> a marca e descartada
f4_reset("a"); pf_reply["a"] = (1, "", AUTH_MSG)
pf_hook["a"] = lambda: acc_cmd("add", "a", stdin=tok("Z") + "\n")
out, red = pf(); pf_reply.clear()
check(not acc_json()["accounts"]["a"]["invalid"] and "conta a: marcada INVALIDA" not in out,
      "[cota] F8 R14: token trocado durante a validacao que deu auth -> nao marca a conta nova")
acc_cmd("add", "a", stdin=TK["a"] + "\n")
# .token que nao decifra (ou falta): VERMELHO para a conta, sem claude -p dela, sem sair do preflight
f4_reset("a"); C.token_path("c").write_bytes(b"lixo"); C._TOKENS.pop("c", None)
out, red = pf()
check(red and "[FALHA] conta c: token decifra" in out and "nao consegui decifrar" in out and TK["c"] not in pf_probes()
      and "[OK]   conta d: responde" in out,
      "[cota] F8: .token que nao decifra -> VERMELHO na conta, sem validar ela, e o preflight segue para as outras")
acc_cmd("add", "c", stdin=TK["c"] + "\n")
# token vencendo / vencido, esgotada marcada, switch_error, applied sem execucao (vigia morto) x com execucao
today8 = dt8.date.today()
f4_reset("a", applied=True, b={"token_created": (today8 - dt8.timedelta(days=340)).isoformat()},
         c={"token_created": (today8 - dt8.timedelta(days=400)).isoformat()}, d={"exhausted_until": time.time() + 3600})
pf_acc(switch_error="simulado: conferencia falhou"); st6({"v": bug5(1, "retest")})
out, red = pf()
st6({"x": bug5(1, "dev", "wt-1", dev5("f8vivo-x"))}); out_open, _ = pf()
check(not red and "o token de b vence em 25 dia(s)" in out and "o token de c venceu" in out
      and "d marcada esgotada ate " in out and "erro de troca gravado: simulado" in out
      and "sem execucao ativa e sem vigia: se o vigia morreu sem devolver o /login, rode `accounts restore`" in out
      and "se foi um `accounts activate` seu" in out and "`accounts activate` de" not in out
      and "o vigia morreu" not in out_open and "o token de a" not in out,
      "[cota] F8 avisos: token vence em 25 dias / venceu; esgotada marcada; switch_error; applied sem execucao e sem marca -> as duas leituras (nao com execucao aberta)")
# [armado] bug pipeline-preflight-alarme-falso-vigia-morto-apos-accounts-activate_2026-10-07: o `accounts activate`
# sem execucao aberta ARMA o rodizio (marca `armed`); preflight, reconcile e status falam do activate, nao de vigia
# morto. Quem passa a usar a conta (init, spawn, vigia) e o restore apagam a marca.
ARM = "`accounts activate` de "                       # o texto de armado nos avisos
TWO = "se foi um `accounts activate` seu"              # o texto sem marca: as duas leituras
def st8(): return captured(lambda: C.cmd_status(types.SimpleNamespace()))
def arm(state_=None, **kw):                           # guarda f4 no /login, execucao fechada (ou state_), activate b
    f4_reset("a")
    if state_ is None: C.STATE.unlink(missing_ok=True)
    else: st6(state_, **kw)
    return acc_cmd("activate", "b")
CLOSED = {"v": bug5(1, "retest")}
out_act, code_act = arm(CLOSED); m8 = acc_json()["armed"]
out_pa, red_pa = pf(); out_ra, _ = rc_(False); out_sa, code_sa = st8()
check(code_act is None and m8 and m8["run_id"] == "r5" and "armado ate o `init` + `start`" in out_act
      and "esta na conta b desde o " + ARM in out_pa and "o vigia morreu" not in out_pa and not red_pa
      and "AVISO: o arquivo de credenciais esta na conta b desde o " + ARM in out_ra and "o vigia morreu" not in out_ra
      and "contas: armado por `accounts activate` em " in out_sa and code_sa is None,
      "[armado] activate sem execucao aberta grava armed com o run_id do state; preflight, reconcile e status falam do activate, sem 'o vigia morreu'")
out_act, _ = arm(None); m8 = acc_json()["armed"]
out_pb, _ = pf(); out_rb, code_rb = rc_(False); out_sb, code_sb = st8()
real_dir8 = C.ACCOUNTS_DIR; C.ACCOUNTS_DIR = tmp / "f8-sem-contas"; out_s0, code_s0 = st8(); C.ACCOUNTS_DIR = real_dir8
check(m8 and m8["run_id"] is None and "armado ate o" in out_act and ARM in out_pb and "o vigia morreu" not in out_pb
      and ARM in out_rb and "o vigia morreu" not in out_rb
      and code_sb is None and "sem execucao: .bugfix-pipeline/state.json nao existe" in out_sb
      and "contas: armado por `accounts activate` em " in out_sb and "Rode `init` primeiro" not in out_sb
      and code_s0 is None and "contas:" not in out_s0 and "vigia de cota" not in out_s0,
      "[armado] sem state.json tambem arma (run_id None): preflight e reconcile com o texto de armado; status sai 0 com a linha de armado (sem contas: sem 'contas:')")
arm({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))}); a8 = acc_json()
C.STATE.write_text("{quebrado", encoding="utf-8"); acc_cmd("activate", "c"); a8b = acc_json()
check(a8["armed"] is None and a8["applied"] and a8b["armed"] is None and a8b["active"] == "c",
      "[armado] activate com execucao aberta nao arma; com o state.json ilegivel tambem nao (sem marca, o aviso diz as duas leituras)")
# consumo: spawn_account e o vigia, ambos com a execucao aberta; depois que ela fecha, o aviso volta as duas leituras
arm(CLOSED); m8 = acc_json()["armed"]; st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))})
sa8 = C.spawn_account(); a8 = acc_json(); st6(CLOSED); out_pd, _ = pf()
check(m8 and sa8 == ("b", None) and a8["armed"] is None and a8["applied"] and "o vigia morreu sem devolver" in out_pd
      and TWO in out_pd and ARM not in out_pd,
      "[armado] o spawn_account da execucao consome a marca; com a execucao fechada de novo, o aviso diz as duas leituras")
arm(CLOSED); m8 = acc_json()["armed"]; st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))}); out_w8 = watch(); a8 = acc_json()
check(m8 and a8["armed"] is None and a8["applied"] and a8["active"] == "b" and "vigia saindo" not in out_w8,
      "[armado] a passada do vigia com a execucao aberta (bloco de integridade) consome a marca")
# init: o aceito invalida a marca, inclusive com o mesmo run_id (relogio fixo: um por minuto); o recusado nao toca a guarda
RID8 = "20300101-0000"
class FixedDT8(C.dt.datetime):
    @classmethod
    def now(cls, tz=None): return cls(2030, 1, 1, 0, 0, 30)
plan8 = tmp / "bugs-armado.json"; plan8.write_text(json.dumps({"bugs": [{"slug": "z", "doc": "docs/bugs/open/z.md"}]}), encoding="utf-8")
def init8():
    real_dt8 = C.dt; C.dt = types.SimpleNamespace(datetime=FixedDT8, date=real_dt8.date, timedelta=real_dt8.timedelta)
    try: return captured(lambda: C.cmd_init(types.SimpleNamespace(bugs=str(plan8), base="origin/versao3", model="m", effort="medium",
                                                                  max_returns=3, max_planning=4, max_dev=4, permission_mode="auto", force=False)))
    finally: C.dt = real_dt8
arm(CLOSED, run_id=RID8); m8 = acc_json()["armed"]; out_i8, code_i8 = init8(); s8, a8 = state6(), acc_json()
st6(CLOSED, run_id=RID8); out_pi, _ = pf(); out_si, _ = st8()       # a execucao de mesmo run_id fecha sem spawn nem vigia
check(m8 and m8["run_id"] == RID8 and code_i8 is None and s8["run_id"] == RID8 and C.run_open(s8)
      and a8["armed"] is None and a8["applied"] and ARM not in out_pi and TWO in out_pi and "armado por" not in out_si,
      "[armado] init aceito (mesmo run_id da marca) apaga a marca sem spawn nem vigia: fechada a execucao, aviso com as duas leituras, nunca 'armado'")
arm(CLOSED); st6({"x": bug5(1, "dev", "wt-1", dev5("f6e0nada-x"))})            # a marca e de uma execucao fechada; agora ha uma aberta
raw8 = (C.ACCOUNTS_DIR / "accounts.json").read_bytes(); out_g8, code_g8 = init8()
check(code_g8 == 1 and "ainda ativa" in out_g8 and (C.ACCOUNTS_DIR / "accounts.json").read_bytes() == raw8 and acc_json()["armed"],
      "[armado] init recusado (execucao aberta, sem --force) nao toca a guarda: a marca fica")
# leitura: a marca de outro run_id nao vale; o restore apaga
arm(CLOSED); st6(CLOSED, run_id="r6"); out_h8, _ = pf(); out_hs, _ = st8()
check(acc_json()["armed"]["run_id"] == "r5" and ARM not in out_h8 and TWO in out_h8 and "armado por" not in out_hs,
      "[armado] marca de outro run_id (execucao trocada depois do activate) nao vale: aviso com as duas leituras e status sem 'armado'")
arm(CLOSED); out_x8, code_x8 = acc_cmd("restore"); a8 = acc_json(); out_px, _ = pf(); out_rx, _ = rc_(False); out_sx, _ = st8()
check(code_x8 is None and a8["armed"] is None and not a8["applied"] and a8["paused"]
      and all("o vigia morreu" not in o and ARM not in o and "armado por" not in o for o in (out_px, out_rx, out_sx)),
      "[armado] accounts restore apaga a marca: preflight, reconcile e status sem aviso de conta no arquivo")
arm(CLOSED); C.login_bak().unlink(); out_y8, code_y8 = acc_cmd("restore"); a8 = acc_json(); out_py, _ = pf(); out_sy, _ = st8()
check(code_y8 is None and "sem /login guardado" in out_y8 and a8["applied"] and a8["paused"] and a8["armed"]
      and ARM not in out_py and TWO in out_py and "armado por" not in out_sy,
      "[armado] restore sem login.bak (applied fica, rodizio pausado): a marca nao vale, porque nenhum vigia vai subir")
# ---- [tasks] DESIGN 22.9 (B2.9): `depende_de` nas ondas, numa copia nova do modulo com os mesmos falsos do inicio.
# b espera a (retest); h depende de a2, que reprova; f depende de g (documentado); d e e se esperam (ciclo).
D = importlib.util.module_from_spec(spec); spec.loader.exec_module(D)
dtmp = Path(tempfile.mkdtemp())
D.PIPE = dtmp; D.STATE = dtmp / "state.json"; D.WTS = dtmp / "lanes"; D.DSG = dtmp / "nao-existe"
D.ACCOUNTS_DIR = dtmp / "contas-d"; D.CRED_FILE = dtmp / "cred-d.json"; D.CLAUDE_PROJECTS = dtmp / "projects"
D.spawn = lambda st, slug, stage, message="": None
D.ensure_wt = lambda st, name: (st["worktrees"].setdefault(name, {"path": str(dtmp / name), "bug": None}), dtmp / name)[1]
D.checkout_fresh = lambda path, base, branch: None
D.stop_sessions = lambda b, except_stage=None: None
D.publish_head = fake_publish; D.guard_wt = lambda p: Path(p); D.agents = lambda: []
D.git = fake_git; D.porcelain_paths = lambda path, untracked=True: []
(dtmp / "wt-planning" / "launcher").mkdir(parents=True)
dslugs = ["a", "a2", "b", "h", "f", "g", "d", "e"]
deps = {"b": ["a"], "h": ["a2"], "f": ["g"], "d": ["e"], "e": ["d"]}
dbugs = dtmp / "bugs.json"
dbugs.write_text(json.dumps({"bugs": [{"slug": s, "doc": f"docs/bugs/open/{s}.md"} for s in dslugs]}), encoding="utf-8")
D.cmd_init(types.SimpleNamespace(bugs=str(dbugs), base="origin/versao3", model="m", effort="medium", max_returns=3,
                                 max_planning=8, max_dev=4, permission_mode="auto", force=True))
D.cmd_start(types.SimpleNamespace())
for s in dslugs:
    pf_ = dtmp / f"{s}.json"
    pf_.write_text(json.dumps({"verdict": "sem-codigo" if s == "g" else "corrigir", "complexity": "baixa", "severity": "alto",
                               "files": [f"launcher/{s}.cs"], "effort": {"dev": "low", "teste": "low"},
                               "ultrathink": {"dev": False, "teste": False}, "depende_de": deps.get(s, []), "summary": s}),
                   encoding="utf-8")
    D.cmd_plan_done(types.SimpleNamespace(bug=s, json=str(pf_)))
ds = json.loads(D.STATE.read_text(encoding="utf-8"))
dstate = lambda: {s: b["state"] for s, b in json.loads(D.STATE.read_text(encoding="utf-8"))["bugs"].items()}
check(ds["waves"] == [["a", "a2"]] and all(ds["bugs"][s]["state"] == "planejado" for s in ("b", "h", "d", "e")),
      f"[tasks] onda 1 so com quem nao depende de ninguem; dependentes esperam ({ds['waves']})")
check(ds["bugs"]["f"]["state"] == "open-falhou" and "dependencia g terminou em documentado" in ds["bugs"]["f"]["history"][-1]["note"],
      "[tasks] dependencia que terminou fora de retest (documentado) -> open-falhou com o motivo")
def dfinish(s, to):
    st_ = json.loads(D.STATE.read_text(encoding="utf-8"))
    D.finish_bug(st_, s, to, "sim", caller_stage="teste"); D.save(st_)
dfinish("a2", "open-falhou")
check(len(json.loads(D.STATE.read_text(encoding="utf-8"))["waves"]) == 1 and dstate()["h"] == "planejado",
      "[tasks] onda 1 ainda aberta (a em dev): nada muda para os dependentes")
dfinish("a", "retest")
ds = json.loads(D.STATE.read_text(encoding="utf-8"))
check(ds["waves"][-1] == ["b"] and ds["bugs"]["h"]["state"] == "open-falhou"
      and "dependencia a2 terminou em open-falhou" in ds["bugs"]["h"]["history"][-1]["note"] and ds["final"]["state"] == "pendente",
      f"[tasks] onda 2: b (dependencia aprovada); h cai porque a2 reprovou; finalizacao ainda fechada ({ds['waves']})")
dfinish("b", "retest")
ds = json.loads(D.STATE.read_text(encoding="utf-8"))
check(ds["bugs"]["d"]["state"] == ds["bugs"]["e"]["state"] == "open-falhou" and "ciclo em depende_de" in ds["bugs"]["d"]["history"][-1]["note"]
      and ds["final"]["state"] == "rodando" and not [s for s, b in ds["bugs"].items() if b["state"] not in D.TERMINAL],
      "[tasks] ciclo (d <-> e) -> open-falhou, e so depois a finalizacao abre, sem item planejado no ledger")

C.subprocess = types.SimpleNamespace(run=fake_sp_run, TimeoutExpired=subprocess.TimeoutExpired)
if sess_env is not None:
    os.environ["CLAUDE_CODE_SESSION_ID"] = sess_env
check((mtime_ns(REAL_CRED), mtime_ns(REAL_ACC)) == real0,
      "[cota] o ~/.claude/.credentials.json e o accounts.json reais nao foram tocados (mtime igual ao do inicio)")
print("SIMULACAO VERDE")
