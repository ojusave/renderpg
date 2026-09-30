import { compileAndPublish } from '../application/compile-game.js';
import type { AdventureRunner, GameAI, GameRepository, GenerationInput } from '../application/ports.js';

/** Compiles an adventure in-process before the creation request returns. */
export class InlineAdventureRunner implements AdventureRunner {
  readonly background = false;
  constructor(private repo: GameRepository, private ai: GameAI, private report: (event: string) => void = () => {}) {}
  async start(input: GenerationInput): Promise<{ runId: string }> {
    await compileAndPublish(input, this.repo, this.ai, this.report);
    return { runId: input.runId };
  }
}
