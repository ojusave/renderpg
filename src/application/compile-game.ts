import { createHash, randomUUID } from 'node:crypto';
import { AdventureCompiler } from '../adventure/compiler.js';
import type { GameRecord } from '../game/types.js';
import { visibleGame } from '../game/visibility.js';
import type { GameAI, GameRepository, GenerationInput } from './ports.js';

/** Compiles one prompt and persists the game. Safe to run again for the same idempotency key. */
export async function compileAndPublish(input: GenerationInput, repo: GameRepository, ai: GameAI, report: (event: string) => void): Promise<void> {
  if (await repo.creation(input.idempotencyKey)) {
    await repo.markGeneration(input.idempotencyKey, 'published');
    return;
  }
  await repo.markGeneration(input.idempotencyKey, 'running');
  let compiled;
  try {
    compiled = await new AdventureCompiler(ai, report).compile(input.prompt, input.variationSeed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    report(`generation_failed: ${message}`);
    await repo.markGeneration(input.idempotencyKey, 'failed', message);
    throw error;
  }
  const game: GameRecord = {
    id: input.gameId, tokenHash: input.tokenHash, version: 0, sourcePromptId: input.sourcePromptId, adventureId: input.adventureId,
    definition: compiled.definition, state: structuredClone(compiled.definition.initialState), transcript: [],
  };
  game.transcript.push({
    id: randomUUID(), input: null, outcome: 'opening',
    text: `${compiled.definition.title}\n${compiled.definition.objective}\n${compiled.definition.opening}`,
  });
  await repo.create(input.idempotencyKey, input.requestHash,
    { id: input.sourcePromptId, content: input.prompt, contentHash: createHash('sha256').update(input.prompt).digest('hex') },
    { id: input.adventureId, variationSeed: input.variationSeed, validation: compiled.validation }, game, visibleGame(game));
  await repo.markGeneration(input.idempotencyKey, 'published');
}
