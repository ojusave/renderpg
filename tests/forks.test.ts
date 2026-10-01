import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OfflineAuthor } from '../src/adapters/offline-author.js';
import { InlineFillRunner } from '../src/adapters/inline-fill-runner.js';
import { sandboxCreateInput } from '../src/adapters/render-sandboxes.js';
import { OfflineAI } from '../src/adapters/offline-ai.js';
import { GameService } from '../src/application/game-service.js';
import { ScenarioService } from '../src/application/scenario-service.js';
import { buildApp } from '../src/api/app.js';
import { MemoryRepository } from './helpers.js';
import { MemoryScenarioStore } from './scenario-memory.js';
import { offlineFill } from '../src/scenario/offline-fill.js';
import { legalActions, openPlay } from '../src/scenario/engine.js';
import { projectFork } from '../src/sandbox/project.js';
import { previewCommand, SandboxForkSimulator, type SandboxClient } from '../src/sandbox/remote.js';

const secret = 's'.repeat(32);

test('a projected fork copies the play-through and applies one action', () => {
  const fill = offlineFill();
  const play = openPlay(fill);
  const before = structuredClone(play);
  const view = projectFork(fill, play, 'act_now');
  assert.deepEqual(play, before);
  assert.equal(view.ending?.id, 'acted_too_early');
  assert.equal(view.version, 1);
  assert.equal(play.version, 0);
});

test('fork previews do not change the saved case', async () => {
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  const scenarios = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  const app = buildApp(new GameService(new MemoryRepository(), new OfflineAI(), secret), new MemoryRepository(), false, scenarios);
  const created = await app.inject({ method: 'POST', url: '/sessions' });
  const body = created.json();
  const headers = { authorization: `Bearer ${body.session_token}` };
  const early = await app.inject({ method: 'POST', url: `${body.game_url}/forks`, headers, payload: { version: 'server' } });
  assert.equal(early.statusCode, 409);
  const began = await app.inject({ method: 'POST', url: `${body.game_url}/begin`, headers });
  assert.equal(began.statusCode, 200);
  const versions = await app.inject({ method: 'GET', url: `${body.game_url}/sandboxes`, headers });
  assert.deepEqual(versions.json(), { versions: [{ id: 'server', name: 'This server' }] });
  const preview = await app.inject({ method: 'POST', url: `${body.game_url}/forks`, headers, payload: { version: 'server' } });
  assert.equal(preview.statusCode, 200);
  const forks = preview.json();
  assert.equal(forks.source_version, 0);
  assert.deepEqual(forks.forks.map((fork: { action_id: string; status: string; game: { ending: { id: string } | null } }) => [fork.action_id, fork.status, fork.game.ending?.id ?? null]), [
    ['look_first', 'ready', null],
    ['act_now', 'ready', 'acted_too_early'],
    ['refuse', 'ready', 'refused'],
  ]);
  const current = await app.inject({ method: 'GET', url: body.game_url, headers });
  assert.equal(current.json().game.version, 0);
  const missing = await app.inject({ method: 'POST', url: `${body.game_url}/forks`, headers, payload: { version: 'gold' } });
  assert.equal(missing.statusCode, 409);
  assert.equal(missing.json().code, 'unknown_sandbox');
  const chosen = await app.inject({
    method: 'POST', url: `${body.game_url}/choices`, headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { action_id: 'look_first', expected_version: 0 },
  });
  assert.equal(chosen.statusCode, 200);
  assert.equal(chosen.json().version, 1);
  await app.close();
});

test('the console can preview forks and then play the saved case', async () => {
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  const scenarios = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  const app = buildApp(new GameService(new MemoryRepository(), new OfflineAI(), secret), new MemoryRepository(), false, scenarios);
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const directory = await mkdtemp(path.join(tmpdir(), 'renderpg-fork-console-'));
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.resolve('src/console/main.ts')], {
    cwd: directory, env: { ...process.env, API_URL: url }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); });
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  async function waitFor(text: string, from = 0) {
    const deadline = Date.now() + 5000;
    while (!output.slice(from).includes(text)) {
      assert.ok(Date.now() < deadline && child.exitCode === null, `Console did not show ${text}: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  try {
    await waitFor('\n> ');
    const from = output.length;
    child.stdin.write('/forks\n');
    await waitFor('Saved case unchanged.', from);
    await waitFor('turn 0]', from);
    const next = output.length;
    child.stdin.write('1\n');
    await waitFor('turn 1]', next);
    child.stdin.write('/quit\n');
    assert.equal(await exited, 0);
  } finally {
    if (child.exitCode === null) { child.kill(); await exited; }
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the sandbox entry prints one outcome', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'renderpg-fork-'));
  const file = path.join(directory, 'fork.json');
  const fill = offlineFill();
  await writeFile(file, JSON.stringify({ actionId: 'refuse', fill, play: openPlay(fill) }));
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.resolve('src/sandbox/preview.ts'), file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', data => { stdout += data.toString(); });
  const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
  await rm(directory, { recursive: true, force: true });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).ending.id, 'refused');
});

test('each legal action gets its own sandbox and a failure does not cancel the rest', async () => {
  const opened: string[] = [];
  const closed: string[] = [];
  const uploaded: string[] = [];
  const client: SandboxClient = {
    async versions() { return [{ id: 'gold', name: 'Gold' }]; },
    async open(version) {
      assert.equal(version, 'gold');
      const id = `sbx-${opened.length}`;
      opened.push(id);
      return id;
    },
    async wait() {},
    async upload(_id, path) { uploaded.push(path); },
    async exec(id) {
      if (id === 'sbx-1') return { stdout: '', stderr: 'engine missing', code: 1 };
      const fill = offlineFill();
      const play = openPlay(fill);
      const action = legalActions(play)[opened.indexOf(id)]!;
      return { stdout: JSON.stringify(projectFork(fill, play, action, randomUUID())), stderr: '', code: 0 };
    },
    async close(id) { closed.push(id); },
  };
  let bundles = 0;
  const preview = await new SandboxForkSimulator(client, () => { bundles += 1; return Buffer.from('tar'); }).preview('gold', offlineFill(), openPlay(offlineFill()));
  assert.equal(bundles, 0);
  assert.deepEqual(uploaded, ['/tmp/fork.json', '/tmp/fork.json', '/tmp/fork.json']);
  assert.equal(preview.forks.filter(fork => fork.status === 'ready').length, 2);
  assert.equal(preview.forks[1]!.status, 'failed');
  assert.equal(preview.forks[1]!.message, 'engine missing');
  assert.deepEqual(closed, opened);
  const paths: string[] = [];
  const serverClient: SandboxClient = {
    ...client,
    async versions() { return []; },
    async open(version) { assert.equal(version, 'server'); return 'sbx-server'; },
    async upload(_id, path) { paths.push(path); },
    async exec() {
      const fill = offlineFill();
      return { stdout: JSON.stringify(projectFork(fill, openPlay(fill), 'look_first', randomUUID())), stderr: '', code: 0 };
    },
    async close() {},
  };
  const server = await new SandboxForkSimulator(serverClient, () => Buffer.from('tar')).preview('server', offlineFill(), openPlay(offlineFill()));
  assert.equal(server.forks.every(fork => fork.status === 'ready'), true);
  assert.ok(paths.includes('/opt/renderpg'));
  assert.equal(sandboxCreateInput('server').networkPolicy.default, 'deny-all');
  assert.equal('snapshotName' in sandboxCreateInput('server'), false);
  assert.equal(sandboxCreateInput('gold').snapshotName, 'gold');
  assert.equal(previewCommand.includes('preview.js'), true);
});

test('a missing snapshot is rejected before any sandbox starts', async () => {
  let opened = 0;
  const client: SandboxClient = {
    async versions() { return []; },
    async open() { opened += 1; return 'sbx-1'; },
    async wait() {},
    async upload() {},
    async exec() { return { stdout: '{}', stderr: '', code: 0 }; },
    async close() {},
  };
  await assert.rejects(
    new SandboxForkSimulator(client, () => Buffer.from('tar')).preview('missing', offlineFill(), openPlay(offlineFill())),
    { code: 'unknown_sandbox' },
  );
  assert.equal(opened, 0);
});
