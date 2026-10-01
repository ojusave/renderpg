const SIGNALS = [
  'account', 'access', 'customer', 'employee', 'owner', 'security', 'permission',
  'transfer', 'billing', 'deploy', 'incident', 'outage', 'approve', 'offboard',
  'onboard', 'credential', 'invoice', 'workspace',
] as const;

const MIN_MESSAGES = 4;
const MIN_SPEAKERS = 2;
const MIN_CHARS = 280;

export interface TranscriptDecision {
  usable: boolean;
  reasons: string[];
}

/** Judges a redacted transcript for the account-ownership game. Reasons are codes, never excerpts. */
export function classifyTranscript(text: string, messageCount: number, speakerCount: number): TranscriptDecision {
  const reasons: string[] = [];
  if (messageCount < MIN_MESSAGES) reasons.push('too_few_messages');
  if (speakerCount < MIN_SPEAKERS) reasons.push('single_speaker');
  if (text.length < MIN_CHARS) reasons.push('too_short');
  const lower = text.toLocaleLowerCase();
  const hits = SIGNALS.filter(signal => lower.includes(signal));
  if (hits.length < 2) reasons.push('no_workplace_incident');
  if (reasons.length > 0) return { usable: false, reasons };
  return { usable: true, reasons: ['workplace_incident'] };
}
