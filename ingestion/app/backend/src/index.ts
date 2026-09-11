import cors from "@fastify/cors";
import Fastify from "fastify";
import { openStore } from "./db/store.js";
import { createLogger } from "./logger.js";
import { startPoller } from "./poller.js";
import { connectionRoutes } from "./routes/connections.js";
import { cardRoutes } from "./routes/cards.js";
import { hindsightRoutes } from "./routes/hindsight.js";
import { historyRoutes } from "./routes/history.js";
import { lineRoutes } from "./routes/lines.js";

const PORT = Number(process.env.PORT ?? 3100);
const STORE_PATH = process.env.STORE_PATH ?? "./data/setter.db";

async function main() {
  const log = createLogger();
  openStore(STORE_PATH);

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ ok: true, at: new Date().toISOString() }));

  await app.register(connectionRoutes);
  await app.register(lineRoutes);
  await app.register(cardRoutes);
  await app.register(historyRoutes);
  await app.register(hindsightRoutes);

  startPoller(app.log);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
