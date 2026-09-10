/**
 * getBankId — DECISION 2 (implementation-plan.md §7).
 *
 * The bank is the memory partition. Default scheme is `per-line`: questions are
 * asked at line granularity, and individual machines live as entities/tags
 * inside the line's bank. Changing the scheme later means re-ingesting, so it is
 * pinned by HINDSIGHT_BANK_SCHEME and funnelled through this one function.
 */
import { config } from '../config.js';

export interface BankKey {
  lineId?: string;
  machineId?: string;
  plantId?: string;
}

export function getBankId(key: BankKey): string {
  switch (config.hindsight.bankScheme) {
    case 'per-machine': {
      if (!key.machineId) throw new Error('getBankId(per-machine): machineId required');
      return `machine:${key.machineId}`;
    }
    case 'per-plant': {
      return `plant:${key.plantId ?? 'default'}`;
    }
    case 'per-line':
    default: {
      if (!key.lineId) throw new Error('getBankId(per-line): lineId required');
      return `line:${key.lineId}`;
    }
  }
}

/** For chat: pick the bank a user's question is about. Phase 4 keeps this simple
 *  (single configured line); a real router would classify the question first. */
export function bankForUserQuery(_userId: string, _query: string): string {
  return getBankId({ lineId: 'line-3', plantId: 'default' });
}

/** Multi-line scope: one bank per resolved line id (chat default = all lines). */
export function banksForQuery(lineIds: string[]): { lineId: string; bankId: string }[] {
  return lineIds.map((lineId) => ({ lineId, bankId: getBankId({ lineId }) }));
}
