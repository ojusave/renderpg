import pg from 'pg';
import type { PoolClient } from 'pg';
import type { GameRecord, GameView } from '../game/types.js';
import type { Creation, GameRepository, GenerationJob, SavedTurn } from '../application/ports.js';
import { conflict } from '../application/errors.js';

export class PostgresRepository implements GameRepository {
  readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
    this.pool.on('error', () => console.error('Postgres idle connection failed'));
  }
  async creation(key: string): Promise<Creation | null> {
    const row = (await this.pool.query('SELECT request_hash, initial_record, opening FROM games WHERE creation_key=$1', [key])).rows[0];
    return row ? { requestHash: row.request_hash, game: row.initial_record, opening: row.opening } : null;
  }
  async create(key: string, requestHash: string, prompt: { id: string; content: string; contentHash: string },
    adventure: { id: string; variationSeed: string; validation: unknown }, game: GameRecord, opening: GameView): Promise<Creation> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      const existing = await client.query('SELECT request_hash, initial_record, opening FROM games WHERE creation_key=$1', [key]);
      if (!existing.rows[0]) {
        await client.query('INSERT INTO scenario_prompts(id,content,content_hash) VALUES($1,$2,$3)',
          [prompt.id, prompt.content, prompt.contentHash]);
        await client.query(`INSERT INTO adventures(id,scenario_prompt_id,variation_seed,schema_version,definition,validation)
          VALUES($1,$2,$3,2,$4,$5)`, [adventure.id, prompt.id, adventure.variationSeed, game.definition, adventure.validation]);
        await client.query(`INSERT INTO games(id,adventure_id,creation_key,request_hash,version,record,initial_record,opening)
          VALUES($1,$2,$3,$4,$5,$6,$6,$7)`, [game.id, adventure.id, key, requestHash, game.version, game, opening]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return (await this.creation(key))!;
  }
  async get(id: string): Promise<GameRecord | null> {
    return (await this.pool.query('SELECT record FROM games WHERE id=$1', [id])).rows[0]?.record ?? null;
  }
  async turn(id: string, key: string): Promise<SavedTurn | null> {
    return this.readTurn(this.pool, id, key);
  }
  private async readTurn(client: Pick<PoolClient, 'query'> | pg.Pool, id: string, key: string): Promise<SavedTurn | null> {
    const row = (await client.query('SELECT request_hash, response FROM turn_requests WHERE game_id=$1 AND request_key=$2', [id, key])).rows[0];
    return row ? { requestHash: row.request_hash, response: row.response } : null;
  }
  async commit(id: string, expectedVersion: number, key: string, requestHash: string, next: GameRecord, response: GameView): Promise<SavedTurn> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT version FROM games WHERE id=$1 FOR UPDATE', [id])).rows[0];
      const prior = await this.readTurn(client, id, key);
      if (prior) { await client.query('COMMIT'); return prior; }
      if (!row || row.version !== expectedVersion) throw conflict('stale_state', 'Another command changed this game. Refresh before trying again.');
      await client.query('UPDATE games SET version=$2, record=$3, updated_at=now() WHERE id=$1', [id, next.version, next]);
      await client.query('INSERT INTO turn_requests(game_id,request_key,request_hash,response) VALUES($1,$2,$3,$4)', [id, key, requestHash, response]);
      await client.query('COMMIT');
      return { requestHash, response };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async locked<T>(key: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`generation:${key}`]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private job(row: { creation_key: string; request_hash: string; run_id: string; status: GenerationJob['status']; error: string | null; updated_at: Date | string }, created: boolean): GenerationJob & { created: boolean } {
    return { key: row.creation_key, requestHash: row.request_hash, runId: row.run_id, status: row.status, error: row.error, updatedAt: new Date(row.updated_at).toISOString(), created };
  }
  async reserveGeneration(key: string, requestHash: string, runId: string) {
    return this.locked(key, async client => {
      const existing = (await client.query('SELECT creation_key, request_hash, run_id, status, error, updated_at FROM generation_jobs WHERE creation_key=$1', [key])).rows[0];
      if (existing) {
        if (existing.request_hash !== requestHash) throw conflict('idempotency_conflict', 'This key belongs to another request.');
        return this.job(existing, false);
      }
      const inserted = (await client.query(`INSERT INTO generation_jobs(creation_key, request_hash, run_id, status)
        VALUES($1,$2,$3,'running') RETURNING creation_key, request_hash, run_id, status, error, updated_at`, [key, requestHash, runId])).rows[0];
      return this.job(inserted, true);
    });
  }
  async generationByKey(key: string) {
    const row = (await this.pool.query('SELECT creation_key, request_hash, run_id, status, error, updated_at FROM generation_jobs WHERE creation_key=$1', [key])).rows[0];
    return row ? this.job(row, false) : null;
  }
  async generationByRun(runId: string) {
    const row = (await this.pool.query('SELECT creation_key, request_hash, run_id, status, error, updated_at FROM generation_jobs WHERE run_id=$1', [runId])).rows[0];
    return row ? this.job(row, false) : null;
  }
  async reclaimGeneration(key: string) {
    return this.locked(key, async client => {
      const updated = await client.query(`UPDATE generation_jobs SET status='running', error=NULL, updated_at=now()
        WHERE creation_key=$1 AND status='failed'`, [key]);
      return updated.rowCount === 1;
    });
  }
  async setGenerationRun(key: string, runId: string) {
    await this.pool.query('UPDATE generation_jobs SET run_id=$2, updated_at=now() WHERE creation_key=$1', [key, runId]);
  }
  async markGeneration(key: string, status: GenerationJob['status'], error?: string) {
    await this.pool.query('UPDATE generation_jobs SET status=$2, error=$3, updated_at=now() WHERE creation_key=$1', [key, status, error ?? null]);
  }
  async health(): Promise<void> { await this.pool.query('SELECT 1'); }
  async close(): Promise<void> { await this.pool.end(); }
}
