import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { AppError, conflict } from './errors.js';
import type { FillRunner, ScenarioAuthor, ScenarioStore } from './scenario-ports.js';
import { blueprintId, poolTarget, staleFillMs } from '../scenario/blueprint.js';
import { defaultScenarioPrompt } from '../scenario/default-prompt.js';
import { applyChoice, legalActions, openPlay, presentPlay } from '../scenario/engine.js';
import type { ActionId } from '../scenario/blueprint.js';
import type { GameView } from '../game/types.js';
import { publishFill } from './publish-fill.js';

export type SessionView = { status: 'preparing' | 'ready' | 'failed'; session_token: string; run_id: string | null; message: string | null; game: GameView | null };

/** Claims a filled scenario at sign-in and plays it from the blueprint. */
export class ScenarioService {
  constructor(private store: ScenarioStore, private author: ScenarioAuthor, private runner: FillRunner, private secret: string) {
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

  /** Creates a session and assigns a ready scenario, or starts a fill. */
  async signIn(): Promise<SessionView> {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    await this.store.createSession(id, this.hash(token));
    const claimed = await this.store.claimReady(id, blueprintId);
    if (claimed) {
      await this.store.setSessionScenario(id, claimed.id);
      void this.replenish().catch(() => undefined);
      return this.view(token, 'ready', null, null, null);
    }
    const scenarioId = randomUUID();
    await this.store.insertFilling(scenarioId, blueprintId, defaultScenarioPrompt, id);
    await this.store.setSessionScenario(id, scenarioId);
    try {
      const run = await this.runner.start({ scenarioId, prompt: defaultScenarioPrompt });
      await this.store.setRun(scenarioId, run.runId);
      if (this.runner.background) return this.view(token, 'preparing', run.runId, null, null);
    } catch (error) {
      const failed = await this.store.scenario(scenarioId);
      return this.view(token, 'failed', null, failed?.error ?? (error instanceof Error ? error.message : 'Fill failed'), null);
    }
    return this.view(token, 'ready', scenarioId, null, null);
  }

  async current(token: string): Promise<SessionView> {
    const player = await this.session(token);
    if (!player.scenarioId) return this.view(token, 'preparing', null, null, null);
    const scenario = await this.store.scenario(player.scenarioId);
    if (!scenario) throw new AppError(404, 'scenario_not_found', 'Scenario not found for this session.');
    if (scenario.status === 'failed') return this.view(token, 'failed', scenario.runId, scenario.error ?? 'The scenario could not be prepared.', null);
    if (!scenario.content) return this.view(token, 'preparing', scenario.runId, null, null);
    const game = player.play ? presentPlay(player.id, scenario.content, player.play) : null;
    return this.view(token, 'ready', scenario.runId, null, game);
  }

  /** Opens the assigned scenario. This does not call the model. */
  async begin(token: string): Promise<GameView> {
    const player = await this.session(token);
    const scenario = player.scenarioId ? await this.store.scenario(player.scenarioId) : null;
    if (!scenario?.content) throw new AppError(409, 'scenario_not_ready', 'The scenario is still being prepared.');
    if (player.play) return presentPlay(player.id, scenario.content, player.play);
    const play = openPlay(scenario.content);
    await this.store.savePlay(player.id, play);
    return presentPlay(player.id, scenario.content, play);
  }

  async choose(token: string, key: string, actionId: string, expectedVersion: number): Promise<GameView> {
    const player = await this.session(token);
    const requestHash = createHash('sha256').update(`${actionId}:${expectedVersion}`).digest('hex');
    const prior = await this.store.choice(player.id, key);
    if (prior) {
      if (prior.requestHash !== requestHash) throw conflict('idempotency_conflict', 'This request key was used with a different payload.');
      return prior.response;
    }
    const scenario = player.scenarioId ? await this.store.scenario(player.scenarioId) : null;
    if (!scenario?.content || !player.play) throw new AppError(409, 'scenario_not_ready', 'Begin the scenario before choosing a response.');
    if (player.play.version !== expectedVersion) throw conflict('stale_state', 'Another choice changed this scenario. Refresh before trying again.');
    if (!legalActions(player.play).includes(actionId as ActionId)) throw new AppError(422, 'invalid_request', 'That response is not available.');
    const next = applyChoice(player.play, scenario.content, actionId as ActionId);
    await this.store.savePlay(player.id, next);
    const response = presentPlay(player.id, scenario.content, next);
    await this.store.saveChoice(player.id, key, requestHash, response);
    return response;
  }

  /** Fills one blueprint and marks the scenario ready or failed. */
  async publish(scenarioId: string, prompt: string): Promise<void> {
    await publishFill(this.store, this.author, scenarioId, prompt);
  }

  /** Expires abandoned fills and starts replacements up to the pool target. */
  async replenish(): Promise<number> {
    await this.store.expireStale(new Date(Date.now() - staleFillMs).toISOString());
    let started = 0;
    while (await this.store.poolDepth(blueprintId) < poolTarget && started < poolTarget) {
      const id = randomUUID();
      await this.store.insertFilling(id, blueprintId, defaultScenarioPrompt, null);
      const run = await this.runner.start({ scenarioId: id, prompt: defaultScenarioPrompt });
      await this.store.setRun(id, run.runId);
      started += 1;
    }
    return started;
  }
}
