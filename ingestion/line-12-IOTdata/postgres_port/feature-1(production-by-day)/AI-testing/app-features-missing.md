# App features missing — upgrade list for the ingestion app

Source: verified read-only against `ingestion/app` code + 3 AI tests
(`AI-testing/01-column-suggestion-AI`, `02-sql-suggestion-step`, `03-chart-suggestion`).
Parked — nothing built. Each item: what → why (code evidence) → outcome.

---

## 1. Steer box + rerun for `llm-fill` (column meanings)
- **Explanation:** the hints flow has a "Steer the AI" textarea + editable points + rerun; the
  column auto-fill (`POST /lines/:id/tables/:schema/:table/llm-fill`) has none — one shot, no guidance.
- **Why:** test 01 scored 69% overall but 0% on the 4 plant-specific rules (cumulative-don't-sum,
  時間チェック filter, new/rework split, shift-day rollover). A steer box carrying those rules would
  lift the draft before human review. Same pattern already exists — copy it, don't invent.
- **Outcome:** fewer key-column misses at registration; human review stays but becomes check-not-write.

## 2. Steer for chart Resuggest (`recommend-draft`)
- **Explanation:** preview modal has Resuggest ("run again on current inputs") but the chart route
  accepts no `steer` param, so re-runs are identical-input dice rolls. The user cannot say
  "add a table of the FD split."
- **Why:** `routes/cards.ts` suggest-hints takes `steer` ("obey over inference"); `routes/charts.ts`
  `recommend-draft` params end at `referenceLineId`. Verified both sides (frontend sends none, backend takes none).
- **Outcome:** steerable chart loop like the hints loop; the missing-table case becomes solvable via AI instead of manual-only.

## 3. Per-chart (individual) resuggest
- **Explanation:** Resuggest re-runs ALL chart candidates at once. No way to say "keep the line, redo only the second one."
- **Why:** `ChartPreviewModal` has one `onResuggest` for the whole modal; `Cards.tsx:2041/3925` both call the full-list suggest. Fine output gets regenerated (and can regress) just to fix one item.
- **Outcome:** cheaper iterations, stable good candidates, less LLM spend.

## 4. Quirk-scanner verdicts wired into `llm-fill` / `analyze`
- **Explanation:** the deterministic detector (`scanQuirks` in `quirks.ts`) already flags cumulative
  counters ("report deltas, never raw levels"), flatlines, and single-bucket gaps — but only
  `suggest-hints` receives its verdicts. Column labeling never sees them.
- **Why:** test-01 K2 failure ("Total production count" → invites the SUM bug) is exactly what the
  scanner detects with zero guessing. One-line meaning: feed the already-computed measurement into
  the labeling prompt instead of letting the AI guess from 5 rows.
- **Outcome:** kills the cumulative-counter bug class automatically; expected auto-fill lift ~69% → ~80%.

## 5. Spread-out samples for `llm-fill`
- **Explanation:** labeling sees 5 rows from one spot (`sampleRows(table, 5)`). A cumulative column looks
  like "a number" — growth over time is invisible.
- **Why:** same K2 root cause as #4, from the data side. 5 rows from shift-start + 5 from shift-end of the
  same day makes "running total" inferable.
- **Outcome:** better first drafts on counter/gauge distinction; complements #4 (data evidence + detector verdict).

## 6. Table row-count guardrail for RAG feed (cap 50)
- **Explanation:** chart/label paths cap rows to the LLM (`MAX_ROWS_TO_LLM=25`, ticker slices 60,
  chart samples 500) — but **no cap exists for table specs sent to RAG**. A month table (680 rows × 15 cols
  for feature-1) would go in full and blow context.
- **Why:** verified — no table-specific cap anywhere in `extract.ts` / `ticker.ts` / RAG-feed paths.
- **Outcome:** tables always fit context: send latest 50 buckets + a *"showing latest 50 of N"* note so the AI
  knows it's truncated, not complete. Our 10-row day tables pass untouched.

## 7. "Both" option — send charts AND table together
- **Explanation:** each graph spec has one RAG toggle, but downstream code treats charts and tables as
  either/or: sanitize **drops AI tables whenever numerics exist** (`charts.ts:512`, "a table beside
  plottable charts is noise") and the merge optimizer **filters tables out** (`charts.ts:921`,
  `groupKey` returns null for tables at `:600`).
- **Why:** test-03 proved the consequence — FULL run scored 53/100 with a good FD line but the table
  never appears, by rule, not by model failure. Manual designer saves are the only surviving tables.
- **Outcome:** line/area for trend + 50-row table for exact FD values, both flagged, both retrieved.
  Change: allow `selected_for_rag` on table specs alongside charts; stop excluding `table` at merge/RAG-feed
  when explicitly flagged (keep auto-suggest suppression so AI doesn't spam tables).

## 8. Steer-overridable bucket rule in `suggest-sql`
- **Explanation:** the frozen Rules block forces `date_trunc('hour', ts)` bucketing + `{{from}}/{{to}}` on a
  timestamp column. Our plant has TEXT timestamps and plant buckets (`09:20…`, lunch gap) — literal
  obedience produces `column "ts" does not exist` (test-02: all 4 levels scored 0/100 on results while
  thinking hit 75%).
- **Why:** no description depth can override a contradicting hard rule; only the steer ("ground truth —
  obey over inference") can, and only if the prompt lets steer win on bucketing.
- **Outcome:** L3 + one steer line ("GROUP BY `seisan_jikantai`, timestamp is `to_timestamp(hiduke,…)`) should
  cross 50% result-match. Parked re-test to confirm.

## 9. Manual chart builder on templated cards
- **Explanation:** the GraphDesigner (chart-type picker + X-axis dropdown + Y toggles + save) renders
  only for scratch (template-less) cards. Template-stamped cards show "charts live in the template —
  shown here read-only," so the table chart cannot be hand-added where it is actually needed
  (test-03 verdict: the table is a mandatory manual add).
- **Why:** `Cards.tsx:3982-3985` (`isTemplated` gates the full designer); the template form has AI
  suggest but no equivalent manual builder. Workaround today is add-then-stamp ordering, which is
  backwards for our flow (template first, charts after).
- **Outcome:** render the same builder on templates (same component, specs saved with
  `source: "manual"`), so the table chart is a one-click add wherever the card lives.

---

## Registration checklist (manual steps that stay human until above lands)
1. Register line → add 3 tables → fill the ~10 key column meanings by hand (test-01 gold list).
2. Template: paste gold SQL → Suggest SQL → Test/Preview vs gold → save.
3. Suggest Hints with steer paragraph → accept/edit points → save.
4. Charts: Suggest → Resuggest if needed → **hand-add the table chart** (type=table, X=時間帯, Y=FD cols) → tick RAG boxes for line + area + table ("both").
5. Skip schedule: lunch 12:00→13:10 daily; granularity hourly; streams hourly-only for feature-1.
