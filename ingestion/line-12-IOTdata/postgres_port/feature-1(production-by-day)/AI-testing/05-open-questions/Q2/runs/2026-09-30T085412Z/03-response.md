# reply
Aggregated hourly good quantities for day shift on 2026/08/04, identified the peak hour, and calculated the day's total.

# sql
```sql
WITH hourly AS (
  SELECT
    setsubi_unit,
    setsubi_kiban,
    hiduke,
    chuyakin,
    seisan_jikantai,
    SUM(CAST(jikanbetsu_seisan AS INTEGER)) AS hourly_qty,
    SUM(CAST(jikanbetsu_mokuhyo AS INTEGER)) AS hourly_target
  FROM line12_august.stg_ryohin
  WHERE chuyakin = '昼勤'
    AND hiduke >= '2026/08/04 00:00:00'
    AND hiduke < '2026/08/05 00:00:00'
    AND insert_timing = '時間チェック'
  GROUP BY setsubi_unit, setsubi_kiban, hiduke, chuyakin, seisan_jikantai
),
max_hour AS (
  SELECT * FROM hourly
  ORDER BY hourly_qty DESC
  LIMIT 1
),
day_total AS (
  SELECT SUM(hourly_qty) AS total_qty FROM hourly
)
SELECT m.seisan_jikantai AS hour, m.hourly_qty, d.total_qty
FROM max_hour m, day_total d
```

# meta
type=round attempts=1 rowCount=1 tables=['line12_august.stg_ryohin']

# steps
- found table stg_ryohin
- columns: hiduke, chuyakin, seisan_jikantai, jikanbetsu_seisan, insert_timing
- filter: day shift (昼勤), date 2026/08/04, time_check rows
- writing query: aggregate hourly, find max, compute day total
- running
