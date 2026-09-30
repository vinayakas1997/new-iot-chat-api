# Implementation status — app upgrades (from app-features-missing.md)

Order: strict #1 → #9. Rule: implement → verify with the matching AI-test → log here before moving on.
August data: SAFE in `test-postgres.line12_august` (backup: `/tmp/opencode/line12/line12_august.backup`, 399K).
Wipe scope: app DB (`app_setter-data`) ONLY.

## Step 0 — safety + before-snapshot (done 2026-09-30)
- `line12_august` dump: OK (3 staging tables 41278/23466/1361 rows, 3 funcs, m_work_names 30 rows).
- App DB before-state: lines=[], templates=[], cards=[], llm providers=[] — already empty.
- **P0 fix (boot blocker, not in the 9):** backend crash-looped on every start —
  `//` comments + a JS `if` trapped inside a `db.exec()` SQL string in
  `backend/src/db/store.ts` (`openStore`, chart_readings block) → `SQLITE_ERROR near "/"`.
  Fixed by closing the SQL string before the JS conditional (ALTER kept as real JS outside).
  Backend rebuilt, boots, API live (`/api/ingest/hindsight/status` responds).

## #1 — Steer box + rerun for llm-fill — status: done 2026-09-30
- Files: `backend/src/routes/lines.ts` (llm-fill accepts `steer`, appended as
  "Setter notes (ground truth — obey over inference)"), `backend/src/routes/connections.ts`
  (draft llm-fill, same), `frontend/src/lib/api.ts` (`llmFillTable[Draft]` pass `steer`),
  `frontend/src/components/TableAnalyzeDialog.tsx` (collapsible "Steer the AI" box, wired into
  both fill calls; rerun = existing Re-analyze + per-column fill). Fixed one self-made JSX
  nesting error; `tsc --noEmit` clean on backend + frontend.
- Test evidence: (a) replicated-prompt check on stg_ryohin: 15/24 62% → 23/24 96%, all 4 key
  misses fixed; (b) LIVE end-to-end via real route on `conn-munoi3bf`:
  without steer → "Production quantity…" / "start of the direct process" / "Serial number" (0/3);
  with steer → "running cumulative… should not be summed" / "hourly checkpoints, excluding…" /
  "new builds (7,8,9) or rework (27,28,29)" (3/3). Caveat: model still garbles numbers
  occasionally (e.g. "1-3 new, 7-9 rework") — human review stays mandatory.
- Notes: test provider `llm-munoi3ax` (atlas-local :8009) + connection `conn-munoi3bf`
  now in app DB; both cleared at fresh-restart step.

## #2 — Steer for chart Resuggest — status: done 2026-09-30
- Files: `backend/src/routes/charts.ts` (`recommend-draft` accepts `steer`, appended to semantics
  as "Setter notes (ground truth — obey over inference)"), `frontend/src/lib/api.ts`
  (`recommendDraft` passes `steer`), `frontend/src/screens/Cards.tsx` (`onFormSuggest` forwards the
  existing steer box — one box now drives SQL + hints + charts). `tsc --noEmit` clean both sides.
- Test evidence (LIVE via real route, test line `line-12`, combined SQL, same model):
  without steer → line(時間当) + area(累計) + histogram;
  with steer "Include a table of the FD split…" → line(時間当) + line(累計), histogram dropped.
  Prompt echo confirms steer text reaches the LLM. Steer IS influential.
- Notes: the steered table itself still cannot appear — `sanitize` drops ALL table candidates when
  numerics exist (`charts.ts:512`). That's item #7's fix, not #2's. #2 verified as plumbed + effective;
  table-via-steer unlocks after #7.
## #3 — Per-chart individual resuggest — status: done 2026-09-30
- Files: `frontend/src/components/ChartPreviewModal.tsx` (optional `onResuggestOne(key)` prop +
  per-chart "Regenerate" button in each section header, disabled while AI runs),
  `frontend/src/screens/Cards.tsx` (`onFormResuggestOne`: re-calls `recommendDraft` with user
  steer + auto line naming only that chart and demanding a differing type/series, then swaps just
  that index in `formSug`; keeps current + error note when only identicals return). `tsc` clean.
- Test evidence (LIVE via real route): auto-steer naming the histogram slot returned
  `line(slot_ts, 時間当)` "Hourly Good Production Trend" — a differing candidate, so the swap
  fires; other slots untouched by construction (index-based replace).
- Notes: card-level modal (line 3925 usage) keeps whole-list Resuggest only — per-item there is
  future work, template flow (where registration happens) is covered.
## #4 — Quirk verdicts into llm-fill — status: done 2026-09-30
- Files: `backend/src/quirks.ts` (new exported `tableQuirkLines`: time-col via TIME_RE or
  date-parse probe → strided OFFSET slices across the table → `scanQuirks` → clause lines;
  all failures return no-lines, labeling never breaks), `backend/src/routes/lines.ts` +
  `connections.ts` (both llm-fill append the "Measured table quirks" block). `tsc` clean.
- Test evidence (LIVE, stg_ryohin, no steer): quirk verdicts visibly reach drafts —
  `jikanbetsu_seisan` → "Hourly production quantity… flatline of 0 for 52+ buckets indicates a
  stuck sensor" (was: "represented as a text field"). Plumbing proven.
- Findings (honest): (a) one-sided LIMIT samples < MIN_DAYS=5 → silent no-op; strided slices were
  REQUIRED for verdicts to ever fire on big tables. (b) False-positive risk: Obon-holiday zeros
  read as "stuck sensor" flatline — the scanner doesn't know holidays. Mitigation parked:
  pair quirk lines with skip-schedule awareness or mark them unconfirmed in llm-fill (hints flow
  already gates via setter confirm/deny). (c) Global counter check cannot fire on interleaved
  multi-model tables (seisan_su still generic without steer) — per-entity grouping is future work;
  steer (#1) remains the fix for that class.
## #5 — Spread samples for llm-fill — status: done 2026-09-30
- Files: `backend/src/quirks.ts` (new `findTimeColumn` shared helper + `spreadSampleValues`:
  earliest-5 + latest-3 values per column; null-safe fallback), both llm-fill routes (sampleText
  now `early a, b · late x, y` when a time col is detectable, else legacy head-only). `tsc` clean.
- Test evidence (LIVE, stg_ryohin, no steer): prompt path carries early/late (model echoes
  "showing early and late shifts"); `jikanbetsu_seisan` correctly "Hourly production quantity".
- Findings (honest): (a) quirk clauses from #4 now attach aggressively — sometimes to the WRONG
  column (`mokuhyo` called "cumulative counter", `kishu_no` called "incident count"). Verdicts help
  but misattribute without per-column grounding; strengthens the case for the setter-confirm gate
  before quirk lines enter labeling (hints flow has it, llm-fill doesn't — follow-up, not this item).
  (b) Model returned 5 drafts for 3 requested columns — pre-existing over-eager behavior, logged
  not fixed (harmless: UI maps by name, extras ignored... actually extras OVERWRITE by name map —
  only matching names apply, so harmless).
## #6 — Table cap-50 for RAG feed — status: done 2026-09-30
- Files: `backend/src/rollup.ts` (new exported `TABLE_FEED_MAX_ROWS=50` + `capTableRows`: latest-N
  win, `{rows,total,truncated}`), `backend/src/routes/readings.ts` (`buildTableEnvelope` caps to 50
  + "latest 50 of N — do not assume completeness" note), `backend/src/extract.ts` (`llmDraft`
  Window line states "showing first 25 of N" when sliced). `tsc` clean.
- Test evidence: LIVE tsx check in container — 680 rows → kept 50 (items 630–679, latest),
  truncated=true; 3 rows → untouched. (Route-level E2E for readings needs card fixtures;
  deferred to registration step where a real table read runs.)
- Notes: finding while scoping — row caps already existed scattered (25 extract / 60 readings /
  500 chart samples) but silent; #6 unifies the table rule (50 + stated note). No behavior change
  for small tables (our 10-row days pass through).
## #7 — "Both" flag + stop dropping tables — status: done 2026-09-30
- Files: `backend/src/routes/charts.ts` (`sanitizeCandidates` gains `allowTable`; `recommendCore`
  threads it; draft route sets it from `/table/i` on the steer). Merge math untouched (tables
  correctly stay out of line-merge groups — can't merge a table into a line). RAG checkboxes
  already support both (default-on per spec); no UI change needed. `tsc` clean.
- Test evidence (LIVE, same SQL/model): with steer "Include a table of the FD split…" →
  `line(slot_ts,時間当)` + **`table(slot_ts)` "FD Material Split and Rework Values"**;
  control without steer → line + area + histogram, no table. Opt-in works, suppression intact.
- Notes: this also unlocks the #2 flagship (steer-a-table). Table yCols=[] by design (exact values
  via Details table, capped at #6's 50).
## #8 — Steer-overridable bucket rule in suggest-sql — status: done 2026-09-30
- Files: `backend/src/routes/cards.ts` (suggest-sql appends an "Override rule" line when steer is
  present: setter notes WIN over bucket/column rules on conflict, override noted in thinking). `tsc` clean.
- Test evidence (LIVE parked re-test, line-12 with 15 gold meanings saved, L3+override steer):
  thinking explicitly cites the override ("using seisan_jikantai instead of date_trunc") and hits
  4/4 decisions except cumulative; SQL uses GROUP BY plant buckets + right filters + 7/8/9-vs-27/28/29
  split + right qty column. After two mechanical TEXT casts, output = gold hourly numbers EXACTLY
  (10 rows, total 1061). Result similarity 0 → ~70/100; thinking 75% → ~100% on named decisions.
- Notes: remaining misses are steer-precision issues, not code: (a) my steer said
  `to_timestamp(hiduke)` but Postgres needs the 2-arg format form — model obeyed literally and died;
  steer must carry the full expression. (b) No cumulative column, no per-model FD cols, net≠×CT —
  need explicit steer lines. (c) TEXT staging needs "::INT casts" stated once (meanings or
  description). First suggest-sql call 502'd transiently (parse fail, retried OK) — model-side flake.
## #9 — Manual builder on templated cards — status: done 2026-09-30
- Files: `frontend/src/screens/Cards.tsx` (`TemplateCharts` gains "Add chart manually":
  type select + X dropdown + Y toggles + title, columns from loaded sample; saves via existing
  PATCH `chartSuggestions`). No backend change (PATCH already accepted full spec arrays). `tsc` clean.
- Test evidence (LIVE): template `tpl-munsd45l` created, PATCHed manual
  `table(時間帯)` "FD split table" → stored `[(table, 時間帯, enabled)]`. The UI form posts the
  identical payload.
- Notes: test template row now in app DB (cleared at fresh-restart step).
## #10 — (added later) Live token/word estimate — status: pending

## Fresh restart log
- Done 2026-09-30: pre-wipe backup `/tmp/opencode/line12/setter.db.pre-wipe` (152K); stopped backend,
  deleted setter.db* in `app_setter-data`, restarted — boots clean on empty DB (P0 fix holds),
  lines/templates/llm all []. `test-postgres.line12_august` untouched (23466 ryohin rows verified).
  Re-registered provider `llm-munsfqvd` (atlas-local :8009 qwen36-35B, active) + connection
  `conn-munsfqw2` (test-postgres, schemaFilter line12_august). Old test rows
  (line-12, tpl-munsd45l, conn-munoi3bf) gone with the wipe, as intended.

## Feature-1 registration log
- (pending) line + 3 tables + meanings → template + gold SQL → hints → charts → ingest → open-questions check (`AI-testing/05-open-questions/`).
