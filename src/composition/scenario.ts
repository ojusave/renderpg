import { AnthropicAuthor } from '../adapters/anthropic-author.js';
import { InlineFillRunner } from '../adapters/inline-fill-runner.js';
import { OfflineAuthor } from '../adapters/offline-author.js';
import { PostgresScenarioStore } from '../adapters/scenario-postgres.js';
import { RenderFillRunner } from '../adapters/render-fill-runner.js';
import { ScenarioService } from '../application/scenario-service.js';

const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

/** Wires the scenario blueprint fillers. Inline mode never calls Render. */
export function composeScenario() {
  const mode = process.env.AI_MODE ?? 'anthropic';
  const timeout = Number(process.env.AI_TIMEOUT_MS ?? 20000);
  const author = mode === 'offline' ? new OfflineAuthor() : new AnthropicAuthor(required('ANTHROPIC_API_KEY'), required('ANTHROPIC_MODEL'), timeout);
  const store = new PostgresScenarioStore(required('DATABASE_URL'));
  const workflowMode = process.env.WORKFLOW_MODE ?? 'inline';
  const runner = workflowMode === 'render'
    ? new RenderFillRunner(process.env.SCENARIO_TASK?.trim() || 'fillScenario', required('RENDER_API_KEY'))
    : new InlineFillRunner(store, author);
  return { service: new ScenarioService(store, author, runner, required('SESSION_SECRET')), store };
}
