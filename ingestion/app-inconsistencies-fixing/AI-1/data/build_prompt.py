"""Assemble prompt.md for each day/<date>/ and month/ from:
  ../prompt-variables.md Section 4 (SYSTEM, frozen wording)
  + result.csv + context.md (per-call USER).

Usage: python3 build_prompt.py   (run from AI-1/data/)
"""
import csv, json, os, re

DATA = os.path.dirname(os.path.abspath(__file__))
PV = os.path.join(DATA, "..", "prompt-variables.md")
PROMPT_VERSION = "chart-v2"


def load_section4():
    with open(PV) as f:
        text = f.read()
    m = re.search(r"## Section 4.*?### SYSTEM\n(.*?)### USER\n(.*?)(?=\n## |\Z)",
                  text, re.S)
    system_raw, user_raw = m.group(1), m.group(2)
    blocks = re.findall(r"- `(\w+)`:(.*?)(?=\n- `\w+`:|\Z)", system_raw, re.S)
    system = [(name, val.strip().strip('"')) for name, val in blocks]
    return system, user_raw.strip()


def profile_json(csv_path, kind):
    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    if kind == "day":
        num_cols = ["時間当", "累計", "目標数", "FD03[7]", "FD32[8]",
                    "FD31[9]", "FD03(再)[27]", "FD32(再)[28]",
                    "FD31(再)[29]", "正味時間秒"]
        x, grain, unit = "時間帯", "hourly", "pcs"
    else:
        num_cols = ["day_total", "new_total", "rework_total",
                    "net_sec_total", "target_total"]
        x, grain, unit = "日付", "daily", "pcs"
    prof = {"rows": len(rows), "granularity": grain, "unit": unit,
            "threshold": "none", "numeric_stats": {}}
    for c in num_cols:
        vals = [int(r[c]) for r in rows if r[c] not in ("", None)]
        st = {"min": min(vals), "max": max(vals), "n": len(vals),
              "distinct": len(set(vals))}
        st["avg"] = round(sum(vals) / len(vals), 1)
        prof["numeric_stats"][c] = st
    xs = [r[x] for r in rows]
    prof["time_span"] = {"column": x, "min": min(xs), "max": max(xs),
                         "distinct": len(set(xs))}
    FULL_ROWS_MAX = 50  # <=50 rows: full table inline; above: 6 samples + note
    keep = [x] + num_cols
    if len(rows) <= FULL_ROWS_MAX:
        sample = [{k: (int(v) if k in num_cols else v)
                   for k, v in r.items() if k in keep} for r in rows]
        rows_line = "full_rows (all %d — bind every date/identifier from here):" % len(rows)
        overflow_note = None
    else:
        sample = [{k: (int(v) if k in num_cols else v)
                   for k, v in r.items() if k in keep} for r in rows[:6]]
        rows_line = ("sample_rows (first 6 of %d — more rows exist):" % len(rows))
        overflow_note = ("NOTE: rows beyond these 6 samples are image-only — "
                         "use them for shape, never attach dates or identifiers "
                         "to values outside the sample; state value-without-date "
                         "instead of guessing.")
    cols = [c for c in rows[0].keys()
            if c in ([x] + num_cols + ["slot_rows"])]
    return {"columns": cols, "profile": prof}, sample, rows_line, overflow_note


def aim_block(kind, label):
    if kind == "day":
        return ("- description: Line-12 day-shift (昼勤) good production for "
                "%s. Per time-slot: hourly output, running total, target, new "
                "builds FD03/FD32/FD31 + rework FD(再), net seconds. No 12:xx "
                "bucket (lunch 12:00-13:10).\n"
                "- context: hourly good production rollup\n"
                "- extractHint: hourly pcs per slot | new vs rework split | "
                "omit 12:xx | full hourly rows, never collapse to best/total "
                "only" % label)
    return ("- description: Line-12 day-shift (昼勤) good production, August "
            "2026 month aggregate. Per shift-day: day total, new-build sum, "
            "rework sum, net seconds, target. Zero-days (Obon, weekends) kept "
            "visible.\n"
            "- context: daily good production rollup\n"
            "- extractHint: daily pcs per shift-day | new vs rework split | "
            "keep zero-days visible | full daily rows, never collapse to "
            "best/total only")


def chart_refs(kind):
    if kind == "day":
        return ["Chart 1 (trend): line, X=時間帯, Y=時間当",
                "Chart 2 (split): bar, X=時間帯, "
                "Y=FD03[7], FD32[8], FD31[9], "
                "FD03(再)[27], FD32(再)[28], FD31(再)[29]"]
    return ["Chart 1 (trend): line, X=日付, Y=day_total",
            "Chart 2 (split): bar, X=日付, Y=new_total, rework_total"]


def build(folder, kind, label):
    system, _ = load_section4()
    names = [n for n, _ in system]
    assert "recap_line" in names, "Section 4 missing recap_line"
    out = ["# prompt — %s (version %s)" % (label, PROMPT_VERSION), "",
           "## SYSTEM", ""]
    for name, val in system:
        out.append("%s: %s" % (name.upper(), val))
        out.append("")
    data, sample, rows_line, overflow_note = profile_json(os.path.join(folder, "result.csv"), kind)
    grain = data["profile"]["granularity"]
    out.append("PROMPT_VERSION: %s" % PROMPT_VERSION)
    out += ["", "## USER", "",
            "Feature: Line-12 昼勤 production (granularity %s, unit \"pcs\")."
            % grain,
            "Charts (image parts, see charts/base-trend.png + "
            "charts/base-split.png):"]
    out += chart_refs(kind)
    out += ["Data:",
            json.dumps(data, ensure_ascii=False),
            rows_line,
            json.dumps(sample, ensure_ascii=False)]
    if overflow_note:
        out += [overflow_note]
    out += ["", "AIM:", aim_block(kind, label), ""]
    with open(os.path.join(folder, "prompt.md"), "w") as f:
        f.write("\n".join(out))
    return len(sample)


def main():
    system, _ = load_section4()
    print("SYSTEM blocks from Section 4: %s" % [n for n, _ in system])
    day_root = os.path.join(DATA, "day")
    for date in sorted(os.listdir(day_root)):
        folder = os.path.join(day_root, date)
        if os.path.isfile(os.path.join(folder, "result.csv")):
            n = build(folder, "day", "%s 昼勤" % date)
            print("prompt: day/%s (%d sample rows)" % (date, n))
    n = build(os.path.join(DATA, "month"), "month", "August 昼勤 aggregate")
    print("prompt: month (%d sample rows)" % n)


if __name__ == "__main__":
    main()
