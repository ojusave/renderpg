import type { AdventureDefinition } from '../adventure/definition.js';
import type { GameRecord, GameView, InterpretedCommand } from '../game/types.js';

export interface AICapabilities {
  mode: 'offline' | 'anthropic';
  natural_language: boolean;
  generation: boolean;
  narration: boolean;
}
export interface AdventureGenerator {
  readonly capabilities: AICapabilities;
  generate(prompt: string, variationSeed: string, validationFeedback?: string[]): Promise<AdventureDefinition>;
}
export interface CommandInterpreter {
  interpret(text: string, visibleContext: string, vocabulary: { verbs: string[]; targets: string[] }): Promise<InterpretedCommand>;
}
export interface Narrator {
  narrate(facts: string, context: string): Promise<string>;
}
export interface GameAI extends AdventureGenerator, CommandInterpreter, Narrator {
  readonly capabilities: AICapabilities;
}
export interface Creation { requestHash: string; game: GameRecord; opening: GameView }
export interface SavedTurn { requestHash: string; response: GameView }
export interface GenerationInput {
  prompt: string;
  variationSeed: string;
  idempotencyKey: string;
  requestHash: string;
  runId: string;
  gameId: string;
  sourcePromptId: string;
  adventureId: string;
  tokenHash: string;
}
export interface GenerationJob {
  key: string;
  requestHash: string;
  runId: string;
  status: 'running' | 'failed' | 'published';
  error: string | null;
  updatedAt: string;
}
export interface AdventureRunner {
  /** A background runner returns before compilation finishes. */
  readonly background: boolean;
  start(input: GenerationInput): Promise<{ runId: string }>;
}
export interface GameRepository {
  creation(key: string): Promise<Creation | null>;
  create(key: string, requestHash: string, prompt: { id: string; content: string; contentHash: string },
    adventure: { id: string; variationSeed: string; validation: unknown }, game: GameRecord, opening: GameView): Promise<Creation>;
  get(id: string): Promise<GameRecord | null>;
  turn(id: string, key: string): Promise<SavedTurn | null>;
  commit(id: string, expectedVersion: number, key: string, requestHash: string, next: GameRecord, response: GameView): Promise<SavedTurn>;
  reserveGeneration(key: string, requestHash: string, runId: string): Promise<GenerationJob & { created: boolean }>;
  generationByKey(key: string): Promise<GenerationJob | null>;
  generationByRun(runId: string): Promise<GenerationJob | null>;
  reclaimGeneration(key: string): Promise<boolean>;
  setGenerationRun(key: string, runId: string): Promise<void>;
  markGeneration(key: string, status: GenerationJob['status'], error?: string): Promise<void>;
  health(): Promise<void>;
  close(): Promise<void>;
}
