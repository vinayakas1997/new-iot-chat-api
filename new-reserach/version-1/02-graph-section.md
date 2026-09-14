# 02 — Graph Section

**Version:** v1 (pre-built)
**Depends on:** workstream 04 (recipe shape) for the scaffolding fields
**Enables:** chat charts (03)

## Problem

Charts do not render today, and saved specs are never drawn.

Root causes found in the code:

1. **Designer defaults to `table`.** The live preview only renders for
   `line/bar/area` and only after an X and at least one Y are chosen
   (`Cards.tsx`, `GraphDesigner`). With defaults, nothing ever appears.
2. **Fragile numeric detection.** `numericCols()` inspects only `rows[0]`; a
   null first value hides a numeric column.
3. **Postgres numerics arrive as strings.** The driver sets no type parsers
   (`ingestion/app/backend/src/drivers/postgres.ts`), so `numeric` / `bigint`
   (e.g. `COUNT(*)`) are strings. `typeof x === "number"` checks miss them.
4. **Saved specs are text-only.** `CardDetails.tsx` lists graph names; nothing
   renders them.
5. **Single preview source.** The designer only previews the last 24h test run.

## What to build

### a. One shared numeric helper

`isNumericColumn(rows, col)` — scan **all** rows, coerce numeric strings with
`Number()`, ignore nulls/empties. Use it in the designer, the chart component,
and (later) v2. This single fix removes most "no chart" cases.

### b. Designer that renders by default

- Auto-pick the first numeric column as a Y series.
- Default chart type to `line` when the X column looks temporal
  (`/time|date|hour|day|shift|at/i`), else `bar`, else `table`.
- A preview appears immediately; the setter adjusts rather than starts blank.

### c. Render saved graphs

- `CardDetails` renders each saved spec as an actual chart (reuse the shared
  component), not a name.
- Card tile shows a mini thumbnail per saved spec (or a count + expand).

### d. Preview window (decision pending)

Allow 24h / 7d / 30d for the preview by running the card SQL with the window
substituted (`{{from}}` / `{{to}}` are already in card SQL). See Open items.

### e. Scaffolding on save

When saving a spec, also store the meaning fields in `graph_specs.config`:

```
{
  summary: "hourly average temperature, °C",
  units: "°C",
  threshold: 80,
  normalRange: [60, 78],
  source: "manual"
}
```

`config` is already a JSON blob — no migration needed.

## Files likely touched

- `ingestion/app/frontend/src/screens/Cards.tsx` — `GraphDesigner`,
  `ChartPreview` -> extract to a shared component.
- `ingestion/app/frontend/src/components/` — new `Chart.tsx` (shared).
- `ingestion/app/frontend/src/components/CardDetails.tsx` — render charts.

## Verify

- Open Graph Designer on a card with data: a preview is visible without manual
  setup.
- Save a spec; reopen the card Details: the chart is drawn.
- A `COUNT(*)` series (string from pg) plots correctly (numeric helper).
- Build gate: `tsc --noEmit` exits 0; bundle contains the new component strings.

## Open items

- **Window selector:** 24h only, or 24h/7d/30d? 7d+ wants a rollup (v2), so v1
  could cap at 24h live.
- **Chart engine:** keep dependency-free inline SVG, or adopt a library for axes
  and tooltips? Design rules favour lightweight.
- **Multi-Y rendering:** `ChartPreview` plots all chosen Y columns; the chatbot
  `ChartView` plots only the first. The shared component must pick one behavior.
- **time axis:** categories vs real timestamps. v1 can treat X as categories;
  true time scaling is a later nicety.
- **Table chart meaning:** currently "the AI renders rows as a table in chat".
  Confirm this stays for `table` type.
