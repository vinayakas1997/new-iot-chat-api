"""Build context.md for each day/<date>/ and month/ from its result.csv.

Usage: python3 build_context.py   (run from AI-1/data/)
Reads result.csv, computes the data profile from REAL values,
writes context.md using REAL column names (verbatim, Japanese).
"""
import csv, os, statistics

DATA = os.path.dirname(os.path.abspath(__file__))

MEANINGS_DAY = [
    ("時間帯", "plant hourly bucket label, e.g. 09:20 (temporal X)"),
    ("時間当", "hourly good qty in pcs — SUM this per bucket (trend measure)"),
    ("累計", "running total within the shift-day (cumulative emphasis)"),
    ("目標数", "hourly target (0 in August — never a trend baseline)"),
    ("FD03[7] / FD32[8] / FD31[9]", "new builds per model (discrete split)"),
    ("FD03(再)[27] / FD32(再)[28] / FD31(再)[29]", "rework per model (split)"),
    ("正味時間秒", "net seconds = qty x cycle time (effort view)"),
]

MEANINGS_MONTH = [
    ("日付", "shift-day date, e.g. 2026-08-04 (temporal X)"),
    ("day_total", "day 昼勤 total pcs = max(累計) (trend measure)"),
    ("new_total", "day new-build pcs summed over models (discrete split)"),
    ("rework_total", "day rework pcs summed over models (split)"),
    ("net_sec_total", "day net seconds summed (effort view)"),
    ("target_total", "day target (0 in August — never a trend baseline)"),
]


def stats(vals):
    nums = [v for v in vals if v is not None]
    if not nums:
        return {"n": 0}
    s = {"min": min(nums), "max": max(nums), "n": len(nums),
         "distinct": len(set(nums))}
    if len(nums) > 1:
        s["avg"] = round(statistics.mean(nums), 1)
    else:
        s["avg"] = nums[0]
    return s


def profile_day(rows):
    num_cols = ["時間当", "累計", "目標数", "FD03[7]", "FD32[8]", "FD31[9]",
                "FD03(再)[27]", "FD32(再)[28]", "FD31(再)[29]", "正味時間秒"]
    prof = {"rows": len(rows), "grain": "hourly", "unit": "pcs",
            "threshold": "none", "numeric_stats": {},
            "constant_columns": []}
    for c in num_cols:
        vals = [int(r[c]) for r in rows if r[c] not in ("", None)]
        st = stats(vals)
        prof["numeric_stats"][c] = st
        if st.get("distinct") == 1:
            prof["constant_columns"].append({c: st["min"]})
    slots = [r["時間帯"] for r in rows]
    prof["time_span"] = {"column": "時間帯", "min": min(slots),
                         "max": max(slots), "distinct": len(set(slots))}
    prof["gaps"] = ["12:xx — no bucket (lunch 12:00-13:10)"]
    return prof


def profile_month(rows):
    num_cols = ["day_total", "new_total", "rework_total", "net_sec_total",
                "target_total"]
    prof = {"rows": len(rows), "grain": "daily", "unit": "pcs",
            "threshold": "none", "numeric_stats": {},
            "constant_columns": []}
    for c in num_cols:
        vals = [int(r[c]) for r in rows if r[c] not in ("", None)]
        st = stats(vals)
        prof["numeric_stats"][c] = st
        if st.get("distinct") == 1:
            prof["constant_columns"].append({c: st["min"]})
    dates = [r["日付"] for r in rows]
    prof["time_span"] = {"column": "日付", "min": min(dates),
                         "max": max(dates), "distinct": len(set(dates))}
    zero_days = [r["日付"] for r in rows if int(r["day_total"]) == 0]
    prof["gaps"] = ["zero-production days: " + ",".join(zero_days)]
    return prof


def write_context(folder, kind, label, prof, meanings, sample):
    lines = ["# Context — %s" % label, ""]
    lines.append("AIM: Line-12 day-shift (昼勤) good production. " +
                 ("Per time-slot (hourly grain): hourly output, running total, "
                  "target, new builds FD03/FD32/FD31 + rework FD(再), net seconds."
                  if kind == "day" else
                  "Per shift-day (daily grain): day total, new-build sum, "
                  "rework sum, net seconds, target."))
    lines.append("Context: %s." % ("hourly good production rollup"
                                   if kind == "day"
                                   else "daily good production rollup"))
    lines.append("Hint: %s." % ("hourly pcs per slot | new vs rework split | "
                                "omit 12:xx | full hourly rows, never collapse "
                                "to best/total only"
                                if kind == "day" else
                                "daily pcs per shift-day | new vs rework split | "
                                "keep zero-days visible | full daily rows, never "
                                "collapse to best/total only"))
    lines.append("")
    lines.append("TIME: grain %s; %d buckets; period %s–%s%s." % (
        prof["grain"], prof["rows"],
        prof["time_span"]["min"], prof["time_span"]["max"],
        ("; gap 12:xx (lunch)" if kind == "day" else "; Obon + weekend zeros inside")))
    lines.append("")
    lines.append("COLUMN MEANINGS (only columns the result set uses):")
    for name, defi in meanings:
        lines.append("- %s = %s." % (name, defi))
    lines.append("")
    lines.append("DATA PROFILE (recomputed from result.csv):")
    for c, st in prof["numeric_stats"].items():
        lines.append("- %s: min %s / max %s / avg %s (n=%s, distinct=%s)." % (
            c, st["min"], st["max"], st.get("avg"), st["n"], st["distinct"]))
    if prof["constant_columns"]:
        consts = ", ".join("%s=%s" % tuple(d.items())[0]
                           for d in prof["constant_columns"])
        lines.append("Constant columns (no chart — table/rationale only): %s." % consts)
    lines.append("time_span: %s %s–%s (%s distinct)." % (
        prof["time_span"]["column"], prof["time_span"]["min"],
        prof["time_span"]["max"], prof["time_span"]["distinct"]))
    for g in prof["gaps"]:
        lines.append("Gap: %s." % g)
    lines.append("")
    lines.append("SAMPLE ROWS (first %d of %d):" % (len(sample), prof["rows"]))
    for r in sample:
        lines.append("- %s" % r)
    with open(os.path.join(folder, "context.md"), "w") as f:
        f.write("\n".join(lines) + "\n")


def main():
    # daily folders
    day_root = os.path.join(DATA, "day")
    for date in sorted(os.listdir(day_root)):
        folder = os.path.join(day_root, date)
        csv_path = os.path.join(folder, "result.csv")
        if not os.path.isfile(csv_path):
            continue
        with open(csv_path, newline="") as f:
            rows = list(csv.DictReader(f))
        prof = profile_day(rows)
        sample = [{k: r[k] for k in ("時間帯", "時間当", "累計", "FD03[7]",
                                    "FD32[8]", "FD31[9]", "FD03(再)[27]",
                                    "FD32(再)[28]", "FD31(再)[29]",
                                    "正味時間秒")} for r in rows[:6]]
        write_context(folder, "day", "%s 昼勤 (hourly)" % date, prof,
                      MEANINGS_DAY, sample)
        print("context: day/%s (%d rows)" % (date, len(rows)))
    # month folder
    folder = os.path.join(DATA, "month")
    with open(os.path.join(folder, "result.csv"), newline="") as f:
        rows = list(csv.DictReader(f))
    prof = profile_month(rows)
    sample = [dict(r) for r in rows[:6]]
    write_context(folder, "month", "August 昼勤 month aggregate (daily)",
                  prof, MEANINGS_MONTH, sample)
    print("context: month (%d rows)" % len(rows))


if __name__ == "__main__":
    main()
