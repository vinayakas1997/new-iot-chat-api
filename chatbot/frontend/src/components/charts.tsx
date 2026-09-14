import type { ChartDatum } from "../lib/rag-api";

/** Dark-first minimal chart: line/bar/area as SVG, table as table. No lib needed. */
export function ChartView({ chart }: { chart: ChartDatum }) {
  if (chart.chart_type === "table" || !chart.x_column || !chart.y_columns.length) {
    return (
      <div className="overflow-auto rounded-lg border border-slate-200 dark:border-ink-800">
        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-ink-800">
              {chart.columns.map((c) => (
                <th key={c} className="px-3 py-2 font-semibold">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.slice(0, 20).map((r, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-ink-800">
                {chart.columns.map((c) => (
                  <td key={c} className="tnum px-3 py-1.5">{String(r[c] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const W = 520, H = 180, P = 28;
  const y0 = chart.y_columns[0];
  const vals = chart.rows.map((r) => Number(r[y0!] ?? 0)).filter((v) => Number.isFinite(v));
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const pts = chart.rows.slice(0, 40).map((r, i, a) => {
    const x = P + (i / Math.max(a.length - 1, 1)) * (W - 2 * P);
    const v = Number(r[y0!] ?? 0);
    const y = H - P - ((v - min) / Math.max(max - min, 1e-9)) * (H - 2 * P);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = "#14b8a6";
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-ink-800">
      <div className="mb-2 text-sm font-semibold">{chart.title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={P} x2={W - P} y1={H * f} y2={H * f} stroke="#2d333b" strokeWidth={1} opacity={0.5} />
        ))}
        {chart.chart_type === "bar" ? (
          pts.map((p, i) => {
            const [x, y] = p.split(",").map(Number);
            return <rect key={i} x={x - 5} y={y} width={10} height={Math.max(H - P - y, 2)} fill={color} opacity={0.8} rx={2} />;
          })
        ) : (
          <>
            {chart.chart_type === "area" && <polygon points={`${P},${H - P} ${pts.join(" ")} ${W - P},${H - P}`} fill={color} opacity={0.15} />}
            <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            {pts.map((p, i) => {
              const [x, y] = p.split(",").map(Number);
              return <circle key={i} cx={x} cy={y} r={2.5} fill={color} />;
            })}
          </>
        )}
      </svg>
      <div className="tnum mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{String(chart.rows[0]?.[chart.x_column] ?? "")}</span>
        <span>{y0} · max {max}</span>
      </div>
    </div>
  );
}
