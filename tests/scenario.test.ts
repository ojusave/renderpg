import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { OfflineAuthor } from '../src/adapters/offline-author.js';
import { InlineFillRunner } from '../src/adapters/inline-fill-runner.js';
import { OfflineAI } from '../src/adapters/offline-ai.js';
import { GameService } from '../src/application/game-service.js';
import { ScenarioService } from '../src/application/scenario-service.js';
import { buildApp } from '../src/api/app.js';
import { MemoryRepository } from './helpers.js';
import { defaultScenarioPrompt } from '../src/scenario/default-prompt.js';
import { applyChoice, legalActions, openPlay, presentPlay } from '../src/scenario/engine.js';
import { validateFill } from '../src/scenario/fill.js';
import { fillInstructions } from '../src/scenario/fill-schema.js';
import { offlineFill } from '../src/scenario/offline-fill.js';
import { MemoryScenarioStore } from './scenario-memory.js';
import { reservePoolFills } from '../src/application/reserve-pool.js';
import { blueprintId, fillConcurrency, poolTarget } from '../src/scenario/blueprint.js';
import { publishFill } from '../src/application/publish-fill.js';

const secret = 's'.repeat(32);

test('fill validation rejects travel, repeated options, and invented excerpts', () => {
  const fill = offlineFill();
  assert.deepEqual(validateFill(fill, defaultScenarioPrompt), []);
  fill.after_check.go_ahead = 'Travel to the owner office';
  assert.ok(validateFill(fill, defaultScenarioPrompt).some(error => error.includes('unrealistic')));
  fill.after_check.go_ahead = fill.after_check.hold_off;
  assert.ok(validateFill(fill, defaultScenarioPrompt).some(error => error.includes('repeat')));
  fill.after_check.go_ahead = 'Make them the owner';
  fill.first_look.sourceExcerpt = 'A fact that was never in the source.';
  assert.ok(validateFill(fill, defaultScenarioPrompt).some(error => error.includes('excerpt')));
  fill.pressure = 'Speaker B pushes for a quick answer.';
  assert.ok(validateFill(fill, defaultScenarioPrompt).some(error => error.includes('Speaker')));
});

test('going ahead succeeds only after the proper check', () => {
  const fill = offlineFill();
  const state = applyChoice(openPlay(fill), fill, 'look_first');
  const trusted = applyChoice(applyChoice(state, fill, 'shortcut'), fill, 'go_ahead');
  assert.equal(trusted.endingId, 'acted_unchecked');
  const verified = applyChoice(applyChoice(state, fill, 'verify'), fill, 'go_ahead');
  assert.equal(verified.endingId, 'success');
  assert.equal(verified.status, 'completed');
});

const expectedEndings: Record<string, string> = {
  'act_now': 'acted_too_early',
  'refuse': 'refused',
  'look_first>hand_off_early': 'handed_off_early',
  'look_first>verify>go_ahead': 'success',
  'look_first>verify>hold_off': 'held_after_check',
  'look_first>verify>hand_off': 'handed_off_after_check',
  'look_first>shortcut>go_ahead': 'acted_unchecked',
  'look_first>shortcut>hold_off': 'held_unchecked',
  'look_first>shortcut>hand_off': 'handed_off_unchecked',
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

test('each question shows the options that answer it in that state', () => {
  const fill = offlineFill();
  const opened = applyChoice(openPlay(fill), fill, 'look_first');
  const checking = presentPlay('x', fill, opened);
  assert.equal(checking.stage, fill.investigate.question);
  assert.deepEqual(checking.available_actions.map(action => action.label), [fill.investigate.verify, fill.investigate.shortcut, fill.investigate.hand_off_early]);
  const checked = presentPlay('x', fill, applyChoice(opened, fill, 'verify'));
  assert.equal(checked.stage, fill.after_check.question);
  assert.equal(checked.available_actions[0]!.label, fill.after_check.go_ahead);
  const unchecked = presentPlay('x', fill, applyChoice(opened, fill, 'shortcut'));
  assert.equal(unchecked.stage, fill.after_shortcut.question);
  assert.equal(unchecked.available_actions[1]!.label, fill.after_shortcut.hold_off);
});

test('each step shows what happened, then the pressure before the next question', () => {
  const fill = offlineFill();
  const opened = applyChoice(openPlay(fill), fill, 'look_first');
  assert.equal(opened.transcript.at(-1)!.text, `${fill.first_look.text} ${fill.pressure}`);
  const checked = applyChoice(opened, fill, 'verify');
  assert.equal(checked.transcript.at(-1)!.text, `${fill.check_result.text} ${fill.after_check.setup}`);
  assert.deepEqual(checked.revealed, ['first_look', 'check_result']);
  const trusted = applyChoice(opened, fill, 'shortcut');
  assert.equal(trusted.transcript.at(-1)!.text, `${fill.shortcut_result} ${fill.after_shortcut.setup}`);
});

test('game master text is at most two sentences and keeps abbreviations whole', () => {
  const fill = offlineFill();
  fill.first_look.text = 'It was deleted at 2:14 a.m. by a teammate. Two. Three.';
  fill.pressure = 'Four. Five.';
  const state = applyChoice(openPlay(fill), fill, 'look_first');
  assert.equal(state.transcript.at(-1)!.text, 'It was deleted at 2:14 a.m. by a teammate. Four.');
  fill.pressure = 'Sam writes back: "The clinics open soon. Please hurry." Then Sam calls.';
  const quoted = applyChoice(openPlay(fill), fill, 'look_first');
  assert.match(quoted.transcript.at(-1)!.text, /"The clinics open soon\. Please hurry\."$/);
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
  const verified = await service.choose(session.session_token, randomUUID(), 'look_first', game.version);
  const decided = await service.choose(session.session_token, randomUUID(), 'verify', verified.version);
  const ended = await service.choose(session.session_token, randomUUID(), 'go_ahead', decided.version);
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

test('the author writes the case the transcript is about', () => {
  assert.match(fillInstructions, /this case is about the decision in that transcript/);
  assert.equal(/identify the rightful new owner before any transfer/.test(fillInstructions), false);
  assert.equal(/gives the customer the account immediately/.test(fillInstructions), false);
});

test('each reserved case receives its own transcript', async () => {
  const previousTarget = process.env.SCENARIO_POOL_TARGET;
  const previousConcurrency = process.env.SCENARIO_FILL_CONCURRENCY;
  process.env.SCENARIO_POOL_TARGET = '3';
  process.env.SCENARIO_FILL_CONCURRENCY = '3';
  try {
    const store = new MemoryScenarioStore();
    const prompts = ['A deploy was frozen until someone approved the rollback.', 'Billing asked Security to confirm who can close the invoice.'];
    const fills = await reservePoolFills(store, async () => prompts.shift() ?? defaultScenarioPrompt);
    assert.equal(fills.length, 3);
    assert.equal(fills[0]?.prompt, 'A deploy was frozen until someone approved the rollback.');
    assert.equal(fills[1]?.prompt, 'Billing asked Security to confirm who can close the invoice.');
    assert.notEqual(fills[0]?.prompt, fills[2]?.prompt);
  } finally {
    if (previousTarget === undefined) delete process.env.SCENARIO_POOL_TARGET;
    else process.env.SCENARIO_POOL_TARGET = previousTarget;
    if (previousConcurrency === undefined) delete process.env.SCENARIO_FILL_CONCURRENCY;
    else process.env.SCENARIO_FILL_CONCURRENCY = previousConcurrency;
  }
});

test('pool reservation stops at the concurrency cap', async () => {
  const store = new MemoryScenarioStore();
  const first = await reservePoolFills(store, async () => defaultScenarioPrompt);
  const second = await reservePoolFills(store, async () => defaultScenarioPrompt);
  const batch = Math.min(poolTarget(), fillConcurrency());
  assert.equal(first.length, batch);
  assert.equal(second.length, 0);
  assert.equal(await store.poolDepth(blueprintId), batch);
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
  assert.match(game.transcript[0]!.text, /Can you make me the owner\?/);
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
    service.choose(session.session_token, key, 'look_first', game.version),
    service.choose(session.session_token, key, 'look_first', game.version),
  ]);
  assert.deepEqual(duplicates[0], duplicates[1]);
  assert.equal(duplicates[0]!.version, 1);
  await assert.rejects(service.choose(session.session_token, key, 'verify', game.version), { code: 'idempotency_conflict' });
  const races = await Promise.allSettled([
    service.choose(session.session_token, randomUUID(), 'verify', duplicates[0]!.version),
    service.choose(session.session_token, randomUUID(), 'shortcut', duplicates[0]!.version),
  ]);
  assert.equal(races.filter(race => race.status === 'fulfilled').length, 1);
  assert.equal(races.filter(race => race.status === 'rejected').length, 1);
  const ended = await service.choose(session.session_token, randomUUID(), 'hand_off', (await service.current(session.session_token)).game!.version);
  assert.equal(ended.status, 'completed');
  await assert.rejects(service.choose(session.session_token, randomUUID(), 'hand_off', ended.version), { code: 'game_finished' });
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
  assert.match(group, /key: SCENARIO_POOL_TARGET\n\s+value: "100"/);
  assert.match(group, /key: SCENARIO_FILL_CONCURRENCY\n\s+value: "8"/);
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
  const session = await service.signIn();
  assert.equal(session.status, 'preparing');
  assert.equal(session.progress.percent, 0);
  assert.equal(session.progress.phase, 'queued');
  assert.equal(fills, 0);
  await store.markReady(scenarioId, offlineFill());
  const current = await service.current(session.session_token);
  assert.equal(current.status, 'ready');
  assert.equal(current.progress.percent, 100);
  assert.equal((await store.scenario(scenarioId))?.status, 'claimed');
});

test('sso reuses the employee and everyone else gets a stored anonymous id', async () => {
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  const anon = await service.signIn();
  const again = await service.signIn({ playerId: anon.player_id });
  assert.equal(again.player_id, anon.player_id);
  assert.notEqual(again.game_id, anon.game_id);
  assert.equal(anon.game_url, `/sessions/${anon.game_id}`);
  await assert.rejects(service.current(anon.session_token, again.game_id), { code: 'game_not_found' });
  const employee = await service.signIn({ subject: 'ada@render.com', playerId: anon.player_id });
  const same = await service.signIn({ subject: 'ada@render.com' });
  assert.equal(same.player_id, employee.player_id);
  assert.notEqual(same.player_id, anon.player_id);
  const stranger = await service.signIn({ playerId: randomUUID() });
  assert.notEqual(stranger.player_id, anon.player_id);
});

test('a burst of sign-ins gets a game url each and does not fill one scenario per player', async () => {
  const store = new MemoryScenarioStore();
  let started = 0;
  let scheduled = 0;
  const runner = { background: true, async start() { started += 1; return { runId: randomUUID() }; } };
  const service = new ScenarioService(store, new OfflineAuthor(), runner, secret, null, {
    background: true,
    async schedule() { scheduled += 1; },
  });
  const sessions = await Promise.all(Array.from({ length: 100 }, () => service.signIn()));
  assert.equal(new Set(sessions.map(session => session.game_url)).size, 100);
  assert.equal(started, sessions.filter(session => session.run_id).length);
  assert.ok(started < 100);
  assert.ok(scheduled < 100);
  const waiting = sessions.find(session => session.run_id === null);
  assert.ok(waiting);
  const readyId = randomUUID();
  await store.insertFilling(readyId, blueprintId, defaultScenarioPrompt, null);
  await store.markReady(readyId, offlineFill());
  const current = await service.current(waiting.session_token, waiting.game_id);
  assert.equal(current.status, 'ready');
  assert.equal(current.game_url, waiting.game_url);
});

test('the game url is authorized by the bearer token', async () => {
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  const scenarios = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  const app = buildApp(new GameService(new MemoryRepository(), new OfflineAI(), secret), new MemoryRepository(), false, scenarios);
  const created = await app.inject({ method: 'POST', url: '/sessions' });
  assert.equal(created.statusCode, 200);
  const body = created.json();
  assert.equal(body.game_url, `/sessions/${body.game_id}`);
  const denied = await app.inject({
    method: 'GET',
    url: `/sessions/${randomUUID()}`,
    headers: { authorization: `Bearer ${body.session_token}` },
  });
  assert.equal(denied.statusCode, 404);
  const allowed = await app.inject({
    method: 'GET',
    url: body.game_url,
    headers: { authorization: `Bearer ${body.session_token}` },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().game_id, body.game_id);
  await app.close();
});
