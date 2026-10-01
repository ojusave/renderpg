import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { OfflineAuthor } from '../src/adapters/offline-author.js';
import { InlineFillRunner } from '../src/adapters/inline-fill-runner.js';
import { ScenarioService } from '../src/application/scenario-service.js';
import { defaultScenarioPrompt } from '../src/scenario/default-prompt.js';
import { applyChoice, openPlay } from '../src/scenario/engine.js';
import { validateFill } from '../src/scenario/fill.js';
import { offlineFill } from '../src/scenario/offline-fill.js';
import { MemoryScenarioStore } from './scenario-memory.js';
import { reservePoolFills } from '../src/application/reserve-pool.js';
import { blueprintId, poolTarget } from '../src/scenario/blueprint.js';
import { publishFill } from '../src/application/publish-fill.js';

const secret = 's'.repeat(32);

test('fill validation rejects travel and invented excerpts', () => {
  const fill = offlineFill();
  assert.deepEqual(validateFill(fill, defaultScenarioPrompt), []);
  fill.choices.transfer_account.label = 'Travel to the owner office';
  assert.ok(validateFill(fill, defaultScenarioPrompt).some(error => error.includes('unrealistic')));
  fill.choices.transfer_account.label = 'Transfer the account';
  fill.evidence.account_record.sourceExcerpt = 'A fact that was never in the source.';
  assert.ok(validateFill(fill, defaultScenarioPrompt).some(error => error.includes('excerpt')));
});

test('transfer succeeds only after authority is verified', () => {
  const fill = offlineFill();
  const state = applyChoice(openPlay(fill), fill, 'review_account_record');
  const unverified = applyChoice(state, fill, 'request_more_evidence');
  const early = applyChoice(unverified, fill, 'transfer_account');
  assert.equal(early.endingId, 'incorrect_transfer');
  const checked = applyChoice(state, fill, 'verify_requester_authority');
  const verified = applyChoice(checked, fill, 'transfer_account');
  assert.equal(verified.endingId, 'success');
  assert.equal(verified.status, 'completed');
});

test('game master text is at most two sentences', () => {
  const fill = offlineFill();
  fill.choices.review_account_record.consequence = 'One. Two. Three.';
  const state = applyChoice(openPlay(fill), fill, 'review_account_record');
  const text = state.transcript.at(-1)!.text;
  assert.ok((text.match(/[.!?](\s|$)/g) ?? []).length <= 2, text);
});

test('sign-in claims a ready scenario and begin does not fill another', async () => {
  const store = new MemoryScenarioStore();
  let fills = 0;
  const author = { async fill(prompt: string) { fills += 1; return new OfflineAuthor().fill(prompt); } };
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  const seeded = randomUUID();
  await store.insertFilling(seeded, 'account_ownership_v1', defaultScenarioPrompt, null);
  await store.markReady(seeded, offlineFill());
  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  await new Promise(resolve => setTimeout(resolve, 30));
  const fillsAfterClaim = fills;
  const game = await service.begin(session.session_token);
  assert.equal(game.location.id, 'review');
  assert.equal(game.available_actions.length, 3);
  const verified = await service.choose(session.session_token, randomUUID(), 'review_account_record', game.version);
  const decided = await service.choose(session.session_token, randomUUID(), 'verify_requester_authority', verified.version);
  const ended = await service.choose(session.session_token, randomUUID(), 'transfer_account', decided.version);
  assert.equal(ended.status, 'completed');
  assert.equal(ended.ending?.id, 'success');
  assert.equal(fills, fillsAfterClaim);
});

test('sign-in gives the agent a redacted slack story when one is pending', async () => {
  const store = new MemoryScenarioStore();
  const seen: string[] = [];
  const author = { async fill(prompt: string) { seen.push(prompt); return new OfflineAuthor().fill(prompt); } };
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret, {
    async nextPrompt() { return 'A customer asked Security to transfer the account after the employee who owned it left. Speaker A and Speaker B reviewed access, billing, and the workspace owner before the transfer.'; },
  });
  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  assert.match(seen[0] ?? '', /Speaker A/);
  assert.equal((seen[0] ?? '').includes('@'), false);
});

test('sign-in schedules pool replenishment instead of filling it inline', async () => {
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  let scheduled = 0;
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret, null, {
    background: true,
    async schedule() { scheduled += 1; },
  });
  const seeded = randomUUID();
  await store.insertFilling(seeded, 'account_ownership_v1', defaultScenarioPrompt, null);
  await store.markReady(seeded, offlineFill());
  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  assert.equal(scheduled, 1);
  assert.equal(await store.poolDepth('account_ownership_v1'), 0);
});

test('an empty pool starts the player fill and then the pool parent', async () => {
  const store = new MemoryScenarioStore();
  let started = 0;
  let scheduled = 0;
  const runner = { background: true, async start() { started += 1; return { runId: randomUUID() }; } };
  const service = new ScenarioService(store, new OfflineAuthor(), runner, secret, null, {
    background: true,
    async schedule() { scheduled += 1; },
  });
  const session = await service.signIn();
  assert.equal(session.status, 'preparing');
  assert.equal(started, 1);
  assert.equal(scheduled, 1);
});

test('pool reservation stops at the target', async () => {
  const store = new MemoryScenarioStore();
  const first = await reservePoolFills(store, async () => defaultScenarioPrompt);
  const second = await reservePoolFills(store, async () => defaultScenarioPrompt);
  assert.equal(first.length, poolTarget);
  assert.equal(second.length, 0);
  assert.equal(await store.poolDepth('account_ownership_v1'), poolTarget);
});

test('the game workflow replenishes by chaining fillScenario', async () => {
  const source = await readFile(new URL('../workflows/main.ts', import.meta.url), 'utf8');
  assert.match(source, /name: 'replenishScenarioPool'/);
  assert.match(source, /ctx\.run\(fillScenario/);
  assert.equal(source.toLowerCase().includes('slack'), false);
});

test('an empty pool fills one scenario during sign-in', async () => {
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  const game = await service.begin(session.session_token);
  assert.match(game.transcript[0]!.text, /rightful new owner/i);
});

test('the same prompt can produce more than one telling', () => {
  const seeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
  const briefings = new Set(seeds.map(seed => offlineFill(defaultScenarioPrompt, seed).briefing));
  assert.ok(briefings.size > 1);
  for (const seed of seeds) assert.deepEqual(validateFill(offlineFill(defaultScenarioPrompt, seed), defaultScenarioPrompt), []);
});

test('a fill stores the scenario id as its variation seed', async () => {
  const store = new MemoryScenarioStore();
  const scenarioId = randomUUID();
  let seen = '';
  await store.insertFilling(scenarioId, blueprintId, defaultScenarioPrompt, null);
  await publishFill(store, { async fill(_prompt: string, variationSeed: string) { seen = variationSeed; return offlineFill(); } }, scenarioId, defaultScenarioPrompt);
  assert.equal(seen, scenarioId);
  assert.equal((await store.scenario(scenarioId))?.status, 'ready');
});

test('sign-in claims an in-flight pool fill instead of starting another', async () => {
  const store = new MemoryScenarioStore();
  let fills = 0;
  const author = { async fill() { fills += 1; return offlineFill(); } };
  const runner = { background: true, async start() { fills += 1; return { runId: randomUUID() }; } };
  const service = new ScenarioService(store, author, runner, secret, null, { background: true, async schedule() {} });
  const scenarioId = randomUUID();
  await store.insertFilling(scenarioId, blueprintId, defaultScenarioPrompt, null);
  setTimeout(() => { void store.markReady(scenarioId, offlineFill()); }, 40);
  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  assert.equal(fills, 0);
  assert.equal((await store.scenario(scenarioId))?.status, 'claimed');
});
