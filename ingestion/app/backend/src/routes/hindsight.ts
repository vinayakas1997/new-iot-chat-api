import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSetting, lastFactWrite, setSetting } from "../db/store.js";

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
}
