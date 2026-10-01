import { Render } from '@renderinc/sdk';
import type { TaskRunSource } from '../application/scenario-ports.js';
import type { TaskStatus } from '../application/fill-progress.js';

const known = new Set<TaskStatus>(['pending', 'running', 'succeeded', 'failed', 'canceled']);

/** Reads one Render task run and then follows its terminal SSE event. */
export class RenderTaskStatus implements TaskRunSource {
  private client: Render;
  constructor(apiKey: string) {
    this.client = new Render({
      token: apiKey,
      useLocalDev: process.env.RENDER_USE_LOCAL_DEV === 'true',
      ...(process.env.RENDER_LOCAL_DEV_URL ? { localDevUrl: process.env.RENDER_LOCAL_DEV_URL } : {}),
    });
  }

  async watch(runId: string, signal: AbortSignal, emit: (status: TaskStatus) => void): Promise<void> {
    const current = normalize((await this.client.workflows.getTaskRun(runId)).status);
    if (current) emit(current);
    if (current === 'succeeded' || current === 'failed' || current === 'canceled') return;
    for await (const event of this.client.workflows.taskRunEvents([runId], signal)) {
      const status = normalize(event.status);
      if (status) emit(status);
    }
  }
}

function normalize(status: string): TaskStatus | null {
  if (status === 'completed') return 'succeeded';
  return known.has(status as TaskStatus) ? status as TaskStatus : null;
}
