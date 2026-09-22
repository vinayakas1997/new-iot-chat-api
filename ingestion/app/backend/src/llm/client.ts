import { z } from "zod";
import { activeLlmProvider, recordLlmCall, type LlmCallAttempt } from "../db/store.js";
import type { Logger } from "../logger.js";
import { extractJson, isRepetitionLoop } from "./parse.js";

/**
 * The one LLM calling convention for the whole backend.
 *
 * Every route that talks to a chat-completions endpoint goes through
 * llmChatJson — retry/backoff, per-attempt timeouts, JSON repair, schema
 * validation with one corrective re-prompt, structured failure reasons and
 * pino logging all live here. Call sites only supply prompt + schema +
 * context; they never own transport policy.
 */

/** Machine-readable cause of an LLM failure. `null` on success. */
export type LlmFailReason =
  | "no-provider"
  | "timeout"
  | "http-4xx"
  | "http-5xx"
  | "network"
  | "empty"
  | "bad-json"
  | "schema-reject";

export interface LlmResult<T> {
  parsed: T | null;
  /** Raw model text of the last attempt ("" when transport never answered). */
  text: string;
  model: string;
  reason: LlmFailReason | null;
  latencyMs: number;
  attempts: number;
  /** Audit row id in llm_calls (null only when the audit write itself failed). */
  llmCallId: number | null;
}

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LlmCallOptions<T> {
  system: string;
  user: string;
  /**
   * PNG data-URL images appended to the user message (vision reads).
   * Never logged: the audit row records count + byte size only.
   */
  images?: string[];
  /**
   * Zod schema the model's JSON must satisfy. Typed on the *output* side
   * only (Input = unknown) so schemas with defaults/coercion infer T
   * from what safeParse returns, not what it accepts.
   */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Logged with every failure; surfaced nowhere else. */
  context?: Record<string, unknown>;
  log?: Logger;
  temperature?: number;
  maxTokens?: number;
  /**
   * Per-call attempt budget override. The central default
   * (LLM_MAX_ATTEMPTS) applies otherwise; background best-effort paths
   * like tick extraction pass a smaller budget so they degrade fast.
   */
  maxAttempts?: number;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ChatContentPart[] };

/** response_format=json_object support probe per provider base URL. */
const jsonModeOk = new Map<string, boolean>();

/* ---------------- JSON extraction + repair (pure, unit-tested) ---------------- */
export { extractJson } from "./parse.js";

/* ---------------- transport ---------------- */

interface AttemptOutcome {
  ok: boolean;
  text: string;
  reason?: LlmFailReason;
  /** Server rejected response_format — retry same attempt without it. */
  jsonModeRejected?: boolean;
}

async function chatAttempt(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number | undefined,
  timeoutMs: number,
  useJsonMode: boolean
): Promise<AttemptOutcome> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> = { model, temperature, messages };
    if (useJsonMode) body.response_format = { type: "json_object" };
    if (maxTokens != null) body.max_tokens = maxTokens;
    let r: Response;
    try {
      r = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError" || ctl.signal.aborted) return { ok: false, text: "", reason: "timeout" };
      return { ok: false, text: "", reason: "network" };
    }
    if (!r.ok) {
      let errText = "";
      try {
        errText = await r.text();
      } catch { /* ignore */ }
      if (r.status === 400 && useJsonMode && /response_format/i.test(errText)) {
        return { ok: false, text: "", jsonModeRejected: true };
      }
      if (r.status === 429 || r.status >= 500) return { ok: false, text: "", reason: "http-5xx" };
      return { ok: false, text: "", reason: "http-4xx" };
    }
    const parsed = (await r.json()) as { choices?: { message?: { content?: string | null } }[] };
    const text = parsed.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) return { ok: false, text: "", reason: "empty" };
    return { ok: true, text };
  } finally {
    clearTimeout(t);
  }
}

function zodIssues(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`).join("; ").slice(0, 500);
}

/** Persist one audit row for F6 AI Logs. Best-effort: never throws. */
function persistCall<T>(
  ctx: Record<string, unknown>,
  model: string,
  r: LlmResult<T>,
  timeline: LlmCallAttempt[],
  system: string,
  user: string,
  images: string[]
): number | null {
  try {
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const bytes = images.reduce((n, u) => n + u.length, 0);
    const imgNote = images.length > 0 ? `\n\n[images: ${images.length} attached, ~${bytes} base64 chars — bytes in chart_readings, not here]` : "";
    return recordLlmCall({
      route: str(ctx.route) ?? "",
      lineId: str(ctx.lineId),
      cardId: str(ctx.cardId),
      templateId: str(ctx.templateId),
      model,
      success: r.parsed != null,
      reason: r.reason,
      attempts: r.attempts,
      latencyMs: r.latencyMs,
      attemptsJson: timeline,
      prompt: `SYSTEM:\n${system}\n\nUSER:\n${user}${imgNote}`,
      responseText: r.text,
      parsedJson: r.parsed != null ? JSON.stringify(r.parsed) : "",
    });
  } catch { /* audit must never break the call */ }
  return null;
}

/* ---------------- public entry ---------------- */

export async function llmChatJson<T>(opts: LlmCallOptions<T>): Promise<LlmResult<T>> {
  const start = Date.now();
  const maxAttempts = opts.maxAttempts ?? num("LLM_MAX_ATTEMPTS", 3);
  const backoffMs = num("LLM_RETRY_BACKOFF_MS", 1000);
  const timeoutMs = num("LLM_TIMEOUT_MS", 90000);
  const maxTokens = opts.maxTokens ?? (() => {
    const v = Number(process.env.LLM_MAX_TOKENS);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  })();
  const temperature = opts.temperature ?? 0.2;
  const log = opts.log;
  const ctx = { ...(opts.context ?? {}) };

  const active = activeLlmProvider();
  const images = (opts.images ?? []).filter((u) => typeof u === "string" && u.startsWith("data:image/"));
  if (!active) {
    log?.warn(ctx, "llm call skipped: no active provider");
    const empty: LlmResult<T> = { parsed: null, text: "", model: "", reason: "no-provider", latencyMs: Date.now() - start, attempts: 0, llmCallId: null };
    empty.llmCallId = persistCall(ctx, "", empty, [], opts.system, opts.user, images);
    return empty;
  }
  const baseUrl = active.baseUrl.replace(/\/$/, "");
  const model = active.activeModel;
  const logCtx = { ...ctx, model };

  const userContent: string | ChatContentPart[] =
    images.length === 0
      ? opts.user
      : [{ type: "text", text: opts.user }, ...images.map((url): ChatContentPart => ({ type: "image_url", image_url: { url } }))];
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: userContent },
  ];

  let lastText = "";
  let lastReason: LlmFailReason = "network";
  let attempts = 0;
  let corrected = false;
  const timeline: LlmCallAttempt[] = [];

  for (let n = 1; n <= maxAttempts; n++) {
    const useJsonMode = jsonModeOk.get(baseUrl) !== false;
    attempts = n;
    // Rise temperature per retry: attempt 1 is deterministic (best quality);
    // later attempts sample hotter to break deterministic repetition loops.
    const temp = Math.min(temperature + 0.3 * (n - 1), 1);
    const attemptStart = Date.now();
    const a = await chatAttempt(baseUrl, active.apiKey, model, messages, temp, maxTokens, timeoutMs, useJsonMode);
    if (a.jsonModeRejected) {
      // Capability probe failed — provider doesn't speak response_format.
      // Doesn't consume the retry budget; same attempt runs again plain.
      jsonModeOk.set(baseUrl, false);
      log?.info({ ...logCtx, attempts }, "llm provider rejects response_format, continuing without it");
      n--;
      continue;
    }
    if (!a.ok) {
      lastReason = a.reason ?? "network";
      timeline.push({ n, outcome: "failed", detail: lastReason, latencyMs: Date.now() - attemptStart, temperature: temp });
      log?.warn({ ...logCtx, attempts, reason: lastReason }, "llm attempt failed");
      if (n < maxAttempts && (lastReason === "timeout" || lastReason === "http-5xx" || lastReason === "network" || lastReason === "empty")) {
        await sleep(Math.min(backoffMs * n, 10000));
        continue;
      }
      break;
    }
    lastText = a.text;
    const found = extractJson(a.text);
    if (!found) {
      lastReason = "bad-json";
      const loop = isRepetitionLoop(a.text);
      timeline.push({ n, outcome: "failed", detail: loop ? "bad-json: repetition loop" : lastReason, latencyMs: Date.now() - attemptStart, temperature: temp });
      log?.warn({ ...logCtx, attempts, reason: lastReason, preview: a.text.slice(0, 300) }, "llm attempt returned unparsable output");
      if (n < maxAttempts) {
        await sleep(Math.min(backoffMs * n, 10000));
        continue;
      }
      break;
    }
    const v = opts.schema.safeParse(found.value);
    if (v.success) {
      if (n > 1) log?.info({ ...logCtx, attempts, stage: found.stage }, "llm call succeeded after retry");
      timeline.push({ n, outcome: "ok", detail: found.stage, latencyMs: Date.now() - attemptStart, temperature: temp });
      const ok: LlmResult<T> = { parsed: v.data, text: a.text, model, reason: null, latencyMs: Date.now() - start, attempts, llmCallId: null };
      ok.llmCallId = persistCall(ctx, model, ok, timeline, opts.system, opts.user, images);
      return ok;
    }
    lastReason = "schema-reject";
    const issues = zodIssues(v.error);
    timeline.push({ n, outcome: "rejected", detail: `schema-reject: ${issues.slice(0, 200)}`, latencyMs: Date.now() - attemptStart, temperature: temp });
    log?.warn({ ...logCtx, attempts, reason: lastReason, stage: found.stage, issues }, "llm output failed schema validation");
    if (!corrected && n < maxAttempts) {
      // One corrective re-prompt: show the model its validation errors.
      corrected = true;
      messages.push({ role: "assistant", content: a.text });
      messages.push({
        role: "user",
        content: `Your previous reply failed validation (${issues}). Reply with corrected JSON only, same shape, no prose.`,
      });
      await sleep(Math.min(backoffMs * n, 10000));
      continue;
    }
    break;
  }

  log?.warn({ ...logCtx, attempts, reason: lastReason, latencyMs: Date.now() - start }, "llm call failed");
  const failed: LlmResult<T> = { parsed: null, text: lastText, model, reason: lastReason, latencyMs: Date.now() - start, attempts, llmCallId: null };
  failed.llmCallId = persistCall(ctx, model, failed, timeline, opts.system, opts.user, images);
  return failed;
}
