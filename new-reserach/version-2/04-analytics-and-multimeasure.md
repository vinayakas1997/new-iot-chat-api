# 04 — Analytics and Multi-Measure

**Version:** v2
**Depends on:** recommender + planner
**Enables:** richer visuals and cross-signal answers

## Part A — Analytical charts

Beyond raw plotting, expose analytical views as first-class chart types, modeled
on DB-GPT's vis tags:

- **Anomaly** (`vis_anomaly_detection.py`) — flag buckets outside the normal
  band. Grounded by the card's `threshold` / `normalRange` scaffolding, and by
  the `breach` tag on facts (from v1 extraction, so this is cheap).
- **Volatility** (`vis_volatility_analysis.py`) — rolling variance / rate of
  change, useful for unstable lines.

These are *views over existing data*, so no extra storage. They benefit from
the v1 fact tags: `breach` already marks abnormal buckets, and `measure` scopes
the analysis.

## Part B — Multi-measure overlays

"All measures in one graph":

- Overlay series from several cards on a **shared time bucket** (join by
  hour/day), or
- Define a **composite card** whose SQL computes them together.

`ChartDatum.y_columns[]` already supports multiple series; the missing piece is
binding each series to its source card and unit. Extend the recipe with a
`series: [{ cardId, y, unit }]` map.

Caution: differing units on one Y axis are misleading. Either normalize, or use
dual axes, or split into small multiples.

## Verification ideas

- Anomaly view highlights the same buckets that carry `breach: true` facts.
- Volatility differs measurably between a stable and an unstable line.
- A multi-measure chart labels each series with its unit and source.

## Open items

- Which analytical views are genuinely useful to plant operators first
  (anomaly almost certainly; volatility maybe later)?
- Dual axis vs small multiples vs normalized index for mixed units.
- Composite card vs runtime join for multi-measure — the former is simpler and
  cacheable; the latter is flexible but heavier.
- Should analytical charts be recommendable (v2-01 gallery) or only reachable by
  explicit question?
- Do analytical results need to be retained as facts (e.g. "anomaly at 14:00")
  or stay ephemeral? (Recommend ephemeral unless a card explicitly extracts
  them.)
