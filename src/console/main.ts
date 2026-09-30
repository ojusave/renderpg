import { createInterface } from 'node:readline/promises';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import { defaultScenarioPrompt } from '../scenario/default-prompt.js';

// Deliberately no imports from domain, persistence, or AI. This client only speaks HTTP.
type View = { id: string; version: number; status: string; stage: string; transcript: { id: string; text: string }[] };
type Pending = { key: string; path: string; body: unknown };
type Session = { gameId?: string; token?: string; pending?: Pending };
const file = '.console-session.json';
const api = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const scenarioPrompt = process.env.SCENARIO_PROMPT ?? defaultScenarioPrompt;
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
async function request(path: string, body?: unknown, key?: string): Promise<any> {
  const response = await fetch(`${api}${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(session.token ? { authorization: `Bearer ${session.token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([AbortSignal.timeout(150000), shutdown.signal]) });
  const data = await response.json() as any;
  if (!response.ok) throw new ApiFailure(response.status, `${data.code}: ${data.message}`);
  return data;
}
async function waitForGeneration(runId: string): Promise<any> {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const generation = await request(`/games/generations/${runId}`);
    if (generation.game) return generation;
    if (generation.status === 'failed') throw new ApiFailure(503, `generation_failed: ${generation.message}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new ApiFailure(503, 'generation_timeout: The adventure is still being generated.');
}
async function flush(): Promise<View> {
  const p = session.pending!;
  if (p.path === '/games') console.log('\nGenerating an adventure from the scenario prompt. This can take up to a minute.');
  let data = await request(p.path, p.body, p.key);
  if (data.status === 'running') data = await waitForGeneration(data.run_id);
  if (p.path === '/games') { session.gameId = data.game.id; session.token = data.session_token; }
  delete session.pending;
  await save();
  return data.game ?? data;
}
async function begin(): Promise<View> {
  session.pending = { path: '/games', key: randomUUID(), body: { prompt: scenarioPrompt } };
  await save();
  return flush();
}
function show(game: View) {
  console.log('\n' + stripVTControlCharacters(game.transcript.at(-1)?.text ?? ''));
  console.log(`[Status: ${game.status} | ${stripVTControlCharacters(game.stage)} | turn ${game.version}]`);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const stop = () => { shutdown.abort(); rl.close(); };
// readline emits its own SIGINT for terminal Ctrl+C. Also handle process signals
// and EOF, including while an HTTP request is in flight.
rl.on('SIGINT', stop);
rl.on('close', () => shutdown.abort());
process.on('SIGINT', stop);
console.log('RenderPG console. /quit exits, /new generates another variation, /resume refreshes. Saved requests survive interruption.');
let game: View | undefined;
try {
  try {
    const health = await request('/health');
    console.log(health.ai?.natural_language
      ? 'Claude mode: natural-language interpretation is enabled.'
      : health.ai?.mode === 'offline'
        ? 'Offline mode: Claude is not connected. Use look, help, and the generated action labels.'
        : 'The server did not report its AI mode. Type help to see supported commands.');
    if (session.pending) game = await flush();
    else if (session.gameId) {
      try { game = await request(`/games/${session.gameId}`); }
      catch (error) {
        if (!(error instanceof ApiFailure && error.status === 404)) throw error;
        console.log('The saved game no longer exists on this server. Starting a new adventure.');
        session = {};
        game = await begin();
      }
    } else game = await begin();
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
      } else if (text === '/new') game = await begin();
      else if (text === '/resume' || text === '/retry') game = session.gameId ? await request(`/games/${session.gameId}`) : await begin();
      else {
        if (!text) continue;
        if (!game) { console.log('Use /new or /resume first.'); continue; }
        session.pending = { path: `/games/${game.id}/turns`, key: randomUUID(), body: { text, expected_version: game.version } };
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
