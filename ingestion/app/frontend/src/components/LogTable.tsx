import type { ChartReadingRow, RunRow } from "../lib/api";
import { StatusChip } from "./chips";

export type LogFilter = "all" | "runs" | "readings" | "breaches";
export type LogRow = { kind: "run"; at: string; run: RunRow } | { kind: "reading"; at: string; reading: ChartReadingRow };

function readingResolution(r: ChartReadingRow): string | null {
  try {
    const j = JSON.parse(r.readingJson) as { resolution?: unknown };
    return typeof j.resolution === "string" && j.resolution ? j.resolution : null;
  } catch {
    return null;
  }
}

/** Merge runs + readings newest-first, then apply kind + stream filters. */
export function mergeLog(runs: RunRow[], readings: ChartReadingRow[], filter: LogFilter, stream: string | null): LogRow[] {
  const rows: LogRow[] = [
    ...runs.map((run): LogRow => ({ kind: "run", at: run.at, run })),
    ...readings.map((reading): LogRow => ({ kind: "reading", at: reading.at, reading })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return rows.filter((r) => {
    if (filter === "runs" && r.kind !== "run") return false;
    if (filter === "readings" && r.kind !== "reading") return false;
    if (filter === "breaches") {
      if (r.kind === "reading") {
        if (!r.reading.breach) return false;
      } else if (r.run.ok) return false;
    }
    if (stream) {
      if (r.kind === "run") return (r.run.resolution ?? "base") === stream;
      return readingResolution(r.reading) === stream;
    }
    return true;
  });
}

const FILTERS: { value: LogFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "runs", label: "Runs" },
  { value: "readings", label: "Readings" },
  { value: "breaches", label: "Breaches" },
];

/** F7 Zone 3 — one timeline for runs + readings. Row click opens the drawer. */
export function LogTable({ rows, filter, onFilter, stream, onOpen }: {
  rows: LogRow[];
  filter: LogFilter;
  onFilter: (f: LogFilter) => void;
  stream: string | null;
  onOpen: (row: LogRow) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => onFilter(f.value)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${
              filter === f.value
                ? "bg-accent-500/15 font-medium text-accent-500"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800"
            }`}
          >
            {f.label}
          </button>
        ))}
        {stream && <StatusChip tone="accent">stream: {stream}</StatusChip>}
        <span className="tnum ml-auto text-xs text-slate-400">{rows.length} rows</span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {rows.map((r) =>
          r.kind === "run" ? (
            <button
              key={`run-${r.run.id}`}
              onClick={() => onOpen(r)}
              className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:border-ink-800 dark:hover:bg-ink-800/50"
            >
              <span className="tnum shrink-0 text-slate-400">{new Date(r.run.at).toLocaleTimeString()}</span>
              <span className="truncate font-medium">{r.run.cardName}</span>
              <StatusChip tone={r.kind === "run" && r.run.kind === "test" ? "accent" : "mute"}>{r.run.kind}</StatusChip>
              <StatusChip tone={r.run.ok ? "ok" : "bad"}>{r.run.ok ? "ok" : "failed"}</StatusChip>
              <span className="tnum shrink-0 text-xs text-slate-400">{r.run.rowsPulled} rows</span>
            </button>
          ) : (
            <button
              key={`reading-${r.reading.id}`}
              onClick={() => onOpen(r)}
              className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:border-ink-800 dark:hover:bg-ink-800/50"
            >
              {r.reading.image ? (
                <img src={r.reading.image} alt="" className="h-8 w-14 shrink-0 rounded border border-slate-200 object-cover dark:border-ink-700" />
              ) : (
                <span className="flex h-8 w-14 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400 dark:border-ink-700">no img</span>
              )}
              <span className="tnum shrink-0 text-slate-400">{new Date(r.reading.at).toLocaleTimeString()}</span>
              <span className="truncate font-medium">{r.reading.chartKey || r.reading.cardId}</span>
              {r.reading.status === "error" ? (
                <StatusChip tone="bad">read failed</StatusChip>
              ) : r.reading.breach ? (
                <StatusChip tone="bad">breach</StatusChip>
              ) : (
                <StatusChip tone="ok">no breach</StatusChip>
              )}
              <span className="truncate text-xs text-slate-400">{r.reading.summary}</span>
            </button>
          )
        )}
        {rows.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-ink-700">
            Nothing here for this filter — readings appear after the first Snapshot &amp; Read.
          </div>
        )}
      </div>
    </div>
  );
}
