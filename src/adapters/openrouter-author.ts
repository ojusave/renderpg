import { FILL_MAX_TOKENS, type WritingSample } from '../application/fill-progress.js';
import type { ScenarioAuthor } from '../application/scenario-ports.js';
import { fillInstructions, scenarioFillSchema } from '../scenario/fill-schema.js';
import type { ScenarioFill } from '../scenario/fill.js';
import { variationDirection } from '../scenario/variation.js';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Fills blueprint slots through OpenRouter, preferring the fastest current provider. */
export class OpenRouterAuthor implements ScenarioAuthor {
  constructor(private apiKey: string, private model: string, private timeout = 20000, private fetchImpl: FetchLike = fetch) {}

  async fill(prompt: string, variationSeed: string, report?: (sample: WritingSample) => Promise<void> | void): Promise<ScenarioFill> {
    const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(this.timeout),
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 1,
        max_tokens: FILL_MAX_TOKENS,
        messages: [
          { role: 'system', content: fillInstructions },
          { role: 'user', content: JSON.stringify({ sourcePrompt: prompt, variationSeed, variationDirection: variationDirection(variationSeed) }) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'scenario_fill', strict: true, schema: scenarioFillSchema(prompt) } },
        provider: { sort: 'throughput', require_parameters: true },
      }),
    });
    if (!response.ok) throw new Error('OpenRouter did not return a scenario fill');
    const body = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { completion_tokens?: number } };
    if (report && typeof body.usage?.completion_tokens === 'number') {
      await report({ outputTokens: body.usage.completion_tokens, maxTokens: FILL_MAX_TOKENS, characters: null });
    }
    const content = body.choices?.[0]?.message?.content?.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!content) throw new Error('OpenRouter returned an empty scenario fill');
    return JSON.parse(content) as ScenarioFill;
  }
}
