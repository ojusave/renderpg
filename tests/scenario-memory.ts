import type { GameView } from '../src/game/types.js';
import type { PlayState } from '../src/scenario/engine.js';
import type { ScenarioFill } from '../src/scenario/fill.js';
import { AppError, conflict } from '../src/application/errors.js';
import { queuedProgress, readyProgress, type FillProgress } from '../src/application/fill-progress.js';
import type { PlayerRecord, PlayerSession, ScenarioRow, ScenarioStore, SavedChoice } from '../src/application/scenario-ports.js';

/** In-memory scenario pool for blueprint tests. */
export class MemoryScenarioStore implements ScenarioStore {
  sessions = new Map<string, { tokenHash: string; playerId: string; scenarioId: string | null; play: PlayState | null }>();
  players = new Map<string, PlayerRecord>();
  scenarios = new Map<string, ScenarioRow>();
  choices = new Map<string, SavedChoice>();
  private listeners = new Set<(id: string) => void>();
  private lock: Promise<void> = Promise.resolve();
  private notify(id: string) { for (const listener of this.listeners) listener(id); }
  async insertPlayer(id: string, subject: string | null) { this.players.set(id, { id, subject }); }
  async player(id: string): Promise<PlayerRecord | null> { return this.players.get(id) ?? null; }
  async upsertPlayer(id: string, subject: string) {
    const existing = [...this.players.values()].find(player => player.subject === subject);
    if (existing) return existing.id;
    this.players.set(id, { id, subject });
    return id;
  }
  async createSession(id: string, tokenHash: string, playerId: string) { this.sessions.set(id, { tokenHash, playerId, scenarioId: null, play: null }); }
  async sessionByHash(tokenHash: string): Promise<PlayerSession | null> {
    for (const [id, session] of this.sessions) if (session.tokenHash === tokenHash) return { id, playerId: session.playerId, scenarioId: session.scenarioId, play: session.play };
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
  private claimOpen(sessionId: string, blueprintId: string, status: 'ready' | 'filling') {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.scenarioId) return structuredClone(this.scenarios.get(session.scenarioId) ?? null);
    const found = [...this.scenarios.values()].find(row => row.status === status && row.sessionId === null && row.blueprintId === blueprintId);
    if (!found) return null;
    found.sessionId = sessionId;
    if (status === 'ready') found.status = 'claimed';
    session.scenarioId = found.id;
    return structuredClone(found);
  }
  async claimReady(sessionId: string, blueprintId: string) { return this.claimOpen(sessionId, blueprintId, 'ready'); }
  async claimFilling(sessionId: string, blueprintId: string) { return this.claimOpen(sessionId, blueprintId, 'filling'); }
  async insertFilling(id: string, blueprintId: string, prompt: string, sessionId: string | null) {
    this.scenarios.set(id, {
      id, blueprintId, status: 'filling', sessionId, runId: null, prompt, content: null, error: null,
      progress: queuedProgress(), updatedAt: new Date().toISOString(),
    });
  }
  async setRun(id: string, runId: string) { this.scenarios.get(id)!.runId = runId; }
  async setProgress(id: string, progress: FillProgress) {
    const row = this.scenarios.get(id);
    if (!row || row.status !== 'filling' || progress.percent < row.progress.percent) return;
    row.progress = structuredClone(progress);
    row.updatedAt = new Date().toISOString();
    this.notify(id);
  }
  async subscribe(id: string, signal: AbortSignal, emit: (progress: FillProgress) => void) {
    const send = () => {
      const row = this.scenarios.get(id);
      if (!row) return true;
      emit(structuredClone(row.progress));
      return row.status !== 'filling';
    };
    if (signal.aborted || send()) return;
    await new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.listeners.delete(listener);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const listener = (eventId: string) => { if (eventId === id && send()) finish(); };
      this.listeners.add(listener);
      signal.addEventListener('abort', finish, { once: true });
      if (send()) finish();
    });
  }
  async markReady(id: string, content: ScenarioFill) {
    const row = this.scenarios.get(id);
    if (!row || row.status !== 'filling') return false;
    row.content = content;
    row.status = row.sessionId ? 'claimed' : 'ready';
    row.error = null;
    row.progress = readyProgress(row.progress);
    row.updatedAt = new Date().toISOString();
    this.notify(id);
    return true;
  }
  async markFailed(id: string, error: string) {
    const row = this.scenarios.get(id);
    if (!row || row.status !== 'filling') return false;
    row.status = 'failed';
    row.error = error;
    row.progress = { ...row.progress, phase: 'failed', label: 'The case could not be prepared.' };
    row.updatedAt = new Date().toISOString();
    this.notify(id);
    return true;
  }
  async health() {}
  async scenario(id: string) { return structuredClone(this.scenarios.get(id) ?? null); }
  async poolDepth(blueprintId: string) {
    return [...this.scenarios.values()].filter(row => row.blueprintId === blueprintId && row.sessionId === null && (row.status === 'ready' || row.status === 'filling')).length;
  }
  async fillingCount(blueprintId: string) {
    return [...this.scenarios.values()].filter(row => row.blueprintId === blueprintId && row.status === 'filling').length;
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
    for (const row of this.scenarios.values()) if (row.status === 'filling' && row.updatedAt < beforeIso) {
      row.status = 'failed'; row.error = 'Fill timed out.';
      row.progress = { ...row.progress, phase: 'failed', label: 'The case could not be prepared.' };
      this.notify(row.id); count += 1;
    }
    return count;
  }
  async choice(sessionId: string, key: string) { return structuredClone(this.choices.get(`${sessionId}:${key}`) ?? null); }
  async saveChoice(sessionId: string, key: string, requestHash: string, response: GameView) {
    const id = `${sessionId}:${key}`;
    if (!this.choices.has(id)) this.choices.set(id, { requestHash, response });
  }
  async close() {}
}
