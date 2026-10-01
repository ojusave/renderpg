import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OfflineAuthor } from '../src/adapters/offline-author.js';
import { InlineFillRunner } from '../src/adapters/inline-fill-runner.js';
import { ScenarioService } from '../src/application/scenario-service.js';
import { defaultScenarioPrompt } from '../src/scenario/default-prompt.js';
import { applyChoice, openPlay } from '../src/scenario/engine.js';
import { validateFill } from '../src/scenario/fill.js';
import { offlineFill } from '../src/scenario/offline-fill.js';
import { MemoryScenarioStore } from './scenario-memory.js';

const secret = 's'.repeat(32);

test('fill validation rejects travel and invented excerpts', () => {
  const fill = offlineFill();
  assert.deepEqual(validateFill(fill, defaultScenarioPrompt), []);
  fill.choices.transfer_account.label = 'Travel to the owner office';
  assert.ok(validateFill(fill, defaultScenarioPrompt).some(error => error.includes('unrealistic')));
  fill.choices.transfer_account.label = 'Transfer the account';
  fill.evidence.account_record.sourceExcerpt = 'A fact that was never in the source.';
  assert.ok(validateFill(fill, defaultScenarioPrompt).some(error => error.includes('excerpt')));
});

test('transfer succeeds only after authority is verified', () => {
  const fill = offlineFill();
  const state = applyChoice(openPlay(fill), fill, 'review_account_record');
  const unverified = applyChoice(state, fill, 'request_more_evidence');
  const early = applyChoice(unverified, fill, 'transfer_account');
  assert.equal(early.endingId, 'incorrect_transfer');
  const checked = applyChoice(state, fill, 'verify_requester_authority');
  const verified = applyChoice(checked, fill, 'transfer_account');
  assert.equal(verified.endingId, 'success');
  assert.equal(verified.status, 'completed');
});

test('game master text is at most two sentences', () => {
  const fill = offlineFill();
  fill.choices.review_account_record.consequence = 'One. Two. Three.';
  const state = applyChoice(openPlay(fill), fill, 'review_account_record');
  const text = state.transcript.at(-1)!.text;
  assert.ok((text.match(/[.!?](\s|$)/g) ?? []).length <= 2, text);
});

test('sign-in claims a ready scenario and begin does not fill another', async () => {
  const store = new MemoryScenarioStore();
  let fills = 0;
  const author = { async fill(prompt: string) { fills += 1; return new OfflineAuthor().fill(prompt); } };
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  const seeded = randomUUID();
  await store.insertFilling(seeded, 'account_ownership_v1', defaultScenarioPrompt, null);
  await store.markReady(seeded, offlineFill());
  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  await new Promise(resolve => setTimeout(resolve, 30));
  const fillsAfterClaim = fills;
  const game = await service.begin(session.session_token);
  assert.equal(game.location.id, 'review');
  assert.equal(game.available_actions.length, 3);
  const verified = await service.choose(session.session_token, randomUUID(), 'review_account_record', game.version);
  const decided = await service.choose(session.session_token, randomUUID(), 'verify_requester_authority', verified.version);
  const ended = await service.choose(session.session_token, randomUUID(), 'transfer_account', decided.version);
  assert.equal(ended.status, 'completed');
  assert.equal(ended.ending?.id, 'success');
  assert.equal(fills, fillsAfterClaim);
});

test('sign-in gives the agent a redacted slack story when one is pending', async () => {
  const store = new MemoryScenarioStore();
  const seen: string[] = [];
  const author = { async fill(prompt: string) { seen.push(prompt); return new OfflineAuthor().fill(prompt); } };
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret, {
    async nextPrompt() { return 'A customer asked Security to transfer the account after the employee who owned it left. Speaker A and Speaker B reviewed access, billing, and the workspace owner before the transfer.'; },
  });
  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  assert.match(seen[0] ?? '', /Speaker A/);
  assert.equal((seen[0] ?? '').includes('@'), false);
});

test('an empty pool fills one scenario during sign-in', async () => {
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  const session = await service.signIn();
  assert.equal(session.status, 'ready');
  const game = await service.begin(session.session_token);
  assert.match(game.transcript[0]!.text, /rightful new owner/i);
});
