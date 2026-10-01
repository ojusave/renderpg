import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineAI } from '../src/adapters/offline-ai.js';
import { validateAdventure } from '../src/adventure/validator.js';
import { simulateAdventure } from '../src/adventure/simulator.js';
import { availableActions, resolveCommand } from '../src/game/engine.js';
import { decisionTurns } from '../src/game/visibility.js';
import type { Turn } from '../src/game/types.js';
import { maxPlayerTurns, successTurnBudget } from '../src/adventure/simulator.js';

const prompt = 'A Render teammate investigates a failed deploy and should inspect the available evidence before responding.';

test('offline generated graphs validate and expose every ending', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-a');
  assert.deepEqual(validateAdventure(definition, prompt), { valid: true, errors: [] });
  const simulation = simulateAdventure(definition);
  assert.equal(simulation.valid, true, simulation.errors.join('; '));
  assert.deepEqual(new Set(simulation.reachableEndings), new Set(['grounded_success', 'unsupported_failure']));
});

test('reading the case brief spends energy and raises focus', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-stats');
  const before = definition.initialState.stats!;
  const result = resolveCommand(definition, definition.initialState, 'read case brief');
  assert.equal(result.outcome, 'applied');
  assert.equal(result.state.stats!.energy, before.energy - 3);
  assert.equal(result.state.stats!.focus, before.focus + 5);
  assert.equal(result.state.statChanges!.energy, -3);
  assert.equal(result.state.statChanges!.focus, 5);
  assert.equal(result.state.statChanges!.reputation, 0);
});

test('the play screen never budgets more than four turns', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-a');
  assert.ok(successTurnBudget(definition) <= maxPlayerTurns);
  assert.equal(maxPlayerTurns, 4);
});

test('moving does not spend a decision and a finished game offers no choices', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-b');
  let state = structuredClone(definition.initialState);
  const read = resolveCommand(definition, state, 'read case brief').state;
  assert.ok(!availableActions(definition, read).some(action => action.verbs.includes('read') && action.label.toLowerCase().includes('brief')));
  const transcript: Turn[] = [];
  for (const input of ['read case brief', 'go dashboard', 'investigate service console', 'resolve service console']) {
    const result = resolveCommand(definition, state, input);
    state = result.state;
    transcript.push({ id: input, input, text: result.facts, outcome: result.outcome });
  }
  assert.equal(decisionTurns(definition, transcript), 3);
  assert.equal(state.status, 'completed');
  assert.deepEqual(availableActions(definition, state), []);
  assert.doesNotMatch(transcript.at(-1)!.text, /:/);
});

test('deterministic engine follows a grounded success path', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-b');
  let state = structuredClone(definition.initialState);
  state = resolveCommand(definition, state, 'read case brief').state;
  state = resolveCommand(definition, state, 'go dashboard').state;
  state = resolveCommand(definition, state, 'investigate service console').state;
  const result = resolveCommand(definition, state, 'resolve service console');
  assert.equal(result.outcome, 'completed');
  assert.equal(result.state.endingId, 'grounded_success');
});

test('a clicked tile applies its action id instead of a bare verb', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-tile');
  const action = definition.actions.find(value => value.verbs.includes('go') && value.effects.some(effect => effect.kind === 'move'));
  assert.ok(action);
  action.targetId = null;
  const result = resolveCommand(definition, definition.initialState, action.id);
  assert.equal(result.outcome, 'applied');
  assert.equal(result.state.locationId, action.effects.find(effect => effect.kind === 'move')?.locationId);
});

test('unavailable and incomplete commands do not bypass predicates', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-c');
  const original = structuredClone(definition.initialState);
  assert.equal(resolveCommand(definition, original, 'resolve service console').outcome, 'rejected');
  assert.deepEqual(original, definition.initialState);
  const clarification = resolveCommand(definition, original, 'go');
  assert.equal(clarification.outcome, 'clarification');
  assert.equal(clarification.state.pendingVerb, 'go');
  assert.equal(resolveCommand(definition, clarification.state, 'dashboard').state.locationId, 'dashboard');
});

test('validator rejects invented source excerpts and dangling references', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-d');
  definition.sourceFacts[0]!.sourceExcerpt = 'not present in source';
  definition.actions[0]!.effects = [{ kind: 'move', locationId: 'missing' }];
  const report = validateAdventure(definition, prompt);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.includes('does not occur')));
  assert.ok(report.errors.some(error => error.includes('unknown location')));
});
