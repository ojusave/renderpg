import { randomUUID } from 'node:crypto';
import type { ScenarioStore } from './scenario-ports.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reuses the SSO subject, or an anonymous id this service already issued. */
export async function resolvePlayer(store: ScenarioStore, input: { subject?: string | null; playerId?: string | null }): Promise<string> {
  const subject = input.subject?.trim() || null;
  if (subject) return store.upsertPlayer(randomUUID(), subject);
  const requested = input.playerId?.trim() ?? '';
  if (uuid.test(requested)) {
    const found = await store.player(requested);
    if (found?.subject === null) return found.id;
  }
  const id = randomUUID();
  await store.insertPlayer(id, null);
  return id;
}
