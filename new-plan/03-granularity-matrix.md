# 03 — Granularity Matrix (full level — single source of truth)

> Read this table before writing any SQL, context, fact, recall filter, or chart.
> Every row below must agree: SQL query → ContextUnit → Fact.timeScope → recall filter → chart axis.

## 1. Hierarchy (where does each fact belong?)

```
plant (1 per deployment, e.g. "vina-plant")
 └─ line (bank boundary, e.g. "line-3")        <- bankId = "line:<lineId>"
     └─ machine (e.g. "m-12", "press-04")
```

- `bankId` is **per line**. A recall for line-3 never sees line-5 facts.
- Every fact carries `entities[]` with at least one of `{type:'line'|'machine', name}`.
- Plant-level rollups are derived at query time (recall all lines), never stored as
  separate banks in v1.

## 2. Full matrix

| Granularity | Window | SQL function | ContextUnit | Fact.timeScope | Recall filter example | Chart use |
|---|---|---|---|---|---|---|
| `instant` (raw event) | point in time | `fetchRawEvents(machine, win)` | `buildEventUnits` — 1 unit per alarm/downtime/changeover/quality event | `{granularity:'instant', start: eventTs}` + `event{kind,severity,durationMin?}` | `recall("downtime press-04", granularity:'instant')` | Indicator / event markers on line chart |
| `hourly` | 60 min, aligned to clock hour | `fetchHourlyBreakdown(line, date)` | `buildHourlyUnits` — 1 unit per line+hour (sums/avgs + text) | `{granularity:'hourly', start, end: start+1h}` + `metric{aggregation:'sum'/'avg'}` | `recall("OEE", granularity:'hourly')` | Line/Bar chart, 24 points/day |
| `shift` | 8h (S1 06-14, S2 14-22, S3 22-06, configurable in `shift.ts`) | `fetchShiftAggregates(line, date, shiftDef)` | `buildShiftUnits` — 1 unit per line+shift | `{granularity:'shift', start, end}` | `recall("scrap rate", granularity:'shift')` | Bar chart, 3 bars/day; shift-meeting view |
| `daily` | calendar day (plant tz, e.g. Asia/Ho_Chi_Minh) | `fetchDailySummary(line, date)` **independent query** | `buildDailyUnits` — 1 unit per line+day | `{granularity:'daily', start, end}` | `recall("OEE yesterday", granularity:'daily')` | IndicatorValue headline + trend line |
| `weekly` (v1 optional) | Mon–Sun | `fetchWeeklyRollup(line, week)` | `buildWeeklyUnits` — 1 unit per line+week | `{granularity:'hourly'...}` no — use `daily` facts aggregated at chart time; **do not store weekly facts in v1** | recall 7x daily facts | 7-point trend without extra ingestion |

**Locked rule:** `daily` is **independently queried**, never derived as sum-of-hourly.
Two SQL paths silently disagreeing (rounding, late rows, shift boundaries) is the #1
source of "chat says 71%, report says 73%" bugs. Hourly is for intraday drill-down;
daily is the headline number.

## 3. Metric catalogue (what names are allowed?)

`Fact.metric.name` must come from this list (else charts cannot map series):

| metric name | unit | aggregation | thresholds (default) |
|---|---|---|---|
| `oee` | ratio 0–1 | avg | min 0.75 (breach if below) |
| `downtime_min` | min | sum | max 30/day |
| `scrap_rate` | ratio 0–1 | avg/sum | max 0.05 |
| `units_produced` / `units_scrapped` | count | sum | — |
| `runtime_min` | min | sum | — |

`evaluate.ts` (report) regex-parses exactly these names from recalled statements.
Adding a metric = update this table + `fact-schema.ts` comment + `evaluate.ts` + chart mapper.

## 4. Tagging convention (how recall + charts filter)

Every retained fact gets `tags[]`:

```
[granularity:<g>, schema:1, line:<id>, machine:<id>?, metric:<name>?, event:<kind>?]
```

Examples:
- `["granularity:daily","schema:1","line:line-3","metric:oee"]`
- `["granularity:instant","schema:1","line:line-3","machine:press-04","event:downtime"]`

Recall passes `granularity?` through; charts group by `metric` tag.

## 5. Timezone rule

All `windowStart/End`, `nextRunAt`, history dates use the **plant timezone**
(`PLANT_TZ`, e.g. `Asia/Ho_Chi_Minh`), never server UTC. Schedule parsing, daily
boundaries, and shift windows all read this one env. DST-safe via `Intl`/`cron` tz-aware.
