import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  cardsBoundToLine,
  createLine,
  deleteLine,
  deregisterLine,
  getConnection,
  getLine,
  getLineTableAnalyzed,
  listGlobalTableMeta,
  listLineColumnMeta,
  listLines,
  reregisterLine,
  updateLine,
  upsertLineColumnMeta,
} from "../db/store.js";
import { driverFor } from "../drivers/index.js";
import { llmChatJson } from "../llm/client.js";
import { z as zod } from "zod";

const inputSchema = z.object({
  id: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  connectionId: z.string().min(1),
  memberTables: z.array(z.string().min(1)).default([]),
});

export async function lineRoutes(app: FastifyInstance) {
  app.get("/api/ingest/lines", async (req) => {
    const q = req.query as { connectionId?: string; table?: string; q?: string };
    return listLines({ connectionId: q.connectionId, table: q.table, q: q.q }).map(enrich);
  });

  app.post("/api/ingest/lines", async (req, reply) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return reply.code(201).send(enrich(createLine(parsed.data)));
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  app.get("/api/ingest/lines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = getLine(id);
    if (!l) return reply.code(404).send({ error: "not found" });
    return enrich(l);
  });

  app.patch("/api/ingest/lines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = inputSchema.partial().omit({ id: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const l = updateLine(id, parsed.data);
      if (!l) return reply.code(404).send({ error: "not found" });
      return enrich(l);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  app.post("/api/ingest/lines/:id/deregister", async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = deregisterLine(id);
    if (!l) return reply.code(404).send({ error: "not found" });
    return enrich(l);
  });

  app.post("/api/ingest/lines/:id/reregister", async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = reregisterLine(id);
    if (!l) return reply.code(404).send({ error: "not found" });
    return enrich(l);
  });

  app.delete("/api/ingest/lines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const n = cardsBoundToLine(id);
      if (n > 0) return reply.code(409).send({ error: `line has ${n} card(s) — delete or move its cards first` });
      if (!deleteLine(id)) return reply.code(404).send({ error: "not found" });
      return { ok: true };
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  // Global analysed tables across all lines (same DB) — for new Line B to reuse
  app.get("/api/ingest/global/tables/meta", async (req, reply) => {
    const { connectionId } = req.query as { connectionId?: string };
    return { meta: listGlobalTableMeta(connectionId) };
  });

  // Unassigned-table nudge (F2 lock): source tables belonging to no line.
  app.get("/api/ingest/lines-unassigned", async (req, reply) => {
    const { connectionId } = req.query as { connectionId?: string };
    if (!connectionId) return reply.code(400).send({ error: "connectionId required" });
    const conn = getConnection(connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });
    try {
      return { unassigned: await unassignedTables(connectionId) };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // ---- column meanings at lines registration (Analyze/Details) ----

  app.get("/api/ingest/lines/:id/columns/meta", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getLine(id)) return reply.code(404).send({ error: "line not found" });
    return { meta: listLineColumnMeta(id) };
  });

  app.get("/api/ingest/lines/:id/tables/:schema/:table/columns", async (req, reply) => {
    const { id, schema, table } = req.params as { id: string; schema: string; table: string };
    const line = getLine(id);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const conn = getConnection(line.connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });
    try {
      const info = await driverFor(conn).describeTable(conn, schema, table);
      const sample = await driverFor(conn).sampleRows(conn, schema, table, 5).catch(() => ({ columns: [] as string[], rows: [] as Record<string, unknown>[] }));
      const meta = listLineColumnMeta(id).filter((m) => m.tableName.toLowerCase() === `${schema}.${table}`.toLowerCase());
      const byName = new Map(meta.map((m) => [m.columnName.toLowerCase(), m.meaning]));
      const columns = info.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        description: c.description,
        meaning: byName.get(c.name.toLowerCase()) ?? "",
        datatype: c.type,
      }));
      const analyzed = getLineTableAnalyzed(id, `${schema}.${table}`);
      return { schema, table: info.name, rowCount: info.rowCount, primaryKey: info.primaryKey, columns, sample, analyzed };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.post("/api/ingest/lines/:id/tables/:schema/:table/columns", async (req, reply) => {
    const { id, schema, table } = req.params as { id: string; schema: string; table: string };
    const parsed = zod.object({ columns: zod.array(zod.object({ name: zod.string().min(1), meaning: zod.string().max(500), datatype: zod.string().optional() })) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const saved = upsertLineColumnMeta(id, `${schema}.${table}`, parsed.data.columns);
      return { saved };
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  // LLM fill: draft meanings for empty columns using sample values
  const meaningSchema = zod.array(zod.object({ name: zod.string(), meaning: zod.string() }));
  app.post("/api/ingest/lines/:id/tables/:schema/:table/analyze", async (req, reply) => {
    const { id, schema, table } = req.params as { id: string; schema: string; table: string };
    const line = getLine(id);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const conn = getConnection(line.connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });
    try {
      const info = await driverFor(conn).describeTable(conn, schema, table);
      const sample = await driverFor(conn).sampleRows(conn, schema, table, 5).catch(() => ({ columns: [] as string[], rows: [] as Record<string, unknown>[] }));
      const meta = listLineColumnMeta(id).filter((m) => m.tableName.toLowerCase() === `${schema}.${table}`.toLowerCase());
      const byName = new Map(meta.map((m) => [m.columnName.toLowerCase(), m.meaning]));
      const samples = sample.rows.slice(0, 5).map((r) => Object.fromEntries(info.columns.map((c) => [c.name, String(r[c.name] ?? "")])));
      const columnSamples = info.columns.map((c) => `${c.name} (${c.type}): ${samples.map((s) => s[c.name] ?? "").filter(Boolean).slice(0, 3).join(", ") || "—"}`).join("\n");
      const existing = info.columns.map((c) => ({ name: c.name, meaning: byName.get(c.name.toLowerCase()) ?? "" }));
      // If LLM available, draft empty meanings
      const empty = info.columns.filter((c) => !byName.get(c.name.toLowerCase())?.trim());
      let drafted: { name: string; meaning: string }[] = [];
      if (empty.length > 0) {
        const r = await llmChatJson({
          system: "You label database columns. Reply with JSON only, no prose, no fences.",
          user: `Table: ${schema}.${table}\nColumns and sample values:\n${columnSamples}\n\nFor each column with empty meaning, write ONE short sentence what it measures, include units if apparent. Reply JSON array: [{"name","meaning"}].`,
          schema: meaningSchema,
          context: { route: "lines-analyze", lineId: id, table: `${schema}.${table}` },
          log: app.log,
        });
        if (r.parsed) drafted = r.parsed;
        if (r.reason === "no-provider") {
          // no LLM — return without drafts, UI will show manual inputs
        }
      }
      const byDraft = new Map(drafted.map((d) => [d.name.toLowerCase(), d.meaning]));
      const columns = info.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        description: c.description,
        meaning: byName.get(c.name.toLowerCase()) ?? byDraft.get(c.name.toLowerCase()) ?? "",
        datatype: c.type,
        sampleValues: samples.map((s) => s[c.name]).filter(Boolean).slice(0, 3),
      }));
      const analyzed = getLineTableAnalyzed(id, `${schema}.${table}`);
      return { schema, table: info.name, rowCount: info.rowCount, primaryKey: info.primaryKey, columns, sample, drafted, analyzed, llmReason: (drafted.length === 0 && empty.length > 0) ? "no-provider or no draft" : null };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.post("/api/ingest/lines/:id/tables/:schema/:table/llm-fill", async (req, reply) => {
    const { id, schema, table } = req.params as { id: string; schema: string; table: string };
    const body = (req.body ?? {}) as { columns?: string[] };
    const line = getLine(id);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const conn = getConnection(line.connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });
    try {
      const info = await driverFor(conn).describeTable(conn, schema, table);
      const sample = await driverFor(conn).sampleRows(conn, schema, table, 5).catch(() => ({ columns: [] as string[], rows: [] as Record<string, unknown>[] }));
      const targets = body.columns && body.columns.length > 0 ? body.columns : info.columns.map((c) => c.name);
      const sampleText = targets.map((name) => {
        const col = info.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
        const vals = sample.rows.slice(0, 5).map((r) => String(r[name] ?? "")).filter(Boolean).slice(0, 3).join(", ");
        return `${name} (${col?.type ?? "?"}): ${vals || "—"}`;
      }).join("\n");
      const r = await llmChatJson({
        system: "You label database columns. Reply with JSON only, no prose, no fences.",
        user: `Table: ${schema}.${table}\nFill meanings for these columns:\n${sampleText}\nReply JSON array: [{"name","meaning"}]. One sentence per column, include units if apparent.`,
        schema: meaningSchema,
        context: { route: "lines-llm-fill", lineId: id, table: `${schema}.${table}` },
        log: app.log,
      });
      if (!r.parsed) return reply.code(502).send({ error: r.reason ?? "llm failed", reason: r.reason });
      return { drafted: r.parsed, model: r.model, reason: r.reason };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
}

export async function unassignedTables(connectionId: string): Promise<string[]> {
  const conn = getConnection(connectionId);
  if (!conn) throw new Error("connection not found");
  const { tables } = await driverFor(conn).probe(conn);
  const assigned = new Set(
    listLines({ connectionId }).flatMap((l) => l.memberTables.map((t) => t.toLowerCase()))
  );
  return tables
    .map((t) => `${t.schema}.${t.name}`)
    .filter((t) => !assigned.has(t.toLowerCase()));
}

function enrich(l: ReturnType<typeof getLine>): unknown {
  if (!l) return l;
  const conn = getConnection(l.connectionId);
  return { ...l, connectionLabel: conn?.label ?? l.connectionId };
}
