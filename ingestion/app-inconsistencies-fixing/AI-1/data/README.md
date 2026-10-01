# Experiment data — feature-1: production-by-day (same feature, same definition)

Canonical definition: `ingestion/line-12-IOTdata/postgres_port/feature-1(production-by-day)/README.md` — this file mirrors it; that file stays canonical.

One wide row per time-slot. Word image2 (時間帯|時間当|累計|目標数) + image3 (FD split). August data in Postgres `line12_august`.

Query: `qgn_daily_combined(p_date, p_shift)` — this experiment uses `p_shift='昼勤'` only.

15 columns: `slot_ts` | `勤務日付軸` | `日付` | `勤務体制` | `時間帯` | `時間当` | `累計` | `目標数` | `FD03[7]` `FD32[8]` `FD31[9]` (new 7/8/9) | `FD03(再)[27]` `FD32(再)[28]` `FD31(再)[29]` (rework 27/28/29) | `正味時間秒` (= 時間当 × CT 18).

Rules: only `時間チェック` rows; night `00–11:xx` roll to next calendar day, `勤務日付軸` stays.

Reference values: 2026-08-04 昼勤 total 1083, peak 17:20 = 177; 2026-08-19 昼勤 only rework day (28 pcs, model 29); Obon 8/8–8/16 = 0.

Row-kind rule (verified vs Word screenshot 08-04, cell-for-cell 50/50 first slot, 1083 total): include nonzero `生産数リセット`/`直始め` rows carrying real bucket stamps (morning double-input e.g. 08:55:44 reset + 09:20 checkpoint; shift-close resets at 18:20/19:20). Zero-rows stay excluded. Port function `qgn_daily_combined` implements this; August-reset pcs total 1013 + 3 across 25 + 1 rows.

Layout: `day/<YYYY-MM-DD>/{result.csv,context.md,prompt.md,response.json,run.log}` + `month/{same 5}` + `difference.md`.

## Example — `2026-08-04 昼勤` (10 rows, no rework that day)
```
時間帯 | 時間当 | 累計 | 目標 | FD03[7] | FD32[8] | FD31[9] | FD03再[27] | FD32再[28] | FD31再[29] | 正味時間秒
09:20 |   28  |   28 |  0   |    0    |    0    |   28    |     0      |     0      |     0      |    504
10:20 |  141  |  169 |  0   |   68    |    0    |   73    |     0      |     0      |     0      |   2538
11:20 |  171  |  340 |  0   |   75    |    0    |   96    |     0      |     0      |     0      |   3078
13:10 |  106  |  446 |  0   |   58    |    0    |   48    |     0      |     0      |     0      |   1908  (after lunch gap)
14:10 |  116  |  562 |  0   |   69    |    0    |   47    |     0      |     0      |     0      |   2088
15:20 |  117  |  679 |  0   |   69    |    0    |   48    |     0      |     0      |     0      |   2106
16:20 |  174  |  853 |  0   |   94    |    0    |   80    |     0      |     0      |     0      |   3132
17:20 |  177  | 1030 |  0   |   65    |    0    |  112    |     0      |     0      |     0      |   3186
18:20 |   31  | 1061 |  0   |   31    |    0    |    0    |     0      |     0      |     0      |    558  (short close)
19:20 |    0  | 1061 |  0   |    0    |    0    |    0    |     0      |     0      |     0      |      0
```
Day total 1,061. Rework proof — `2026-08-19 昼勤` (only August day with rework: 28 pcs, `FD31(再)[29]` = 3 at 13:10 + 25 at 14:10; all other August days rework = 0).

## SQL used (function + dumps)
Function: `line12_august.qgn_daily_combined(p_date DATE, p_shift TEXT)` — one wide row per time-slot (image2 + image3 merged). Canonical source: `ingestion/line-12-IOTdata/postgres_port/feature-1(production-by-day)/01_combined.sql`.
Filter (verified cell-for-cell vs the Word 08-04 screenshot):
```sql
WHERE t.ab_section_day = p_date
  AND (t.hour_check_text = '時間チェック'
       OR (t.hour_check_text IN ('生産数リセット', '直始め')
           AND t.work_qty_h <> 0))
  AND (p_shift IS NULL OR t.shift_type = p_shift)
```
This experiment uses `p_shift = '昼勤'` only.
Dumps: per-day `COPY (select * from line12_august.qgn_daily_combined(date '<YYYY-MM-DD>','昼勤')) TO STDOUT WITH CSV HEADER` → `day/<date>/result.csv` (18 days, zero-days excluded); month aggregate (31 day-grain rows: `日付, slot_rows, day_total=max(累計), new_total, rework_total, net_sec_total, target_total`) → `month/result.csv`.
