import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addMessage, createSession, deleteSession, getSession, listMessages, listSessions } from "../db/store.js";
import { ingest } from "../rag/ingestClient.js";
import { answerQuestion } from "../rag/answer.js";
import { chatStream, resolveLlm } from "../rag/llm.js";

const chatBody = z.object({
  sessionId: z.string().optional(),
  lineIds: z.array(z.string().min(1)).min(1).max(5),
  message: z.string().min(1).max(4000),
});

export async function chatRoutes(app: FastifyInstance) {
  app.get("/api/rag/lines", async () => {
    try {
      return await ingest.listLines();
    } catch (e) {
      return { error: (e as Error).message, lines: [] };
    }
  });

  app.get("/api/rag/sessions", async () => listSessions());
  app.post("/api/rag/sessions", async (req) => {
    const p = z.object({ lineIds: z.array(z.string()).default([]), title: z.string().max(120).optional() }).safeParse(req.body ?? {});
    return createSession(p.success ? p.data.lineIds : [], p.success ? p.data.title : undefined);
  });
  app.get("/api/rag/sessions/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getSession(id)) return reply.code(404).send({ error: "session not found" });
    return listMessages(id);
  });
  app.delete("/api/rag/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteSession(id)) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  /**
   * POST /api/rag/chat — NDJSON stream:
   *   {"type":"text","delta":"..."}* then {"type":"final","answer":{...},"sessionId":"..."}
   * Deterministic pipeline (recall → SQL → chart) runs first; only the
   * synthesis prose streams token-by-token.
   */
  app.post("/api/rag/chat", async (req, reply) => {
    const p = chatBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const { lineIds, message } = p.data;

    // Validate lines against ingestion.
    try {
      const lines = await ingest.listLines();
      const unknown = lineIds.filter((id) => !lines.some((l) => l.id === id));
      if (unknown.length) return reply.code(400).send({ error: `unknown line(s): ${unknown.join(", ")}` });
    } catch (e) {
      return reply.code(502).send({ error: `ingestion unreachable: ${(e as Error).message}` });
    }

    let sessionId = p.data.sessionId;
    if (!sessionId || !getSession(sessionId)) {
      const s = createSession(lineIds, message.slice(0, 60));
      sessionId = s.id;
    }
    addMessage(sessionId, "user", message);

    reply.raw.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    reply.raw.setHeader("cache-control", "no-store");
    reply.raw.setHeader("x-accel-buffering", "no");
    const send = (o: unknown) => reply.raw.write(JSON.stringify(o) + "\n");

    const answer = await answerQuestion(lineIds, message);

    // Stream the synthesis prose (cheap word-chunk) so UI behaves like ChatGPT.
    const { llm } = await resolveLlm();
    if (llm) {
      try {
        for await (const d of chatStream(llm, "Repeat the following answer verbatim.", answer.summary)) send({ type: "text", delta: d });
      } catch {
        send({ type: "text", delta: answer.summary });
      }
    } else {
      // No LLM: send in two chunks so UI still exercises streaming path.
      const mid = Math.ceil(answer.summary.length / 2);
      send({ type: "text", delta: answer.summary.slice(0, mid) });
      send({ type: "text", delta: answer.summary.slice(mid) });
    }

    addMessage(sessionId, "assistant", answer.summary, answer.charts as unknown[], answer.sources as unknown[]);
    send({ type: "final", answer, sessionId });
    reply.raw.end();
  });
}
