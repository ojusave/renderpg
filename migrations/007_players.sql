CREATE TABLE players (
  id uuid PRIMARY KEY,
  subject text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO players(id)
SELECT id FROM player_sessions;

ALTER TABLE player_sessions ADD COLUMN player_id uuid;

UPDATE player_sessions SET player_id = id WHERE player_id IS NULL;

ALTER TABLE player_sessions ALTER COLUMN player_id SET NOT NULL;

ALTER TABLE player_sessions
  ADD CONSTRAINT player_sessions_player_fk FOREIGN KEY (player_id) REFERENCES players(id);

CREATE INDEX player_sessions_player ON player_sessions (player_id);
