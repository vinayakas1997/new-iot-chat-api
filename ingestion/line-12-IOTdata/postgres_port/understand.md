# Understand — Line-12 August reproduction

## Research aim
Load 1-month August IoT data into our own Postgres and reproduce the
MotionBoard (Word doc) features **in our own way**, enriched for our vector DB
(date + shift + material split in one place).

## Inputs (locked scope)
- **3 August tables** — already in `plant` DB, schema `line12_august` (test-postgres):
  - `stg_seisan_jisseki` (生産実績.csv): 41,278 rows — equipment event log
    (実績コード/実績内容/実績時間, 開始≒日付, 勤務日付軸, 昼夜勤, 生産時間帯)
  - `stg_ryohin` (明細表_良品生産数.csv): 23,466 rows — quality goods log
    (時間別生産数=hourly qty, 生産数=cumulative, CT, 機種番号/背番号, 時間帯)
  - `stg_ijo` (明細表_異常情報.csv): 1,361 rows — error history
    (異常№/異常内容, 機番, 呼出/処置 stop seconds, ST work/serial nos)
  - Coverage: `2026/08/01`–`2026/08/31` (31 days). CSVs are UTF-8+BOM.
- **Spec:** Word doc `古川OBJ加工組付№12利用クエリ.docx` — 4 MotionBoard features
  (screenshots extracted to `/tmp/opencode/line12/image1-5.png`):
  1. 時間当出来高/可動率 (image1: 昼勤 1,483個/149個/74.6%)
  2. 時間帯別生産数 (image2: 時間帯|時間当|累計|目標数, e.g. final 1,483)
     + 背番号別 (image3: FD03/FD32/FD31/(再) split)
  3. 設備稼働時間 (image4: 開始→終了, 実績時間[分], total 120.5分)
  4. 頻発停止実績/運転中異常実績 (image5: 機番×異常内容, 呼出/処置分, total 17回/23.2/51.3)
- **Original SQL:** `20260928_...利用クエリ/` — 8 files (4 outputs + 4 supports):
  - outputs: `f_10_1629_operational_availability_perday` (#1),
    `f_10_1629_quality_goods_number_by_day` (#2),
    `f_10_1629_actual_production_by_day` (#3),
    `f_10_1629_error_history_daily_alarm_timer` (+`f_10_1629_actual_marge`) (#4)
  - supports: `f_10_1629_loading_time`, `f_10_1629_quality_goods_number_perday`,
    `v_10_1629_actual_production_add_input`
  - Raw tables they read (`AM307A_*`, `L10_1629_*`, `m_*`, calendars) are NOT
    available — our 3 CSVs stand in for them; `m_work_names` is our stub
    (30 rows, CT=18 for FD03/FD32/FD31/(再), 0 for `***`, valid Aug 2026).

## What is built so far
- `01_schema.sql` — staging tables (all TEXT) + schema.
- `02_quality_goods_by_day.sql` — written by us (assistant): `m_work_names` stub,
  `v_ryohin_typed` view, `qgn_by_day(date)` pilot port of #2 detail
  (1 row per 時間帯×機種, filter `時間チェック` = Hour_Check 1/2/3),
  `qgn_perday(date)` per-shift aggregate. Validated: 08-01 all zero,
  08-03 hourly sum 1,873 → net 33,714s; month view shows Obon gap 8/8–8/16 = 0.
- `README.md` — reload + try queries.

## Feature-by-feature plan (each in its own folder)
- `feature-1(production-by-day)/` ← **FIRST AIM (current):** combine image2+image3
  + extras into ONE wide table per time-slot:
  `勤務日付軸, 日付, 勤務体制, 時間帯, 時間当, 累計, 目標数,`
  `FD03, FD32, FD31, FD03(再), FD32(再), FD31(再), 正味時間合計`
  (~22 rows/day, cumulative resets per shift). One query/day, best for vector embedding.
- `feature-2/` (next): 設備稼働時間 (#3) from `stg_seisan_jisseki`.
- `feature-3/` (next): 頻発停止実績 (#4) from `stg_ijo` (+ marge logic).
- `feature-4/` (last): 可動率/時間当出来高 (#1) = feature-1 totals + loading-time.

## Key mappings (don't re-derive)
- `インサートタイミング='時間チェック'` ⇔ `Hour_Check IN (1,2,3)`; exclude 直始め/生産数リセット.
- `時間別生産数`=Work_QTY_H (use this), `生産数`=cumulative (don't sum it).
- `正味時間` = 時間当生産数 × CT. `目標数` = 0 everywhere in August.
- Night shift spans midnight: `勤務日付軸=08-04` can have `日付=08-05` rows.
- Screenshot numbers are September (09/26), so shapes match August but totals differ.
