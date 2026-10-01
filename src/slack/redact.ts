import type { NameAlias, SlackMessage } from './port.js';

export interface RedactOutput {
  text: string | null;
  dropped: boolean;
  dropReason: 'sensitive_content' | 'residual_pii' | null;
  counts: Record<string, number>;
  messageCount: number;
  speakerCount: number;
}

const STOP_NAMES = new Set([
  'slack', 'here', 'channel', 'team', 'the', 'and', 'you', 'for', 'with', 'this',
  'that', 'have', 'from', 'your', 'speaker', 'participant', 'teammate',
]);

/** Redacts one transcript in memory. Sensitive values discard the text instead of masking it. */
export function redactConversation(messages: readonly SlackMessage[], aliases: readonly NameAlias[]): RedactOutput {
  const ordered = [...messages].sort((left, right) => Number(left.ts) - Number(right.ts));
  const raw = ordered.map(message => stripInvisible(message.text)).join('\n');
  const sensitive = sensitiveCategory(raw);
  if (sensitive) return dropped('sensitive_content', { [sensitive]: 1 });

  const speakers = new Map<string, string>();
  for (const message of ordered) {
    if (message.userId) labelFor(speakers, message.userId);
    for (const match of stripInvisible(message.text).matchAll(/<@([A-Z0-9]+)/g)) {
      const userId = match[1];
      if (userId) labelFor(speakers, userId);
    }
  }
  const names = namePairs(aliases, speakers);
  const counts: Record<string, number> = {};
  const lines: string[] = [];
  for (const message of ordered) {
    const author = message.userId ? speakers.get(message.userId) ?? 'A participant' : 'A participant';
    const cleaned = redactText(stripInvisible(message.text), speakers, names, counts).trim();
    if (!cleaned) continue;
    lines.push(`${author}: ${cleaned}`);
  }
  const text = lines.join('\n');
  if (containsResidual(text)) return dropped('residual_pii', { ...counts, residual: 1 });
  return { text, dropped: false, dropReason: null, counts, messageCount: lines.length, speakerCount: speakers.size };
}

function dropped(reason: 'sensitive_content' | 'residual_pii', counts: Record<string, number>): RedactOutput {
  return { text: null, dropped: true, dropReason: reason, counts, messageCount: 0, speakerCount: 0 };
}

function redactText(value: string, speakers: Map<string, string>, names: NamePair[], counts: Record<string, number>): string {
  let next = value;
  next = replace(next, /<mailto:[^|>]+(?:\|[^>]+)?>/gi, '[email]', counts, 'email');
  next = next.replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (_match, userId: string) => {
    bump(counts, 'mention');
    return speakers.get(userId) ?? 'a teammate';
  });
  next = replace(next, /<#[A-Z0-9]+(?:\|[^>]+)?>/g, 'a channel', counts, 'channel');
  next = replace(next, /<!subteam\^[A-Z0-9]+(?:\|[^>]+)?>/g, 'a team', counts, 'team');
  next = replace(next, /<!(?:here|channel|everyone)>/g, 'a channel', counts, 'channel');
  next = replace(next, /<https?:\/\/[^|>]+(?:\|[^>]+)?>/gi, '[link]', counts, 'link');
  next = replace(next, /https?:\/\/\S+/gi, '[link]', counts, 'link');
  next = replace(next, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]', counts, 'email');
  next = replace(next, /\b(?:\+?\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[phone]', counts, 'phone');
  next = replaceIps(next, counts);
  next = next.replace(/\b([UW][A-Z0-9]{8,})\b/g, (_match, userId: string) => {
    bump(counts, 'mention');
    return speakers.get(userId) ?? 'a teammate';
  });
  next = replace(next, /\b[CDG][A-Z0-9]{8,}\b/g, 'a channel', counts, 'channel');
  return applyNames(next, names, counts);
}

function replaceIps(value: string, counts: Record<string, number>): string {
  return value.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, match => {
    if (!match.split('.').every(part => Number(part) <= 255)) return match;
    bump(counts, 'ip');
    return '[ip]';
  });
}

interface NamePair { name: string; replacement: string }

function namePairs(aliases: readonly NameAlias[], speakers: Map<string, string>): NamePair[] {
  const owners = new Map<string, { name: string; ids: Set<string> }>();
  for (const alias of aliases) {
    for (const candidate of alias.names) {
      const name = candidate.trim();
      if (!usableName(name)) continue;
      const key = name.toLocaleLowerCase();
      const entry = owners.get(key) ?? { name, ids: new Set<string>() };
      entry.ids.add(alias.userId);
      owners.set(key, entry);
    }
  }
  const pairs: NamePair[] = [];
  for (const entry of owners.values()) {
    const only = entry.ids.size === 1 ? [...entry.ids][0] : undefined;
    pairs.push({ name: entry.name, replacement: only ? speakers.get(only) ?? 'a teammate' : 'a teammate' });
  }
  pairs.sort((left, right) => right.name.length - left.name.length);
  return pairs;
}

function usableName(name: string): boolean {
  return name.length >= 3 && !name.includes('@') && !STOP_NAMES.has(name.toLocaleLowerCase()) && !/^\d+$/.test(name);
}

function applyNames(value: string, pairs: NamePair[], counts: Record<string, number>): string {
  return value.split(/(\[[a-z]+\])/).map((part, index) => {
    if (index % 2 === 1) return part;
    let next = part;
    for (const pair of pairs) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(pair.name)}(?![\\p{L}\\p{N}_])`, 'giu');
      next = next.replace(pattern, () => {
        bump(counts, 'name');
        return pair.replacement;
      });
    }
    return next;
  }).join('');
}

function sensitiveCategory(value: string): string | null {
  if (/xox[baprs]-/i.test(value) || /\bsk-[A-Za-z0-9_-]{10,}/.test(value)) return 'access_token';
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return 'private_key';
  if (/\bAKIA[0-9A-Z]{16}\b/.test(value)) return 'aws_key';
  if (/hooks\.slack\.com\/services\//i.test(value)) return 'webhook';
  if (/\b(?:\d{4}[ -]){3}\d{4}\b/.test(value)) return 'card_number';
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(value)) return 'national_id';
  if (/\bbearer\s+[A-Za-z0-9\-._~+/]{12,}/i.test(value)) return 'bearer_token';
  if (credentialAssigned(value)) return 'credential';
  return null;
}

function credentialAssigned(value: string): boolean {
  const pattern = /(?:api[_-]?key|access[_-]?key|token|secret|password|passwd)\s*(?:is|=|:)\s*([A-Za-z0-9_\-./+=]{8,})/gi;
  for (const match of value.matchAll(pattern)) {
    const secret = match[1] ?? '';
    if (/^[A-Za-z0-9_\-./+=]+$/.test(secret) && (/\d/.test(secret) || /[_./+=-]/.test(secret) || secret.length >= 20)) return true;
  }
  return false;
}

function containsResidual(value: string): boolean {
  return Boolean(sensitiveCategory(value)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)
    || /\b(?:\+?\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(value)
    || /https?:\/\//i.test(value)
    || /\b[UWCDG][A-Z0-9]{8,}\b/.test(value));
}

function labelFor(speakers: Map<string, string>, userId: string): string {
  const existing = speakers.get(userId);
  if (existing) return existing;
  const label = speakers.size < 26 ? `Speaker ${String.fromCharCode(65 + speakers.size)}` : `Speaker ${speakers.size + 1}`;
  speakers.set(userId, label);
  return label;
}

function replace(value: string, pattern: RegExp, replacement: string, counts: Record<string, number>, key: string): string {
  return value.replace(pattern, () => {
    bump(counts, key);
    return replacement;
  });
}

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function stripInvisible(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
