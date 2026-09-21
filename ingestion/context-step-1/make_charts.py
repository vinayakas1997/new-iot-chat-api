"""Render dry-run chart stand-ins mirroring the app's overlay layout:
title top-left, top-right legend box (X/Y/series), amber dashed warn line,
red breach markers, dark background like the TradingView renderer.
"""
import csv
from collections import defaultdict
from datetime import datetime, timezone

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BASE = "/home/somic_cps/Vina/new-iot-chat-api/ingestion/context-step-1/charts"
BG, GRID, TEXT = "#0b0e13", "#1c2230", "#b6bfd4"
SERIES = "#2dd4bf"
AMBER, RED = "#f59e0b", "#ef4444"

rows = []
with open("/home/somic_cps/Vina/new-iot-chat-api/ingestion/context-step-1/data.csv") as f:
    for r in csv.DictReader(f):
        t = datetime.strptime(r["ts"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        v = float(r["avg_temp_c"]) if r["avg_temp_c"] not in ("", None) else None
        rows.append((t, v, int(r["faults"])))


def legend_box(ax, lines):
    ax.text(
        0.98, 0.97, "\n".join(lines), transform=ax.transAxes, ha="right", va="top",
        fontsize=8, color="#111827",
        bbox=dict(boxstyle="round,pad=0.4", fc="white", ec="#cbd5e1", alpha=0.95),
    )


def style(ax, title):
    ax.set_facecolor(BG)
    ax.tick_params(colors=TEXT, labelsize=8)
    for s in ax.spines.values():
        s.set_color(GRID)
    ax.grid(color=GRID, linewidth=0.5, alpha=0.7)
    ax.set_title(title, loc="left", fontsize=10, color="#64748b", pad=8)


# 1. daily line (10 production-day averages)
by_day = defaultdict(list)
for t, v, _ in rows:
    if v is not None:
        by_day[t.date().isoformat()].append(v)
days = sorted(by_day)
avgs = [sum(by_day[d]) / len(by_day[d]) for d in days]
fig, ax = plt.subplots(figsize=(9, 4.5))
fig.patch.set_facecolor(BG)
ax.plot(range(len(days)), avgs, color=SERIES, lw=2)
ax.axhline(26, color=AMBER, ls="--", lw=1, alpha=0.9)
ax.text(len(days) - 1, 26.3, "warn 26 °C", color=AMBER, fontsize=8, ha="right")
for i, (d, a) in enumerate(zip(days, avgs)):
    if a >= 26:
        ax.plot(i, a, "o", color=RED, ms=7)
ax.set_xticks(range(len(days)))
ax.set_xticklabels([d[5:] for d in days], rotation=30, ha="right")
ax.set_ylabel("avg_temp_c (°C)", color=TEXT)
style(ax, "Daily Average Temperature Trend · daily")
legend_box(ax, ["X · Day", "Y · avg_temp_c (°C)", "● Measures the temperature (°C)"])
fig.tight_layout()
fig.savefig(f"{BASE}/daily_temp.png", dpi=130, facecolor=BG)
plt.close(fig)

# 2. hourly breach day (Sep-16)
day = [r for r in rows if r[0].date().isoformat() == "2026-09-16"]
xs = list(range(24))
ys = [r[1] for r in day]
fig, ax = plt.subplots(figsize=(9, 4.5))
fig.patch.set_facecolor(BG)
ax.plot(xs, ys, color=SERIES, lw=2)
ax.axhline(26, color=AMBER, ls="--", lw=1, alpha=0.9)
ax.text(23, 26.3, "warn 26 °C", color=AMBER, fontsize=8, ha="right")
for x, y in zip(xs, ys):
    if y is not None and y >= 26:
        ax.plot(x, y, "o", color=RED, ms=7)
ax.set_xticks(range(0, 24, 2))
ax.set_xticklabels([f"{h:02d}:00" for h in range(0, 24, 2)])
ax.set_ylabel("avg_temp_c (°C)", color=TEXT)
style(ax, "Hourly Average Temperature Trend · hourly · Sep-16")
legend_box(ax, ["X · Hour", "Y · avg_temp_c (°C)", "● Measures the temperature (°C)", "⚠ warn > 26 °C"])
fig.tight_layout()
fig.savefig(f"{BASE}/hourly_breachday.png", dpi=130, facecolor=BG)
plt.close(fig)

# 3. histogram of temp values
vals = [v for _, v, _ in rows if v is not None]
fig, ax = plt.subplots(figsize=(9, 4.5))
fig.patch.set_facecolor(BG)
counts, bins, patches = ax.hist(vals, bins=12, color=SERIES, edgecolor=BG)
peak = max(counts)
for p, c in zip(patches, counts):
    if c == peak:
        p.set_facecolor(AMBER)
ax.set_xlabel("avg_temp_c bins (°C)", color=TEXT)
ax.set_ylabel("count", color=TEXT)
style(ax, "Temperature Distribution · histogram")
legend_box(ax, ["X · avg_temp_c bins", "Y · count", "● avg_temp_c (count)"])
fig.tight_layout()
fig.savefig(f"{BASE}/hist_temp.png", dpi=130, facecolor=BG)
plt.close(fig)

print("charts written:", BASE)
