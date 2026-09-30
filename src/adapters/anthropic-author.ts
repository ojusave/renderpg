import Anthropic from '@anthropic-ai/sdk';
import type { ScenarioAuthor } from '../application/scenario-ports.js';
import { actionIds, endingIds, evidenceIds } from '../scenario/blueprint.js';
import type { ScenarioFill } from '../scenario/fill.js';

const text = { type: 'string' };
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

function excerpts(prompt: string): string[] {
  const sentences = prompt.split(/(?<=[.!?])\s+/).map(value => value.trim()).filter(value => value.length > 3);
  return [...new Set(sentences)];
}

/** Asks Claude to fill blueprint text slots and nothing else. */
export class AnthropicAuthor implements ScenarioAuthor {
  private client: Anthropic;
  constructor(apiKey: string, private model: string, timeout = 20000) {
    this.client = new Anthropic({ apiKey, timeout, maxRetries: 0 });
  }
  async fill(prompt: string): Promise<ScenarioFill> {
    const quote = excerpts(prompt);
    const slot = object({ text, sourceExcerpt: quote.length ? { type: 'string', enum: quote } : text });
    const choice = object({ label: text, consequence: text });
    const ending = object({ title: text, summary: text });
    const schema = object({
      title: text, objective: text, briefing: text,
      evidence: object(Object.fromEntries(evidenceIds.map(id => [id, slot]))),
      choices: object(Object.fromEntries(actionIds.map(id => [id, choice]))),
      endings: object(Object.fromEntries(endingIds.map(id => [id, ending]))),
    });
    const message = await this.client.messages.create({
      model: this.model, max_tokens: 2500,
      system: 'Fill an existing account-ownership training framework. Use only the supplied source. Write professional, complete sentences. Do not invent policy, offices, travel, visits, credentials, or new actions. Every sourceExcerpt must be copied exactly from the source. Choice labels are workplace actions such as review, verify, request evidence, transfer, decline, or escalate.',
      messages: [{ role: 'user', content: JSON.stringify({ sourcePrompt: prompt }) }],
      output_config: { format: { type: 'json_schema', schema } },
    });
    if (message.stop_reason !== 'end_turn') throw new Error('Model did not finish a structured response');
    return JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('')) as ScenarioFill;
  }
}
