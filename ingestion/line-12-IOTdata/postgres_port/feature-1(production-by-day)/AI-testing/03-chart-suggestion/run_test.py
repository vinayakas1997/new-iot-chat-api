#!/usr/bin/env python3
"""Chart-suggestion test — replicates the app's recommendCore prompt faithfully.

Inputs (copied from routes/charts.ts):
- system = CHART_SYSTEM (vocab + histogram hint + semantics rules + JSON contract)
- user = "Feature: {name} (granularity hourly, unit pcs)." + Data: {columns, profile,
  sample_rows<=6} + AIM block (description/context/extractHint) + COLUMN MEANINGS + SQL
- sample rows = REAL qgn_daily_combined('2026-08-04','day') output (10 rows)

Two runs: BARE (no description/meanings/SQL) vs FULL (everything).
Expected ranking: line(時間当 over time) + area(累計) + table(FD split).
Scores each run /100. Run: python3 run_test.py
"""
import json
import re
import subprocess
import sys
import urllib.request

HERE = __file__.rsplit("/", 1)[0]
LLM_URL = "http://localhost:8009/v1/chat/completions"
MODEL = "qwen36-35B"
BASE = "/home/somic_cps/Vina/new-iot-chat-api"

NAME = "Line-12 hourly production"
DESC = ("Line-12 day-shift hourly good production. Live query over the 3 August tables — "
        "never stored, recomputed each run. Per time-slot (09:20–19:20): hourly output, "
        "running total, target, split into new builds FD03/FD32/FD31 and rework FD(再), "
        "plus net seconds. No 12:xx bucket (lunch 12:00–13:10). Rework 0 is normal.")
HINT = ("State new builds FD03/FD32/FD31 separately from rework FD(再); "
        "never sum new + rework. Rework 0 is normal.")
MEANINGS = [
    "line12_august.stg_ryohin.jikanbetsu_seisan [text]: hourly good qty for this slot, SUM this per time bucket",
    "line12_august.stg_ryohin.seisan_su [text]: running cumulative qty per model per day, display only, never SUM",
    "line12_august.stg_ryohin.kishu_no [text]: model no, 7/8/9 new builds, 27/28/29 rework",
]

SYSTEM = (
    "You recommend visualizations for plant sensor data. "
    "Chart vocabulary (pick only from these):\n"
    "- line: trend over a temporal X; one or more numeric Y. The DEFAULT for time series.\n"
    "- area: time-series volume/cumulative emphasis; numeric Y over temporal X. EXCLUSIVE with line: "
    "for the same X+Y return ONE of line/area, never both (they render near-identically). "
    "Prefer line unless the data is cumulative/counter-like.\n"
    "- bar: discrete magnitudes per bucket/category; numeric Y. Allowed on a temporal X as ONE "
    "bucketed alternative to the line (hourly/daily bars), and on categorical X for comparisons.\n"
    "- histogram: distribution of ONE numeric column (spread, outliers, modes). Set xColumn to the "
    "value column and yColumns to [same column]; the UI bins values automatically. No time axis.\n"
    "- table: many columns, non-numeric data, or exact values matter. Only when nothing numeric plots.\n"
    "Rules: X must be a real column; Y columns must be numeric (count-like strings coerce). "
    "Never invent columns. Never return the same X+Y twice with different line/area types. "
    "At most ONE bar alternative per X+Y. Prefer 2-3 distinct, complementary charts over 4 near-duplicates. "
    "Histogram guidance: suggest exactly one histogram when there is at least one numeric column "
    "with 10+ distinct values. Pick the most meaningful measure (e.g. temperature, count). "
    "rationale must say what spread/outliers it reveals; conditions must say \"when checking distribution\". "
    "SEMANTICS: use the AIM and COLUMN MEANINGS blocks to choose the measure column(s) and split "
    "dimensions. Every measure named in the AIM must appear in at least one candidate. Each rationale "
    "must cite the meaning it used. "
    "SELECTIVITY: not every column needs a chart. Ignore IDs, hashes, flags, and near-constant columns "
    "(distinct ~1) unless the AIM names them. "
    "VERBATIM COLUMNS: copy column names character-for-character from DATA columns. "
    "Output exactly one JSON object and stop: "
    '{"candidates":[{"chartType":"line|bar|area|histogram|table","xColumn":"...","yColumns":["..."],'
    '"title":"...","rationale":"...","conditions":"..."}]}. '
    "Rank best first, at most 4. Use the DATA PROFILE to ground each rationale. No prose before or after."
)


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "app-test-postgres-1", "psql", "-U", "plant", "-d", "plant",
         "-v", "ON_ERROR_STOP=1", "-At", "-F", "\x1f", "-c", sql],
        capture_output=True, text=True, check=True)
    return out.stdout.strip().split("\n") if out.stdout.strip() else []


def load_sample():
    cols = ["slot_ts", "勤務日付軸", "日付", "勤務体制", "時間帯", "時間当", "累計",
            "目標数", "FD03[7]", "FD32[8]", "FD31[9]",
            "FD03(再)[27]", "FD32(再)[28]", "FD31(再)[29]", "正味時間秒"]
    rows = psql("SELECT " + ", ".join(f'"{c}"' for c in cols) +
                " FROM line12_august.qgn_daily_combined(DATE '2026-08-04', '昼勤');")
    recs = [dict(zip(cols, r.split("\x1f"))) for r in rows]
    # simplified data profile: numeric stats + time span (mirrors buildDataProfile)
    nums = ["時間当", "累計", "FD03[7]", "FD32[8]", "FD31[9]",
            "FD03(再)[27]", "FD32(再)[28]", "FD31(再)[29]", "正味時間秒", "目標数"]
    stats = {}
    for c in nums:
        vs = [float(r[c]) for r in recs]
        stats[c] = {"min": min(vs), "max": max(vs), "avg": round(sum(vs) / len(vs), 1),
                    "n": len(vs), "distinct": len(set(vs))}
    profile = {"row_count": len(recs), "time_span": {"column": "slot_ts",
               "min": recs[0]["slot_ts"], "max": recs[-1]["slot_ts"]},
               "numeric_stats": stats}
    return cols, recs, profile


def build_user(full, cols, recs, profile):
    data = json.dumps({"columns": cols, "profile": profile,
                       "sample_rows": recs[:6]}, ensure_ascii=False, indent=1)
    if not full:
        return f'Feature: {NAME} (granularity hourly, unit "pcs").\nData:\n{data}'
    with open(f"{BASE}/ingestion/line-12-IOTdata/postgres_port/"
              "feature-1(production-by-day)/01_combined.sql") as f:
        sql = f.read()
    sem = ("AIM:\n- description: " + DESC + "\n- context: (none)\n- extractHint: " + HINT +
           "\n\nCOLUMN MEANINGS:\n" + "\n".join("- " + m for m in MEANINGS) +
           "\n\nSQL (maps raw columns to output columns):\n" + sql[:3000])
    return (f'Feature: {NAME} (granularity hourly, unit "pcs").\nData:\n{data}\n\n{sem}')


def call_llm(user):
    body = json.dumps({"model": MODEL,
                       "messages": [{"role": "system", "content": SYSTEM},
                                    {"role": "user", "content": user}],
                       "temperature": 0.1, "max_tokens": 2500}).encode()
    req = urllib.request.Request(LLM_URL, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)["choices"][0]["message"]["content"]


def parse_cands(text):
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return []
    try:
        o = json.loads(m.group(0))
        c = o.get("candidates", o if isinstance(o, list) else [])
        return c if isinstance(c, list) else []
    except Exception:
        return []


TEMPORAL = {"slot_ts", "日付", "勤務日付軸", "時間帯"}


def score(cands, cols):
    """100 pts: line-temporal 30, area-cumulative 20, table 20, FD split 15, verbatim 15."""
    colset = set(cols)
    s, d = {}, {}
    line = [c for c in cands if c.get("chartType") == "line"
            and c.get("xColumn") in TEMPORAL]
    d["line"] = 30 if line else 0
    area = [c for c in cands if c.get("chartType") == "area"
            and "累計" in (c.get("yColumns") or [])]
    d["area_cume"] = 20 if area else (10 if [c for c in cands if c.get("chartType") == "area"] else 0)
    table = [c for c in cands if c.get("chartType") == "table"]
    d["table"] = 20 if table else 0
    fd_cols = {"FD03[7]", "FD32[8]", "FD31[9]", "FD03(再)[27]", "FD32(再)[28]", "FD31(再)[29]"}
    covered = set()
    for c in cands:
        for y in (c.get("yColumns") or []) + [c.get("xColumn")]:
            if y in fd_cols:
                covered.add(y)
    d["fd_split"] = 15 if len(covered) >= 4 else (8 if covered else 0)
    invented = [y for c in cands for y in (c.get("yColumns") or []) + [c.get("xColumn")]
                if y and y not in colset]
    d["verbatim"] = 0 if invented else 15
    s.update(d)
    s["total"] = sum(d.values())
    s["detail"] = {"n": len(cands), "types": [c.get("chartType") for c in cands],
                   "fd_covered": sorted(covered), "invented": invented}
    return s


def main():
    cols, recs, profile = load_sample()
    print(f"sample: {len(recs)} rows, {len(cols)} cols")
    out = {}
    for tag, full in [("BARE", False), ("FULL", True)]:
        user = build_user(full, cols, recs, profile)
        print(f"--- {tag}: prompt {len(user)} chars, calling LLM ...", flush=True)
        try:
            raw = call_llm(user)
        except Exception as e:
            out[tag] = {"error": str(e)}
            print(f"    failed: {e}")
            continue
        cands = parse_cands(raw)
        sc = score(cands, cols)
        out[tag] = {"candidates": cands, "score": sc, "raw": raw,
                    "prompt_chars": len(user)}
        print(f"    {tag}: {sc['total']}/100 {sc['detail']}")
    with open(f"{HERE}/results.json", "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    L = ["# Chart-suggestion test — report", "",
         f"Model: `{MODEL}` · Sample: 10 real feature-1 rows (2026-08-04 昼勤) · "
         "Expected: line(時間当) + area(累計) + table(FD split)", ""]
    for tag in ["BARE", "FULL"]:
        r = out[tag]
        L += [f"## {tag}"]
        if "error" in r and "score" not in r:
            L += [f"ERROR: {r['error']}", ""]
            continue
        L += [f"Score: **{r['score']['total']}/100** {r['score']['detail']}", ""]
        for c in r["candidates"]:
            L += [f"- **{c.get('chartType')}** x=`{c.get('xColumn')}` "
                  f"y=`{c.get('yColumns')}` — {c.get('title','')[:80]}",
                  f"  rationale: {(c.get('rationale') or '')[:200]}"]
        L += [""]
    with open(f"{HERE}/report.md", "w") as f:
        f.write("\n".join(L))
    print("done.")


if __name__ == "__main__":
    sys.exit(main())
