import { accountOwnershipBlueprint, actionIds, endingIds, evidenceIds, setupIds, type ActionId, type EndingId, type EvidenceId, type SetupId } from './blueprint.js';

export interface TextSlot { text: string; sourceExcerpt: string }
export interface ChoiceSlot { label: string }
export interface EndingSlot { title: string; summary: string }
export interface Cast { customer: string; company: string; former_employee: string }

/** Model-written words for one telling. Each slot is shown in exactly one game state. */
export interface ScenarioFill {
  cast: Cast;
  title: string;
  objective: string;
  briefing: string;
  choices: Record<ActionId, ChoiceSlot>;
  evidence: Record<EvidenceId, TextSlot>;
  trust_result: string;
  setups: Record<SetupId, string>;
  endings: Record<EndingId, EndingSlot>;
}

const travel = /\b(visit|travel|travels|walk|drive|go to|office|head over)\b/i;

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Rejects a fill that leaves the blueprint, invents evidence, or recommends an unrealistic action. */
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
  for (const id of actionIds) {
    const label = fill.choices?.[id]?.label;
    if (!label?.trim()) errors.push(`Choice ${id} is incomplete`);
    else if (travel.test(label)) errors.push(`Choice ${id} recommends an unrealistic action`);
  }
  for (const id of endingIds) {
    const ending = fill.endings?.[id];
    if (!ending?.title?.trim() || !ending.summary?.trim()) errors.push(`Ending ${id} is incomplete`);
  }
  if (fill.choices && Object.keys(fill.choices).some(id => !actionIds.includes(id as ActionId))) errors.push('Fill contains an action outside the blueprint');
  const questions = accountOwnershipBlueprint.stages.filter(stage => stage.actions.length > 0);
  if (questions.length !== 3 || questions.some(stage => stage.actions.length !== 3)) errors.push('Every question must offer exactly three choices');
  return errors;
}
