import { progressJson, type ProgressJson, type TaskStatus } from './fill-progress.js';
import type { FillProgress } from './fill-progress.js';
import type { ScenarioStore, TaskRunSource } from './scenario-ports.js';

/** Streams stored checkpoints and, when a run exists, Render's task status. */
export async function watchFill(
  store: ScenarioStore,
  scenarioId: string,
  runId: string | null,
  runs: TaskRunSource | undefined,
  signal: AbortSignal,
  emit: (progress: ProgressJson) => void,
): Promise<void> {
  const child = new AbortController();
  const stop = () => child.abort();
  if (signal.aborted) child.abort();
  else signal.addEventListener('abort', stop, { once: true });
  let taskStatus: TaskStatus | null = null;
  let latest: FillProgress | null = null;
  const send = () => { if (latest) emit(progressJson(latest, taskStatus)); };
  const status = runs && runId
    ? runs.watch(runId, child.signal, next => { taskStatus = next; send(); }).catch(() => undefined)
    : undefined;
  try {
    await store.subscribe(scenarioId, child.signal, progress => { latest = progress; send(); });
  } finally {
    child.abort();
    signal.removeEventListener('abort', stop);
    await Promise.race([status ?? Promise.resolve(), new Promise(resolve => setTimeout(resolve, 250))]);
  }
}
