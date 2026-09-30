-- Port of f_10_1629_quality_goods_number_by_day (@date) to Postgres.
-- Original: somic.dbo.AM307A_QUALITY_GOODS_NUMBER_1 + m_work_names, filter Hour_Check IN (1,2,3)
-- CSV mapping (reverse-engineered from 明細表_良品生産数.csv):
--   勤務日付軸 -> AB_SECTION_DAY, 設備ユニット -> Machine_Code, 日付 -> INSERT_DATE,
--   昼夜勤 -> 勤務体制 (replaces f_check_shift_day_or_night_type_early_in),
--   生産時間帯 -> 時間帯 (replaces f_get_time_axis),
--   機種番号 -> Work_No, 背番号 -> work_name, CT -> ct,
--   時間別目標生産数 -> Target_QTY (per-slot), 時間別生産数 -> Work_QTY_H,
--   ｲﾝｻｰﾄﾀｲﾐﾝｸﾞ='時間チェック' <-> Hour_Check IN (1,2,3); '直始め'/'生産数リセット' excluded.

-- Master stub derived from CSV distincts (unit 10-1629 / machine AM-307A)
DROP TABLE IF EXISTS line12_august.m_work_names;
CREATE TABLE line12_august.m_work_names (
  unit_code TEXT NOT NULL,
  machine_no TEXT NOT NULL,
  work_no INT NOT NULL,
  work_name TEXT NOT NULL,
  ct NUMERIC(8,2) NOT NULL,
  begin_date DATE NOT NULL,
  end_date DATE NOT NULL,
  PRIMARY KEY (unit_code, machine_no, work_no)
);
INSERT INTO line12_august.m_work_names (unit_code, machine_no, work_no, work_name, ct, begin_date, end_date)
SELECT DISTINCT
  '10-1629', 'AM-307A',
  kishu_no::INT, se_no,
  CASE WHEN ct = '' THEN 0 ELSE ct::NUMERIC(8,2) END,
  DATE '2026-08-01', DATE '2026-08-31'
FROM line12_august.stg_ryohin
ON CONFLICT DO NOTHING;

-- Typed view over staging (casts once, NULL-safe)
DROP VIEW IF EXISTS line12_august.v_ryohin_typed;
CREATE VIEW line12_august.v_ryohin_typed AS
SELECT
  to_date(kinmu_hidukejiku, 'YYYY/MM/DD') AS ab_section_day,
  setsubi_unit AS machine_code,
  setsubi_kiban AS machine_no,
  to_timestamp(hiduke, 'YYYY/MM/DD HH24:MI:SS') AS insert_date,
  chuyakin AS shift_type,
  seisan_jikantai AS time_axis,
  jikan_taisei AS time_system,
  NULLIF(jikanbetsu_mokuhyo,'')::INT AS target_qty_h,
  NULLIF(mokuhyo,'')::INT AS target_qty,
  NULLIF(kishu_no,'')::INT AS work_no,
  se_no AS work_name_csv,
  NULLIF(jikanbetsu_seisan,'')::INT AS work_qty_h,
  NULLIF(seisan_su,'')::INT AS work_qty_cum,
  CASE WHEN ct = '' THEN 0 ELSE ct::NUMERIC(8,2) END AS ct_csv,
  insert_timing AS hour_check_text
FROM line12_august.stg_ryohin;

-- Pilot function: quality goods number by day (one date)
DROP FUNCTION IF EXISTS line12_august.qgn_by_day(DATE);
CREATE FUNCTION line12_august.qgn_by_day(p_date DATE)
RETURNS TABLE (
  設備コード TEXT,
  勤務日付軸 DATE,
  日付 TEXT,
  勤務体制 TEXT,
  時間帯 TEXT,
  機種 INT,
  背番号 TEXT,
  目標数 INT,
  時間当生産数 INT,
  CT NUMERIC(8,2),
  正味時間 NUMERIC(8,2)
)
LANGUAGE sql STABLE AS $$
  SELECT
    t.machine_code,
    t.ab_section_day,
    to_char(t.insert_date, 'YYYY-MM-DD'),
    t.shift_type,
    t.time_axis,
    t.work_no,
    w.work_name,
    t.target_qty_h,
    t.work_qty_h,
    w.ct,
    (t.work_qty_h * w.ct)::NUMERIC(8,2)
  FROM line12_august.v_ryohin_typed t
  JOIN line12_august.m_work_names w
    ON w.unit_code = '10-1629'
   AND w.machine_no = 'AM-307A'
   AND t.work_no = w.work_no
   AND w.begin_date <= p_date
   AND w.end_date >= p_date
  WHERE t.ab_section_day = p_date
    AND t.hour_check_text = '時間チェック'  -- = Hour_Check IN (1,2,3)
$$;

-- Per-day aggregate (mirrors f_10_1629_quality_goods_number_perday output shape, simplified)
DROP FUNCTION IF EXISTS line12_august.qgn_perday(DATE);
CREATE FUNCTION line12_august.qgn_perday(p_date DATE)
RETURNS TABLE (
  設備コード TEXT,
  勤務日付軸 DATE,
  勤務体制 TEXT,
  総生産数 INT,
  正味時間 NUMERIC(10,2)
)
LANGUAGE sql STABLE AS $$
  SELECT
    t.machine_code,
    t.ab_section_day,
    t.shift_type,
    SUM(t.work_qty_h)::INT,
    SUM(t.work_qty_h * w.ct)::NUMERIC(10,2)
  FROM line12_august.v_ryohin_typed t
  JOIN line12_august.m_work_names w
    ON w.unit_code = '10-1629'
   AND w.machine_no = 'AM-307A'
   AND t.work_no = w.work_no
  WHERE t.ab_section_day = p_date
    AND t.hour_check_text = '時間チェック'
  GROUP BY t.machine_code, t.ab_section_day, t.shift_type
$$;
