import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { OfflineAuthor } from '../src/adapters/offline-author.js';
import { InlineFillRunner } from '../src/adapters/inline-fill-runner.js';
import { GameService } from '../src/application/game-service.js';
import { ScenarioService } from '../src/application/scenario-service.js';
import { OfflineAI } from '../src/adapters/offline-ai.js';
import { buildApp } from '../src/api/app.js';
import { MemoryRepository } from './helpers.js';
import { MemoryScenarioStore } from './scenario-memory.js';

function playableApp() {
  const repo = new MemoryRepository();
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  const scenarios = new ScenarioService(store, author, new InlineFillRunner(store, author), 's'.repeat(32));
  return { repo, store, app: buildApp(new GameService(repo, new OfflineAI(), 's'.repeat(32)), repo, false, scenarios) };
}

test('real console clears an oversized rejected command and accepts the next turn', { timeout: 15000 }, async () => {
  const { app } = playableApp();
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const directory = await mkdtemp(path.join(tmpdir(), 'renderpg-console-'));
  const child = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('src/console/main.ts')], {
    cwd: directory, env: { ...process.env, API_URL: url }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { output += data.toString(); });
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
    assert.match(output, /Offline mode: Claude is not connected/);
    const from = output.length;
    child.stdin.write('x'.repeat(17000) + '\n');
    await waitFor('payload_too_large', from);
    await waitFor('\n> ', from);
    const session = JSON.parse(await readFile(path.join(directory, '.console-session.json'), 'utf8'));
    assert.equal(session.pending, undefined, '413 must release the rejected request');
    const next = output.length;
    child.stdin.write('1\n');
    await waitFor('turn 1]', next);
    assert.ok(!output.slice(next).includes('A request is unresolved'));
    child.stdin.write('/quit\n');
    assert.equal(await exited, 0);
  } finally {
    if (child.exitCode === null) { child.kill(); await exited; }
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

// Launch Node directly so signals reach the console process without a CLI wrapper.
function launchConsole(directory: string, url: string) {
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.resolve('src/console/main.ts')], {
    cwd: directory, env: { ...process.env, API_URL: url }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { output += data.toString(); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return {
    child, exited, output: () => output,
    async waitFor(text: string, from = 0) {
      const deadline = Date.now() + 5000;
      while (!output.slice(from).includes(text)) {
        assert.ok(Date.now() < deadline && child.exitCode === null && child.signalCode === null, `Console did not show ${text}: ${output}`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    },
  };
}

for (const exit of ['SIGINT', 'EOF'] as const) {
  test(`console exits cleanly on ${exit} and resumes the same game`, { timeout: 15000 }, async () => {
    const { app } = playableApp();
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    const directory = await mkdtemp(path.join(tmpdir(), 'renderpg-exit-'));
    const consoles: ReturnType<typeof launchConsole>[] = [];
    try {
      const first = launchConsole(directory, url);
      consoles.push(first);
      await first.waitFor('\n> ');
      const sessionBefore = await readFile(path.join(directory, '.console-session.json'), 'utf8');
      if (exit === 'SIGINT') first.child.kill('SIGINT'); else first.child.stdin.end();
      assert.deepEqual(await first.exited, { code: 0, signal: null });
      assert.doesNotMatch(first.output(), /AbortError|ABORT_ERR|node:internal/);
      assert.equal(await readFile(path.join(directory, '.console-session.json'), 'utf8'), sessionBefore);
      const resumed = launchConsole(directory, url);
      consoles.push(resumed);
      await resumed.waitFor('\n> ');
      assert.match(resumed.output(), /Status: active/);
      resumed.child.stdin.write('/quit\n');
      assert.deepEqual(await resumed.exited, { code: 0, signal: null });
    } finally {
      for (const console of consoles) {
        if (console.child.exitCode === null && console.child.signalCode === null) console.child.kill('SIGKILL');
        await console.exited;
      }
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('interrupted HTTP response preserves its request and replays without advancing twice', { timeout: 15000 }, async () => {
  const { app, store } = playableApp();
  let release!: () => void;
  let observed!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const sent = new Promise<void>(resolve => { observed = resolve; });
  app.addHook('onSend', async (request, _reply, payload) => {
    if (request.url.endsWith('/choices')) { observed(); await held; }
    return payload;
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const directory = await mkdtemp(path.join(tmpdir(), 'renderpg-interruption-'));
  const consoles: ReturnType<typeof launchConsole>[] = [];
  try {
    const first = launchConsole(directory, url);
    consoles.push(first);
    await first.waitFor('\n> ');
    first.child.stdin.write('1\n');
    await sent;
    first.child.kill('SIGINT');
    assert.deepEqual(await first.exited, { code: 0, signal: null });
    assert.doesNotMatch(first.output(), /AbortError|ABORT_ERR|node:internal/);
    const saved = JSON.parse(await readFile(path.join(directory, '.console-session.json'), 'utf8'));
    assert.ok(saved.pending?.key, 'ambiguous HTTP outcome must keep its idempotency key');
    const play = () => [...store.sessions.values()].map(item => item.play).find(item => item);
    assert.equal(play()?.version, 1);
    release();
    const resumed = launchConsole(directory, url);
    consoles.push(resumed);
    await resumed.waitFor('\n> ');
    assert.match(resumed.output(), /You open the account record/);
    assert.match(resumed.output(), /How do you identify the rightful owner\?/);
    assert.equal(play()?.version, 1, 'replaying must not add a second turn');
    const from = resumed.output().length;
    resumed.child.stdin.write('2\n');
    await resumed.waitFor('turn 2]', from);
    assert.equal(play()?.version, 2);
    resumed.child.stdin.write('/quit\n');
    assert.deepEqual(await resumed.exited, { code: 0, signal: null });
    assert.equal(JSON.parse(await readFile(path.join(directory, '.console-session.json'), 'utf8')).pending, undefined);
  } finally {
    release();
    for (const console of consoles) {
      if (console.child.exitCode === null && console.child.signalCode === null) console.child.kill('SIGKILL');
      await console.exited;
    }
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
