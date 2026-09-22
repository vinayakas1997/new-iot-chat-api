"""Build trial prompts mirroring recommendCore's user-message assembly exactly:
label + Data JSON (columns/profile/sample_rows<=6) + AIM + COLUMN MEANINGS
+ SQL, then trial A appends the proposed THRESHOLDS block (+ cite line).
Trial B (control) mirrors TODAY: profile carries the bare row-1 number,
no block. Writes prompt_A.txt / prompt_B.txt. Blind: no expectations here.
"""
import csv
import json
from datetime import datetime

BASE = "/home/somic_cps/Vina/new-iot-chat-api/ingestion/suggest-charts"

NAME = "furnace-temp-watch"
GRAN = "hourly"
UNIT = "\u00b0C"
DESCRIPTION = (
    "Furnace must stay hot: below 18 is danger (sensor icing suspected), "
    "above 26 is danger on multi-bucket runs. Normal band is 20-23 C."
)
SQL = (
    "SELECT date_trunc('hour', ts) AS ts, avg(temp_c) AS avg_temp_c, "
    "avg(humidity) AS humidity_pct FROM readings_furnace "
    "WHERE ts >= '{{from}}' AND ts < '{{to}}' GROUP BY 1 ORDER BY 1"
)
MEANINGS = [
    "- readings_furnace.temp_c [double]: furnace chamber temperature in degrees C, the primary safety measure",
    "- readings_furnace.humidity [double]: relative humidity percent, secondary comfort signal",
]
THRESHOLDS_BLOCK = """THRESHOLDS (breach conditions defined on this template — cite applicable ones in rationale/conditions and prefer their columns as Y measures):
- Overheat warn \u00b7 avg_temp_c \u00b7 above 26 \u00b7 multi-bucket runs only
- Freeze watch \u00b7 avg_temp_c \u00b7 below 18 \u00b7 sensor icing suspected"""


def fmt_n(v: float) -> str:
    return str(round(v, 3))


def main() -> None:
    with open(f"{BASE}/data.csv") as f:
        rows = list(csv.DictReader(f))
    columns = ["ts", "avg_temp_c", "humidity_pct"]

    num_stats = {}
    for c in ["avg_temp_c", "humidity_pct"]:
        vals = [float(r[c]) for r in rows]
        num_stats[c] = {
            "min": fmt_n(min(vals)),
            "max": fmt_n(max(vals)),
            "avg": fmt_n(sum(vals) / len(vals)),
            "n": len(vals),
            "distinct": len({round(v, 6) for v in vals}),
        }
    times = [r["ts"] for r in rows]
    profile = {
        "rows": len(rows),
        "granularity": GRAN,
        "unit": UNIT,
        "threshold": 26,
        "numeric_stats": num_stats,
        "time_span": {
            "column": "ts",
            "min": min(times) + ":00",
            "max": max(times) + ":00",
            "distinct": len(set(times)),
        },
    }
    data = {"columns": columns, "profile": profile, "sample_rows": rows[:6]}
    aim = (
        "AIM:\n"
        f"- description: {DESCRIPTION}\n"
        "- context: (none)\n"
        "- extractHint: (none)\n"
        "\nCOLUMN MEANINGS:\n" + "\n".join(MEANINGS)
        + f"\n\nSQL (maps raw columns to output columns):\n{SQL}"
    )
    base = (
        f'Feature: {NAME} (granularity {GRAN}, unit "{UNIT}").\n'
        f"Data:\n{json.dumps(data, indent=1)}\n\n{aim}"
    )
    open(f"{BASE}/prompt_B.txt", "w").write(base)
    open(f"{BASE}/prompt_A.txt", "w").write(base + "\n\n" + THRESHOLDS_BLOCK)
    print(f"profile rows={len(rows)} threshold=26")
    print(f"temp stats: {json.dumps(num_stats['avg_temp_c'])}")
    print("wrote prompt_A.txt (with THRESHOLDS) + prompt_B.txt (control)")


main()
