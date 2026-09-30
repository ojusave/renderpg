import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresRepository } from '../src/adapters/postgres.js';
import { OfflineAI } from '../src/adapters/offline-ai.js';
import { GameService } from '../src/application/game-service.js';
import { migrate } from '../scripts/migrate.js';
import { visibleGame } from '../src/game/visibility.js';

const prompt = 'A Render teammate investigates a failed deploy and should inspect the available evidence before responding.';

test('real Postgres: migrations, duplicate/concurrent writes, rollback, and reconnect', async t => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required for Postgres integration test');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const connection = url.toString();
  const repos: PostgresRepository[] = [];
  t.after(async () => {
    await Promise.all(repos.map(r => r.close()));
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await migrate(connection);
  await migrate(connection);
  const repo = new PostgresRepository(connection);
  const repo2 = new PostgresRepository(connection);
  repos.push(repo, repo2);
  const service = new GameService(repo, new OfflineAI(), 's'.repeat(32));
  const service2 = new GameService(repo2, new OfflineAI(), 's'.repeat(32));
  const key = randomUUID();
  const created = await Promise.all([service.create(key, prompt), service2.create(key, prompt)]);
  assert.deepEqual(created[0], created[1]);
  if (!created[0] || !('game' in created[0])) throw new Error('expected a published game');
  const { game, session_token } = created[0];
  const turnKey = randomUUID();
  const duplicates = await Promise.all([service.submit(game.id, session_token, turnKey, 'look', 0), service2.submit(game.id, session_token, turnKey, 'look', 0)]);
  assert.deepEqual(duplicates[0], duplicates[1]);
  assert.equal((await service.get(game.id, session_token)).version, 1);
  const races = await Promise.allSettled([service.submit(game.id, session_token, randomUUID(), 'look', 1), service2.submit(game.id, session_token, randomUUID(), 'inventory', 1)]);
  assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
  const before = (await repo.get(game.id))!;
  await migrate(connection);
  assert.deepEqual(await repo.get(game.id), before, 're-running migrations must not rewrite saved game state');
  await repo.pool.query("ALTER TABLE turn_requests ADD CONSTRAINT test_failure CHECK (request_hash <> 'reject')");
  const next = { ...before, version: before.version + 1 };
  await assert.rejects(repo.commit(game.id, before.version, randomUUID(), 'reject', next, visibleGame(next)));
  assert.deepEqual(await repo.get(game.id), before, 'failed turn insert rolls back game update');
  // A newly constructed service and connection pool restores identical state.
  const fresh = new PostgresRepository(connection);
  repos.push(fresh);
  assert.deepEqual(await new GameService(fresh, new OfflineAI(), 's'.repeat(32)).get(game.id, session_token), visibleGame(before));
  const question = await service.submit(game.id, session_token, randomUUID(), 'go', before.version);
  assert.equal((await fresh.get(game.id))!.state.pendingVerb, 'go');
  const answered = await new GameService(fresh, new OfflineAI(), 's'.repeat(32))
    .submit(game.id, session_token, randomUUID(), 'dashboard', question.version);
  assert.equal(answered.location.id, 'dashboard');
  assert.equal((await fresh.get(game.id))!.state.pendingVerb, undefined);
  const counts = await repo.pool.query('SELECT count(*) FROM games');
  assert.equal(counts.rows[0].count, '1');
  assert.equal((await repo.pool.query('SELECT count(*) FROM adventures')).rows[0].count, '1');
  assert.equal((await repo.pool.query('SELECT count(*) FROM scenario_prompts')).rows[0].count, '1');
});
