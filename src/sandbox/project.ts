import { randomUUID } from 'node:crypto';
import type { ActionId } from '../scenario/blueprint.js';
import { applyChoice, presentPlay, type PlayState } from '../scenario/engine.js';
import type { ScenarioFill } from '../scenario/fill.js';
import type { GameView } from '../game/types.js';

export interface ForkJob {
  actionId: ActionId;
  fill: ScenarioFill;
  play: PlayState;
}

/** Applies one action to a copy of the play-through and returns the view that choice would produce. */
export function projectFork(fill: ScenarioFill, play: PlayState, action: ActionId, playId = randomUUID()): GameView {
  return presentPlay(playId, fill, applyChoice(structuredClone(play), fill, action));
}
