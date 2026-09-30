import type { ActionDefinition, AdventureDefinition } from './definition.js';

const origin = (action: ActionDefinition) => action.requires.find(rule => rule.kind === 'at')?.locationId;
const destination = (action: ActionDefinition) => action.effects.find(rule => rule.kind === 'move')?.locationId;
const completes = (action: ActionDefinition, endingId: string) => action.effects.some(rule => rule.kind === 'complete' && rule.endingId === endingId);

/** Fills map and ending gaps that generated worlds commonly leave, so they pass simulation without another model call. */
export function repairAdventure(definition: AdventureDefinition): AdventureDefinition {
  const { actions, locations, endings, initialState } = definition;
  if (![actions, locations, endings, definition.sourceFacts].every(Array.isArray) || !initialState) return definition;
  const start = initialState.locationId;
  const fact = definition.sourceFacts[0]?.id;
  if (!fact || !locations.some(location => location.id === start)) return definition;
  const move = (from: string, to: string, verb: string, label: string): ActionDefinition => ({
    id: `${verb}_${to}_from_${from}`, verbs: [verb], targetId: to, label, sourceFactIds: [fact],
    requires: [{ kind: 'at', locationId: from }], effects: [{ kind: 'move', locationId: to }],
    successText: `You arrive at the ${locations.find(location => location.id === to)!.name}.`,
  });

  const revealable = new Set([...initialState.discoveredFacts, ...actions.flatMap(action => action.effects.flatMap(rule => rule.kind === 'reveal' ? [rule.factId] : []))]);
  const holdable = new Set([...initialState.inventory, ...actions.flatMap(action => action.effects.flatMap(rule => rule.kind === 'take' ? [rule.entityId] : []))]);
  for (const action of actions) {
    action.requires = action.requires.filter(rule => (rule.kind !== 'fact' || revealable.has(rule.factId)) && (rule.kind !== 'has' || holdable.has(rule.entityId)));
  }

  const reached = new Set([start]);
  for (let grew = true; grew;) {
    grew = false;
    for (const action of actions) {
      const [from, to] = [origin(action), destination(action)];
      if (to && (!from || reached.has(from)) && !reached.has(to)) { reached.add(to); grew = true; }
    }
  }
  for (const location of locations.filter(location => !reached.has(location.id))) {
    actions.push(move(start, location.id, 'go', `Go to the ${location.name}.`));
  }
  const hub = locations.find(location => location.id === start)!;
  const leaves = (action: ActionDefinition, from: string) => (origin(action) ?? from) === from && !!destination(action) && destination(action) !== from;
  for (const location of locations.filter(location => location.id !== start && !actions.some(action => leaves(action, location.id)))) {
    actions.push(move(location.id, start, 'return', `Return to the ${hub.name}.`));
  }

  const decisive = actions.find(action => endings.some(ending => ending.result === 'success' && completes(action, ending.id)));
  const place = (decisive && origin(decisive)) ?? start;
  for (const ending of endings.filter(ending => ending.result !== 'success' && !actions.some(action => completes(action, ending.id)))) {
    actions.push({
      id: `conclude_${ending.id}`, verbs: ['conclude'], targetId: decisive?.targetId ?? null, label: `End the case now and accept this outcome: ${ending.title}.`,
      sourceFactIds: decisive?.sourceFactIds.length ? decisive.sourceFactIds : [fact],
      requires: [{ kind: 'at', locationId: place }], effects: [{ kind: 'complete', endingId: ending.id }], successText: ending.summary,
    });
  }
  return definition;
}
