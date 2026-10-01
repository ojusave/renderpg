import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { InlineAdventureRunner } from '../adapters/inline-runner.js';
import { describe, resolveCommand, twoSentences } from '../game/engine.js';
import type { GameRecord, GameView } from '../game/types.js';
import { decisionTurns, visibleGame } from '../game/visibility.js';
import { turnBudget } from '../adventure/simulator.js';
import type { AdventureRunner, Creation, GameAI, GameRepository, GenerationInput, SavedTurn } from './ports.js';
import { AppError, conflict, unavailable } from './errors.js';

export type CreatedGame = { game: GameView; session_token: string };
export type RunningGeneration = { status: 'running'; run_id: string };

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function replay(saved: SavedTurn, requestHash: string): GameView {
  if (saved.requestHash !== requestHash) throw conflict('idempotency_conflict', 'This request key was used with a different payload.');
  return saved.response;
}

/** Ends a still-open adventure once the player has used the turn limit. */
function closeAtTurnLimit(game: GameRecord): void {
  const budget = turnBudget(game.definition);
  if (game.state.status !== 'active' || decisionTurns(game.definition, game.transcript) < budget) return;
  const ending = game.definition.endings.find(item => item.result === 'failure') ?? game.definition.endings[0];
  if (!ending) return;
  game.state = { ...game.state, status: 'completed', endingId: ending.id };
  const last = game.transcript[game.transcript.length - 1];
  if (!last) return;
  last.outcome = 'completed';
  last.text = `You used all ${budget} decisions before resolving the case, so the investigation is now closed.`;
}

export class GameService {
  private runner: AdventureRunner;
  get capabilities() { return this.ai.capabilities; }

  constructor(private repo: GameRepository, private ai: GameAI, private secret: string,
    private report: (event: string) => void = () => {}, runner?: AdventureRunner) {
    if (secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
    this.runner = runner ?? new InlineAdventureRunner(repo, ai, report);
  }

  private token(key: string, id: string): string {
    return createHmac('sha256', this.secret).update(`${key}:${id}`).digest('base64url');
  }

  private ready(key: string, creation: Creation): CreatedGame {
    return { game: creation.opening, session_token: this.token(key, creation.game.id) };
  }

  private async finished(key: string): Promise<CreatedGame | null> {
    const existing = await this.repo.creation(key);
    return existing ? this.ready(key, existing) : null;
  }

  private async waitUntilReady(key: string): Promise<CreatedGame> {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const done = await this.finished(key);
      if (done) return done;
      const job = await this.repo.generationByKey(key);
      if (job?.status === 'failed') throw unavailable();
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw unavailable();
  }

  private input(key: string, prompt: string, requestHash: string, runId: string): GenerationInput {
    const gameId = randomUUID();
    return {
      prompt, variationSeed: key, idempotencyKey: key, requestHash, runId, gameId,
      sourcePromptId: randomUUID(), adventureId: randomUUID(), tokenHash: hash(this.token(key, gameId)),
    };
  }

  /** Starts compilation. Inline mode returns the game; a background workflow returns a run id. */
  async create(key: string, prompt: string): Promise<CreatedGame | RunningGeneration> {
    const normalizedPrompt = prompt.trim();
    const requestHash = hash(JSON.stringify({ prompt: normalizedPrompt }));
    const existing = await this.repo.creation(key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw conflict('idempotency_conflict', 'This key belongs to another request.');
      return this.ready(key, existing);
    }
    if (!normalizedPrompt) throw new AppError(422, 'invalid_prompt', 'A scenario prompt is required.');
    const runId = randomUUID();
    const reserved = await this.repo.reserveGeneration(key, requestHash, runId);
    if (!reserved.created) {
      const done = await this.finished(key);
      if (done) return done;
      const running = this.runner.background
        ? { status: 'running' as const, run_id: reserved.runId }
        : this.waitUntilReady(key);
      if (reserved.status !== 'failed') return running;
      if (!await this.repo.reclaimGeneration(key)) return running;
    }
    try {
      const started = await this.runner.start(this.input(key, normalizedPrompt, requestHash, reserved.runId));
      if (started.runId !== reserved.runId) await this.repo.setGenerationRun(key, started.runId);
      const done = await this.finished(key);
      return done ?? { status: 'running', run_id: started.runId };
    } catch (error) {
      if (!(error instanceof AppError)) await this.repo.markGeneration(key, 'failed', error instanceof Error ? error.message : 'unknown');
      throw error instanceof AppError ? error : unavailable();
    }
  }

  /** Reads a generation started by create. The run id is the unguessable client credential. */
  async generation(runId: string): Promise<CreatedGame & { status: 'ready' } | RunningGeneration | { status: 'failed'; message: string }> {
    const job = await this.repo.generationByRun(runId);
    if (!job) throw new AppError(404, 'generation_not_found', 'Generation not found.');
    if (job.status === 'running' && Date.now() - Date.parse(job.updatedAt) > 15 * 60 * 1000) {
      await this.repo.markGeneration(job.key, 'failed', 'Generation timed out.');
      return { status: 'failed', message: 'Generation timed out.' };
    }
    const done = await this.finished(job.key);
    if (done) return { status: 'ready', ...done };
    if (job.status === 'failed') return { status: 'failed', message: job.error ?? 'Generation failed.' };
    return { status: 'running', run_id: job.runId };
  }

  private async authorize(id: string, token: string): Promise<GameRecord> {
    const game = await this.repo.get(id);
    const actual = Buffer.from(hash(token), 'hex');
    const expected = Buffer.from(game?.tokenHash ?? hash('missing-game'), 'hex');
    if (!game || !timingSafeEqual(actual, expected)) throw new AppError(404, 'game_not_found', 'Game not found for this session.');
    return game;
  }

  async get(id: string, token: string): Promise<GameView> { return visibleGame(await this.authorize(id, token)); }

  async submit(id: string, token: string, key: string, text: string, expectedVersion: number): Promise<GameView> {
    const game = await this.authorize(id, token);
    const requestHash = hash(JSON.stringify({ text, expectedVersion }));
    const prior = await this.repo.turn(id, key);
    if (prior) return replay(prior, requestHash);
    if (game.version !== expectedVersion) throw conflict('stale_state', 'Refresh the game before submitting another command.');
    if (game.state.status !== 'active') throw conflict('game_finished', 'This adventure has ended. Start a new game.');

    const knownVerbs = new Set(game.definition.actions.flatMap(action => action.verbs.map(verb => verb.toLowerCase())));
    const submitted = text.trim();
    const firstWord = submitted.split(/\s+/)[0]?.toLowerCase() ?? '';
    const isLiteral = game.definition.actions.some(action => action.id === submitted)
      || ['look', 'l', 'help', '?', 'inventory', 'i'].includes(firstWord)
      || knownVerbs.has(firstWord) || Boolean(game.state.pendingVerb);
    let commandText = text;
    if (!isLiteral && this.ai.capabilities.natural_language) {
      try {
        const interpreted = await this.ai.interpret(text,
          `${describe(game.definition, game.state)}\nRecent transcript: ${JSON.stringify(game.transcript.slice(-4))}`,
          { verbs: [...knownVerbs], targets: [...game.definition.locations.map(value => value.name), ...game.definition.entities.map(value => value.name)] });
        if (interpreted.verb !== 'unknown') commandText = `${interpreted.verb} ${interpreted.target}`.trim();
      } catch { this.report('interpretation_failed'); }
    }
    const result = resolveCommand(game.definition, game.state, commandText);
    let textOut = result.facts;
    if (/^(help|\?)$/i.test(commandText.trim())) textOut += this.ai.capabilities.natural_language
      ? ' Claude interpretation is enabled for free-form requests.'
      : ' Offline mode: use the listed literal commands or reply to a clarification with a target.';
    if (['applied', 'completed'].includes(result.outcome)) textOut = twoSentences(textOut);
    const next: GameRecord = { ...game, version: game.version + 1, state: result.state,
      transcript: [...game.transcript, { id: randomUUID(), input: text, text: textOut, outcome: result.outcome }] };
    closeAtTurnLimit(next);
    return replay(await this.repo.commit(id, expectedVersion, key, requestHash, next, visibleGame(next)), requestHash);
  }
}
