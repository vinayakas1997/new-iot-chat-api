import { hindsightBase } from "./ingestClient.js";

export interface RecalledFact {
  text: string;
  score: number | null;
  tags: string[];
}

function bankPath(bankId: string): string {
  return `/v1/default/banks/${encodeURIComponent(bankId)}`;
}

/** Hindsight recall for one line bank. Never throws — returns empty on miss. */
export async function recallForLine(lineId: string, query: string): Promise<{ facts: RecalledFact[]; error: string | null }> {
  const base = await hindsightBase();
  if (!base) return { facts: [], error: "hindsight not configured (set it in ingestion AI Services)" };
  const bankId = `bank:line-${lineId}`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(`${base}${bankPath(bankId)}/memories/recall`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctl.signal,
      body: JSON.stringify({ query, budget: "high" }),
    });
    clearTimeout(t);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((body as { error?: string; detail?: string }).error ?? (body as { detail?: string }).detail ?? `HTTP ${r.status}`);
    const results = ((body as { results?: unknown[] }).results ?? []) as Record<string, unknown>[];
    const facts: RecalledFact[] = results.slice(0, 20).map((x) => ({
      text: String(x.content ?? x.text ?? x.memory ?? JSON.stringify(x)).slice(0, 2000),
      score: typeof x.score === "number" ? x.score : null,
      tags: Array.isArray(x.tags) ? (x.tags as string[]) : [],
    }));
    return { facts, error: null };
  } catch (e) {
    return { facts: [], error: (e as Error).message };
  }
}

/** Hindsight reflect (answer with citations) — best-effort, falls back to recall text. */
export async function reflectForLine(lineId: string, query: string): Promise<{ text: string | null; error: string | null }> {
  const base = await hindsightBase();
  if (!base) return { text: null, error: "hindsight not configured" };
  const bankId = `bank:line-${lineId}`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    const r = await fetch(`${base}${bankPath(bankId)}/reflect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: ctl.signal,
      body: JSON.stringify({ query, budget: "high" }),
    });
    clearTimeout(t);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((body as { error?: string; detail?: string }).error ?? `HTTP ${r.status}`);
    const b = body as Record<string, unknown>;
    const text = typeof b.answer === "string" ? b.answer : typeof b.response === "string" ? b.response : typeof b.text === "string" ? b.text : null;
    return { text, error: null };
  } catch (e) {
    return { text: null, error: (e as Error).message };
  }
}
