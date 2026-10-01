import { randomUUID } from 'node:crypto';
import { INITIAL_STATS, type ChoiceTone, type EndingResult, type Stats } from '../adventure/definition.js';
import type { GameView, Turn } from '../game/types.js';
import { accountOwnershipBlueprint, type ActionId, type EndingId, type EvidenceId, type StageId } from './blueprint.js';
import type { ScenarioFill } from './fill.js';

export interface PlayState {
  stage: StageId;
  revealed: EvidenceId[];
  verified: boolean;
  used: ActionId[];
  version: number;
  status: 'active' | 'completed';
  endingId: EndingId | null;
  stats: Stats;
  lastChanges: Stats;
  tally: Record<ChoiceTone, number>;
  transcript: Turn[];
}

const zero: Stats = { energy: 0, focus: 0, reputation: 0, team_trust: 0 };

const endingResult: Record<EndingId, EndingResult> = {
  transferred_too_early: 'failure', turned_away: 'failure', escalated_early: 'partial_success',
  success: 'success', unverified_transfer: 'failure',
  declined_verified: 'failure', declined_unverified: 'partial_success',
  escalated_verified: 'partial_success', escalated_unverified: 'partial_success',
};

/** Opens a play-through on the first question. The briefing is the scene, not a choice. */
export function openPlay(fill: ScenarioFill): PlayState {
  return {
    stage: 'intake', revealed: [], verified: false, used: [], version: 0, status: 'active', endingId: null,
    stats: { ...INITIAL_STATS }, lastChanges: { ...zero }, tally: { careful: 0, team: 0, bold: 0, reckless: 0 },
    transcript: [{ id: randomUUID(), input: null, outcome: 'opening', text: `${fill.title}\n${fill.objective}\n${fill.briefing}` }],
  };
}

/** Returns the actions the blueprint allows in this state. */
export function legalActions(state: PlayState): ActionId[] {
  if (state.status === 'completed') return [];
  return accountOwnershipBlueprint.stages.find(item => item.id === state.stage)?.actions ?? [];
}

/** Keeps game master text to at most two sentences. */
export function twoSentences(text: string): string {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+/g) ?? [text.trim()];
  return sentences.slice(0, 2).map(sentence => sentence.trim()).join(' ');
}

function firstSentence(text: string): string {
  return twoSentences(text).match(/^[^.!?]+[.!?]+/)?.[0] ?? text.trim();
}

function shift(stats: Stats, changes: Stats): Stats {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  return {
    energy: clamp(stats.energy + changes.energy), focus: clamp(stats.focus + changes.focus),
    reputation: clamp(stats.reputation + changes.reputation), team_trust: clamp(stats.team_trust + changes.team_trust),
  };
}

type Outcome = { tone: ChoiceTone; changes: Partial<Stats>; next?: StageId; reveal?: EvidenceId; verified?: boolean; ending?: EndingId };

/** The whole case as a table: what each choice means in the current state. */
function outcomeOf(action: ActionId, verified: boolean): Outcome {
  switch (action) {
    case 'open_record': return { tone: 'careful', changes: { focus: 4 }, next: 'investigate', reveal: 'account_record' };
    case 'transfer_now': return { tone: 'reckless', changes: { reputation: -12 }, ending: 'transferred_too_early' };
    case 'turn_away': return { tone: 'bold', changes: { reputation: -8 }, ending: 'turned_away' };
    case 'trace_owner': return { tone: 'careful', changes: { focus: 4, team_trust: 4 }, next: 'decide', reveal: 'owner_trace', verified: true };
    case 'take_word': return { tone: 'bold', changes: { reputation: -4 }, next: 'decide' };
    case 'escalate_early': return { tone: 'team', changes: { team_trust: 2 }, ending: 'escalated_early' };
    case 'transfer_account': return verified
      ? { tone: 'careful', changes: { reputation: 10, team_trust: 6 }, ending: 'success' }
      : { tone: 'reckless', changes: { reputation: -12 }, ending: 'unverified_transfer' };
    case 'decline_transfer': return verified
      ? { tone: 'bold', changes: { reputation: -6 }, ending: 'declined_verified' }
      : { tone: 'careful', changes: { reputation: 2 }, ending: 'declined_unverified' };
    case 'escalate': return verified
      ? { tone: 'team', changes: { team_trust: 2 }, ending: 'escalated_verified' }
      : { tone: 'team', changes: { team_trust: 6 }, ending: 'escalated_unverified' };
  }
}

function said(input: string, outcome: Turn['outcome'], text: string): Turn {
  return { id: randomUUID(), input, outcome, text: twoSentences(text) };
}

/** Applies one blueprint action. The shown text always belongs to the state the choice produced. */
export function applyChoice(state: PlayState, fill: ScenarioFill, action: ActionId): PlayState {
  if (!legalActions(state).includes(action)) return {
    ...state, version: state.version + 1, lastChanges: { ...zero },
    transcript: [...state.transcript, said(action, 'rejected', 'That response is not available at this stage.')],
  };
  const outcome = outcomeOf(action, state.verified);
  const changes = { ...zero, ...outcome.changes };
  const base: PlayState = {
    ...state, used: [...state.used, action], version: state.version + 1,
    verified: state.verified || Boolean(outcome.verified),
    revealed: outcome.reveal ? [...state.revealed, outcome.reveal] : state.revealed,
    stats: shift(state.stats, changes), lastChanges: changes,
    tally: { ...state.tally, [outcome.tone]: state.tally[outcome.tone] + 1 },
  };
  if (outcome.ending) return {
    ...base, stage: 'resolution', status: 'completed', endingId: outcome.ending,
    transcript: [...state.transcript, said(action, 'completed', fill.endings[outcome.ending].summary)],
  };
  const result = outcome.reveal ? fill.evidence[outcome.reveal].text : fill.trust_result;
  const setup = outcome.next === 'investigate' ? fill.setups.investigate
    : base.verified ? fill.setups.decide_verified : fill.setups.decide_unverified;
  const text = `${firstSentence(result)} ${firstSentence(setup)}`;
  return { ...base, stage: outcome.next!, transcript: [...state.transcript, said(action, 'applied', text)] };
}

/** Projects a play-through into the existing game view. */
export function presentPlay(playId: string, fill: ScenarioFill, state: PlayState): GameView {
  const stage = accountOwnershipBlueprint.stages.find(item => item.id === state.stage)!;
  const evidence = state.revealed.map(id => fill.evidence[id].text).join('\n');
  const ending = state.endingId ? { id: state.endingId, result: endingResult[state.endingId], ...fill.endings[state.endingId] } : null;
  return {
    id: playId, version: state.version, status: state.status, title: fill.title, objective: fill.objective,
    location: { id: stage.id, name: stage.label, description: evidence ? `${fill.briefing}\n${evidence}` : fill.briefing },
    visible_entities: state.revealed.map(id => ({ id, name: fill.evidence[id].text.slice(0, 80), kind: 'clue' })),
    inventory: [], available_actions: legalActions(state).map(id => ({ id, label: fill.choices[id].label, command: id })),
    stage: stage.label, ending, transcript: state.transcript, stats: state.stats, stat_changes: state.lastChanges,
    turn: state.used.length, turn_budget: 3, choice_tally: state.tally,
  };
}
