# 03 — Data-Resolution Planner (Memory / Rollup / Live)

**Version:** v2
**Depends on:** v1 fact tags + coverage signal, extraction
**Enables:** correct answers for "full range" / "raw" / long-trend questions

## Problem

Facts are stored at the card's granularity (today, hourly). Users ask for
different resolutions: "full day in one graph", "the whole month", "raw
readings". Storing hourly is a **resolution floor**, not a wall.

## Routing rule

- **Requested resolution >= stored** (coarser or equal): answer from **memory**
  by aggregating facts (hourly -> daily), or from a **rollup** level. Cheap.
- **Requested resolution < stored** (finer than stored): only **live SQL** can
  serve it — re-run the card SQL with the requested `{{from}}/{{to}}`.
- **Requested range beyond coverage**: live SQL for the older part, or state the
  coverage limit.

So: derive upward from memory, go live downward.

## Rollup ladder

Analogous to TSDB downsampling (Prometheus):

- At ingest keep **hourly facts** and maintain a **daily rollup**
  (avg/min/max/count) per `measure`.
- Long-range "full" graphs read the coarsest level that satisfies the request
  (one point per day instead of 720).
- Optionally keep a **raw staging window** (e.g. last 7 days) for fine requests.

## Planner (deterministic)

```
intent     = { measures, range, resolution, chartType? }
capability = { cards, granularities, rollups, coverage, liveAvailable }

1. measures -> cards/specs        (stored spec first, schema match)
2. range + resolution -> buckets
3. route: memory | rollup | live | combo
4. if live: generate/validate SQL (v2-02), self-correct once
5. chart: stored spec > explicit intent > heuristic
6. render + explain with provenance ("hourly memories" | "live source")
```

## Coverage signal

Computed per card, shown as a badge and used by the planner:

- memory — requested resolution at/above stored and within coverage
- live — finer than stored, or beyond coverage
- none — no data / missing columns

## Verify

- "Last 24h hourly" -> memory/live at hourly.
- "Last 30 days" -> daily rollup, one point per day.
- "Raw readings today" -> live SQL, finer than stored.
- Provenance badge matches the chosen source.

## Open items

- Rollups vs always-live for long ranges (storage vs DB load).
- Rollup retention (how long to keep hourly; how long daily).
- Does the planner ever mix sources in one chart (memory + live on a shared
  axis)? Recommend no for v2 first cut.
- Is "full" mostly time-range or multi-measure? (See v2-04.)
- Where the planner lives — ingestion (owns facts/rollups) vs chatbot.
