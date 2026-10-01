import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicAuthor } from '../src/adapters/anthropic-author.js';
import { OpenRouterAuthor } from '../src/adapters/openrouter-author.js';
import { offlineFill } from '../src/scenario/offline-fill.js';

const prompt = 'A customer contacted Security after the employee who owned the account left.';

test('Claude fill requests a different telling for the variation seed', async () => {
  const fill = offlineFill(prompt, 'seed-a');
  const author = new AnthropicAuthor('test', 'test-model', 1000, new Anthropic({ apiKey: 'test-only', maxRetries: 0, fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.temperature, 1);
    assert.equal(body.max_tokens, 1200);
    const input = JSON.parse(body.messages[0].content);
    assert.equal(input.variationSeed, 'seed-a');
    assert.match(input.variationDirection, /account facts unchanged/);
    return new Response(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
      content: [{ type: 'text', text: JSON.stringify(fill) }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } }));
  assert.equal((await author.fill(prompt, 'seed-a')).title, fill.title);
});

test('OpenRouter fill asks for the fastest provider that supports the schema', async () => {
  const fill = offlineFill(prompt, 'seed-b');
  const author = new OpenRouterAuthor('test', 'google/gemini-2.5-flash', 1000, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.provider.sort, 'throughput');
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(JSON.parse(body.messages[1].content).variationSeed, 'seed-b');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fill) } }] }), { status: 200 });
  });
  assert.equal((await author.fill(prompt, 'seed-b')).briefing, fill.briefing);
});
