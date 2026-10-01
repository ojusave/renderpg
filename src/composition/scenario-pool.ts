import { PostgresTranscriptStore } from '../adapters/slack-postgres.js';
import { reservePoolFills, type PoolFill } from '../application/reserve-pool.js';
import type { ScenarioStore } from '../application/scenario-ports.js';
import { defaultScenarioPrompt } from '../scenario/default-prompt.js';

/** Reserves pool fills, giving each one a different unused transcript. */
export async function reserveGamePool(store: ScenarioStore): Promise<PoolFill[]> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const prompts = new PostgresTranscriptStore(databaseUrl);
  try {
    return await reservePoolFills(store, async () => {
      try {
        const prompt = (await prompts.nextPrompt())?.trim();
        return prompt || defaultScenarioPrompt;
      } catch {
        return defaultScenarioPrompt;
      }
    });
  } finally {
    await prompts.close();
  }
}
