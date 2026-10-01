import { Render } from '@renderinc/sdk';
import type { PoolScheduler } from '../application/scenario-ports.js';

/** Starts the replenishScenarioPool parent task. The parent chains fillScenario. */
export class RenderPoolScheduler implements PoolScheduler {
  readonly background = true;
  private client: Render;
  constructor(private task: string, apiKey: string) {
    this.client = new Render({
      token: apiKey,
      useLocalDev: process.env.RENDER_USE_LOCAL_DEV === 'true',
      ...(process.env.RENDER_LOCAL_DEV_URL ? { localDevUrl: process.env.RENDER_LOCAL_DEV_URL } : {}),
    });
  }
  async schedule(): Promise<void> {
    const minute = new Date().toISOString().slice(0, 16);
    await this.client.workflows.startTask(this.task, [], { idempotencyKey: `scenario-replenish-${minute}` });
  }
}
