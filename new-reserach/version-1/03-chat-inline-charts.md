# 03 — Chat Inline Charts

**Version:** v1 (pre-built)
**Depends on:** 01 (memory facts), 02 + 04 (shared renderer, contract)
**Enables:** briefings; v2 plugs in behind the same contract

## Problem

The chat already produces charts, but they never sit with the explanation:

- Charts render **only in the right-hand Inspector** (`chatbot/frontend/src/
  screens/Chat.tsx`), not in the answer bubble.
- Historical messages store `charts` but the bubble renders only text and
  sources, so reopening a session shows no graph.
- Charts trigger only on keyword matches (`needsLiveSql` in
  `chatbot/backend/src/rag/answer.ts`); memory-only answers never chart.
- The heuristic rejects string numerics (`typeof === "number"`), so
  `COUNT(*)` series vanish.
- `ChartView` plots only `y_columns[0]` (no multi-series).
- `Briefings.tsx` already renders charts inline next to text — that is the
  pattern Chat is missing.

## What to build

### a. Inline chart in the answer bubble

Render each answer's charts directly under the summary, grouped per line for
multi-line answers. Keep the Inspector for **sources / why** (provenance),
not as the only place charts appear.

### b. Replay from history

Render `m.charts` when a session is reopened, using the same component, so past
answers keep their visuals.

### c. Stored spec first, heuristic second

- If a stored `graph_specs` spec matches the card/question, render it.
- Otherwise, chart the live card SQL result heuristically (with the fixed
  numeric helper from workstream 02).
- **No AI-written SQL in v1.** If memory-only, show either a small trend from
  recalled facts or an explicit "memory-only, no live chart" note — never an
  empty panel.

### d. Grounded explanation

The backend already feeds live rows to the model. Strengthen the prompt so the
narrative references the visual ("peak at 14:00 was 88 °C, above the 80 °C warn
line") and never invents numbers. Use the scaffolding (units, threshold, normal
range) as grounding.

### e. Provenance badge

Each chart shows where it came from: `memory` vs `live`, and `stored spec` vs
`heuristic`. Reuses the `source` field from the contract.

## Files likely touched

- `chatbot/frontend/src/screens/Chat.tsx` — render `m.charts` inline.
- `chatbot/frontend/src/components/charts.tsx` — align with the shared
  `Chart.tsx` from v1 workstream 02 (single renderer).
- `chatbot/backend/src/rag/answer.ts` — numeric helper, chart selection,
  provenance, prompt.
- `chatbot/backend/src/routes/chat.ts` — carry the extended `ChartDatum`.

## Verify

- Ask a chart-worthy question: a chart appears under the answer text.
- Reopen an old session: its charts are still shown.
- A question that only hits memory shows the memory-only state, not a blank.
- Provenance badge matches reality.

## Open items

- **Home (blocking):** standalone `chatbot/` vs `ingestion/app`. The chatbot is
  untracked and not currently running.
- **Chart under summary vs per-chart claims:** start simple, or go straight to
  `supports` sentence mapping?
- **Multi-line answers:** one chart block per line, or merged? Lines differ in
  units/schema, so per-line is safer.
- **Memory-only visuals:** is a sparkline from recalled numbers acceptable, or
  always text when there is no live query?
- **Streaming:** the deterministic pipeline builds the chart before the prose is
  streamed. Confirm the chart can render as soon as the `final` event arrives
  without layout jump.
