/** A channel the bot has joined, or a direct message with the bot. */
export interface ConversationRef {
  conversationId: string;
  kind: 'channel' | 'im';
}

export interface SlackMessage {
  ts: string;
  userId: string | null;
  text: string;
}

export interface NameAlias {
  userId: string;
  names: readonly string[];
}

/** Messages plus the in-memory name list used for redaction. Neither is persisted. */
export interface ConversationSnapshot {
  messages: SlackMessage[];
  aliases: readonly NameAlias[];
}

export interface SlackHistory {
  /** Lists conversations the bot token can see. Excludes group direct messages. */
  listConversations(): Promise<ConversationRef[]>;
  /** Returns the newest Slack timestamp, including non-human events. */
  latestTimestamp(conversationId: string): Promise<string | null>;
  /** Loads the human transcript and workspace display names. */
  load(conversationId: string): Promise<ConversationSnapshot>;
}

export interface StoredConversation {
  conversationId: string;
  kind: 'channel' | 'im';
  status: 'stored' | 'dropped';
  dropReason: string | null;
  redactedText: string | null;
  contentHash: string | null;
  messageCount: number;
  redactionCounts: Record<string, number>;
  cursorTs: string;
}

export interface Verdict {
  conversationId: string;
  usable: boolean;
  status: 'pending' | 'rejected' | 'used';
  reasons: string[];
}

export interface TranscriptStore {
  get(conversationId: string): Promise<StoredConversation | null>;
  verdict(conversationId: string): Promise<Verdict | null>;
  /** Writes the redacted row and its verdict in one transaction. */
  saveOutcome(row: StoredConversation, verdict: Verdict): Promise<void>;
  close(): Promise<void>;
}

export interface IngestResult {
  conversationId: string;
  status: 'stored' | 'dropped' | 'unchanged' | 'failed';
  verdict: 'pending' | 'rejected' | null;
}

export interface SyncSummary {
  skipped: boolean;
  conversations: number;
  stored: number;
  dropped: number;
  unchanged: number;
  failed: number;
}

/** Raised by the Slack adapter. Permanent codes are conversation-scoped and are not retried. */
export class SlackRequestError extends Error {
  readonly permanent: boolean;
  constructor(readonly code: string, method: string) {
    super(`Slack ${method} failed: ${code}`);
    this.name = 'SlackRequestError';
    this.permanent = code === 'channel_not_found' || code === 'not_in_channel' || code === 'is_archived' || code === 'missing_scope';
  }
}
