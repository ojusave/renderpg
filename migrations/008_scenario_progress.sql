ALTER TABLE filled_scenarios
  ADD COLUMN progress jsonb NOT NULL DEFAULT '{"phase":"queued","percent":0,"label":"Waiting for the task","outputTokens":null,"maxTokens":null,"characters":null}'::jsonb;

UPDATE filled_scenarios
  SET progress = '{"phase":"ready","percent":100,"label":"Case ready","outputTokens":null,"maxTokens":null,"characters":null}'::jsonb
  WHERE status IN ('ready', 'claimed');

UPDATE filled_scenarios
  SET progress = progress || '{"phase":"failed","label":"The case could not be prepared."}'::jsonb
  WHERE status = 'failed';
