import type { StoredConversation, TranscriptStore, Verdict } from '../src/slack/port.js';

/** In-memory transcript store that enforces the same body and verdict rules as Postgres. */
export class MemoryTranscriptStore implements TranscriptStore {
  readonly rows = new Map<string, StoredConversation>();
  readonly verdicts = new Map<string, Verdict>();

  async get(conversationId: string) {
    return this.rows.get(conversationId) ?? null;
  }

  async verdict(conversationId: string) {
    return this.verdicts.get(conversationId) ?? null;
  }

  async saveOutcome(row: StoredConversation, verdict: Verdict) {
    if (row.status === 'dropped' && (row.redactedText !== null || row.contentHash !== null)) throw new Error('dropped row stored text');
    if (row.status === 'stored' && (row.redactedText === null || row.contentHash === null)) throw new Error('stored row missing text');
    if (verdict.usable !== (verdict.status === 'pending' || verdict.status === 'used')) throw new Error('usable verdicts must stay pending or used');
    if (verdict.conversationId !== row.conversationId) throw new Error('verdict conversation mismatch');
    this.rows.set(row.conversationId, row);
    this.verdicts.set(verdict.conversationId, verdict);
  }

  async close() {}
}
