import type { AdventureDefinition, AdventureState } from './definition.js';
import { actionAllowed, applyAction, isMoveOnly } from '../game/engine.js';

export interface SimulationReport {
  valid: boolean;
  reachableEndings: string[];
  exploredStates: number;
  errors: string[];
}

function key(state: AdventureState): string {
  return JSON.stringify({
    locationId: state.locationId,
    inventory: [...state.inventory].sort(),
    discoveredFacts: [...state.discoveredFacts].sort(),
    entityLocations: Object.fromEntries(Object.entries(state.entityLocations).sort()),
    flags: Object.fromEntries(Object.entries(state.flags).sort()),
    counters: Object.fromEntries(Object.entries(state.counters).sort()),
    status: state.status,
    endingId: state.endingId,
  });
}

/** Explores the finite action graph and reports reachable declared endings. */
export function simulateAdventure(definition: AdventureDefinition, maxDepth = 20, maxStates = 5000): SimulationReport {
  const queue: { state: AdventureState; depth: number }[] = [{ state: structuredClone(definition.initialState), depth: 0 }];
  const seen = new Set<string>();
  const reachable = new Set<string>();
  while (queue.length && seen.size < maxStates) {
    const current = queue.shift()!;
    const stateKey = key(current.state);
    if (seen.has(stateKey)) continue;
    seen.add(stateKey);
    if (current.state.endingId) {
      reachable.add(current.state.endingId);
      continue;
    }
    if (current.depth >= maxDepth) continue;
    for (const action of definition.actions) {
      if (!actionAllowed(current.state, action)) continue;
      const next = applyAction(definition, current.state, action).state;
      if (key(next) !== stateKey) queue.push({ state: next, depth: current.depth + 1 });
    }
  }
  const missing = definition.endings.map(ending => ending.id).filter(id => !reachable.has(id));
  const success = definition.endings.filter(ending => ending.result === 'success').some(ending => reachable.has(ending.id));
  const errors = [
    ...(!success ? ['No success ending is reachable within the turn bound'] : []),
    ...(success && successTurnBudget(definition) > maxPlayerTurns ? [`A success ending must be reachable within ${maxPlayerTurns} decisions`] : []),
    ...(missing.length ? [`Unreachable endings: ${missing.join(', ')}`] : []),
    ...(seen.size >= maxStates ? [`State exploration exceeded ${maxStates} states`] : []),
  ];
  return { valid: errors.length === 0, reachableEndings: [...reachable], exploredStates: seen.size, errors };
}

export const maxPlayerTurns = 4;

/** Counts the fewest decisions (moves are free) needed to reach a success ending. */
export function successTurnBudget(definition: AdventureDefinition): number {
  const queue: { state: AdventureState; depth: number }[] = [{ state: structuredClone(definition.initialState), depth: 0 }];
  const seen = new Set<string>();
  while (queue.length && seen.size < 5000) {
    const current = queue.shift()!;
    const stateKey = key(current.state);
    if (seen.has(stateKey)) continue;
    seen.add(stateKey);
    if (current.state.endingId) {
      const ending = definition.endings.find(item => item.id === current.state.endingId);
      if (ending?.result === 'success' || ending?.result === 'partial_success') return Math.max(1, current.depth);
      continue;
    }
    if (current.depth >= 20) continue;
    for (const action of definition.actions) {
      if (!actionAllowed(current.state, action)) continue;
      const next = applyAction(definition, current.state, action).state;
      if (key(next) === stateKey) continue;
      if (isMoveOnly(action)) queue.unshift({ state: next, depth: current.depth });
      else queue.push({ state: next, depth: current.depth + 1 });
    }
  }
  return maxPlayerTurns;
}

/** Decisions a player may make before the case closes. */
export function turnBudget(_definition: AdventureDefinition): number {
  return maxPlayerTurns;
}
