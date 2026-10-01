import { FILL_MAX_TOKENS, finishedWriting, runningProgress, savingProgress, validatingProgress, writingProgress, type FillProgress, type WritingSample } from './fill-progress.js';
import type { ScenarioAuthor, ScenarioStore } from './scenario-ports.js';
import { blueprintId } from '../scenario/blueprint.js';
import { validateFill } from '../scenario/fill.js';
import { repeatsStory, storyText } from '../scenario/similarity.js';

export const repeatedStoryError = 'This case tells the same story as one already in the game.';

/** Validates one model fill and stores it, recording each real checkpoint. */
export async function publishFill(store: ScenarioStore, author: ScenarioAuthor, scenarioId: string, prompt: string): Promise<void> {
  let current = runningProgress();
  let lastSentAt = 0;
  const report = async (progress: FillProgress) => {
    if (progress.percent < current.percent) return;
    current = progress;
    await store.setProgress(scenarioId, progress);
  };
  await report(runningProgress());
  let fill;
  let sample: WritingSample | null = null;
  try {
    fill = await author.fill(prompt, scenarioId, async next => {
      sample = next;
      const progress = writingProgress(next);
      const now = Date.now();
      if (progress.percent <= current.percent) return;
      if (progress.percent < 75 && now - lastSentAt < 250) return;
      lastSentAt = now;
      await report(progress);
    });
    await report(finishedWriting(sample ?? { outputTokens: null, maxTokens: FILL_MAX_TOKENS, characters: null }));
    await report(validatingProgress(current));
    const errors = validateFill(fill, prompt);
    if (errors.length) throw new Error(errors.join('; '));
  } catch (error) {
    await store.markFailed(scenarioId, error instanceof Error ? error.message : 'Fill failed');
    throw error;
  }
  await report(savingProgress(current));
  const next = { prompt, story: storyText(fill) };
  const settled = await store.withPoolLock(async () => {
    if (repeatsStory(next, await store.publishedStories(blueprintId))) {
      await store.markFailed(scenarioId, repeatedStoryError);
      return true;
    }
    return store.markReady(scenarioId, fill);
  });
  if (settled) return;
  const stored = await store.scenario(scenarioId);
  if (stored && stored.status !== 'filling') return;
  throw new Error('Scenario could not be published');
}
