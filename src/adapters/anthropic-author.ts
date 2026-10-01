import Anthropic from '@anthropic-ai/sdk';
import type { ScenarioAuthor } from '../application/scenario-ports.js';
import { scenarioFillSchema } from '../scenario/fill-schema.js';
import type { ScenarioFill } from '../scenario/fill.js';
import { variationDirection } from '../scenario/variation.js';

/** Asks Claude to fill blueprint text slots and nothing else. */
export class AnthropicAuthor implements ScenarioAuthor {
  private client: Anthropic;
  constructor(apiKey: string, private model: string, timeout = 20000, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey, timeout, maxRetries: 0 });
  }
  async fill(prompt: string, variationSeed: string): Promise<ScenarioFill> {
    const message = await this.client.messages.create({
      model: this.model, max_tokens: 1200, temperature: 1,
      system: 'Fill an existing account-ownership training framework. Use only the supplied source. Follow variationDirection so this telling differs from other tellings of the same source. Write professional, complete sentences. Do not invent policy, offices, travel, visits, credentials, or new actions. Every sourceExcerpt must be copied exactly from the source. Choice labels are workplace actions such as review, verify, request evidence, transfer, decline, or escalate. Each evidence text and each consequence is exactly one sentence, so the game master never says more than two sentences.',
      messages: [{ role: 'user', content: JSON.stringify({ sourcePrompt: prompt, variationSeed, variationDirection: variationDirection(variationSeed) }) }],
      output_config: { format: { type: 'json_schema', schema: scenarioFillSchema(prompt) } },
    });
    if (message.stop_reason !== 'end_turn') throw new Error('Model did not finish a structured response');
    return JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('')) as ScenarioFill;
  }
}
