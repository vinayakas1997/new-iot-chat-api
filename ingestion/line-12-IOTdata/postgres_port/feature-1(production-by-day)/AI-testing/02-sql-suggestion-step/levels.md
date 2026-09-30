# Description levels for the sql-suggestion test

Same model (`qwen36-35B`), same tables, same `suggest-sql` prompt strings —
only the description/meanings/steer inputs vary. Each level adds one ingredient.

## L0 — empty (baseline)
- name: `Line-12 hourly production`
- description: *(empty)*
- meanings: bare `column (type)` with NO meanings (as a fresh registration looks)
- steer: *(empty)*

## L1 — one-liner
- description: `Day-shift hourly good production per time slot.`
- meanings/steer: same as L0.

## L2 — full description (the drafted one)
- description: `Line-12 day-shift hourly good production. Live query over the 3 August tables — never stored, recomputed each run. Per time-slot (09:20–19:20): hourly output, running total, target, split into new builds FD03/FD32/FD31 and rework FD(再), plus net seconds. No 12:xx bucket (lunch 12:00–13:10). Rework 0 is normal.`
- meanings/steer: same as L0.

## L3 — everything (description + fixed meanings + steer)
- description: same as L2.
- meanings: fixed gold meanings for key columns —
  `jikanbetsu_seisan: hourly good qty for this slot, SUM this per time bucket; ` +
  `seisan_su: running cumulative qty per model per day, display only, never SUM; ` +
  `insert_timing: row kind, 時間チェック = hourly checkpoint USE these, 直始め/生産数リセット = exclude; ` +
  `kishu_no: model no, 7/8/9 = FD03/FD32/FD31 new builds, 27/28/29 = rework (再); ` +
  `se_no: back/product name, *** = dummy; ct: cycle time seconds, net = qty x CT; ` +
  `kinmu_hidukejiku: shift-day date, night 00-11h belongs to prior shift-day; ` +
  `chuyakin: day/night shift flag 昼勤/夜勤; seisan_jikantai: hourly bucket, no 12:xx = lunch.`
  (Other columns: bare names, as auto-fill would leave them.)
- steer: `FD03/FD32/FD31 (work_no 7/8/9) are first-time builds; FD(再) (27/28/29) are rework — always state separately, never sum. Rework 0 is normal. No 12:xx bucket exists (lunch 12:00–13:10); 13:10 is post-lunch, not late. Day shift (昼勤) only.`

## Scoring (result-based, window 2026-08-04 昼勤 vs gold.sql)
1. Executes without error (10 pts)
2. Row count = 10 (10 pts)
3. Slot set identical (10 pts)
4. Per-slot hourly exact matches, 3 pts each (30 pts)
5. FD split columns present (10 pts) + values correct (10 pts)
6. Filter correct = total 1061, no 直始め pollution (10 pts)
7. Cumulative column present + correct (10 pts)
= 100 pts result score. Thinking-match scored separately: 4 key decisions
(right qty column / right filter / new-vs-rework split / cumulative) → %.
