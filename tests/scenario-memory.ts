import type { GameView } from '../src/game/types.js';
import type { PlayState } from '../src/scenario/engine.js';
import type { ScenarioFill } from '../src/scenario/fill.js';
import type { PlayerSession, ScenarioRow, ScenarioStore, SavedChoice } from '../src/application/scenario-ports.js';

/** In-memory scenario pool for blueprint tests. */
export class MemoryScenarioStore implements ScenarioStore {
  sessions = new Map<string, { tokenHash: string; scenarioId: string | null; play: PlayState | null }>();
  scenarios = new Map<string, ScenarioRow>();
  choices = new Map<string, SavedChoice>();
  async createSession(id: string, tokenHash: string) { this.sessions.set(id, { tokenHash, scenarioId: null, play: null }); }
  async sessionByHash(tokenHash: string): Promise<PlayerSession | null> {
    for (const [id, session] of this.sessions) if (session.tokenHash === tokenHash) return { id, scenarioId: session.scenarioId, play: session.play };
    return null;
  }
  async setSessionScenario(sessionId: string, scenarioId: string) { this.sessions.get(sessionId)!.scenarioId = scenarioId; }
  async savePlay(sessionId: string, play: PlayState) { this.sessions.get(sessionId)!.play = structuredClone(play); }
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
    const row = this.scenarios.get(id)!;
    row.content = content;
    row.status = row.sessionId ? 'claimed' : 'ready';
    row.error = null;
  }
  async markFailed(id: string, error: string) { const row = this.scenarios.get(id)!; row.status = 'failed'; row.error = error; }
  async scenario(id: string) { return structuredClone(this.scenarios.get(id) ?? null); }
  async poolDepth(blueprintId: string) {
    return [...this.scenarios.values()].filter(row => row.blueprintId === blueprintId && row.sessionId === null && (row.status === 'ready' || row.status === 'filling')).length;
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
