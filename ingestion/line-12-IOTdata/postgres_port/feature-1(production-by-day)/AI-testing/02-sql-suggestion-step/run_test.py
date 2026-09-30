#!/usr/bin/env python3
"""SQL-suggestion test — replicates the app's suggest-sql prompt faithfully.

4 levels (L0 empty → L3 description+meanings+steer, see levels.md).
Same model, same tables. Each drafted SQL is EXECUTED on Postgres
(window 2026-08-04 day) and compared result-vs-result against gold.sql.
Thinking points scored separately for the 4 key decisions.

Run: python3 run_test.py
"""
import json
import re
import subprocess
import sys
import urllib.request

HERE = __file__.rsplit("/", 1)[0]
LLM_URL = "http://localhost:8009/v1/chat/completions"
MODEL = "qwen36-35B"
FROM, TO = "2026-08-04 00:00:00", "2026-08-05 00:00:00"

NAME = "Line-12 hourly production"
DESC_L1 = "Day-shift hourly good production per time slot."
DESC_L2 = ("Line-12 day-shift hourly good production. Live query over the 3 August tables — "
           "never stored, recomputed each run. Per time-slot (09:20–19:20): hourly output, "
           "running total, target, split into new builds FD03/FD32/FD31 and rework FD(再), "
           "plus net seconds. No 12:xx bucket (lunch 12:00–13:10). Rework 0 is normal.")
MEANINGS_L3 = {
    "jikanbetsu_seisan": "hourly good qty for this slot, SUM this per time bucket",
    "seisan_su": "running cumulative qty per model per day, display only, never SUM",
    "insert_timing": "row kind, 時間チェック = hourly checkpoint USE these, 直始め/生産数リセット = exclude",
    "kishu_no": "model no, 7/8/9 = FD03/FD32/FD31 new builds, 27/28/29 = rework (再)",
    "se_no": "back/product name, *** = dummy",
    "ct": "cycle time seconds, net = qty x CT",
    "kinmu_hidukejiku": "shift-day date, night 00-11h belongs to prior shift-day",
    "chuyakin": "day/night shift flag 昼勤/夜勤",
    "seisan_jikantai": "hourly bucket, no 12:xx = lunch",
}
STEER_L3 = ("FD03/FD32/FD31 (work_no 7/8/9) are first-time builds; FD(再) (27/28/29) are rework — "
            "always state separately, never sum. Rework 0 is normal. No 12:xx bucket exists "
            "(lunch 12:00–13:10); 13:10 is post-lunch, not late. Day shift (昼勤) only.")

RYOHIN_COLS = ["kinmu_hidukejiku", "setsubi_unit", "setsubi_kiban", "hiduke", "chuyakin",
               "seisan_jikantai", "jikan_taisei", "jikanbetsu_mokuhyo", "mokuhyo", "kishu_no",
               "se_no", "jikanbetsu_seisan", "seisan_su", "ct", "insert_timing"]

THINK_KEYS = {
    "qty_col": ["jikanbetsu", "時間別", "hourly qty", "hourly count", "per-hour", "per hour", "work_qty"],
    "filter": ["時間チェック", "hour_check", "checkpoint", "exclud", "除外", "直始め", "reset"],
    "split": ["rework", "(再)", "27", "28", "29", "7/8/9", "new", "split"],
    "cumulative": ["cumul", "running", "累計", "累積", "window", "over ("],
}


def col_text(meanings):
    parts = [f"{c} (text){': ' + meanings[c] if c in meanings else ''}" for c in RYOHIN_COLS]
    return "line12_august.stg_ryohin: " + "; ".join(parts)


def build_prompt(level):
    desc = {0: "", 1: DESC_L1, 2: DESC_L2, 3: DESC_L2}[level]
    meanings = MEANINGS_L3 if level == 3 else {}
    steer = STEER_L3 if level == 3 else ""
    system = ('You write read-only plant analytics SQL (Postgres and SQLite compatible). '
              'Reply with JSON only: {"sql":"…"}, no prose, no fences.')
    user = "\n".join([s for s in [
        f"Feature: {NAME}" + (f" — {desc}" if desc else ""),
        "Cadence: hourly (streams: hourly) · Unit: pcs",
        f"Line tables + columns + meanings:\n{col_text(meanings)}",
        f"Setter notes (ground truth — obey over inference): {steer}" if steer else "",
        ("Rules: SELECT-only single statement; MUST filter ts with '{{from}}' AND '{{to}}' "
         "placeholders (literal, quoted, upper bound EXCLUSIVE: ts < '{{to}}'); GROUP BY the time "
         "bucket for the cadence (hourly → date_trunc('hour', ts)); alias every output column "
         "(no bare ts/value); AVG for gauges, SUM for counters; one row per time bucket out."),
        ("Cross-table rule: if the requested measures live in different tables, JOIN them — never "
         "silently drop a measure. Join on the time bucket (date_trunc('hour', a.ts) = "
         "date_trunc('hour', b.ts)), LEFT JOIN from the primary measure table so missing secondary "
         "rows give NULLs, never dropped hours. JOINs only within the listed tables."),
        ('Also explain the draft as short summary points: "thinking": 3-6 points, one per decision — '
         "why this table set/JOIN, why these aggregates, how each rule above is met, and what could "
         "still be wrong (fan-out risk, grain doubts). Short clauses, no prose."),
    ] if s])
    return system, user


def call_llm(system, user):
    body = json.dumps({"model": MODEL,
                       "messages": [{"role": "system", "content": system},
                                    {"role": "user", "content": user}],
                       "temperature": 0.1, "max_tokens": 2500}).encode()
    req = urllib.request.Request(LLM_URL, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)["choices"][0]["message"]["content"]


def parse_result(text):
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None, []
    try:
        o = json.loads(m.group(0))
        sql = o.get("sql", "")
        thinking = o.get("thinking", []) or []
        if isinstance(thinking, str):
            thinking = [thinking]
        return sql, thinking
    except Exception:
        return None, []


def run_sql(sql):
    """Substitute window, readonly-guard, execute. Returns (ok, cols, rows, err)."""
    q = sql.replace("{{from}}", FROM).replace("{{to}}", TO)
    head = q.strip().lstrip("(").upper()
    if not (head.startswith("SELECT") or head.startswith("WITH")):
        return False, [], [], "not a SELECT/WITH"
    if re.search(r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|COPY|GRANT)\b", q, re.I):
        return False, [], [], "not read-only"
    with open("/tmp/opencode/line12/ai_run.sql", "w") as f:
        f.write(q)
    subprocess.run(["docker", "cp", "/tmp/opencode/line12/ai_run.sql",
                    "app-test-postgres-1:/tmp/ai_run.sql"], check=True)
    p = subprocess.run(["docker", "exec", "app-test-postgres-1", "psql", "-U", "plant",
                        "-d", "plant", "-v", "ON_ERROR_STOP=1",
                        "-At", "-F", "\x1f", "-f", "/tmp/ai_run.sql"],
                       capture_output=True, text=True)
    if p.returncode != 0:
        err_lines = [l for l in p.stderr.strip().split("\n") if l.startswith("ERROR")]
        return False, [], [], (err_lines[-1] if err_lines else p.stderr.strip())[:300]
    rows = [r.split("\x1f") for r in p.stdout.strip().split("\n") if r.strip()]
    if not rows:
        return True, [], [], "ok-but-zero-rows"
    return True, [], rows, ""


def gold_rows():
    with open(f"{HERE}/gold.sql") as f:
        g = f.read().replace("{{from}}", FROM).replace("{{to}}", TO)
    with open("/tmp/opencode/line12/gold_cmp.sql", "w") as f:
        f.write(g)
    subprocess.run(["docker", "cp", "/tmp/opencode/line12/gold_cmp.sql",
                    "app-test-postgres-1:/tmp/gold_cmp.sql"], check=True)
    p = subprocess.run(["docker", "exec", "app-test-postgres-1", "psql", "-U", "plant",
                        "-d", "plant", "-At", "-F", "\x1f", "-f", "/tmp/gold_cmp.sql"],
                       capture_output=True, text=True, check=True)
    return [r.split("\x1f") for r in p.stdout.strip().split("\n") if r.strip()]


def score_result(ok, rows, gold, err):
    """100-pt rubric from levels.md. Compares hourly numbers + FD presence."""
    s = {"exec_ok": ok, "error": err, "breakdown": {}}
    if not ok:
        s["total"] = 0
        return s
    b = s["breakdown"]
    gold_slots = [r[0] for r in gold]
    ai_slots = [r[0] for r in rows if r]
    b["rows_10"] = 10 if len(rows) == 10 else 0
    b["slots_match"] = 10 if ai_slots == gold_slots else 0
    # hourly: find best numeric column per row by matching gold hourly (gold col idx 1)
    gh = {r[0]: r[1] for r in gold}
    hits = 0
    for r in rows:
        if r and r[0] in gh and gh[r[0]] in r[1:]:
            hits += 1
    b["hourly"] = hits * 3
    # FD split: any fd/rework-ish numeric columns with correct total split?
    gfd = {r[0]: r[4:10] for r in gold}
    all_text = " ".join(r[0] if False else "" for r in rows)
    fd_present = 0
    for r in rows:
        if r and r[0] in gfd:
            # count gold fd values appearing anywhere in the ai row
            if sum(1 for v in gfd[r[0]] if v in r[1:]) >= 3:
                fd_present += 1
    b["fd_present"] = 10 if fd_present >= 5 else 0
    b["fd_correct"] = 10 if fd_present == 10 else 0
    # filter: total of hourly == 1061 and no extra rows
    try:
        tot = sum(int(r[1]) for r in gold)
    except Exception:
        tot = 1061
    ai_tot = None
    for r in rows:
        if r and r[0] in gh:
            pass
    # approximate: sum of matched hourly values
    s_sum = sum(int(gh[r[0]]) for r in rows if r and r[0] in gh and gh[r[0]] in r[1:])
    b["filter"] = 10 if (s_sum == tot and len(rows) == 10) else 0
    # cumulative present: any value matching gold cumulative (col idx 2)
    gc = {r[0]: r[2] for r in gold}
    chits = sum(1 for r in rows if r and r[0] in gc and gc[r[0]] in r[1:])
    b["cumulative"] = 10 if chits >= 8 else 0
    s["total"] = sum(b.values())
    s["detail"] = {"row_count": len(rows), "hourly_hits": hits, "fd_rows": fd_present,
                   "cume_hits": chits}
    return s


def score_thinking(thinking):
    text = " ".join(thinking).lower()
    hits = {k: any(t.lower() in text for t in v) for k, v in THINK_KEYS.items()}
    return hits, sum(hits.values()) / len(hits) * 100


def main():
    gold = gold_rows()
    print(f"gold: {len(gold)} rows")
    out = {}
    for level in [0, 1, 2, 3]:
        system, user = build_prompt(level)
        print(f"--- L{level}: calling LLM ...", flush=True)
        try:
            raw = call_llm(system, user)
        except Exception as e:
            out[f"L{level}"] = {"error": str(e)}
            print(f"    LLM failed: {e}")
            continue
        sql, thinking = parse_result(raw)
        if sql:
            ok, _, rows, err = run_sql(sql)
            res = score_result(ok, rows, gold, err)
        else:
            res = {"exec_ok": False, "error": "no SQL parsed", "total": 0, "breakdown": {}}
        th, tpct = score_thinking(thinking)
        out[f"L{level}"] = {"sql": sql, "thinking": thinking, "result": res,
                            "think_hits": th, "think_pct": round(tpct, 1)}
        print(f"    result={res.get('total')}/100 think={tpct:.0f}% "
              f"{res.get('detail', res.get('error'))}")
    with open(f"{HERE}/results.json", "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    L = ["# SQL-suggestion test — report", "",
         f"Model: `{MODEL}` · Window: 2026-08-04 day · Gold: 10 rows, total 1061", ""]
    for level in [0, 1, 2, 3]:
        r = out[f"L{level}"]
        L += [f"## L{level}"]
        if "error" in r and "sql" not in r:
            L += [f"ERROR: {r['error']}", ""]
            continue
        L += [f"Result: **{r['result'].get('total')}/100** {r['result'].get('detail', r['result'].get('error'))}",
              f"Thinking-match: **{r['think_pct']:.0f}%** {r['think_hits']}", ""]
        for t in r["thinking"]:
            L += [f"- {t[:200]}"]
        L += ["", f"```sql\n{(r['sql'] or '')[:1500]}\n```", ""]
    with open(f"{HERE}/report.md", "w") as f:
        f.write("\n".join(L))
    print("done.")


if __name__ == "__main__":
    sys.exit(main())
