import { createHash } from 'node:crypto';
import { defaultScenarioPrompt } from './default-prompt.js';
import type { ScenarioFill } from './fill.js';

const excerpt = defaultScenarioPrompt.split('. ')[0] + '.';
const casts = [
  { customer: 'Priya Shah', company: 'Northwind Labs', former_employee: 'Marcus Lee', hurry: 'her team cannot deploy until someone owns it again' },
  { customer: 'Daniel Okafor', company: 'Bluefin Health', former_employee: 'Sara Kim', hurry: 'a customer demo starts tomorrow morning' },
  { customer: 'Elena Ruiz', company: 'Cobalt Freight', former_employee: 'Tom Becker', hurry: 'an unpaid invoice will suspend the account this week' },
  { customer: 'Wei Zhang', company: 'Harbor Analytics', former_employee: 'Jess Morgan', hurry: 'the team is locked out of its production logs' },
];

/** Deterministic slot fill for tests and local play. The seed changes the telling, not the facts. */
export function offlineFill(prompt = defaultScenarioPrompt, variationSeed = 'offline'): ScenarioFill {
  const sourceExcerpt = prompt.includes(excerpt) ? excerpt : prompt.slice(0, 120);
  const cast = casts[createHash('sha256').update(variationSeed).digest()[0]! % casts.length]!;
  const { customer, company, former_employee: former } = cast;
  const first = customer.split(' ')[0]!;
  return {
    cast: { customer, company, former_employee: former },
    title: `${company}'s orphaned account`,
    objective: 'Identify the rightful new owner before you transfer the account.',
    briefing: `${customer} from ${company} contacts Security because the account the team relies on is still tied to ${former}'s email address, and ${former} left the company. ${first} needs it back fast, because ${cast.hurry}.`,
    choices: {
      open_record: { label: `Pull up the account record first` },
      transfer_now: { label: `Give ${first} the account so the team is unblocked` },
      turn_away: { label: `Tell ${first} the account left with ${former}` },
      trace_owner: { label: `Check whether ${first} should own it` },
      take_word: { label: `Skip the check and use what ${first} said` },
      escalate_early: { label: `Hand the case to a Security lead` },
    },
    decide: {
      verified: {
        transfer_account: `Transfer the account to ${first}`,
        decline_transfer: `Leave the account where it is`,
        escalate: `Ask a Security lead to approve the transfer`,
      },
      unverified: {
        transfer_account: `Transfer it to ${first} on their word`,
        decline_transfer: `Leave it until someone checks`,
        escalate: `Ask a Security lead to decide`,
      },
    },
    questions: {
      investigate: `${first} wants the account moved without a check. What do you do?`,
      decide_verified: `The check shows ${first} should own the account. What do you do with it?`,
      decide_unverified: 'You have not checked who should own the account. What do you do with it?',
    },
    evidence: {
      account_record: { text: `The record lists ${former} as the only owner, so the account left the company with ${former}.`, sourceExcerpt },
      owner_trace: { text: `You find that ${first}'s team took over ${former}'s projects, which makes ${first} the rightful new owner.`, sourceExcerpt },
    },
    trust_result: `You do not check ${first}'s explanation.`,
    setups: {
      investigate: `${first} says the team took over ${former}'s work and asks you to skip the check.`,
      decide_verified: `The check stands and ${first} is waiting, though a Security lead would only add delay.`,
      decide_unverified: `The account is still in ${former}'s name, and ${first} wants an answer today.`,
    },
    endings: {
      transferred_too_early: { title: 'Handed over unchecked', summary: `You gave ${first} the account before checking anything, so you could not know it reached the right person.` },
      turned_away: { title: `${first} turned away`, summary: `You told ${first} the account was gone, so the rightful owner stays locked out of ${company}'s account.` },
      escalated_early: { title: 'Escalated midway', summary: `You read the record but escalated before investigating, so a Security lead has to work out who owns it.` },
      success: { title: 'Rightful owner restored', summary: `Because you confirmed ${first}'s team took over ${former}'s work, the account went to the right person and ${company} is unblocked.` },
      unverified_transfer: { title: 'Transferred on trust', summary: `You moved ${company}'s account on ${first}'s word alone, so it could have gone to the wrong person.` },
      declined_verified: { title: 'Owner left locked out', summary: `Your investigation confirmed ${first}, yet you declined, so the rightful owner is still locked out.` },
      declined_unverified: { title: 'Declined without proof', summary: `You declined because ownership was never verified, which is safe but leaves ${first} waiting.` },
      escalated_verified: { title: 'Escalated a solved case', summary: `You had already confirmed ${first}, so escalating only delayed a transfer you could have made.` },
      escalated_unverified: { title: 'Handed off for review', summary: `You escalated because nothing was verified, which gives a Security lead a fair starting point.` },
    },
  };
}
