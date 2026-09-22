"""Fake hourly furnace data: normal ~22C, one overheat run breaching above 26
(3 buckets), one freeze dip breaching below 18 (2 buckets), plus humidity
(a distractor measure with no thresholds)."""
import csv
import random

BASE = "/home/somic_cps/Vina/new-iot-chat-api/ingestion/suggest-charts"
random.seed(7)

rows = []
for h in range(72):
    day = 14 + h // 24
    hh = h % 24
    ts = f"2026-09-{day:02d}T{hh:02d}:00:00Z"
    temp = 22.0 + random.uniform(-0.8, 0.8)
    hum = 52.0 + random.uniform(-4, 4)
    # Overheat run: Sep 15, 16:00-18:00
    if day == 15 and hh == 16:
        temp = 27.5
    if day == 15 and hh == 17:
        temp = 28.5
    if day == 15 and hh == 18:
        temp = 27.0
    # Freeze dip: Sep 16, 05:00-06:00
    if day == 16 and hh == 5:
        temp = 17.5
    if day == 16 and hh == 6:
        temp = 17.0
    rows.append({"ts": ts, "avg_temp_c": round(temp, 1), "humidity_pct": round(hum, 1)})

with open(f"{BASE}/data.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["ts", "avg_temp_c", "humidity_pct"])
    w.writeheader()
    w.writerows(rows)
print(f"wrote {len(rows)} rows")
print("overheat:", [r for r in rows if r["avg_temp_c"] >= 26])
print("freeze:", [r for r in rows if r["avg_temp_c"] <= 18])
