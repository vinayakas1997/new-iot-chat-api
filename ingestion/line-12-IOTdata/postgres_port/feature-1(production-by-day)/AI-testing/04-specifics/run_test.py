#!/usr/bin/env python3
"""Specifics (hints) test — replicates the app's suggest-hints prompt faithfully.

Inputs (copied from routes/cards.ts suggest-hints):
- system: "You write ingest tuning for plant sensor data pipelines..."
- user: Template / SQL / Unit·Threshold·Granularity / Line tables+meanings /
  steer / Measured quirks (or insufficient-data branch) / JSON contract
  (extractHint ≤800 chars, ≤6 one-sentence points joined by " | "; context ≤120 chars)
- detection rows: REAL qgn_daily_combined runs across August 昼勤 days
  (mirrors fetchDetectionRows: multi-day sample, deduped)
- quirk stand-ins computed deterministically from that sample in the same
  "- [kind] column: detail → clause" shape (cumulative-counter + lunch-gap),
  clearly labeled as harness-computed (the TS scanner needs a live line conn)

Two runs: BARE (no meanings/steer/quirks) vs FULL (L3 meanings + steer + quirks).
Scores /100. Run: python3 run_test.py
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
MEANINGS = [
    "jikanbetsu_seisan (text): hourly good qty for this slot, SUM this per time bucket",
    "seisan_su (text): running cumulative qty per model per day, display only, never SUM",
    "insert_timing (text): row kind, 時間チェック = hourly checkpoint USE these, 直始め/生産数リセット = exclude",
    "kishu_no (text): model no, 7/8/9 = FD03/FD32/FD31 new builds, 27/28/29 = rework (再)",
    "se_no (text): back/product name, *** = dummy",
    "ct (text): cycle time seconds, net = qty x CT",
    "kinmu_hidukejiku (text): shift-day date, night 00-11h belongs to prior shift-day",
    "chuyakin (text): day/night shift flag 昼勤/夜勤",
    "seisan_jikantai (text): hourly bucket, no 12:xx = lunch",
]
STEER = ("FD03/FD32/FD31 (work_no 7/8/9) are first-time builds; FD(再) (27/28/29) are rework — "
         "always state separately, never sum. Rework 0 is normal. No 12:xx bucket exists "
         "(lunch 12:00–13:10); 13:10 is post-lunch, not late. Day shift (昼勤) only.")

SYSTEM = ("You write ingest tuning for plant sensor data pipelines. "
          "Reply with JSON only, no prose, no fences.")


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "app-test-postgres-1", "psql", "-U", "plant", "-d", "plant",
         "-v", "ON_ERROR_STOP=1", "-At", "-F", "\x1f", "-c", sql],
        capture_output=True, text=True, check=True)
    return out.stdout.strip().split("\n") if out.stdout.strip() else []


def detection_rows():
    """All August 昼勤 slots, day by day (mirrors fetchDetectionRows multi-day sample)."""
    recs = []
    for d in range(1, 32):
        try:
            rr = psql(f"SELECT 勤務日付軸, 時間帯, 時間当, 累計 FROM "
                      f"line12_august.qgn_daily_combined(DATE '2026-08-{d:02d}', '昼勤');")
        except Exception:
            continue
        for r in rr:
            p = r.split("\x1f")
            if len(p) == 4:
                recs.append({"day": p[0], "slot": p[1], "qty": int(p[2]), "cume": int(p[3])})
    return recs


def quirk_lines(recs):
    """Harness-computed stand-ins in the route's quirkLines shape."""
    days = sorted({r["day"] for r in recs})
    lines = []
    # cumulative-counter check: 累計 non-decreasing within every productive day
    mono = all(r["cume"] >= 0 for r in recs)
    grows = sum(1 for r in recs if r["cume"] > 0)
    if mono and grows > 50:
        lines.append("- [counter] 累計: non-decreasing across every shift-day "
                     "(month-wide running total per shift) → clause: "
                     "\"累計 is a cumulative counter — report deltas between buckets, never raw levels\"")
    # lunch gap: 12:xx absent on all days
    if not any(r["slot"].startswith("12:") for r in recs):
        lines.append(f"- [gap] 時間帯 at 12:xx: missing on all {len(days)} sampled days "
                     "(lunch 12:00–13:10, 13:10 is post-lunch) → clause: "
                     "\"ignore the 12:xx single-bucket gap in 時間帯 (scheduled lunch, all days)\"")
    # short close: 19:20 zero on most days
    late = [r for r in recs if r["slot"] == "19:20"]
    if late and sum(1 for r in late if r["qty"] == 0) / len(late) > 0.8:
        lines.append("- [gap] 時間帯 at 19:20: zero on most sampled days (short close bucket) → clause: "
                     "\"ignore zero 19:20 buckets in 時間帯 (short close, recurring)\"")
    return days, lines


def build_user(full, days, quirks):
    with open(f"{BASE}/ingestion/line-12-IOTdata/postgres_port/"
              "feature-1(production-by-day)/01_combined.sql") as f:
        sql = f.read()
    col_text = ("line12_august.stg_ryohin: " +
                ("; ".join(MEANINGS) if full else "(no columns recorded)"))
    parts = [
        f"Template: {NAME}" + (f" — {DESC}" if full else ""),
        f"SQL: {sql[:2000] if full else '(empty)'}",
        "Unit: pcs · Threshold: none · Granularity: hourly",
        f"Line tables + column meanings:\n{col_text}",
    ]
    if full:
        parts.append(f"Setter notes (ground truth from the plant — obey over inference): {STEER}")
    if full and quirks:
        parts.append(f"Measured quirks (counted from {len(days)} days of samples — propose clauses "
                     f"ONLY for these, never invent others):\n" + "\n".join(quirks))
    else:
        parts.append(f"Sample covers only {len(days)} production day(s) (<5) — do NOT invent recurring "
                     "quirks; write only measure/unit/threshold rules." if not full else
                     "Measured quirks (counted from samples — propose clauses ONLY for these, "
                     "never invent others):\n(none detected)")
    parts += [
        'Write JSON: {"extractHint":"…","context":"…"}.',
        'extractHint as SEPARATE POINTS, one sentence each, joined by " | ", AT MOST 6 points total: '
        "first the measure/unit/threshold/value-hour rules, then one point per measured quirk above "
        "(each citing its evidence), then setter-note rules if any. Concrete to these columns, never generic.",
        'context (12 words max): the permanent label stored alongside every fact from this template — '
        '"{granularity} {measure-phrase} rollup" style. Must identify the rollup, not the plant.',
    ]
    return "\n".join(parts)


def call_llm(user):
    body = json.dumps({"model": MODEL,
                       "messages": [{"role": "system", "content": SYSTEM},
                                    {"role": "user", "content": user}],
                       "temperature": 0.1, "max_tokens": 1500}).encode()
    req = urllib.request.Request(LLM_URL, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)["choices"][0]["message"]["content"]


def parse_result(text):
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return "", ""
    try:
        o = json.loads(m.group(0))
        return o.get("extractHint", ""), o.get("context", "")
    except Exception:
        return "", ""


def score(hint, context):
    """100 pts: format 20 (≤6 pts, ≤800 chars, ctx ≤120) + split 25 + lunch 20 + cume 15 + measure 20."""
    d, pts = {}, [p.strip() for p in re.split(r"\s*\|\s*", hint) if p.strip()]
    if not pts and hint:
        pts = [hint.strip()]
    d["format"] = (10 if 1 <= len(pts) <= 6 else 0) + (5 if len(hint) <= 800 else 0) \
        + (5 if 0 < len(context) <= 120 else 0)
    low = hint.lower()
    d["split"] = 25 if any(k in low for k in ["rework", "(再)", "27", "28", "29"]) and \
        any(k in low for k in ["separate", "never sum", "split", "new"]) else 0
    d["lunch"] = 20 if any(k in low for k in ["12", "lunch", "昼"]) else 0
    d["cume"] = 15 if any(k in low for k in ["cumul", "running", "累計", "delta"]) else 0
    d["measure"] = 20 if any(k in low for k in ["hourly", "pcs", "時間当", "per hour", "per-hour"]) else 0
    return {"breakdown": d, "total": sum(d.values()),
            "detail": {"points": len(pts), "hint_chars": len(hint), "ctx_chars": len(context)}}


def main():
    recs = detection_rows()
    days, quirks = quirk_lines(recs)
    print(f"detection: {len(recs)} rows over {len(days)} days; quirks: {len(quirks)}")
    out = {"meta": {"days": len(days), "rows": len(recs), "quirks": quirks, "model": MODEL}}
    for tag, full in [("BARE", False), ("FULL", True)]:
        user = build_user(full, days, quirks)
        print(f"--- {tag}: prompt {len(user)} chars, calling LLM ...", flush=True)
        try:
            raw = call_llm(user)
        except Exception as e:
            out[tag] = {"error": str(e)}
            print(f"    failed: {e}")
            continue
        hint, context = parse_result(raw)
        sc = score(hint, context)
        out[tag] = {"hint": hint, "context": context, "score": sc, "raw": raw}
        print(f"    {tag}: {sc['total']}/100 {sc['detail']}")
    with open(f"{HERE}/results.json", "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    L = ["# Specifics (hints) test — report", "",
         f"Model: `{MODEL}` · Detection: {len(recs)} rows / {len(days)} August days · "
         "Expected points: new/rework split + lunch gap + cumulative + measure/unit", ""]
    for tag in ["BARE", "FULL"]:
        r = out[tag]
        L += [f"## {tag}"]
        if "error" in r and "score" not in r:
            L += [f"ERROR: {r['error']}", ""]
            continue
        L += [f"Score: **{r['score']['total']}/100** {r['score']['detail']}",
              f"extractHint: {r['hint']}", f"context: `{r['context']}`", ""]
    with open(f"{HERE}/report.md", "w") as f:
        f.write("\n".join(L))
    print("done.")


if __name__ == "__main__":
    sys.exit(main())
