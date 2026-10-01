import test from 'node:test';
import assert from 'node:assert/strict';
import { GameService } from '../src/application/game-service.js';
import { finishedWriting, runningProgress, writingProgress } from '../src/application/fill-progress.js';
import { ScenarioService } from '../src/application/scenario-service.js';
import { OfflineAI } from '../src/adapters/offline-ai.js';
import { buildApp } from '../src/api/app.js';
import { offlineFill } from '../src/scenario/offline-fill.js';
import { MemoryRepository } from './helpers.js';
import { MemoryScenarioStore } from './scenario-memory.js';

const secret = 's'.repeat(32);

test('writing progress uses the real token count against the real budget', () => {
  assert.equal(writingProgress({ outputTokens: 0, maxTokens: 2400, characters: 900 }).percent, 20);
  assert.equal(writingProgress({ outputTokens: 1200, maxTokens: 2400, characters: null }).percent, 47);
  assert.equal(writingProgress({ outputTokens: null, maxTokens: 2400, characters: 4800 }).percent, 47);
  assert.equal(writingProgress({ outputTokens: 2400, maxTokens: 2400, characters: 100 }).percent, 75);
  assert.equal(finishedWriting({ outputTokens: 900, maxTokens: 2400, characters: 3000 }).percent, 75);
  assert.equal(runningProgress().percent, 10);
});

test('the progress stream follows task checkpoints through ready', async t => {
  const store = new MemoryScenarioStore();
  const scenarios = new ScenarioService(store, { async fill() { return offlineFill(); } }, {
    background: true,
    async start() { return { runId: 'task-run-1' }; },
  }, secret, null, undefined, {
    async watch(_runId, signal, emit) {
      emit('running');
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  });
  const app = buildApp(new GameService(new MemoryRepository(), new OfflineAI(), secret), new MemoryRepository(), false, scenarios);
  t.after(() => app.close());
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const created = await fetch(`http://127.0.0.1:${port}/sessions`, { method: 'POST' });
  const session = await created.json() as { status: string; session_token: string; progress: { percent: number } };
  assert.equal(created.status, 200);
  assert.equal(session.status, 'preparing');
  assert.equal(session.progress.percent, 0);
  const stream = await fetch(`http://127.0.0.1:${port}/sessions/current/progress`, {
    headers: { authorization: `Bearer ${session.session_token}` },
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: { phase: string; percent: number; output_tokens: number | null; task_status: string | null }[] = [];
  const id = [...store.scenarios.keys()][0]!;
  const read = async () => {
    const chunk = await reader.read();
    if (chunk.done) return;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const data = part.split('\n').find(line => line.startsWith('data: '));
      if (data) events.push(JSON.parse(data.slice(6)));
    }
  };
  await read();
  assert.equal(events[0]?.phase, 'queued');
  assert.equal(events[0]?.task_status, 'running');
  await store.setProgress(id, runningProgress());
  await store.setProgress(id, writingProgress({ outputTokens: 1200, maxTokens: 2400, characters: null }));
  await store.markReady(id, offlineFill());
  const deadline = Date.now() + 2000;
  while (!events.some(event => event.phase === 'ready') && Date.now() < deadline) await read();
  await reader.cancel();
  const percents = events.map(event => event.percent);
  assert.deepEqual(percents, [...percents].sort((left, right) => left - right));
  assert.equal(events.find(event => event.phase === 'generating')?.output_tokens, 1200);
  assert.equal(events.find(event => event.phase === 'generating')?.percent, 47);
  assert.equal(events.at(-1)?.phase, 'ready');
  assert.equal(events.at(-1)?.percent, 100);
});
