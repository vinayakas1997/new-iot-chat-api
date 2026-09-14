# Version 2 — Adhoc / AI Services

**Goal.** Let the model *recommend* and (later) *compose*, on top of the stable
contracts frozen in v1, so the system can answer questions the setter never
anticipated — without a rewrite and without losing trust.

Status: not started (depends on v1 contracts).

## Scope

1. **AI recommender** — structure in, candidate charts out, human approves,
   recipe stored. "Recommend -> preview -> approve -> store."
2. **Chat2Data / Chat2Chart** — AI-written SQL with schema linking, read-only
   guardrails, and self-correction.
3. **Data-resolution planner** — hourly facts vs daily rollups vs live SQL,
   routed deterministically from the requested resolution.
4. **Analytics and multi-measure** — anomaly / volatility charts, and overlays
   of several measures in one chart.

## Guardrails (non-negotiable)

- Reuse `assertReadonly` (single SELECT/WITH, no semicolon) and the line
  member-table boundary — the playground already enforces both.
- The model may choose axes only from the **result columns**; unknown names fall
  back to the heuristic.
- Deterministic validation runs before anything reaches the user: numeric Y,
  signal present (not near-constant / all-null), row and time limits enforced.
- Cache resolved intents per question shape + line to avoid regenerating.
- Never surface an empty panel; fall back to table or a memory-only note.

## Borrowed patterns (not code)

From `db-gpt-ref/DB-GPT`:

- `packages/dbgpt-core/src/dbgpt/vis/tags/vis_chart.py` — chart-type usage
  prompts (line = trend, area = time series, table = many/non-numeric columns,
  scatter = relationships). Use as the recommender's vocabulary.
- `vis_anomaly_detection.py`, `vis_volatility_analysis.py` — analytical chart
  types relevant to plant data.
- `scene/chat_data/chat_db` — Text-to-SQL with schema linking and verification.
- AWEL agent routing — inspiration for the planner; we implement a lightweight
  deterministic version instead.

Take the interfaces and prompt patterns; keep the lean Fastify + inline-SVG
stack. Do not import the framework.

## Workstreams

| # | File | What |
|---|------|------|
| 01 | [01-ai-recommender.md](01-ai-recommender.md) | recommend -> preview -> approve -> store |
| 02 | [02-chat2data-chat2chart.md](02-chat2data-chat2chart.md) | AI SQL, schema linking, correction |
| 03 | [03-data-resolution-planner.md](03-data-resolution-planner.md) | memory / rollup / live routing |
| 04 | [04-analytics-and-multimeasure.md](04-analytics-and-multimeasure.md) | anomaly, volatility, overlays |

## Prerequisite from v1

- `resolveChart` seam and extended `ChartDatum`
  (`version-1/04-contracts-and-seams.md`).
- Fact tags `measure` / `unit` / `breach` / `granularity` at extraction.
- Recipe schema in `graph_specs.config`.

## Open Discussion

1. **Recommender timing.** Slip a light recommender into v1, or keep it strictly
   v2? v1 could ship manual-only and add recommendation next.
2. **Formula authority.** System-composed recipes now, AI-written SQL deferred —
   confirmed? If so, v2 starts with the recommender and adds SQL later.
3. **"Full in one graph" meaning.** Is the user mostly asking for (a) a longer
   time range, or (b) all measures in one chart? This decides whether rollups or
   multi-series composites come first.
4. **Rollups vs live recompute.** Maintain daily rollups at ingest (fast, more
   storage), or always recompute long ranges via live SQL (simple, hits DB)?
5. **Planner style.** Deterministic rules (recommended) or an LLM-routed,
   DB-GPT-style agent?
6. **Chat home.** Same unresolved question as v1: standalone `chatbot/` or
   `ingestion/app`?
7. **Safety thresholds.** Row caps, query timeouts, and how many self-correction
   retries before we give up and fall back.
8. **Adhoc exposure.** Are these exposed as public service endpoints, or only
   used internally by the chat/recommender?
