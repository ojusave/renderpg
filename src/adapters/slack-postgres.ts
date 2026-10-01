import pg from 'pg';
import type { StoredConversation, TranscriptStore, Verdict } from '../slack/port.js';

interface ConversationRecord {
  conversation_id: string;
  kind: StoredConversation['kind'];
  status: StoredConversation['status'];
  drop_reason: string | null;
  redacted_text: string | null;
  content_hash: string | null;
  message_count: number;
  redaction_counts: Record<string, number> | null;
  cursor_ts: string;
}

/** Keeps a claimed transcript inside the author prompt limit. */
function clipTranscript(text: string): string {
  if (text.length <= 2500) return text;
  const cut = text.lastIndexOf('\n', 2500);
  return text.slice(0, cut > 200 ? cut : 2500);
}

/** Stores redacted transcripts. The table constraint rejects raw bodies on dropped rows. */
export class PostgresTranscriptStore implements TranscriptStore {
  readonly pool: pg.Pool;
  private readonly ownsPool: boolean;
  constructor(connectionString: string, pool?: pg.Pool) {
    this.ownsPool = !pool;
    this.pool = pool ?? new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  }

  async get(conversationId: string): Promise<StoredConversation | null> {
    const record = (await this.pool.query<ConversationRecord>(
      'SELECT * FROM slack_conversations WHERE conversation_id=$1', [conversationId])).rows[0];
    return record ? this.conversation(record) : null;
  }

  async verdict(conversationId: string): Promise<Verdict | null> {
    const record = (await this.pool.query<{ conversation_id: string; usable: boolean; status: Verdict['status']; reasons: unknown }>(
      'SELECT conversation_id, usable, status, reasons FROM slack_verdicts WHERE conversation_id=$1', [conversationId])).rows[0];
    if (!record) return null;
    const reasons = Array.isArray(record.reasons) ? record.reasons.filter((reason): reason is string => typeof reason === 'string') : [];
    return { conversationId: record.conversation_id, usable: record.usable, status: record.status, reasons };
  }

  /** Persists the transcript and verdict together so a crash cannot keep text without a decision. */
  async saveOutcome(row: StoredConversation, verdict: Verdict): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO slack_conversations(
          conversation_id, kind, status, drop_reason, redacted_text, content_hash, message_count, redaction_counts, cursor_ts)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
        ON CONFLICT (conversation_id) DO UPDATE SET
          kind=EXCLUDED.kind, status=EXCLUDED.status, drop_reason=EXCLUDED.drop_reason,
          redacted_text=EXCLUDED.redacted_text, content_hash=EXCLUDED.content_hash,
          message_count=EXCLUDED.message_count, redaction_counts=EXCLUDED.redaction_counts,
          cursor_ts=EXCLUDED.cursor_ts, updated_at=now()`, [
        row.conversationId, row.kind, row.status, row.dropReason, row.redactedText, row.contentHash,
        row.messageCount, JSON.stringify(row.redactionCounts), row.cursorTs,
      ]);
      await client.query(`INSERT INTO slack_verdicts(conversation_id, usable, status, reasons)
        VALUES ($1,$2,$3,$4::jsonb)
        ON CONFLICT (conversation_id) DO UPDATE SET
          usable=EXCLUDED.usable, status=EXCLUDED.status, reasons=EXCLUDED.reasons, updated_at=now()`, [
        verdict.conversationId, verdict.usable, verdict.status, JSON.stringify(verdict.reasons),
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Claims the oldest unused transcript so the next case is a different story. */
  async nextPrompt(): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const picked = (await client.query<{ redacted_text: string; conversation_id: string }>(`SELECT c.conversation_id, c.redacted_text
        FROM slack_conversations c
        JOIN slack_verdicts v ON v.conversation_id = c.conversation_id
        WHERE v.usable = true AND v.status = 'pending' AND c.redacted_text IS NOT NULL
        ORDER BY c.updated_at ASC, c.conversation_id ASC
        FOR UPDATE OF v SKIP LOCKED
        LIMIT 1`)).rows[0];
      if (!picked) {
        await client.query('COMMIT');
        return null;
      }
      await client.query(`UPDATE slack_verdicts SET status='used', updated_at=now() WHERE conversation_id=$1`, [picked.conversation_id]);
      await client.query('COMMIT');
      return clipTranscript(picked.redacted_text);
    } catch {
      await client.query('ROLLBACK');
      return null;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }

  private conversation(record: ConversationRecord): StoredConversation {
    return {
      conversationId: record.conversation_id, kind: record.kind, status: record.status,
      dropReason: record.drop_reason, redactedText: record.redacted_text, contentHash: record.content_hash,
      messageCount: record.message_count, redactionCounts: record.redaction_counts ?? {}, cursorTs: record.cursor_ts,
    };
  }
}
