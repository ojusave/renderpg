import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Black-box HTTP test of fork previews against a running server. Set API_URL, and EXPECT_SANDBOXES=true to require real sandbox ids.
const api = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const expectSandboxes = process.env.EXPECT_SANDBOXES === 'true';
const employee = process.env.RENDER_ACCESS_TOKEN?.trim();

async function call(path: string, init: { method?: string; token?: string; body?: unknown; key?: string } = {}) {
  const response = await fetch(`${api}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.key ? { 'idempotency-key': init.key } : {}),
      ...(employee ? { 'x-forwarded-access-token': employee } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(180_000),
  });
  return { status: response.status, body: await response.json() as any };
}

const started = Date.now();
const health = await call('/health');
assert.equal(health.status, 200, JSON.stringify(health.body));
const signIn = await call('/sessions', { method: 'POST' });
assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
const { session_token: token, game_url: game } = signIn.body;
for (let i = 0; i < 120 && (await call(game, { token })).body.status === 'preparing'; i += 1) await new Promise(resolve => setTimeout(resolve, 1000));

const early = await call(`${game}/forks`, { token, body: { version: 'server' } });
assert.equal(early.status, 409, 'forks require an opened case');
const begun = await call(`${game}/begin`, { method: 'POST', token });
assert.equal(begun.status, 200, JSON.stringify(begun.body));

const listed = await call(`${game}/sandboxes`, { token });
assert.equal(listed.status, 200, JSON.stringify(listed.body));
assert.ok(listed.body.versions.some((item: { id: string }) => item.id === 'server'));
assert.equal((await call(`${game}/sandboxes`, { token: 'x'.repeat(43) })).status, 401, 'versions require the session token');
assert.equal((await call(`${game}/forks`, { token: 'x'.repeat(43), body: { version: 'server' } })).status, 401, 'forks require the session token');

async function preview(sourceVersion: number) {
  const result = await call(`${game}/forks`, { token, body: { version: 'server' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.source_version, sourceVersion);
  assert.ok(result.body.forks.length > 0);
  for (const fork of result.body.forks) {
    assert.equal(fork.status, 'ready', `${fork.action_id}: ${fork.message}`);
    assert.equal(fork.game.version, sourceVersion + 1);
    if (expectSandboxes) assert.match(fork.sandbox_id, /^sbx-/);
    else assert.equal(fork.sandbox_id, null);
  }
  const saved = await call(game, { token });
  assert.equal(saved.body.game.version, sourceVersion, 'a preview must not change the saved case');
  return result.body.forks as { action_id: string; sandbox_id: string | null; game: { ending: { id: string } | null } }[];
}

const opening = await preview(0);
assert.deepEqual(opening.map(fork => fork.action_id), begun.body.available_actions.map((action: { id: string }) => action.id));
const unknown = await call(`${game}/forks`, { token, body: { version: 'no-such-snapshot' } });
assert.equal(unknown.status, 409);
assert.equal(unknown.body.code, 'unknown_sandbox');

let version = 0;
for (const action of ['look_first', 'verify']) {
  const chosen = await call(`${game}/choices`, { token, key: randomUUID(), body: { action_id: action, expected_version: version } });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
  version = chosen.body.version;
}
const deciding = await preview(version);
assert.deepEqual(deciding.map(fork => [fork.action_id, fork.game.ending?.id]), [
  ['go_ahead', 'success'], ['hold_off', 'held_after_check'], ['hand_off', 'handed_off_after_check'],
]);
const finished = await call(`${game}/choices`, { token, key: randomUUID(), body: { action_id: 'hold_off', expected_version: version } });
assert.equal(finished.body.ending.id, 'held_after_check', 'the real choice is independent of the previewed forks');
assert.equal((await call(game, { method: 'DELETE', token })).status, 200);
const sandboxes = [...opening, ...deciding].map(fork => fork.sandbox_id).filter(Boolean);
console.log(JSON.stringify({ event: 'fork_system_passed', api, sandboxes, seconds: Math.round((Date.now() - started) / 1000) }));
