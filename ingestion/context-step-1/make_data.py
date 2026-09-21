"""Dry-run fixture data: 10 production days, hourly temp + faults.

Planted ground truth (recorded in truth.json, NEVER sent to the LLM):
- daily 02:00 dip (-3.1C, 10/10 days) — matches the confirmed recalibration quirk
- Sep-16 breach: peak 28.5C at 17:00 vs warn 26 (ramp 14:00-18:00)
- Sep-18 flatline: 22.0 for 6 buckets (stuck sensor)
- Sep-19 06:00 gap (null)
- faults spike of 5 at Sep-16 17:00 (cross-series correlation with breach)
"""
import csv
import json
import math
import random
from datetime import datetime, timedelta, timezone

random.seed(42)
START = datetime(2026, 9, 10, 8, 20, tzinfo=timezone.utc)  # production-day anchor
HOURS = 10 * 24

rows = []
for i in range(HOURS):
    ts = START + timedelta(hours=i)
    h = ts.hour
    temp = 21.5 + 1.2 * math.sin((h - 9) / 24 * 2 * math.pi) + random.gauss(0, 0.25)
    temp = round(temp, 1)
    faults = 1 if random.random() < 0.08 else 0
    day = ts.date().isoformat()
    rows.append({"ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "avg_temp_c": temp, "faults": faults, "_day": day, "_h": h})

# 1. daily 02:00 dip, 10/10 days
dip_days = 0
for r in rows:
    if r["_h"] == 2:
        r["avg_temp_c"] = round(18.4 + random.gauss(0, 0.15), 1)
        dip_days += 1

# 2. Sep-16 breach ramp 14:00-18:00, peak 28.5 at 17:00
breach_profile = {14: 24.8, 15: 26.4, 16: 27.6, 17: 28.5, 18: 26.9}
for r in rows:
    if r["_day"] == "2026-09-16" and r["_h"] in breach_profile:
        r["avg_temp_c"] = breach_profile[r["_h"]]
        if r["_h"] == 17:
            r["faults"] = 5

# 3. Sep-18 flatline 10:00-15:00 (6 buckets at 22.0)
flat_n = 0
for r in rows:
    if r["_day"] == "2026-09-18" and 10 <= r["_h"] <= 15:
        r["avg_temp_c"] = 22.0
        flat_n += 1

# 4. Sep-19 06:00 gap
for r in rows:
    if r["_day"] == "2026-09-19" and r["_h"] == 6:
        r["avg_temp_c"] = ""

out = "/home/somic_cps/Vina/new-iot-chat-api/ingestion/context-step-1/data.csv"
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["ts", "avg_temp_c", "faults"])
    w.writeheader()
    for r in rows:
        w.writerow({"ts": r["ts"], "avg_temp_c": r["avg_temp_c"], "faults": r["faults"]})

truth = {
    "window": {"from": rows[0]["ts"], "to": rows[-1]["ts"]},
    "rows": len(rows),
    "planted": {
        "daily_dip": {"at": "02:00", "depth": -3.1, "days": f"{dip_days}/10", "matchesQuirk": "confirmed recalibration quirk — must be ignored with citation"},
        "breach": {"day": "2026-09-16", "peak": 28.5, "peakAt": "17:00", "threshold": 26, "direction": "above", "ramp": "14:00-18:00"},
        "flatline": {"day": "2026-09-18", "value": 22.0, "buckets": flat_n, "hours": "10:00-15:00"},
        "gap": {"day": "2026-09-19", "at": "06:00", "column": "avg_temp_c"},
        "cross_series": {"day": "2026-09-16", "at": "17:00", "faults": 5, "note": "faults spike coincides with temp peak — cross-series catch"},
    },
}
with open("/home/somic_cps/Vina/new-iot-chat-api/ingestion/context-step-1/truth.json", "w") as f:
    json.dump(truth, f, indent=2)
print(f"wrote {len(rows)} rows, dip_days={dip_days}, flat={flat_n}")
print(json.dumps(truth["planted"], indent=1))
