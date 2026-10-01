import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { OfflineAuthor } from '../src/adapters/offline-author.js';
import { InlineFillRunner } from '../src/adapters/inline-fill-runner.js';
import { ScenarioService } from '../src/application/scenario-service.js';
import { defaultScenarioPrompt } from '../src/scenario/default-prompt.js';
import { applyChoice, legalActions, openPlay } from '../src/scenario/engine.js';
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

test('transfer succeeds only after the owner is traced', () => {
  const fill = offlineFill();
  const state = applyChoice(openPlay(fill), fill, 'open_record');
  const trusted = applyChoice(applyChoice(state, fill, 'take_word'), fill, 'transfer_account');
  assert.equal(trusted.endingId, 'unverified_transfer');
  const verified = applyChoice(applyChoice(state, fill, 'trace_owner'), fill, 'transfer_account');
  assert.equal(verified.endingId, 'success');
  assert.equal(verified.status, 'completed');
});

const expectedEndings: Record<string, string> = {
  'transfer_now': 'transferred_too_early',
  'turn_away': 'turned_away',
  'open_record>escalate_early': 'escalated_early',
  'open_record>trace_owner>transfer_account': 'success',
  'open_record>trace_owner>decline_transfer': 'declined_verified',
  'open_record>trace_owner>escalate': 'escalated_verified',
  'open_record>take_word>transfer_account': 'unverified_transfer',
  'open_record>take_word>decline_transfer': 'declined_unverified',
  'open_record>take_word>escalate': 'escalated_unverified',
};

test('every path ends in the ending written for that exact situation', () => {
  const fill = offlineFill();
  const reached: Record<string, string> = {};
  const walk = (state: ReturnType<typeof openPlay>, path: string[]) => {
    const actions = legalActions(state);
    if (!actions.length) {
      reached[path.join('>')] = state.endingId!;
      assert.equal(state.transcript.at(-1)!.text, fill.endings[state.endingId!].summary);
      assert.ok(path.length <= 3);
      return;
    }
    for (const action of actions) walk(applyChoice(state, fill, action), [...path, action]);
  };
  walk(openPlay(fill), []);
  assert.deepEqual(reached, expectedEndings);
});

test('investigation turns show what you found and set up the next question', () => {
  const fill = offlineFill();
  const opened = applyChoice(openPlay(fill), fill, 'open_record');
  assert.equal(opened.transcript.at(-1)!.text, `${fill.evidence.account_record.text} ${fill.setups.investigate}`);
  const traced = applyChoice(opened, fill, 'trace_owner');
  assert.equal(traced.transcript.at(-1)!.text, `${fill.evidence.owner_trace.text} ${fill.setups.decide_verified}`);
  assert.deepEqual(traced.revealed, ['account_record', 'owner_trace']);
  const trusted = applyChoice(opened, fill, 'take_word');
  assert.equal(trusted.transcript.at(-1)!.text, `${fill.trust_result} ${fill.setups.decide_unverified}`);
});

test('game master text is at most two sentences', () => {
  const fill = offlineFill();
  fill.evidence.account_record.text = 'One. Two. Three.';
  fill.setups.investigate = 'Four. Five.';
  const state = applyChoice(openPlay(fill), fill, 'open_record');
  const text = state.transcript.at(-1)!.text;
  assert.ok((text.match(/[.!?](\s|$)/g) ?? []).length <= 2, text);
});

test('sign-in claims a ready scenario and begin does not fill another', async () => {
  const store = new MemoryScenarioStore();
  let fills = 0;
  const author = { async fill(prompt: string) { fills += 1; return new OfflineAuthor().fill(prompt); } };
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  const seeded = randomUUID();
  await store.insertFilling(seeded, blueprintId, defaultScenarioPrompt, null);
  await store.markReady(seeded, offlineFill());
  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  await new Promise(resolve => setTimeout(resolve, 30));
  const fillsAfterClaim = fills;
  const game = await service.begin(session.session_token);
  assert.equal(game.location.id, 'intake');
  assert.equal(game.available_actions.length, 3);
  const verified = await service.choose(session.session_token, randomUUID(), 'open_record', game.version);
  const decided = await service.choose(session.session_token, randomUUID(), 'trace_owner', verified.version);
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
  await store.insertFilling(seeded, blueprintId, defaultScenarioPrompt, null);
  await store.markReady(seeded, offlineFill());
  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  assert.equal(scheduled, 1);
  assert.equal(await store.poolDepth(blueprintId), 0);
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
  assert.equal(await store.poolDepth(blueprintId), poolTarget);
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

test('a session holding a case from the old blueprint is told to start over', async () => {
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  const old = randomUUID();
  await store.insertFilling(old, 'account_ownership_v1', defaultScenarioPrompt, null);
  await store.markReady(old, offlineFill());
  const session = await service.signIn();
  const sessionId = [...store.sessions.keys()][0]!;
  await store.setSessionScenario(sessionId, old);
  const current = await service.current(session.session_token);
  assert.equal(current.status, 'failed');
  assert.match(current.message ?? '', /earlier version/);
  await assert.rejects(service.begin(session.session_token), /earlier version/);
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

test('one version accepts one choice, replays its key, and a finished case stays finished', async () => {
  const store = new MemoryScenarioStore();
  const service = new ScenarioService(store, new OfflineAuthor(), new InlineFillRunner(store, new OfflineAuthor()), secret);
  const session = await service.signIn();
  const game = await service.begin(session.session_token);
  const key = randomUUID();
  const duplicates = await Promise.all([
    service.choose(session.session_token, key, 'open_record', game.version),
    service.choose(session.session_token, key, 'open_record', game.version),
  ]);
  assert.deepEqual(duplicates[0], duplicates[1]);
  assert.equal(duplicates[0]!.version, 1);
  await assert.rejects(service.choose(session.session_token, key, 'trace_owner', game.version), { code: 'idempotency_conflict' });
  const races = await Promise.allSettled([
    service.choose(session.session_token, randomUUID(), 'trace_owner', duplicates[0]!.version),
    service.choose(session.session_token, randomUUID(), 'take_word', duplicates[0]!.version),
  ]);
  assert.equal(races.filter(race => race.status === 'fulfilled').length, 1);
  assert.equal(races.filter(race => race.status === 'rejected').length, 1);
  const ended = await service.choose(session.session_token, randomUUID(), 'escalate', (await service.current(session.session_token)).game!.version);
  assert.equal(ended.status, 'completed');
  await assert.rejects(service.choose(session.session_token, randomUUID(), 'escalate', ended.version), { code: 'game_finished' });
  await service.end(session.session_token);
  await assert.rejects(service.current(session.session_token), { code: 'unauthorized' });
});

test('a late fill cannot revive a scenario that already failed', async () => {
  const store = new MemoryScenarioStore();
  const scenarioId = randomUUID();
  await store.insertFilling(scenarioId, blueprintId, defaultScenarioPrompt, null);
  await store.markFailed(scenarioId, 'Fill timed out.');
  await publishFill(store, { async fill() { return offlineFill(); } }, scenarioId, defaultScenarioPrompt);
  assert.equal((await store.scenario(scenarioId))?.status, 'failed');
  assert.equal((await store.scenario(scenarioId))?.error, 'Fill timed out.');
});

test('workflow health fails closed until the Render tasks are configured', async () => {
  const previous = {
    mode: process.env.WORKFLOW_MODE,
    key: process.env.RENDER_API_KEY,
    scenario: process.env.SCENARIO_TASK,
    replenish: process.env.REPLENISH_TASK,
  };
  process.env.WORKFLOW_MODE = 'render';
  delete process.env.RENDER_API_KEY;
  delete process.env.SCENARIO_TASK;
  delete process.env.REPLENISH_TASK;
  try {
    const service = new ScenarioService(new MemoryScenarioStore(), new OfflineAuthor(), new InlineFillRunner(new MemoryScenarioStore(), new OfflineAuthor()), secret);
    await assert.rejects(service.ready(), { code: 'dependency_unavailable' });
  } finally {
    process.env.WORKFLOW_MODE = previous.mode;
    process.env.RENDER_API_KEY = previous.key;
    process.env.SCENARIO_TASK = previous.scenario;
    process.env.REPLENISH_TASK = previous.replenish;
  }
});

test('the production blueprint shares workflow config and Slack can start a run', async () => {
  const blueprint = await readFile(new URL('../render.yaml', import.meta.url), 'utf8');
  const group = blueprint.slice(blueprint.indexOf('name: renderpg-config'), blueprint.indexOf('services:'));
  assert.match(group, /key: RENDER_API_KEY/);
  assert.match(group, /key: SCENARIO_PROVIDER/);
  assert.match(group, /key: OKTA_AUTH\n\s+value: "on"/);
  const slackStart = blueprint.indexOf('name: renderpg-slack-sync');
  const slack = blueprint.slice(slackStart, blueprint.indexOf('type: workflow', slackStart));
  assert.match(slack, /fromGroup: renderpg-config/);
  const workflows = blueprint.slice(blueprint.indexOf('name: renderpg-workflows'), blueprint.indexOf('databases:'));
  assert.match(workflows, /fromGroup: renderpg-config/);
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
