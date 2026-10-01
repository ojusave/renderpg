import { endingIds } from './blueprint.js';

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

/** Structured-output schema in reading order, so the model writes each line after the one before it. */
export function scenarioFillSchema(prompt: string): Record<string, unknown> {
  const quote = excerpts(prompt);
  const slot = object({ text, sourceExcerpt: quote.length ? { type: 'string', enum: quote } : text });
  const scene = object({ setup: text, question: text, go_ahead: text, hold_off: text, hand_off: text });
  return object({
    plan: object({ request: text, stakes: text, proper_check: text, shortcut: text, check_shows: text }),
    cast: object({ requester: text, organization: text }),
    title: text, objective: text, briefing: text,
    first: object({ look_first: text, act_now: text, refuse: text }),
    first_look: slot,
    pressure: text,
    investigate: object({ question: text, verify: text, shortcut: text, hand_off_early: text }),
    check_result: slot,
    after_check: scene,
    shortcut_result: text,
    after_shortcut: scene,
    endings: object(Object.fromEntries(endingIds.map(id => [id, object({ title: text, summary: text })]))),
  });
}

/** Tells the model how the case plays and how a person should read it. Shared by every author. */
export const fillInstructions = `You write a short choose-your-path case for Render employees, based on a real Slack conversation. A person plays it in two minutes. Write it the way a good game writer would: plain words, short sentences, concrete details, and a story that makes sense from the first line to the last.

The source is a redacted Slack transcript, and this case is about the decision in that transcript. Use what actually happened: who asked for what, why it mattered, and how it should be checked. Speakers may appear as "Speaker A"; give them believable fictional names. Keep the transcript's facts. No email addresses, real companies, secrets, internal tool names, or invented company policy. variationDirection changes tone and details only.

How the game plays. The player is the Render teammate handling the case and makes up to three choices.
1. After the briefing the game asks "What do you do first?" with first.look_first (look into it before acting; continues), first.act_now (do what was asked right away; ends), first.refuse (say no; ends).
2. After look_first the player reads first_look, then pressure, then investigate.question, which asks what the player will accept as proof. Options: verify (get plan.proper_check; continues), shortcut (accept plan.shortcut as enough; continues), hand_off_early (pass the case to a Security lead; ends).
3. After verify the player reads check_result, then after_check.setup and after_check.question. After shortcut the player reads shortcut_result, then after_shortcut.setup and after_shortcut.question. Each has go_ahead, hold_off, and hand_off, and each ends the case.
The most important rule: nothing is done until the third question. Looking, checking, and accepting the shortcut are only decisions about proof. Only go_ahead and act_now carry out the request.
The request is genuine on every path. Checking properly is the right path. Acting without checking is wrong because the player could not have known, not because a twist appears later.

Fill plan first, a few words per field: request (what someone wants done), stakes (why now), proper_check (how a careful person confirms it, from the transcript), shortcut (tempting quick evidence that is not proof), check_shows (the concrete thing the proper check turns up). Every shown line must agree with the plan.

Writing rules:
- Second person, present tense; "you" is the player. Give every person a fictional first name and use it everywhere; never write "Speaker A", "a person", or "someone".
- Keep the answer hidden until the player earns it. The briefing, first_look, and pressure show only what the player could know before checking. What the proper check turns up appears only in check_result. Nobody in the story tells the player what the right choice is, and no rule or policy is quoted to them.
- Each line adds something new. Never repeat what the line before it or the question already said.
- Say what the player does, not what they don't do: "You take Sam's word for it", never "You do not verify the claim".
- A step describes only the choice just made. Nothing gets done or approved until a final choice.
- Questions: 4 to 10 words, end with "?", and don't restate the setup.
- Options: what a person would actually do, 3 to 9 words, no period. All three must be something a reasonable person might pick; never hint which is right.

Slots:
- title: 2 to 6 words. objective: one sentence on what the player must get right.
- briefing: two or three sentences: who reaches out, what they ask for, and why it is urgent. Quoting them is good.
- first_look.text: one sentence on what the player sees when they look; it raises the question without settling it. sourceExcerpt: the words from the source this is based on, copied exactly.
- pressure: one sentence: the requester pushes and offers the shortcut.
- investigate.question asks what the player will accept as proof. Its options are sources of proof, not actions on the request.
- check_result.text: one sentence on what the proper check turns up. sourceExcerpt copied exactly from the source.
- after_check.setup: one sentence: it checks out, and the requester is waiting. Options: go_ahead does what was asked; hold_off waits anyway; hand_off asks a lead to sign off.
- shortcut_result: one sentence: the player decides the shortcut is enough, and what it does and doesn't prove. The request is not carried out yet.
- after_shortcut.setup: one sentence: it still isn't confirmed, and the requester wants an answer. Options: go_ahead does it anyway; hold_off asks for the proper check first; hand_off passes it to a lead.
- endings: title 2 to 5 words; summary at most two sentences: what happens because of the player's final choice, then the takeaway. Each ending is about its one final choice only. acted_too_early: did it right away; it worked out, but nothing showed it was safe. refused: said no to a genuine request, and the requester is stuck. handed_off_early: passed it on after the first look; a lead does the check the player could have done. success: checked properly, then did it. acted_unchecked: did it on the shortcut alone; it could have been the wrong call. held_after_check: held off although the check confirmed it, so the requester is stuck for no reason. held_unchecked: held off until it is properly checked; safe but slower. handed_off_after_check: asked a lead to sign off on something already confirmed, which only adds delay. handed_off_unchecked: handed an unconfirmed case to a lead, a reasonable handoff.

Example of the voice, from a different case. Do not copy its facts.
briefing: "Sam Ortiz from Bluefin Health messages Support at 6 a.m.: someone deleted their production database overnight. "Our clinics open at 8. Please just bring it back.""
first: "Check what happened to the database" / "Restore it for Sam right now" / "Tell Sam deleted databases are gone"
first_look: "The database was deleted at 2:14 a.m. by a teammate's login, and Sam isn't an admin on the workspace."
pressure: "Sam pastes a screenshot of the team chat where the admin asks Sam to sort it out."
investigate: "What will you accept as proof?" / "A reply from the workspace admin" / "Sam's chat screenshot" / "Pass it to a Security lead"
check_result: "Lena, the admin, replies from her own account: she asked Sam to get it restored."
after_check: "Sam asks if it's done yet." / "What do you do?" / "Restore the database" / "Wait a bit longer" / "Ask a lead to sign off"
shortcut_result: "You decide the screenshot is enough, though it could easily be edited."
after_shortcut: "Sam asks if it's done yet." / "What do you do?" / "Restore it on the screenshot" / "Ask Lena to confirm first" / "Pass it to a Security lead"
success summary: "You checked with Lena before restoring, so the clinics opened on time and the right person made the call."`;
