import type pg from 'pg';
import { InlineFillRunner } from '../adapters/inline-fill-runner.js';
import { PostgresScenarioStore } from '../adapters/scenario-postgres.js';
import { PostgresTranscriptStore } from '../adapters/slack-postgres.js';
import { RenderFillRunner } from '../adapters/render-fill-runner.js';
import { RenderPoolScheduler } from '../adapters/render-pool-scheduler.js';
import { RenderTaskStatus } from '../adapters/render-task-status.js';
import { engineBundle, renderSandboxClient } from '../adapters/render-sandboxes.js';
import { ScenarioService } from '../application/scenario-service.js';
import type { ForkSimulator } from '../application/scenario-ports.js';
import { InlineForkSimulator } from '../sandbox/inline.js';
import { SandboxForkSimulator } from '../sandbox/remote.js';
import { createScenarioAuthor } from './author.js';

const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

function forkSimulator(): ForkSimulator {
  const mode = process.env.SANDBOX_MODE ?? 'inline';
  if (mode === 'inline') return new InlineForkSimulator();
  if (mode !== 'render') throw new Error('SANDBOX_MODE must be inline or render');
  return new SandboxForkSimulator(renderSandboxClient(required('RENDER_API_KEY'), required('RENDER_WORKSPACE_ID')), engineBundle);
}

/** Wires scenario fills and fork previews. Inline sandbox mode never calls Render. */
export function composeScenario(sharedPool?: pg.Pool) {
  const author = createScenarioAuthor();
  const store = new PostgresScenarioStore(required('DATABASE_URL'), sharedPool);
  const workflowMode = process.env.WORKFLOW_MODE ?? 'inline';
  const runner = workflowMode === 'render'
    ? new RenderFillRunner(required('SCENARIO_TASK'), required('RENDER_API_KEY'))
    : new InlineFillRunner(store, author);
  const scheduler = workflowMode === 'render'
    ? new RenderPoolScheduler(required('REPLENISH_TASK'), required('RENDER_API_KEY'))
    : undefined;
  const runs = workflowMode === 'render' ? new RenderTaskStatus(required('RENDER_API_KEY')) : undefined;
  const prompts = new PostgresTranscriptStore(required('DATABASE_URL'), sharedPool);
  return { service: new ScenarioService(store, author, runner, required('SESSION_SECRET'), prompts, scheduler, runs, forkSimulator()), store, prompts };
}
