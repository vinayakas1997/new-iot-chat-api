# Version 1 — Pre-built (deterministic)

**Goal.** Make the curated path work end to end: setter-approved cards and graph
specs, retained facts, and a chat that renders the approved visual under a
grounded explanation. Nothing is invented at query time.

Status: not started (planning only).

## Scope

1. **Extraction slice** — tick rows + `extractHint` -> active LLM -> retain facts
   into `bank:line-<id>` with lineage tags. Enables memory.
2. **Graph section** — fix why charts do not render, and render saved specs
   (not just a text list).
3. **Chat inline charts** — chart directly under the explanation, replayed from
   history; stored spec wins. No AI-written SQL.
4. **Briefings** — reuse the same renderer (already close; see `Briefings.tsx`).
5. **Contracts and seams** — freeze the interfaces below so v2 is additive.

Out of v1: AI-recommended charts, AI-written SQL, rollups, anomaly/volatility,
multi-measure overlays. Those are `version-2/`.

## Workstreams

| # | File | What |
|---|------|------|
| 01 | [01-extraction-slice.md](01-extraction-slice.md) | tick -> extract -> Hindsight retain |
| 02 | [02-graph-section.md](02-graph-section.md) | designer + saved-chart rendering |
| 03 | [03-chat-inline-charts.md](03-chat-inline-charts.md) | chart under explanation, replay |
| 04 | [04-contracts-and-seams.md](04-contracts-and-seams.md) | the frozen interfaces |

## Sequencing

```
01 extraction  ->  02 graph render  ->  03 chat charts  ->  briefings
      |                   |                  |
      +-- fact tags ------+-- seams --------+--> v2
```

- 01 is mandatory before 03 can show anything meaningful from memory.
- 02 and 03 can be developed in parallel once 04 is agreed.
- Briefings needs only 03's shared renderer.

## Contracts to freeze in v1 (summary)

Full detail in [04-contracts-and-seams.md](04-contracts-and-seams.md).

- **ChartDatum** extended with `supports`, `source`, `spec_id`, `recipe`.
- **`resolveChart(intent)` -> `{ rows, spec, provenance }`** — v1 implements
  `storedSpec` and `heuristic`; v2 adds `dynamicSql`, `rollup`, `analytics`.
- **Fact tags** at extraction: `line`, `card`, `cardVersion`, `connectionId`,
  `measure`, `unit`, `granularity`, `breach`.
- **Recipe** stored in `graph_specs.config`: `{ cardId, aggregation, groupBy,
  window, chart_type, x, y[], title, rationale, source }`.

## Current facts this plan builds on

- Ticker runs live cards and records runs but writes `factsStored: 0`
  (`ingestion/app/backend/src/ticker.ts`).
- Graph designer exists per card with a minimal inline-SVG preview
  (`Cards.tsx` `GraphDesigner` / `ChartPreview`); saved specs show as text only
  in `CardDetails.tsx`.
- Postgres driver sets no type parsers, so `numeric` / `int8` (e.g. `COUNT`)
  arrive as strings — this is the main cause of "no chart".
- Hindsight contract and provisioning are in
  `ingestion/feature-definition/07-hindsight-contract.md`.

## Open Discussion

These are unresolved. Each also appears in the relevant workstream file.

1. **Where does chat live?** Standalone `chatbot/` (currently untracked and not
   running) or inside `ingestion/app`? This gates workstream 03.
2. **Extraction model + prompt.** Which active model extracts, and what exactly
   is `content` vs `tags` vs `metadata` per fact? Is the tag vocabulary above
   approved?
3. **Does `extractHint` need to change** to require `measure` and `breach` tags?
   Changing it affects existing templates/cards.
4. **Scaffolding storage.** Put `summary / units / normalRange / threshold` into
   `graph_specs.config`, or add dedicated columns/table?
5. **Chart rendering engine.** Keep dependency-free inline SVG, or add a chart
   library? Design rules lean lightweight/dark-first.
6. **Stored-chart window.** Preview last 24h only, or a 24h/7d/30d selector?
7. **Per-chart explanation linkage.** Simple "chart under the summary" first, or
   go straight to per-chart `supports` claims?
8. **`chatbot/` in git.** It is currently untracked (`?? chatbot/`). Do we track
   it, merge it, or keep it separate?
