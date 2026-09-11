import type { ConnectionRecord } from "../db/store.js";
import { mysqlDriver } from "./mysql.js";
import { postgresDriver } from "./postgres.js";
import type { DbDriver } from "./types.js";

export * from "./types.js";

export function driverFor(conn: ConnectionRecord): DbDriver {
  return conn.type === "mysql" ? mysqlDriver : postgresDriver;
}
