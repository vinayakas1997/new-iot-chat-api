# Line-12 August Postgres reproduction

DB: `plant` on `test-postgres` (localhost:5432 / plant / plant), schema `line12_august`.

## Files
- `01_schema.sql` — staging tables (all TEXT) matching the 3 August CSV headers.
- `02_quality_goods_by_day.sql` — `m_work_names` stub + typed view + pilot port of
  `f_10_1629_quality_goods_number_by_day` → `line12_august.qgn_by_day(date)`
  + aggregate `line12_august.qgn_perday(date)`.
  Mapping: `ｲﾝｻｰﾄﾀｲﾐﾝｸﾞ='時間チェック'` = `Hour_Check IN (1,2,3)`; `昼夜勤`→勤務体制;
  `生産時間帯`→時間帯; `時間別生産数`→Work_QTY_H; `CT`→ct; 正味時間=QTY*CT.

## Load (CSVs are UTF-8+BOM with Japanese header row)
```bash
docker cp "ingestion/line-12-IOTdata/August/生産実績.csv" app-test-postgres-1:/tmp/seisan.csv
docker cp "ingestion/line-12-IOTdata/August/明細表_良品生産数.csv" app-test-postgres-1:/tmp/ryohin.csv
docker cp "ingestion/line-12-IOTdata/August/明細表_異常情報.csv" app-test-postgres-1:/tmp/ijo.csv
docker exec -i app-test-postgres-1 psql -U plant -d plant < ingestion/line-12-IOTdata/postgres_port/01_schema.sql
docker exec app-test-postgres-1 psql -U plant -d plant -c "COPY line12_august.stg_seisan_jisseki FROM '/tmp/seisan.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');"
docker exec app-test-postgres-1 psql -U plant -d plant -c "COPY line12_august.stg_ryohin FROM '/tmp/ryohin.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');"
docker exec app-test-postgres-1 psql -U plant -d plant -c "COPY line12_august.stg_ijo FROM '/tmp/ijo.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');"
docker exec -i app-test-postgres-1 psql -U plant -d plant < ingestion/line-12-IOTdata/postgres_port/02_quality_goods_by_day.sql
```

Counts: seisan 41278 / ryohin 23466 / ijo 1361 (excl. header).

## Try
```sql
SELECT * FROM line12_august.qgn_by_day(DATE '2026-08-03') ORDER BY 時間帯, 機種 LIMIT 20;
SELECT * FROM line12_august.qgn_perday(DATE '2026-08-03');
-- month overview (shows Obon gap 8/8-8/16 = 0):
SELECT d::date AS day, q.* FROM generate_series(DATE '2026-08-01', DATE '2026-08-31', interval '1 day') d
LEFT JOIN LATERAL (SELECT * FROM line12_august.qgn_perday(d::date)) q ON true ORDER BY 1;
```

## Notes / next
- Pilot only covers quality-goods query. `actual_production_by_day`, `actual_marge`,
  `error_history`, `loading_time`, `operational_availability_perday` still need ports
  (need `m_actual_codes`, `m_error_codes`, shift-calendar stubs from 生産実績.csv / 異常情報.csv).
- `目標数` currently = 時間別目標生産数 (all 0 in August); confirm against raw `Target_QTY` if needed.
