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
const toneOf: Record<ActionId, ChoiceTone> = {
  review_account_record: 'careful', check_ownership_history: 'careful',
  verify_requester_authority: 'team', request_more_evidence: 'careful', escalate: 'team',
  decline_transfer: 'careful', transfer_account: 'bold',
};
const evidenceOf: Partial<Record<ActionId, EvidenceId>> = {
  review_account_record: 'account_record', check_ownership_history: 'ownership_history',
  verify_requester_authority: 'requester_authority', request_more_evidence: 'requester_authority',
};

/** Opens a play-through on the first question. The briefing is the scene, not a choice. */
export function openPlay(fill: ScenarioFill): PlayState {
  return {
    stage: 'review', revealed: [], verified: false, used: [], version: 0, status: 'active', endingId: null,
    stats: { ...INITIAL_STATS }, lastChanges: { ...zero }, tally: { careful: 0, team: 0, bold: 0, reckless: 0 },
    transcript: [{ id: randomUUID(), input: null, outcome: 'opening', text: `${fill.title}\n${fill.objective}\n${fill.briefing}` }],
  };
}

/** Returns the actions the blueprint allows in this state. */
export function legalActions(state: PlayState): ActionId[] {
  if (state.status === 'completed') return [];
  return accountOwnershipBlueprint.stages.find(item => item.id === state.stage)?.actions ?? [];
}

function shift(stats: Stats, changes: Stats): Stats {
  return {
    energy: Math.max(0, Math.min(100, stats.energy + changes.energy)),
    focus: Math.max(0, Math.min(100, stats.focus + changes.focus)),
    reputation: Math.max(0, Math.min(100, stats.reputation + changes.reputation)),
    team_trust: Math.max(0, Math.min(100, stats.team_trust + changes.team_trust)),
  };
}

function changesFor(action: ActionId, verified: boolean): Stats {
  if (action === 'transfer_account') return verified ? { ...zero, reputation: 10, team_trust: 6 } : { ...zero, reputation: -12 };
  if (action === 'escalate') return { ...zero, team_trust: 6 };
  if (action === 'verify_requester_authority') return { ...zero, team_trust: 8 };
  if (action === 'decline_transfer') return { ...zero, reputation: 4 };
  return { ...zero, focus: 4 };
}

function finish(state: PlayState, endingId: EndingId, text: string, input: string): PlayState {
  return {
    ...state, stage: 'resolution', status: 'completed', endingId, version: state.version + 1,
    transcript: [...state.transcript, { id: randomUUID(), input, outcome: 'completed', text }],
  };
}

/** Applies one blueprint action. Transfer succeeds only after authority is verified. */
export function applyChoice(state: PlayState, fill: ScenarioFill, action: ActionId): PlayState {
  if (!legalActions(state).includes(action)) return {
    ...state, version: state.version + 1, lastChanges: { ...zero },
    transcript: [...state.transcript, { id: randomUUID(), input: action, outcome: 'rejected', text: 'That response is not available at this stage.' }],
  };
  const choice = fill.choices[action];
  const revealed = evidenceOf[action] && !state.revealed.includes(evidenceOf[action]!) ? [...state.revealed, evidenceOf[action]!] : state.revealed;
  const verified = state.verified || action === 'verify_requester_authority';
  const changes = changesFor(action, verified);
  const tone = action === 'transfer_account' && !verified ? 'reckless' : toneOf[action];
  const next: PlayState = {
    ...state, revealed, verified, used: [...state.used, action], version: state.version + 1,
    stats: shift(state.stats, changes), lastChanges: changes, tally: { ...state.tally, [tone]: state.tally[tone] + 1 },
  };
  if (action === 'review_account_record' || action === 'check_ownership_history') {
    return { ...next, stage: 'verify', transcript: [...state.transcript, { id: randomUUID(), input: action, outcome: 'applied', text: `${fill.evidence[evidenceOf[action]!].text}\n${choice.consequence}` }] };
  }
  if (action === 'verify_requester_authority' || action === 'request_more_evidence') {
    return { ...next, stage: 'decide', transcript: [...state.transcript, { id: randomUUID(), input: action, outcome: 'applied', text: `${fill.evidence.requester_authority.text}\n${choice.consequence}` }] };
  }
  if (action === 'escalate') return finish(next, 'escalation', `${choice.consequence}\n${fill.endings.escalation.summary}`, action);
  if (action === 'decline_transfer') return finish(next, 'declined', `${choice.consequence}\n${fill.endings.declined.summary}`, action);
  const ending: EndingId = verified ? 'success' : 'incorrect_transfer';
  return finish(next, ending, `${choice.consequence}\n${fill.endings[ending].summary}`, action);
}

const endingResult: Record<EndingId, EndingResult> = {
  success: 'success', escalation: 'partial_success', incorrect_transfer: 'failure', declined: 'failure',
};

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
