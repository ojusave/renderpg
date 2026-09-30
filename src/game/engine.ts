import type { ActionDefinition, AdventureDefinition, AdventureState, Effect, Predicate, Stats } from '../adventure/definition.js';
import { INITIAL_STATS } from '../adventure/definition.js';

export interface Resolution {
  state: AdventureState;
  outcome: 'applied' | 'rejected' | 'clarification' | 'completed';
  facts: string;
}

/** Evaluates one closed predicate against adventure state. */
export function predicateHolds(state: AdventureState, predicate: Predicate): boolean {
  switch (predicate.kind) {
    case 'at': return state.locationId === predicate.locationId;
    case 'has': return state.inventory.includes(predicate.entityId);
    case 'fact': return state.discoveredFacts.includes(predicate.factId);
    case 'flag': return (state.flags[predicate.flag] ?? false) === predicate.value;
    case 'counter': {
      const value = state.counters[predicate.counter] ?? 0;
      return predicate.operator === 'eq' ? value === predicate.value
        : predicate.operator === 'gte' ? value >= predicate.value : value <= predicate.value;
    }
  }
}

/** Reports whether every prerequisite for an action currently holds. */
export function actionAllowed(state: AdventureState, action: ActionDefinition): boolean {
  return action.requires.every(predicate => predicateHolds(state, predicate));
}

function applyEffect(state: AdventureState, effect: Effect): void {
  switch (effect.kind) {
    case 'move': state.locationId = effect.locationId; break;
    case 'take':
      if (!state.inventory.includes(effect.entityId)) state.inventory.push(effect.entityId);
      delete state.entityLocations[effect.entityId];
      break;
    case 'drop':
      state.inventory = state.inventory.filter(id => id !== effect.entityId);
      state.entityLocations[effect.entityId] = effect.locationId;
      break;
    case 'reveal':
      if (!state.discoveredFacts.includes(effect.factId)) state.discoveredFacts.push(effect.factId);
      break;
    case 'setFlag': state.flags[effect.flag] = effect.value; break;
    case 'addCounter': state.counters[effect.counter] = Math.max(-20, Math.min(20, (state.counters[effect.counter] ?? 0) + effect.amount)); break;
    case 'adjustStat': {
      const current = state.stats ?? { ...INITIAL_STATS };
      current[effect.stat] = Math.max(0, Math.min(100, (current[effect.stat] ?? INITIAL_STATS[effect.stat]) + effect.amount));
      state.stats = current;
      break;
    }
    case 'complete': state.status = 'completed'; state.endingId = effect.endingId; break;
  }
}

/** Applies one validated action without consulting an external dependency. */
function rememberStatChanges(before: Stats, state: AdventureState): void {
  const next = state.stats ?? before;
  state.statChanges = {
    energy: next.energy - before.energy, focus: next.focus - before.focus,
    reputation: next.reputation - before.reputation, team_trust: next.team_trust - before.team_trust,
  };
}

export function applyAction(definition: AdventureDefinition, before: AdventureState, action: ActionDefinition): Resolution {
  const state = structuredClone(before);
  delete state.pendingVerb;
  state.stats = { ...INITIAL_STATS, ...state.stats };
  const baseline = { ...state.stats };
  state.statChanges = { energy: 0, focus: 0, reputation: 0, team_trust: 0 };
  if (state.status !== 'active') return { state, outcome: 'rejected', facts: 'This adventure is complete. Start a new adventure to play again.' };
  if (!actionAllowed(state, action)) return { state, outcome: 'rejected', facts: 'That action is not available yet. Investigate the current scene and try another approach.' };
  for (const effect of action.effects) applyEffect(state, effect);
  rememberStatChanges(baseline, state);
  const ending = state.endingId ? definition.endings.find(value => value.id === state.endingId) : undefined;
  return {
    state,
    outcome: ending ? 'completed' : 'applied',
    facts: ending ? `${action.successText}\n${ending.title}: ${ending.summary}` : action.successText,
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
}

function targetNames(definition: AdventureDefinition, targetId: string | null): string[] {
  if (!targetId) return [''];
  const location = definition.locations.find(value => value.id === targetId);
  const entity = definition.entities.find(value => value.id === targetId);
  return [targetId, location?.name, entity?.name].filter((value): value is string => Boolean(value)).map(normalize);
}

/** Parses and resolves one literal player command against generated actions. */
export function resolveCommand(definition: AdventureDefinition, before: AdventureState, input: string): Resolution {
  const state = structuredClone(before);
  if (state.status !== 'active') return { state, outcome: 'rejected', facts: 'This adventure is complete. Start a new adventure to play again.' };
  const normalized = input.trim().replace(/\s+/g, ' ');
  if (/^(look|l)$/i.test(normalized)) return { state, outcome: 'applied', facts: describe(definition, state) };
  if (/^(inventory|i)$/i.test(normalized)) {
    const names = state.inventory.map(id => definition.entities.find(entity => entity.id === id)?.name ?? id);
    return { state, outcome: 'applied', facts: `You carry: ${names.join(', ') || 'nothing'}.` };
  }
  if (/^(help|\?)$/i.test(normalized)) {
    const verbs = [...new Set(definition.actions.flatMap(action => action.verbs))];
    return { state, outcome: 'applied', facts: `Try: look, inventory, or ${verbs.join(', ')} followed by a visible target. Free-form requests are also supported when AI interpretation is enabled.` };
  }
  const byId = definition.actions.find(action => action.id === normalized);
  if (byId) return applyAction(definition, state, byId);
  const [rawVerb = '', ...rest] = normalized.split(' ');
  const verb = state.pendingVerb && rest.length === 0 ? state.pendingVerb : normalize(rawVerb);
  const target = state.pendingVerb && rest.length === 0 ? normalize(normalized) : normalize(rest.join(' '));
  const byVerb = definition.actions.filter(action => action.verbs.map(normalize).includes(verb));
  const matches = byVerb.filter(action => targetNames(definition, action.targetId).includes(target));
  if (matches.length === 1) return applyAction(definition, state, matches[0]!);
  if (byVerb.length > 0 && !target) {
    state.pendingVerb = verb;
    const choices = byVerb.map(action => targetNames(definition, action.targetId).at(-1)).filter(Boolean);
    if (!choices.length) return { state, outcome: 'clarification', facts: 'That response is incomplete. Choose one of the listed actions.' };
    return { state, outcome: 'clarification', facts: `What do you want to ${verb}? Choose: ${choices.join(', ')}.` };
  }
  return { state, outcome: 'clarification', facts: 'I could not match that action. Type look to review the scene or help for supported commands.' };
}

/** Returns the latest milestone whose predicates hold. */
export function currentStage(definition: AdventureDefinition, state: AdventureState): string {
  if (state.endingId) return definition.endings.find(ending => ending.id === state.endingId)?.title ?? 'Adventure complete';
  return [...definition.stages].reverse().find(stage => stage.when.every(predicate => predicateHolds(state, predicate)))?.label
    ?? definition.stages[0]?.label ?? 'In progress';
}

/** Lists the actions a player can take in the current scene. */
export function availableActions(definition: AdventureDefinition, state: AdventureState): ActionDefinition[] {
  const visible = definition.entities.filter(entity => state.entityLocations[entity.id] === state.locationId);
  return definition.actions.filter(action => actionAllowed(state, action)
    && !action.effects.some(effect => effect.kind === 'move' && effect.locationId === state.locationId)
    && (!action.targetId || definition.locations.some(location => location.id === action.targetId)
      || action.targetId === state.locationId || visible.some(entity => entity.id === action.targetId) || state.inventory.includes(action.targetId)));
}

function actionCommand(definition: AdventureDefinition, action: ActionDefinition): string {
  const verb = action.verbs[0] ?? 'look';
  if (!action.targetId) return verb;
  const name = definition.locations.find(location => location.id === action.targetId)?.name
    ?? definition.entities.find(entity => entity.id === action.targetId)?.name
    ?? action.targetId;
  return `${verb} ${name}`;
}

/** Describes only the current player-visible scene and available actions. */
export function describe(definition: AdventureDefinition, state: AdventureState): string {
  const location = definition.locations.find(value => value.id === state.locationId);
  const visible = definition.entities.filter(entity => state.entityLocations[entity.id] === state.locationId);
  const actions = availableActions(definition, state);
  return `${location?.name ?? state.locationId}\n${location?.description ?? ''}\nVisible: ${visible.map(entity => entity.name).join(', ') || 'nothing notable'}.\nPossible actions: ${actions.map(action => action.label).join('; ') || 'look around'}.`;
}

export { actionCommand };
