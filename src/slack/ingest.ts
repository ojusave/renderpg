import { createHash } from 'node:crypto';
import { classifyTranscript } from './classify.js';
import type { ConversationRef, IngestResult, SlackHistory, SyncSummary, TranscriptStore, Verdict } from './port.js';
import { SlackRequestError } from './port.js';
import { redactConversation } from './redact.js';

const CONCURRENCY = 4;

/** Pulls bot-visible conversations, stores redacted text, and leaves usable ones pending. */
export class SlackIngestService {
  constructor(private history: SlackHistory, private store: TranscriptStore, private report: (event: string) => void) {}

  /** Fans work out through `run`. A disabled flag lists nothing and leaves stored rows untouched. */
  async ingestAll(run: (ref: ConversationRef) => Promise<IngestResult>): Promise<SyncSummary> {
    if (!ingestEnabled()) return emptySummary(true);
    const conversations = await this.history.listConversations();
    this.report('slack_conversations_listed');
    console.warn(JSON.stringify({ event: 'slack_conversations_listed', conversations: conversations.length }));
    const results = await mapPool(conversations, CONCURRENCY, async ref => {
      try {
        return await run(ref);
      } catch {
        this.report('slack_ingest_failed');
        return { conversationId: ref.conversationId, status: 'failed' as const, verdict: null };
      }
    });
    return summarize(results, false);
  }

  /** Redacts before any store call. Unchanged cursors do not fetch the transcript again. */
  async ingest(ref: ConversationRef): Promise<IngestResult> {
    if (!ingestEnabled()) return { conversationId: ref.conversationId, status: 'unchanged', verdict: null };
    try {
      return await this.ingestOne(ref);
    } catch (error) {
      if (error instanceof SlackRequestError && error.permanent) return this.drop(ref, 'unavailable', {}, '0');
      throw error;
    }
  }

  private async ingestOne(ref: ConversationRef): Promise<IngestResult> {
    const latest = await this.history.latestTimestamp(ref.conversationId);
    const cursor = latest ?? '0';
    const existing = await this.store.get(ref.conversationId);
    if (existing?.cursorTs === cursor) return { conversationId: ref.conversationId, status: 'unchanged', verdict: null };
    let snapshot;
    try {
      snapshot = await this.history.load(ref.conversationId);
    } catch (error) {
      if (error instanceof SlackRequestError && error.permanent) return this.drop(ref, 'unavailable', {}, cursor);
      throw error;
    }
    const redacted = redactConversation(snapshot.messages, snapshot.aliases);
    if (redacted.dropped || redacted.text === null) {
      return this.drop(ref, redacted.dropReason ?? 'sensitive_content', redacted.counts, cursor);
    }
    const decision = classifyTranscript(redacted.text, redacted.messageCount, redacted.speakerCount);
    const status = decision.usable ? 'pending' as const : 'rejected' as const;
    const verdict: Verdict = {
      conversationId: ref.conversationId,
      usable: decision.usable,
      status,
      reasons: decision.reasons,
    };
    await this.store.saveOutcome({
      conversationId: ref.conversationId, kind: ref.kind, status: 'stored', dropReason: null,
      redactedText: redacted.text, contentHash: hash(redacted.text), messageCount: redacted.messageCount,
      redactionCounts: redacted.counts, cursorTs: cursor,
    }, verdict);
    this.report(decision.usable ? 'slack_transcript_pending' : 'slack_transcript_rejected');
    return { conversationId: ref.conversationId, status: 'stored', verdict: status };
  }

  private async drop(ref: ConversationRef, reason: string, counts: Record<string, number>, cursor: string): Promise<IngestResult> {
    await this.store.saveOutcome({
      conversationId: ref.conversationId, kind: ref.kind, status: 'dropped', dropReason: reason,
      redactedText: null, contentHash: null, messageCount: 0, redactionCounts: counts, cursorTs: cursor,
    }, { conversationId: ref.conversationId, usable: false, status: 'rejected', reasons: [reason] });
    this.report('slack_transcript_dropped');
    return { conversationId: ref.conversationId, status: 'dropped', verdict: 'rejected' };
  }
}

function ingestEnabled(): boolean {
  return process.env.SLACK_INGEST_ENABLED === 'true';
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emptySummary(skipped: boolean): SyncSummary {
  return { skipped, conversations: 0, stored: 0, dropped: 0, unchanged: 0, failed: 0 };
}

function summarize(results: IngestResult[], skipped: boolean): SyncSummary {
  const count = (status: IngestResult['status']) => results.filter(result => result.status === status).length;
  return {
    skipped, conversations: results.length, stored: count('stored'), dropped: count('dropped'),
    unchanged: count('unchanged'), failed: count('failed'),
  };
}

async function mapPool<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results: Array<R | undefined> = Array.from({ length: items.length }, () => undefined);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results.map(result => {
    if (result === undefined) throw new Error('Ingest result was not recorded');
    return result;
  });
}
