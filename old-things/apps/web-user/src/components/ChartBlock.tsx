/**
 * ChartBlock — renders one ChartData envelope object with [Chart | Data | SQL] tabs.
 *
 * Layout idea adopted from DB-GPT (rebuilt in our stack — no antd/g2):
 *  - web/components/chat/chat-content/chart-view.tsx (ChartView → Tabs[Chart,SQL,Data])
 *  - web/components/chart/{bar-chart,line-chart,pie-chart,table-chart}.tsx
 * See new-plan/05-ui-design.md §2.2.
 */
import { useState } from 'react';
import type { ChartData } from '@app/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const PALETTE = ['#4f8ff7', '#22b07d', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

type SeriesRow = Record<string, string | number | null>;

/** Pivot column-major ChartValues into row objects keyed by column_name. */
function toRows(chart: ChartData): SeriesRow[] {
  const cols = chart.column_name;
  if (!cols.length || !chart.values.length) return [];
  // IndicatorValue / Pie shapes store one value per entry — handled by their renderers.
  if (chart.chart_type === 'IndicatorValue' || chart.chart_type === 'PieChart') return [];
  const perRow = cols.length;
  const n = Math.ceil(chart.values.length / perRow);
  const rows: SeriesRow[] = [];
  for (let i = 0; i < n; i++) {
    const row: SeriesRow = {};
    for (let c = 0; c < cols.length; c++) {
      const v = chart.values[i * perRow + c];
      row[cols[c]!] = v ? (v.value as string | number | null) : null;
    }
    rows.push(row);
  }
  return rows;
}

function xKey(chart: ChartData): string {
  return chart.column_name[0] ?? 'x';
}

function numericKeys(chart: ChartData): string[] {
  const rows = toRows(chart);
  const first = rows[0] ?? {};
  return chart.column_name.slice(1).filter((c) => typeof first[c] === 'number');
}

function fmtCell(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  const s = String(v);
  return s.length > 24 ? s.slice(0, 24) + '…' : s;
}

function ChartBody({ chart }: { chart: ChartData }) {
  if (chart.chart_type === 'IndicatorValue') {
    const v = chart.values[0];
    return (
      <div className="flex items-baseline gap-2 px-1 py-3">
        <span className="text-[30px] font-bold leading-none">{fmtCell(v?.value)}</span>
        <span className="muted text-[12px]">{v?.name ?? ''}</span>
      </div>
    );
  }
  if (chart.chart_type === 'PieChart') {
    const data = chart.values.map((v, i) => ({ name: v.name, value: Number(v.value) || 0, fill: PALETTE[i % PALETTE.length] }));
    return (
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={80} label />
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chart.chart_type === 'Table') {
    const rows = toRows(chart);
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {chart.column_name.map((c) => (
                <th key={c} className="border bg-[var(--surface-2)] px-2 py-1 text-left font-semibold" style={{ borderColor: 'var(--line)' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((r, i) => (
              <tr key={i}>
                {chart.column_name.map((c) => (
                  <td key={c} className="border px-2 py-1" style={{ borderColor: 'var(--line)' }}>{fmtCell(r[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const rows = toRows(chart);
  const keys = numericKeys(chart);
  if (!rows.length || !keys.length) return <div className="muted p-2 text-[12px]">No plottable series.</div>;
  const xk = xKey(chart);
  if (chart.chart_type === 'BarChart') {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey={xk} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey={xk} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        {keys.map((k, i) => (
          <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} dot={false} />
        ))}
        {keys.map((_, i) => (
          <Cell key={i} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ChartBlock({ chart }: { chart: ChartData }) {
  const [tab, setTab] = useState<'chart' | 'data' | 'sql'>('chart');
  const rows = toRows(chart);
  return (
    <div className="my-2 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
      <div className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5" style={{ borderColor: 'var(--line)' }}>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-bold">{chart.chart_name}</div>
          {chart.chart_desc && <div className="muted truncate text-[11px]">{chart.chart_desc}</div>}
        </div>
        <div className="flex shrink-0 gap-1 text-[11px]">
          {(['chart', 'data', 'sql'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2 py-0.5 font-semibold capitalize ${tab === t ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'muted'}`}
            >
              {t === 'sql' ? 'SQL' : t === 'data' ? 'Data' : chart.chart_type}
            </button>
          ))}
        </div>
      </div>
      <div className="p-2">
        {tab === 'chart' && <ChartBody chart={chart} />}
        {tab === 'data' && (
          <div className="max-h-48 overflow-auto text-[12px]">
            {rows.length ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr>{chart.column_name.map((c) => <th key={c} className="border px-2 py-1 text-left" style={{ borderColor: 'var(--line)' }}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>{chart.column_name.map((c) => <td key={c} className="border px-2 py-1" style={{ borderColor: 'var(--line)' }}>{fmtCell(r[c])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <span className="muted">{chart.values.map((v) => `${v.name}: ${fmtCell(v.value)}`).join(' · ') || 'No rows.'}</span>
            )}
          </div>
        )}
        {tab === 'sql' && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11.5px] leading-[1.5]">{chart.chart_sql || 'SQL not recorded.'}</pre>
        )}
      </div>
    </div>
  );
}
