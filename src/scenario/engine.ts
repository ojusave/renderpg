import { randomUUID } from 'node:crypto';
import { INITIAL_STATS, type ChoiceTone, type EndingResult, type Stats } from '../adventure/definition.js';
import type { GameView, Turn } from '../game/types.js';
import { caseBlueprint, type ActionId, type EndingId, type EvidenceId, type StageId } from './blueprint.js';
import type { ScenarioFill } from './fill.js';

/** The question on screen. It changes with the stage so every listed option answers it. */
export function stageQuestion(fill: ScenarioFill, stage: StageId, verified: boolean): string {
  if (stage === 'investigate') return fill.investigate.question;
  if (stage === 'decide') return (verified ? fill.after_check : fill.after_shortcut).question;
  return stage === 'intake' ? 'What do you do first?' : 'Resolution';
}

/** The option label for this action in the current state. The last question has two wordings. */
export function choiceLabel(fill: ScenarioFill, action: ActionId, verified: boolean): string {
  return rawLabel(fill, action, verified).trim().replace(/\.$/, '');
}

function rawLabel(fill: ScenarioFill, action: ActionId, verified: boolean): string {
  switch (action) {
    case 'look_first': case 'act_now': case 'refuse': return fill.first[action];
    case 'verify': case 'shortcut': case 'hand_off_early': return fill.investigate[action];
    default: return (verified ? fill.after_check : fill.after_shortcut)[action];
  }
}

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
  acted_too_early: 'failure', refused: 'failure', handed_off_early: 'partial_success',
  success: 'success', acted_unchecked: 'failure',
  held_after_check: 'failure', held_unchecked: 'partial_success',
  handed_off_after_check: 'partial_success', handed_off_unchecked: 'partial_success',
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
  return caseBlueprint.stages.find(item => item.id === state.stage)?.actions ?? [];
}

const sentenceEnd = /(?<!\b(?:a\.m|p\.m|e\.g|i\.e|Mr|Ms|Mrs|Dr|vs|etc|[A-Z]))[.!?]["”']?(?=\s+["“]?[A-Z0-9]|\s*$)/g;

function sentences(text: string): string[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  const parts: string[] = [];
  let from = 0;
  for (const match of flat.matchAll(sentenceEnd)) {
    const to = match.index! + match[0].length;
    const before = flat.slice(0, to);
    const straight = (before.match(/"/g) ?? []).length;
    const curly = (before.match(/\u201c/g) ?? []).length - (before.match(/\u201d/g) ?? []).length;
    if (straight % 2 === 1 || curly > 0) continue;
    parts.push(flat.slice(from, to).trim());
    from = to;
  }
  const rest = flat.slice(from).trim();
  if (rest) parts.push(rest);
  return parts;
}

/** Keeps game master text to at most two sentences. */
export function twoSentences(text: string): string {
  return sentences(text).slice(0, 2).join(' ');
}

function firstSentence(text: string): string {
  return sentences(text)[0] ?? '';
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
    case 'look_first': return { tone: 'careful', changes: { focus: 4 }, next: 'investigate', reveal: 'first_look' };
    case 'act_now': return { tone: 'reckless', changes: { reputation: -12 }, ending: 'acted_too_early' };
    case 'refuse': return { tone: 'bold', changes: { reputation: -8 }, ending: 'refused' };
    case 'verify': return { tone: 'careful', changes: { focus: 4, team_trust: 4 }, next: 'decide', reveal: 'check_result', verified: true };
    case 'shortcut': return { tone: 'bold', changes: { reputation: -4 }, next: 'decide' };
    case 'hand_off_early': return { tone: 'team', changes: { team_trust: 2 }, ending: 'handed_off_early' };
    case 'go_ahead': return verified
      ? { tone: 'careful', changes: { reputation: 10, team_trust: 6 }, ending: 'success' }
      : { tone: 'reckless', changes: { reputation: -12 }, ending: 'acted_unchecked' };
    case 'hold_off': return verified
      ? { tone: 'bold', changes: { reputation: -6 }, ending: 'held_after_check' }
      : { tone: 'careful', changes: { reputation: 2 }, ending: 'held_unchecked' };
    case 'hand_off': return verified
      ? { tone: 'team', changes: { team_trust: 2 }, ending: 'handed_off_after_check' }
      : { tone: 'team', changes: { team_trust: 6 }, ending: 'handed_off_unchecked' };
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
  const result = outcome.reveal ? fill[outcome.reveal].text : fill.shortcut_result;
  const setup = outcome.next === 'investigate' ? fill.pressure
    : base.verified ? fill.after_check.setup : fill.after_shortcut.setup;
  const text = `${firstSentence(result)} ${firstSentence(setup)}`;
  return { ...base, stage: outcome.next!, transcript: [...state.transcript, said(action, 'applied', text)] };
}

/** Projects a play-through into the existing game view. */
export function presentPlay(playId: string, fill: ScenarioFill, state: PlayState): GameView {
  const stage = caseBlueprint.stages.find(item => item.id === state.stage)!;
  const question = stageQuestion(fill, state.stage, state.verified);
  const evidence = state.revealed.map(id => fill[id].text).join('\n');
  const ending = state.endingId ? { id: state.endingId, result: endingResult[state.endingId], ...fill.endings[state.endingId] } : null;
  return {
    id: playId, version: state.version, status: state.status, title: fill.title, objective: fill.objective,
    location: { id: stage.id, name: question, description: evidence ? `${fill.briefing}\n${evidence}` : fill.briefing },
    visible_entities: state.revealed.map(id => ({ id, name: fill[id].text.slice(0, 80), kind: 'clue' })),
    inventory: [], available_actions: legalActions(state).map(id => ({ id, label: choiceLabel(fill, id, state.verified), command: id })),
    stage: question, ending, transcript: state.transcript, stats: state.stats, stat_changes: state.lastChanges,
    turn: state.used.length, turn_budget: 3, choice_tally: state.tally,
  };
}
