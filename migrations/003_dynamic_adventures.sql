CREATE TABLE IF NOT EXISTS schema_metadata (
  key text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_metadata WHERE key = 'dynamic-adventures-v2') THEN
    DROP TABLE IF EXISTS turn_requests;
    DROP TABLE IF EXISTS games;
    DROP TABLE IF EXISTS scenarios;

    CREATE TABLE scenario_prompts (
      id uuid PRIMARY KEY,
      source_type text NOT NULL DEFAULT 'api',
      content text NOT NULL,
      content_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX scenario_prompts_content_hash_idx ON scenario_prompts(content_hash);

    CREATE TABLE adventures (
      id uuid PRIMARY KEY,
      scenario_prompt_id uuid NOT NULL REFERENCES scenario_prompts(id) ON DELETE RESTRICT,
      variation_seed uuid NOT NULL,
      schema_version integer NOT NULL CHECK (schema_version = 2),
      definition jsonb NOT NULL,
      validation jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE games (
      id uuid PRIMARY KEY,
      adventure_id uuid NOT NULL REFERENCES adventures(id) ON DELETE RESTRICT,
      creation_key uuid NOT NULL UNIQUE,
      request_hash text NOT NULL,
      version integer NOT NULL CHECK (version >= 0),
      record jsonb NOT NULL,
      initial_record jsonb NOT NULL,
      opening jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE turn_requests (
      game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      request_key uuid NOT NULL,
      request_hash text NOT NULL,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (game_id, request_key)
    );

    INSERT INTO schema_metadata(key) VALUES ('dynamic-adventures-v2');
  END IF;
END
$migration$;
