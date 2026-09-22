import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Radar, Search } from "lucide-react";
import {
  api, historyApi, overviewApi, readingApi, ticketApi,
  type ChartReadingRow, type DayView, type Line, type LineHealth, type RunRow, type TicketRow,
} from "../lib/api";
import { AlertBanner, StatusChip } from "../components/chips";
import { timeAgo, countdownTo } from "../lib/format";
import { EmptyState } from "../components/ui";
import { HealthTiles } from "../components/HealthTiles";
import { LogTable, mergeLog, type LogFilter, type LogRow } from "../components/LogTable";
import { ReadingDrawer } from "../components/ReadingDrawer";
import { TicketSidebar } from "../components/TicketSidebar";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Zone 1 plant-feed pill: the raw sampler signal lives beside the line
 * name (a line property, not one stream among many). Dot + last/next,
 * same health rule as the stream cards.
 */
function FeedPill({ lastTick, quietHours }: { lastTick: string | null; quietHours: number | null }) {
  const stale = lastTick == null || (quietHours ?? 0) > 6;
  const dot = lastTick == null ? "bg-slate-300 dark:bg-ink-700" : stale ? "bg-state-warn" : "bg-state-ok";
  const next = lastTick ? new Date(new Date(lastTick).getTime() + 3600_000).toISOString() : null;
  return (
    <span className="tnum inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-500 dark:border-ink-700">
      <span title={lastTick == null ? "never ticked" : stale ? "plant feed quiet" : "plant feed live"} className={`h-2 w-2 rounded-full ${dot}`} />
      plant feed {lastTick == null ? "never ticked" : stale ? "quiet" : "live"} · last {timeAgo(lastTick)} · next {countdownTo(next)}
    </span>
  );
}

/**
 * F7 Overview — Line 360°: search → health cards → unified log table
 * (runs + readings, click for image + prompt + ticket) → tickets sidebar.
 */
export function Overview() {
  const [params, setParams] = useSearchParams();
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [lineId, setLineId] = useState(params.get("line") ?? "");
  const [identity, setIdentity] = useState<(Line & { quietHours: number | null }) | null>(null);
  const [health, setHealth] = useState<LineHealth | null>(null);
  const [date, setDate] = useState(today());
  const [day, setDay] = useState<DayView | null>(null);
  const [readings, setReadings] = useState<ChartReadingRow[]>([]);
  const [ticketsOpen, setTicketsOpen] = useState<TicketRow[]>([]);
  const [ticketsClosed, setTicketsClosed] = useState<TicketRow[]>([]);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [stream, setStream] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<LogRow | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listLines().then(setLines).catch((e) => setError((e as Error).message));
  }, []);

  async function loadTickets(id: string) {
    setTicketsLoading(true);
    try {
      const [o, c] = await Promise.all([ticketApi.list(id, "open"), ticketApi.list(id, "closed")]);
      setTicketsOpen(o.rows);
      setTicketsClosed(c.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTicketsLoading(false);
    }
  }

  async function selectLine(id: string, d = today()) {
    setLineId(id);
    setParams(id ? { line: id } : {});
    setError(null);
    setDrawer(null);
    setStream(null);
    try {
      const [ident, h, dy, rd] = await Promise.all([
        historyApi.line(id),
        overviewApi.health(id),
        historyApi.day(id, d),
        readingApi.list(id),
      ]);
      setIdentity(ident);
      setHealth(h);
      setDate(d);
      setDay(dy);
      setReadings(rd.rows);
      void loadTickets(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    const preset = params.get("line");
    if (preset) void selectLine(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickDate(d: string) {
    setDate(d);
    if (!lineId) return;
    try {
      setDay(await historyApi.day(lineId, d));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function viewReading(readingId: number) {
    try {
      const r = await readingApi.get(readingId);
      setDrawer({ kind: "reading", at: r.at, reading: r });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const matches = lines.filter((l) => `${l.id} ${l.name}`.toLowerCase().includes(q.toLowerCase()));
  const runs: RunRow[] = day?.runs ?? [];
  const rows = mergeLog(runs, readings, filter, stream);

  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Radar size={22} className="text-accent-500" /> Line 360°
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">one line, everything — health, logs, readings, tickets</p>

      {error && <div className="mt-4"><AlertBanner tone="bad" title="Request failed" detail={error} /></div>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search line by name…"
            className="w-80 rounded-lg border border-slate-300 bg-transparent py-2 pl-9 pr-3 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
          />
        </div>
        {lineId && (
          <label className="flex items-center gap-2 text-sm text-slate-400">
            log date
            <input
              type="date"
              value={date}
              onChange={(e) => void pickDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 text-sm text-slate-700 focus:border-accent-500 focus:outline-none dark:border-ink-700 dark:text-ink-200"
            />
          </label>
        )}
      </div>
      {q && (
        <div className="mt-2 flex max-w-xl flex-col gap-1">
          {matches.slice(0, 8).map((l) => (
            <button key={l.id} onClick={() => { setQ(""); void selectLine(l.id); }} className="rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-ink-800 glass-pill glass-pill--neutral">
              <span className="font-mono font-medium">{l.id}</span> <span className="text-slate-500">{l.name}</span>
            </button>
          ))}
        </div>
      )}

      {!lineId && (
        <EmptyState icon={Radar} title="Pick a line" body="Search above — health cards, logs, readings and tickets land here." />
      )}

      {identity && (
        <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-ink-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-bold">{identity.id}</span>
            <span className="text-slate-500">{identity.name}</span>
            {identity.active ? <StatusChip tone="ok">ingesting</StatusChip> : <StatusChip tone="mute">deregistered</StatusChip>}
            {health && <FeedPill lastTick={health.lastTick} quietHours={health.quietHours} />}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            registered {new Date(identity.createdAt).toLocaleDateString()} · {identity.connectionLabel} · tables: {identity.memberTables.join(", ") || "—"}
          </div>
        </div>
      )}

      {lineId && health && (
        <div className="mt-4">
          <HealthTiles
            health={{ ...health, streams: health.streams.filter((s) => s.resolution !== "base") }}
            streamFilter={stream}
            onStream={setStream}
          />
        </div>
      )}

      {lineId && (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_22rem]">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-base font-bold">Log</h2>
              <span className="tnum text-xs text-slate-400">runs for {date} · readings all-time</span>
            </div>
            <LogTable rows={rows} filter={filter} onFilter={setFilter} stream={stream} onOpen={setDrawer} />
          </div>
          <div className="min-h-0">
            <TicketSidebar
              lineId={lineId}
              open={ticketsOpen}
              closed={ticketsClosed}
              loading={ticketsLoading}
              onChanged={() => void loadTickets(lineId)}
              onViewReading={(id) => void viewReading(id)}
            />
          </div>
        </div>
      )}

      {drawer && (
        <ReadingDrawer
          lineId={lineId}
          row={drawer}
          onClose={() => setDrawer(null)}
          onTicket={() => void loadTickets(lineId)}
        />
      )}
    </div>
  );
}
