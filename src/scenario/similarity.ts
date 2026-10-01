import type { ScenarioFill } from './fill.js';

const ignored = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'they', 'their', 'them', 'have', 'has', 'was', 'were',
  'are', 'but', 'not', 'can', 'who', 'what', 'when', 'why', 'how', 'into', 'out', 'about', 'after', 'before', 'now', 'just',
  'asks', 'ask', 'asked', 'wants', 'want', 'need', 'needs', 'please', 'right', 'away', 'today', 'messages', 'message', 'says',
]);

/** Different Slack threads share at most ~0.22 of their key words; a thread pulled in again shares 0.68 or more. */
export const sourceLimit = 0.5;
/** Cases from different threads share at most ~0.26 of their story words; the same request told twice shares 0.35. */
export const storyLimit = 0.3;

/** The words that say what a case is about: its title, objective, and briefing. */
export function storyText(fill: Pick<ScenarioFill, 'title' | 'objective' | 'briefing'>): string {
  return `${fill.title} ${fill.objective} ${fill.briefing}`;
}

function keyWords(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z][a-z'-]+/g)?.map(word => word.replace(/'s$|s$/, ''))
    .filter(word => word.length > 2 && !ignored.has(word)) ?? []);
}

/** Share of key words two stories have in common, from 0 to 1. */
export function similarity(a: string, b: string): number {
  const left = keyWords(a);
  const right = keyWords(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** True when a new case comes from the same source as a published one, or tells the same story. */
export function repeatsStory(next: { prompt: string; story: string }, published: { prompt: string; story: string }[]): boolean {
  return published.some(other => other.prompt === next.prompt
    || similarity(next.prompt, other.prompt) >= sourceLimit
    || similarity(next.story, other.story) >= storyLimit);
}
