import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OfflineAuthor } from '../src/adapters/offline-author.js';
import { InlineFillRunner } from '../src/adapters/inline-fill-runner.js';
import { ScenarioService } from '../src/application/scenario-service.js';
import { blueprintId } from '../src/scenario/blueprint.js';
import { defaultScenarioPrompt } from '../src/scenario/default-prompt.js';
import { MemoryScenarioStore, MemoryStoreAllowingRepeats, numberedPrompts } from './scenario-memory.js';

const secret = 's'.repeat(32);
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

async function leftover(store: MemoryScenarioStore, runId: string | null) {
  const id = randomUUID();
  await store.insertFilling(id, blueprintId, defaultScenarioPrompt, null);
  if (runId) await store.setRun(id, runId);
  store.scenarios.get(id)!.updatedAt = new Date(Date.now() - 60_000).toISOString();
  return id;
}

test('an inline restart fails fills the previous process left behind', async () => {
  const store = new MemoryScenarioStore();
  const orphan = await leftover(store, null);
  const author = new OfflineAuthor();
  new ScenarioService(store, author, new InlineFillRunner(store, author), secret).warm();
  await settle();
  const row = await store.scenario(orphan);
  assert.equal(row?.status, 'failed');
  assert.equal(row?.progress.phase, 'failed');
  assert.match(row?.error ?? '', /restarted/);
});

test('a player who signs in after an inline restart gets a fresh fill, not a dead one', async () => {
  const store = new MemoryScenarioStore();
  const orphan = await leftover(store, null);
  const author = new OfflineAuthor();
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  service.warm();
  await settle();
  const session = await service.signIn();
  const sessionId = [...store.sessions.keys()][0]!;
  assert.notEqual(store.sessions.get(sessionId)!.scenarioId, orphan);
  assert.equal(session.status, 'ready');
});

test('a background runner keeps fills that belong to a Render task run', async () => {
  const store = new MemoryScenarioStore();
  const running = await leftover(store, 'trn-still-running');
  const runner = { background: true, async start() { return { runId: randomUUID() }; } };
  new ScenarioService(store, new OfflineAuthor(), runner, secret, null, { background: true, async schedule() {} }).warm();
  await settle();
  assert.equal((await store.scenario(running))?.status, 'filling');
});

test('inline replenish starts every reserved fill at once, so no claimed fill waits in line', async () => {
  const previous = { target: process.env.SCENARIO_POOL_TARGET, concurrency: process.env.SCENARIO_FILL_CONCURRENCY };
  process.env.SCENARIO_POOL_TARGET = '3';
  process.env.SCENARIO_FILL_CONCURRENCY = '3';
  try {
    const store = new MemoryStoreAllowingRepeats();
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    const offline = new OfflineAuthor();
    const author = { async fill(prompt: string, seed: string) { started += 1; await gate; return offline.fill(prompt, seed); } };
    const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret, numberedPrompts());
    const done = service.replenish();
    await settle();
    assert.equal(started, 3);
    const rows = [...store.scenarios.values()];
    assert.ok(rows.every(row => row.progress.phase === 'running'));
    release();
    assert.equal(await done, 3);
    assert.ok([...store.scenarios.values()].every(row => row.status === 'ready'));
  } finally {
    for (const [key, value] of [['SCENARIO_POOL_TARGET', previous.target], ['SCENARIO_FILL_CONCURRENCY', previous.concurrency]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('orphan expiry spares fills with a run and fills touched since startup', async () => {
  const store = new MemoryScenarioStore();
  const tracked = await leftover(store, 'trn-1');
  const fresh = randomUUID();
  await store.insertFilling(fresh, blueprintId, defaultScenarioPrompt, null);
  const cutoff = new Date(Date.now() - 1000).toISOString();
  assert.equal(await store.expireOrphans(cutoff), 0);
  assert.equal((await store.scenario(tracked))?.status, 'filling');
  assert.equal((await store.scenario(fresh))?.status, 'filling');
});
