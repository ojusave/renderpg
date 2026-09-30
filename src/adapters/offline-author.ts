import type { ScenarioAuthor } from '../application/scenario-ports.js';
import { offlineFill } from '../scenario/offline-fill.js';

/** Returns the fixed account-ownership fill without calling a model. */
export class OfflineAuthor implements ScenarioAuthor {
  async fill(prompt: string) { return offlineFill(prompt); }
}
