# Feature-1: production-by-day (combined image2 + image3)

One wide row per time-slot. Reproduces Word **image2 (時間帯|時間当|累計|目標数)**
merged with **image3 (背番号別 FD split)**, enriched with date/shift tags for
the vector DB. Built from August data already in Postgres.

## Query
`01_combined.sql` → `line12_august.qgn_daily_combined(p_date DATE, p_shift TEXT DEFAULT NULL)`
- `p_shift = '昼勤'` / `'夜勤'` → that shift only (cumulative resets per shift,
  matches the Word screenshot which shows 昼勤 09:20–19:20).
- `p_shift = NULL` → both shifts, cumulative partitioned per shift.

```sql
-- one shift (Word shape):
SELECT * FROM line12_august.qgn_daily_combined(DATE '2026-08-04', '昼勤');
-- full day, both shifts:
SELECT * FROM line12_august.qgn_daily_combined(DATE '2026-08-04', NULL);
```

## Columns (15)
`slot_ts` (Hindsight timestamp) | `勤務日付軸` (shift-day, tag `date:`) |
`日付` (calendar date) | `勤務体制` (tag `shift:`) | `時間帯` |
`時間当` (= image2 時間当) | `累計` (= image2 累計, running per shift) |
`目標数` (= image2 目標数, 0 in August) |
`FD03[7]` `FD32[8]` `FD31[9]` (new: work_no 7/8/9) |
`FD03(再)[27]` `FD32(再)[28]` `FD31(再)[29]` (rework: work_no 27/28/29) |
`正味時間秒` (= 時間当 × CT 18)

Rules: only `時間チェック` rows (Hour_Check 1/2/3); night `00–11:xx` slots roll
`slot_ts`/`日付` to the next calendar day while `勤務日付軸` stays put.

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
Full row also carries `slot_ts` (e.g. `2026-08-04 10:20:00+09`),
`勤務日付軸=2026-08-04`, `日付=2026-08-04`, `勤務体制=昼勤`.
Day total 1,061. (Word screenshot shows 1,483 — that's a September day,
same shape, different numbers.)

Night-shift rollover example (`2026-08-04 夜勤`, 12 rows, total 1,065):
```
slot_ts (JST)       | 勤務日付軸  | 日付       | 時間帯 | 時間当 | 累計
2026-08-04 20:20:00 | 2026-08-04 | 2026-08-04 | 20:20  |  113  |  113
2026-08-04 23:20:00 | 2026-08-04 | 2026-08-04 | 23:20  |  144  |  577
2026-08-05 01:20:00 | 2026-08-04 | 2026-08-05 | 01:20  |  114  |  691  (rolls to next day)
```

## Rework proof — `2026-08-19 昼勤` (only August day with rework: 28 pcs)
Rework columns are NOT always zero. `FD31(再)[29]` = 3 at 13:10 + 25 at 14:10:
```
時間帯 | 時間当 | 累計 | FD32[8] | FD31[9] | FD03再[27] | FD32再[28] | FD31再[29]
13:10 |  115  |  420 |   76    |   36    |     0      |     0      |     3
14:10 |  170  |  590 |   86    |   59    |     0      |     0      |    25
```
(All other August days: all three (再) columns = 0. New vs rework never mix —
`FD31[9]` is work_no 9 first-time, `FD31(再)[29]` is work_no 29 rework.)

## Vector-DB chunk format (one per row)
`"2026-08-04 昼勤 10:20 — 時間当141 (FD03[7]=68 new, FD31[9]=73 new, rework 0), 累計169, 正味2538s."`
Tags: `line:12, date:2026-08-04, shift:昼勤, measure:hourly_output, slot:10:20`.
~22 rows/day × 31 days ≈ 680 facts for August.
