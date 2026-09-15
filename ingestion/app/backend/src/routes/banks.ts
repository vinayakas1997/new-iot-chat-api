import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getConnection,
  getLine,
  getSetting,
  listCards,
  listLines,
  setSetting,
} from "../db/store.js";
import { driverFor } from "../drivers/index.js";
import { llmChatJson } from "../llm/client.js";
import { bankSuggestSchema, type BankSuggestKind } from "../llm/schemas.js";

const HS_TIMEOUT_MS = 15000;

export function bankIdFor(lineId: string): string {
  return `bank:line-${lineId}`;
}

function hsBase(): string | null {
  const url = getSetting("hindsight_url");
  if (!url) return null;
  return url.replace(/\/health\/?$/, "");
}

async function hsFetch(path: string, init?: RequestInit): Promise<unknown> {
  const base = hsBase();
  if (!base) throw new Error("hindsight_url not set — configure it in AI Services");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), HS_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}${path}`, { ...init, signal: ctl.signal });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error((body as { error?: string; detail?: string }).error
        ?? (body as { detail?: string }).detail
        ?? `Hindsight HTTP ${r.status}`);
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- defaults ---------------- */

export function defaultMissions(lineName: string): { retain: string; observations: string; reflect: string } {
  return {
    retain: `This bank tracks one plant line (${lineName}). Always extract measured values with units, sample counts, and hour/window. Ignore connection errors and empty windows.`,
    observations: `Observations are durable line behaviors: normal ranges, recurring patterns, drift. Ignore one-off spikes and empty windows.`,
    reflect: `You are the ${lineName} shift assistant. Ground every answer in retained facts with their hour. If memory lacks the period, say so. Be terse.`,
  };
}

export function defaultDirectives(): { name: string; content: string; tags: string[] }[] {
  return [
    { name: "No invented readings", content: "Never invent a reading. If the hour has no retained fact, say 'no data'.", tags: [] },
    { name: "Cite the window", content: "Always state the hour/window a number comes from.", tags: [] },
    { name: "Units as stored", content: "Report units as stored (°C, pcs, min); never convert silently.", tags: [] },
  ];
}

function metricValuesFor(columns: { name: string; type: string }[]): { value: string; description: string }[] {
  const out: { value: string; description: string }[] = [];
  const seen = new Set<string>();
  const push = (value: string, description: string) => {
    if (!seen.has(value)) { seen.add(value); out.push({ value, description }); }
  };
  for (const c of columns) {
    const n = c.name.toLowerCase();
    const t = c.type.toLowerCase();
    const numeric = /int|float|double|numeric|decimal|real/.test(t);
    if (!numeric) continue;
    if (/temp/.test(n)) push("avg_temp_c", "hourly average temperature (°C)");
    else if (/pcs|count|qty|quantity/.test(n)) push("total_pcs", "summed production count (pcs)");
    else if (/min/.test(n)) push("downtime_min", "summed downtime (minutes)");
    else push(`avg_${n}`, `average of ${c.name}`);
  }
  push("samples", "sample count behind an aggregate");
  return out;
}

async function lineColumns(lineId: string): Promise<{ table: string; columns: { name: string; type: string }[]; error?: string }[]> {
  const line = getLine(lineId);
  if (!line) throw new Error("line not found");
  const conn = getConnection(line.connectionId);
  if (!conn) throw new Error("connection not found");
  const driver = driverFor(conn);
  const out: { table: string; columns: { name: string; type: string }[]; error?: string }[] = [];
  for (const t of line.memberTables.slice(0, 3)) {
    const [schema, ...rest] = t.split(".");
    const table = rest.join(".") || schema;
    try {
      const info = await driver.describeTable(conn, rest.length ? schema : "public", table);
      out.push({ table: t, columns: info.columns.slice(0, 25).map((c) => ({ name: c.name, type: c.type })) });
    } catch (e) {
      out.push({ table: t, columns: [], error: (e as Error).message });
    }
  }
  return out;
}

/* ---------------- schemas ---------------- */

const entityGroupSchema = z.object({
  key: z.string().min(1).max(60),
  description: z.string().max(500).default(""),
  type: z.enum(["value", "multi-values"]).default("value"),
  values: z.array(z.object({ value: z.string().min(1).max(80), description: z.string().max(200).default("") })).max(40).default([]),
  tag: z.boolean().default(true),
});

const planSchema = z.object({
  missions: z.object({
    retain: z.string().min(1).max(2000),
    observations: z.string().min(1).max(2000),
    reflect: z.string().min(1).max(2000),
  }),
  // "chunks" skips Hindsight's own LLM fact extraction entirely (stores our
  // pre-extracted fact text as-is) — required when the backing LLM is a slow
  // local model that blows past Hindsight's per-call timeout.
  extractionMode: z.enum(["concise", "verbose", "verbatim", "chunks"]).default("chunks"),
  entityLabels: z.array(entityGroupSchema).max(8).default([]),
  directives: z.array(z.object({
    name: z.string().min(1).max(120),
    content: z.string().min(1).max(2000),
    tags: z.array(z.string()).default([]),
  })).max(20).default([]),
  disposition: z.object({
    skepticism: z.number().int().min(1).max(5).default(4),
    literalism: z.number().int().min(1).max(5).default(4),
    empathy: z.number().int().min(1).max(5).default(1),
  }).default({}),
  observations: z.object({
    enabled: z.boolean().default(true),
    autoConsolidate: z.boolean().default(true),
  }).default({}),
  mentalModel: z.object({
    name: z.string().min(1).max(120),
    source_query: z.string().min(1).max(1000),
  }),
});

type Plan = z.infer<typeof planSchema>;

function draftKey(lineId: string): string { return `bankdraft:${lineId}`; }
function readyKey(lineId: string): string { return `bankready:${lineId}`; }

export function bankReady(lineId: string): boolean {
  return getSetting(readyKey(lineId)) === "1";
}

/* ---------------- routes ---------------- */

export async function bankRoutes(app: FastifyInstance) {
  // Overview: one row per line — bank id, readiness, green-card gating.
  app.get("/api/ingest/banks", async () => {
    const base = hsBase();
    const cards = listCards();
    return {
      hindsight: { configured: !!base, base },
      banks: listLines().map((l) => {
        const green = cards.filter((c) => c.lineId === l.id && c.lastTest?.ok).length;
        return {
          lineId: l.id,
          lineName: l.name,
          bankId: bankIdFor(l.id),
          ready: bankReady(l.id),
          draftSaved: getSetting(draftKey(l.id)) != null,
          greenCards: green,
          cards: cards.filter((c) => c.lineId === l.id).length,
        };
      }),
    };
  });

  // Preview: defaults (+saved draft) + live columns for entity drafting.
  app.get("/api/ingest/banks/preview/:lineId", async (req, reply) => {
    const { lineId } = req.params as { lineId: string };
    const line = getLine(lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const cols = await lineColumns(lineId);
    const flat = cols.flatMap((t) => t.columns);
    const missions = defaultMissions(line.name);
    const preview = {
      lineId: line.id,
      lineName: line.name,
      bankId: bankIdFor(line.id),
      ready: bankReady(line.id),
      hindsightConfigured: !!hsBase(),
      tables: cols,
      missions,
      extractionMode: "chunks" as const,
      entityLabels: [{
        key: "metric",
        description: "Plant measure behind a fact (for filtering recall by measure)",
        type: "value" as const,
        values: metricValuesFor(flat),
        tag: true,
      }],
      directives: defaultDirectives(),
      disposition: { skepticism: 4, literalism: 4, empathy: 1 },
      observations: { enabled: true, autoConsolidate: true },
      mentalModel: {
        name: `Normal envelope — ${line.name}`,
        source_query: `What is the normal operating envelope of ${line.name}? Summarize typical ranges per measure.`,
      },
    };
    const draftRaw = getSetting(draftKey(line.id));
    if (draftRaw) {
      try {
        const draft = JSON.parse(draftRaw) as Partial<Plan>;
        return { ...preview, draft, draftSaved: true };
      } catch { /* corrupt draft: fall through to defaults */ }
    }
    return { ...preview, draftSaved: false };
  });

  // Suggest: active LLM drafts one area (text/JSON) — never saved.
  app.post("/api/ingest/banks/suggest", async (req, reply) => {
    const p = z.object({
      lineId: z.string().min(1),
      kind: z.enum(["entities", "missions", "mental-model", "directives"]),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const line = getLine(p.data.lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const kind = p.data.kind as BankSuggestKind;
    const cols = await lineColumns(line.id);
    const colText = cols.map((t) => `${t.table}(${(t.columns.map((c) => `${c.name}:${c.type}`).join(", ") || "unreadable")})`).join("; ");
    const prompts: Record<string, string> = {
      entities: `Propose Hindsight entity_labels for a plant line memory bank. Line: ${line.name}. Tables/columns: ${colText}. Reply with JSON only: {"groups":[{"key":"metric","description":"...","type":"value","tag":true,"values":[{"value":"...","description":"..."}]}]}. Keep at most 2 groups and 12 values total, snake_case values.`,
      missions: `Write three short Hindsight bank missions for a plant data line named "${line.name}" with tables ${colText}. Reply with JSON only: {"retain":"...","observations":"...","reflect":"..."}. Each 1-3 sentences. Retain: what tick facts to extract. Observations: what durable behaviors to consolidate. Reflect: shift-assistant identity grounding answers in facts.`,
      "mental-model": `Propose one Hindsight mental-model seed for plant line "${line.name}" (tables: ${colText}). Reply with JSON only: {"name":"...","source_query":"..."}. The query should ask for the line's normal operating envelope.`,
      directives: `Propose 3 hard safety rules (directives) for a plant-line memory bank that answers from retained sensor facts. Reply with JSON only: {"directives":[{"name":"...","content":"..."}]}. Rules: never invent readings, cite the hour/window, units as stored.`,
    };
    const r = await llmChatJson({
      system: "You configure Hindsight agent-memory banks for plant data. Reply with JSON only, no prose, no fences.",
      user: prompts[kind],
      schema: bankSuggestSchema(kind),
      context: { route: "banks-suggest", lineId: p.data.lineId, kind },
      log: app.log,
    });
    if (r.reason === "no-provider") {
      return reply.code(409).send({ error: "no active LLM — connect one in AI Services", reason: r.reason });
    }
    return {
      kind: p.data.kind,
      text: r.text,
      parsed: r.parsed,
      model: r.model || null,
      latencyMs: r.latencyMs,
      attempts: r.attempts,
      reason: r.reason,
    };
  });

  // Save draft (applies nothing to Hindsight).
  app.post("/api/ingest/banks/draft", async (req, reply) => {
    const p = z.object({ lineId: z.string().min(1), plan: planSchema }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    if (!getLine(p.data.lineId)) return reply.code(404).send({ error: "line not found" });
    setSetting(draftKey(p.data.lineId), JSON.stringify(p.data.plan));
    return { ok: true };
  });

  // Push: create/update bank + config + directives + mental-model seed.
  app.post("/api/ingest/banks/push", async (req, reply) => {
    const p = z.object({ lineId: z.string().min(1), plan: planSchema }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const line = getLine(p.data.lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    if (!hsBase()) return reply.code(409).send({ error: "hindsight_url not set — configure it in AI Services" });
    const plan: Plan = p.data.plan;
    const bankId = bankIdFor(line.id);
    const warnings: string[] = [];
    const enc = encodeURIComponent(bankId);

    // 1. create (or update) the bank with missions + disposition.
    await hsFetch(`/v1/default/banks/${enc}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: line.name,
        mission: `Plant line memory for ${line.name} (${line.id}).`,
        retain_mission: plan.missions.retain,
        observations_mission: plan.missions.observations,
        reflect_mission: plan.missions.reflect,
        retain_extraction_mode: plan.extractionMode,
        enable_observations: plan.observations.enabled,
        disposition_skepticism: plan.disposition.skepticism,
        disposition_literalism: plan.disposition.literalism,
        disposition_empathy: plan.disposition.empathy,
      }),
    });

    // 2. config overrides: entity vocab + consolidation switch.
    await hsFetch(`/v1/default/banks/${enc}/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        updates: {
          entity_labels: plan.entityLabels,
          enable_observations: plan.observations.enabled,
          enable_auto_consolidation: plan.observations.autoConsolidate,
        },
      }),
    });

    // 3. directives (idempotent by name).
    let directivesCreated = 0;
    try {
      const existing = (await hsFetch(`/v1/default/banks/${enc}/directives`)) as { items?: { name?: string }[] };
      const names = new Set((existing.items ?? []).map((d) => d.name));
      for (const d of plan.directives) {
        if (names.has(d.name)) continue;
        await hsFetch(`/v1/default/banks/${enc}/directives`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: d.name, content: d.content, tags: d.tags }),
        });
        directivesCreated++;
      }
    } catch (e) {
      warnings.push(`directives: ${(e as Error).message}`);
    }

    // 4. mental-model seed (background op; best-effort on empty banks).
    let mentalModelOp: string | null = null;
    try {
      const mm = (await hsFetch(`/v1/default/banks/${enc}/mental-models`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: plan.mentalModel.name, source_query: plan.mentalModel.source_query }),
      })) as { operation_id?: string; id?: string };
      mentalModelOp = mm.operation_id ?? mm.id ?? "submitted";
    } catch (e) {
      warnings.push(`mental-model seed: ${(e as Error).message}`);
    }

    setSetting(readyKey(line.id), "1");
    setSetting(draftKey(line.id), JSON.stringify(plan));
    return { ok: true, bankId, directivesCreated, mentalModelOp, warnings };
  });
}
