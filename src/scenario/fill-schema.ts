import { actionIds, endingIds, evidenceIds, setupIds } from './blueprint.js';

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

/** Structured-output schema for blueprint text slots. Cast comes first so the model plans names before prose. */
export function scenarioFillSchema(prompt: string): Record<string, unknown> {
  const quote = excerpts(prompt);
  const slot = object({ text, sourceExcerpt: quote.length ? { type: 'string', enum: quote } : text });
  return object({
    cast: object({ customer: text, company: text, former_employee: text }),
    title: text, objective: text, briefing: text,
    choices: object(Object.fromEntries(actionIds.map(id => [id, object({ label: text })]))),
    evidence: object(Object.fromEntries(evidenceIds.map(id => [id, slot]))),
    trust_result: text,
    setups: object(Object.fromEntries(setupIds.map(id => [id, text]))),
    endings: object(Object.fromEntries(endingIds.map(id => [id, object({ title: text, summary: text })]))),
  });
}

/** Tells the model how this case plays and what each slot must do. Shared by every author. */
export const fillInstructions = `You write one telling of a short choose-your-path training case, in the style of a good interactive-fiction game. The player is a Render Security teammate. Write in the second person and present tense, in plain professional English. The player must always understand who is involved, what just happened, and why each option is tempting.

What happened comes only from the source: a customer contacted Security because the account they need was tied to the email address of an employee who left, so the account left with them, and Security had to investigate to identify the rightful new owner before transferring it. Do not invent Render policy, internal tool names, or procedures. To make the case easy to follow, invent a small fictional cast and reuse it in every slot: cast.customer is a full name for the customer, cast.company is the customer's fictional company, cast.former_employee is the full name of the employee who left. Refer to people by name, never as "the requester". Do not write email addresses, real company names, or real people. The facts are the same on every path: the customer really is the rightful new owner, and nobody else has a claim. Never introduce other people, rival claimants, or new facts in results or endings; when the player skipped verification, the lesson is that they could not have known, not that someone else turns up. Follow variationDirection so this telling differs from others of the same source. Every sourceExcerpt must be copied exactly from the source.

How the case plays. The game shows: the briefing, then question 1. After an investigation choice it shows one result sentence plus one setup sentence, then the next question. After a final choice it shows the ending summary.
Question 1, "What do you do first?": open_record (look up the account record), transfer_now (give the customer the account right away), turn_away (tell the customer the account cannot be recovered).
Question 2, "How do you identify the rightful owner?": trace_owner (investigate who should own the account now), take_word (accept the customer's claim without checking), escalate_early (hand the case to a Security lead).
Question 3, "What is your decision?": transfer_account, decline_transfer, escalate (refer the decision to a Security lead).

Rules for each slot.
- title: a short, specific case title. objective: one sentence: identify the rightful new owner before any transfer.
- briefing: two sentences. Who contacted Security and what they want, that the account is tied to the departed employee's email address, and why the customer is in a hurry. The hurry makes giving them the account right away tempting.
- choices: each label is a short action of 4 to 10 words with no period, in the player's voice, naming people where it helps. Give every option a believable motive so a reasonable person could pick it, for example speed, caution, or getting help. Never mark an option as right or wrong. Question 3 labels are shown whether or not the player verified ownership, so they must not mention findings, proof, or checking.
- evidence.account_record.text: one sentence describing what the record shows, using the cast names. Do not repeat the choice label.
- setups.investigate: one sentence that follows that finding and raises the next question: the customer offers an explanation of why they should own it and pushes to skip checks.
- evidence.owner_trace.text: one sentence describing one concrete, plausible clue the investigation turned up and what it proves: that the customer is the rightful new owner.
- setups.decide_verified: one sentence: the confirmation is solid and the customer is waiting, though handing the call to a lead or holding off still feels safer. Do not cast doubt on the confirmation.
- trust_result: one sentence: you accept the customer's explanation as enough without checking it. Nothing has been transferred yet, and nothing new is learned.
- setups.decide_unverified: one sentence: all you have is the customer's word, and they want an answer.
- endings: each summary is one or two sentences and must not retell the whole path. Say what happens next to the people in the case, recall the specific choice that led here, and make the lesson clear without lecturing. Each ending describes only the one final action named here; for example, a decline ending never mentions escalating. transferred_too_early: handed over before checking anything; it turns out fine for the customer, and the summary must say the player could not have known it was safe. turned_away: told a customer with a real claim the account was lost. escalated_early: escalated after reading the record but before investigating ownership. success: verified through investigation, then transferred. unverified_transfer: transferred on the customer's word alone, so it could have gone to the wrong person. declined_verified: refused even though the investigation confirmed the customer, leaving the rightful owner locked out; no lead is involved. declined_unverified: refused because ownership was never verified, which is safe but leaves the customer waiting. escalated_verified: escalated after verifying, delaying a transfer the player could have made. escalated_unverified: escalated because nothing was verified, a fair handoff. Ending titles are 2 to 5 words.`;
