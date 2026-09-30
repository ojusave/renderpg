CREATE TABLE IF NOT EXISTS generation_jobs (
  creation_key uuid PRIMARY KEY,
  request_hash text NOT NULL,
  run_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('running', 'failed', 'published')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
