import type { GameView } from '../game/types.js';
import type { PlayState } from '../scenario/engine.js';
import type { ScenarioFill } from '../scenario/fill.js';
import type { FillProgress, TaskStatus, WritingSample } from './fill-progress.js';

export interface ScenarioRow {
  id: string;
  blueprintId: string;
  status: 'filling' | 'ready' | 'claimed' | 'failed';
  sessionId: string | null;
  runId: string | null;
  prompt: string;
  content: ScenarioFill | null;
  error: string | null;
  progress: FillProgress;
  updatedAt: string;
}

export interface PlayerRecord {
  id: string;
  subject: string | null;
}

export interface PlayerSession {
  id: string;
  playerId: string;
  scenarioId: string | null;
  play: PlayState | null;
}

export interface SavedChoice { requestHash: string; response: GameView }

/** Persistence for filled scenarios, sessions, and choice replays. */
export interface ScenarioStore {
  insertPlayer(id: string, subject: string | null): Promise<void>;
  player(id: string): Promise<PlayerRecord | null>;
  /** Returns the existing player when this SSO subject was already stored. */
  upsertPlayer(id: string, subject: string): Promise<string>;
  createSession(id: string, tokenHash: string, playerId: string): Promise<void>;
  sessionByHash(tokenHash: string): Promise<PlayerSession | null>;
  setSessionScenario(sessionId: string, scenarioId: string): Promise<void>;
  savePlay(sessionId: string, play: PlayState): Promise<void>;
  /** Locks one session, replays a stored choice, or commits the next play and its replay together. */
  commitChoice(sessionId: string, key: string, requestHash: string, apply: (play: PlayState) => Promise<{ play: PlayState; response: GameView }> | { play: PlayState; response: GameView }): Promise<GameView>;
  deleteSession(sessionId: string): Promise<void>;
  claimReady(sessionId: string, blueprintId: string): Promise<ScenarioRow | null>;
  /** Assigns an unclaimed fill that is already running so sign-in does not start a second one. */
  claimFilling(sessionId: string, blueprintId: string): Promise<ScenarioRow | null>;
  insertFilling(id: string, blueprintId: string, prompt: string, sessionId: string | null): Promise<void>;
  setRun(id: string, runId: string): Promise<void>;
  /** Records a newer checkpoint while the fill is still in progress. */
  setProgress(id: string, progress: FillProgress): Promise<void>;
  /** Emits the current checkpoint until the fill leaves `filling` or the signal aborts. */
  subscribe(id: string, signal: AbortSignal, emit: (progress: FillProgress) => void): Promise<void>;
  /** Publishes a fill only while it is still in progress. */
  markReady(id: string, content: ScenarioFill): Promise<boolean>;
  /** Records failure only while the fill is still in progress. */
  markFailed(id: string, error: string): Promise<boolean>;
  scenario(id: string): Promise<ScenarioRow | null>;
  health(): Promise<void>;
  poolDepth(blueprintId: string): Promise<number>;
  /** Counts every fill still in progress, including ones already assigned to a player. */
  fillingCount(blueprintId: string): Promise<number>;
  expireStale(beforeIso: string): Promise<number>;
  /** Runs the critical section alone so two replenishers cannot overfill the pool. */
  withPoolLock<T>(work: () => Promise<T>): Promise<T>;
  choice(sessionId: string, key: string): Promise<SavedChoice | null>;
  saveChoice(sessionId: string, key: string, requestHash: string, response: GameView): Promise<void>;
}

/** Supplies a redacted Slack story for the scenario agent. */
export interface ScenarioPromptSource {
  nextPrompt(): Promise<string | null>;
}

/** Fills blueprint text slots. It does not choose stages or outcomes. */
export interface ScenarioAuthor {
  fill(prompt: string, variationSeed: string, report?: (sample: WritingSample) => Promise<void> | void): Promise<ScenarioFill>;
}

/** Reads Render's status for one task run. Failure stays inside the adapter. */
export interface TaskRunSource {
  watch(runId: string, signal: AbortSignal, emit: (status: TaskStatus) => void): Promise<void>;
}

/** Starts a durable fill. Inline implementations finish before returning. */
export interface FillRunner {
  readonly background: boolean;
  start(input: { scenarioId: string; prompt: string }): Promise<{ runId: string }>;
}

/** Starts pool replenishment. Inline mode fills in process; Render mode starts the parent task. */
export interface PoolScheduler {
  readonly background: boolean;
  schedule(): Promise<void>;
}
