"""Part-1 freeze-night fixture: plant 24 hourly rows + render the chart.

Mirrors context-step-1/make_charts.py visual language (dark bg, legend box,
dashed warn line, breach dots) but for the BELOW direction: sky dashed
warn line at 18, dots on sustained sub-18 buckets.
"""
import csv

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BASE = "/home/somic_cps/Vina/new-iot-chat-api/context-building-new/part1"
BG, GRID, TEXT = "#0b0e13", "#1c2230", "#b6bfd4"
SERIES = "#38bdf8"
SKY, RED = "#38bdf8", "#ef4444"

# (hour label, avg_temp_c, faults). Sustained sub-18 run 01:00-05:00 (breach);
# 02:00 single-bucket dip = recalibration quirk (ignore with citation);
# 06:00 brief warm spike = door opening (never recovery).
DATA = [
    ("18:00", 22.0, 0), ("19:00", 21.6, 0), ("20:00", 21.2, 0), ("21:00", 20.6, 0),
    ("22:00", 19.9, 0), ("23:00", 18.7, 0), ("00:00", 18.3, 0), ("01:00", 17.9, 1),
    ("02:00", 15.9, 0), ("03:00", 16.8, 3), ("04:00", 17.4, 1), ("05:00", 17.8, 0),
    ("06:00", 20.5, 0), ("07:00", 19.5, 0), ("08:00", 20.1, 0), ("09:00", 20.4, 0),
    ("10:00", 20.8, 0), ("11:00", 21.0, 0), ("12:00", 21.2, 0), ("13:00", 21.1, 0),
    ("14:00", 21.0, 0), ("15:00", 20.9, 0), ("16:00", 21.1, 0), ("17:00", 21.3, 0),
]

with open(f"{BASE}/data_below.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["ts", "avg_temp_c", "faults"])
    for i, (h, v, fl) in enumerate(DATA):
        day = "2026-09-16" if i < 6 else "2026-09-17"
        w.writerow([f"{day}T{h}:20Z", f"{v:.1f}", fl])

vals = [v for _, v, _ in DATA]
print(f"avg={sum(vals)/len(vals):.2f} max={max(vals):.1f} min={min(vals):.1f} last={vals[-1]:.1f}")

xs = list(range(24))
ys = vals
fig, ax = plt.subplots(figsize=(9, 4.5))
fig.patch.set_facecolor(BG)
ax.set_facecolor(BG)
ax.plot(xs, ys, color=SERIES, lw=2)
ax.axhline(18, color=SKY, ls="--", lw=1, alpha=0.9)
ax.text(23, 18.3, "warn 18 °C", color=SKY, fontsize=8, ha="right")
for x, y in zip(xs, ys):
    if y < 18:
        ax.plot(x, y, "o", color=RED, ms=7)
# Position i = wall hour (18+i)%24 (window starts 18:20). Labels must show
# true hours or the 02:00-dip / 03:00-low traps point at the wrong ticks.
ax.set_xticks(range(0, 24, 2))
ax.set_xticklabels([f"{(18 + h) % 24:02d}:00" for h in range(0, 24, 2)])
ax.set_ylabel("avg_temp_c (°C)", color=TEXT)
ax.tick_params(colors=TEXT, labelsize=8)
for s in ax.spines.values():
    s.set_color(GRID)
ax.grid(color=GRID, linewidth=0.5, alpha=0.7)
ax.set_title("Hourly Average Temperature Trend · Demo-Night (freeze watch)", loc="left", fontsize=10, color="#64748b", pad=8)
ax.text(
    0.98, 0.97,
    "\n".join(["X · Hour", "Y · avg_temp_c (°C)", "● Measures the temperature (°C)", "⚠ warn < 18 °C"]),
    transform=ax.transAxes, ha="right", va="top", fontsize=8, color="#111827",
    bbox=dict(boxstyle="round,pad=0.4", fc="white", ec="#cbd5e1", alpha=0.95),
)
fig.tight_layout()
fig.savefig(f"{BASE}/charts/below_freezenight.png", dpi=130, facecolor=BG)
plt.close(fig)
print("wrote", f"{BASE}/charts/below_freezenight.png")
