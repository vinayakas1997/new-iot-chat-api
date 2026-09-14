# RAG Console — Version Split

This folder separates the work we discussed into two versions:

- `version-1/` — **Pre-built / deterministic.** Curated setter-approved charts and
  cards; nothing invented at query time. This is the main product and ships first.
- `version-2/` — **Adhoc / AI services.** Recommendation, text-to-SQL, rollups,
  analytics. Added later, behind the interfaces frozen in v1.

## The principle

| | V1 (pre-built) | V2 (adhoc) |
|---|---|---|
| Chart origin | Human-approved spec | AI-recommended / AI-composed |
| SQL | Card SQL, validated | LLM-generated + self-corrected |
| Data source | Card run; memory later | Memory / rollup / live router |
| Explanation | Grounded generation | Same + per-chart claims |
| Resolution | Stored granularity | Up/down with rollups |
| Risk | Deterministic | Guardrailed |

V1 must not hallucinate. V2 may use the model, but only behind the contracts v1
defines, so v2 is additive and not a rewrite.

## Dependency order

```
V1:  extraction ──► graph render ──► chat inline charts ──► briefings
         │                 │                │
         └── fact tags ────┴── seams: resolveChart + answer contract ──► V2
V2:  recommender ──► adhoc SQL ──► rollups/planner ──► analytics
```

The extraction slice is a hard prerequisite: until facts are retained, chat has
no memory to reason over (`factsStored` is still `0` in the ticker).

## Why the split works

- **Data model already leans pre-built.** Cards hold SQL + `extractHint` +
  `unit` + `threshold` + `granularity`; `graph_specs` hold the approved visual.
  Doc `ingestion/feature-definition/09-stored-graphs.md` states the intent: the
  AI reads the spec and renders the pre-approved visualization.
- **Storing hourly is a resolution floor, not a wall.** Coarser/equal resolution
  can be derived from stored facts; finer resolution needs live SQL. V2 adds
  rollups and a planner to make that routing explicit.
- **"Store the tag" belongs at ingest; "explain the chart" belongs at query.**
  Facts carry durable tags once; narratives are generated per query from facts,
  live rows, and the stored scaffolding (units, threshold, normal range).

## Files

```
new-reserach/
  README.md                        <- you are here
  version-1/
    README.md                      scope + sequencing + Open Discussion
    01-extraction-slice.md         tick rows -> LLM extract -> Hindsight retain
    02-graph-section.md            graphs actually render (designer + saved)
    03-chat-inline-charts.md       chart under the explanation, history replay
    04-contracts-and-seams.md      freeze interfaces so V2 plugs in
  version-2/
    README.md                      scope + guardrails + Open Discussion
    01-ai-recommender.md           recommend -> preview -> approve -> store recipe
    02-chat2data-chat2chart.md     AI-written SQL with schema linking + retry
    03-data-resolution-planner.md  granularity routing (memory/rollup/live)
    04-analytics-and-multimeasure.md anomaly/volatility, multi-series overlays
```

Each version `README.md` ends with an **Open Discussion** section listing the
questions we have not settled. Workstream files link back to it.
