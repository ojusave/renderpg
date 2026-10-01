import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { PostgresTranscriptStore } from '../src/adapters/slack-postgres.js';
import { migrate } from '../scripts/migrate.js';
import { SlackIngestService } from '../src/slack/ingest.js';
import type { SlackHistory, SlackMessage } from '../src/slack/port.js';

const story: SlackMessage[] = [
  { ts: '1.0', userId: 'U001', text: 'Alex Curtiss (alex.curtiss@example.com) said a customer contacted Security after the employee who owned their account left the company.' },
  { ts: '2.0', userId: 'U002', text: 'The account was tied to that person, so access left with them. Check the billing owner before a transfer.' },
  { ts: '3.0', userId: 'U001', text: 'Please review the permission history and the workspace invoice before anyone approves a transfer.' },
  { ts: '4.0', userId: 'U002', text: 'I will verify the requester and only then transfer the workspace account to the new owner.' },
];

test('slack transcripts persist redacted text and pending verdicts', async t => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required for Postgres integration test');
  const previous = process.env.SLACK_INGEST_ENABLED;
  process.env.SLACK_INGEST_ENABLED = 'true';
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const store = new PostgresTranscriptStore(url.toString());
  t.after(async () => {
    if (previous === undefined) delete process.env.SLACK_INGEST_ENABLED;
    else process.env.SLACK_INGEST_ENABLED = previous;
    await store.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await migrate(url.toString());
  const history: SlackHistory = {
    async listConversations() {
      return [{ conversationId: 'C100', kind: 'channel' }, { conversationId: 'C200', kind: 'channel' }];
    },
    async latestTimestamp(conversationId) {
      return conversationId === 'C100' ? '4.0' : '1.0';
    },
    async load(conversationId) {
      const messages = conversationId === 'C100'
        ? story
        : [{ ts: '1.0', userId: 'U001', text: 'token is xoxb-1234567890-abcdefghij' }];
      return { messages, aliases: [{ userId: 'U001', names: ['Alex Curtiss'] }] };
    },
  };
  const service = new SlackIngestService(history, store, () => undefined);
  const summary = await service.ingestAll(ref => service.ingest(ref));
  assert.equal(summary.stored, 1);
  assert.equal(summary.dropped, 1);
  const leaked = await store.pool.query(`SELECT count(*)::int AS hits FROM slack_conversations
    WHERE redacted_text ILIKE '%example.com%' OR redacted_text ILIKE '%xoxb-%' OR redacted_text ILIKE '%Alex Curtiss%'`);
  assert.equal(leaked.rows[0].hits, 0);
  const pending = await store.verdict('C100');
  assert.equal(pending?.status, 'pending');
  assert.equal(pending?.usable, true);
  await store.saveOutcome({
    conversationId: 'C300', kind: 'channel', status: 'stored', dropReason: null,
    redactedText: 'Speaker A asked Security to approve a rollback before the deploy window closed.',
    contentHash: 'c300', messageCount: 4, redactionCounts: {}, cursorTs: '9.0',
  }, { conversationId: 'C300', usable: true, status: 'pending', reasons: [] });
  const claimed = [await store.nextPrompt(), await store.nextPrompt()];
  assert.deepEqual(claimed, [
    (await store.get('C100'))?.redactedText,
    'Speaker A asked Security to approve a rollback before the deploy window closed.',
  ]);
  assert.equal((await store.verdict('C100'))?.status, 'used');
  assert.equal((await store.verdict('C300'))?.status, 'used');
  assert.equal(await store.nextPrompt(), null);
  assert.equal((await store.get('C200'))?.redactedText, null);
  await assert.rejects(store.pool.query(`INSERT INTO slack_conversations(
      conversation_id, kind, status, drop_reason, redacted_text, content_hash, message_count, redaction_counts, cursor_ts)
    VALUES ('Cbad','channel','dropped','sensitive_content','should-not-store','abc',0,'{}','1')`));
  await assert.rejects(store.pool.query(`UPDATE slack_verdicts SET usable=true, status='rejected', reasons='["nope"]'::jsonb
    WHERE conversation_id='C100'`));
});
