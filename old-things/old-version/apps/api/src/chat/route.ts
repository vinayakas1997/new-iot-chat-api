import { ChatRequest } from '@app/shared';
import type { FastifyInstance } from 'fastify';
import { getLlm } from '../llm/index.js';
import { bankForUserQuery } from '../hindsight/index.js';
import { writeHistory } from '../history/store.js';
import { buildChatTools } from './tools.js';
import { chatSystemPrompt } from './prompt.js';

export async function chatRoutes(app: FastifyInstance) {
  const llm = getLlm();

  app.post('/chat', { preHandler: app.requireUser }, async (req, reply) => {
    const parsed = ChatRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });

    const { userId } = req.user!;
    const messages = parsed.data.messages;
    const question = messages[messages.length - 1]!.content;
    const bankId = bankForUserQuery(userId, question);

    reply.raw.setHeader('content-type', 'text/plain; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-store');
    reply.raw.setHeader('x-accel-buffering', 'no');

    let full = '';
    try {
      for await (const chunk of llm.stream({
        system: chatSystemPrompt(bankId),
        messages,
        tools: buildChatTools(bankId),
        maxSteps: 5,
      })) {
        full += chunk;
        reply.raw.write(chunk);
      }
    } catch (err) {
      req.log.error({ err }, 'chat stream failed');
      if (!full) reply.raw.write('Sorry — something went wrong answering that.');
    }

    reply.raw.end();
    // Persist every answer for the History view (fire-and-forget).
    void writeHistory({ userId, source: 'chat', question, answer: full, scheduleId: null });
  });
}
