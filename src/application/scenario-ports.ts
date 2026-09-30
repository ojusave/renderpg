import type { GameView } from '../game/types.js';
import type { PlayState } from '../scenario/engine.js';
import type { ScenarioFill } from '../scenario/fill.js';

export interface ScenarioRow {
  id: string;
  blueprintId: string;
  status: 'filling' | 'ready' | 'claimed' | 'failed';
  sessionId: string | null;
  runId: string | null;
  prompt: string;
  content: ScenarioFill | null;
  error: string | null;
  updatedAt: string;
}

export interface PlayerSession {
  id: string;
  scenarioId: string | null;
  play: PlayState | null;
}

export interface SavedChoice { requestHash: string; response: GameView }

/** Persistence for filled scenarios, sessions, and choice replays. */
export interface ScenarioStore {
  createSession(id: string, tokenHash: string): Promise<void>;
  sessionByHash(tokenHash: string): Promise<PlayerSession | null>;
  setSessionScenario(sessionId: string, scenarioId: string): Promise<void>;
  savePlay(sessionId: string, play: PlayState): Promise<void>;
  claimReady(sessionId: string, blueprintId: string): Promise<ScenarioRow | null>;
  insertFilling(id: string, blueprintId: string, prompt: string, sessionId: string | null): Promise<void>;
  setRun(id: string, runId: string): Promise<void>;
  markReady(id: string, content: ScenarioFill): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  scenario(id: string): Promise<ScenarioRow | null>;
  poolDepth(blueprintId: string): Promise<number>;
  expireStale(beforeIso: string): Promise<number>;
  choice(sessionId: string, key: string): Promise<SavedChoice | null>;
  saveChoice(sessionId: string, key: string, requestHash: string, response: GameView): Promise<void>;
}

/** Fills blueprint text slots. It does not choose stages or outcomes. */
export interface ScenarioAuthor {
  fill(prompt: string): Promise<ScenarioFill>;
}

/** Starts a durable fill. Inline implementations finish before returning. */
export interface FillRunner {
  readonly background: boolean;
  start(input: { scenarioId: string; prompt: string }): Promise<{ runId: string }>;
}
