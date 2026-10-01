import { randomUUID } from 'node:crypto';
import { conflict } from '../application/errors.js';
import type { ForkPreview, ForkResult, ForkSimulator, SandboxVersion } from '../application/scenario-ports.js';
import type { ActionId } from '../scenario/blueprint.js';
import { choiceLabel, legalActions, type PlayState } from '../scenario/engine.js';
import type { ScenarioFill } from '../scenario/fill.js';
import type { GameView } from '../game/types.js';
import { serverVersion } from './inline.js';

export const previewCommand = 'node /opt/renderpg/src/sandbox/preview.js /tmp/fork.json';

/** The slice of the Render Sandboxes client this game uses. */
export interface SandboxClient {
  versions(): Promise<SandboxVersion[]>;
  open(version: string): Promise<string>;
  wait(id: string, signal: AbortSignal): Promise<void>;
  upload(id: string, path: string, data: Buffer | string, contentType?: 'application/x-tar'): Promise<void>;
  exec(id: string, command: string, signal: AbortSignal): Promise<{ stdout: string; stderr: string; code: number }>;
  close(id: string): Promise<void>;
}

/** Runs one sandbox per legal action. A failed fork does not cancel the others. */
export class SandboxForkSimulator implements ForkSimulator {
  constructor(private client: SandboxClient, private bundle: () => Buffer) {}

  async versions(): Promise<SandboxVersion[]> {
    try {
      const named = await this.client.versions();
      return [serverVersion, ...named.filter(item => item.id !== serverVersion.id)];
    } catch (error) {
      console.warn(JSON.stringify({ event: 'sandbox_versions_failed', message: error instanceof Error ? error.message : 'unknown' }));
      return [serverVersion];
    }
  }

  async preview(version: string, fill: ScenarioFill, play: PlayState): Promise<ForkPreview> {
    const known = await this.versions();
    if (!known.some(item => item.id === version)) throw conflict('unknown_sandbox', 'That sandbox version is not available.');
    const packed = version === serverVersion.id ? this.bundle() : null;
    const forks = await Promise.all(legalActions(play).map(action => this.one(version, fill, play, action, packed)));
    return { version, source_version: play.version, forks };
  }

  private async one(version: string, fill: ScenarioFill, play: PlayState, action: ActionId, packed: Buffer | null): Promise<ForkResult> {
    const label = choiceLabel(fill, action, play.verified);
    let sandboxId: string | null = null;
    try {
      sandboxId = await this.client.open(version);
      await this.client.wait(sandboxId, AbortSignal.timeout(90_000));
      if (packed) await this.client.upload(sandboxId, '/opt/renderpg', packed, 'application/x-tar');
      const job = JSON.stringify({ actionId: action, fill, play });
      await this.client.upload(sandboxId, '/tmp/fork.json', job);
      const result = await this.client.exec(sandboxId, previewCommand, AbortSignal.timeout(20_000));
      if (result.code !== 0) throw new Error(result.stderr.trim() || `Sandbox exited ${result.code}`);
      const game = JSON.parse(result.stdout) as GameView;
      if (!game || typeof game.version !== 'number') throw new Error('Sandbox returned an unreadable preview.');
      return { action_id: action, label, sandbox_id: sandboxId, status: 'ready', game: { ...game, id: game.id || randomUUID() }, message: null };
    } catch (error) {
      return {
        action_id: action, label, sandbox_id: sandboxId, status: 'failed', game: null,
        message: error instanceof Error ? error.message : 'Fork failed',
      };
    } finally {
      if (sandboxId) await this.client.close(sandboxId).catch(() => undefined);
    }
  }
}
