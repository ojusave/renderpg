import { AnthropicAI } from '../adapters/anthropic-ai.js';
import { InlineAdventureRunner } from '../adapters/inline-runner.js';
import { OfflineAI } from '../adapters/offline-ai.js';
import { PostgresRepository } from '../adapters/postgres.js';
import { RenderAdventureRunner } from '../adapters/render-runner.js';
import { GameService } from '../application/game-service.js';
import { buildApp } from '../api/app.js';
import { composeScenario } from './scenario.js';

const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

/** Wires all concrete runtime adapters in one composition root. */
export function composeApplication() {
  const mode = process.env.AI_MODE ?? 'anthropic';
  if (!['anthropic', 'offline'].includes(mode)) throw new Error('AI_MODE must be anthropic or offline');
  const timeout = Number(process.env.AI_TIMEOUT_MS ?? 20000);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) throw new Error('AI_TIMEOUT_MS must be 100..60000');
  const ai = mode === 'offline'
    ? new OfflineAI()
    : new AnthropicAI(required('ANTHROPIC_API_KEY'), required('ANTHROPIC_MODEL'), timeout);
  const repo = new PostgresRepository(required('DATABASE_URL'));
  const report = (event: string) => console.warn(JSON.stringify({ event }));
  const workflowMode = process.env.WORKFLOW_MODE ?? 'inline';
  if (!['inline', 'render'].includes(workflowMode)) throw new Error('WORKFLOW_MODE must be inline or render');
  const runner = workflowMode === 'render'
    ? new RenderAdventureRunner(required('WORKFLOW_TASK'), required('RENDER_API_KEY'))
    : new InlineAdventureRunner(repo, ai, report);
  const service = new GameService(repo, ai, required('SESSION_SECRET'), report, runner);
  const scenario = composeScenario(repo.pool);
  return { app: buildApp(service, repo, true, scenario.service), repo, scenarioStore: scenario.store, prompts: scenario.prompts, scenarios: scenario.service, mode };
}
