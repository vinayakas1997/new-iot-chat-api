-- Line-12 August research: staging schema for 1-month CSV reproduction.
-- DB: plant (test-postgres), schema: line12_august
-- Source CSVs in ingestion/line-12-IOTdata/August/ (UTF-8 with BOM, headers as below).
-- All staging columns are TEXT to make COPY robust; typed views cast on read.

CREATE SCHEMA IF NOT EXISTS line12_august;

-- 1) 生産実績.csv (41279 rows)
-- "日付","設備ユニット","設備機番","勤務日付軸","昼夜勤","生産時間帯","時間体制","作業者","実績コード","実績内容","ON/OFF","実績時間"
DROP TABLE IF EXISTS line12_august.stg_seisan_jisseki;
CREATE TABLE line12_august.stg_seisan_jisseki (
  hiduke TEXT,
  setsubi_unit TEXT,
  setsubi_kiban TEXT,
  kinmu_hidukejiku TEXT,
  chuyakin TEXT,
  seisan_jikantai TEXT,
  jikan_taisei TEXT,
  sagyosha TEXT,
  jisseki_code TEXT,
  jisseki_naiyo TEXT,
  on_off TEXT,
  jisseki_jikan TEXT
);

-- 2) 明細表_良品生産数.csv (23467 rows)
-- "勤務日付軸","設備ユニット","設備機番","日付","昼夜勤","生産時間帯","時間体制","時間別目標生産数","目標生産数","機種番号","背番号","時間別生産数","生産数","CT","ｲﾝｻｰﾄﾀｲﾐﾝｸﾞ"
DROP TABLE IF EXISTS line12_august.stg_ryohin;
CREATE TABLE line12_august.stg_ryohin (
  kinmu_hidukejiku TEXT,
  setsubi_unit TEXT,
  setsubi_kiban TEXT,
  hiduke TEXT,
  chuyakin TEXT,
  seisan_jikantai TEXT,
  jikan_taisei TEXT,
  jikanbetsu_mokuhyo TEXT,
  mokuhyo TEXT,
  kishu_no TEXT,
  se_no TEXT,
  jikanbetsu_seisan TEXT,
  seisan_su TEXT,
  ct TEXT,
  insert_timing TEXT
);

-- 3) 明細表_異常情報.csv (1362 rows, 31 cols)
DROP TABLE IF EXISTS line12_august.stg_ijo;
CREATE TABLE line12_august.stg_ijo (
  hiduke TEXT,
  kinmu_hidukejiku TEXT,
  chuyakin TEXT,
  unit_code TEXT,
  kotei_junban TEXT,
  kiban TEXT,
  jikantai TEXT,
  sagyosha TEXT,
  unten_mode TEXT,
  ijo_shurui TEXT,
  ijo_no TEXT,
  ijo_naiyo TEXT,
  on_off TEXT,
  kidouji_teishi_s TEXT,
  untenchu_teishi_s TEXT,
  work_no_st1 TEXT,
  work_no_st2 TEXT,
  work_no_st3 TEXT,
  work_no_st4 TEXT,
  work_no_st5 TEXT,
  work_no_st6 TEXT,
  work_no_st7 TEXT,
  work_no_st8 TEXT,
  serial_st1 TEXT,
  serial_st2 TEXT,
  serial_st3 TEXT,
  serial_st4 TEXT,
  serial_st5 TEXT,
  serial_st6 TEXT,
  serial_st7 TEXT,
  serial_st8 TEXT
);
