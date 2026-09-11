import pg from "pg";
import type { ConnectionRecord } from "../db/store.js";
import { assertReadonly, type DbDriver, type TableInfo } from "./types.js";

function poolFor(c: ConnectionRecord): pg.Pool {
  return new pg.Pool({
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.username,
    password: c.password,
    connectionTimeoutMillis: c.timeoutMs,
    max: 1,
  });
}

function schemaClause(c: ConnectionRecord): { sql: string; params: string[] } {
  if (c.schemaFilter) return { sql: "AND n.nspname = $1", params: [c.schemaFilter] };
  return {
    sql: "AND n.nspname NOT IN ('pg_catalog','information_schema')",
    params: [],
  };
}

async function listTables(c: ConnectionRecord, client: pg.PoolClient) {
  const sc = schemaClause(c);
  const r = await client.query(
    `SELECT n.nspname AS schema, t.relname AS name
     FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE t.relkind IN ('r','v','m','f') ${sc.sql}
     ORDER BY 1,2`,
    sc.params
  );
  return r.rows as { schema: string; name: string }[];
}

export const postgresDriver: DbDriver = {
  async probe(conn) {
    const pool = poolFor(conn);
    const start = Date.now();
    try {
      const client = await pool.connect();
      try {
        const tables = await listTables(conn, client);
        return { latencyMs: Date.now() - start, tables };
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  },

  async describeTable(conn, schema, table): Promise<TableInfo> {
    const pool = poolFor(conn);
    try {
      const client = await pool.connect();
      try {
        const cols = await client.query(
          `SELECT a.attname AS name,
                  pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
                  NOT a.attnotnull AS nullable
           FROM pg_attribute a
           JOIN pg_class t ON t.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = $1 AND t.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
           ORDER BY a.attnum`,
          [schema, table]
        );
        const pk = await client.query(
          `SELECT a.attname AS name FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
           JOIN pg_class t ON t.oid = i.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = $1 AND t.relname = $2 AND i.indisprimary`,
          [schema, table]
        );
        let rowCount: number | null = null;
        try {
          const cnt = await client.query(
            `SELECT count(*)::int AS c FROM "${schema}"."${table}"`
          );
          rowCount = cnt.rows[0].c as number;
        } catch {
          rowCount = null;
        }
        return {
          schema,
          name: table,
          rowCount,
          primaryKey: (pk.rows as { name: string }[]).map((r) => r.name),
          columns: cols.rows as TableInfo["columns"],
        };
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  },

  async sampleRows(conn, schema, table, limit) {
    assertReadonly(`SELECT * FROM "${schema}"."${table}" LIMIT ${limit}`);
    const pool = poolFor(conn);
    try {
      const client = await pool.connect();
      try {
        const r = await client.query(`SELECT * FROM "${schema}"."${table}" LIMIT $1`, [limit]);
        return { columns: r.fields.map((f) => f.name), rows: r.rows };
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  },

  async queryReadonly<T>(conn: ConnectionRecord, sql: string): Promise<T[]> {
    assertReadonly(sql);
    const pool = poolFor(conn);
    try {
      const client = await pool.connect();
      try {
        const r = await client.query(sql);
        return r.rows as T[];
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  },
};
