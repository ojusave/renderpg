import { randomUUID } from 'node:crypto';
import { blueprintId, poolTarget, staleFillMs } from '../scenario/blueprint.js';
import type { ScenarioStore } from './scenario-ports.js';

export type PoolFill = { scenarioId: string; prompt: string };

/** Reserves unclaimed fills up to the pool target. The caller starts each fill. */
export async function reservePoolFills(store: ScenarioStore, nextPrompt: () => Promise<string>): Promise<PoolFill[]> {
  return store.withPoolLock(async () => {
    await store.expireStale(new Date(Date.now() - staleFillMs).toISOString());
    const jobs: PoolFill[] = [];
    while (await store.poolDepth(blueprintId) < poolTarget && jobs.length < poolTarget) {
      const scenarioId = randomUUID();
      const prompt = await nextPrompt();
      await store.insertFilling(scenarioId, blueprintId, prompt, null);
      jobs.push({ scenarioId, prompt });
    }
    return jobs;
  });
}
