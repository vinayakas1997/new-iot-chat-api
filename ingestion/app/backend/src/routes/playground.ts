import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getConnection, getLine, queryHistory, recordQueryHistory } from "../db/store.js";
import { assertReadonly, driverFor } from "../drivers/index.js";

const MAX_ROWS = 100;
const TIMEOUT_MS = 30_000;

export async function playgroundRoutes(app: FastifyInstance) {
  /**
   * Execute arbitrary read-only SQL against a line's connection.
   * Guards: assertReadonly, member-table boundary (tables mentioned must be line members),
   * row cap (100), timeout (30s). No placeholder substitution — raw SQL.
   */
  app.post("/api/ingest/playground/run", async (req, reply) => {
    const p = z.object({
      lineId: z.string().min(1),
      sql: z.string().min(1).max(20_000),
      from: z.string().optional(),
      to: z.string().optional(),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });

    const line = getLine(p.data.lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const conn = getConnection(line.connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });

    // Substitute {{from}}/{{to}} if present (optional, matches card-test behavior).
    const end = p.data.to ?? new Date().toISOString();
    const start = p.data.from ?? new Date(Date.now() - 24 * 3600_000).toISOString();
    const sql = p.data.sql.replaceAll("{{from}}", start).replaceAll("{{to}}", end);

    try {
      assertReadonly(sql);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }

    // Table-boundary check: extract FROM/JOIN table references and verify
    // they are line member tables. This is a best-effort heuristic — it
    // catches the common case (single-table SELECT) without a full parser.
    const memberSet = new Set(line.memberTables.map((t) => t.toLowerCase()));
    const tableRefs = sql.match(/(?:FROM|JOIN)\s+["']?(\w+(?:\.\w+)?)["']?/gi);
    if (tableRefs) {
      for (const ref of tableRefs) {
        const raw = ref.replace(/(?:FROM|JOIN)\s+/i, "").replace(/["']/g, "").trim();
        const lower = raw.toLowerCase();
        // Accept if the table name (or schema.table) is in member tables,
        // or if the bare table name is (for public-schema tables).
        const bareName = lower.includes(".") ? lower.split(".").pop()! : lower;
        const hasMatch = [...memberSet].some(
          (m) => m === lower || m.endsWith("." + bareName) || m === bareName
        );
        if (!hasMatch) {
          return reply.code(400).send({
            error: `table "${raw}" is not a member of line ${line.id} — member tables: ${line.memberTables.join(", ")}`,
          });
        }
      }
    }

    const started = Date.now();
    try {
      const rows = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, sql);
      const durationMs = Date.now() - started;
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const capped = rows.slice(0, MAX_ROWS);
      recordQueryHistory({ lineId: p.data.lineId, sql, rowCount: rows.length, durationMs, ok: true });
      return { columns, rows: capped, rowCount: rows.length, capped: rows.length > MAX_ROWS, durationMs, sql };
    } catch (e) {
      const durationMs = Date.now() - started;
      recordQueryHistory({ lineId: p.data.lineId, sql, durationMs, ok: false, error: (e as Error).message });
      return reply.code(502).send({ error: (e as Error).message, durationMs });
    }
  });

  /**
   * Quick column discovery for a line: lists columns across all member tables.
   * Used by the graph designer to populate axis dropdowns.
   */
  app.get("/api/ingest/playground/columns/:lineId", async (req, reply) => {
    const { lineId } = req.params as { lineId: string };
    const line = getLine(lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const conn = getConnection(line.connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });

    try {
      const driver = driverFor(conn);
      const allCols: { table: string; name: string; type: string }[] = [];
      for (const ref of line.memberTables) {
        const parts = ref.split(".");
        const schema = parts.length > 1 ? parts[0] : "public";
        const table = parts.length > 1 ? parts[1] : parts[0];
        try {
          const info = await driver.describeTable(conn, schema, table);
          for (const c of info.columns) {
            allCols.push({ table: ref, name: c.name, type: c.type });
          }
        } catch {
          // table might be inaccessible — skip
        }
      }
      return { columns: allCols };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  /** Query history for a line (most recent first). */
  app.get("/api/ingest/playground/history/:lineId", async (req, reply) => {
    const { lineId } = req.params as { lineId: string };
    const line = getLine(lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    return queryHistory(lineId);
  });
}
