"""Part-1 extra fixtures: no-threshold line chart + histogram.

1. no_threshold.png — normal day, NO warn line, NO breach dots. Tests the
   hole: what the model does with "Threshold: none stated."
2. hist_demo.png — temperature distribution (peak bin ~22, hot tail to 28.5),
   Part-1 mirror of Trial C.
Same visual language as the other part1 charts (dark bg, legend box).
"""
import csv

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BASE = "/home/somic_cps/Vina/new-iot-chat-api/context-building-new/part1"
BG, GRID, TEXT = "#0b0e13", "#1c2230", "#b6bfd4"
TEAL, AMBER = "#2dd4bf", "#f59e0b"


def frame(ax, title):
    ax.set_facecolor(BG)
    ax.tick_params(colors=TEXT, labelsize=8)
    for s in ax.spines.values():
        s.set_color(GRID)
    ax.grid(color=GRID, linewidth=0.5, alpha=0.7)
    ax.set_title(title, loc="left", fontsize=10, color="#64748b", pad=8)


def legend(ax, lines):
    ax.text(
        0.98, 0.97, "\n".join(lines), transform=ax.transAxes, ha="right", va="top",
        fontsize=8, color="#111827",
        bbox=dict(boxstyle="round,pad=0.4", fc="white", ec="#cbd5e1", alpha=0.95),
    )


# ---- 1. no-threshold normal day (00:00-23:00 window, positions == hours) ----
NO_TH = [
    21.2, 21.0, 18.1, 21.4, 21.3, 21.5, 21.1, 21.6, 21.8, 22.0, 22.3, 22.5,
    22.4, 22.1, 21.9, 21.7, 21.5, 21.6, 21.4, 21.2, 21.0, 20.9, 20.8, 21.0,
]
with open(f"{BASE}/data_nothreshold.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["ts", "avg_temp_c", "faults"])
    for h, v in enumerate(NO_TH):
        w.writerow([f"2026-09-16T{h:02d}:20Z", f"{v:.1f}", 0])
print(f"nothreshold avg={sum(NO_TH)/len(NO_TH):.2f} max={max(NO_TH):.1f} min={min(NO_TH):.1f}")

fig, ax = plt.subplots(figsize=(9, 4.5))
fig.patch.set_facecolor(BG)
ax.plot(range(24), NO_TH, color=TEAL, lw=2)
ax.set_xticks(range(0, 24, 2))
ax.set_xticklabels([f"{h:02d}:00" for h in range(0, 24, 2)])
ax.set_ylabel("avg_temp_c (°C)", color=TEXT)
frame(ax, "Hourly Average Temperature Trend · Demo-Day (no threshold set)")
legend(ax, ["X · Hour", "Y · avg_temp_c (°C)", "● Measures the temperature (°C)", "no threshold — describe only"])
fig.tight_layout()
fig.savefig(f"{BASE}/charts/no_threshold.png", dpi=130, facecolor=BG)
plt.close(fig)
print("wrote", f"{BASE}/charts/no_threshold.png")

# ---- 2. histogram: peak bin ~22, hot tail to 28.5 ----
HIST = (
    [19.5] * 2 + [20.0] * 4 + [20.5] * 5 + [21.0] * 8 + [21.5] * 10
    + [22.0] * 12 + [22.5] * 9 + [23.0] * 6 + [24.0] * 4 + [25.0] * 3
    + [26.0] * 2 + [27.0] * 2 + [28.5] * 1
)
fig, ax = plt.subplots(figsize=(9, 4.5))
fig.patch.set_facecolor(BG)
counts, bins, patches = ax.hist(HIST, bins=12, color=TEAL, edgecolor=BG)
peak = max(counts)
for p, c in zip(patches, counts):
    if c == peak:
        p.set_facecolor(AMBER)
ax.set_xlabel("avg_temp_c bins (°C)", color=TEXT)
ax.set_ylabel("count", color=TEXT)
frame(ax, "Temperature Distribution · Demo-Day (histogram)")
legend(ax, ["X · avg_temp_c bins", "Y · count", "● avg_temp_c (count)"])
fig.tight_layout()
fig.savefig(f"{BASE}/charts/hist_demo.png", dpi=130, facecolor=BG)
plt.close(fig)
print(f"hist n={len(HIST)} peak-bin≈22 tail=28.5")
print("wrote", f"{BASE}/charts/hist_demo.png")
