export const FILL_MAX_TOKENS = 2400;

export type FillPhase = 'queued' | 'running' | 'generating' | 'validating' | 'saving' | 'ready' | 'failed';
export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface FillProgress {
  phase: FillPhase;
  percent: number;
  label: string;
  outputTokens: number | null;
  maxTokens: number | null;
  characters: number | null;
}

export interface WritingSample {
  outputTokens: number | null;
  maxTokens: number;
  characters: number | null;
}

export interface ProgressJson {
  phase: FillPhase;
  percent: number;
  label: string;
  output_tokens: number | null;
  max_tokens: number | null;
  characters: number | null;
  task_status: TaskStatus | null;
}

const phases: FillPhase[] = ['queued', 'running', 'generating', 'validating', 'saving', 'ready', 'failed'];

/** The checkpoint stored before the task has entered `fillScenario`. */
export function queuedProgress(): FillProgress {
  return { phase: 'queued', percent: 0, label: 'Waiting for the task', outputTokens: null, maxTokens: null, characters: null };
}

/** The checkpoint recorded on the first line of the task. */
export function runningProgress(): FillProgress {
  return { phase: 'running', percent: 10, label: 'Task started', outputTokens: null, maxTokens: null, characters: null };
}

/** Maps measured model output onto the writing slice, from 20% through 75%. */
export function writingProgress(sample: WritingSample): FillProgress {
  const maxTokens = Math.max(1, sample.maxTokens);
  const ratio = sample.outputTokens == null
    ? Math.min(1, Math.max(0, sample.characters ?? 0) / (maxTokens * 4))
    : Math.min(1, Math.max(0, sample.outputTokens) / maxTokens);
  return {
    phase: 'generating', percent: 20 + Math.floor(ratio * 55), label: 'Writing the case',
    outputTokens: sample.outputTokens, maxTokens, characters: sample.characters,
  };
}

/** Marks the model call finished, independent of unused token budget. */
export function finishedWriting(sample: WritingSample | null): FillProgress {
  return {
    phase: 'generating', percent: 75, label: 'Writing the case',
    outputTokens: sample?.outputTokens ?? null, maxTokens: sample?.maxTokens ?? null, characters: sample?.characters ?? null,
  };
}

/** The checkpoint after the model response is in memory and before validation. */
export function validatingProgress(previous: FillProgress): FillProgress {
  return { ...previous, phase: 'validating', percent: 85, label: 'Checking the case' };
}

/** The checkpoint while the validated fill is being stored. */
export function savingProgress(previous: FillProgress): FillProgress {
  return { ...previous, phase: 'saving', percent: 95, label: 'Saving the case' };
}

/** The checkpoint once the case can be played. */
export function readyProgress(previous?: FillProgress): FillProgress {
  return {
    phase: 'ready', percent: 100, label: 'Case ready',
    outputTokens: previous?.outputTokens ?? null, maxTokens: previous?.maxTokens ?? null, characters: previous?.characters ?? null,
  };
}

/** Reads a stored checkpoint, falling back to queued when the value is unusable. */
export function asProgress(value: unknown): FillProgress {
  const record = value && typeof value === 'object' ? value as Partial<FillProgress> : {};
  const phase = phases.includes(record.phase as FillPhase) ? record.phase as FillPhase : 'queued';
  const percent = typeof record.percent === 'number' ? Math.max(0, Math.min(100, Math.floor(record.percent))) : 0;
  return {
    phase, percent,
    label: typeof record.label === 'string' && record.label ? record.label : 'Waiting for the task',
    outputTokens: typeof record.outputTokens === 'number' ? record.outputTokens : null,
    maxTokens: typeof record.maxTokens === 'number' ? record.maxTokens : null,
    characters: typeof record.characters === 'number' ? record.characters : null,
  };
}

/** Converts a checkpoint to the API shape, including the latest Render task status. */
export function progressJson(progress: FillProgress, taskStatus: TaskStatus | null): ProgressJson {
  return {
    phase: progress.phase, percent: progress.percent, label: progress.label,
    output_tokens: progress.outputTokens, max_tokens: progress.maxTokens,
    characters: progress.characters, task_status: taskStatus,
  };
}
