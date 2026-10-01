import { AppError, conflict } from './errors.js';
import type { ForkPreview, ForkSimulator, PlayerSession, ScenarioStore } from './scenario-ports.js';
import { blueprintId } from '../scenario/blueprint.js';

const retiredMessage = 'This case was made by an earlier version of the game. Start a new case.';

/** Lists sandbox versions for an authenticated session. Listing failure still leaves the saved game alone. */
export async function listSandboxVersions(forks: ForkSimulator): Promise<{ versions: { id: string; name: string }[] }> {
  try {
    return { versions: await forks.versions() };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'dependency_unavailable', 'Sandbox versions are temporarily unavailable.', true);
  }
}

/** Projects every legal next action. The stored play-through is not written. */
export async function previewSavedForks(store: ScenarioStore, forks: ForkSimulator, player: PlayerSession, version: string): Promise<ForkPreview> {
  const scenario = player.scenarioId ? await store.scenario(player.scenarioId) : null;
  if (scenario && scenario.blueprintId !== blueprintId) throw conflict('scenario_retired', retiredMessage);
  if (!scenario?.content || !player.play) throw new AppError(409, 'scenario_not_ready', 'Begin the case before previewing forks.');
  try {
    return await forks.preview(version, scenario.content, structuredClone(player.play));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'dependency_unavailable', 'Sandbox previews are temporarily unavailable.', true);
  }
}
