import type { ScenarioAuthor, ScenarioStore } from './scenario-ports.js';
import { validateFill } from '../scenario/fill.js';

/** Validates one model fill and stores it. A failed fill leaves no playable scenario. */
export async function publishFill(store: ScenarioStore, author: ScenarioAuthor, scenarioId: string, prompt: string): Promise<void> {
  try {
    const fill = await author.fill(prompt, scenarioId);
    const errors = validateFill(fill, prompt);
    if (errors.length) throw new Error(errors.join('; '));
    await store.markReady(scenarioId, fill);
  } catch (error) {
    await store.markFailed(scenarioId, error instanceof Error ? error.message : 'Fill failed');
    throw error;
  }
}
