import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GameService, type CreatedGame } from '../src/application/game-service.js';
import { OfflineAI } from '../src/adapters/offline-ai.js';
import { buildApp } from '../src/api/app.js';
import { MemoryRepository } from './helpers.js';

const prompt = 'A Render teammate investigates a failed deploy and should inspect the available evidence before responding.';

test('HTTP contract: create, solve, resume, and reject terminal turns', async t => {
  const repo = new MemoryRepository();
  const app = buildApp(new GameService(repo, new OfflineAI(), 's'.repeat(32)), repo);
  t.after(() => app.close());
  assert.deepEqual((await app.inject({ url: '/health' })).json(), {
    status: 'ok', ai: { mode: 'offline', natural_language: false, generation: true, narration: false },
  });
  const key = randomUUID();
  const create = () => app.inject({ method: 'POST', url: '/games', headers: { 'idempotency-key': key }, payload: { prompt } });
  const first = await create();
  assert.equal(first.statusCode, 201, first.body);
  assert.deepEqual((await create()).json(), first.json());
  const { session_token: token } = first.json();
  let game = first.json().game;
  assert.match(game.transcript[0].text, /failed deploy/);
  assert.ok(game.title);
  assert.ok(game.available_actions.length > 0);
  assert.equal(game.stats.energy, 72);
  assert.equal(game.turn, 0);
  assert.deepEqual(game.choice_tally, { careful: 0, team: 0, bold: 0, reckless: 0 });
  assert.equal(game.available_actions[0].command.split(' ')[0].length > 0, true);
  assert.equal((await app.inject({ url: `/games/${game.id}` })).statusCode, 401);
  assert.ok(!JSON.stringify(game).includes('requires'));
  const turn = async (text: string) => {
    const response = await app.inject({ method: 'POST', url: `/games/${game.id}/turns`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
      payload: { text, expected_version: game.version } });
    assert.equal(response.statusCode, 200, response.body);
    game = response.json();
  };
  await turn('read case brief');
  assert.equal(game.stat_changes.focus, 5);
  assert.equal(game.stat_changes.energy, -3);
  assert.equal(game.turn, 1);
  assert.equal(game.choice_tally.careful, 1);
  await turn('go dashboard');
  await turn('investigate service console');
  await turn('resolve service console');
  assert.equal(game.status, 'completed');
  assert.equal(game.ending.result, 'success');
  const resumed = await app.inject({ url: `/games/${game.id}`, headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual(resumed.json(), game);
  const finished = await app.inject({ method: 'POST', url: `/games/${game.id}/turns`,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
    payload: { text: 'look', expected_version: game.version } });
  assert.equal(finished.statusCode, 409);
});

test('request schema rejects malformed, blank, and oversized inputs', async t => {
  const repo = new MemoryRepository();
  const service = new GameService(repo, new OfflineAI(), 's'.repeat(32));
  const app = buildApp(service, repo);
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/games', payload: { prompt } })).statusCode, 422);
  assert.equal((await app.inject({ method: 'POST', url: '/games', headers: { 'idempotency-key': randomUUID() }, payload: { prompt: 'short' } })).statusCode, 422);
  const { game, session_token } = published(await service.create(randomUUID(), prompt));
  for (const payload of [{ text: 'look', expected_version: 0, status: 'completed' }, { text: ' ', expected_version: 0 }, { text: 'x'.repeat(2001), expected_version: 0 }, { text: 'look', expected_version: '0' }]) {
    const response = await app.inject({ method: 'POST', url: `/games/${game.id}/turns`,
      headers: { authorization: `Bearer ${session_token}`, 'idempotency-key': randomUUID() }, payload });
    assert.equal(response.statusCode, 422, response.body);
  }
});

test('duplicate and conflicting concurrent turns never advance twice', async () => {
  const repo = new MemoryRepository();
  const service = new GameService(repo, new OfflineAI(), 's'.repeat(32));
  const { game, session_token } = published(await service.create(randomUUID(), prompt));
  const key = randomUUID();
  const responses = await Promise.all([0, 1].map(() => service.submit(game.id, session_token, key, 'look', 0)));
  assert.deepEqual(responses[0], responses[1]);
  assert.equal((await service.get(game.id, session_token)).version, 1);
  await assert.rejects(service.submit(game.id, session_token, key, 'inventory', 0), { code: 'idempotency_conflict' });
});

test('interpretation and narration outages degrade without corrupting state', async () => {
  class FailingAI extends OfflineAI {
    override readonly capabilities = { mode: 'offline', natural_language: true, generation: true, narration: true } as const;
    override async interpret(): Promise<never> { throw new Error('provider unavailable'); }
    override async narrate(): Promise<never> { throw new Error('provider unavailable'); }
  }
  const repo = new MemoryRepository();
  const service = new GameService(repo, new FailingAI(), 's'.repeat(32));
  const { game, session_token } = published(await service.create(randomUUID(), prompt));
  const unclear = await service.submit(game.id, session_token, randomUUID(), 'Please help me explore', 0);
  assert.equal(unclear.transcript.at(-1)!.outcome, 'clarification');
  const applied = await service.submit(game.id, session_token, randomUUID(), 'read case brief', unclear.version);
  assert.match(applied.transcript.at(-1)!.text, /brief confirms/i);
});

function published(result: CreatedGame | { status: 'running'; run_id: string }): CreatedGame {
  if (!('game' in result)) throw new Error('expected a published game');
  return result;
}

test('background generation returns one run and replay does not start twice', async t => {
  const repo = new MemoryRepository();
  let starts = 0;
  const runner = { background: true, async start(input: { runId: string }) { starts += 1; return { runId: `run-${input.runId}` }; } };
  const service = new GameService(repo, new OfflineAI(), 's'.repeat(32), () => {}, runner);
  const app = buildApp(service, repo);
  t.after(() => app.close());
  const key = randomUUID();
  const create = () => app.inject({ method: 'POST', url: '/games', headers: { 'idempotency-key': key }, payload: { prompt } });
  const first = await create();
  assert.equal(first.statusCode, 202, first.body);
  assert.deepEqual((await create()).json(), first.json());
  assert.equal(starts, 1);
  assert.equal(repo.creations.size, 0);
  const status = await app.inject({ url: `/games/generations/${first.json().run_id}` });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().status, 'running');
});

test('a failed generation does not persist a game', async () => {
  const repo = new MemoryRepository();
  const runner = { background: false, async start() { throw new Error('provider down'); } };
  const service = new GameService(repo, new OfflineAI(), 's'.repeat(32), () => {}, runner);
  await assert.rejects(service.create(randomUUID(), prompt), { code: 'dependency_unavailable' });
  assert.equal(repo.creations.size, 0);
  assert.equal([...repo.jobs.values()][0]?.status, 'failed');
});
