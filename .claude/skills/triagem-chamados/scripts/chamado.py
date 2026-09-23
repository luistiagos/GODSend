#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Cliente de leitura dos CHAMADOS DE SUPORTE e das conversas de WhatsApp.

Implementa os Passos 1-3 e a medicao do Passo 4c da skill `triagem-chamados`.
NAO classifica nada: ler os logs, agrupar por causa, confirmar no codigo-fonte e
escrever os bug docs e trabalho do agente.

USO
    python chamado.py abertos                 # chamados aberto/em_atendimento
    python chamado.py ticket 29 46            # ficha + linha do tempo de cada chamado
    python chamado.py conversa 29             # conversa inteira -> arquivo UTF-8
    python chamado.py conversa-lid 108649888370692@lid
    python chamado.py promessas 29            # promessa de humano x chegada do humano
    python chamado.py sql "SELECT ..."        # valvula de escape (so SELECT)

SAIDA: <pasta do script>/saida-chamados/  (ou $TRIAGEM_CHAMADOS_OUT)

TOKEN: lido em runtime de $DIAG_API_TOKEN ou, na falta, do `DIAG_TOKEN` de
`digitalstoregamesbackend/diag_deep.py`. NUNCA e impresso nem gravado em disco.
"""
import datetime
import io
import json
import os
import re
import sys
import urllib.request

BASE = "https://digitalstoregames.pythonanywhere.com"
# A saida fica AO LADO do proprio script: copie o script para o scratchpad da SESSAO e os
# artefatos ficam la tambem. Nao use pasta compartilhada (ex.: o Temp do Windows): outra
# sessao sobrescreve o arquivo por um script de CLI diferente, e o seu comando vira saida
# vazia com exit 0 -- que parece sucesso.
OUT = os.environ.get("TRIAGEM_CHAMADOS_OUT") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "saida-chamados")
BACKEND = r"C:\projects\digitalstoregamesproject\digitalstoregamesbackend"

TABELA_TICKET = "wpp_support_ticket"
TABELA_EVENTO = "wpp_support_ticket_event"
TABELA_MSG = "Wpp_proccess"

# Prefixos de msg_id que o webhook grava como NOTA INTERNA: nunca foram enviadas ao
# cliente, e o proprio webhook as pula ao remontar o historico do agente.
INTERNOS = ("internal_consult_", "silent_handoff_")


def _token():
    tok = os.environ.get("DIAG_API_TOKEN")
    if tok:
        return tok.strip()
    for nome in ("diag_deep.py", "diag_bot_status.py", "diag_agent_state.py"):
        caminho = os.path.join(BACKEND, nome)
        if not os.path.exists(caminho):
            continue
        texto = io.open(caminho, encoding="utf-8", errors="replace").read()
        m = re.search(r"DIAG_TOKEN\s*=\s*['\"]([0-9a-fA-F]{32,})['\"]", texto)
        if m:
            return m.group(1)
    raise SystemExit(
        "token nao encontrado: defina DIAG_API_TOKEN ou garanta acesso a "
        + os.path.join(BACKEND, "diag_deep.py")
    )


def q(sql, limit=500):
    """Roda um SELECT no /diag/query. Aborta com a mensagem do servidor em caso de erro."""
    corpo = json.dumps({"sql": sql, "limit": limit}).encode("utf-8")
    req = urllib.request.Request(
        BASE + "/diag/query",
        data=corpo,
        headers={
            "Authorization": "Bearer " + _token(),
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        dados = json.loads(r.read().decode("utf-8"))
    if "rows" not in dados:
        raise SystemExit("erro do /diag/query: " + json.dumps(dados, ensure_ascii=False))
    return dados["rows"]


def _esc(v):
    return str(v).replace("\\", "\\\\").replace("'", "''")


def _saida(nome):
    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    return os.path.join(OUT, nome)


def _dump(nome, obj):
    caminho = _saida(nome)
    with io.open(caminho, "w", encoding="utf-8") as f:
        f.write(json.dumps(obj, indent=2, ensure_ascii=False, default=str))
    return caminho


def _dt(v):
    return datetime.datetime.fromisoformat(str(v).replace(" ", "T")[:19])


# --------------------------------------------------------------------------- aliases
def _variantes_telefone(digitos):
    """Variantes BR do telefone (com e sem o 9o digito).

    Mesma ideia de `wppdao._br_phone_variants`; aqui so o que o LIKE precisa."""
    d = re.sub(r"\D", "", digitos or "")
    if not d:
        return []
    out = set([d])
    if d.startswith("55") and len(d) >= 12:
        ddd, resto = d[2:4], d[4:]
        if len(resto) == 8:
            out.add("55" + ddd + "9" + resto)
        elif len(resto) == 9 and resto.startswith("9"):
            out.add("55" + ddd + resto[1:])
    return sorted(out)


def _where_conversa(lid, telefone):
    """WHERE que casa a conversa por lid OU por qualquer variante do telefone.

    O join e por PREFIXO porque as colunas guardam o JID inteiro
    (`<numero>@s.whatsapp.net`, `<id>@lid`) e o phone-jid as vezes vem truncado."""
    chaves = []
    if lid:
        chaves.append(str(lid).split("@")[0])
    for v in _variantes_telefone(telefone):
        chaves.append(v)
    if not chaves:
        raise SystemExit("sem lid nem telefone para montar o filtro")
    partes = []
    for k in sorted(set(chaves)):
        k = _esc(k)
        partes.append("main_phone LIKE '" + k + "%'")
        partes.append("alt_phone  LIKE '" + k + "%'")
    return "(" + " OR ".join(partes) + ")"


# -------------------------------------------------------------------------- comandos
def cmd_abertos():
    linhas = q(
        "SELECT id, lid, telefone, email, status, aberto_em, origem_agente, "
        "ultima_msg_cliente_em, ultima_msg_operador_em, LEFT(msg_abertura, 90) AS abertura "
        "FROM `" + TABELA_TICKET + "` WHERE status <> 'fechado' ORDER BY aberto_em DESC"
    )
    for r in linhas:
        print("#%-5s %-14s %-16s %s" % (r["id"], r["status"], r.get("telefone"), r["aberto_em"]))
        print("      agente=%s  lid=%s" % (r.get("origem_agente"), r.get("lid")))
        print("      ult.cliente=%s  ult.operador=%s"
              % (r.get("ultima_msg_cliente_em"), r.get("ultima_msg_operador_em")))
        print("      %s" % (r.get("abertura") or "").replace("\n", " "))
    print("")
    print("%d chamado(s) nao fechado(s) -> %s" % (len(linhas), _dump("abertos.json", linhas)))


def cmd_ticket(ids):
    lista = ",".join(str(int(i)) for i in ids)
    fichas = q("SELECT * FROM `" + TABELA_TICKET + "` WHERE id IN (" + lista + ") ORDER BY id")
    if not fichas:
        raise SystemExit("nenhum chamado com id em (" + lista + ")")
    eventos = q("SELECT * FROM `" + TABELA_EVENTO + "` WHERE ticket_id IN (" + lista
                + ") ORDER BY ticket_id, id")
    campos = ("lid", "telefone", "email", "aberto_em", "fechado_em", "fechado_por",
              "origem_agente", "origem_motivo", "pacote_json", "compras_status",
              "acesso_entregue", "reembolso", "reembolso_motivo", "resumo_status",
              "resumo_problema", "resumo_onde", "ultima_msg_cliente_em",
              "ultima_msg_operador_em")
    for t in fichas:
        print("=" * 78)
        print("CHAMADO #%s  status=%s (%s)" % (t["id"], t["status"], t.get("status_em")))
        for k in campos:
            if t.get(k) not in (None, ""):
                print("  %-24s %s" % (k, t[k]))
        print("  msg_abertura: %s" % (t.get("msg_abertura") or "").replace("\n", " ")[:300])
        print("  -- linha do tempo --")
        for e in [e for e in eventos if e["ticket_id"] == t["id"]]:
            print("  %s  %-18s %s -> %s  (%s) por %s"
                  % (e["criado_em"], e["tipo"], e.get("de"), e.get("para"),
                     e.get("motivo") or "-", e.get("autor")))
    print("")
    print("-> %s" % _dump("tickets.json", {"tickets": fichas, "eventos": eventos}))


def _baixar_conversa(lid, telefone, rotulo):
    where = _where_conversa(lid, telefone)
    linhas, ultimo = [], 0
    while True:
        lote = q(
            "SELECT id, msg_id, main_phone, alt_phone, role, dttime, message FROM `"
            + TABELA_MSG + "` WHERE " + where + " AND id > " + str(ultimo)
            + " ORDER BY id ASC",
            limit=500,
        )
        linhas.extend(lote)
        if len(lote) < 500:
            break
        ultimo = lote[-1]["id"]
    caminho = _saida("conversa_" + rotulo + ".txt")
    with io.open(caminho, "w", encoding="utf-8") as f:
        f.write("# conversa %s (lid=%s telefone=%s) - %d mensagens\n"
                % (rotulo, lid, telefone, len(linhas)))
        f.write("# role: customer=cliente | user=OPERADOR HUMANO | resto=agente/bot\n")
        f.write("# [INTERNA] = msg_id interno, NUNCA foi enviada ao cliente\n\n")
        for r in linhas:
            interna = " [INTERNA]" if str(r.get("msg_id") or "").startswith(INTERNOS) else ""
            f.write("--- [%s] %s %s%s\n%s\n"
                    % (r["id"], r["dttime"], r["role"], interna, r["message"]))
    print("%d mensagens -> %s" % (len(linhas), caminho))
    return linhas


def cmd_conversa(ticket_id):
    t = q("SELECT id, lid, telefone FROM `" + TABELA_TICKET + "` WHERE id = "
          + str(int(ticket_id)))
    if not t:
        raise SystemExit("chamado #%s nao existe" % ticket_id)
    t = t[0]
    return _baixar_conversa(t.get("lid"), t.get("telefone"), "chamado%s" % t["id"])


def cmd_conversa_lid(lid):
    return _baixar_conversa(lid, None, re.sub(r"\W+", "_", str(lid)))


_PROMESSA = re.compile(
    r"chamando o suporte|acionando o suporte|chamar o suporte|acionar o suporte"
    r"|refor\w+ com o suporte|refor\w+ seu caso|atendente j[a\u00e1] (vai|te)"
    r"|encaminhar o seu caso|deixei seu caso com o suporte|direcionando para o atendente",
    re.I,
)


def cmd_promessas(ticket_id):
    linhas = cmd_conversa(ticket_id)
    humanos = [r for r in linhas if r["role"] == "user"]
    prom = [r for r in linhas
            if r["role"] not in ("customer", "user")
            and not str(r.get("msg_id") or "").startswith(INTERNOS)
            and _PROMESSA.search(r["message"] or "")]
    print("")
    print("total=%d  humano(role=user)=%d  promessas de suporte=%d"
          % (len(linhas), len(humanos), len(prom)))
    print("")
    for p in prom:
        seg = [h for h in humanos if _dt(h["dttime"]) > _dt(p["dttime"])]
        if seg:
            h = (_dt(seg[0]["dttime"]) - _dt(p["dttime"])).total_seconds() / 3600.0
            print("  [%s] %s %-18s -> humano em %6.1f h (id %s)"
                  % (p["id"], p["dttime"], p["role"], h, seg[0]["id"]))
        else:
            print("  [%s] %s %-18s -> NENHUM humano depois disso"
                  % (p["id"], p["dttime"], p["role"]))


def cmd_sql(sql):
    if not sql.strip().upper().startswith("SELECT"):
        raise SystemExit("so SELECT (o /diag/query recusa o resto de qualquer jeito)")
    linhas = q(sql)
    print("%d linha(s) -> %s" % (len(linhas), _dump("sql.json", linhas)))


def main():
    # O console do Windows e cp1252: sem isto, qualquer acento ou emoji vindo do banco
    # derruba o script com UnicodeEncodeError no meio da impressao.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "abertos":
        cmd_abertos()
    elif cmd == "ticket":
        cmd_ticket(args)
    elif cmd == "conversa":
        cmd_conversa(args[0])
    elif cmd == "conversa-lid":
        cmd_conversa_lid(args[0])
    elif cmd == "promessas":
        cmd_promessas(args[0])
    elif cmd == "sql":
        cmd_sql(args[0])
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
