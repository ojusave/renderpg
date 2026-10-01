import { InlineFillRunner } from '../adapters/inline-fill-runner.js';
import { PostgresScenarioStore } from '../adapters/scenario-postgres.js';
import { PostgresTranscriptStore } from '../adapters/slack-postgres.js';
import { RenderFillRunner } from '../adapters/render-fill-runner.js';
import { RenderPoolScheduler } from '../adapters/render-pool-scheduler.js';
import { ScenarioService } from '../application/scenario-service.js';
import { createScenarioAuthor } from './author.js';

const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

/** Wires the scenario blueprint fillers. Inline mode never calls Render. */
export function composeScenario() {
  const author = createScenarioAuthor();
  const store = new PostgresScenarioStore(required('DATABASE_URL'));
  const workflowMode = process.env.WORKFLOW_MODE ?? 'inline';
  const runner = workflowMode === 'render'
    ? new RenderFillRunner(required('SCENARIO_TASK'), required('RENDER_API_KEY'))
    : new InlineFillRunner(store, author);
  const scheduler = workflowMode === 'render'
    ? new RenderPoolScheduler(required('REPLENISH_TASK'), required('RENDER_API_KEY'))
    : undefined;
  const prompts = new PostgresTranscriptStore(required('DATABASE_URL'));
  return { service: new ScenarioService(store, author, runner, required('SESSION_SECRET'), prompts, scheduler), store, prompts };
}
