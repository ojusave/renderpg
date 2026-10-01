import Anthropic from '@anthropic-ai/sdk';
import { FILL_MAX_TOKENS, type WritingSample } from '../application/fill-progress.js';
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
  async fill(prompt: string, variationSeed: string, report?: (sample: WritingSample) => Promise<void> | void): Promise<ScenarioFill> {
    const request = {
      model: this.model, max_tokens: FILL_MAX_TOKENS, temperature: 1,
      system: fillInstructions,
      messages: [{ role: 'user' as const, content: JSON.stringify({ sourcePrompt: prompt, variationSeed, variationDirection: variationDirection(variationSeed) }) }],
      output_config: { format: { type: 'json_schema' as const, schema: scenarioFillSchema(prompt) } },
    };
    const message = report ? await this.stream(request, report) : await this.client.messages.create(request);
    if (message.stop_reason !== 'end_turn') throw new Error('Model did not finish a structured response');
    return JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('')) as ScenarioFill;
  }

  private async stream(request: Parameters<Anthropic['messages']['create']>[0], report: (sample: WritingSample) => Promise<void> | void) {
    const stream = this.client.messages.stream(request);
    let chain = Promise.resolve();
    let characters = 0;
    stream.on('text', (_delta, snapshot) => {
      characters = snapshot.length;
      chain = chain.then(() => report({ outputTokens: null, maxTokens: FILL_MAX_TOKENS, characters }));
    });
    const message = await stream.finalMessage();
    chain = chain.then(() => report({ outputTokens: message.usage.output_tokens, maxTokens: FILL_MAX_TOKENS, characters }));
    await chain;
    return message;
  }
}
