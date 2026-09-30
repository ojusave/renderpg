import { Render } from '@renderinc/sdk';
import type { FillRunner } from '../application/scenario-ports.js';

/** Starts the fillScenario workflow and returns its run id. */
export class RenderFillRunner implements FillRunner {
  readonly background = true;
  private client: Render;
  constructor(private task: string, apiKey: string) {
    this.client = new Render({
      token: apiKey,
      useLocalDev: process.env.RENDER_USE_LOCAL_DEV === 'true',
      ...(process.env.RENDER_LOCAL_DEV_URL ? { localDevUrl: process.env.RENDER_LOCAL_DEV_URL } : {}),
    });
  }
  async start(input: { scenarioId: string; prompt: string }) {
    const run = await this.client.workflows.startTask(this.task, [input]);
    return { runId: run.taskRunId };
  }
}
