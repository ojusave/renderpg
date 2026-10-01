import { actionIds, endingIds, evidenceIds, stepIds } from './blueprint.js';

const text = { type: 'string' };
const object = (properties: Record<string, unknown>) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});

function excerpts(prompt: string): string[] {
  const sentences = prompt.split(/(?<=[.!?])\s+/).map(value => value.trim()).filter(value => value.length > 3);
  const unique = [...new Set(sentences)];
  if (prompt.length > 800 || unique.length > 6) return [];
  return unique;
}

/** Structured-output schema for blueprint text slots. The model cannot add actions. */
export function scenarioFillSchema(prompt: string): Record<string, unknown> {
  const quote = excerpts(prompt);
  const slot = object({ text, sourceExcerpt: quote.length ? { type: 'string', enum: quote } : text });
  return object({
    title: text, objective: text, briefing: text,
    choices: object(Object.fromEntries(actionIds.map(id => [id, object({ label: text })]))),
    steps: object(Object.fromEntries(stepIds.map(id => [id, text]))),
    evidence: object(Object.fromEntries(evidenceIds.map(id => [id, slot]))),
    endings: object(Object.fromEntries(endingIds.map(id => [id, object({ title: text, summary: text })]))),
  });
}

/** Tells the model what each slot means and when the player sees it. Shared by every author. */
export const fillInstructions = `Write the words for one telling of an account-ownership training case. The player is a Security teammate. Use only the supplied source. Follow variationDirection so this telling differs from other tellings of the same source. Write professional, complete sentences in the second person. Do not invent policy, systems, documents, offices, travel, visits, credentials, or new actions. Describe the investigation in general terms. Every sourceExcerpt must be copied exactly from the source.

Each slot is shown in exactly one situation, so it must make sense in that situation and no other.
- title: a short case title. objective: one sentence saying the goal is to identify the rightful new owner before any transfer. briefing: two sentences: a customer contacted Security, and the account is tied to the email address of an employee who left.
- Question "What do you do first?" choices: open_record = look up the account record; transfer_now = hand the account to the customer immediately; turn_away = tell the customer the account cannot be recovered.
- Question "How do you identify the rightful owner?" choices: trace_owner = investigate who should own the account now; take_word = accept the customer's claim without checking it; escalate_early = hand the case to a Security lead.
- Question "What is your decision?" choices: transfer_account = transfer the account to the customer; decline_transfer = refuse the transfer; escalate = refer the decision to a Security lead.
- Choice labels are short imperative phrases of 3 to 9 words with no period. The three labels in one question must be clearly different decisions.
- steps.open_record: one sentence describing that you open the account record. evidence.account_record.text: one sentence stating what the record shows: the account is tied to the departed employee's email address.
- steps.trace_owner: one sentence describing the investigation. evidence.owner_trace.text: one sentence stating the finding: the investigation identifies the customer as the rightful new owner.
- steps.take_word: one sentence saying you accept the customer's claim without verifying it.
- Endings: each summary is one or two sentences that explain the outcome and why. transferred_too_early: you handed over the account before checking anything. turned_away: you told a customer with a real claim the account was lost. escalated_early: you opened the record but escalated before investigating who owns the account, so a lead must do that investigation. success: you verified the customer was the rightful owner and transferred the account. unverified_transfer: you transferred on the customer's word alone, so the account could have gone to the wrong person. declined_verified: you refused even though your investigation confirmed the customer, leaving the rightful owner locked out. declined_unverified: you refused because ownership was never verified, which is safe but leaves the case unresolved. escalated_verified: you escalated even though you had verified the owner, delaying a transfer you could have made. escalated_unverified: you escalated because you had not verified ownership, which is a reasonable handoff.`;
