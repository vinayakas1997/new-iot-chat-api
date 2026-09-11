import type { FastifyInstance } from "fastify";
import { getCard, getLine, runsForLine, getRun } from "../db/store.js";

function dayBounds(date: string): { from: string; to: string } {
  const from = `${date}T00:00:00.000Z`;
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return { from, to: d.toISOString() };
}

function prevDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function summarize(runs: ReturnType<typeof runsForLine>) {
  const ok = runs.filter((r) => r.ok).length;
  return {
    runs: runs.length,
    ok,
    failed: runs.length - ok,
    rows: runs.reduce((s, r) => s + r.rowsPulled, 0),
    facts: runs.reduce((s, r) => s + r.factsStored, 0),
  };
}

export async function historyRoutes(app: FastifyInstance) {
  // Line identity card: registration facts + connection + tables + quiet state.
  app.get("/api/ingest/history/line/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = getLine(id);
    if (!l) return reply.code(404).send({ error: "not found" });
    const quietHours =
      l.lastTick == null ? null : (Date.now() - new Date(l.lastTick).getTime()) / 3600000;
    return { ...l, quietHours };
  });

  // Month strip: per-day summaries for the calendar (tick dots).
  app.get("/api/ingest/history/month", async (req, reply) => {
    const { lineId, month } = req.query as { lineId?: string; month?: string };
    if (!lineId || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return reply.code(400).send({ error: "lineId + month=YYYY-MM required" });
    }
    const days: Record<string, ReturnType<typeof summarize>> = {};
    const start = new Date(`${month}-01T00:00:00.000Z`);
    for (let d = new Date(start); d.toISOString().slice(0, 7) === month; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      const { from, to } = dayBounds(date);
      days[date] = summarize(runsForLine(lineId, from, to));
    }
    return { lineId, month, days };
  });

  // Day view: runs + failures + previous-day comparison.
  app.get("/api/ingest/history/day", async (req, reply) => {
    const { lineId, date } = req.query as { lineId?: string; date?: string };
    if (!lineId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: "lineId + date=YYYY-MM-DD required" });
    }
    const b = dayBounds(date);
    const pb = dayBounds(prevDate(date));
    const runs = runsForLine(lineId, b.from, b.to).map((r) => ({
      ...r,
      cardName: getCard(r.cardId)?.name ?? r.cardId,
    }));
    const prev = summarize(runsForLine(lineId, pb.from, pb.to));
    return {
      lineId,
      date,
      summary: summarize(runsForLine(lineId, b.from, b.to)),
      prevDate: prevDate(date),
      prev,
      runs,
      failures: runs.filter((r) => !r.ok),
    };
  });

  // "How the AI interpreted": context-in (executed SQL + sample) vs facts-out.
  // factsStored is 0 until the extraction layer lands; the section says so.
  app.get("/api/ingest/history/run/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = getRun(Number(id));
    if (!r) return reply.code(404).send({ error: "not found" });
    const card = getCard(r.cardId);
    return {
      run: r,
      cardName: card?.name ?? r.cardId,
      contextIn: {
        sql: card?.sql ?? "(card deleted)",
        granularity: card?.granularity ?? "?",
        extractHint: card?.extractHint ?? "",
      },
      factsOut: {
        stored: r.factsStored,
        note:
          r.kind === "test"
            ? "test-runs never write banks — facts land here once the tick engine + extraction layer run"
            : "extraction layer pending",
      },
    };
  });
}
