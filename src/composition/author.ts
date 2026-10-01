import { AnthropicAuthor } from '../adapters/anthropic-author.js';
import { OfflineAuthor } from '../adapters/offline-author.js';
import { OpenRouterAuthor } from '../adapters/openrouter-author.js';
import type { ScenarioAuthor } from '../application/scenario-ports.js';

const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

/** Wires the scenario author. OpenRouter is the low-latency provider when selected. */
export function createScenarioAuthor(mode = process.env.SCENARIO_PROVIDER ?? process.env.AI_MODE ?? 'anthropic'): ScenarioAuthor {
  const timeout = Number(process.env.AI_TIMEOUT_MS ?? 20000);
  if (mode === 'offline') return new OfflineAuthor();
  if (mode === 'openrouter') {
    return new OpenRouterAuthor(required('OPENROUTER_API_KEY'), process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash', timeout);
  }
  if (mode !== 'anthropic') throw new Error('SCENARIO_PROVIDER must be anthropic, openrouter, or offline');
  return new AnthropicAuthor(required('ANTHROPIC_API_KEY'), required('ANTHROPIC_MODEL'), timeout);
}
