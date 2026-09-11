/**
 * Backend API entrypoint. Registers: health, auth, chat, schedule, history,
 * settings, ops.
 */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { authPlugin } from './auth/middleware.js';
import { authRoutes } from './auth/routes.js';
import { chatRoutes } from './chat/route.js';
import { config } from './config.js';
import { getAppDb } from './db/app/client.js';
import { getMachineDb } from './db/machine-db.js';
import { getHindsight } from './hindsight/index.js';
import { historyRoutes } from './history/routes.js';
import { lineRoutes } from './lines/routes.js';
import { logger } from './logger.js';
import { opsRoutes } from './ops/routes.js';
import { scheduleRoutes } from './schedule/routes.js';
import { settingsRoutes } from './settings/routes.js';

async function buildServer() {
  const app = Fastify({ loggerInstance: logger });

  await app.register(cors, { origin: config.api.corsOrigins, credentials: true });
  await app.register(cookie, { secret: config.auth.jwtSecret });
  await app.register(authPlugin);

  const machineDb = getMachineDb();
  const hindsight = getHindsight();
  getAppDb(); // eager-init so a bad APP_DATABASE_URL fails at boot

  app.get('/health', async () => {
    const [machineOk, hindsightOk] = await Promise.all([
      machineDb.checkDbConnection(),
      hindsight.ping(),
    ]);
    return {
      status: 'ok',
      runtimeMode: config.runtimeMode,
      checks: { machineDb: machineOk, hindsight: hindsightOk, appDb: true },
    };
  });

  await app.register(authRoutes);
  await app.register(chatRoutes);
  await app.register(lineRoutes);
  await app.register(scheduleRoutes);
  await app.register(historyRoutes);
  await app.register(settingsRoutes);
  await app.register(opsRoutes);

  return app;
}

async function main() {
  const app = await buildServer();
  await app.listen({ port: config.api.port, host: '0.0.0.0' });
  logger.info({ port: config.api.port, mode: config.runtimeMode }, 'API listening');

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      logger.info({ sig }, 'shutting down');
      app.close().then(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  logger.error({ err }, 'API failed to start');
  process.exit(1);
});
