import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { defaultScenarioPrompt } from '../src/scenario/default-prompt.js';

const base = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const offline = process.env.SMOKE_OFFLINE === '1';
const prompt = process.env.SCENARIO_PROMPT ?? defaultScenarioPrompt;
let token = '';
async function call(path: string, body?: unknown, key?: string): Promise<any> {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(150000) });
  const data = await response.json();
  assert.ok(response.ok, `HTTP ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
async function waitForGeneration(runId: string): Promise<any> {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const generation = await call(`/games/generations/${runId}`);
    if (generation.game) return generation;
    if (generation.status === 'failed') throw new Error(generation.message);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('The adventure is still being generated.');
}
await call('/health');
const creationKey = randomUUID();
let created = await call('/games', { prompt }, creationKey);
if (created.status === 'running') created = await waitForGeneration(created.run_id);
const opening = { game: created.game, session_token: created.session_token };
assert.deepEqual(await call('/games', { prompt }, creationKey), opening);
token = created.session_token;
let game = created.game;
const turn = async (text: string) => {
  const key = randomUUID();
  const body = { text, expected_version: game.version };
  const next = await call(`/games/${game.id}/turns`, body, key);
  assert.deepEqual(await call(`/games/${game.id}/turns`, body, key), next);
  game = next;
};
assert.match(game.transcript[0].text, /Objective:/);
if (offline) {
  await turn('read case brief');
  await turn('go dashboard');
  await turn('investigate service console');
  await turn('resolve service console');
  assert.equal(game.status, 'completed');
  assert.equal(game.ending.result, 'success');
} else {
  await turn('Please look around and describe what I can investigate.');
  assert.ok(game.version > 0, 'Natural-language interpretation must return a saved turn');
}
assert.deepEqual(await call(`/games/${game.id}`), game);
console.log(JSON.stringify({ result: 'passed', mode: offline ? 'offline' : 'live-anthropic', turns: game.version,
  checks: ['HTTP start', 'creation replay', 'turn replay', 'resume', ...(offline ? ['validated completion'] : ['natural-language interpretation'])] }));
