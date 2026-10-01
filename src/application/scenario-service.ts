import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { AppError, conflict, unavailable } from './errors.js';
import type { FillRunner, PoolScheduler, ScenarioAuthor, ScenarioPromptSource, ScenarioStore } from './scenario-ports.js';
import { reservePoolFills } from './reserve-pool.js';
import { blueprintId } from '../scenario/blueprint.js';
import { defaultScenarioPrompt } from '../scenario/default-prompt.js';
import { applyChoice, legalActions, openPlay, presentPlay } from '../scenario/engine.js';
import type { ActionId } from '../scenario/blueprint.js';
import type { GameView } from '../game/types.js';
import { publishFill } from './publish-fill.js';

const retiredMessage = 'This case was made by an earlier version of the game. Start a new case.';

export type SessionView = { status: 'preparing' | 'ready' | 'failed'; session_token: string; run_id: string | null; message: string | null; game: GameView | null };

/** Claims a filled scenario at sign-in and plays it from the blueprint. */
export class ScenarioService {
  constructor(private store: ScenarioStore, private author: ScenarioAuthor, private runner: FillRunner, private secret: string, private prompts: ScenarioPromptSource | null = null, private scheduler?: PoolScheduler) {
    if (secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  }

  private hash(token: string) { return createHmac('sha256', this.secret).update(token).digest('hex'); }

  private async session(token: string) {
    const found = await this.store.sessionByHash(this.hash(token));
    if (!found) throw new AppError(401, 'unauthorized', 'A valid session bearer token is required.');
    return found;
  }

  private view(token: string, status: SessionView['status'], runId: string | null, message: string | null, game: GameView | null): SessionView {
    return { status, session_token: token, run_id: runId, message, game };
  }

  /** Claims a ready case, or one already being written, before starting another fill. */
  private async claimSoon(sessionId: string) {
    const ready = await this.store.claimReady(sessionId, blueprintId);
    if (ready || await this.store.poolDepth(blueprintId) === 0) return ready;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const found = await this.store.claimReady(sessionId, blueprintId);
      if (found || await this.store.poolDepth(blueprintId) === 0) return found;
    }
    return null;
  }

  /** Creates a session and assigns a ready scenario, or starts a fill. */
  async signIn(): Promise<SessionView> {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    await this.store.createSession(id, this.hash(token));
    const claimed = await this.claimSoon(id);
    if (claimed) {
      await this.store.setSessionScenario(id, claimed.id);
      this.kickPool();
      return this.view(token, 'ready', null, null, null);
    }
    const scenarioId = randomUUID();
    const prompt = await this.sourcePrompt();
    await this.store.insertFilling(scenarioId, blueprintId, prompt, id);
    await this.store.setSessionScenario(id, scenarioId);
    let runId: string | null = null;
    try {
      const run = await this.runner.start({ scenarioId, prompt });
      runId = run.runId;
      await this.store.setRun(scenarioId, run.runId);
      if (this.scheduler?.background) this.kickPool();
      if (this.runner.background) return this.view(token, 'preparing', run.runId, null, null);
    } catch (error) {
      if (this.scheduler?.background) this.kickPool();
      const failed = await this.store.scenario(scenarioId);
      return this.view(token, 'failed', null, failed?.error ?? (error instanceof Error ? error.message : 'Fill failed'), null);
    }
    return this.view(token, 'ready', runId, null, null);
  }

  async current(token: string): Promise<SessionView> {
    const player = await this.session(token);
    if (!player.scenarioId) return this.view(token, 'preparing', null, null, null);
    const scenario = await this.store.scenario(player.scenarioId);
    if (!scenario) throw new AppError(404, 'scenario_not_found', 'Scenario not found for this session.');
    if (scenario.status === 'failed') return this.view(token, 'failed', scenario.runId, scenario.error ?? 'The scenario could not be prepared.', null);
    if (scenario.blueprintId !== blueprintId) return this.view(token, 'failed', scenario.runId, retiredMessage, null);
    if (!scenario.content) return this.view(token, 'preparing', scenario.runId, null, null);
    const game = player.play ? presentPlay(player.id, scenario.content, player.play) : null;
    return this.view(token, 'ready', scenario.runId, null, game);
  }

  /** Opens the assigned scenario. This does not call the model. */
  async begin(token: string): Promise<GameView> {
    const player = await this.session(token);
    const scenario = player.scenarioId ? await this.store.scenario(player.scenarioId) : null;
    if (scenario && scenario.blueprintId !== blueprintId) throw conflict('scenario_retired', retiredMessage);
    if (!scenario?.content) throw new AppError(409, 'scenario_not_ready', 'The scenario is still being prepared.');
    if (player.play) return presentPlay(player.id, scenario.content, player.play);
    const play = openPlay(scenario.content);
    await this.store.savePlay(player.id, play);
    return presentPlay(player.id, scenario.content, play);
  }

  async choose(token: string, key: string, actionId: string, expectedVersion: number): Promise<GameView> {
    const player = await this.session(token);
    const requestHash = createHash('sha256').update(`${actionId}:${expectedVersion}`).digest('hex');
    return this.store.commitChoice(player.id, key, requestHash, async play => {
      if (play.version !== expectedVersion) throw conflict('stale_state', 'Another choice changed this scenario. Refresh before trying again.');
      if (play.status === 'completed') throw conflict('game_finished', 'This scenario has ended. Start a new session.');
      const scenario = player.scenarioId ? await this.store.scenario(player.scenarioId) : null;
      if (scenario && scenario.blueprintId !== blueprintId) throw conflict('scenario_retired', retiredMessage);
      if (!scenario?.content) throw new AppError(409, 'scenario_not_ready', 'Begin the scenario before choosing a response.');
      if (!legalActions(play).includes(actionId as ActionId)) throw new AppError(422, 'invalid_request', 'That response is not available.');
      const next = applyChoice(play, scenario.content, actionId as ActionId);
      return { play: next, response: presentPlay(player.id, scenario.content, next) };
    });
  }

  /** Revokes the bearer token and leaves its scenario out of the pool. */
  async end(token: string): Promise<void> {
    const player = await this.session(token);
    await this.store.deleteSession(player.id);
  }

  /** Checks scenario storage and required workflow configuration. */
  async ready(): Promise<void> {
    await this.store.health();
    if ((process.env.WORKFLOW_MODE ?? 'inline') !== 'render') return;
    const missing = ['RENDER_API_KEY', 'SCENARIO_TASK', 'REPLENISH_TASK'].filter(key => !process.env[key]?.trim());
    if (missing.length) throw unavailable();
  }

  private async sourcePrompt(): Promise<string> {
    try {
      const prompt = (await this.prompts?.nextPrompt())?.trim();
      if (prompt) return prompt;
    } catch {
      return defaultScenarioPrompt;
    }
    return defaultScenarioPrompt;
  }

  /** Fills one blueprint and marks the scenario ready or failed. */
  async publish(scenarioId: string, prompt: string): Promise<void> {
    await publishFill(this.store, this.author, scenarioId, prompt);
  }

  /** Expires abandoned fills and starts replacements up to the pool target. */
  async replenish(): Promise<number> {
    const jobs = await reservePoolFills(this.store, () => this.sourcePrompt());
    for (const job of jobs) {
      const run = await this.runner.start(job);
      await this.store.setRun(job.scenarioId, run.runId);
    }
    return jobs.length;
  }

  /** Restores the pool without delaying the caller. Render mode starts the parent workflow. */
  warm(): void { this.kickPool(); }

  /** Restores the pool without delaying the sign-in response. */
  private kickPool(): void {
    const job = this.scheduler ? this.scheduler.schedule() : this.replenish();
    void job.catch(error => {
      console.warn(JSON.stringify({ event: 'pool_replenish_failed', message: error instanceof Error ? error.message : 'unknown' }));
    });
  }
}
