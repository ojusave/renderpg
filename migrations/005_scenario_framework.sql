CREATE TABLE filled_scenarios (
  id uuid PRIMARY KEY,
  blueprint_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('filling', 'ready', 'claimed', 'failed')),
  session_id uuid,
  run_id text,
  prompt text NOT NULL,
  content jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX filled_scenarios_pool ON filled_scenarios (blueprint_id, created_at)
  WHERE session_id IS NULL AND status IN ('ready', 'filling');

CREATE TABLE player_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  scenario_id uuid REFERENCES filled_scenarios(id),
  play jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE filled_scenarios
  ADD CONSTRAINT filled_scenarios_session_fk FOREIGN KEY (session_id) REFERENCES player_sessions(id);

CREATE TABLE scenario_choices (
  session_id uuid NOT NULL REFERENCES player_sessions(id),
  request_key uuid NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (session_id, request_key)
);
