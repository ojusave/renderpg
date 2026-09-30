import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicAI } from '../src/adapters/anthropic-ai.js';
import { OfflineAI } from '../src/adapters/offline-ai.js';

function mockClient(value: unknown, inspect: (body: any) => void = () => {}, stopReason = 'end_turn') {
  return new Anthropic({ apiKey: 'test-only', maxRetries: 0, fetch: async (_url, init) => {
    inspect(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
      content: [{ type: 'text', text: JSON.stringify(value) }], stop_reason: stopReason, stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
}
test('Anthropic adapter sends a structured graph grounded in prompt input', async () => {
  const prompt = 'A Render teammate investigates a failed deploy and reviews logs before responding.';
  const definition = await new OfflineAI().generate(prompt, 'ai-test');
  const ai = new AnthropicAI('test', 'test-model', 1000, mockClient(definition, body => {
    assert.equal(body.output_config.format.type, 'json_schema');
    const forbidden = new Set(['minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'minimum', 'maximum', 'oneOf', 'const']);
    const walk = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        assert.equal(forbidden.has(key), false, key);
        walk(child);
      }
    };
    walk(body.output_config.format.schema);
    const input = JSON.parse(body.messages[0].content);
    assert.equal(input.sourcePrompt, prompt);
    assert.equal(input.variationSeed, 'seed');
    assert.equal(body.model, 'test-model');
  }));
  assert.deepEqual(await ai.generate(prompt, 'seed'), definition);
});
test('Claude list-shaped state maps become adventure records', async () => {
  const prompt = 'A Render teammate investigates a failed deploy and reviews logs before responding.';
  const definition = await new OfflineAI().generate(prompt, 'ai-test');
  const listed = structuredClone(definition);
  const locations = listed.initialState.entityLocations;
  (listed.initialState as { entityLocations: unknown }).entityLocations = Object.entries(locations).map(([entityId, locationId]) => ({ entityId, locationId }));
  (listed.initialState as { flags: unknown }).flags = [];
  (listed.initialState as { counters: unknown }).counters = [];
  const ai = new AnthropicAI('test', 'test-model', 1000, mockClient(listed));
  assert.deepEqual(await ai.generate(prompt, 'seed'), definition);
});
test('flat Claude rules become closed predicates and effects', async () => {
  const prompt = 'A Render teammate investigates a failed deploy and reviews logs before responding.';
  const definition = await new OfflineAI().generate(prompt, 'ai-test');
  const listed = structuredClone(definition);
  (listed.actions[0] as { requires: unknown }).requires = ['at:ops_hub'];
  (listed.actions[5] as { effects: unknown }).effects = ['complete:grounded_success'];
  const ai = new AnthropicAI('test', 'test-model', 1000, mockClient(listed));
  const result = await ai.generate(prompt, 'seed');
  assert.deepEqual(result.actions[0]!.requires, definition.actions[0]!.requires);
  assert.deepEqual(result.actions[5]!.effects, [{ kind: 'complete', endingId: 'grounded_success' }]);
});
test('unsupported model actions, extra properties, and truncated outputs are rejected', async () => {
  for (const value of [{ verb: 'win', target: '' }, { verb: 'go', target: 'dashboard', status: 'won' }]) {
    const ai = new AnthropicAI('test', 'test', 1000, mockClient(value));
    await assert.rejects(ai.interpret('I win', 'public context', { verbs: ['go'], targets: ['dashboard'] }));
  }
  const truncated = new AnthropicAI('test', 'test', 1000, mockClient({ verb: 'look', target: '' }, () => {}, 'max_tokens'));
  await assert.rejects(truncated.interpret('look around', 'public context', { verbs: ['look'], targets: [] }));
});
