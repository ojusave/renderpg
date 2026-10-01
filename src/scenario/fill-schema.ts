import { actionIds, endingIds, evidenceIds } from './blueprint.js';

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

/** Structured-output schema for blueprint text slots. The model cannot add actions. */
export function scenarioFillSchema(prompt: string): Record<string, unknown> {
  const quote = excerpts(prompt);
  const slot = object({ text, sourceExcerpt: quote.length ? { type: 'string', enum: quote } : text });
  const choice = object({ label: text, consequence: text });
  const ending = object({ title: text, summary: text });
  return object({
    title: text, objective: text, briefing: text,
    evidence: object(Object.fromEntries(evidenceIds.map(id => [id, slot]))),
    choices: object(Object.fromEntries(actionIds.map(id => [id, choice]))),
    endings: object(Object.fromEntries(endingIds.map(id => [id, ending]))),
  });
}
