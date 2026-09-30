import { Render } from '@renderinc/sdk';
import type { AdventureRunner, GenerationInput } from '../application/ports.js';

/** Starts the registered compileAdventure task and returns its run id. */
export class RenderAdventureRunner implements AdventureRunner {
  readonly background = true;
  private client: Render;
  constructor(private task: string, apiKey: string) {
    this.client = new Render({
      token: apiKey,
      useLocalDev: process.env.RENDER_USE_LOCAL_DEV === 'true',
      ...(process.env.RENDER_LOCAL_DEV_URL ? { localDevUrl: process.env.RENDER_LOCAL_DEV_URL } : {}),
    });
  }
  async start(input: GenerationInput): Promise<{ runId: string }> {
    const run = await this.client.workflows.startTask(this.task, [input]);
    return { runId: run.taskRunId };
  }
}
