import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createLine,
  deregisterLine,
  getConnection,
  getLine,
  listLines,
  reregisterLine,
  updateLine,
} from "../db/store.js";
import { driverFor } from "../drivers/index.js";

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
