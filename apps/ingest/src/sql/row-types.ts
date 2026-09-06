/** Row shapes returned by the §5.2 query set. Mirrors the mock sample data. */
export interface ProductionRow {
  id: number;
  line_id: string;
  machine_id: string;
  ts: string;
  units_produced: number;
  units_scrapped: number;
  runtime_min: number;
  downtime_min: number;
  oee: number;
  status: 'new' | 'pending' | 'ingested';
}

export interface HourlyRow {
  line_id: string;
  hour: string;
  units_produced: number;
  units_scrapped: number;
  avg_oee: number;
  downtime_min: number;
}
