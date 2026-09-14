import cors from "@fastify/cors";
import Fastify from "fastify";
import { openStore } from "./db/store.js";
import { createLogger } from "./logger.js";
import { chatRoutes } from "./routes/chat.js";
import { scheduleRoutes } from "./routes/schedules.js";
import { reportRoutes } from "./routes/reports.js";
import { startScheduler } from "./scheduler.js";

const PORT = Number(process.env.PORT ?? 3200);
const STORE_PATH = process.env.RAG_STORE_PATH ?? "./data/rag.db";

async function main() {
  const log = createLogger();
  openStore(STORE_PATH);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ ok: true, plane: "rag", at: new Date().toISOString() }));

  await app.register(chatRoutes);
  await app.register(scheduleRoutes);
  await app.register(reportRoutes);

  startScheduler(log);
  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
