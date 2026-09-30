import { successTurnBudget } from '../adventure/simulator.js';
import type { ChoiceTone } from '../adventure/definition.js';
import type { GameRecord, GameView } from './types.js';
import { actionCommand, availableActions, currentStage } from './engine.js';
import { currentChanges, currentStats } from './stats.js';

/** Projects a stored game into the player-visible API contract. */
export function visibleGame(game: GameRecord): GameView {
  const { definition, state } = game;
  const location = definition.locations.find(value => value.id === state.locationId)!;
  const entityView = (id: string) => {
    const entity = definition.entities.find(value => value.id === id)!;
    return { id: entity.id, name: entity.name, kind: entity.kind };
  };
  const ending = state.endingId ? definition.endings.find(value => value.id === state.endingId) ?? null : null;
  return {
    id: game.id,
    version: game.version,
    status: state.status,
    title: definition.title,
    objective: definition.objective,
    location: { id: location.id, name: location.name, description: location.description },
    visible_entities: definition.entities.filter(entity => state.entityLocations[entity.id] === state.locationId).map(entity => entityView(entity.id)),
    inventory: state.inventory.map(entityView),
    available_actions: availableActions(definition, state).map(action => ({ id: action.id, label: action.label, command: actionCommand(definition, action) })),
    stage: currentStage(definition, state),
    ending,
    transcript: structuredClone(game.transcript),
    stats: currentStats(state),
    stat_changes: currentChanges(state),
    turn: game.transcript.filter(turn => turn.outcome === 'applied' || turn.outcome === 'completed').length,
    turn_budget: successTurnBudget(definition),
    choice_tally: tally(definition, game.transcript),
  };
}

function tally(definition: GameRecord['definition'], transcript: GameRecord['transcript']): Record<ChoiceTone, number> {
  const counts: Record<ChoiceTone, number> = { careful: 0, team: 0, bold: 0, reckless: 0 };
  for (const turn of transcript) {
    const input = turn.input;
    if (!input || (turn.outcome !== 'applied' && turn.outcome !== 'completed')) continue;
    const action = definition.actions.find(item => item.id === input || actionCommand(definition, item).toLowerCase() === input.trim().toLowerCase());
    if (action?.tone) counts[action.tone] += 1;
  }
  return counts;
}
