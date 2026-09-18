import mysql from "mysql2/promise";
import type { ConnectionRecord } from "../db/store.js";
import { assertReadonly, type DbDriver, type TableInfo } from "./types.js";

async function getConn(c: ConnectionRecord) {
  return mysql.createConnection({
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.username,
    password: c.password,
    connectTimeout: c.timeoutMs,
  });
}

export const mysqlDriver: DbDriver = {
  async probe(conn) {
    const start = Date.now();
    const db = await getConn(conn);
    try {
      const [rows] = await db.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_SCHEMA AS `schema`, TABLE_NAME AS `name` FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY 1,2",
        [conn.schemaFilter ?? conn.database]
      );
      return {
        latencyMs: Date.now() - start,
        tables: (rows as { schema: string; name: string }[]).map((r) => ({
          schema: r.schema,
          name: r.name,
        })),
      };
    } finally {
      await db.end();
    }
  },

  async describeTable(conn, schema, table): Promise<TableInfo> {
    const db = await getConn(conn);
    try {
      const [cols] = await db.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type,
                (IS_NULLABLE = 'YES') AS nullable,
                COLUMN_COMMENT AS description
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [schema, table]
      );
      const [pk] = await db.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
         ORDER BY ORDINAL_POSITION`,
        [schema, table]
      );
      let rowCount: number | null = null;
      try {
        const [cnt] = await db.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS c FROM \`${schema}\`.\`${table}\``
        );
        rowCount = Number((cnt[0] as { c: unknown }).c);
      } catch {
        rowCount = null;
      }
      return {
        schema,
        name: table,
        rowCount,
        primaryKey: (pk as { name: string }[]).map((r) => r.name),
        columns: (cols as { name: string; type: string; nullable: boolean | number; description?: string }[]).map(
          (c) => ({ name: c.name, type: c.type, nullable: c.nullable === 1 || c.nullable === true, description: (c.description as string) || undefined })
        ),
      };
    } finally {
      await db.end();
    }
  },

  async sampleRows(conn, schema, table, limit) {
    const n = Math.max(1, Math.min(100, Math.floor(limit)));
    const db = await getConn(conn);
    try {
      const [rows, fields] = await db.query<mysql.RowDataPacket[]>(
        `SELECT * FROM \`${schema}\`.\`${table}\` LIMIT ${n}`
      );
      return {
        columns: (fields as { name: string }[]).map((f) => f.name),
        rows: rows as Record<string, unknown>[],
      };
    } finally {
      await db.end();
    }
  },

  async queryReadonly<T>(conn: ConnectionRecord, sql: string): Promise<T[]> {
    assertReadonly(sql);
    const db = await getConn(conn);
    try {
      const [rows] = await db.query<mysql.RowDataPacket[]>(sql);
      return rows as T[];
    } finally {
      await db.end();
    }
  },
};
