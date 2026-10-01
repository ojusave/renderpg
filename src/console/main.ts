import { createInterface } from 'node:readline/promises';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';

// Deliberately no imports from domain, persistence, or AI. This client only speaks HTTP.
type Action = { id: string; label: string; command: string };
type View = { id: string; version: number; status: string; stage: string; transcript: { id: string; text: string }[]; available_actions: Action[] };
type Pending = { key: string; path: string; body: unknown };
type Session = { token?: string; playerId?: string; gameUrl?: string; pending?: Pending };
const file = '.console-session.json';
const api = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const shutdown = new AbortController();
let session: Session;
try { session = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read saved console session. Preserve or rename .console-session.json before starting again.');
  session = {};
}
async function save() { await writeFile(`${file}.tmp`, JSON.stringify(session), { mode: 0o600 }); await rename(`${file}.tmp`, file); }
class ApiFailure extends Error {
  constructor(public status: number, message: string) { super(message); }
  get definitiveRejection() { return this.status >= 400 && this.status < 500 && ![408, 429].includes(this.status); }
}
async function request(path: string, body?: unknown, key?: string, method = body === undefined ? 'GET' : 'POST'): Promise<any> {
  const employee = process.env.RENDER_ACCESS_TOKEN?.trim();
  const response = await fetch(`${api}${path}`, { method,
    headers: { ...(method === 'POST' && body !== undefined ? { 'content-type': 'application/json' } : {}), ...(session.token ? { authorization: `Bearer ${session.token}` } : {}), ...(session.playerId ? { 'x-player-id': session.playerId } : {}), ...(employee ? { 'x-forwarded-access-token': employee } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    ...(method === 'POST' && body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([AbortSignal.timeout(150000), shutdown.signal]) });
  const data = await response.json().catch(() => ({ code: 'invalid_response', message: `HTTP ${response.status}` })) as any;
  if (!response.ok) throw new ApiFailure(response.status, `${data.code}: ${data.message}`);
  return data;
}
async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + 90000;
  let shown = -1;
  while (Date.now() < deadline) {
    const current = await request(session.gameUrl ?? '/sessions/current');
    const progress = current.progress;
    if (progress && progress.percent !== shown) {
      shown = progress.percent;
      const measured = progress.output_tokens != null && progress.max_tokens != null
        ? ` (${progress.output_tokens}/${progress.max_tokens} tokens)`
        : progress.characters != null ? ` (${progress.characters} characters)` : '';
      const task = progress.task_status ? ` Render task ${progress.task_status}.` : '';
      console.log(`${progress.label} ${progress.percent}%.${measured}${task}`);
    }
    if (current.status === 'failed') throw new ApiFailure(503, `scenario_failed: ${current.message ?? 'The case could not be prepared.'}`);
    if (current.game) return;
    if (current.status === 'ready') return;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new ApiFailure(503, 'scenario_timeout: The case is still being prepared.');
}
async function endCase(): Promise<void> {
  if (!session.token) return;
  try { await request(session.gameUrl ?? '/sessions/current', undefined, undefined, 'DELETE'); } catch { /* A missing session can still be replaced. */ }
  delete session.token;
  delete session.gameUrl;
  delete session.pending;
  await save();
}
async function openCase(): Promise<View> {
  await endCase();
  console.log('\nClaiming a prepared case.');
  const opened = await request('/sessions', undefined, undefined, 'POST');
  session.token = opened.session_token;
  session.playerId = opened.player_id;
  session.gameUrl = opened.game_url;
  delete session.pending;
  await save();
  if (opened.status === 'failed') throw new ApiFailure(503, `scenario_failed: ${opened.message ?? 'The case could not be prepared.'}`);
  if (!opened.game && opened.status === 'preparing') {
    console.log('A new telling is still being written.');
    await waitUntilReady();
  }
  if (opened.game) return opened.game;
  return request(`${session.gameUrl ?? '/sessions/current'}/begin`, undefined, undefined, 'POST');
}
async function resume(): Promise<View> {
  const current = await request(session.gameUrl ?? '/sessions/current');
  if (current.game) return current.game;
  if (current.status === 'preparing') await waitUntilReady();
  if (current.status === 'failed') throw new ApiFailure(503, `scenario_failed: ${current.message ?? 'The case could not be prepared.'}`);
  return request(`${session.gameUrl ?? '/sessions/current'}/begin`, undefined, undefined, 'POST');
}
async function flush(): Promise<View> {
  const p = session.pending!;
  const data = await request(p.path, p.body, p.key);
  delete session.pending;
  await save();
  return data;
}
function choice(game: View, text: string): string {
  const numbered = /^[1-9]$/.exec(text);
  if (numbered) return game.available_actions[Number(text) - 1]?.command ?? text;
  return game.available_actions.find(action => action.command === text || action.label.toLowerCase() === text.toLowerCase())?.command ?? text;
}
function show(game: View) {
  console.log('\n' + stripVTControlCharacters(game.transcript.at(-1)?.text ?? ''));
  if (game.available_actions.length) {
    console.log(`\n${stripVTControlCharacters(game.stage)}`);
    console.log(game.available_actions.map((action, index) => `${index + 1}. ${stripVTControlCharacters(action.label)}`).join('\n'));
  }
  console.log(`[Status: ${game.status} | ${stripVTControlCharacters(game.stage)} | turn ${game.version}]`);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const stop = () => { shutdown.abort(); rl.close(); };
// readline emits its own SIGINT for terminal Ctrl+C. Also handle process signals
// and EOF, including while an HTTP request is in flight.
rl.on('SIGINT', stop);
rl.on('close', () => shutdown.abort());
process.on('SIGINT', stop);
console.log('RenderPG console. /quit exits, /new claims another telling, /resume refreshes, /sandboxes lists versions, /forks previews them. Saved requests survive interruption.');
let game: View | undefined;
try {
  try {
    const health = await request('/health');
    console.log(health.ai?.natural_language
      ? 'Claude mode: natural-language interpretation is enabled.'
      : health.ai?.mode === 'offline'
        ? 'Offline mode: Claude is not connected. Choose a numbered response.'
        : 'The server did not report its AI mode. Type help to see supported commands.');
    if (session.pending) game = await flush();
    else if (session.token) game = await resume();
    else game = await openCase();
    show(game!);
  } catch (error) {
    if (!shutdown.signal.aborted) {
      if (error instanceof ApiFailure && error.definitiveRejection) { delete session.pending; await save(); }
      console.log(stripVTControlCharacters(String(error)));
      console.log(session.pending ? 'Type /retry to reuse the saved request safely.' : 'Use /resume to refresh or /new to start over.');
    }
  }
  while (!shutdown.signal.aborted) {
    let text: string;
    try { text = (await rl.question('\n> ', { signal: shutdown.signal })).trim(); }
    catch (error) { if (shutdown.signal.aborted) break; throw error; }
    if (text === '/quit') break;
    try {
      if (session.pending) {
        if (text !== '/retry') { console.log('A request is unresolved. Type /retry to safely retry it, or /quit.'); continue; }
        game = await flush();
      } else if (text === '/new') game = await openCase();
      else if (text === '/sandboxes') {
        const listed = await request(`${session.gameUrl ?? '/sessions/current'}/sandboxes`);
        console.log(listed.versions.map((item: { id: string; name: string }) => `${item.id}  ${item.name}`).join('\n') || 'No sandbox versions are available.');
        if (game) show(game);
        continue;
      } else if (text === '/forks' || text.startsWith('/forks ')) {
        const base = session.gameUrl ?? '/sessions/current';
        const listed = await request(`${base}/sandboxes`);
        const asked = text.slice('/forks'.length).trim();
        const picked = asked || listed.versions.find((item: { id: string }) => item.id === 'server')?.id || listed.versions[0]?.id;
        if (!picked) console.log('No sandbox versions are available.');
        else {
          console.log(`Previewing ${picked}. The saved case stays as it is.`);
          const preview = await request(`${base}/forks`, { version: picked });
          for (const fork of preview.forks) console.log(`\n${stripVTControlCharacters(fork.label)}\n${stripVTControlCharacters(fork.game?.transcript?.at(-1)?.text ?? fork.message ?? 'unavailable')}`);
          console.log('\nSaved case unchanged.');
        }
        if (game) show(game);
        continue;
      } else if (text === '/resume' || text === '/retry') game = session.token ? await resume() : await openCase();
      else {
        if (!text) continue;
        if (!game) { console.log('Use /new or /resume first.'); continue; }
        session.pending = { path: `${session.gameUrl ?? '/sessions/current'}/choices`, key: randomUUID(), body: { action_id: choice(game, text), expected_version: game.version } };
        await save();
        game = await flush();
      }
      show(game!);
    } catch (error) {
      if (shutdown.signal.aborted) break;
      if (error instanceof ApiFailure && error.definitiveRejection) { delete session.pending; await save(); }
      console.log(stripVTControlCharacters(String(error)));
      console.log(session.pending ? 'Type /retry to reuse the saved request safely.' : 'Use /resume to refresh or /new to start over.');
    }
  }
} finally {
  process.off('SIGINT', stop);
  rl.close();
  console.log(session.pending
    ? '\nConsole closed. The pending request is saved and will be retried safely when you restart.'
    : '\nConsole closed. Your saved game will resume when you restart.');
}
