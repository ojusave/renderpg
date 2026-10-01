import { decideActionIds, earlyActionIds, endingIds, evidenceIds, setupIds } from './blueprint.js';

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
  const choice = object({ label: text });
  const wording = object(Object.fromEntries(decideActionIds.map(id => [id, text])));
  return object({
    cast: object({ customer: text, company: text, former_employee: text }),
    title: text, objective: text, briefing: text,
    choices: object(Object.fromEntries(earlyActionIds.map(id => [id, choice]))),
    decide: object({ verified: wording, unverified: wording }),
    evidence: object(Object.fromEntries(evidenceIds.map(id => [id, slot]))),
    questions: object({ investigate: text, decide_verified: text, decide_unverified: text }),
    trust_result: text,
    setups: object(Object.fromEntries(setupIds.map(id => [id, text]))),
    endings: object(Object.fromEntries(endingIds.map(id => [id, object({ title: text, summary: text })]))),
  });
}

/** Tells the model how this case plays and what each slot must do. Shared by every author. */
export const fillInstructions = `You write one telling of a short choose-your-path training case. The player is a Render Security teammate. The source is a transcript, and this case is about the decision in that transcript. Use its people and its request. Do not invent a different incident, and do not turn it into an account transfer unless the transcript is about one. Write in the second person and present tense. Every option must be a direct answer to the question on screen, and every step must describe only the action the player just took. Do not describe a later action.

Reuse one cast in every slot. cast.customer is the person asking, cast.company is their organization, and cast.former_employee is the other person the request is about. Invent a fictional full name only when the transcript does not name them. No email addresses, real companies, real people, internal tool names, or invented policy. The request in the transcript is legitimate on every path. Do not add other claimants. When the player skipped the check, the lesson is that they could not have known, not that someone else turns up. Follow variationDirection for tone only; do not change what each action does. Every sourceExcerpt must be copied exactly from the source.

The game shows these questions. Write each question and each label about the transcript's request, 4 to 12 words, no period.
Question 1, "What do you do first?": open_record looks up the record and does nothing else. transfer_now does what they asked, immediately. turn_away tells them it cannot be done.
questions.investigate names the request they want done without a check, then asks what the player does. trace_owner checks the claim and must not say transfer. take_word skips the check; its label must not say transfer, approve, or grant, for example "Skip the check and use what they said". escalate_early hands the whole case to a Security lead and must not say transfer.
Question 3 changes with the state, and so do its labels.
questions.decide_verified says the check confirmed the request should be granted, then asks what the player does. decide.verified.transfer_account carries out the request. decide.verified.decline_transfer refuses it anyway. decide.verified.escalate asks a lead to approve a decision the player could make. These labels must not say the check was skipped.
questions.decide_unverified says the request has not been checked, then asks what the player does. decide.unverified.transfer_account carries it out on their word. decide.unverified.decline_transfer waits until someone checks. decide.unverified.escalate asks a lead to decide. These labels must not mention findings, proof, or a completed check.

Steps, each one sentence, and none of them may carry out the request:
- evidence.account_record.text: what the record shows, naming the other person. Not the asker's explanation.
- setups.investigate: the person asking states why the request should be granted and asks you to skip the check.
- evidence.owner_trace.text: one concrete clue from the transcript that names the person asking and shows the request should be granted. Do not carry out the request.
- setups.decide_verified: the check stands, they are waiting, and a lead would only add delay. Do not doubt the check.
- trust_result: you do not check the explanation. Do not accept, approve, confirm, or carry out the request.
- setups.decide_unverified: the request is still unchecked and they want an answer. Do not say it was done.
- endings: one or two sentences about that ending's single final action, using the transcript's request. Do not add a later discovery, a second claimant, or a hidden agreement. transferred_too_early says you could not have known the immediate action was safe. turned_away refuses a legitimate request. escalated_early happens after the record was read and before the claim was checked, so do not say the record was skipped. success checks, then does what they asked. unverified_transfer does it on their word, so it could have been the wrong call. declined_verified refuses after the check confirmed the request, and no lead is involved. declined_unverified refuses because nobody checked. escalated_verified delays a decision the player could make. escalated_unverified is a fair handoff of an unchecked case. Titles are 2 to 5 words.
- title: short and specific to the transcript. objective: one sentence naming the decision the transcript asks for. briefing: two sentences, who asked, what they want, and why they are in a hurry.`;
