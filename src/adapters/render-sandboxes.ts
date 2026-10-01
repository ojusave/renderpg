import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Render } from '@renderinc/sdk';
import type { SandboxVersion } from '../application/scenario-ports.js';
import { serverVersion } from '../sandbox/inline.js';
import type { SandboxClient } from '../sandbox/remote.js';

/** Options for a short-lived sandbox that cannot reach the network. */
export function sandboxCreateInput(version: string) {
  return {
    timeoutSeconds: 180,
    networkPolicy: { default: 'deny-all' as const },
    ...(version === serverVersion.id ? {} : { snapshotName: version }),
  };
}

let bundle: Buffer | undefined;

/** Packs the compiled engine once so each server-version fork uploads the same bytes. */
export function engineBundle(): Buffer {
  if (bundle) return bundle;
  // The compiled engine is ESM; without this marker the sandbox's Node loads it as CommonJS.
  const marker = mkdtempSync(path.join(tmpdir(), 'renderpg-bundle-'));
  writeFileSync(path.join(marker, 'package.json'), '{"type":"module"}\n');
  try {
    bundle = execFileSync('tar', ['-c', '-f', '-', '-C', 'dist', 'src', '-C', marker, 'package.json'], { maxBuffer: 32 * 1024 * 1024 });
  } finally {
    rmSync(marker, { recursive: true, force: true });
  }
  return bundle;
}

function ownerId(workspaceId: string): `tea-${string}` {
  if (!workspaceId.startsWith('tea-')) throw new Error('RENDER_WORKSPACE_ID must start with tea-');
  return workspaceId as `tea-${string}`;
}

/** Talks to Render Sandboxes. Callers never see the SDK. */
export function renderSandboxClient(apiKey: string, workspaceId: string): SandboxClient {
  const owner = ownerId(workspaceId);
  const sandboxes = new Render({ token: apiKey, ownerId: owner }).experimental.sandboxes;
  return {
    async versions() {
      const groups = await sandboxes.listGroups({ ownerId: owner });
      const group = groups.find(item => item.sandboxGroup.isDefault)?.sandboxGroup ?? groups[0]?.sandboxGroup;
      if (!group) return [];
      const names = new Map<string, SandboxVersion>();
      let cursor: string | undefined;
      do {
        const page = await sandboxes.snapshots.list({ sandboxGroupId: group.id, status: ['available'], ownerId: owner, limit: 100, cursor });
        for (const item of page) {
          const name = item.snapshot.name?.trim();
          if (name && name !== serverVersion.id) names.set(name, { id: name, name });
        }
        cursor = page.length === 100 ? page.at(-1)?.cursor : undefined;
      } while (cursor);
      return [...names.values()];
    },
    async open(version) {
      const created = await sandboxes.create({ ownerId: owner, ...sandboxCreateInput(version) });
      return created.id;
    },
    async wait(id, signal) {
      for (let attempt = 0; attempt < 45; attempt += 1) {
        if (signal.aborted) throw new Error('Sandbox did not start in time.');
        const status = (await sandboxes.get(id, owner)).status;
        if (status === 'running') return;
        if (status === 'errored' || status === 'terminated') throw new Error(`Sandbox is ${status}.`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('Sandbox did not start in time.');
    },
    async upload(id, path, data, contentType) {
      await sandboxes.upload(id, path, data, owner, contentType ? { contentType } : undefined);
    },
    async exec(id, command, signal) {
      let stdout = '';
      let stderr = '';
      let code = 1;
      for await (const event of await sandboxes.exec(id, command, owner, signal)) {
        if (event.type === 'output') {
          if (event.stream === 'stdout') stdout += event.data;
          else stderr += event.data;
        } else code = event.exit_code;
      }
      return { stdout, stderr, code };
    },
    async close(id) {
      await sandboxes.terminate(id, owner);
    },
  };
}
