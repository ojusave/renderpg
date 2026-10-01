import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OfflineAuthor } from '../src/adapters/offline-author.js';
import { InlineFillRunner } from '../src/adapters/inline-fill-runner.js';
import { publishFill, repeatedStoryError } from '../src/application/publish-fill.js';
import { ScenarioService } from '../src/application/scenario-service.js';
import { blueprintId } from '../src/scenario/blueprint.js';
import { defaultScenarioPrompt } from '../src/scenario/default-prompt.js';
import { offlineFill } from '../src/scenario/offline-fill.js';
import { repeatsStory, similarity } from '../src/scenario/similarity.js';
import { MemoryScenarioStore } from './scenario-memory.js';

const secret = 's'.repeat(32);
const photos = 'Priya lost her camera on the team hike. She asks whether anyone has the photos from the outing and can share them.';
const photosAgain = 'Priya lost her camera on the team hike. She asks whether anyone has the photos from the outing and can share them. Jo says check the shared drive.';
const invoice = 'Billing asked Security to confirm who can close the overdue invoice for the Bluefin workspace before Friday.';

test('a thread pulled in again counts as the same source', () => {
  assert.ok(similarity(photos, photosAgain) >= 0.5);
  assert.ok(similarity(photos, invoice) < 0.3);
  assert.equal(repeatsStory({ prompt: photosAgain, story: 'Lost camera' }, [{ prompt: photos, story: 'Hike pictures' }]), true);
  assert.equal(repeatsStory({ prompt: invoice, story: 'Closing the invoice' }, [{ prompt: photos, story: 'Hike pictures' }]), false);
});

test('a second case from the same source is not published', async () => {
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  const first = randomUUID();
  const second = randomUUID();
  await store.insertFilling(first, blueprintId, defaultScenarioPrompt, null);
  await store.insertFilling(second, blueprintId, defaultScenarioPrompt, null);
  await publishFill(store, author, first, defaultScenarioPrompt);
  await publishFill(store, author, second, defaultScenarioPrompt);
  assert.equal((await store.scenario(first))?.status, 'ready');
  const repeated = await store.scenario(second);
  assert.equal(repeated?.status, 'failed');
  assert.equal(repeated?.error, repeatedStoryError);
});

test('sign-in does not make another copy of the built-in story', async () => {
  const store = new MemoryScenarioStore();
  const author = new OfflineAuthor();
  const used = randomUUID();
  await store.insertFilling(used, blueprintId, defaultScenarioPrompt, null);
  await store.markReady(used, offlineFill());
  const service = new ScenarioService(store, author, new InlineFillRunner(store, author), secret);
  assert.equal((await service.signIn()).status, 'ready');
  await assert.rejects(service.signIn(), { code: 'no_new_cases' });
  assert.equal(store.scenarios.size, 1);
});
