CREATE TABLE IF NOT EXISTS scenarios (
  id text PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  prompt text NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY,
  creation_key uuid NOT NULL UNIQUE,
  request_hash text NOT NULL,
  version integer NOT NULL CHECK (version >= 0),
  record jsonb NOT NULL,
  initial_record jsonb NOT NULL,
  opening jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS turn_requests (
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (game_id, request_key)
);
INSERT INTO scenarios(id, version, prompt) VALUES (
  'account-ownership', 1,
  'Create a short Zork-inspired fictional account-ownership investigation. A customer lost access when the employee whose email owned the account left. The player is a security investigator who gathers clues, identifies the rightful new owner, and performs a simulated transfer. Use the supplied blueprint unchanged. Create evocative but concise room descriptions and milestone names. Never reveal the rightful owner, evidence contents, or hidden solution in the opening or descriptions. The world is a modern workplace with light fantasy. Do not describe real security policy or claim any real account action. Output only the requested structured flavor fields. The same stored prompt should yield varied prose for each blueprint.'
) ON CONFLICT (id) DO NOTHING;
