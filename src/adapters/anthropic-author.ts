import Anthropic from '@anthropic-ai/sdk';
import type { ScenarioAuthor } from '../application/scenario-ports.js';
import { fillInstructions, scenarioFillSchema } from '../scenario/fill-schema.js';
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
      model: this.model, max_tokens: 1800, temperature: 1,
      system: fillInstructions,
      messages: [{ role: 'user', content: JSON.stringify({ sourcePrompt: prompt, variationSeed, variationDirection: variationDirection(variationSeed) }) }],
      output_config: { format: { type: 'json_schema', schema: scenarioFillSchema(prompt) } },
    });
    if (message.stop_reason !== 'end_turn') throw new Error('Model did not finish a structured response');
    return JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('')) as ScenarioFill;
  }
}
