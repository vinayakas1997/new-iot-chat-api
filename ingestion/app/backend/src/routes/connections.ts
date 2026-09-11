import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createConnection,
  deleteConnection,
  getConnection,
  lastCheck,
  listConnections,
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
    // F2 will enforce "blocked while lines bound" here once lines exist.
    if (!deleteConnection(id)) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  // Test: read-only probe, never saves (F1 lock). Body may carry an
  // unsaved connection draft OR {id} of a stored one.
  app.post("/api/ingest/connections/test", async (req, reply) => {
    const body = req.body as { id?: string } & Record<string, unknown>;
    let conn;
    if (body.id) {
      const stored = getConnection(body.id);
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
      return { ok: true, latencyMs: r.latencyMs, tableCount: r.tables.length };
    } catch (e) {
      return reply.code(502).send({ ok: false, error: (e as Error).message });
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
}
