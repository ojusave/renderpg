import { randomUUID } from 'node:crypto';
import { conflict } from '../application/errors.js';
import type { ForkPreview, ForkSimulator, SandboxVersion } from '../application/scenario-ports.js';
import { choiceLabel, legalActions, type PlayState } from '../scenario/engine.js';
import type { ScenarioFill } from '../scenario/fill.js';
import { projectFork } from './project.js';

export const serverVersion: SandboxVersion = { id: 'server', name: 'This server' };

/** Projects forks in this process. It does not call Render. */
export class InlineForkSimulator implements ForkSimulator {
  async versions(): Promise<SandboxVersion[]> {
    return [serverVersion];
  }

  async preview(version: string, fill: ScenarioFill, play: PlayState): Promise<ForkPreview> {
    if (version !== serverVersion.id) throw conflict('unknown_sandbox', 'That sandbox version is not available.');
    return {
      version,
      source_version: play.version,
      forks: legalActions(play).map(action => ({
        action_id: action,
        label: choiceLabel(fill, action, play.verified),
        sandbox_id: null,
        status: 'ready' as const,
        game: projectFork(fill, play, action, randomUUID()),
        message: null,
      })),
    };
  }
}
