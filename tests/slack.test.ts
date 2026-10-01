import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { describe } from 'node:test';
import { SlackIngestService } from '../src/slack/ingest.js';
import { SlackRequestError, type ConversationRef, type NameAlias, type SlackHistory, type SlackMessage } from '../src/slack/port.js';
import { redactConversation } from '../src/slack/redact.js';
import { MemoryTranscriptStore } from './slack-memory.js';

const aliases: NameAlias[] = [
  { userId: 'U001', names: ['Alex Curtiss', 'alex'] },
  { userId: 'U002', names: ['Jordan Lee'] },
];

const story: SlackMessage[] = [
  { ts: '1.0', userId: 'U001', text: 'Alex Curtiss (alex.curtiss@example.com) said a customer contacted Security after the employee who owned their account left the company.' },
  { ts: '2.0', userId: 'U002', text: 'Jordan Lee noted the account was tied to that person, so access left with them. Check the billing owner before a transfer.' },
  { ts: '3.0', userId: 'U001', text: 'Please review the permission history and the workspace invoice before anyone approves a transfer.' },
  { ts: '4.0', userId: 'U002', text: 'I will verify the requester and only then transfer the workspace account to the new owner. Call 415-555-0134 or see https://example.com/ticket?token=abc.' },
];

function assertClean(value: string | null) {
  assert.ok(value);
  for (const secret of ['alex.curtiss@example.com', 'Alex Curtiss', 'Jordan Lee', '415-555-0134', 'example.com', 'token=abc']) {
    assert.equal(value.includes(secret), false, secret);
  }
}

test('redaction masks ordinary identifiers and drops secrets', () => {
  const redacted = redactConversation(story, aliases);
  assert.equal(redacted.dropped, false);
  assertClean(redacted.text);
  assert.match(redacted.text ?? '', /Speaker A:/);
  assert.match(redacted.text ?? '', /\[email\]/);
  assert.match(redacted.text ?? '', /\[phone\]/);
  assert.match(redacted.text ?? '', /\[link\]/);
  const awkward = redactConversation([{ ts: '1', userId: 'U001', text: 'I forgot my password yesterday and it was incorrect.' }], aliases);
  assert.equal(awkward.dropped, false);
  assert.match(awkward.text ?? '', /password/);
  const secret = redactConversation([{ ts: '1', userId: 'U001', text: 'token is xoxb-1234567890-abcdefghij' }], aliases);
  assert.equal(secret.text, null);
  assert.equal(secret.dropReason, 'sensitive_content');
  const hidden = redactConversation([{ ts: '1', userId: 'U001', text: 'write a\u200Bb@example.com' }], aliases);
  assert.equal(hidden.text?.includes('@'), false);
});

test('game entrypoints do not import the slack workflow', async () => {
  for (const path of ['src/server.ts', 'src/composition/root.ts', 'workflows/main.ts', 'src/api/app.ts']) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.equal(source.toLowerCase().includes('slack'), false, path);
  }
  const scenario = await readFile(new URL('../src/composition/scenario.ts', import.meta.url), 'utf8');
  assert.equal(scenario.includes('slack-web'), false);
  assert.equal(scenario.includes('workflows/slack'), false);
});

class FakeHistory implements SlackHistory {
  listed = 0;
  loads = 0;
  conversations: ConversationRef[] = [];
  latest = new Map<string, string | null>();
  messages = new Map<string, SlackMessage[]>();
  fail = new Set<string>();
  permanent = new Set<string>();
  async listConversations() {
    this.listed += 1;
    return this.conversations;
  }
  async latestTimestamp(conversationId: string) {
    if (this.permanent.has(conversationId)) throw new SlackRequestError('not_in_channel', 'conversations.history');
    return this.latest.get(conversationId) ?? null;
  }
  async load(conversationId: string) {
    this.loads += 1;
    if (this.fail.has(conversationId)) throw new Error('slack down');
    return { messages: this.messages.get(conversationId) ?? [], aliases };
  }
}

describe('slack ingest', { concurrency: 1 }, () => {
  const previous = process.env.SLACK_INGEST_ENABLED;
  test.before(() => { process.env.SLACK_INGEST_ENABLED = 'true'; });
  test.after(() => {
    if (previous === undefined) delete process.env.SLACK_INGEST_ENABLED;
    else process.env.SLACK_INGEST_ENABLED = previous;
  });

  test('stores a redacted pending story and rejects chit-chat and secrets', async () => {
    const history = new FakeHistory();
    history.conversations = [
      { conversationId: 'C1', kind: 'channel' },
      { conversationId: 'D1', kind: 'im' },
      { conversationId: 'C2', kind: 'channel' },
    ];
    history.latest.set('C1', '4.0');
    history.latest.set('D1', '1.0');
    history.latest.set('C2', '2.0');
    history.messages.set('C1', story);
    history.messages.set('D1', [
      { ts: '1', userId: 'U001', text: 'hey' },
      { ts: '2', userId: 'U002', text: 'lunch?' },
      { ts: '3', userId: 'U001', text: 'sure' },
      { ts: '4', userId: 'U002', text: 'cool' },
    ]);
    history.messages.set('C2', [{ ts: '1', userId: 'U001', text: 'password is hunter22' }]);
    const store = new MemoryTranscriptStore();
    const events: string[] = [];
    const service = new SlackIngestService(history, store, event => events.push(event));
    const summary = await service.ingestAll(ref => service.ingest(ref));
    assert.equal(summary.stored, 2);
    assert.equal(summary.dropped, 1);
    assertClean(store.rows.get('C1')?.redactedText ?? null);
    assert.equal(store.verdicts.get('C1')?.status, 'pending');
    assert.equal(store.verdicts.get('C1')?.usable, true);
    assert.equal(store.verdicts.get('D1')?.status, 'rejected');
    assert.equal(store.rows.get('C2')?.redactedText, null);
    assert.deepEqual(store.verdicts.get('C2')?.reasons, ['sensitive_content']);
    assert.equal(events.join(' ').includes('example.com'), false);
    const again = await service.ingest({ conversationId: 'C1', kind: 'channel' });
    assert.equal(again.status, 'unchanged');
    assert.equal(history.loads, 3);
  });

  test('a disabled flag does not list or store', async () => {
    process.env.SLACK_INGEST_ENABLED = 'false';
    const history = new FakeHistory();
    history.conversations = [{ conversationId: 'C1', kind: 'channel' }];
    const store = new MemoryTranscriptStore();
    const service = new SlackIngestService(history, store, () => undefined);
    const summary = await service.ingestAll(ref => service.ingest(ref));
    assert.equal(summary.skipped, true);
    assert.equal(history.listed, 0);
    assert.equal(store.rows.size, 0);
    process.env.SLACK_INGEST_ENABLED = 'true';
  });

  test('one conversation failure does not drop the rest', async () => {
    const history = new FakeHistory();
    history.conversations = [
      { conversationId: 'C1', kind: 'channel' },
      { conversationId: 'C9', kind: 'channel' },
    ];
    history.latest.set('C1', '4.0');
    history.latest.set('C9', '1.0');
    history.messages.set('C1', story);
    history.fail.add('C9');
    const store = new MemoryTranscriptStore();
    const service = new SlackIngestService(history, store, () => undefined);
    const summary = await service.ingestAll(ref => service.ingest(ref));
    assert.equal(summary.stored, 1);
    assert.equal(summary.failed, 1);
    assert.equal(store.verdicts.get('C1')?.status, 'pending');
    history.fail.delete('C9');
    history.permanent.add('C9');
    const unavailable = await service.ingest({ conversationId: 'C9', kind: 'channel' });
    assert.equal(unavailable.status, 'dropped');
    assert.equal(store.rows.get('C9')?.redactedText, null);
  });
});
