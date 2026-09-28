import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Radar, Search } from "lucide-react";
import {
  api, cardApi, historyApi, overviewApi, playgroundApi, readingApi, ticketApi, ALL_STREAMS,
  type Card, type ChartReadingRow, type DayView, type Line, type LineHealth, type RunRow, type StreamResolution, type TicketRow,
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
 * Source-data pill: overall data end across member tables. Ticks advance the
 * cursor every heartbeat; if the source is static, windows go empty and the
 * bank starves silently — this pill makes that shape visible (F3).
 */
function SourcePill({ end }: { end: string }) {
  const ageH = (Date.now() - new Date(end).getTime()) / 3600_000;
  const stale = ageH > 24;
  return (
    <span
      title={stale ? "source data is static — tick windows past this point pull zero rows" : "latest source data across member tables"}
      className={`tnum inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${stale ? "border-state-warn/50 text-state-warn" : "border-slate-200 text-slate-500 dark:border-ink-700"}`}
    >
      <span className={`h-2 w-2 rounded-full ${stale ? "bg-state-warn" : "bg-state-ok"}`} />
      source {stale ? "static" : "fresh"} · data ends {timeAgo(end)}
    </span>
  );
}

/**
 * Items 1–2: template-card dropdown + granularity pills. The pills drive the
 * existing Log stream filter; picking a card gates pills to its own
 * resolutions (missing ones render inactive with a reason). The base sampler
 * footprints as resolution "base", so each card's finest stream maps to it.
 */
function finestOf(res: StreamResolution[]): StreamResolution {
  return ALL_STREAMS.find((r) => res.includes(r)) ?? "hourly";
}
function pillValues(cards: Card[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const c of cards) {
    const res = c.resolutions?.length ? c.resolutions : (["hourly"] as StreamResolution[]);
    const finest = finestOf(res);
    for (const s of ALL_STREAMS) {
      if (!res.includes(s)) continue;
      const value = s === finest ? "base" : s;
      if (!seen.has(value)) seen.set(value, s === finest ? `${s} · base` : s);
    }
  }
  return [...seen].map(([value, label]) => ({ value, label }));
}
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
  // F7 is live-only by default; All reveals prefill rows (chip-marked).
  const [era, setEra] = useState<"live" | "all">("live");
  const [drawer, setDrawer] = useState<LogRow | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceEnd, setSourceEnd] = useState<string | null>(null);
  // Items 1–2: template-card dropdown + granularity pills. Pills drive the
  // existing stream filter; choosing a card gates pills to its resolutions.
  const [lineCards, setLineCards] = useState<Card[]>([]);
  const [cardId, setCardId] = useState<string>("");
  // Coverage sentence: intent + origin + pre-fill progress + live edge.
  const [coverage, setCoverage] = useState<{ cardId: string; name: string; status: string; granularity: string; analysisStart: string | null; streams: { resolution: string; coverageFrom: string | null; backfillCursor: string | null; liveCursor: string | null }[] }[]>([]);

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

  async function selectLine(id: string, d = today(), e: "live" | "all" = era) {
    setLineId(id);
    setParams(id ? { line: id } : {});
    setError(null);
    setDrawer(null);
    setStream(null);
    setCardId("");
    try {
      const [ident, h, dy, rd, cs] = await Promise.all([
        historyApi.line(id),
        overviewApi.health(id, e),
        historyApi.day(id, d, e),
        readingApi.list(id, 50, 0, e),
        cardApi.listCards(id).catch(() => [] as Card[]),
      ]);
      setIdentity(ident);
      setHealth(h);
      setDate(d);
      setDay(dy);
      setReadings(rd.rows);
      setLineCards(cs);
      void loadTickets(id);
      cardApi.coverage(id).then(setCoverage, () => setCoverage([]));
      // Source freshness: overall data end across member tables. A static source
      // with an advancing tick cursor is the starvation shape — surface it here.
      playgroundApi.ranges(id).then(
        (r) => setSourceEnd(r.overall?.end ?? null),
        () => setSourceEnd(null),
      );
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
      setDay(await historyApi.day(lineId, d, era));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function pickEra(e: "live" | "all") {
    setEra(e);
    if (!lineId) return;
    void selectLine(lineId, date, e);
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
  // Items 1–2 wiring: pills always show the line union; the chosen card gates
  // (missing streams render inactive). Unchosen shows everything enabled.
  const chosenCard = lineCards.find((c) => c.id === cardId) ?? null;
  const pills = pillValues(lineCards);
  const allowed = new Set(pillValues(chosenCard ? [chosenCard] : lineCards).map((p) => p.value));
  // Coverage sentence for the chosen card (or first live card).
  const covCard = coverage.find((c) => c.cardId === (chosenCard?.id ?? lineCards.find((l) => l.status === "live")?.id));
  const covFinest = covCard?.streams[0];
  const coverageLine = covCard && covFinest
    ? `analyzing since ${covCard.analysisStart && covCard.analysisStart !== "from-start" ? covCard.analysisStart : (covFinest.coverageFrom?.slice(0, 10) ?? "—")}${
        covFinest.backfillCursor ? ` · backfilled to ${covFinest.backfillCursor.slice(0, 16).replace("T", " ")}` : ""
      } · live at ${covFinest.liveCursor ? timeAgo(covFinest.liveCursor) : "—"}`
    : null;

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
            {sourceEnd && <SourcePill end={sourceEnd} />}
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
              <span className="ml-auto flex gap-1">
                {(["live", "all"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => pickEra(v)}
                    title={v === "live" ? "Live ticks only — prefill lives in F8" : "Include prefill footprints (chip-marked)"}
                    className={`rounded-full px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${era === v ? "bg-accent-500/15 text-accent-500" : "text-slate-500 ring-1 ring-slate-300 dark:text-ink-300 dark:ring-ink-700"}`}
                  >
                    {v === "live" ? "Live" : "All"}
                  </button>
                ))}
              </span>
            </div>
            {(lineCards.length > 0) && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <select
                  value={cardId}
                  onChange={(e) => { setCardId(e.target.value); setStream(null); }}
                  title="Template card — granularity pills reflect this card's own streams"
                  className="rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 text-xs text-slate-600 focus:border-accent-500 focus:outline-none dark:border-ink-700 dark:text-ink-300"
                >
                  <option value="">all template cards</option>
                  {lineCards.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => setStream(null)}
                  title="Show all granularities"
                  className={`rounded-full px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${stream === null ? "bg-accent-500/15 text-accent-500" : "text-slate-500 ring-1 ring-slate-300 dark:text-ink-300 dark:ring-ink-700"}`}
                >
                  all
                </button>
                {pills.map((p) => {
                  const on = stream === p.value;
                  const gated = chosenCard && !allowed.has(p.value);
                  return (
                    <button
                      key={p.value}
                      disabled={!!gated}
                      onClick={() => setStream(p.value)}
                      title={gated ? `not on ${chosenCard.name} — inactive` : `show ${p.label} runs only`}
                      className={`tnum rounded-full px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${on ? "bg-accent-500/15 text-accent-500" : gated ? "cursor-not-allowed text-slate-300 line-through dark:text-ink-700" : "text-slate-500 ring-1 ring-slate-300 dark:text-ink-300 dark:ring-ink-700"}`}
                    >
                      {p.label}
                    </button>
                  );
                })}
                {chosenCard && (
                  <span className="tnum text-[11px] text-slate-400">
                    {chosenCard.granularity} · streams: {(chosenCard.resolutions ?? []).join(", ") || "—"}
                  </span>
                )}
              </div>
            )}
            {coverageLine && (
              <div className="tnum mb-3 text-[11px] text-slate-400" title="Intent (analysis start) · origin (coverage from) · pre-fill progress · live edge">
                {coverageLine}
              </div>
            )}
            <LogTable rows={rows} filter={filter} onFilter={setFilter} stream={stream} onOpen={setDrawer} />
          </div>
          <div className="min-h-0">
            <TicketSidebar
              lineId={lineId}
              open={ticketsOpen}
              closed={ticketsClosed}
              cards={lineCards}
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
