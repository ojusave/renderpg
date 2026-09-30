import { publishFill } from '../application/publish-fill.js';
import type { FillRunner, ScenarioAuthor, ScenarioStore } from '../application/scenario-ports.js';

/** Fills a scenario in process. Tests and local play use this runner. */
export class InlineFillRunner implements FillRunner {
  readonly background = false;
  constructor(private store: ScenarioStore, private author: ScenarioAuthor) {}
  async start(input: { scenarioId: string; prompt: string }) {
    await publishFill(this.store, this.author, input.scenarioId, input.prompt);
    return { runId: input.scenarioId };
  }
}
