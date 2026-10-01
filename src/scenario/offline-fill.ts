import { createHash } from 'node:crypto';
import { defaultScenarioPrompt } from './default-prompt.js';
import type { ScenarioFill } from './fill.js';

const excerpt = defaultScenarioPrompt.split('. ')[0] + '.';
const tellings = [
  { title: 'Rightful account owner', briefing: 'Security received a request to transfer an account after the employee who owned it left the company. Confirm the record and the requester’s authority before any transfer.', review: 'Review the account record' },
  { title: 'Customer account request', briefing: 'A customer asked Security to name the rightful new owner after the former employee left. Check the account record before you record a transfer.', review: 'Read the account record' },
  { title: 'Account tied to a former employee', briefing: 'The account was tied to an employee who left, so the record and the requester both need review. Establish authority before the transfer is recorded.', review: 'Examine the account record' },
  { title: 'Authority before transfer', briefing: 'This case starts with a customer request and an account that left with a former employee. Review the history, then decide whether authority is clear.', review: 'Inspect the account record' },
];

/** Deterministic slot fill for tests and local play. The seed changes the telling, not the facts. */
export function offlineFill(prompt = defaultScenarioPrompt, variationSeed = 'offline'): ScenarioFill {
  const sourceExcerpt = prompt.includes(excerpt) ? excerpt : prompt.slice(0, 120);
  const telling = tellings[createHash('sha256').update(variationSeed).digest()[0]! % tellings.length]!;
  const evidence = (text: string) => ({ text, sourceExcerpt });
  const choice = (label: string, consequence: string) => ({ label, consequence });
  return {
    title: telling.title,
    objective: 'Identify the rightful new owner before transferring the account.',
    briefing: telling.briefing,
    evidence: {
      account_record: evidence('The account record shows the former employee as the owner because the account was tied to that employee’s email address.'),
      ownership_history: evidence('The ownership history confirms the account effectively left with the former employee.'),
      requester_authority: evidence('The customer contacted Security and can be confirmed as the rightful new owner only after the record is checked.'),
    },
    choices: {
      review_account_record: choice(telling.review, 'You review the account record before considering a transfer.'),
      check_ownership_history: choice('Check the ownership history', 'You check how ownership changed when the employee left.'),
      verify_requester_authority: choice('Verify the requester’s authority', 'You confirm the requester’s authority against the account record.'),
      request_more_evidence: choice('Request more evidence', 'You ask for evidence instead of transferring the account on the request alone.'),
      transfer_account: choice('Transfer the account', 'You record a transfer decision.'),
      decline_transfer: choice('Decline the transfer', 'You decline the transfer because authority is not established.'),
      escalate: choice('Escalate to Security', 'You escalate the case for a documented Security review.'),
    },
    endings: {
      success: { title: 'Account transferred', summary: 'You identified the rightful new owner and transferred the account only after verification.' },
      escalation: { title: 'Escalated for review', summary: 'You escalated instead of transferring an account without sufficient authority.' },
      incorrect_transfer: { title: 'Transferred too early', summary: 'You transferred the account before verifying the rightful new owner.' },
      declined: { title: 'Transfer declined', summary: 'You declined the transfer rather than act on an unverified request.' },
    },
  };
}
