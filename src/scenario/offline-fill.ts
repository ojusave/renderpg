import { createHash } from 'node:crypto';
import { defaultScenarioPrompt } from './default-prompt.js';
import type { ScenarioFill } from './fill.js';

const excerpt = defaultScenarioPrompt.split('. ')[0] + '.';
const casts = [
  { requester: 'Priya Shah', organization: 'Northwind Labs', former: 'Marcus', hurry: 'Our launch is Friday' },
  { requester: 'Daniel Okafor', organization: 'Bluefin Health', former: 'Sara', hurry: 'We have a customer demo tomorrow morning' },
  { requester: 'Elena Ruiz', organization: 'Cobalt Freight', former: 'Tom', hurry: 'Our card expires this week' },
  { requester: 'Wei Zhang', organization: 'Harbor Analytics', former: 'Jess', hurry: 'We are locked out of our production logs' },
];

/** Deterministic fill for tests and local play, written the way the model is asked to write. */
export function offlineFill(prompt = defaultScenarioPrompt, variationSeed = 'offline'): ScenarioFill {
  const sourceExcerpt = prompt.includes(excerpt) ? excerpt : prompt.slice(0, 120);
  const cast = casts[createHash('sha256').update(variationSeed).digest()[0]! % casts.length]!;
  const { requester, organization, former } = cast;
  const name = requester.split(' ')[0]!;
  return {
    plan: {
      request: `make ${name} the account owner`, stakes: cast.hurry.toLowerCase(),
      proper_check: `confirm with someone at ${organization} who has authority`,
      shortcut: `${former}'s forwarded goodbye email`, check_shows: `${organization}'s CTO confirms ${name} took over`,
    },
    cast: { requester, organization },
    title: `Locked out after ${former} left`,
    objective: `Make sure ${name} should own the account before you hand it over.`,
    briefing: `${requester} from ${organization} writes in: their Render account is owned by ${former}, who left last month, and nobody else can change billing or deploys. "${cast.hurry}. Can you make me the owner?"`,
    first: { look_first: `Look up ${organization}'s account`, act_now: `Make ${name} the owner now`, refuse: `Tell ${name} the owner can't change` },
    first_look: { text: `The account has one owner, ${former}, whose work email now bounces, and ${name} is a regular member.`, sourceExcerpt },
    pressure: `${name} forwards ${former}'s goodbye email, which names ${name} as the replacement.`,
    investigate: {
      question: `How do you confirm ${name} should take over?`,
      verify: `Ask someone at ${organization} with authority`, shortcut: 'Go by the forwarded email', hand_off_early: 'Pass it to a Security lead',
    },
    check_result: { text: `${organization}'s CTO replies from a company address: ${name} took over ${former}'s work.`, sourceExcerpt },
    after_check: {
      setup: `${name} is waiting to hear back.`, question: 'What do you do now?',
      go_ahead: `Make ${name} the owner`, hold_off: 'Wait a little longer', hand_off: 'Ask a Security lead to sign off',
    },
    shortcut_result: 'You go by the forwarded email, which looks right but anyone could paste.',
    after_shortcut: {
      setup: `${name} wants an answer today.`, question: 'What do you do now?',
      go_ahead: `Make ${name} the owner anyway`, hold_off: `Ask ${organization} to confirm first`, hand_off: 'Pass it to a Security lead',
    },
    endings: {
      acted_too_early: { title: 'Handed over blind', summary: `You made ${name} the owner without checking. It worked out, but nothing told you it was safe.` },
      refused: { title: `${name} left stuck`, summary: `You told ${name} the owner couldn't change, so ${organization} stays locked out of its own account.` },
      handed_off_early: { title: 'Passed on too soon', summary: `You handed it to a lead after one look, so they do the check you could have done.` },
      success: { title: 'Right person, right reason', summary: `You checked with ${organization} before acting, so ${name} got the account and the right person made the call.` },
      acted_unchecked: { title: 'Trusted a paste', summary: `You went by a forwarded email. It turned out fine, but it could have been the wrong call.` },
      held_after_check: { title: 'Stuck for no reason', summary: `${organization} had already confirmed ${name}, yet you held off, so ${name} is still locked out.` },
      held_unchecked: { title: 'Safe but slower', summary: `You asked ${organization} to confirm before acting. ${name} waits a bit longer, and nothing goes to the wrong person.` },
      handed_off_after_check: { title: 'An extra sign-off', summary: `You already had ${organization}'s confirmation, so the lead's sign-off only added a delay.` },
      handed_off_unchecked: { title: 'A fair handoff', summary: `Nothing was confirmed yet, so handing it to a lead was reasonable.` },
    },
  };
}
