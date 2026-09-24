import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getConnection, getLine, listLineColumnMeta, queryHistory, recordQueryHistory, type ConnectionRecord, type LineRecord } from "../db/store.js";
import { assertReadonly, driverFor } from "../drivers/index.js";
import { llmChatJson } from "../llm/client.js";

const MAX_ROWS = 100;
const TIMEOUT_MS = 30_000;
const SAMPLE_ROWS = 10;

type RunErrorKind =
  | "syntax" | "unknown_table" | "unknown_column" | "boundary"
  | "timeout" | "connection" | "readonly_violation" | "unknown";

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let cur0 = i;
    let prevDiag = i - 1;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(prev[j] + 1, cur0 + 1, prevDiag + cost);
      prevDiag = prev[j];
      prev[j - 1] = cur0;
      cur0 = next;
    }
    prev[n] = cur0;
  }
  return prev[n];
}

/** Closest names to `want` (case-insensitive), capped at 3 within tolerance. */
function closestNames(want: string, have: string[]): string[] {
  const w = want.toLowerCase();
  return [...new Set(have)]
    .map((h) => ({ h, d: editDistance(w, h.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(w.length / 2)))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.h);
}

/** Classify a driver failure into a machine-usable kind (+ bad name + position). */
function classifyDriverError(e: unknown): { kind: RunErrorKind; badName?: string; position?: string | null } {
  const rec = (e ?? {}) as { code?: unknown; errno?: unknown; position?: unknown };
  const code = String(rec.code ?? rec.errno ?? "");
  const msg = (e as Error)?.message ?? String(e);
  const pos = rec.position == null ? null : String(rec.position);

  if (/^(42601|1064)$/.test(code) || code === "ER_PARSE_ERROR") return { kind: "syntax", position: pos };
  if (/^(42P01|1146)$/.test(code) || code === "ER_NO_SUCH_TABLE") {
    const m = msg.match(/relation "([^"]+)" does not exist|Table '([^']+)' doesn't exist/);
    const raw = (m?.[1] ?? m?.[2] ?? "").split(".").pop() ?? "";
    return { kind: "unknown_table", badName: raw || undefined, position: pos };
  }
  if (/^(42703|1054)$/.test(code) || code === "ER_BAD_FIELD_ERROR") {
    const m = msg.match(/column "([^"]+)" does not exist|Unknown column '([^']+)'/);
    const raw = (m?.[1] ?? m?.[2] ?? "").split(".").pop() ?? "";
    return { kind: "unknown_column", badName: raw || undefined, position: pos };
  }
  if (code === "57014" || /timed out|timeout|query was cancelled|canceling statement/i.test(msg)) return { kind: "timeout" };
  if (/^08/.test(code) || /ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|EAI_AGAIN/i.test(code + " " + msg)
    || /2002|2003|1045/.test(code) || code.startsWith("ER_ACCESS_DENIED")) return { kind: "connection" };
  if (/syntax/i.test(msg)) return { kind: "syntax", position: pos };
  const mCol = msg.match(/column "([^"]+)" does not exist|Unknown column '([^']+)'/);
  if (mCol) return { kind: "unknown_column", badName: ((mCol[1] ?? mCol[2] ?? "").split(".").pop() ?? "") || undefined };
  const mTab = msg.match(/relation "([^"]+)" does not exist|Table '([^']+)' doesn't exist/);
  if (mTab) return { kind: "unknown_table", badName: ((mTab[1] ?? mTab[2] ?? "").split(".").pop() ?? "") || undefined };
  return { kind: "unknown" };
}

/** CTE names defined by WITH x AS (...), y AS (...) — not real tables, skip in checks. */
function cteNamesIn(sql: string): Set<string> {
  const names = new Set<string>();
  const re = /(?:WITH|,)\s+["']?(\w+)["']?\s+AS\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) names.add(m[1].toLowerCase());
  return names;
}

/** FROM/JOIN references in SQL that match line member tables (best-effort, mirrors run handler). */
function memberRefsIn(sql: string, memberSet: Set<string>): string[] {
  const found: string[] = [];
  const tableRefs = sql.match(/(?:FROM|JOIN)\s+["']?(\w+(?:\.\w+)?)["']?/gi) ?? [];
  for (const ref of tableRefs) {
    const raw = ref.replace(/(?:FROM|JOIN)\s+/i, "").replace(/["']/g, "").trim();
    const lower = raw.toLowerCase();
    const bareName = lower.includes(".") ? lower.split(".").pop()! : lower;
    const member = [...memberSet].find(
      (m) => m === lower || m.endsWith("." + bareName) || m === bareName
    );
    if (member && !found.includes(member)) found.push(member);
  }
  return found;
}

export interface TableRangeRow {
  table: string; timeColumn: string | null;
  start: string | null; end: string | null;
  rows: number | null; error?: string;
}

/** Shared ranges probe — used by GET /ranges and POST /ask. Read-only. */
export async function probeRanges(
  conn: ConnectionRecord, line: LineRecord
): Promise<{ ranges: TableRangeRow[]; overall: { start: string | null; end: string | null } }> {
  const QUOTE = conn.type === "mysql" ? "`" : '"';
  const qid = (s: string) => `${QUOTE}${s.replaceAll(QUOTE, QUOTE + QUOTE)}${QUOTE}`;
  const NAME_HITS = ["ts", "timestamp", "event_time", "created_at", "createdat", "recorded_at", "time", "date", "ts_utc"];
  const TYPE_HIT = /timestamp|datetime/i;
  const TYPE_MAYBE = /(^|[^a-z])date([^a-z]|$)|(^|[^a-z])time([^a-z]|$)/i;

  const driver = driverFor(conn);
  const ranges: TableRangeRow[] = [];
  for (const ref of line.memberTables) {
    const parts = ref.split(".");
    const schema = parts.length > 1 ? parts[0] : "public";
    const table = parts.length > 1 ? parts[1] : parts[0];
    let cols: { name: string; type: string }[] = [];
    try {
      const info = await driver.describeTable(conn, schema, table);
      cols = info.columns;
    } catch (e) {
      ranges.push({ table: ref, timeColumn: null, start: null, end: null, rows: null, error: (e as Error).message });
      continue;
    }
    const byName = cols.find((c) => NAME_HITS.includes(c.name.toLowerCase()));
    const byType = cols.find((c) => TYPE_HIT.test(c.type))
      ?? cols.find((c) => TYPE_MAYBE.test(c.type));
    const tc = byName ?? byType;
    if (!tc) {
      ranges.push({ table: ref, timeColumn: null, start: null, end: null, rows: null, error: "no time column" });
      continue;
    }
    try {
      const probe = `SELECT MIN(${qid(tc.name)}) AS start, MAX(${qid(tc.name)}) AS end, COUNT(*) AS rows FROM ${qid(schema)}.${qid(table)}`;
      assertReadonly(probe);
      const r = await driver.queryReadonly<{ start: unknown; end: unknown; rows: unknown }>(conn, probe);
      const row = r[0] ?? {};
      const asIso = (v: unknown) =>
        v == null ? null : v instanceof Date ? v.toISOString() : String(v);
      ranges.push({
        table: ref, timeColumn: tc.name,
        start: asIso(row.start), end: asIso(row.end),
        rows: row.rows == null ? null : Number(row.rows),
      });
    } catch (e) {
      ranges.push({ table: ref, timeColumn: tc.name, start: null, end: null, rows: null, error: (e as Error).message });
    }
  }
  const starts = ranges.map((r) => r.start).filter((s): s is string => !!s);
  const ends = ranges.map((r) => r.end).filter((s): s is string => !!s);
  const pick = (arr: string[], fn: (...n: number[]) => number) => {
    if (arr.length === 0) return null;
    const ts = arr.map((s) => Date.parse(s)).filter((n) => !Number.isNaN(n));
    if (ts.length === 0) return arr[0];
    return new Date(fn(...ts)).toISOString();
  };
  return {
    ranges,
    overall: { start: pick(starts, Math.min), end: pick(ends, Math.max) },
  };
}

/** Shared success package — run response + LLM sample contract (P4). */
export function buildSuccess(
  rows: Record<string, unknown>[], sql: string,
  start: string, end: string, tablesTouched: string[], durationMs: number
) {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const capped = rows.slice(0, MAX_ROWS);
  const sampleTypes: Record<string, string> = {};
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (v != null && !(k in sampleTypes)) {
        sampleTypes[k] = v instanceof Date ? "datetime" : typeof v;
      }
    }
    if (Object.keys(sampleTypes).length >= columns.length) break;
  }
  return {
    columns, rows: capped, rowCount: rows.length, capped: rows.length > MAX_ROWS, durationMs, sql,
    sample: {
      columns: columns.map((name) => ({ name, sampleType: sampleTypes[name] ?? "unknown" })),
      rows: capped.slice(0, SAMPLE_ROWS),
      truncatedSample: rows.length > SAMPLE_ROWS,
    },
    window: { from: start, to: end },
    tablesTouched,
  };
}

/** Shared failure package — classified kind + hint + did-you-mean (P1/P2). */
export async function buildFailure(
  conn: ConnectionRecord, line: LineRecord, tablesTouched: string[], e: unknown
): Promise<{ error: string; errorKind: RunErrorKind; errorHint: string; errorPosition: string | null }> {
  const msg = (e as Error).message;
  const cls = classifyDriverError(e);
  let hint: string;
  switch (cls.kind) {
    case "syntax":
      hint = cls.position
        ? `Check the SQL near position ${cls.position} — only SELECT/WITH/SHOW/EXPLAIN, single statement.`
        : "Check the SQL syntax — only SELECT/WITH/SHOW/EXPLAIN, single statement, no semicolons.";
      break;
    case "unknown_table":
      hint = "Query only tables attached to this line — see the Tables row / Data readiness.";
      break;
    case "unknown_column":
      hint = "Check exact column names in the Tables row / table Details panel.";
      break;
    case "timeout":
      hint = `The query exceeded ${TIMEOUT_MS / 1000}s — narrow the time window or add LIMIT.`;
      break;
    case "connection":
      hint = "The database connection failed — check Connections.";
      break;
    default:
      hint = "See the raw database message.";
  }
  if ((cls.kind === "unknown_column" || cls.kind === "unknown_table") && cls.badName) {
    try {
      const driver = driverFor(conn);
      const pool: string[] = [];
      if (cls.kind === "unknown_column") {
        const refs = tablesTouched.length > 0 ? tablesTouched : line.memberTables;
        for (const ref of refs) {
          const parts = ref.split(".");
          const schema = parts.length > 1 ? parts[0] : "public";
          const table = parts.length > 1 ? parts.slice(1).join(".") : parts[0];
          try {
            const info = await driver.describeTable(conn, schema, table);
            for (const c of info.columns) pool.push(c.name);
          } catch { /* skip unreachable tables */ }
        }
      } else {
        for (const m of line.memberTables) pool.push(m.split(".").pop()!);
      }
      const sug = closestNames(cls.badName, pool);
      if (sug.length > 0) {
        hint = `Did you mean ${sug.map((s) => `"${s}"`).join(", ")}? ${hint}`;
      }
    } catch { /* suggestions are best-effort — never fail the error path */ }
  }
  return { error: msg, errorKind: cls.kind, errorHint: hint, errorPosition: cls.position ?? null };
}

/**
 * Frozen assistant prompt, version ask-v2.
 * Research drafts + graded trials: sql-assistant-working/ (ask_system_v1.txt
 * T1-T3/T1b; ask_system_v2.txt S1/J1-J3/C1/M1; scenarios/; live JOIN on line-12).
 * Edit here only with a version bump + re-graded trials (S1 single-table first).
 */
export const ASK_SYSTEM_VERSION = "ask-v2";
export const ASK_SYSTEM = `You are the SQL assistant for one plant data line. You write read-only queries, run them, and report honestly. The user reviews your SQL in an editor beside this chat and runs it — or you run it and show the table.

HARD RULES (in order):
1. READ-ONLY. SELECT or WITH only, one statement, no semicolons. Never DELETE/UPDATE/INSERT/DROP/ALTER.
2. MEMBER TABLES ONLY. The note lists the line's tables — query only those, never invent or guess a table name.
3. NO INVENTED COLUMNS. The column list per table is exhaustive. If the user names something absent, clarify — never hallucinate it into SQL.
4. TIME FILTERS use {{from}} / {{to}} placeholders against the table's named time column — never literal timestamps. The note shows recorded start/end for orientation ONLY: copying those values into SQL as literals is forbidden. Words like "last 7 days" describe the picker's range, not values to hard-code — the picker supplies {{from}}/{{to}} at run time.
5. AMBIGUITY: 2+ equally-good candidates (column or table) → ask (kind "clarify"), OR answer covering ALL candidates explicitly when that is cheap (e.g. AVG both temperatures in one query — preferred over a round-trip). What you must never do is silently pick one. One clear winner → pick it and state the choice.
6. EMPTY RESULT is a finding, not a failure. Report it plainly with the window used.
7. REPAIR (attempts 2-3): fix ONLY the broken part named in the error. Do not redesign the query. Max 3 attempts per question — on the 3rd failure, hand back the SQL + error and stop.
8. SHORT. Narration in fragments ("found table X → columns a, b → writing query"). Explanations in 1-2 sentences.
9. MULTI-TABLE JOIN PATTERN — applies ONLY when the question needs 2+ tables. Then: pre-aggregate EACH table to the same time bucket in its own CTE (e.g. DATE_TRUNC('hour', <timecol>) AS bucket, one row per bucket), then JOIN the CTEs ON the bucket. NEVER join raw timestamp columns across tables of different density (sparse × dense joins fan out or go empty). If a table has no usable time column for the bucket, say so instead of forcing the join.
10. JOIN-KEY REASONING. Pick the key before the query: entity key present in both tables (machine_id, batch_id…) → value-lookup join on that key; only time shared → time-bucket join per Rule 9; neither shared → do NOT join — run separate queries or clarify. State the chosen key in one fragment ("key: machine_id in both → entity join").
11. MULTI-STEP PLANNING. Some questions need two successful queries (distinct values first, details for one value second). After each successful run you are shown its sample and asked: done or next step. Return "need_more" with the next SQL when a further query is required to answer, "done" with the final reply when the question is fully answered. Each execution counts against the same 3-budget (repairs and next-steps share it). Never invent the intermediate values — use the sample rows you were actually shown.
12. SINGLE-TABLE PLAINNESS. One table → plain SELECT, no CTE, no subquery unless the logic genuinely needs one. Time-window words ("last 7 days", "yesterday") ALWAYS produce a WHERE on the time column with {{from}}/{{to}} — a missing time filter on a time-windowed question is a failed reading. Rules 9-11 never apply to single-table questions.
13. LATEST-PER-ENTITY. "Latest X per <entity>" (each machine, each batch…) means one row PER entity value — never a bare global ORDER BY ts DESC LIMIT 1 (that returns one row total). Use DISTINCT ON (<entity>) … ORDER BY <entity>, ts DESC (postgres) or ROW_NUMBER() OVER (PARTITION BY <entity> ORDER BY ts DESC) filtered to rn = 1. "Each" always partitions.

OUTPUT CONTRACT — reply with JSON only, no prose, no fences:
{
  "kind": "run_sql" | "clarify" | "explain" | "need_more" | "done",
  "sql": "<the query, when kind is run_sql or need_more>",
  "steps": ["found table ...", "columns ...", "key: ...", "writing query", "running"],
  "question": "<when kind is clarify: the ONE question you need answered>",
  "reply": "<1-2 sentence explanation of what the query does and what came back>"
}
kind "explain" (no SQL) is for answering about results already shown. kind "run_sql" always carries sql + steps. kind "need_more" carries the NEXT sql plus what the previous sample showed. kind "done" closes a multi-step chain with the final answer.`;

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
      const msg = (e as Error).message;
      return reply.code(400).send({
        error: msg, errorKind: "readonly_violation" as RunErrorKind,
        errorHint: "Only SELECT/WITH/SHOW/EXPLAIN, one statement, no semicolons.", durationMs: 0,
      });
    }

    // Table-boundary check: extract FROM/JOIN table references and verify
    // they are line member tables. This is a best-effort heuristic — it
    // catches the common case (single-table SELECT) without a full parser.
    const memberSet = new Set(line.memberTables.map((t) => t.toLowerCase()));
    const ctes = cteNamesIn(sql);
    const tableRefs = sql.match(/(?:FROM|JOIN)\s+["']?(\w+(?:\.\w+)?)["']?/gi) ?? [];
    for (const ref of tableRefs) {
      const raw = ref.replace(/(?:FROM|JOIN)\s+/i, "").replace(/["']/g, "").trim();
      const lower = raw.toLowerCase();
      // Accept if the table name (or schema.table) is in member tables,
      // or if the bare table name is (for public-schema tables).
      const bareName = lower.includes(".") ? lower.split(".").pop()! : lower;
      if (ctes.has(bareName)) continue; // WITH-defined alias, not a real table
      const hasMatch = [...memberSet].some(
        (m) => m === lower || m.endsWith("." + bareName) || m === bareName
      );
      if (!hasMatch) {
        const sug = closestNames(bareName, line.memberTables.map((m) => m.split(".").pop()!));
        return reply.code(400).send({
          error: `table "${raw}" is not a member of line ${line.id} — member tables: ${line.memberTables.join(", ")}`,
          errorKind: "boundary" as RunErrorKind,
          errorHint: sug.length > 0
            ? `Did you mean ${sug.map((s) => `"${s}"`).join(", ")}? Or attach the table to the line in Lines.`
            : "Attach the table to the line in Lines, or query a member table.",
          durationMs: 0,
        });
      }
    }
    const tablesTouched = memberRefsIn(sql, memberSet);

    const started = Date.now();
    try {
      const rows = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, sql);
      const durationMs = Date.now() - started;
      recordQueryHistory({ lineId: p.data.lineId, sql, rowCount: rows.length, durationMs, ok: true });
      return buildSuccess(rows, sql, start, end, tablesTouched, durationMs);
    } catch (e) {
      const durationMs = Date.now() - started;
      const f = await buildFailure(conn, line, tablesTouched, e);
      recordQueryHistory({ lineId: p.data.lineId, sql, durationMs, ok: false, error: f.error });
      return reply.code(502).send({ ...f, durationMs });
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

  /**
   * Per-table time readiness for a line: discovers each member table's time
   * column (preferred names first, else first timestamp-ish type) and probes
   * MIN/MAX/COUNT. Tables without a time column (or unreachable ones) are
   * reported with null bounds so the UI can flag them. Read-only.
   */
  app.get("/api/ingest/playground/ranges/:lineId", async (req, reply) => {
    const { lineId } = req.params as { lineId: string };
    const line = getLine(lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const conn = getConnection(line.connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });
    return probeRanges(conn, line);
  });

  /**
   * AI SQL assistant: one user question in, one round out. Server-side loop,
   * max 3 executions per question (clarify/explain consume 0). Each iteration:
   * LLM call -> validate -> execute; failures feed the classified error back.
   * The model never controls the loop — only the SQL inside it.
   */
  app.post("/api/ingest/playground/ask", async (req, reply) => {
    const p = z.object({
      lineId: z.string().min(1),
      message: z.string().min(1).max(2000),
      rounds: z.array(z.object({
        question: z.string(),
        sql: z.string().default(""),
        outcome: z.string(),
      })).max(5).default([]),
      pendingQuestion: z.string().nullable().optional(),
      currentSql: z.string().max(20_000).default(""),
      window: z.object({ from: z.string(), to: z.string() }).nullable().optional(),
      contextSample: z.unknown().nullable().optional(),
      contextError: z.object({
        kind: z.string(), message: z.string(), hint: z.string().nullable().optional(), sql: z.string(),
      }).nullable().optional(),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });

    const line = getLine(p.data.lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const conn = getConnection(line.connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });

    // Server-assembled context — client schema is never trusted.
    const driver = driverFor(conn);
    const meta = listLineColumnMeta(p.data.lineId);
    const byTable = new Map<string, { name: string; type: string; meaning: string }[]>();
    for (const ref of line.memberTables) {
      const parts = ref.split(".");
      const schema = parts.length > 1 ? parts[0] : "public";
      const table = parts.length > 1 ? parts.slice(1).join(".") : parts[0];
      try {
        const info = await driver.describeTable(conn, schema, table);
        const meanings = new Map(
          meta.filter((m) => m.tableName.toLowerCase() === ref.toLowerCase())
            .map((m) => [m.columnName.toLowerCase(), m.meaning])
        );
        byTable.set(ref, info.columns.map((c) => ({
          name: c.name, type: c.type,
          meaning: meanings.get(c.name.toLowerCase()) ?? "",
        })));
      } catch {
        byTable.set(ref, []);
      }
    }
    const probed = await probeRanges(conn, line).catch(() => null);
    const bounds = new Map((probed?.ranges ?? []).map((r) => [r.table, r]));
    const wFrom = p.data.window?.from ?? probed?.overall.start ?? "?";
    const wTo = p.data.window?.to ?? probed?.overall.end ?? "?";

    const schemaLines: string[] = [`Line \`${line.id}\`, window ${wFrom} → ${wTo} (preset: full).`, "", "TABLES (exhaustive — query only these):"];
    for (const ref of line.memberTables) {
      const cols = byTable.get(ref) ?? [];
      const b = bounds.get(ref);
      schemaLines.push(b?.start
        ? `- ${ref} — time column \`${b.timeColumn}\`, ${b.rows} rows, recorded ${b.start} → ${b.end}`
        : `- ${ref} — no recorded time bounds`);
      for (const c of cols) {
        schemaLines.push(`    ${c.name} (${c.type}) — ${c.meaning.trim() || "(no explanation stored)"}`);
      }
    }
    const base = [
      ...schemaLines, "",
      "CONVERSATION SO FAR (round summaries):",
      ...(p.data.rounds.length > 0
        ? p.data.rounds.map((r, i) => `  Round ${i + 1}: asked ${JSON.stringify(r.question)} → ran \`${r.sql}\` → ${r.outcome}`)
        : ["  (none — first question)"]),
      "",
      "THIS TURN:",
      `  Editor SQL now: ${p.data.currentSql || "(empty)"}`,
      ...(p.data.pendingQuestion ? [`  Resolving your pending question: ${JSON.stringify(p.data.pendingQuestion)} — the message below answers it; continue THIS round.`] : []),
      ...(p.data.contextSample != null ? [`  Latest manual run sample: ${JSON.stringify(p.data.contextSample).slice(0, 2000)}`] : []),
      ...(p.data.contextError != null ? [`  Latest manual run FAILED [${p.data.contextError.kind}]: ${p.data.contextError.message}${p.data.contextError.hint ? ` Hint: ${p.data.contextError.hint}` : ""} SQL was: ${p.data.contextError.sql}`] : []),
      `  User asks: ${JSON.stringify(p.data.message)}`,
    ].join("\n");

    const askSchema = z.object({
      kind: z.enum(["run_sql", "clarify", "explain", "need_more", "done"]),
      sql: z.string().default(""),
      steps: z.array(z.string()).max(10).default([]),
      question: z.string().default(""),
      reply: z.string().default(""),
    });

    const memberSet = new Set(line.memberTables.map((t) => t.toLowerCase()));
    const steps: string[] = [];
    let retryBlock = "";
    let chainBlock = "";
    let lastOk: {
      sql: string; rowCount: number;
      sample: { columns: { name: string; sampleType: string }[]; rows: Record<string, unknown>[]; truncatedSample: boolean };
      tablesTouched: string[]; window: { from: string; to: string };
    } | null = null;
    const validateSql = (sql: string): string | null => {
      try {
        assertReadonly(sql);
      } catch (e) {
        return `Proposed SQL failed the safety check: ${(e as Error).message}`;
      }
      const ctes = cteNamesIn(sql);
      const badRef = (sql.match(/(?:FROM|JOIN)\s+["']?(\w+(?:\.\w+)?)["']?/gi) ?? [])
        .map((ref) => ref.replace(/(?:FROM|JOIN)\s+/i, "").replace(/["']/g, "").trim())
        .find((raw) => {
          const lower = raw.toLowerCase();
          const bare = lower.includes(".") ? lower.split(".").pop()! : lower;
          if (ctes.has(bare)) return false;
          return ![...memberSet].some((m) => m === lower || m.endsWith("." + bare) || m === bare);
        });
      if (badRef) return `Proposed SQL references "${badRef}", which is not a member table.`;
      return null;
    };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await llmChatJson({
        system: ASK_SYSTEM,
        user: base + retryBlock + chainBlock,
        schema: askSchema,
        context: { route: "playground-ask", lineId: line.id },
        log: app.log,
      });
      if (r.reason === "no-provider" || !r.parsed) {
        return { type: "error", reason: r.reason === "no-provider" ? "no-provider" : "unparseable" };
      }
      const out = r.parsed;
      for (const s of out.steps) if (steps.length < 16) steps.push(s);
      if (out.kind === "clarify") {
        return { type: "clarify", question: out.question, reply: out.reply, steps };
      }
      if (out.kind === "explain") {
        return { type: "explain", reply: out.reply, steps };
      }
      if (out.kind === "done") {
        // Closes a multi-step chain with the final answer (or a bare answer).
        if (lastOk) {
          return {
            type: "round", ok: true, question: p.data.message, sql: lastOk.sql, editorSql: lastOk.sql,
            steps, attempts: attempt, reply: out.reply || "Done.",
            rowCount: lastOk.rowCount, sample: lastOk.sample,
            tablesTouched: lastOk.tablesTouched, window: lastOk.window, chained: true,
          };
        }
        return { type: "explain", reply: out.reply, steps };
      }
      // run_sql / need_more — validate (server gate), then execute.
      const sql = out.sql.trim();
      if (!sql) {
        return { type: "dropped", reason: "The assistant proposed no SQL.", reply: out.reply, steps, attempts: attempt };
      }
      const invalid = validateSql(sql);
      if (invalid) {
        return { type: "dropped", reason: invalid, reply: out.reply, steps, attempts: attempt, sql };
      }
      // Substitute {{from}}/{{to}} for execution; editor keeps placeholders.
      const end = p.data.window?.to ?? new Date().toISOString();
      const start = p.data.window?.from ?? new Date(Date.now() - 24 * 3600_000).toISOString();
      const execSql = sql.replaceAll("{{from}}", start).replaceAll("{{to}}", end);
      const tablesTouched = memberRefsIn(sql, memberSet);
      const execStart = Date.now();
      try {
        const rows = await driver.queryReadonly<Record<string, unknown>>(conn, execSql);
        const durationMs = Date.now() - execStart;
        recordQueryHistory({ lineId: line.id, sql: execSql, rowCount: rows.length, durationMs, ok: true });
        const packed = buildSuccess(rows, execSql, start, end, tablesTouched, durationMs);
        if (out.kind === "need_more" && attempt < 3) {
          // Chain: feed the sample back, ask done-or-next. Same 3-budget.
          lastOk = {
            sql, rowCount: packed.rowCount, sample: packed.sample,
            tablesTouched: packed.tablesTouched, window: packed.window,
          };
          steps.push(`ok (${packed.rowCount} rows) — chaining (attempt ${attempt + 1}/3)`);
          retryBlock = "";
          chainBlock = `\n\nCHAIN — attempt ${attempt + 1}/3. Previous SQL succeeded (${packed.rowCount} rows). Sample (first rows):\n  ${JSON.stringify(packed.sample.rows.slice(0, 5))}\nDecide: "done" with the final answer, or "need_more" with the NEXT sql. Use only values from this sample — never invent intermediate values.`;
          continue;
        }
        return {
          type: "round", ok: true, question: p.data.message, sql, editorSql: sql,
          steps, attempts: attempt, reply: out.reply,
          rowCount: packed.rowCount, sample: packed.sample,
          tablesTouched: packed.tablesTouched, window: packed.window,
          ...(lastOk ? { chained: true } : {}),
        };
      } catch (e) {
        const durationMs = Date.now() - execStart;
        const f = await buildFailure(conn, line, tablesTouched, e);
        recordQueryHistory({ lineId: line.id, sql: execSql, durationMs, ok: false, error: f.error });
        steps.push(`failed [${f.errorKind}]: ${f.error}`);
        if (attempt >= 3) {
          return {
            type: "round", ok: false, question: p.data.message, sql, editorSql: sql,
            steps, attempts: attempt, handoff: true,
            reply: `3 tries used — over to you; the last query is in the editor with the error below. ${out.reply}`.trim(),
            errorKind: f.errorKind, errorHint: f.errorHint, errorPosition: f.errorPosition,
          };
        }
        steps.push(`fixed: retrying (attempt ${attempt + 1}/3)`);
        chainBlock = "";
        retryBlock = `\n\nRETRY — attempt ${attempt + 1}/3. Previous SQL (verbatim):\n  ${sql}\nIt failed with [${f.errorKind}]: ${f.error}${f.errorHint ? `\nHint: ${f.errorHint}` : ""}\nFix ONLY the broken part; do not redesign the query.`;
      }
    }
    return { type: "error", reason: "loop-exhausted" };
  });

  /** Query history for a line (most recent first). */
  app.get("/api/ingest/playground/history/:lineId", async (req, reply) => {
    const { lineId } = req.params as { lineId: string };
    const line = getLine(lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    return queryHistory(lineId);
  });
}
