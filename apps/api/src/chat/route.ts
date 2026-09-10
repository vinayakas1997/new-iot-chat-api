import { ChatAnswer, ChatRequest, type AnswerSource, type LineAnswer } from '@app/shared';
import type { FastifyInstance } from 'fastify';
import { getLlm } from '../llm/index.js';
import { banksForQuery } from '../hindsight/index.js';
import { writeHistory } from '../history/store.js';
import { resolveLineScope } from '../lines/store.js';
import { buildChatTools } from './tools.js';
import { chatSystemPrompt } from './prompt.js';
import { buildChartForQuestion } from './chart-tool.js';

export async function chatRoutes(app: FastifyInstance) {
  const llm = getLlm();

  app.post('/chat', { preHandler: app.requireUser }, async (req, reply) => {
    const parsed = ChatRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });

    const { userId } = req.user!;
    const messages = parsed.data.messages;
    const question = messages[messages.length - 1]!.content;

    // Line scope: omitted/empty = ALL active lines (resolved server-side).
    const scope = await resolveLineScope(parsed.data.lineIds);
    if (scope.unknown.length > 0) {
      return reply.code(400).send({ error: `unknown line(s): ${scope.unknown.join(', ')}`, valid: scope.valid });
    }
    if (scope.lineIds.length === 0) {
      return reply.code(400).send({ error: 'no active lines', valid: scope.valid });
    }
    const targets = banksForQuery(scope.lineIds);
    const multi = targets.length > 1;

    // NDJSON envelope stream (see packages/shared chart-schema.ts ChatChunk):
    //   {"type":"text","delta":"..."} lines, then one {"type":"final","answer":{...}} line.
    // Multi-line chats stream SEPARATE per-line answers, each under a ## line header.
    reply.raw.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-store');
    reply.raw.setHeader('x-accel-buffering', 'no');

    const send = (obj: unknown) => reply.raw.write(JSON.stringify(obj) + '\n');
    const lineAnswers: LineAnswer[] = [];

    for (const { lineId, bankId } of targets) {
      if (multi) send({ type: 'text', delta: `\n## ${lineId}\n` });

      let summary = '';
      const sources: AnswerSource[] = [{ tool: 'recall_memory' }];
      try {
        for await (const chunk of llm.stream({
          system: chatSystemPrompt(bankId),
          messages,
          tools: buildChatTools(bankId),
          maxSteps: 5,
        })) {
          summary += chunk;
          send({ type: 'text', delta: chunk });
        }
      } catch (err) {
        req.log.error({ err, lineId }, 'chat stream failed');
        if (!summary) {
          summary = 'Sorry — something went wrong answering that.';
          send({ type: 'text', delta: summary });
        }
      }

      // Deterministic server-side charts (work in mock mode too — no LLM needed).
      const charts = await buildChartForQuestion(question, lineId);
      if (charts.length > 0) sources.push({ tool: 'chart_spec', detail: charts[0]!.chart_name });
      lineAnswers.push({ lineId, summary, charts, sources });
    }

    // Combined lead + union charts keep single-line renderers working unchanged.
    const summary = lineAnswers.map((l) => (multi ? `## ${l.lineId}\n${l.summary}` : l.summary)).join('\n\n');
    const charts = lineAnswers.flatMap((l) => l.charts);
    const sources = lineAnswers.flatMap((l) => l.sources);
    const answer = ChatAnswer.parse({ summary, charts, sources, lines: lineAnswers });
    send({ type: 'final', answer });
    reply.raw.end();

    // Persist the full envelope for the History view (charts replay).
    // History table stores charts/lines inside meta JSONB (no migration needed).
    void writeHistory({
      userId,
      source: 'chat',
      question,
      answer: summary,
      scheduleId: null,
      meta: { charts, sources, lines: lineAnswers, lineIds: scope.lineIds },
    });
  });
}
