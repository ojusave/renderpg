import type { GameView } from '../src/game/types.js';
import type { PlayState } from '../src/scenario/engine.js';
import type { ScenarioFill } from '../src/scenario/fill.js';
import { AppError, conflict } from '../src/application/errors.js';
import type { PlayerSession, ScenarioRow, ScenarioStore, SavedChoice } from '../src/application/scenario-ports.js';

/** In-memory scenario pool for blueprint tests. */
export class MemoryScenarioStore implements ScenarioStore {
  sessions = new Map<string, { tokenHash: string; scenarioId: string | null; play: PlayState | null }>();
  scenarios = new Map<string, ScenarioRow>();
  choices = new Map<string, SavedChoice>();
  private lock: Promise<void> = Promise.resolve();
  async createSession(id: string, tokenHash: string) { this.sessions.set(id, { tokenHash, scenarioId: null, play: null }); }
  async sessionByHash(tokenHash: string): Promise<PlayerSession | null> {
    for (const [id, session] of this.sessions) if (session.tokenHash === tokenHash) return { id, scenarioId: session.scenarioId, play: session.play };
    return null;
  }
  async setSessionScenario(sessionId: string, scenarioId: string) { this.sessions.get(sessionId)!.scenarioId = scenarioId; }
  async savePlay(sessionId: string, play: PlayState) { this.sessions.get(sessionId)!.play = structuredClone(play); }
  private choiceLock: Promise<void> = Promise.resolve();
  async commitChoice(sessionId: string, key: string, requestHash: string, apply: (play: PlayState) => Promise<{ play: PlayState; response: GameView }> | { play: PlayState; response: GameView }) {
    const previous = this.choiceLock;
    let release = () => {};
    this.choiceLock = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const prior = await this.choice(sessionId, key);
      if (prior) {
        if (prior.requestHash !== requestHash) throw conflict('idempotency_conflict', 'This request key was used with a different payload.');
        return prior.response;
      }
      const session = this.sessions.get(sessionId);
      if (!session?.play) throw new AppError(409, 'scenario_not_ready', 'Begin the scenario before choosing a response.');
      const result = await apply(structuredClone(session.play));
      session.play = structuredClone(result.play);
      this.choices.set(`${sessionId}:${key}`, structuredClone({ requestHash, response: result.response }));
      return structuredClone(result.response);
    } finally { release(); }
  }
  async deleteSession(sessionId: string) {
    this.sessions.delete(sessionId);
    for (const key of [...this.choices.keys()]) if (key.startsWith(`${sessionId}:`)) this.choices.delete(key);
    for (const row of this.scenarios.values()) if (row.sessionId === sessionId) row.sessionId = null;
  }
  async claimReady(sessionId: string, blueprintId: string) {
    const ready = [...this.scenarios.values()].find(row => row.status === 'ready' && row.sessionId === null && row.blueprintId === blueprintId);
    if (!ready) return null;
    ready.status = 'claimed';
    ready.sessionId = sessionId;
    return structuredClone(ready);
  }
  async insertFilling(id: string, blueprintId: string, prompt: string, sessionId: string | null) {
    this.scenarios.set(id, { id, blueprintId, status: 'filling', sessionId, runId: null, prompt, content: null, error: null, updatedAt: new Date().toISOString() });
  }
  async setRun(id: string, runId: string) { this.scenarios.get(id)!.runId = runId; }
  async markReady(id: string, content: ScenarioFill) {
    const row = this.scenarios.get(id);
    if (!row || row.status !== 'filling') return false;
    row.content = content;
    row.status = row.sessionId ? 'claimed' : 'ready';
    row.error = null;
    row.updatedAt = new Date().toISOString();
    return true;
  }
  async markFailed(id: string, error: string) {
    const row = this.scenarios.get(id);
    if (!row || row.status !== 'filling') return false;
    row.status = 'failed';
    row.error = error;
    row.updatedAt = new Date().toISOString();
    return true;
  }
  async health() {}
  async scenario(id: string) { return structuredClone(this.scenarios.get(id) ?? null); }
  async poolDepth(blueprintId: string) {
    return [...this.scenarios.values()].filter(row => row.blueprintId === blueprintId && row.sessionId === null && (row.status === 'ready' || row.status === 'filling')).length;
  }
  async withPoolLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.lock;
    let release: () => void = () => {};
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }
  async expireStale(beforeIso: string) {
    let count = 0;
    for (const row of this.scenarios.values()) if (row.status === 'filling' && row.updatedAt < beforeIso) { row.status = 'failed'; row.error = 'Fill timed out.'; count += 1; }
    return count;
  }
  async choice(sessionId: string, key: string) { return structuredClone(this.choices.get(`${sessionId}:${key}`) ?? null); }
  async saveChoice(sessionId: string, key: string, requestHash: string, response: GameView) {
    const id = `${sessionId}:${key}`;
    if (!this.choices.has(id)) this.choices.set(id, { requestHash, response });
  }
  async close() {}
}
