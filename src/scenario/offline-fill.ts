import { createHash } from 'node:crypto';
import { defaultScenarioPrompt } from './default-prompt.js';
import type { ScenarioFill } from './fill.js';

const excerpt = defaultScenarioPrompt.split('. ')[0] + '.';
const tellings = [
  { title: 'Rightful account owner', briefing: 'A customer contacted Security about an account they cannot reach. The account is tied to the email address of an employee who left the company.', open: 'Look up the account record' },
  { title: 'Customer account request', briefing: 'A customer asked Security for access to an account after its owner left the company. The account was registered to that former employee’s email address.', open: 'Pull up the account record' },
  { title: 'Account tied to a former employee', briefing: 'An employee left the company, and the account tied to their email address left with them. A customer has now contacted Security to recover it.', open: 'Check the account record' },
  { title: 'Ownership after a departure', briefing: 'Security has a request from a customer who lost access when an employee left. The account is still tied to that employee’s email address.', open: 'Open the account record' },
];

/** Deterministic slot fill for tests and local play. The seed changes the telling, not the facts. */
export function offlineFill(prompt = defaultScenarioPrompt, variationSeed = 'offline'): ScenarioFill {
  const sourceExcerpt = prompt.includes(excerpt) ? excerpt : prompt.slice(0, 120);
  const telling = tellings[createHash('sha256').update(variationSeed).digest()[0]! % tellings.length]!;
  return {
    title: telling.title,
    objective: 'Identify the rightful new owner before you transfer the account.',
    briefing: telling.briefing,
    choices: {
      open_record: { label: telling.open },
      transfer_now: { label: 'Hand the account to the customer now' },
      turn_away: { label: 'Tell the customer it cannot be recovered' },
      trace_owner: { label: 'Investigate who should own the account' },
      take_word: { label: 'Accept the customer’s claim as given' },
      escalate_early: { label: 'Hand the case to a Security lead' },
      transfer_account: { label: 'Transfer the account to the customer' },
      decline_transfer: { label: 'Decline the transfer' },
      escalate: { label: 'Refer the decision to a Security lead' },
    },
    steps: {
      open_record: 'You open the account record.',
      trace_owner: 'You investigate who should own the account now.',
      take_word: 'You accept the customer’s claim without verifying it.',
    },
    evidence: {
      account_record: { text: 'The record shows the account is tied to the former employee’s email address.', sourceExcerpt },
      owner_trace: { text: 'Your investigation identifies the customer as the rightful new owner.', sourceExcerpt },
    },
    endings: {
      transferred_too_early: { title: 'Transferred too early', summary: 'You handed over the account before checking anything, so you could not know it went to the right person.' },
      turned_away: { title: 'Customer turned away', summary: 'You told a customer with a real claim that the account was lost, so the rightful owner stays locked out.' },
      escalated_early: { title: 'Escalated before investigating', summary: 'You opened the record but escalated before investigating ownership, so a Security lead has to do that investigation.' },
      success: { title: 'Rightful owner restored', summary: 'You verified that the customer is the rightful new owner and transferred the account to them.' },
      unverified_transfer: { title: 'Transferred on trust', summary: 'You transferred the account on the customer’s word alone, so it could have gone to the wrong person.' },
      declined_verified: { title: 'Owner left locked out', summary: 'Your investigation confirmed the customer, yet you declined, so the rightful owner is still locked out.' },
      declined_unverified: { title: 'Declined without proof', summary: 'You declined because ownership was never verified, which is safe but leaves the case unresolved.' },
      escalated_verified: { title: 'Escalated a solved case', summary: 'You had already verified the owner, so escalating only delayed a transfer you could have made.' },
      escalated_unverified: { title: 'Handed off for review', summary: 'You escalated because ownership was not verified, which gives a Security lead a fair starting point.' },
    },
  };
}
