import { task, type TaskContext } from '@renderinc/sdk/workflows';
import { AnthropicAI } from '../src/adapters/anthropic-ai.js';
import { OfflineAI } from '../src/adapters/offline-ai.js';
import { PostgresRepository } from '../src/adapters/postgres.js';
import { createScenarioAuthor } from '../src/composition/author.js';
import { PostgresScenarioStore } from '../src/adapters/scenario-postgres.js';
import { compileAndPublish } from '../src/application/compile-game.js';
import { publishFill } from '../src/application/publish-fill.js';
import { reserveGamePool } from '../src/composition/scenario-pool.js';
import type { GenerationInput } from '../src/application/ports.js';
import { poolTarget } from '../src/scenario/blueprint.js';

const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

// WORKFLOW_AI_MODE wins because `render workflows dev` loads .env and replaces AI_MODE.
const mode = process.env.WORKFLOW_AI_MODE ?? process.env.AI_MODE ?? 'anthropic';
const timeout = Number(process.env.AI_TIMEOUT_MS ?? 20000);
const ai = mode === 'offline'
  ? new OfflineAI()
  : new AnthropicAI(required('ANTHROPIC_API_KEY'), required('ANTHROPIC_MODEL'), timeout);
const repo = new PostgresRepository(required('DATABASE_URL'));
const scenarioStore = new PostgresScenarioStore(required('DATABASE_URL'));
const author = createScenarioAuthor(process.env.WORKFLOW_AI_MODE ?? process.env.SCENARIO_PROVIDER ?? mode);
const report = (event: string) => console.warn(JSON.stringify({ event }));

task({ name: 'compileAdventure', retry: { maxRetries: 2, waitDurationMs: 1000 } },
  async function compileAdventure(_ctx: TaskContext, input: GenerationInput) {
    await compileAndPublish(input, repo, ai, report);
    return { status: 'published' as const };
  });

const fillScenario = task({ name: 'fillScenario', retry: { maxRetries: 2, waitDurationMs: 1000 } },
  async function fillScenario(_ctx: TaskContext, input: { scenarioId: string; prompt: string }) {
    await publishFill(scenarioStore, author, input.scenarioId, input.prompt);
    return { status: 'ready' as const };
  });

task({ name: 'replenishScenarioPool', retry: { maxRetries: 1, waitDurationMs: 1000 }, timeoutSeconds: 1800 },
  async function replenishScenarioPool(ctx: TaskContext) {
    let started = 0;
    const target = poolTarget();
    while (started < target) {
      const jobs = await reserveGamePool(scenarioStore);
      if (!jobs.length) break;
      await Promise.all(jobs.map(job => ctx.run(fillScenario, job)));
      started += jobs.length;
    }
    return { started };
  });
