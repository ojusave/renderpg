# RenderPG backend

A backend that compiles a curated prompt about day-to-day Render work into a short, varied, Zork-inspired adventure. TypeScript, Anthropic, and Render Postgres.

The prompt is the only operational source of truth. Claude generates a closed world/action graph, local code validates every reference and simulates every ending, and only then is the immutable adventure persisted. During play, the deterministic engine owns state and outcomes. Claude may interpret free text and add atmosphere, but it cannot change rules.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)
[Sign up on Render](https://render.com/register?utm_source=github&utm_medium=referral&utm_campaign=ojus_demos&utm_content=readme_cta)

## Run locally

Requires Node 24, npm, Postgres, and an Anthropic API key for live AI mode.

1. Run `npm ci`.
2. Configure `DATABASE_URL`, a 32-character `SESSION_SECRET`, `ANTHROPIC_API_KEY`, and a structured-output-capable `ANTHROPIC_MODEL`.
3. Run `docker compose up -d --wait` if using the included local Postgres, then `npm run db:migrate`.
4. Run `npm run dev`.
5. In another terminal, run `npm run console`. Every new game uses the first Slack story: a customer account that left with a former employee. Set `SCENARIO_PROMPT` only to override that story.

To exercise the backend without Claude, start it with `AI_MODE=offline`. Offline mode uses a deterministic generated fixture and never silently substitutes for a failed live provider.

## Play

`/new` generates another variation from the configured prompt, `/resume` refreshes, `/retry` safely replays an uncertain request, and `/quit` exits.

Literal commands are derived from each generated graph. `look`, `help`, and `inventory` are always available. With Claude enabled, natural-language requests are mapped only to generated verbs and visible targets.

The console stores its game credential and unresolved request in `.console-session.json` with owner-only permissions. Keep that file and creation idempotency keys private.

## API

`openapi.yaml` is the canonical interface and is available from `GET /openapi.json`.

| Operation | Purpose |
| --- | --- |
| `POST /games` | Start compilation. Returns the game, or `202` while a workflow run is in progress |
| `GET /games/generations/{run_id}` | Poll a workflow run until the game is ready |
| `POST /games/{game_id}/turns` | Resolve one command against the saved graph |
| `GET /games/{game_id}` | Resume player-visible state and transcript |
| `GET /health` | Check API/database connectivity and configured AI capabilities |

Creation and turn requests require a UUID `Idempotency-Key`. Creation returns a game-scoped `session_token`; later calls use it as a bearer token. Completed games return an ending with `success`, `partial_success`, or `failure`.

## Architecture

| Directory | Responsibility |
| --- | --- |
| `src/adventure` | Closed graph schema, compiler, validator, and reachability simulator |
| `src/game` | Deterministic state transitions, command resolution, and visibility |
| `src/application` | Creation/turn orchestration and ports |
| `src/adapters` | Anthropic, offline, and Postgres adapters |
| `src/api` and `src/console` | OpenAPI HTTP adapter and separate HTTP client |

`workflows/main.ts` registers one task, `compileAdventure`. The web service starts it when `WORKFLOW_MODE=render`. Set `WORKFLOW_TASK` to `<workflow-slug>/compileAdventure` and provide `RENDER_API_KEY`. For local task runs, start `render workflows dev -- npm run workflows:dev` and set `RENDER_USE_LOCAL_DEV=true`.

Render Blueprints cannot create Workflow services yet. In the Dashboard, create a Workflow from this repository with root directory `/`, build command `npm ci && npm run build`, and start command `node dist/workflows/main.js`. Give it `DATABASE_URL`, `AI_MODE`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, and `AI_TIMEOUT_MS`. The task does not receive `SESSION_SECRET`; the web service issues the session token when the poll sees a published game.

## Verification

```sh
npm run check
npm run test:postgres
npm run build
render blueprints validate
```

For an offline completion smoke test, start the API with `AI_MODE=offline`, then run `SMOKE_OFFLINE=1 npm run smoke`. A live Claude smoke is opt-in and makes paid API calls.

## Scope

Structured schemas constrain shape, references, and reachability—not semantic truth. Prompts must be curated before submission. Slack/Notion ingestion, user identity, streaming, multiplayer, and actions against real Render systems are out of scope.

`render.yaml` defines the Render Web Service, private Postgres connection, secrets, migrations, health check, and preview environments.
