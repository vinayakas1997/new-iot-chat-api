import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getCard, getSetting, lastFactWrite, listCards, setSetting } from "../db/store.js";

const TIMEOUT_MS = 8000;
let lastError: string | null = null;

/** F5: thin status page. "Live" means working, not just pingable. */
export async function hindsightRoutes(app: FastifyInstance) {
  app.get("/api/ingest/hindsight/status", async () => {
    const url = getSetting("hindsight_url");
    if (!url) {
      return {
        configured: false,
        live: false,
        latencyMs: null,
        lastWrite: lastFactWrite(),
        lastError: "hindsight_url not set — configure it below",
      };
    }
    const start = Date.now();
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const r = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      lastError = null;
      return {
        configured: true,
        live: true,
        latencyMs: Date.now() - start,
        lastWrite: lastFactWrite(),
        lastError: null,
        url,
      };
    } catch (e) {
      lastError = (e as Error).message;
      return {
        configured: true,
        live: false,
        latencyMs: null,
        lastWrite: lastFactWrite(),
        lastError,
        url,
      };
    }
  });

  app.put("/api/ingest/hindsight/url", async (req, reply) => {
    const p = z.object({ url: z.string().url().max(500) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    setSetting("hindsight_url", p.data.url);
    return { ok: true, url: p.data.url };
  });

  // Item 11.1 reconciliation: fire-and-forget retain becomes confirmed-write.
  // Lists recent bank operations so footprints (facts submitted) can be
  // checked against Hindsight-side outcomes (consolidated/failed).
  app.get("/api/ingest/hindsight/operations/:bankId", async (req, reply) => {
    const { bankId } = req.params as { bankId: string };
    const base = (getSetting("hindsight_url") ?? "").replace(/\/health\/?$/, "");
    if (!base) return reply.code(409).send({ error: "hindsight_url not set" });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${base}/v1/default/banks/${encodeURIComponent(bankId)}/operations`, { signal: ctl.signal });
      const body = await r.json().catch(() => ({}));
      clearTimeout(t);
      if (!r.ok) {
        const b = body as { error?: string; detail?: string };
        return reply.code(502).send({ error: b.error ?? b.detail ?? `Hindsight HTTP ${r.status}` });
      }
      const ops = ((body as { operations?: unknown }).operations ?? body) as unknown;
      const list = Array.isArray(ops) ? ops : [];
      const failed = list.filter((o) => {
        const s = ((o ?? {}) as { status?: unknown }).status;
        return typeof s === "string" && /fail|error|cancel/i.test(s);
      });
      return { bankId, total: list.length, failed: failed.length, failedOps: failed.slice(0, 20), operations: list.slice(0, 50) };
    } catch (e) {
      clearTimeout(t);
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // Item 3 Button 5: recall-by-tag drill-down. A log row has no direct memory
  // link — its tag set (line/card/version/measure/...) is the bridge. Proxies
  // Hindsight recall scoped to the exact tag set (all_strict), so the drawer
  // shows what this input actually stored in the vector DB.
  // Gap 3 eras: facts carry card:<id> + cardName:<name> now, card:<name>
  // before. On zero hits, retry with the card-tag variants so renames and
  // legacy rows resolve instead of vanishing.
  app.get("/api/ingest/hindsight/recall/:bankId", async (req, reply) => {
    const { bankId } = req.params as { bankId: string };
    const q = req.query as { query?: string; tags?: string; maxTokens?: string };
    const base = (getSetting("hindsight_url") ?? "").replace(/\/health\/?$/, "");
    if (!base) return reply.code(409).send({ error: "hindsight_url not set" });
    const tags = (q.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) return reply.code(400).send({ error: "tags required (comma-separated)" });
    const query = q.query?.slice(0, 500) || tags.join(" ");
    const maxTokens = Math.min(Math.max(Number(q.maxTokens) || 2000, 200), 8000);
    async function recallWith(tagSet: string[]): Promise<{ ok: boolean; body: unknown }> {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const r = await fetch(`${base}/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`, {
          method: "POST",
          signal: ctl.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, tags: tagSet, tags_match: "all_strict", max_tokens: maxTokens }),
        });
        const body = await r.json().catch(() => ({}));
        clearTimeout(t);
        if (!r.ok) {
          const b = body as { error?: string; detail?: string };
          return { ok: false, body: { error: b.error ?? b.detail ?? `Hindsight HTTP ${r.status}` } };
        }
        return { ok: true, body };
      } catch (e) {
        clearTimeout(t);
        return { ok: false, body: { error: (e as Error).message } };
      }
    }
    const first = await recallWith(tags);
    if (!first.ok) return reply.code(502).send(first.body);
    const hits = ((first.body as { results?: unknown }).results ?? []) as unknown[];
    if (hits.length > 0) return first.body;
    // Fallback: swap the card: tag across eras (id → name → cardName).
    const cardTag = tags.find((t) => t.startsWith("card:"));
    if (!cardTag) return first.body;
    const cardRef = cardTag.slice("card:".length);
    const card = getCard(cardRef);
    const lineId = bankId.startsWith("bank:line-") ? bankId.slice("bank:line-".length) : null;
    const variants: string[][] = [];
    if (card) {
      if (card.lineId === lineId || !lineId) {
        // New id-tag missed: legacy facts carry card:<name>.
        variants.push(tags.map((t) => (t === cardTag ? `card:${card.name}` : t)));
      }
    } else if (lineId) {
      // cardRef may be a legacy NAME: find the card by name on this line.
      const byName = listCards(lineId).find((c) => c.name === cardRef);
      if (byName) variants.push(tags.map((t) => (t === cardTag ? `card:${byName.id}` : t)));
    }
    for (const v of variants) {
      const r = await recallWith(v);
      if (!r.ok) return reply.code(502).send(r.body);
      const h = ((r.body as { results?: unknown }).results ?? []) as unknown[];
      if (h.length > 0) return { ...(r.body as Record<string, unknown>), resolvedVia: "card-tag fallback" };
    }
    return first.body;
  });
}
