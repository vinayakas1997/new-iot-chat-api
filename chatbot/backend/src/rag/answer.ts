import { ingest } from "./ingestClient.js";
import { recallForLine, reflectForLine } from "./hindsight.js";
import { chatComplete, resolveLlm } from "./llm.js";

export interface ChartDatum {
  chart_type: "table" | "line" | "bar" | "area";
  title: string;
  x_column: string;
  y_columns: string[];
  columns: string[];
  rows: Record<string, unknown>[];
  spec_id?: string;
}

export interface LineAnswer {
  lineId: string;
  summary: string;
  charts: ChartDatum[];
  sources: { tool: string; detail?: string }[];
}

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY)\b/i;

function needsLiveSql(q: string): boolean {
  return /(right now|live|today|trend|last \d+ (day|hour|shift)|compare|shift 1|shift 2|chart|graph|plot)/i.test(q);
}

/** Pick the most relevant stored graph spec: title/name overlap with question, else first. */
async function chartFromSpecs(lineId: string, question: string): Promise<{ spec: Awaited<ReturnType<typeof ingest.graphsForCard>>[number] & { cardId: string }; cardSql: string } | null> {
  try {
    const cards = await ingest.listCards(lineId);
    const q = question.toLowerCase();
    for (const c of cards.slice(0, 8)) {
      const specs = await ingest.graphsForCard(c.id).catch(() => []);
      if (!specs.length) continue;
      const hit = specs.find((s) => q.includes(s.title.toLowerCase()) || q.includes(s.name.toLowerCase()) || q.includes(c.name.toLowerCase())) ?? specs[0];
      if (hit) return { spec: { ...hit, cardId: c.id }, cardSql: c.sql };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function heuristicChart(columns: string[], rows: Record<string, unknown>[]): ChartDatum | null {
  if (!rows.length || columns.length < 2) return null;
  const x = columns[0];
  const numerics = columns.slice(1).filter((c) => rows.some((r) => typeof r[c] === "number"));
  if (!numerics.length) return null;
  const isTime = /time|date|hour|day|shift|created|at/i.test(x);
  return {
    chart_type: isTime ? "line" : columns.length <= 3 ? "bar" : "table",
    title: "Live query result",
    x_column: x,
    y_columns: numerics.slice(0, 3),
    columns,
    rows: rows.slice(0, 50),
  };
}

export async function answerOneLine(lineId: string, question: string): Promise<LineAnswer> {
  const sources: LineAnswer["sources"] = [];
  const charts: ChartDatum[] = [];

  // 1. Memory path (always first).
  const [recall, reflect] = await Promise.all([recallForLine(lineId, question), reflectForLine(lineId, question)]);
  sources.push({ tool: "recall_memory", detail: `${recall.facts.length} facts${recall.error ? ` (${recall.error})` : ""}` });
  const memBlock = recall.facts.length
    ? recall.facts.map((f, i) => `[${i + 1}]${f.score != null ? ` (${f.score.toFixed(2)})` : ""} ${f.text}`).join("\n")
    : "No matching memories.";

  // 2. Live SQL path (only for fresh/computed/trend questions).
  let liveBlock = "Live SQL not needed for this question.";
  if (needsLiveSql(question)) {
    try {
      const cols = await ingest.lineColumns(lineId).catch(() => ({ columns: [] }));
      const colList = cols.columns.slice(0, 40).map((c) => `${c.table}.${c.name} (${c.type})`).join(", ") || "unknown schema";
      const picked = await chartFromSpecs(lineId, question);
      const { llm } = await resolveLlm();
      let sql = picked?.cardSql ?? "";
      if (llm && !sql) {
        // Ask LLM for SQL with schema context (strict JSON).
        const raw = await chatComplete(
          llm,
          `You write read-only SQL. Return strict JSON {"sql": "..."} only. Rules: single SELECT/WITH statement, no semicolon, never INSERT/UPDATE/DELETE/DROP. Tables must be line members.`,
          `Line ${lineId} schema: ${colList}\nQuestion: ${question}\nReturn JSON only.`
        );
        try {
          sql = (JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { sql?: string }).sql ?? "";
        } catch {
          sql = "";
        }
      }
      if (sql && !FORBIDDEN.test(sql)) {
        const res = await ingest.runSql(lineId, sql);
        sources.push({ tool: "text_to_sql", detail: `${res.rowCount} rows in ${res.durationMs}ms` });
        liveBlock = `Live rows (${res.rowCount}): ${JSON.stringify(res.rows.slice(0, 5)).slice(0, 1500)}`;
        // 3. Chart path: stored spec wins.
        if (picked) {
          charts.push({
            chart_type: picked.spec.chartType,
            title: picked.spec.title || picked.spec.name || "Stored chart",
            x_column: picked.spec.xColumn,
            y_columns: picked.spec.yColumns,
            columns: res.columns,
            rows: res.rows.slice(0, 50),
            spec_id: picked.spec.id,
          });
          sources.push({ tool: "chart_spec", detail: `stored spec ${picked.spec.id}` });
        } else {
          const h = heuristicChart(res.columns, res.rows);
          if (h) {
            charts.push(h);
            sources.push({ tool: "chart_spec", detail: "heuristic" });
          }
        }
      } else if (sql) {
        liveBlock = "Generated SQL blocked by safety verifier.";
      }
    } catch (e) {
      liveBlock = `Live SQL failed: ${(e as Error).message}`;
      sources.push({ tool: "text_to_sql", detail: `failed: ${(e as Error).message}`.slice(0, 200) });
    }
  }

  // 4. Synthesis.
  const { llm, note } = await resolveLlm();
  let summary: string;
  if (reflect.text) {
    summary = reflect.text;
    sources.push({ tool: "reflect", detail: "hindsight reflect" });
  } else if (llm) {
    try {
      summary = await chatComplete(
        llm,
        `You are a plant shift assistant for line ${lineId}. Rules: 1) Lead with the number, one line of context. 2) Never invent numbers — use memories/live rows below. 3) If both are empty say "not yet ingested". 4) Keep to 3-6 sentences.`,
        `Question: ${question}\n\nMemories:\n${memBlock}\n\nLive:\n${liveBlock}`
      );
      if (!summary) throw new Error("empty LLM reply");
    } catch (e) {
      summary = `Memory: ${memBlock.split("\n").slice(0, 5).join("\n")}\n\n${liveBlock}\n\n(LLM synthesis failed: ${(e as Error).message} — ${note})`;
    }
  } else {
    summary = `${memBlock.split("\n").slice(0, 8).join("\n")}\n\n${liveBlock}\n\n(No LLM configured — ${note})`;
  }

  return { lineId, summary, charts, sources };
}

export async function answerQuestion(lineIds: string[], question: string): Promise<{ summary: string; charts: ChartDatum[]; sources: LineAnswer["sources"]; lines: LineAnswer[] }> {
  const lines: LineAnswer[] = [];
  for (const id of lineIds) lines.push(await answerOneLine(id, question));
  const multi = lines.length > 1;
  return {
    summary: lines.map((l) => (multi ? `## ${l.lineId}\n${l.summary}` : l.summary)).join("\n\n"),
    charts: lines.flatMap((l) => l.charts),
    sources: lines.flatMap((l) => l.sources),
    lines,
  };
}
