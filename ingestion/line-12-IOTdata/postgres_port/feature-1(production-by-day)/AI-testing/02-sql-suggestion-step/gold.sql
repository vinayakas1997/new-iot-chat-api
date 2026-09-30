-- Gold query for the sql-suggestion test, written in the SAME contract the app's
-- suggest-sql prompt demands: SELECT-only, {{from}}/{{to}} placeholders on a
-- timestamp, GROUP BY bucket, aliased columns, SUM for counters.
-- Test window: {{from}}='2026-08-04 00:00:00', {{to}}='2026-08-05 00:00:00'.
-- Expected: 10 rows (昼勤 slots), hourly + FD split + running cumulative,
-- identical numbers to line12_august.qgn_daily_combined(DATE '2026-08-04','昼勤').
WITH base AS (
  SELECT
    t.seisan_jikantai AS slot,
    t.jikanbetsu_seisan::INT AS h_qty,
    t.jikanbetsu_mokuhyo::INT AS t_qty,
    t.kishu_no::INT AS work_no,
    CASE WHEN t.ct = '' THEN 0 ELSE t.ct::NUMERIC END AS ct
  FROM line12_august.stg_ryohin t
  WHERE to_timestamp(t.hiduke, 'YYYY/MM/DD HH24:MI:SS')
          >= '{{from}}'::TIMESTAMP
    AND to_timestamp(t.hiduke, 'YYYY/MM/DD HH24:MI:SS')
          < '{{to}}'::TIMESTAMP
    AND t.chuyakin = '昼勤'
    AND t.insert_timing = '時間チェック'
),
per_slot AS (
  SELECT
    slot,
    SUM(h_qty) AS hourly_qty,
    SUM(t_qty) AS target_qty,
    SUM(CASE WHEN work_no = 7 THEN h_qty ELSE 0 END) AS fd03_new,
    SUM(CASE WHEN work_no = 8 THEN h_qty ELSE 0 END) AS fd32_new,
    SUM(CASE WHEN work_no = 9 THEN h_qty ELSE 0 END) AS fd31_new,
    SUM(CASE WHEN work_no = 27 THEN h_qty ELSE 0 END) AS fd03_rework,
    SUM(CASE WHEN work_no = 28 THEN h_qty ELSE 0 END) AS fd32_rework,
    SUM(CASE WHEN work_no = 29 THEN h_qty ELSE 0 END) AS fd31_rework,
    SUM(h_qty * ct)::INT AS net_sec
  FROM base
  GROUP BY slot
)
SELECT
  slot,
  hourly_qty,
  SUM(hourly_qty) OVER (ORDER BY slot)::BIGINT AS cumulative_qty,
  target_qty,
  fd03_new, fd32_new, fd31_new,
  fd03_rework, fd32_rework, fd31_rework,
  net_sec
FROM per_slot
ORDER BY slot;
