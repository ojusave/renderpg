import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineAI } from '../src/adapters/offline-ai.js';
import { repairAdventure } from '../src/adventure/repair.js';
import { simulateAdventure } from '../src/adventure/simulator.js';
import { validateAdventure } from '../src/adventure/validator.js';

const prompt = 'A Render teammate investigates a failed deploy and should inspect the available evidence before responding.';

test('repair reconnects unreachable locations and endings without another model call', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-a');
  definition.actions = definition.actions.filter(action => !['go_dashboard', 'go_hub', 'guess'].includes(action.id));
  assert.equal(simulateAdventure(definition).valid, false);

  const repaired = repairAdventure(definition);
  assert.deepEqual(validateAdventure(repaired, prompt), { valid: true, errors: [] });
  const simulation = simulateAdventure(repaired);
  assert.equal(simulation.valid, true, simulation.errors.join('; '));
  assert.ok(repaired.actions.some(action => action.id === 'return_ops_hub_from_dashboard'));
});

test('repair drops requirements that no action can ever satisfy', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-a');
  definition.actions.find(action => action.id === 'resolve')!.requires.push({ kind: 'fact', factId: 'never_revealed' });
  assert.equal(simulateAdventure(definition).valid, false);
  assert.equal(simulateAdventure(repairAdventure(definition)).valid, true);
});

test('repair leaves a connected adventure unchanged', async () => {
  const definition = await new OfflineAI().generate(prompt, 'seed-a');
  const before = structuredClone(definition);
  assert.deepEqual(repairAdventure(definition), before);
});
