import pg from 'pg';
import { AppError, conflict } from '../application/errors.js';
import type { GameView } from '../game/types.js';
import type { PlayState } from '../scenario/engine.js';
import type { ScenarioFill } from '../scenario/fill.js';
import { asProgress, readyProgress, type FillProgress } from '../application/fill-progress.js';
import type { PlayerRecord, PlayerSession, ScenarioRow, ScenarioStore, SavedChoice } from '../application/scenario-ports.js';
import { listenProgress } from './scenario-listen.js';

interface ScenarioRecord {
  id: string; blueprint_id: string; status: ScenarioRow['status']; session_id: string | null;
  run_id: string | null; prompt: string; content: ScenarioFill | null; error: string | null;
  progress: unknown; updated_at: Date | string;
}

/** Stores filled scenarios and player sessions in Render Postgres. */
export class PostgresScenarioStore implements ScenarioStore {
  readonly pool: pg.Pool;
  private readonly ownsPool: boolean;
  constructor(private connectionString: string, pool?: pg.Pool) {
    this.ownsPool = !pool;
    this.pool = pool ?? new pg.Pool({ connectionString, max: 20, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  }
  private row(record: ScenarioRecord): ScenarioRow {
    return {
      id: record.id, blueprintId: record.blueprint_id, status: record.status, sessionId: record.session_id,
      runId: record.run_id, prompt: record.prompt, content: record.content, error: record.error,
      progress: asProgress(record.progress), updatedAt: new Date(record.updated_at).toISOString(),
    };
  }
  async insertPlayer(id: string, subject: string | null) {
    await this.pool.query('INSERT INTO players(id, subject) VALUES($1,$2)', [id, subject]);
  }
  async player(id: string): Promise<PlayerRecord | null> {
    const record = (await this.pool.query('SELECT id, subject FROM players WHERE id=$1', [id])).rows[0];
    return record ? { id: record.id, subject: record.subject } : null;
  }
  async upsertPlayer(id: string, subject: string) {
    const record = (await this.pool.query(`INSERT INTO players(id, subject) VALUES($1,$2)
      ON CONFLICT (subject) DO UPDATE SET subject=EXCLUDED.subject RETURNING id`, [id, subject])).rows[0];
    return record.id as string;
  }
  async createSession(id: string, tokenHash: string, playerId: string) {
    await this.pool.query('INSERT INTO player_sessions(id, token_hash, player_id) VALUES($1,$2,$3)', [id, tokenHash, playerId]);
  }
  async sessionByHash(tokenHash: string): Promise<PlayerSession | null> {
    const record = (await this.pool.query('SELECT id, player_id, scenario_id, play FROM player_sessions WHERE token_hash=$1', [tokenHash])).rows[0];
    return record ? { id: record.id, playerId: record.player_id, scenarioId: record.scenario_id, play: record.play } : null;
  }
  async setSessionScenario(sessionId: string, scenarioId: string) {
    await this.pool.query('UPDATE player_sessions SET scenario_id=$2 WHERE id=$1', [sessionId, scenarioId]);
  }
  async savePlay(sessionId: string, play: PlayState) {
    await this.pool.query('UPDATE player_sessions SET play=$2 WHERE id=$1', [sessionId, play]);
  }
  async commitChoice(sessionId: string, key: string, requestHash: string, apply: (play: PlayState) => Promise<{ play: PlayState; response: GameView }> | { play: PlayState; response: GameView }) {
    const client = await this.pool.connect();
    let open = true;
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT play FROM player_sessions WHERE id=$1 FOR UPDATE', [sessionId])).rows[0];
      const prior = (await client.query('SELECT request_hash, response FROM scenario_choices WHERE session_id=$1 AND request_key=$2', [sessionId, key])).rows[0];
      if (prior) {
        await client.query('COMMIT');
        open = false;
        if (prior.request_hash !== requestHash) throw conflict('idempotency_conflict', 'This request key was used with a different payload.');
        return prior.response as GameView;
      }
      if (!row?.play) throw new AppError(409, 'scenario_not_ready', 'Begin the scenario before choosing a response.');
      const result = await apply(row.play as PlayState);
      const updated = await client.query('UPDATE player_sessions SET play=$2 WHERE id=$1 AND play->>\'version\' = $3', [sessionId, result.play, String(row.play.version)]);
      if (updated.rowCount !== 1) throw conflict('stale_state', 'Another choice changed this scenario. Refresh before trying again.');
      await client.query('INSERT INTO scenario_choices(session_id, request_key, request_hash, response) VALUES($1,$2,$3,$4)', [sessionId, key, requestHash, result.response]);
      await client.query('COMMIT');
      open = false;
      return result.response;
    } catch (error) {
      if (open) await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async deleteSession(sessionId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM scenario_choices WHERE session_id=$1', [sessionId]);
      await client.query('UPDATE filled_scenarios SET session_id=NULL WHERE session_id=$1', [sessionId]);
      await client.query('DELETE FROM player_sessions WHERE id=$1', [sessionId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async claimReady(sessionId: string, blueprintId: string) { return this.claimOpen(sessionId, blueprintId, 'ready'); }
  async claimFilling(sessionId: string, blueprintId: string) { return this.claimOpen(sessionId, blueprintId, 'filling'); }
  private async claimOpen(sessionId: string, blueprintId: string, status: 'ready' | 'filling'): Promise<ScenarioRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = (await client.query('SELECT scenario_id FROM player_sessions WHERE id=$1 FOR UPDATE', [sessionId])).rows[0];
      if (session?.scenario_id) {
        const existing = (await client.query('SELECT * FROM filled_scenarios WHERE id=$1', [session.scenario_id])).rows[0];
        await client.query('COMMIT');
        return existing ? this.row(existing) : null;
      }
      const claimed = (await client.query(`UPDATE filled_scenarios SET session_id=$1, updated_at=now(),
        status=CASE WHEN $3='ready' THEN 'claimed' ELSE status END
        WHERE id=(SELECT id FROM filled_scenarios WHERE status=$3 AND session_id IS NULL AND blueprint_id=$2
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [sessionId, blueprintId, status])).rows[0];
      if (claimed) await client.query('UPDATE player_sessions SET scenario_id=$2 WHERE id=$1 AND scenario_id IS NULL', [sessionId, claimed.id]);
      await client.query('COMMIT');
      return claimed ? this.row(claimed) : null;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async insertFilling(id: string, blueprintId: string, prompt: string, sessionId: string | null) {
    await this.pool.query(`INSERT INTO filled_scenarios(id, blueprint_id, status, prompt, session_id) VALUES($1,$2,'filling',$3,$4)`,
      [id, blueprintId, prompt, sessionId]);
  }
  async setRun(id: string, runId: string) {
    await this.pool.query('UPDATE filled_scenarios SET run_id=$2, updated_at=now() WHERE id=$1', [id, runId]);
  }
  async setProgress(id: string, progress: FillProgress) {
    const updated = await this.pool.query(`UPDATE filled_scenarios SET progress=$2, updated_at=now()
      WHERE id=$1 AND status='filling' AND COALESCE((progress->>'percent')::int, 0) <= $3`, [id, progress, progress.percent]);
    if (updated.rowCount === 1) await this.notify(id);
  }
  async subscribe(id: string, signal: AbortSignal, emit: (progress: FillProgress) => void) {
    await listenProgress(this.connectionString, id, signal, async () => {
      const row = await this.scenario(id);
      if (!row) return true;
      emit(row.progress);
      return row.status !== 'filling';
    });
  }
  private async notify(id: string) {
    await this.pool.query(`SELECT pg_notify('scenario_progress', $1)`, [id]);
  }
  async markReady(id: string, content: ScenarioFill) {
    const updated = await this.pool.query(`UPDATE filled_scenarios SET status=CASE WHEN session_id IS NULL THEN 'ready' ELSE 'claimed' END,
      content=$2, error=NULL, progress=progress || $3::jsonb, updated_at=now() WHERE id=$1 AND status='filling'`,
      [id, content, JSON.stringify({ phase: 'ready', percent: 100, label: readyProgress().label })]);
    if (updated.rowCount === 1) await this.notify(id);
    return updated.rowCount === 1;
  }
  async markFailed(id: string, error: string) {
    const updated = await this.pool.query(`UPDATE filled_scenarios SET status='failed', error=$2,
      progress=jsonb_set(jsonb_set(progress, '{phase}', '"failed"'), '{label}', to_jsonb($3::text)), updated_at=now()
      WHERE id=$1 AND status='filling'`, [id, error, 'The case could not be prepared.']);
    if (updated.rowCount === 1) await this.notify(id);
    return updated.rowCount === 1;
  }
  async health() { await this.pool.query('SELECT 1 FROM filled_scenarios LIMIT 1'); }
  async scenario(id: string) {
    const record = (await this.pool.query('SELECT * FROM filled_scenarios WHERE id=$1', [id])).rows[0];
    return record ? this.row(record) : null;
  }
  async fillingCount(blueprintId: string) {
    const count = (await this.pool.query(`SELECT count(*)::int AS depth FROM filled_scenarios
      WHERE blueprint_id=$1 AND status='filling'`, [blueprintId])).rows[0].depth;
    return count;
  }
  async poolDepth(blueprintId: string) {
    const count = (await this.pool.query(`SELECT count(*)::int AS depth FROM filled_scenarios
      WHERE blueprint_id=$1 AND session_id IS NULL AND status IN ('ready','filling')`, [blueprintId])).rows[0].depth;
    return count;
  }
  async expireStale(beforeIso: string) {
    const result = await this.pool.query(`UPDATE filled_scenarios SET status='failed', error='Fill timed out.',
      progress=jsonb_set(jsonb_set(progress, '{phase}', '"failed"'), '{label}', to_jsonb('The case could not be prepared.'::text)),
      updated_at=now() WHERE status='filling' AND updated_at < $1 RETURNING id`, [beforeIso]);
    for (const row of result.rows) await this.notify(row.id);
    return result.rowCount ?? 0;
  }
  async withPoolLock<T>(work: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['scenario-pool']);
      const result = await work();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async choice(sessionId: string, key: string): Promise<SavedChoice | null> {
    const record = (await this.pool.query('SELECT request_hash, response FROM scenario_choices WHERE session_id=$1 AND request_key=$2', [sessionId, key])).rows[0];
    return record ? { requestHash: record.request_hash, response: record.response } : null;
  }
  async saveChoice(sessionId: string, key: string, requestHash: string, response: GameView) {
    await this.pool.query(`INSERT INTO scenario_choices(session_id, request_key, request_hash, response) VALUES($1,$2,$3,$4)
      ON CONFLICT (session_id, request_key) DO NOTHING`, [sessionId, key, requestHash, response]);
  }
  async close() { if (this.ownsPool) await this.pool.end(); }
}
