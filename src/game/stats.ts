import type { ActionDefinition, AdventureDefinition, AdventureState, ChoiceTone, StatId, Stats } from '../adventure/definition.js';
import { INITIAL_STATS, STAT_IDS } from '../adventure/definition.js';

const ZERO: Stats = { energy: 0, focus: 0, reputation: 0, team_trust: 0 };

function hasVerb(action: ActionDefinition, verbs: string[]): boolean {
  return action.verbs.some(verb => verbs.includes(verb));
}

/** Classifies a choice the way the play screen tallies it. */
export function choiceTone(definition: AdventureDefinition, action: ActionDefinition): ChoiceTone {
  const endingId = action.effects.find(effect => effect.kind === 'complete')?.endingId;
  const ending = endingId ? definition.endings.find(item => item.id === endingId) : undefined;
  if (ending?.result === 'failure' || hasVerb(action, ['guess', 'rush', 'blast', 'skip'])) return 'reckless';
  if (ending) return 'careful';
  if (hasVerb(action, ['ask', 'consult', 'talk'])) return 'team';
  if (hasVerb(action, ['read', 'inspect', 'examine', 'investigate', 'review'])) return 'careful';
  return 'bold';
}

function deltas(definition: AdventureDefinition, action: ActionDefinition, tone: ChoiceTone): [StatId, number][] {
  const endingId = action.effects.find(effect => effect.kind === 'complete')?.endingId;
  const ending = endingId ? definition.endings.find(item => item.id === endingId) : undefined;
  if (ending?.result === 'failure') return [['energy', -6], ['reputation', -12], ['team_trust', -8]];
  if (ending) return [['focus', 4], ['reputation', 8], ['team_trust', 6]];
  if (tone === 'team') return [['focus', 3], ['team_trust', 5]];
  if (tone === 'careful') return [['energy', -3], ['focus', 5]];
  if (tone === 'reckless') return [['focus', -4], ['reputation', -6]];
  return [['energy', -2], ['reputation', 2]];
}

/** Adds the four visible stats and one tone to a generated adventure. Existing stat effects are left alone. */
export function assignStatEffects(definition: AdventureDefinition): AdventureDefinition {
  definition.initialState.stats = { ...INITIAL_STATS, ...definition.initialState.stats };
  for (const action of definition.actions) {
    action.tone ??= choiceTone(definition, action);
    if (action.effects.some(effect => effect.kind === 'adjustStat')) continue;
    for (const [stat, amount] of deltas(definition, action, action.tone)) {
      action.effects.push({ kind: 'adjustStat', stat, amount });
    }
  }
  return definition;
}

/** Returns the four stats, using the opening baseline when an older save has none. */
export function currentStats(state: AdventureState): Stats {
  const stats = { ...INITIAL_STATS };
  for (const id of STAT_IDS) {
    const value = state.stats?.[id];
    if (typeof value === 'number' && Number.isFinite(value)) stats[id] = Math.max(0, Math.min(100, Math.round(value)));
  }
  return stats;
}

/** Returns the last turn's stat movement. Missing values are zero. */
export function currentChanges(state: AdventureState): Stats {
  const changes = { ...ZERO };
  for (const id of STAT_IDS) {
    const value = state.statChanges?.[id];
    if (typeof value === 'number' && Number.isFinite(value)) changes[id] = Math.round(value);
  }
  return changes;
}
