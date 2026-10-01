# Architecture decisions

## Generation flow

1. `POST /games` validates a curated source prompt and an idempotency key.
2. `AdventureCompiler` asks the configured generator for a versioned `AdventureDefinition`.
3. The validator checks the closed JSON schema, IDs, references, exact prompt excerpts, and ending requirements.
4. The simulator explores the finite state graph and rejects adventures without a reachable success or with unreachable declared endings.
5. Up to two repair generations are allowed after validation failure. A third failure returns `503` and persists nothing.
6. Postgres stores the source prompt, immutable adventure definition, validation report, initial game state, opening response, and game-scoped token hash atomically.

The model emits data only. Predicates and effects come from a closed vocabulary; generated code and free-form rule expressions are impossible.

## Variation and grounding

A new creation idempotency key is also the variation seed supplied to the generator. The model can vary game dressing, map, characters, clues, action order, complications, and endings. Every mechanical action must reference at least one source fact, and every source fact carries an exact excerpt from the prompt.

This proves provenance, not semantic truth. The incoming prompt must be curated. The console still sends the same first story on every new game: a customer account tied to an employee who left the company. Each new case claims the oldest pending Slack transcript, marks it used, and that transcript is what the case is about.

Once generated, the adventure is immutable. The same saved state and command always produce the same mechanical outcome. Player choices determine the ending; the model does not decide outcomes during play.

## Turn flow

1. Authenticate the game-scoped bearer token and check idempotency replay.
2. Parse a graph-derived literal command. If no literal command matches and natural-language interpretation is enabled, Claude may select only from generated verbs and targets.
3. Apply the action with the pure game engine. Failed prerequisites are ordinary rejected gameplay outcomes.
4. Optionally request one atmospheric sentence. Failure falls back to authoritative engine text.
5. Lock the game row in a short Postgres transaction, compare the expected version, and save state plus response together.

No database transaction remains open during a model call. An interrupted client can replay the same request key and exact payload safely.

## Fault boundaries

- Adventure generation is critical for new games. Invalid output or provider failure creates no partial game.
- Postgres is critical. Transaction failure rolls back state and the idempotency response.
- Natural-language interpretation is non-critical. Failure returns deterministic clarification.
- Narration is non-critical. Failure returns engine facts.
- Saved games remain playable when generation is disabled.

## Render deployment

The MVP uses one Render Web Service and Render Postgres over the private network. The server binds to `0.0.0.0:$PORT`; `/health` checks Postgres without making a paid provider request. `render.yaml` defines migrations, secrets, preview environments, and health checks.

`compileAdventure` remains available for the older adventure API. The product uses `decision_case_v1`, an authored blueprint built from whatever decision the Slack transcript is about. It has three questions with three choices each: what to do first, what to accept as proof, and whether to act. Nothing is done until the third question, and its setup and options change depending on whether the player checked properly or took the shortcut. The model first writes a plan (the request, the stakes, the proper check, the shortcut, what the check shows), then fills the text slots in reading order. The engine maps every path to one of nine endings, so no shown text can contradict the player's state. Everyone in the case has a fictional first name; validation rejects "Speaker A" labels, repeated options, and quotes that are not grounded in the transcript (a near-verbatim quote counts, because Slack lines rarely split into clean sentences). The request is genuine on every path, and the answer stays hidden until the check result. Cases from the retired `account_ownership_v1` to `account_ownership_v4` blueprints are reported as failed and the player starts a new case. `fillScenario` asks the model only for text slots, then validates and stores the result. While it runs, it stores real checkpoints (task started, writing, checking, saving, ready). The writing percent is official output tokens divided by the 2,400 token budget, or characters received until that token count exists. `GET /sessions/current/progress` pushes those checkpoints with Postgres `NOTIFY` and merges Render's task status from `getTaskRun` plus the task-run SSE. Render's stream does not include a percentage; the percent is the checkpoint. Each fill receives its scenario id as a variation seed, so the same source prompt still produces a different telling. Sign-in stores a player (the Okta subject when Render SSO is present, otherwise a generated anonymous id) and a game at `/sessions/{game_id}`. The bearer token stays out of the URL. It claims one ready scenario, or one fill already running, and returns immediately. The pool tries to keep 100 unclaimed scenarios, and at most 8 model fills run at once. Sign-ins past that cap wait on their game URL and claim a scenario when one is ready. The web service starts replenishment when it boots. The console plays this prepared-case path. `replenishScenarioPool` runs `fillScenario` in batches of at most 8 until the pool reaches its target. Inline mode still fills the signing-in player's scenario in the web process when the cap has room. Begin opens the assigned scenario and does not call the model. Acting succeeds only after the player has done the proper check. A Render cron job runs `scripts/replenish.ts` every 15 minutes and starts the same parent task. `WORKFLOW_MODE=inline` fills in the web process for tests and local play. Production sets `WORKFLOW_MODE=render`. Blueprints still cannot create the Workflow service; create it in the Dashboard with root `/`, build `npm ci && npm run build`, and start `node dist/workflows/main.js`. Register `compileAdventure`, `replenishScenarioPool`, and `fillScenario` there.

## Slack ingest

Slack history is a second workflow, `workflows/slack/main.ts`, with tasks `syncSlack` and `ingestConversation`. It is not imported by the game server or by `workflows/main.ts`. `SLACK_USER_TOKEN` lists the public channels that token can read. The task redacts emails, phones, links, and mentions in memory, drops transcripts that contain secrets, and only then writes Postgres. A missing user directory still stores the redacted text. Each new case claims the oldest pending transcript and marks that verdict used. Rejected and dropped rows are not sent. A later sync leaves a used transcript used until the Slack cursor moves. `SLACK_INGEST_ENABLED` must be `true` on both the cron and the workflow service. The cron starts `syncSlack` when `SLACK_WORKFLOW_MODE=render`. Blueprints cannot create this workflow either: root `/`, build `npm ci && npm run build`, start `node dist/workflows/slack/main.js`. Give it `DATABASE_URL`, `SLACK_BOT_TOKEN`, and `SLACK_INGEST_ENABLED=true`. Bot scopes are `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, and `users:read`. Do not request `users:read.email`. The blueprint cron ships with ingest disabled until `SLACK_SYNC_TASK` is set to `<workflow-slug>/syncSlack`.

## Versions

Adventure definitions currently use schema version 2. The local v1 account-ownership MVP is intentionally not resumable after migration 003. Migration history prevents destructive migrations from rerunning.
