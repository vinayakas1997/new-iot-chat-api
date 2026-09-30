-- Feature-1: combined 時間帯別生産数 (image2) + 背番号別 (image3), enriched for vector DB.
-- One wide row per time-slot: date/shift tags + totals + new-vs-rework split.
-- Source: line12_august.v_ryohin_typed + line12_august.m_work_names (see ../02_quality_goods_by_day.sql).
--
-- Work-no meaning (locked with user):
--   FD03 new  = work_no  7,  FD03(再) rework = work_no 27
--   FD32 new  = work_no  8,  FD32(再) rework = work_no 28
--   FD31 new  = work_no  9,  FD31(再) rework = work_no 29   (CT = 18 for all six)
--   other work_no (***, CT 0) contribute to 時間当 only (always 0 in August).
-- Filter: insert_timing = '時間チェック'  <=>  Hour_Check IN (1,2,3).
-- 日付 rolls over midnight for 夜勤 (slot_ts = 勤務日付軸+1 day for 00:xx-11:xx night slots).

DROP FUNCTION IF EXISTS line12_august.qgn_daily_combined(DATE, TEXT);

CREATE FUNCTION line12_august.qgn_daily_combined(p_date DATE, p_shift TEXT DEFAULT NULL)
RETURNS TABLE (
  slot_ts TIMESTAMPTZ,
  勤務日付軸 DATE,
  日付 TEXT,
  勤務体制 TEXT,
  時間帯 TEXT,
  時間当 INT,
  累計 BIGINT,
  目標数 INT,
  "FD03[7]" INT,
  "FD32[8]" INT,
  "FD31[9]" INT,
  "FD03(再)[27]" INT,
  "FD32(再)[28]" INT,
  "FD31(再)[29]" INT,
  正味時間秒 INT
)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT
      t.ab_section_day,
      t.shift_type,
      t.time_axis,
      -- night slots after midnight belong to the next calendar day
      ((t.ab_section_day + t.time_axis::time) AT TIME ZONE 'Asia/Tokyo'
        + CASE WHEN t.shift_type = '夜勤' AND t.time_axis < '12:00'
               THEN interval '1 day' ELSE interval '0' END) AS slot_ts,
      t.work_no,
      t.work_qty_h,
      t.target_qty_h,
      w.ct
    FROM line12_august.v_ryohin_typed t
    JOIN line12_august.m_work_names w
      ON w.unit_code = '10-1629'
     AND w.machine_no = 'AM-307A'
     AND t.work_no = w.work_no
     AND w.begin_date <= p_date
     AND w.end_date >= p_date
    WHERE t.ab_section_day = p_date
      AND t.hour_check_text = '時間チェック'
      AND (p_shift IS NULL OR t.shift_type = p_shift)
  ),
  per_slot AS (
    SELECT
      min(slot_ts) AS slot_ts,
      ab_section_day,
      shift_type,
      time_axis,
      SUM(work_qty_h)::INT AS 時間当,
      SUM(target_qty_h)::INT AS 目標数,
      SUM(CASE WHEN work_no = 7 THEN work_qty_h ELSE 0 END)::INT AS fd03,
      SUM(CASE WHEN work_no = 8 THEN work_qty_h ELSE 0 END)::INT AS fd32,
      SUM(CASE WHEN work_no = 9 THEN work_qty_h ELSE 0 END)::INT AS fd31,
      SUM(CASE WHEN work_no = 27 THEN work_qty_h ELSE 0 END)::INT AS fd03_r,
      SUM(CASE WHEN work_no = 28 THEN work_qty_h ELSE 0 END)::INT AS fd32_r,
      SUM(CASE WHEN work_no = 29 THEN work_qty_h ELSE 0 END)::INT AS fd31_r,
      SUM(work_qty_h * ct)::INT AS 正味時間秒
    FROM base
    GROUP BY ab_section_day, shift_type, time_axis
  )
  SELECT
    s.slot_ts,
    s.ab_section_day,
    to_char(s.slot_ts AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD'),
    s.shift_type,
    s.time_axis,
    s.時間当,
    SUM(s.時間当) OVER (PARTITION BY s.shift_type ORDER BY s.slot_ts)::BIGINT AS 累計,
    s.目標数,
    s.fd03, s.fd32, s.fd31, s.fd03_r, s.fd32_r, s.fd31_r,
    s.正味時間秒
  FROM per_slot s
  ORDER BY s.shift_type, s.slot_ts
$$;

-- Examples:
--   -- one shift (matches Word image2 shape, 昼勤 09:20-19:20):
--   SELECT * FROM line12_august.qgn_daily_combined(DATE '2026-08-04', '昼勤');
--   -- both shifts of a day (cumulative resets per shift):
--   SELECT * FROM line12_august.qgn_daily_combined(DATE '2026-08-04', NULL);
--   -- whole month, one row per shift-day (for KPI join / feature-4 later):
--   SELECT d::date AS day, q.勤務体制, max(q.累計) AS shift_total
--   FROM generate_series(DATE '2026-08-01', DATE '2026-08-31', interval '1 day') d
--   LEFT JOIN LATERAL line12_august.qgn_daily_combined(d::date, NULL) q ON true
--   GROUP BY 1, 2 ORDER BY 1, 2;
