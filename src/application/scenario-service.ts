import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { AppError, conflict, unavailable } from './errors.js';
import type { FillRunner, PoolScheduler, ScenarioAuthor, ScenarioPromptSource, ScenarioStore, TaskRunSource } from './scenario-ports.js';
import { resolvePlayer } from './players.js';
import { reservePlayerFill, reservePoolFills } from './reserve-pool.js';
import { blueprintId } from '../scenario/blueprint.js';
import { defaultScenarioPrompt } from '../scenario/default-prompt.js';
import { applyChoice, legalActions, openPlay, presentPlay } from '../scenario/engine.js';
import type { ActionId } from '../scenario/blueprint.js';
import type { GameView } from '../game/types.js';
import { publishFill } from './publish-fill.js';
import { listSandboxVersions, previewSavedForks } from './fork-session.js';
import type { ForkSimulator } from './scenario-ports.js';
import { InlineForkSimulator } from '../sandbox/inline.js';
import { progressJson, queuedProgress, readyProgress, type FillProgress, type ProgressJson } from './fill-progress.js';
import { watchFill } from './watch-progress.js';

const retiredMessage = 'This case was made by an earlier version of the game. Start a new case.';

export type SessionView = {
  status: 'preparing' | 'ready' | 'failed'; session_token: string; player_id: string; game_id: string; game_url: string;
  run_id: string | null; message: string | null; game: GameView | null; progress: ProgressJson;
};

/** Claims a filled scenario at sign-in and plays it from the blueprint. */
export class ScenarioService {
  private replenishAt = 0;
  private replenishInflight: Promise<unknown> | null = null;
  private startedAt = new Date().toISOString();
  constructor(private store: ScenarioStore, private author: ScenarioAuthor, private runner: FillRunner, private secret: string, private prompts: ScenarioPromptSource | null = null, private scheduler?: PoolScheduler, private runs?: TaskRunSource, private forks: ForkSimulator = new InlineForkSimulator()) {
    if (secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  }

  private hash(token: string) { return createHmac('sha256', this.secret).update(token).digest('hex'); }

  private async session(token: string, gameId?: string) {
    const found = await this.store.sessionByHash(this.hash(token));
    if (!found) throw new AppError(401, 'unauthorized', 'A valid session bearer token is required.');
    if (gameId && found.id !== gameId) throw new AppError(404, 'game_not_found', 'This game URL does not match the session token.');
    return found;
  }

  private view(token: string, gameId: string, playerId: string, status: SessionView['status'], runId: string | null, message: string | null, game: GameView | null, progress: FillProgress): SessionView {
    return {
      status, session_token: token, player_id: playerId, game_id: gameId, game_url: `/sessions/${gameId}`,
      run_id: runId, message, game, progress: progressJson(progress, null),
    };
  }

  private shown(progress: FillProgress | undefined, done: boolean): FillProgress {
    if (!progress) return done ? readyProgress() : queuedProgress();
    return done ? readyProgress(progress) : progress;
  }

  /** Creates a game URL for an SSO user or a generated anonymous player. */
  async signIn(input: { subject?: string | null; playerId?: string | null } = {}): Promise<SessionView> {
    const playerId = await resolvePlayer(this.store, input);
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    await this.store.createSession(id, this.hash(token), playerId);
    const claimed = await this.store.claimReady(id, blueprintId);
    if (claimed) {
      await this.store.setSessionScenario(id, claimed.id);
      this.kickPool();
      return this.view(token, id, playerId, 'ready', null, null, null, this.shown(claimed.progress, true));
    }
    const inflight = await this.store.claimFilling(id, blueprintId);
    if (inflight) {
      await this.store.setSessionScenario(id, inflight.id);
      this.kickPool();
      return this.view(token, id, playerId, 'preparing', inflight.runId, null, null, inflight.progress);
    }
    const prompt = await this.sourcePrompt();
    if (!prompt) {
      await this.store.deleteSession(id);
      throw conflict('no_new_cases', 'There are no new cases right now. New ones appear as new Slack conversations come in.');
    }
    const scenarioId = await reservePlayerFill(this.store, id, prompt);
    if (!scenarioId && await this.store.promptInUse(blueprintId, prompt)) {
      await this.store.deleteSession(id);
      throw conflict('no_new_cases', 'There are no new cases right now. New ones appear as new Slack conversations come in.');
    }
    if (!scenarioId) {
      this.kickPool();
      return this.view(token, id, playerId, 'preparing', null, null, null, queuedProgress());
    }
    let runId: string | null = null;
    try {
      const run = await this.runner.start({ scenarioId, prompt });
      runId = run.runId;
      await this.store.setRun(scenarioId, run.runId);
      this.kickPool();
      if (this.runner.background) return this.view(token, id, playerId, 'preparing', run.runId, null, null, (await this.store.scenario(scenarioId))?.progress ?? queuedProgress());
    } catch (error) {
      this.kickPool();
      const failed = await this.store.scenario(scenarioId);
      return this.view(token, id, playerId, 'failed', null, failed?.error ?? (error instanceof Error ? error.message : 'Fill failed'), null, failed?.progress ?? queuedProgress());
    }
    return this.view(token, id, playerId, 'ready', runId, null, null, this.shown((await this.store.scenario(scenarioId))?.progress, true));
  }

  async current(token: string, gameId?: string): Promise<SessionView> {
    const player = await this.session(token, gameId);
    if (!player.scenarioId) {
      const claimed = await this.store.claimReady(player.id, blueprintId) ?? await this.store.claimFilling(player.id, blueprintId);
      if (!claimed) {
        this.kickPool();
        return this.view(token, player.id, player.playerId, 'preparing', null, null, null, queuedProgress());
      }
      await this.store.setSessionScenario(player.id, claimed.id);
      player.scenarioId = claimed.id;
    }
    const scenario = await this.store.scenario(player.scenarioId);
    if (!scenario) throw new AppError(404, 'scenario_not_found', 'Scenario not found for this session.');
    if (scenario.status === 'failed') return this.view(token, player.id, player.playerId, 'failed', scenario.runId, scenario.error ?? 'The scenario could not be prepared.', null, scenario.progress);
    if (scenario.blueprintId !== blueprintId) return this.view(token, player.id, player.playerId, 'failed', scenario.runId, retiredMessage, null, scenario.progress);
    if (!scenario.content) return this.view(token, player.id, player.playerId, 'preparing', scenario.runId, null, null, scenario.progress);
    const game = player.play ? presentPlay(player.id, scenario.content, player.play) : null;
    return this.view(token, player.id, player.playerId, 'ready', scenario.runId, null, game, this.shown(scenario.progress, true));
  }

  /** Streams checkpoint progress until this session's fill finishes. */
  async watch(token: string, signal: AbortSignal, emit: (progress: ProgressJson) => void, gameId?: string): Promise<void> {
    const player = await this.session(token, gameId);
    if (!player.scenarioId) { emit(progressJson(queuedProgress(), null)); return; }
    const scenario = await this.store.scenario(player.scenarioId);
    if (!scenario) throw new AppError(404, 'scenario_not_found', 'Scenario not found for this session.');
    await watchFill(this.store, scenario.id, scenario.runId, this.runs, signal, emit);
  }

  /** Opens the assigned scenario. This does not call the model. */
  async begin(token: string, gameId?: string): Promise<GameView> {
    const player = await this.session(token, gameId);
    const scenario = player.scenarioId ? await this.store.scenario(player.scenarioId) : null;
    if (scenario && scenario.blueprintId !== blueprintId) throw conflict('scenario_retired', retiredMessage);
    if (!scenario?.content) throw new AppError(409, 'scenario_not_ready', 'The scenario is still being prepared.');
    if (player.play) return presentPlay(player.id, scenario.content, player.play);
    const play = openPlay(scenario.content);
    await this.store.savePlay(player.id, play);
    return presentPlay(player.id, scenario.content, play);
  }

  async choose(token: string, key: string, actionId: string, expectedVersion: number, gameId?: string): Promise<GameView> {
    const player = await this.session(token, gameId);
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

  /** Lists sandbox versions the player can use for a preview. */
  async sandboxVersions(token: string, gameId?: string) {
    await this.session(token, gameId);
    return listSandboxVersions(this.forks);
  }

  /** Shows the outcome of every current choice without saving any of them. */
  async previewForks(token: string, version: string, gameId?: string) {
    const player = await this.session(token, gameId);
    return previewSavedForks(this.store, this.forks, player, version);
  }

  /** Revokes the bearer token and leaves its scenario out of the pool. */
  async end(token: string, gameId?: string): Promise<void> {
    const player = await this.session(token, gameId);
    await this.store.deleteSession(player.id);
  }

  /** Checks scenario storage and required workflow configuration. */
  async ready(): Promise<void> {
    await this.store.health();
    if ((process.env.WORKFLOW_MODE ?? 'inline') !== 'render') return;
    const missing = ['RENDER_API_KEY', 'SCENARIO_TASK', 'REPLENISH_TASK'].filter(key => !process.env[key]?.trim());
    if (missing.length) throw unavailable();
  }

  /** A new transcript, or the built-in story if no case uses it yet. Null when neither is left. */
  private async sourcePrompt(): Promise<string | null> {
    const prompt = await this.poolPrompt();
    if (prompt) return prompt;
    return await this.store.promptInUse(blueprintId, defaultScenarioPrompt) ? null : defaultScenarioPrompt;
  }

  /** Takes the next unused transcript. The built-in story is not copied to fill the pool. */
  private async poolPrompt(): Promise<string | null> {
    try {
      return (await this.prompts?.nextPrompt())?.trim() || null;
    } catch {
      return null;
    }
  }

  /** Fills one blueprint and marks the scenario ready or failed. */
  async publish(scenarioId: string, prompt: string): Promise<void> {
    await publishFill(this.store, this.author, scenarioId, prompt);
  }

  /** Expires abandoned fills and starts replacements up to the pool target. */
  async replenish(): Promise<number> {
    const jobs = await reservePoolFills(this.store, () => this.poolPrompt());
    const results = await Promise.allSettled(jobs.map(async job => {
      const run = await this.runner.start(job);
      await this.store.setRun(job.scenarioId, run.runId);
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    return jobs.length;
  }

  /** Restores the pool without delaying the caller. Render mode starts the parent workflow. */
  warm(): void {
    if (this.runner.background) { this.kickPool(); return; }
    void this.store.expireOrphans(this.startedAt)
      .catch(error => console.warn(JSON.stringify({ event: 'orphan_expiry_failed', message: error instanceof Error ? error.message : 'unknown' })))
      .finally(() => this.kickPool());
  }

  /** Restores the pool without delaying the sign-in response. A burst shares one attempt. */
  private kickPool(): void {
    const now = Date.now();
    if (this.replenishInflight || now - this.replenishAt < 1000) return;
    this.replenishAt = now;
    const job = this.scheduler ? this.scheduler.schedule() : this.replenish();
    this.replenishInflight = job.finally(() => { this.replenishInflight = null; });
    void this.replenishInflight.catch(error => {
      console.warn(JSON.stringify({ event: 'pool_replenish_failed', message: error instanceof Error ? error.message : 'unknown' }));
    });
  }
}
