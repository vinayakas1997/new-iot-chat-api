"""Render base chart pair per folder from result.csv.
Daily: line(時間帯->時間当) + grouped bar(時間帯->model split).
Month: line(日付->day_total) + grouped bar(日付->new/rework).
Output: <folder>/charts/base-trend.png, base-split.png
Usage: python3 render_charts.py   (run from AI-1/data/)
"""
import csv, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm

DATA = os.path.dirname(os.path.abspath(__file__))

# pick a CJK-capable font present on this box
for fam in ("Noto Serif CJK SC", "Noto Serif CJK TC", "AR PL UMing CN",
            "AR PL UKai CN"):
    try:
        fp = fm.findfont(fm.FontProperties(family=fam), fallback_to_default=False)
        plt.rcParams["font.family"] = fam
        print("font: %s" % fam)
        break
    except Exception:
        continue
plt.rcParams["axes.unicode_minus"] = False

NEW_COLS = ["FD03[7]", "FD32[8]", "FD31[9]"]
REWORK_COLS = ["FD03(再)[27]", "FD32(再)[28]", "FD31(再)[29]"]


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def render_day(folder, label):
    rows = read_csv(os.path.join(folder, "result.csv"))
    xs = [r["時間帯"] for r in rows]
    y = [int(r["時間当"]) for r in rows]
    out = os.path.join(folder, "charts")
    os.makedirs(out, exist_ok=True)

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(xs, y, marker="o")
    ax.set_title("%s 昼勤 — 時間当 (hourly pcs)" % label)
    ax.set_xlabel("時間帯")
    ax.set_ylabel("時間当 (pcs)")
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(out, "base-trend.png"), dpi=100)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(11, 5))
    n = len(xs)
    idx = list(range(n))
    series = [(c, [int(r[c]) for r in rows])
              for c in NEW_COLS + REWORK_COLS]
    w = 0.8 / len(series)
    for i, (c, vals) in enumerate(series):
        ax.bar([x + (i - len(series) / 2 + 0.5) * w for x in idx], vals,
               width=w, label=c)
    ax.set_xticks(idx)
    ax.set_xticklabels(xs, rotation=45)
    ax.set_title("%s 昼勤 — model split (new + rework)" % label)
    ax.set_xlabel("時間帯")
    ax.set_ylabel("pcs")
    ax.legend(fontsize=8, ncol=3)
    fig.tight_layout()
    fig.savefig(os.path.join(out, "base-split.png"), dpi=100)
    plt.close(fig)
    return 2


def render_month(folder):
    rows = read_csv(os.path.join(folder, "result.csv"))
    xs = [r["日付"] for r in rows]
    tot = [int(r["day_total"]) for r in rows]
    new = [int(r["new_total"]) for r in rows]
    rew = [int(r["rework_total"]) for r in rows]
    out = os.path.join(folder, "charts")
    os.makedirs(out, exist_ok=True)

    fig, ax = plt.subplots(figsize=(13, 5))
    ax.plot(xs, tot, marker="o")
    ax.set_title("August 昼勤 — day_total (daily pcs)")
    ax.set_xlabel("日付")
    ax.set_ylabel("day_total (pcs)")
    ax.set_xticks(range(len(xs)))
    ax.set_xticklabels(xs, rotation=60, fontsize=7)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(os.path.join(out, "base-trend.png"), dpi=100)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(13, 5))
    idx = list(range(len(xs)))
    ax.bar([x - 0.2 for x in idx], new, width=0.4, label="new_total")
    ax.bar([x + 0.2 for x in idx], rew, width=0.4, label="rework_total")
    ax.set_xticks(idx)
    ax.set_xticklabels(xs, rotation=60, fontsize=7)
    ax.set_title("August 昼勤 — new vs rework per day")
    ax.set_xlabel("日付")
    ax.set_ylabel("pcs")
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(out, "base-split.png"), dpi=100)
    plt.close(fig)
    return 2


def main():
    total = 0
    day_root = os.path.join(DATA, "day")
    for date in sorted(os.listdir(day_root)):
        folder = os.path.join(day_root, date)
        if os.path.isfile(os.path.join(folder, "result.csv")):
            total += render_day(folder, date)
            print("charts: day/%s" % date)
    total += render_month(os.path.join(DATA, "month"))
    print("charts: month — TOTAL %d PNGs" % total)


if __name__ == "__main__":
    main()
