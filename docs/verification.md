# Verification status

Checked 2026-09-30.

## Passed

- TypeScript typecheck and compiled build.
- OpenAPI 3.1 validation with runtime request and response enforcement.
- Unit tests covering graph validation, reachable endings, deterministic transitions, HTTP create-to-completion, authentication, idempotency, provider fallbacks, mocked Anthropic structured output, console interruption/recovery, and Slack redaction. Slack tests check that secrets are dropped, ordinary identifiers are masked before storage, usable transcripts stay pending, and the game server does not import the ingest workflow.
- Real Postgres integration in an isolated schema: migration history, concurrent creation, duplicate and conflicting turns, transaction rollback, persisted clarification, and reconnect.
- Compiled offline API smoke: creation and turn replay, validated four-turn success path, and resume against the migrated local Postgres database.
- Render Blueprint validation for the Web Service, Postgres, environment group, migrations, health check, private database access, and preview environments.

## Pending

- The opt-in live Anthropic smoke test. It requires a configured structured-output-capable `ANTHROPIC_MODEL` and makes paid API calls.
- A deployed Render smoke test after the repository and Blueprint are connected.

## Evidence boundary

The simulator proves that generated mechanics are structurally valid and declared endings are reachable within the configured bound. It does not prove that an arbitrary source prompt is factually correct. Prompts must be curated before submission.
