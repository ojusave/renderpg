import { caseBlueprint, decideActionIds, endingIds, type DecideActionId, type EndingId } from './blueprint.js';

export interface TextSlot { text: string; sourceExcerpt: string }
export interface EndingSlot { title: string; summary: string }
export interface Cast { requester: string; organization: string }
/** The story the model commits to before writing any shown line. Never shown to the player. */
export interface CasePlan { request: string; stakes: string; proper_check: string; shortcut: string; check_shows: string }
/** The last question as it reads in one state, with its three options. */
export type DecideScene = { setup: string; question: string } & Record<DecideActionId, string>;

/** Model-written words for one telling, in the order a player reads them. */
export interface ScenarioFill {
  plan: CasePlan;
  cast: Cast;
  title: string;
  objective: string;
  briefing: string;
  first: { look_first: string; act_now: string; refuse: string };
  first_look: TextSlot;
  pressure: string;
  investigate: { question: string; verify: string; shortcut: string; hand_off_early: string };
  check_result: TextSlot;
  after_check: DecideScene;
  shortcut_result: string;
  after_shortcut: DecideScene;
  endings: Record<EndingId, EndingSlot>;
}

const travel = /\b(visit|travel|travels|walk|drive|go to|office|head over)\b/i;
const speakerLabel = /\bSpeaker [A-Z]\b/;

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function blank(value: string | undefined): boolean {
  return !value?.trim();
}

function includes(value: string | undefined, expected: string | undefined): boolean {
  return normalized(value ?? '').includes(normalized(expected ?? ''));
}

function identityErrors(fill: ScenarioFill): string[] {
  const errors: string[] = [];
  if (!blank(fill.cast?.requester) && !includes(fill.briefing, fill.cast.requester)) {
    errors.push('The briefing does not introduce the requester');
  }
  if (!blank(fill.cast?.organization) && !includes(fill.briefing, fill.cast.organization)) {
    errors.push('The briefing does not introduce the requester organization');
  }
  return errors;
}

function optionErrors(where: string, labels: Record<string, string | undefined>): string[] {
  const errors: string[] = [];
  for (const [id, label] of Object.entries(labels)) {
    if (blank(label)) errors.push(`Option ${where}.${id} is incomplete`);
    else if (travel.test(label!)) errors.push(`Option ${where}.${id} recommends an unrealistic action`);
  }
  const shown = Object.values(labels).map(label => normalized(label ?? '')).filter(Boolean);
  if (new Set(shown).size !== shown.length) errors.push(`Options in ${where} repeat each other`);
  return errors;
}

function words(value: string): string[] {
  return normalized(value).match(/[a-z0-9']{4,}/g) ?? [];
}

/** Slack lines rarely split into clean sentences, so a near-verbatim quote counts as grounded. */
function grounded(excerpt: string, prompt: string): boolean {
  if (prompt.includes(normalized(excerpt))) return true;
  const quoted = words(excerpt);
  if (quoted.length < 3) return false;
  const source = new Set(words(prompt));
  return quoted.filter(word => source.has(word)).length / quoted.length >= 0.85;
}

function excerptError(name: string, slot: TextSlot | undefined, prompt: string): string | null {
  if (blank(slot?.text) || blank(slot?.sourceExcerpt)) return `${name} is incomplete`;
  return grounded(slot!.sourceExcerpt, prompt) ? null : `${name} excerpt is not in the source`;
}

/** Rejects a fill that leaves the blueprint, hides its cast, invents evidence, or leaves a shown line empty. */
export function validateFill(fill: ScenarioFill, sourcePrompt: string): string[] {
  const prompt = normalized(sourcePrompt);
  const errors: (string | null)[] = [];
  if (blank(fill.cast?.requester) || blank(fill.cast?.organization)) errors.push('The cast is incomplete');
  if (blank(fill.title) || blank(fill.objective) || blank(fill.briefing)) errors.push('Title, objective, and briefing are required');
  errors.push(...identityErrors(fill));
  errors.push(excerptError('first_look', fill.first_look, prompt), excerptError('check_result', fill.check_result, prompt));
  if (blank(fill.pressure) || blank(fill.shortcut_result)) errors.push('Every step needs its text');
  if (blank(fill.investigate?.question)) errors.push('The second question is missing');
  errors.push(...optionErrors('first', { look_first: fill.first?.look_first, act_now: fill.first?.act_now, refuse: fill.first?.refuse }));
  errors.push(...optionErrors('investigate', { verify: fill.investigate?.verify, shortcut: fill.investigate?.shortcut, hand_off_early: fill.investigate?.hand_off_early }));
  for (const scene of ['after_check', 'after_shortcut'] as const) {
    const value = fill[scene];
    if (blank(value?.setup) || blank(value?.question)) errors.push(`The ${scene} scene is incomplete`);
    errors.push(...optionErrors(scene, Object.fromEntries(decideActionIds.map(id => [id, value?.[id]]))));
  }
  for (const id of endingIds) {
    const ending = fill.endings?.[id];
    if (blank(ending?.title) || blank(ending?.summary)) errors.push(`Ending ${id} is incomplete`);
  }
  const shown = JSON.stringify({ ...fill, plan: undefined, first_look: fill.first_look?.text, check_result: fill.check_result?.text });
  if (speakerLabel.test(shown)) errors.push('Shown text still says "Speaker" instead of a name');
  const questions = caseBlueprint.stages.filter(stage => stage.actions.length > 0);
  if (questions.length !== 3 || questions.some(stage => stage.actions.length !== 3)) errors.push('Every question must offer exactly three choices');
  return [...new Set(errors.filter((error): error is string => Boolean(error)))];
}
