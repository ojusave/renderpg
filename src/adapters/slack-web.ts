import { LogLevel, WebClient, type Logger } from '@slack/web-api';
import {
  SlackRequestError,
  type ConversationRef, type ConversationSnapshot, type SlackHistory, type SlackMessage,
} from '../slack/port.js';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  setLevel: () => undefined,
  getLevel: () => LogLevel.ERROR,
  setName: () => undefined,
};

interface RawMessage {
  text?: string;
  user?: string;
  ts?: string;
  subtype?: string;
  bot_id?: string;
  reply_count?: number;
  thread_ts?: string;
}

interface RawMember {
  id?: string;
  name?: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string; email?: string };
}

/** Reads public channels, private channels, and direct messages the token can see. */
export class SlackWebHistory implements SlackHistory {
  private client: WebClient;
  private aliasCache: ConversationSnapshot['aliases'] | undefined;
  constructor(token: string, timeout: number) {
    this.client = new WebClient(token, {
      timeout, logger: silent, maxRequestConcurrency: 3, attachOriginalToWebAPIRequestError: false,
      retryConfig: { retries: 2, factor: 2, minTimeout: 1000, maxTimeout: 8000 },
    });
  }

  async listConversations(): Promise<ConversationRef[]> {
    try {
      return await this.listTypes('public_channel,private_channel,im');
    } catch (error) {
      if (error instanceof SlackRequestError && error.code === 'missing_scope') return this.listTypes('public_channel');
      throw error;
    }
  }

  private listTypes(types: string): Promise<ConversationRef[]> {
    return this.collect('users.conversations', async cursor => {
      const response = await this.client.users.conversations({
        types, exclude_archived: true, limit: 200, cursor,
      });
      const items = (response.channels ?? []).flatMap(channel => {
        if (!channel.id || channel.is_mpim) return [];
        const ref: ConversationRef = { conversationId: channel.id, kind: channel.is_im ? 'im' : 'channel' };
        return [ref];
      });
      return { items, next: response.response_metadata?.next_cursor };
    });
  }

  async latestTimestamp(conversationId: string): Promise<string | null> {
    const response = await this.invoke('conversations.history', () => this.client.conversations.history({
      channel: conversationId, inclusive: true, limit: 1,
    }));
    const message = response.messages?.[0] as RawMessage | undefined;
    return message?.ts ?? null;
  }

  async load(conversationId: string): Promise<ConversationSnapshot> {
    const aliases = await this.aliases();
    const response = await this.invoke('conversations.history', () => this.client.conversations.history({
      channel: conversationId, limit: 200,
    }));
    const byTs = new Map<string, SlackMessage>();
    for (const message of (response.messages ?? []) as RawMessage[]) this.remember(byTs, message);
    return { messages: [...byTs.values()], aliases };
  }

  private async aliases(): Promise<ConversationSnapshot['aliases']> {
    if (this.aliasCache) return this.aliasCache;
    try {
      return await this.loadAliases();
    } catch (error) {
      if (error instanceof SlackRequestError && error.code === 'missing_scope') {
        this.aliasCache = [];
        return [];
      }
      throw error;
    }
  }

  private async loadAliases(): Promise<ConversationSnapshot['aliases']> {
    const members = await this.collect('users.list', async cursor => {
      const response = await this.client.users.list({ limit: 200, cursor });
      return { items: (response.members ?? []) as RawMember[], next: response.response_metadata?.next_cursor };
    });
    this.aliasCache = members.flatMap(member => {
      if (!member.id) return [];
      const names = [member.real_name, member.name, member.profile?.display_name, member.profile?.real_name]
        .filter((name): name is string => Boolean(name && !name.includes('@')));
      return [{ userId: member.id, names }];
    });
    return this.aliasCache;
  }

  private remember(byTs: Map<string, SlackMessage>, message: RawMessage) {
    if (!message.ts || !message.user || message.bot_id || !message.text?.trim()) return;
    if (message.subtype && message.subtype !== 'thread_broadcast' && message.subtype !== 'file_share') return;
    byTs.set(message.ts, { ts: message.ts, userId: message.user, text: message.text });
  }

  private async collect<T>(method: string, read: (cursor?: string) => Promise<{ items: T[]; next?: string }>): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      if (cursor) {
        if (seen.has(cursor)) throw new SlackRequestError('cursor_loop', method);
        seen.add(cursor);
      }
      const page = await this.invoke(method, () => read(cursor));
      items.push(...page.items);
      cursor = page.next?.trim() || undefined;
    } while (cursor);
    return items;
  }

  private async invoke<T>(method: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof SlackRequestError) throw error;
      const data = error && typeof error === 'object' && 'data' in error ? (error as { data?: { error?: unknown } }).data : undefined;
      const code = typeof data?.error === 'string' ? data.error : 'request_failed';
      throw new SlackRequestError(code, method);
    }
  }
}
