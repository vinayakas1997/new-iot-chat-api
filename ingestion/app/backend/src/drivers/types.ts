import type { ConnectionRecord } from "../db/store.js";

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TableInfo {
  schema: string;
  name: string;
  rowCount: number | null;
  primaryKey: string[];
  columns: ColumnInfo[];
}

export interface BrowseResult {
  tables: { schema: string; name: string }[];
}

export interface SampleResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** One interface; nothing above this layer knows postgres from mysql. */
export interface DbDriver {
  /** Read-only probe: connect + list tables. Never writes. */
  probe(conn: ConnectionRecord): Promise<{ latencyMs: number; tables: { schema: string; name: string }[] }>;
  describeTable(conn: ConnectionRecord, schema: string, table: string): Promise<TableInfo>;
  sampleRows(conn: ConnectionRecord, schema: string, table: string, limit: number): Promise<SampleResult>;
  /** Run one read-only SELECT (SELECT/WITH/SHOW/DESCRIBE/EXPLAIN only). */
  queryReadonly<T = Record<string, unknown>>(conn: ConnectionRecord, sql: string): Promise<T[]>;
}

const READONLY = /^\s*(select|with|show|describe|desc|explain)\b/i;

export function assertReadonly(sql: string): void {
  if (!READONLY.test(sql)) throw new Error("only read-only statements allowed");
}
