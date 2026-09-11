/**
 * Fastify auth plugin. Decorates the instance with `requireUser` / `requireOps`
 * preHandlers and adds `req.user` / `req.ops` typed fields.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config.js';
import { readSession } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; username: string };
    ops?: { username: string };
  }
  interface FastifyInstance {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireOps: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (app) => {
  app.decorate('requireUser', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[config.auth.cookieName];
    const claims = token ? await readSession(token, 'user') : null;
    if (!claims) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    req.user = { userId: claims.sub, username: claims.username };
  });

  app.decorate('requireOps', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[config.ops.cookieName];
    const claims = token ? await readSession(token, 'ops') : null;
    if (!claims) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    req.ops = { username: claims.username };
  });
});
