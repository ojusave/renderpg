import assert from 'node:assert/strict';
import { Render } from '@renderinc/sdk';
import { engineBundle, renderSandboxClient } from '../src/adapters/render-sandboxes.js';
import { InlineForkSimulator } from '../src/sandbox/inline.js';
import { SandboxForkSimulator } from '../src/sandbox/remote.js';
import { applyChoice, openPlay } from '../src/scenario/engine.js';
import { offlineFill } from '../src/scenario/offline-fill.js';

// Runs real Render Sandboxes. Needs a built dist/, RENDER_API_KEY, and RENDER_WORKSPACE_ID.
const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};
const apiKey = required('RENDER_API_KEY');
const workspace = required('RENDER_WORKSPACE_ID') as `tea-${string}`;
const opened: string[] = [];
const base = renderSandboxClient(apiKey, workspace);
const forks = new SandboxForkSimulator({ ...base, async open(version) { const id = await base.open(version); opened.push(id); return id; } }, engineBundle);

const fill = offlineFill();
const states = { opening: openPlay(fill), deciding: applyChoice(applyChoice(openPlay(fill), fill, 'look_first'), fill, 'verify') };
const started = Date.now();
for (const [name, play] of Object.entries(states)) {
  const before = structuredClone(play);
  const remote = await forks.preview('server', fill, play);
  const local = await new InlineForkSimulator().preview('server', fill, play);
  assert.deepEqual(play, before, 'preview must not change the play-through');
  for (const fork of remote.forks) assert.equal(fork.status, 'ready', `${name}/${fork.action_id}: ${fork.message}`);
  const outcome = (preview: typeof remote) => preview.forks.map(fork => [fork.action_id, fork.game?.ending?.id ?? null, fork.game?.version, fork.game?.transcript.at(-1)?.text]);
  assert.deepEqual(outcome(remote), outcome(local));
  console.log(JSON.stringify({ event: 'sandbox_forks_ready', state: name, forks: remote.forks.map(fork => ({ action: fork.action_id, sandbox: fork.sandbox_id, ending: fork.game?.ending?.id ?? null })) }));
}

const sandboxes = new Render({ token: apiKey, ownerId: workspace }).experimental.sandboxes;
const listed = await sandboxes.list({ ownerId: workspace, status: ['terminated'], limit: 100 });
for (const id of opened) {
  const found = listed.find(item => item.sandbox.id === id)?.sandbox;
  assert.ok(found, `${id} was not terminated`);
  assert.equal(found.networkPolicy.default, 'deny-all');
}
const live = await sandboxes.list({ ownerId: workspace, status: ['creating', 'running'], limit: 100 });
assert.equal(live.filter(item => opened.includes(item.sandbox.id)).length, 0);
await assert.rejects(forks.preview('no-such-snapshot', fill, states.opening), { code: 'unknown_sandbox' });
console.log(JSON.stringify({ event: 'sandbox_smoke_passed', sandboxes: opened.length, seconds: Math.round((Date.now() - started) / 1000) }));
