CREATE TABLE slack_conversations (
  conversation_id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('channel', 'im')),
  status text NOT NULL CHECK (status IN ('stored', 'dropped')),
  drop_reason text,
  redacted_text text,
  content_hash text,
  message_count integer NOT NULL,
  redaction_counts jsonb NOT NULL,
  cursor_ts text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slack_conversations_body_check CHECK (
    (status = 'stored' AND redacted_text IS NOT NULL AND content_hash IS NOT NULL)
    OR (status = 'dropped' AND redacted_text IS NULL AND content_hash IS NULL)
  )
);

CREATE TABLE slack_verdicts (
  conversation_id text PRIMARY KEY REFERENCES slack_conversations(conversation_id),
  usable boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'rejected')),
  reasons jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slack_verdicts_pending_check CHECK (
    (usable AND status = 'pending') OR (NOT usable AND status = 'rejected')
  )
);
