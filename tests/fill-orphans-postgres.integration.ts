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

test('real Postgres: an inline restart fails only orphaned fills, and sign-in gets a fresh case', async t => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required for Postgres integration test');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const connection = url.toString();
  const store = new PostgresScenarioStore(connection);
  t.after(async () => {
    await store.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await migrate(connection);

  const orphan = randomUUID();
  const tracked = randomUUID();
  await store.insertFilling(orphan, blueprintId, defaultScenarioPrompt, null);
  await store.insertFilling(tracked, 'other_blueprint', defaultScenarioPrompt, null);
  await store.setRun(tracked, 'trn-still-running');
  await admin.query(`UPDATE ${schema}.filled_scenarios SET updated_at = now() - interval '1 minute' WHERE id = ANY($1)`, [[orphan, tracked]]);

  const author = new OfflineAuthor();
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), 's'.repeat(32));
  assert.equal(await store.expireOrphans(new Date().toISOString()), 1);
  const failed = await store.scenario(orphan);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.progress.phase, 'failed');
  assert.equal((await store.scenario(tracked))?.status, 'filling');

  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  assert.equal(session.progress.percent, 100);
  const claimed = await admin.query(`SELECT scenario_id FROM ${schema}.player_sessions WHERE id = $1`, [session.game_id]);
  assert.notEqual(claimed.rows[0]?.scenario_id, orphan);
});
