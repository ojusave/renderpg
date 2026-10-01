import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { OfflineAuthor } from '../src/adapters/offline-author.js';
import { InlineFillRunner } from '../src/adapters/inline-fill-runner.js';
import { PostgresScenarioStore } from '../src/adapters/scenario-postgres.js';
import { ScenarioService } from '../src/application/scenario-service.js';
import { migrate } from '../scripts/migrate.js';
import { blueprintId } from '../src/scenario/blueprint.js';
import { defaultScenarioPrompt } from '../src/scenario/default-prompt.js';
import { offlineFill } from '../src/scenario/offline-fill.js';

const secret = 's'.repeat(32);

test('real Postgres: scenario choices commit once and an expired fill stays failed', async t => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required for Postgres integration test');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const connection = url.toString();
  const stores: PostgresScenarioStore[] = [];
  t.after(async () => {
    await Promise.all(stores.map(store => store.close()));
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await migrate(connection);
  const firstStore = new PostgresScenarioStore(connection);
  const secondStore = new PostgresScenarioStore(connection);
  stores.push(firstStore, secondStore);
  const author = new OfflineAuthor();
  const first = new ScenarioService(firstStore, author, new InlineFillRunner(firstStore, author), secret);
  const second = new ScenarioService(secondStore, author, new InlineFillRunner(secondStore, author), secret);
  const session = await first.signIn();
  const game = await first.begin(session.session_token);
  const key = randomUUID();
  const duplicates = await Promise.all([
    first.choose(session.session_token, key, 'look_first', game.version),
    second.choose(session.session_token, key, 'look_first', game.version),
  ]);
  assert.deepEqual(duplicates[0], duplicates[1]);
  assert.equal(duplicates[0]!.version, 1);
  const races = await Promise.allSettled([
    first.choose(session.session_token, randomUUID(), 'verify', 1),
    second.choose(session.session_token, randomUUID(), 'take_word', 1),
  ]);
  assert.equal(races.filter(race => race.status === 'fulfilled').length, 1);
  const current = await second.current(session.session_token);
  assert.equal(current.game?.version, 2);
  await assert.rejects(first.choose(session.session_token, randomUUID(), 'not_legal', current.game!.version), { code: 'invalid_request' });
  assert.equal((await first.current(session.session_token)).game?.version, 2);
  const scenarioId = randomUUID();
  await firstStore.insertFilling(scenarioId, blueprintId, defaultScenarioPrompt, null);
  await firstStore.pool.query('UPDATE filled_scenarios SET updated_at = now() - interval \'1 hour\' WHERE id=$1', [scenarioId]);
  assert.equal(await firstStore.expireStale(new Date(Date.now() - 60_000).toISOString()), 1);
  assert.equal(await secondStore.markReady(scenarioId, offlineFill()), false);
  assert.equal((await firstStore.scenario(scenarioId))?.status, 'failed');
  await first.end(session.session_token);
  await assert.rejects(second.current(session.session_token), { code: 'unauthorized' });
});
