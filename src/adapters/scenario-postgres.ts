import pg from 'pg';
import type { GameView } from '../game/types.js';
import type { PlayState } from '../scenario/engine.js';
import type { ScenarioFill } from '../scenario/fill.js';
import type { PlayerSession, ScenarioRow, ScenarioStore, SavedChoice } from '../application/scenario-ports.js';

interface ScenarioRecord {
  id: string; blueprint_id: string; status: ScenarioRow['status']; session_id: string | null;
  run_id: string | null; prompt: string; content: ScenarioFill | null; error: string | null; updated_at: Date | string;
}

/** Stores filled scenarios and player sessions in Render Postgres. */
export class PostgresScenarioStore implements ScenarioStore {
  readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  }
  private row(record: ScenarioRecord): ScenarioRow {
    return {
      id: record.id, blueprintId: record.blueprint_id, status: record.status, sessionId: record.session_id,
      runId: record.run_id, prompt: record.prompt, content: record.content, error: record.error,
      updatedAt: new Date(record.updated_at).toISOString(),
    };
  }
  async createSession(id: string, tokenHash: string) {
    await this.pool.query('INSERT INTO player_sessions(id, token_hash) VALUES($1,$2)', [id, tokenHash]);
  }
  async sessionByHash(tokenHash: string): Promise<PlayerSession | null> {
    const record = (await this.pool.query('SELECT id, scenario_id, play FROM player_sessions WHERE token_hash=$1', [tokenHash])).rows[0];
    return record ? { id: record.id, scenarioId: record.scenario_id, play: record.play } : null;
  }
  async setSessionScenario(sessionId: string, scenarioId: string) {
    await this.pool.query('UPDATE player_sessions SET scenario_id=$2 WHERE id=$1', [sessionId, scenarioId]);
  }
  async savePlay(sessionId: string, play: PlayState) {
    await this.pool.query('UPDATE player_sessions SET play=$2 WHERE id=$1', [sessionId, play]);
  }
  async claimReady(sessionId: string, blueprintId: string): Promise<ScenarioRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = (await client.query(`UPDATE filled_scenarios SET status='claimed', session_id=$1, updated_at=now()
        WHERE id = (SELECT id FROM filled_scenarios WHERE status='ready' AND session_id IS NULL AND blueprint_id=$2
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [sessionId, blueprintId])).rows[0];
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
  async markReady(id: string, content: ScenarioFill) {
    await this.pool.query(`UPDATE filled_scenarios SET status=CASE WHEN session_id IS NULL THEN 'ready' ELSE 'claimed' END,
      content=$2, error=NULL, updated_at=now() WHERE id=$1`, [id, content]);
  }
  async markFailed(id: string, error: string) {
    await this.pool.query(`UPDATE filled_scenarios SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [id, error]);
  }
  async scenario(id: string) {
    const record = (await this.pool.query('SELECT * FROM filled_scenarios WHERE id=$1', [id])).rows[0];
    return record ? this.row(record) : null;
  }
  async poolDepth(blueprintId: string) {
    const count = (await this.pool.query(`SELECT count(*)::int AS depth FROM filled_scenarios
      WHERE blueprint_id=$1 AND session_id IS NULL AND status IN ('ready','filling')`, [blueprintId])).rows[0].depth;
    return count;
  }
  async expireStale(beforeIso: string) {
    const result = await this.pool.query(`UPDATE filled_scenarios SET status='failed', error='Fill timed out.', updated_at=now()
      WHERE status='filling' AND updated_at < $1`, [beforeIso]);
    return result.rowCount ?? 0;
  }
  async choice(sessionId: string, key: string): Promise<SavedChoice | null> {
    const record = (await this.pool.query('SELECT request_hash, response FROM scenario_choices WHERE session_id=$1 AND request_key=$2', [sessionId, key])).rows[0];
    return record ? { requestHash: record.request_hash, response: record.response } : null;
  }
  async saveChoice(sessionId: string, key: string, requestHash: string, response: GameView) {
    await this.pool.query(`INSERT INTO scenario_choices(session_id, request_key, request_hash, response) VALUES($1,$2,$3,$4)
      ON CONFLICT (session_id, request_key) DO NOTHING`, [sessionId, key, requestHash, response]);
  }
  async close() { await this.pool.end(); }
}
