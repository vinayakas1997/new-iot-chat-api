import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createConnection,
  deleteConnection,
  getConnection,
  lastCheck,
  linesBoundTo,
  listConnections,
  recordCheck,
  redact,
  updateConnection,
} from "../db/store.js";
import { driverFor } from "../drivers/index.js";

const inputSchema = z.object({
  label: z.string().min(1).max(100),
  type: z.enum(["postgres", "mysql"]),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string(),
  schemaFilter: z.string().nullable().optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  enabled: z.boolean().optional(),
});

export async function connectionRoutes(app: FastifyInstance) {
  app.get("/api/ingest/connections", async () => {
    return listConnections().map((c) => ({
      ...redact(c),
      lastCheck: lastCheck(c.id),
    }));
  });

  app.post("/api/ingest/connections", async (req, reply) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.code(201).send(redact(createConnection(parsed.data)));
  });

  app.get("/api/ingest/connections/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = getConnection(id);
    if (!c) return reply.code(404).send({ error: "not found" });
    return { ...redact(c), lastCheck: lastCheck(id) };
  });

  app.patch("/api/ingest/connections/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = inputSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const c = updateConnection(id, parsed.data);
    if (!c) return reply.code(404).send({ error: "not found" });
    return redact(c);
  });

  app.delete("/api/ingest/connections/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // F1 lock: blocked while lines are bound (DB RESTRICT backs this too).
    const bound = linesBoundTo(id);
    if (bound.length > 0) {
      return reply.code(409).send({
        error: `connection has ${bound.length} bound line(s): ${bound.map((l) => l.id).join(", ")} — rebind or deregister them first`,
      });
    }
    if (!deleteConnection(id)) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  // Test: read-only probe, never saves (F1 lock). Body may carry an
  // unsaved connection draft OR {id} of a stored one.
  // When {id} is given (explicit per-row Check), the result is also
  // recorded via recordCheck() so Status + Last check update immediately
  // without waiting for the poller. Draft probes stay pure (no record).
  app.post("/api/ingest/connections/test", async (req, reply) => {
    const body = req.body as { id?: string } & Record<string, unknown>;
    const storedId = body.id;
    let conn;
    if (storedId) {
      const stored = getConnection(storedId);
      if (!stored) return reply.code(404).send({ error: "not found" });
      conn = stored;
    } else {
      const parsed = inputSchema.safeParse(body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
      conn = {
        ...parsed.data,
        id: "draft",
        port: parsed.data.port ?? (parsed.data.type === "mysql" ? 3306 : 5432),
        schemaFilter: parsed.data.schemaFilter ?? null,
        timeoutMs: parsed.data.timeoutMs ?? 10000,
        enabled: true,
        createdAt: "",
        updatedAt: "",
      };
    }
    try {
      const r = await driverFor(conn).probe(conn);
      if (storedId) {
        recordCheck({
          connectionId: storedId,
          at: new Date().toISOString(),
          ok: true,
          latencyMs: r.latencyMs,
          tableCount: r.tables.length,
          error: null,
        });
      }
      return { ok: true, latencyMs: r.latencyMs, tableCount: r.tables.length };
    } catch (e) {
      const error = (e as Error).message;
      if (storedId) {
        recordCheck({
          connectionId: storedId,
          at: new Date().toISOString(),
          ok: false,
          latencyMs: null,
          tableCount: null,
          error,
        });
      }
      return reply.code(502).send({ ok: false, error });
    }
  });

  app.get("/api/ingest/connections/:id/tables", async (req, reply) => {
    const { id } = req.params as { id: string };
    const conn = getConnection(id);
    if (!conn) return reply.code(404).send({ error: "not found" });
    try {
      const r = await driverFor(conn).probe(conn);
      return { tables: r.tables };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get("/api/ingest/connections/:id/tables/:schema/:table", async (req, reply) => {
    const { id, schema, table } = req.params as { id: string; schema: string; table: string };
    const conn = getConnection(id);
    if (!conn) return reply.code(404).send({ error: "not found" });
    try {
      const driver = driverFor(conn);
      const info = await driver.describeTable(conn, schema, table);
      const sample = await driver.sampleRows(conn, schema, table, 20);
      return { ...info, sample };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // Draft analyze — no line required: introspect + LLM draft for meanings.
  // Used by Register line before the line row exists (true top→bottom).
  app.post("/api/ingest/connections/:id/tables/:schema/:table/analyze", async (req, reply) => {
    const { id, schema, table } = req.params as { id: string; schema: string; table: string };
    const conn = getConnection(id);
    if (!conn) return reply.code(404).send({ error: "not found" });
    try {
      const driver = driverFor(conn);
      const info = await driver.describeTable(conn, schema, table);
      const sample = await driver.sampleRows(conn, schema, table, 5).catch(() => ({ columns: [] as string[], rows: [] as Record<string, unknown>[] }));
      const samples = sample.rows.slice(0, 5).map((r) => Object.fromEntries(info.columns.map((c) => [c.name, String(r[c.name] ?? "")])));
      const columnSamples = info.columns.map((c) => `${c.name} (${c.type}): ${samples.map((s) => s[c.name] ?? "").filter(Boolean).slice(0, 3).join(", ") || "—"}`).join("\n");
      let drafted: { name: string; meaning: string }[] = [];
      if (info.columns.length > 0) {
        const { llmChatJson } = await import("../llm/client.js");
        const r = await llmChatJson({
          system: "You label database columns. Reply with JSON only, no prose, no fences.",
          user: `Table: ${schema}.${table}\nColumns and sample values:\n${columnSamples}\n\nFor each column write ONE short sentence what it measures, include units if apparent. Reply JSON array: [{"name","meaning"}].`,
          schema: z.array(z.object({ name: z.string(), meaning: z.string() })),
          context: { route: "connections-analyze-draft", connectionId: id, table: `${schema}.${table}` },
          log: app.log,
        });
        if (r.parsed) drafted = r.parsed;
      }
      const byDraft = new Map(drafted.map((d) => [d.name.toLowerCase(), d.meaning]));
      const columns = info.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        description: c.description,
        meaning: byDraft.get(c.name.toLowerCase()) ?? c.description ?? "",
        datatype: c.type,
        sampleValues: samples.map((s) => s[c.name]).filter(Boolean).slice(0, 3),
      }));
      return { schema, table: info.name, rowCount: info.rowCount, primaryKey: info.primaryKey, columns, sample, drafted, analyzed: { total: columns.length, filled: columns.filter((c) => c.meaning.trim()).length, analyzed: false } };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.post("/api/ingest/connections/:id/tables/:schema/:table/llm-fill", async (req, reply) => {
    const { id, schema, table } = req.params as { id: string; schema: string; table: string };
    const body = (req.body ?? {}) as { columns?: string[] };
    const conn = getConnection(id);
    if (!conn) return reply.code(404).send({ error: "not found" });
    try {
      const driver = driverFor(conn);
      const info = await driver.describeTable(conn, schema, table);
      const sample = await driver.sampleRows(conn, schema, table, 5).catch(() => ({ columns: [] as string[], rows: [] as Record<string, unknown>[] }));
      const targets = body.columns && body.columns.length > 0 ? body.columns : info.columns.map((c) => c.name);
      const sampleText = targets.map((name) => {
        const col = info.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
        const vals = sample.rows.slice(0, 5).map((r) => String(r[name] ?? "")).filter(Boolean).slice(0, 3).join(", ");
        return `${name} (${col?.type ?? "?"}): ${vals || "—"}`;
      }).join("\n");
      const { llmChatJson } = await import("../llm/client.js");
      const r = await llmChatJson({
        system: "You label database columns. Reply with JSON only, no prose, no fences.",
        user: `Table: ${schema}.${table}\nFill meanings for these columns:\n${sampleText}\nReply JSON array: [{"name","meaning"}]. One sentence per column, include units if apparent.`,
        schema: z.array(z.object({ name: z.string(), meaning: z.string() })),
        context: { route: "connections-llm-fill-draft", connectionId: id, table: `${schema}.${table}` },
        log: app.log,
      });
      if (!r.parsed) return reply.code(502).send({ error: r.reason ?? "llm failed", reason: r.reason });
      return { drafted: r.parsed, model: r.model, reason: r.reason };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
}
