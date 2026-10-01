# Difference — daily analysis vs monthly-chart analysis (August 昼勤, feature-1)

Question: which patterns/questions surface only day-by-day vs only month-wide?
Method: 18 daily LLM calls (hourly grain, charts + full rows) + 1 monthly call
(daily grain, charts + full 31 rows). Same SYSTEM (`../prompt-variables.md`
Section 4), same model (`qwen36-35B`), morning shift only. 13 zero-production
days excluded (8/1, 8/2, Obon 8/8–8/16, 8/23, 8/30 — Sundays are holidays).
Row-kind rule: nonzero `生産数リセット`/`直始め` rows included (verified
cell-for-cell vs the Word 08-04 screenshot: first slot 50/50, total 1083).

## Section 1 — Disjoint findings

24 questions total (23 daily + 1 monthly), zero window overlap: no daily
window touches another day; the month window touches no slot.

### Month-only (5 items — invisible to every daily call)
| # | Finding | Source |
|---|---|---|
| M1 | Obon trench: 9 straight zero-days 8/8–8/16 as one pattern | `month/response.json` line chart |
| M2 | 1502 → 30 cliff (08-21 → 08-22): sharpest adjacent-day move | `month/response.json` q1 |
| M3 | Month peak day 08-28 = 1581 | `month/response.json` line title |
| M4 | Rework month-framed: max 28 pcs on 08-19, avg 0.9 (date verified) | `month/response.json` bar rationale |
| M5 | Week-over-week ramp 711 (08-03) → 1581 (08-28) | `month/result.csv` + line chart |

### Daily-only (6 items — the monthly chart never shows)
| # | Finding | Source |
|---|---|---|
| D1 | Post-lunch 13:10 softness cluster (9 days) | `day/*/response.json` q1 (08-03,04,05q2,07,17,19,21,29 + 08-29 lull) |
| D2 | Slot timing of peaks (17:20 = 177 on 08-04; 13:10 = 281 on 08-31) | `day/2026-08-04`, `day/2026-08-31` line titles |
| D3 | Per-slot model stories (FD03 only at 10:20 on 08-03; FD03 160-pc surge only at 16:20 on 08-29; 08-22 lone 30 pcs all FD31) | `day/2026-08-03`, `day/2026-08-29`, `day/2026-08-22` bar titles |
| D4 | Model regime shift: FD31-led week (08-03–08-07) → FD32-led fortnight (08-17–08-31) | daily union (month `result.csv` merges all models into `new_total`, so month-blind) |
| D5 | Sub-day structures: lunch-gap shape, end-shift declines (08-06q2, 08-18q2, 08-26q2), 08-29 12-slot structure | `day/*/response.json` + `charts/` |
| D6 | Rework timed: 3 at 13:10 + 25 at 14:10 (month knows only "28 on 08-19") | `day/2026-08-19/response.json` + `result.csv` |

Gap-rule compliance: 23/23 daily `why` fields engage lunch/calendar correctly
("lunch ends at 13:10", "no lunch gap here") — the lunch-question leak is closed.
Images fixed grounding (08-04 peak corrected 171 → 177 vs the text-only trial).

## Section 2 — Combined correspondence (month stance → daily counterpart → conclusion)

| # | Monthly stance | Daily counterpart | Combined conclusion |
|---|---|---|---|
| C1 | Obon trench 8/8–8/16 | Flanks: 08-07 closes normally (764); 08-17 restarts 1138 with post-lunch softness | Clean stop, soft restart — production halts 8/8, resumes 8/17 weakly. Neither arm alone shows stop + restart. |
| C2 | 1502 → 30 cliff (08-21 → 08-22) | 08-21 strong normal day (peak 186); 08-22 all-zero except 13:10 = 30 FD31 | Full-output day → near-total stop, one 30-pc slot. 08-22 is Saturday: scheduled stoppage, not mid-flow failure. Month poses it, dailies dispose it. |
| C3 | Month peak 08-28 = 1581 | 08-28: peak 277 at 13:10, FD32-led (137 FD32 at 13:10) | Winning recipe: FD32 midday throughput. Month names the best day; daily names why it won. |
| C4 | Rework max 28 on 08-19, avg 0.9 | 08-19: FD31(再) 3 at 13:10 + 25 at 14:10, otherwise FD32-led | Rare + model-specific (FD31 only) + afternoon-clustered. Month says how much; daily says when and which. HOLE: nobody asked *why* — first AI2 ticket. |
| C5 | Ramp 711 → 1581 | Week 1 FD31-led (peaks 130–163); weeks 3–4 FD32-led (peaks 160–281) | The ramp IS the regime shift: output climbs as the floor moves FD31 → FD32. Month draws the slope; dailies name the driver. Needs order-intake data for the business why. |
| C6 | Month q1 (cliff cause, open) + 23 daily dip-whys (open) | — | Combined open ledger for next round: 1 cross-day + 23 intra-day causes, `status=open`. AI2's work queue, pre-sorted by grain. |

Each row above becomes one retrievable conclusion chunk for the vectorDB
(Part-1 → Part-2 handoff), tagged `line:12, grain:daily|monthly, measure:*`.

## Section 3 — Future: business-impact path (Part-2 contract)

L1 patterns (this file) → L2 business reading → L3 "check this day" suggestions.
Recommended hybrid (evidence: the first month response misbound 3 dates doing
arithmetic over a 31-row frame — LLMs must not detect, only interpret):

1. Deterministic detectors (code): zero-stretch, adjacent-day cliff,
   model-share crossover (regime shift), reset-slot flagger — over stored
   responses + CSVs → typed pattern objects (exact dates/values, no guessing).
2. Pattern analyser (LLM): pattern objects + vectorDB history → business
   reading + suggestions. Calendar-known closes with reason (Obon, Sundays);
   checkable-in-here auto-tickets (`stg_ijo` join for 08-19 rework first);
   needs-outside-data frames human tickets (FD32 order intake from 8/17).
3. Process-not-business excluded from L2 (reset rows, lunch gap, 12-slot 08-29).

## Caveats (recorded, not hidden)

- Month date-binding: first month response misbound 3 dates (values right);
  fixed by full-rows tier (all 31 rows inline, threshold 50) — verified
  1581→08-28, 911→08-29, 08-22 = 30 pcs. Month X-density stays on watch.
- Rework cause unquestioned by either arm (C4 hole) — queued for AI2.
- Daily questions cluster on dip-why (~20/23) — prompt rewards dips,
  under-rewards ramps/records/model-mix shifts. Diversity rule pending.
- Screenshot variance: Word 08-04 vs CSV matched cell-for-cell AFTER
  reset-inclusion; any future live-vs-snapshot drift re-opens the 09:20 check.
