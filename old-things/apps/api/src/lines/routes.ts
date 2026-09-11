import type { FastifyInstance } from 'fastify';
import { listLines } from './store.js';

/** User-facing: active lines only — feeds the chat picker + schedule form. */
export async function lineRoutes(app: FastifyInstance) {
  app.get('/lines', { preHandler: app.requireUser }, async () => {
    return { lines: await listLines(true) };
  });
}
