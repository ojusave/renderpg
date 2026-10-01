import { accountOwnershipBlueprint, decideActionIds, earlyActionIds, endingIds, evidenceIds, setupIds, type DecideActionId, type EarlyActionId, type EndingId, type EvidenceId, type SetupId } from './blueprint.js';

export interface TextSlot { text: string; sourceExcerpt: string }
export interface ChoiceSlot { label: string }
export interface EndingSlot { title: string; summary: string }
export interface Cast { customer: string; company: string; former_employee: string }
export interface DecideWording { transfer_account: string; decline_transfer: string; escalate: string }

/** Model-written words for one telling. Each slot is shown in exactly one game state. */
export interface ScenarioFill {
  cast: Cast;
  title: string;
  objective: string;
  briefing: string;
  choices: Record<EarlyActionId, ChoiceSlot>;
  decide: { verified: DecideWording; unverified: DecideWording };
  evidence: Record<EvidenceId, TextSlot>;
  questions: { investigate: string; decide_verified: string; decide_unverified: string };
  trust_result: string;
  setups: Record<SetupId, string>;
  endings: Record<EndingId, EndingSlot>;
}

const travel = /\b(visit|travel|travels|walk|drive|go to|office|head over)\b/i;
const moved = /\b(transfer(?:red|ring)?|hand(?:ed)? (?:it |the account )?over|g(?:ive|ives|ave) (?:them |the customer )?(?:[A-Z][a-z]+ )?the account|moved the account)\b/i;
const confirmed = /\b(confirm(?:ed|s|ation)?|proof|verified|you find|you found|you discover)\b/i;

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function labelOf(slot: ChoiceSlot | string | undefined): string {
  if (!slot) return '';
  return typeof slot === 'string' ? slot : slot.label;
}

/** Rejects a step or option that describes a different action from the one the player just took. */
function senseErrors(fill: ScenarioFill): string[] {
  const errors: string[] = [];
  const bad = (text: string | undefined, pattern: RegExp, message: string) => {
    if (text && pattern.test(text)) errors.push(message);
  };
  bad(fill.trust_result, moved, 'Skipping the check must not move the account');
  bad(fill.trust_result, confirmed, 'Skipping the check must not confirm the owner');
  bad(fill.trust_result, /\b(accept|approve)\b/i, 'Skipping the check must not accept or approve the request');
  bad(fill.evidence?.account_record?.text, moved, 'Reading the record must not move the account');
  bad(fill.evidence?.owner_trace?.text, moved, 'Checking ownership must not move the account');
  for (const id of setupIds) bad(fill.setups?.[id], moved, `Setup ${id} must not move the account`);
  bad(labelOf(fill.choices?.take_word), moved, 'Skipping the check is not a transfer');
  bad(labelOf(fill.choices?.trace_owner), moved, 'Checking ownership is not a transfer');
  bad(labelOf(fill.choices?.open_record), moved, 'Opening the record is not a transfer');
  bad(labelOf(fill.choices?.escalate_early), moved, 'Escalating is not a transfer');
  bad(labelOf(fill.decide?.unverified?.transfer_account), /\b(finding|proof|confirm|verified|investigation)\b/i, 'An unchecked transfer must not mention a check');
  bad(labelOf(fill.decide?.verified?.transfer_account), /\b(word|unchecked|without)\b/i, 'A checked transfer must not say the check was skipped');
  bad(labelOf(fill.decide?.verified?.decline_transfer), /\b(proof|unverified|without a check)\b/i, 'Declining after a check must not say the check is missing');
  const customer = fill.cast?.customer?.split(/\s+/)[0];
  const former = fill.cast?.former_employee?.split(/\s+/)[0];
  if (customer && fill.evidence?.owner_trace?.text && !fill.evidence.owner_trace.text.includes(customer)) errors.push('The check must name the person who asked');
  if (former && fill.evidence?.account_record?.text && !fill.evidence.account_record.text.includes(former)) errors.push('The record step must name the other person');
  for (const id of ['investigate', 'decide_verified', 'decide_unverified'] as const) {
    if (!fill.questions?.[id]?.trim()) errors.push(`Question ${id} is incomplete`);
  }
  return errors;
}

/** Rejects a fill that leaves the blueprint, invents evidence, or describes the wrong action. */
export function validateFill(fill: ScenarioFill, sourcePrompt: string): string[] {
  const errors: string[] = [];
  const prompt = normalized(sourcePrompt);
  if (!fill.cast?.customer?.trim() || !fill.cast.company?.trim() || !fill.cast.former_employee?.trim()) errors.push('The cast is incomplete');
  if (!fill.title?.trim() || !fill.objective?.trim() || !fill.briefing?.trim()) errors.push('Title, objective, and briefing are required');
  for (const id of evidenceIds) {
    const slot = fill.evidence?.[id];
    if (!slot?.text?.trim() || !slot.sourceExcerpt?.trim()) errors.push(`Evidence ${id} is incomplete`);
    else if (!prompt.includes(normalized(slot.sourceExcerpt))) errors.push(`Evidence ${id} excerpt is not in the source`);
  }
  if (!fill.trust_result?.trim()) errors.push('The trust result is required');
  for (const id of setupIds) if (!fill.setups?.[id]?.trim()) errors.push(`Setup ${id} is incomplete`);
  for (const id of earlyActionIds) {
    const label = fill.choices?.[id]?.label;
    if (!label?.trim()) errors.push(`Choice ${id} is incomplete`);
    else if (travel.test(label)) errors.push(`Choice ${id} recommends an unrealistic action`);
  }
  for (const state of ['verified', 'unverified'] as const) for (const id of decideActionIds) {
    const label = fill.decide?.[state]?.[id];
    if (!label?.trim()) errors.push(`Choice ${state} ${id} is incomplete`);
    else if (travel.test(label)) errors.push(`Choice ${state} ${id} recommends an unrealistic action`);
  }
  for (const id of endingIds) {
    const ending = fill.endings?.[id];
    if (!ending?.title?.trim() || !ending.summary?.trim()) errors.push(`Ending ${id} is incomplete`);
  }
  if (fill.choices && Object.keys(fill.choices).some(id => !earlyActionIds.includes(id as EarlyActionId))) errors.push('Fill contains an action outside the blueprint');
  for (const state of ['verified', 'unverified'] as const) {
    const wording = fill.decide?.[state];
    if (wording && Object.keys(wording).some(id => !decideActionIds.includes(id as DecideActionId))) errors.push('Fill contains an action outside the blueprint');
  }
  const questions = accountOwnershipBlueprint.stages.filter(stage => stage.actions.length > 0);
  if (questions.length !== 3 || questions.some(stage => stage.actions.length !== 3)) errors.push('Every question must offer exactly three choices');
  return [...errors, ...senseErrors(fill)];
}
