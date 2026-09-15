import cors from "@fastify/cors";
import Fastify from "fastify";
import { openStore } from "./db/store.js";
import { createLogger } from "./logger.js";
import { startPoller } from "./poller.js";
import { connectionRoutes } from "./routes/connections.js";
import { bankRoutes } from "./routes/banks.js";
import { cardRoutes } from "./routes/cards.js";
import { chartRoutes } from "./routes/charts.js";
import { graphRoutes } from "./routes/graphs.js";
import { hindsightRoutes } from "./routes/hindsight.js";
import { historyRoutes } from "./routes/history.js";
import { lineRoutes } from "./routes/lines.js";
import { llmRoutes } from "./routes/llm.js";
import { llmCallRoutes } from "./routes/llmcalls.js";
import { playgroundRoutes } from "./routes/playground.js";
import { runTick, startTicker } from "./ticker.js";

const PORT = Number(process.env.PORT ?? 3100);
const STORE_PATH = process.env.STORE_PATH ?? "./data/setter.db";

async function main() {
  const log = createLogger();
  openStore(STORE_PATH);

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ ok: true, at: new Date().toISOString() }));

  await app.register(connectionRoutes);
  await app.register(bankRoutes);
  await app.register(lineRoutes);
  await app.register(cardRoutes);
  await app.register(chartRoutes);
  await app.register(graphRoutes);
  await app.register(historyRoutes);
  await app.register(hindsightRoutes);
  await app.register(llmRoutes);
  await app.register(llmCallRoutes);
  await app.register(playgroundRoutes);

  // Manual tick trigger (setter action + verification hook).
  app.post("/api/ingest/tick", async () => runTick(app.log));

  startPoller(app.log);
  if (process.env.TICK_ENABLED !== "false") startTicker(app.log);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
