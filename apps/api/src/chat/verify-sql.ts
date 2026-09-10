/**
 * Read-only SQL guard (extracted from chat tools so it is unit-testable).
 *
 * Concept reference (DB-GPT, ported idea — not runtime):
 *  - packages/dbgpt-app/src/dbgpt_app/scene/chat_data/chat_excel/excel_learning/verify_sql.py
 *    (last-mile statement validation before execution)
 *  - packages/dbgpt-app/src/dbgpt_app/scene/chat_db/auto_execute/out_parser.py
 *    (DbChatOutputParser: reject non-SQL before run)
 * See new-plan/04-part2-chat-graphs.md §2 Tool B.
 */

export const CHAT_SQL_MAX_ROWS = 200;

/** Strip trailing semicolons; throw unless the statement is a single read-only SELECT/WITH. */
export function assertReadOnly(sql: string): string {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (!s) throw new Error('empty SQL is not allowed');
  if (/;/.test(s)) throw new Error('only a single statement is allowed');
  if (!/^(select|with)\b/i.test(s)) throw new Error('only SELECT / WITH queries are allowed');
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|analyze)\b/i.test(s)) {
    throw new Error('write/DDL keywords are not allowed');
  }
  return s;
}
