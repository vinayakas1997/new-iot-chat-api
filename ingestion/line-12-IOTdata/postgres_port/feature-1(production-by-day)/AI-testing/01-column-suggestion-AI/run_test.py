#!/usr/bin/env python3
"""Column-suggestion AI test — replicates the app's llm-fill prompt faithfully.

What it does:
1. Reads REAL columns + 5 sample rows from line12_august staging tables in
   test-postgres (same inputs the app's driverFor().describeTable/sampleRows give).
2. Builds the EXACT llm-fill prompt from backend/src/routes/lines.ts
   (system + user strings copied verbatim).
3. Sends it to the local LLM (atlas qwen36-35B, OpenAI-compatible :8009).
4. Scores drafts against gold-meanings.md rubric (key cols double weight).
5. Writes results.json (raw) + report.md (scored).

Run: python3 run_test.py   (needs docker access + localhost:8009)
"""
import json
import re
import subprocess
import sys
import urllib.request

HERE = __file__.rsplit("/", 1)[0]
LLM_URL = "http://localhost:8009/v1/chat/completions"
MODEL = "qwen36-35B"

TABLES = ["stg_ryohin", "stg_seisan_jisseki", "stg_ijo"]

# ---- scoring rubric: column -> (weight, [required keywords, EN or JA]) ----
RUBRIC = {
    # KEY columns (weight 2)
    "stg_ryohin.jikanbetsu_seisan": (2, ["hour", "時間別", "per-hour", "per hour", "slot"]),
    "stg_ryohin.seisan_su": (2, ["cumul", "running total", "累計", "累積", "accumulat"]),
    "stg_ryohin.insert_timing": (2, ["check", "時間チェック", "hour_check", "checkpoint", "exclud", "除外", "kind", "type of"]),
    "stg_ryohin.kishu_no": (2, ["model", "機種", "rework", "(再)", "variant", "machine model", "product type"]),
    "stg_ryohin.se_no": (2, ["back", "背番号", "product name", "name", "number"]),
    "stg_ryohin.ct": (2, ["cycle", "ct", "second", "秒", "takt"]),
    "stg_ryohin.kinmu_hidukejiku": (2, ["shift", "勤務", "work date", "section day", "operating date"]),
    "stg_ryohin.chuyakin": (2, ["shift", "昼勤", "夜勤", "day", "night", "day/night", "day-night"]),
    "stg_ryohin.seisan_jikantai": (2, ["bucket", "slot", "時間帯", "hour", "time period", "time slot", "window"]),
    "stg_seisan_jisseki.jisseki_code": (2, ["code", "コード", "event", "actual", "実績"]),
    # others (weight 1) — plausible domain meaning suffices
    "stg_ryohin.setsubi_unit": (1, ["unit", "equipment", "設備", "line", "machine"]),
    "stg_ryohin.setsubi_kiban": (1, ["machine", "設備", "kiban", "unit", "equipment", "no", "号機"]),
    "stg_ryohin.hiduke": (1, ["date", "time", "日付", "timestamp", "when"]),
    "stg_ryohin.jikan_taisei": (1, ["system", "体制", "regime", "shift system", "time system", "通常"]),
    "stg_ryohin.jikanbetsu_mokuhyo": (1, ["target", "目標", "goal", "plan"]),
    "stg_ryohin.mokuhyo": (1, ["target", "目標", "goal", "plan"]),
    "stg_seisan_jisseki.hiduke": (1, ["date", "time", "日付", "timestamp", "when"]),
    "stg_seisan_jisseki.setsubi_unit": (1, ["unit", "equipment", "設備", "line", "machine"]),
    "stg_seisan_jisseki.setsubi_kiban": (1, ["machine", "設備", "kiban", "unit", "equipment", "no", "号機"]),
    "stg_seisan_jisseki.kinmu_hidukejiku": (1, ["shift", "勤務", "date", "day"]),
    "stg_seisan_jisseki.chuyakin": (1, ["shift", "昼勤", "夜勤", "day", "night"]),
    "stg_seisan_jisseki.seisan_jikantai": (1, ["bucket", "slot", "時間帯", "hour", "time", "window"]),
    "stg_seisan_jisseki.jikan_taisei": (1, ["system", "体制", "regime", "time system", "通常"]),
    "stg_seisan_jisseki.sagyosha": (1, ["operator", "作業者", "worker", "person", "who"]),
    "stg_seisan_jisseki.jisseki_naiyo": (1, ["description", "内容", "detail", "event", "text", "what"]),
    "stg_seisan_jisseki.on_off": (1, ["on/off", "on-off", "flag", "status", "switch", "state"]),
    "stg_seisan_jisseki.jisseki_jikan": (1, ["duration", "time", "時間", "second", "long", "length"]),
    "stg_ijo.hiduke": (1, ["date", "time", "日付", "timestamp", "when"]),
    "stg_ijo.kinmu_hidukejiku": (1, ["shift", "勤務", "date", "day"]),
    "stg_ijo.chuyakin": (1, ["shift", "昼勤", "夜勤", "day", "night"]),
    "stg_ijo.unit_code": (1, ["unit", "equipment", "設備", "line", "code", "machine"]),
    "stg_ijo.kotei_junban": (1, ["process", "工程", "order", "sequence", "順番", "step"]),
    "stg_ijo.kiban": (1, ["machine", "機番", "unit", "equipment", "no"]),
    "stg_ijo.jikantai": (1, ["bucket", "slot", "時間帯", "hour", "time", "window"]),
    "stg_ijo.sagyosha": (1, ["operator", "作業者", "worker", "person", "who"]),
    "stg_ijo.unten_mode": (1, ["mode", "運転", "auto", "manual", "operation", "自動", "手動"]),
    "stg_ijo.ijo_shurui": (1, ["type", "種類", "kind", "abnormal", "error type", "alarm", "warning", "category"]),
    "stg_ijo.ijo_no": (1, ["code", "number", "no", "番号", "error", "id"]),
    "stg_ijo.ijo_naiyo": (1, ["description", "内容", "detail", "text", "message", "what", "content"]),
    "stg_ijo.on_off": (1, ["on/off", "on-off", "flag", "status", "switch", "state"]),
    "stg_ijo.kidouji_teishi_s": (1, ["startup", "起動", "stop", "second", "停止", "time", "duration"]),
    "stg_ijo.untenchu_teishi_s": (1, ["running", "運転中", "stop", "second", "停止", "time", "operation", "duration"]),
}
for i in range(1, 9):
    RUBRIC[f"stg_ijo.work_no_st{i}"] = (1, ["work", "workpiece", "ワーク", "number", "station", "st", "no", "part"])
    RUBRIC[f"stg_ijo.serial_st{i}"] = (1, ["serial", "シリアル", "number", "station", "st", "no", "id", "identifier"])


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "app-test-postgres-1", "psql", "-U", "plant", "-d", "plant",
         "-At", "-F", "\x1f", "-c", sql],
        capture_output=True, text=True, check=True)
    return out.stdout.strip().split("\n") if out.stdout.strip() else []


def table_columns(table):
    rows = psql(f"SELECT column_name FROM information_schema.columns "
                f"WHERE table_schema='line12_august' AND table_name='{table}' ORDER BY ordinal_position;")
    return rows


def sample_rows(table, cols, n=5):
    collist = ", ".join(f'"{c}"' for c in cols)
    rows = psql(f'SELECT {collist} FROM line12_august."{table}" LIMIT {n};')
    out = []
    for r in rows:
        parts = r.split("\x1f")
        parts += [""] * (len(cols) - len(parts))  # pad ragged rows
        out.append(parts[:len(cols)])
    return out


def build_prompt(table, cols, samples):
    # EXACT user-string shape from routes/lines.ts llm-fill (types are TEXT here)
    lines = []
    for c in cols:
        vals = [r[cols.index(c)] for r in samples if r[cols.index(c)]]
        vals = [v for v in vals if v][:3]
        lines.append(f"{c} (text): {', '.join(vals) if vals else '—'}")
    sample_text = "\n".join(lines)
    system = "You label database columns. Reply with JSON only, no prose, no fences."
    user = (f"Table: line12_august.{table}\nFill meanings for these columns:\n"
            f"{sample_text}\n"
            f'Reply JSON array: [{{"name","meaning"}}]. One sentence per column, include units if apparent.')
    return system, user


def call_llm(system, user):
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "temperature": 0.1,
        "max_tokens": 2000,
    }).encode()
    req = urllib.request.Request(LLM_URL, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)["choices"][0]["message"]["content"]


def parse_json_array(text):
    m = re.search(r"\[.*\]", text, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    # fallback: JSON-lines, one {"name","meaning"} per line
    objs = []
    for line in text.split("\n"):
        line = line.strip().rstrip(",")
        if line.startswith("{") and '"name"' in line:
            try:
                objs.append(json.loads(line))
            except Exception:
                continue
    return objs or None


def score(table, drafts):
    by_name = {str(d.get("name", "")).lower(): str(d.get("meaning", "")) for d in drafts or []}
    rows, got, total = [], 0, 0
    for key, (w, kws) in RUBRIC.items():
        if not key.startswith(table + "."):
            continue
        col = key.split(".", 1)[1]
        meaning = by_name.get(col, "")
        hit = any(k.lower() in meaning.lower() for k in kws)
        total += w
        got += w if hit else 0
        rows.append({"column": col, "weight": w, "pass": hit, "meaning": meaning})
    return rows, got, total


def main():
    all_results, grand_got, grand_total = {}, 0, 0
    for table in TABLES:
        cols = table_columns(table)
        samples = sample_rows(table, cols)
        system, user = build_prompt(table, cols, samples)
        print(f"--- {table}: {len(cols)} cols, calling LLM ...", flush=True)
        try:
            raw = call_llm(system, user)
        except Exception as e:
            print(f"LLM call failed for {table}: {e}")
            all_results[table] = {"error": str(e), "prompt_user": user}
            continue
        drafts = parse_json_array(raw)
        rows, got, total = score(table, drafts or [])
        grand_got += got
        grand_total += total
        all_results[table] = {"prompt_user": user, "raw": raw, "drafts": drafts,
                              "scores": rows, "got": got, "total": total}
        print(f"    {table}: {got}/{total} = {got/total*100:.0f}%")
    all_results["_summary"] = {"got": grand_got, "total": grand_total,
                               "pct": round(grand_got / grand_total * 100, 1),
                               "pass": grand_got / grand_total >= 0.5,
                               "model": MODEL}
    with open(f"{HERE}/results.json", "w") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=1)
    # markdown report
    L = [f"# Column-suggestion AI test — report", "",
         f"Model: `{MODEL}` · Prompt: app's exact `llm-fill` strings · "
         f"**Score: {grand_got}/{grand_total} = {grand_got/grand_total*100:.0f}% "
         f"({'PASS ≥50%' if grand_got/grand_total >= 0.5 else 'FAIL <50%'})**", ""]
    for table in TABLES:
        r = all_results[table]
        L += [f"## {table} ({r.get('got',0)}/{r.get('total',0)})", ""]
        if "error" in r:
            L += [f"ERROR: {r['error']}", ""]
            continue
        L += ["| column | w | pass | AI meaning |", "|---|---|---|---|"]
        for s in r["scores"]:
            L += [f"| {s['column']} | {s['weight']} | {'✅' if s['pass'] else '❌'} | {s['meaning'][:120]} |"]
        L += [""]
    with open(f"{HERE}/report.md", "w") as f:
        f.write("\n".join(L))
    print(f"\nTOTAL: {grand_got}/{grand_total} = {grand_got/grand_total*100:.1f}% "
          f"{'PASS' if grand_got/grand_total >= 0.5 else 'FAIL'}")


if __name__ == "__main__":
    sys.exit(main())
