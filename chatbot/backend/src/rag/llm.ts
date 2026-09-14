import { ingest } from "./ingestClient.js";

export interface LlmEndpoint {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Resolve LLM: explicit env wins, else ingestion F6 active provider (key hidden → empty key). */
export async function resolveLlm(): Promise<{ llm: LlmEndpoint | null; note: string }> {
  if (process.env.LLM_BASE_URL && process.env.LLM_MODEL) {
    return {
      llm: { baseUrl: process.env.LLM_BASE_URL.replace(/\/$/, ""), model: process.env.LLM_MODEL, apiKey: process.env.LLM_API_KEY ?? "" },
      note: "env LLM_*",
    };
  }
  try {
    const a = await ingest.activeLlm();
    if (!a) return { llm: null, note: "no active LLM — set one in ingestion AI Services (F5)" };
    return { llm: { baseUrl: a.baseUrl.replace(/\/$/, ""), model: a.model, apiKey: "" }, note: `ingestion active: ${a.label}/${a.model}` };
  } catch (e) {
    return { llm: null, note: `cannot reach ingestion: ${(e as Error).message}` };
  }
}

export async function chatComplete(llm: LlmEndpoint, system: string, user: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 90000);
  try {
    const r = await fetch(`${llm.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(llm.apiKey ? { authorization: `Bearer ${llm.apiKey}` } : {}) },
      signal: ctl.signal,
      body: JSON.stringify({
        model: llm.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((body as { error?: unknown }).error ? JSON.stringify((body as { error: unknown }).error).slice(0, 500) : `HTTP ${r.status}`);
    const text = (body as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
    return text.trim();
  } finally {
    clearTimeout(t);
  }
}

export async function* chatStream(llm: LlmEndpoint, system: string, user: string): AsyncGenerator<string> {
  // Non-SSE fallback: complete then yield in word chunks so UI streams identically.
  const full = await chatComplete(llm, system, user);
  const words = full.split(/(\s+)/);
  let buf = "";
  for (const w of words) {
    buf += w;
    if (buf.length > 24) {
      yield buf;
      buf = "";
      await new Promise((r) => setTimeout(r, 12));
    }
  }
  if (buf) yield buf;
}
