import type { AdventureDefinition, AdventureState, ChoiceTone, EndingResult, Stats } from '../adventure/definition.js';

export type TurnOutcome = 'opening' | 'applied' | 'rejected' | 'clarification' | 'completed';
export interface Turn { id: string; input: string | null; text: string; outcome: TurnOutcome }

export interface GameRecord {
  id: string;
  tokenHash: string;
  version: number;
  sourcePromptId: string;
  adventureId: string;
  definition: AdventureDefinition;
  state: AdventureState;
  transcript: Turn[];
}

export interface VisibleEntity { id: string; name: string; kind: string }
export interface VisibleAction { id: string; label: string; command: string }
export interface EarnedEnding { id: string; title: string; result: EndingResult; summary: string }
export interface GameView {
  id: string;
  version: number;
  status: AdventureState['status'];
  title: string;
  objective: string;
  location: { id: string; name: string; description: string };
  visible_entities: VisibleEntity[];
  inventory: VisibleEntity[];
  available_actions: VisibleAction[];
  stage: string;
  ending: EarnedEnding | null;
  transcript: Turn[];
  stats: Stats;
  stat_changes: Stats;
  turn: number;
  turn_budget: number;
  choice_tally: Record<ChoiceTone, number>;
}

export interface InterpretedCommand { verb: string; target: string }
