import type { ScenarioAuthor, ScenarioStore } from './scenario-ports.js';
import { validateFill } from '../scenario/fill.js';

/** Validates one model fill and stores it. A failed or expired fill is not made playable. */
export async function publishFill(store: ScenarioStore, author: ScenarioAuthor, scenarioId: string, prompt: string): Promise<void> {
  let fill;
  try {
    fill = await author.fill(prompt, scenarioId);
    const errors = validateFill(fill, prompt);
    if (errors.length) throw new Error(errors.join('; '));
  } catch (error) {
    await store.markFailed(scenarioId, error instanceof Error ? error.message : 'Fill failed');
    throw error;
  }
  if (await store.markReady(scenarioId, fill)) return;
  const current = await store.scenario(scenarioId);
  if (current && current.status !== 'filling') return;
  throw new Error('Scenario could not be published');
}
