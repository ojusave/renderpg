import type { Creation, GameRepository, GenerationJob, SavedTurn } from '../src/application/ports.js';
import type { GameRecord, GameView } from '../src/game/types.js';
import { conflict } from '../src/application/errors.js';

export class MemoryRepository implements GameRepository {
  games = new Map<string, GameRecord>();
  creations = new Map<string, Creation>();
  turns = new Map<string, SavedTurn>();
  jobs = new Map<string, GenerationJob>();
  private tails = new Map<string, Promise<void>>();
  private async lock<T>(key: string, work: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>(resolve => { release = resolve; });
    this.tails.set(key, previous.then(() => current));
    await previous;
    try { return await work(); } finally { release(); }
  }
  async creation(key: string) { return structuredClone(this.creations.get(key) ?? null); }
  async create(key: string, requestHash: string, _prompt: { id: string; content: string; contentHash: string },
    _adventure: { id: string; variationSeed: string; validation: unknown }, game: GameRecord, opening: GameView) {
    if (!this.creations.has(key)) { this.creations.set(key, structuredClone({ requestHash, game, opening })); this.games.set(game.id, structuredClone(game)); }
    return (await this.creation(key))!;
  }
  async get(id: string) { return structuredClone(this.games.get(id) ?? null); }
  async turn(id: string, key: string) { return structuredClone(this.turns.get(`${id}:${key}`) ?? null); }
  async commit(id: string, version: number, key: string, requestHash: string, next: GameRecord, response: GameView) {
    const prior = this.turns.get(`${id}:${key}`);
    if (prior) return structuredClone(prior);
    if (this.games.get(id)?.version !== version) throw conflict('stale_state', 'Stale state');
    this.games.set(id, structuredClone(next));
    const saved = { requestHash, response };
    this.turns.set(`${id}:${key}`, structuredClone(saved));
    return structuredClone(saved);
  }
  async reserveGeneration(key: string, requestHash: string, runId: string) {
    return this.lock(key, () => {
      const existing = this.jobs.get(key);
      if (existing) {
        if (existing.requestHash !== requestHash) throw conflict('idempotency_conflict', 'This key belongs to another request.');
        return { ...existing, created: false };
      }
      const job: GenerationJob = { key, requestHash, runId, status: 'running', error: null, updatedAt: new Date().toISOString() };
      this.jobs.set(key, job);
      return { ...job, created: true };
    });
  }
  async generationByKey(key: string) { return this.jobs.get(key) ?? null; }
  async generationByRun(runId: string) { return [...this.jobs.values()].find(job => job.runId === runId) ?? null; }
  async reclaimGeneration(key: string) {
    return this.lock(key, () => {
      const job = this.jobs.get(key);
      if (!job || job.status !== 'failed') return false;
      job.status = 'running';
      job.error = null;
      job.updatedAt = new Date().toISOString();
      return true;
    });
  }
  async setGenerationRun(key: string, runId: string) {
    const job = this.jobs.get(key);
    if (job) { job.runId = runId; job.updatedAt = new Date().toISOString(); }
  }
  async markGeneration(key: string, status: GenerationJob['status'], error?: string) {
    const job = this.jobs.get(key);
    if (job) { job.status = status; job.error = error ?? null; job.updatedAt = new Date().toISOString(); }
  }
  async health() {}
  async close() {}
}
