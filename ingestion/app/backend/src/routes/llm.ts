import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  activateLlmModel,
  activeLlmProvider,
  createLlmProvider,
  deactivateLlm,
  deleteLlmProvider,
  getLlmProvider,
  listLlmProviders,
  markLlmCheck,
  updateLlmProvider,
} from "../db/store.js";

const TIMEOUT_MS = 10000;

async function fetchModels(baseUrl: string, apiKey: string): Promise<{ id: string }[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
      signal: ctl.signal,
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = (await r.json()) as { data?: { id: string }[] };
    if (!Array.isArray(body.data)) throw new Error("unexpected /v1/models shape");
    return body.data;
  } finally {
    clearTimeout(t);
  }
}

/** Probe a provider record (key stays server-side). Returns models + latency. */
export async function probeLlm(
  id: string
): Promise<{ ok: boolean; latencyMs: number | null; models: string[]; error: string | null }> {
  const p = getLlmProvider(id, true);
  if (!p) throw new Error("provider not found");
  const start = Date.now();
  try {
    const models = await fetchModels(p.baseUrl, p.apiKey ?? "");
    const latencyMs = Date.now() - start;
    markLlmCheck(id, true, null);
    return { ok: true, latencyMs, models: models.map((m) => m.id), error: null };
  } catch (e) {
    const error = (e as Error).message;
    markLlmCheck(id, false, error);
    return { ok: false, latencyMs: null, models: [], error };
  }
}

export async function llmRoutes(app: FastifyInstance) {
  app.get("/api/ingest/llm", async () => listLlmProviders());

  app.post("/api/ingest/llm", async (req, reply) => {
    const p = z
      .object({
        label: z.string().min(1).max(100),
        baseUrl: z.string().url().max(500),
        apiKey: z.string().max(500).default(""),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    return reply.code(201).send(createLlmProvider(p.data));
  });

  app.patch("/api/ingest/llm/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = z
      .object({
        label: z.string().min(1).max(100).optional(),
        baseUrl: z.string().url().max(500).optional(),
        apiKey: z.string().max(500).optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const updated = updateLlmProvider(id, p.data);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return updated;
  });

  app.delete("/api/ingest/llm/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    deactivateLlm(id);
    if (!deleteLlmProvider(id)) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  // Connect: test + auto-detect models. Never saves; saving is separate.
  app.post("/api/ingest/llm/detect", async (req, reply) => {
    const p = z
      .object({
        id: z.string().optional(),
        label: z.string().min(1).max(100).optional(),
        baseUrl: z.string().url().max(500),
        apiKey: z.string().max(500).default(""),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    if (p.data.id) {
      try {
        return await probeLlm(p.data.id);
      } catch (e) {
        return reply.code(404).send({ error: (e as Error).message });
      }
    }
    // Draft (unsaved) probe.
    const start = Date.now();
    try {
      const models = await fetchModels(p.data.baseUrl, p.data.apiKey);
      return { ok: true, latencyMs: Date.now() - start, models: models.map((m) => m.id), error: null };
    } catch (e) {
      return reply.code(502).send({ ok: false, latencyMs: null, models: [], error: (e as Error).message });
    }
  });

  // Save + activate: create (or reuse) the record and set the active model.
  app.post("/api/ingest/llm/activate", async (req, reply) => {
    const p = z
      .object({
        id: z.string().optional(),
        label: z.string().min(1).max(100).optional(),
        baseUrl: z.string().url().max(500),
        apiKey: z.string().max(500).default(""),
        model: z.string().min(1).max(200),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    let id = p.data.id;
    if (!id) {
      const created = createLlmProvider({ label: p.data.label ?? p.data.baseUrl, baseUrl: p.data.baseUrl, apiKey: p.data.apiKey });
      id = created.id;
    } else {
      updateLlmProvider(id, { apiKey: p.data.apiKey, baseUrl: p.data.baseUrl });
    }
    // Prove the chosen model exists right now before activating.
    const probe = await probeLlm(id);
    if (!probe.ok) return reply.code(502).send({ error: `cannot reach provider: ${probe.error}` });
    if (!probe.models.includes(p.data.model)) {
      return reply.code(409).send({ error: `model "${p.data.model}" not offered (got: ${probe.models.join(", ") || "none"})` });
    }
    return activateLlmModel(id, p.data.model);
  });

  app.post("/api/ingest/llm/:id/deactivate", async (req) => {
    const { id } = req.params as { id: string };
    deactivateLlm(id);
    return { ok: true };
  });

  app.get("/api/ingest/llm/active", async () => {
    const a = activeLlmProvider();
    if (!a) return { active: null };
    const { apiKey: _k, ...rest } = a;
    return { active: rest };
  });
}
