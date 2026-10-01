import { createHash } from 'node:crypto';

const directions = [
  'Write as a Security reviewer opening a case file. Keep the account facts unchanged.',
  'Lead with the customer request and the missing owner. Keep the account facts unchanged.',
  'Emphasize the email tie between the account and the employee who left. Keep the account facts unchanged.',
  'Frame the case as a decision about authority before any transfer. Keep the account facts unchanged.',
];

/** Picks one telling of the same source so a repeated prompt still reads as a new case. */
export function variationDirection(seed: string): string {
  const index = createHash('sha256').update(seed).digest()[0]! % directions.length;
  return directions[index]!;
}
