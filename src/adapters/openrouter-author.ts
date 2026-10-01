import type { ScenarioAuthor } from '../application/scenario-ports.js';
import { scenarioFillSchema } from '../scenario/fill-schema.js';
import type { ScenarioFill } from '../scenario/fill.js';
import { variationDirection } from '../scenario/variation.js';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Fills blueprint slots through OpenRouter, preferring the fastest current provider. */
export class OpenRouterAuthor implements ScenarioAuthor {
  constructor(private apiKey: string, private model: string, private timeout = 20000, private fetchImpl: FetchLike = fetch) {}

  async fill(prompt: string, variationSeed: string): Promise<ScenarioFill> {
    const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(this.timeout),
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 1,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: 'Fill an existing account-ownership training framework. Use only the supplied source. Follow variationDirection so this telling differs from other tellings of the same source. Write professional, complete sentences. Do not invent policy, offices, travel, visits, credentials, or new actions. Every sourceExcerpt must be copied exactly from the source. Choice labels are workplace actions such as review, verify, request evidence, transfer, decline, or escalate. Each evidence text and each consequence is exactly one sentence.' },
          { role: 'user', content: JSON.stringify({ sourcePrompt: prompt, variationSeed, variationDirection: variationDirection(variationSeed) }) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'scenario_fill', strict: true, schema: scenarioFillSchema(prompt) } },
        provider: { sort: 'throughput', require_parameters: true },
      }),
    });
    if (!response.ok) throw new Error('OpenRouter did not return a scenario fill');
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content?.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!content) throw new Error('OpenRouter returned an empty scenario fill');
    return JSON.parse(content) as ScenarioFill;
  }
}
