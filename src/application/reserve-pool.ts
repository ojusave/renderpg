import { randomUUID } from 'node:crypto';
import { blueprintId, fillConcurrency, poolTarget, staleFillMs } from '../scenario/blueprint.js';
import type { ScenarioStore } from './scenario-ports.js';

export type PoolFill = { scenarioId: string; prompt: string };

/** Reserves one fill for this player when the concurrency cap still has room. */
export async function reservePlayerFill(store: ScenarioStore, sessionId: string, prompt: string): Promise<string | null> {
  return store.withPoolLock(async () => {
    if (await store.fillingCount(blueprintId) >= fillConcurrency()) return null;
    const scenarioId = randomUUID();
    await store.insertFilling(scenarioId, blueprintId, prompt, sessionId);
    await store.setSessionScenario(sessionId, scenarioId);
    return scenarioId;
  });
}

/** Reserves unclaimed fills up to the pool target. The caller starts each fill. */
export async function reservePoolFills(store: ScenarioStore, nextPrompt: () => Promise<string>): Promise<PoolFill[]> {
  return store.withPoolLock(async () => {
    await store.expireStale(new Date(Date.now() - staleFillMs).toISOString());
    const room = Math.max(0, fillConcurrency() - await store.fillingCount(blueprintId));
    const jobs: PoolFill[] = [];
    while (jobs.length < room && await store.poolDepth(blueprintId) < poolTarget()) {
      const scenarioId = randomUUID();
      const prompt = await nextPrompt();
      await store.insertFilling(scenarioId, blueprintId, prompt, null);
      jobs.push({ scenarioId, prompt });
    }
    return jobs;
  });
}
