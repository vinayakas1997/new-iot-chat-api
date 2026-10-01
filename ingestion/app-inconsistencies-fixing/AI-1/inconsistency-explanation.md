# AI1 — inconsistency explanation (charts / table / ts)

Scope: AI1 only (chart analyser). Reference skeleton: role → task → context →
constraints → edge cases → examples → output format → recap.
Source file: `ingestion/app/backend/src/routes/charts.ts` (`CHART_SYSTEM`,
`CHART_VOCAB`, `SEMANTICS_RULES`, `buildDataProfile`).

## What was wrong

1. AI2's guardrail in AI1's prompt — "query only these tables" style wording
   belongs to the solver (AI2), but AI1 never writes queries. It confused the
   role: a chart analyser was being told query boundaries.
2. Table suppression instead of table candidacy — the model never emits
   `chartType: table`, so the "raw table may or may not be there" condition
   can never trigger. A conditional slot existed (`conditions`) with nothing
   allowed to fill it.
3. Cross-analysis by accident — line + bar pair shared X only when the model
   happened to pick so. No rule states the pair, so 4 unrelated charts break
   cross-analysis silently.
4. ts explanation half-present — column meanings carry timestamp sense
   (`hiduke`, `slot`), but the data time-span grounding is weak: the model can
   recommend a trend without stating what period it covers.
5. Skeleton gaps — no edge-case block (e.g. no plottable numerics → table-only;
   unclear AIM → clarify), no few-shot examples, no recency recap line. Middle
   rules risk the ~30% "lost in the middle" compliance drop.
6. Prompt not versioned — any edit is invisible to eval comparisons (same flaw
   as template hints staying v2).

## Changes we will do (point by point)

1. Delete all query/boundary wording from AI1's prompt — role is analyse, not query.
2. Table-candidacy rule — always emit a `table` candidate with a `conditions`
   gate ("when exact values or non-numeric columns matter; hidden unless
   requested"); UI decides show/hide, model stops suppressing.
3. Cross-pair convention — top-2 candidates share X and form the cross pair;
   non-sharing candidates (different X, pie if added) are standalone views;
   no shared X anywhere = no pair that round, never a forced fake pair.
4. ts block in Context — explicit time-span (`time_span` from data profile) +
   timestamp-column meanings, so every trend rationale states its period.
5. Add edge cases (table-only fallback, clarify on unclear AIM), 1–2 few-shot
   examples, and a final recap line ("Return only the JSON object").
6. Version the prompt (`chart-v1`, bump per change) and record the version in
   every chart-suggestion eval run for comparison.
