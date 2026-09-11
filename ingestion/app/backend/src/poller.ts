import { listConnections, recordCheck } from "./db/store.js";
import { driverFor } from "./drivers/index.js";
import type { Logger } from "./logger.js";
import { unassignedTables } from "./routes/lines.js";

const POLL_INTERVAL_MS = Number(process.env.POLLER_INTERVAL_MS ?? 5 * 60 * 1000);

/**
 * F1 poller: continuously verifies each enabled connection; silent when
 * healthy, loud in the logs when not.
 */
export function startPoller(log: Logger): NodeJS.Timeout {
  async function tick() {
    for (const conn of listConnections()) {
      if (!conn.enabled) continue;
      const at = new Date().toISOString();
      try {
        const r = await driverFor(conn).probe(conn);
        recordCheck({
          connectionId: conn.id,
          at,
          ok: true,
          latencyMs: r.latencyMs,
          tableCount: r.tables.length,
          error: null,
        });
        // F2 lock: nudge about source tables belonging to no registered line.
        try {
          const unassigned = await unassignedTables(conn.id);
          if (unassigned.length > 0) {
            log.warn(
              { connectionId: conn.id, label: conn.label, unassigned },
              "source tables belong to no line"
            );
          }
        } catch {
          // probe already succeeded; nudge is best-effort
        }
      } catch (e) {
        const error = (e as Error).message;
        recordCheck({
          connectionId: conn.id,
          at,
          ok: false,
          latencyMs: null,
          tableCount: null,
          error,
        });
        log.error(
          { connectionId: conn.id, label: conn.label, error },
          "connection health check FAILED"
        );
      }
    }
  }
  void tick();
  return setInterval(() => void tick(), POLL_INTERVAL_MS);
}
