/**
 * Sample plant rows used by mock mode. Shape mirrors what the real §5.2 SQL
 * query set is expected to return, so the ingestion stubs downstream don't
 * change when live data replaces this.
 */
export interface ProductionRow {
  id: number;
  line_id: string;
  machine_id: string;
  ts: string; // ISO
  units_produced: number;
  units_scrapped: number;
  runtime_min: number;
  downtime_min: number;
  oee: number; // 0..1
  status: 'new' | 'pending' | 'ingested';
}

export const SAMPLE_NEW_ROWS: ProductionRow[] = [
  {
    id: 1001,
    line_id: 'line-3',
    machine_id: 'welder-07',
    ts: '2026-09-05T08:00:00.000Z',
    units_produced: 420,
    units_scrapped: 12,
    runtime_min: 55,
    downtime_min: 5,
    oee: 0.82,
    status: 'new',
  },
  {
    id: 1002,
    line_id: 'line-3',
    machine_id: 'welder-07',
    ts: '2026-09-05T09:00:00.000Z',
    units_produced: 390,
    units_scrapped: 30,
    runtime_min: 48,
    downtime_min: 12,
    oee: 0.71,
    status: 'new',
  },
  {
    id: 1003,
    line_id: 'line-3',
    machine_id: 'press-02',
    ts: '2026-09-05T09:00:00.000Z',
    units_produced: 610,
    units_scrapped: 4,
    runtime_min: 58,
    downtime_min: 2,
    oee: 0.93,
    status: 'new',
  },
  {
    id: 2001,
    line_id: 'line-1',
    machine_id: 'press-01',
    ts: '2026-09-05T08:00:00.000Z',
    units_produced: 500,
    units_scrapped: 8,
    runtime_min: 57,
    downtime_min: 3,
    oee: 0.88,
    status: 'new',
  },
  {
    id: 2002,
    line_id: 'line-1',
    machine_id: 'press-01',
    ts: '2026-09-05T09:00:00.000Z',
    units_produced: 480,
    units_scrapped: 22,
    runtime_min: 50,
    downtime_min: 10,
    oee: 0.76,
    status: 'new',
  },
  {
    id: 3001,
    line_id: 'line-2',
    machine_id: 'welder-03',
    ts: '2026-09-05T08:00:00.000Z',
    units_produced: 350,
    units_scrapped: 5,
    runtime_min: 59,
    downtime_min: 1,
    oee: 0.95,
    status: 'new',
  },
];

export interface HourlyRow {
  line_id: string;
  hour: string; // ISO hour
  units_produced: number;
  units_scrapped: number;
  avg_oee: number;
  downtime_min: number;
}

export const SAMPLE_HOURLY_ROWS: HourlyRow[] = [
  {
    line_id: 'line-3',
    hour: '2026-09-05T08:00:00.000Z',
    units_produced: 420,
    units_scrapped: 12,
    avg_oee: 0.82,
    downtime_min: 5,
  },
  {
    line_id: 'line-3',
    hour: '2026-09-05T09:00:00.000Z',
    units_produced: 1000,
    units_scrapped: 34,
    avg_oee: 0.82,
    downtime_min: 14,
  },
  {
    line_id: 'line-1',
    hour: '2026-09-05T08:00:00.000Z',
    units_produced: 500,
    units_scrapped: 8,
    avg_oee: 0.88,
    downtime_min: 3,
  },
  {
    line_id: 'line-1',
    hour: '2026-09-05T09:00:00.000Z',
    units_produced: 480,
    units_scrapped: 22,
    avg_oee: 0.76,
    downtime_min: 10,
  },
  {
    line_id: 'line-2',
    hour: '2026-09-05T08:00:00.000Z',
    units_produced: 350,
    units_scrapped: 5,
    avg_oee: 0.95,
    downtime_min: 1,
  },
];
