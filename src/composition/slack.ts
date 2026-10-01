import { PostgresTranscriptStore } from '../adapters/slack-postgres.js';
import { SlackWebHistory } from '../adapters/slack-web.js';
import { SlackIngestService } from '../slack/index.js';

const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

function timeoutMs() {
  const timeout = Number(process.env.SLACK_TIMEOUT_MS ?? 15000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 60000) throw new Error('SLACK_TIMEOUT_MS must be 1000..60000');
  return timeout;
}

function slackToken() {
  const token = process.env.SLACK_USER_TOKEN?.trim() || process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) throw new Error('SLACK_USER_TOKEN or SLACK_BOT_TOKEN is required');
  return token;
}

/** Wires Slack ingest. The game server does not call this. */
export function composeSlack() {
  const store = new PostgresTranscriptStore(required('DATABASE_URL'));
  const history = new SlackWebHistory(slackToken(), timeoutMs());
  const service = new SlackIngestService(history, store, event => console.warn(JSON.stringify({ event })));
  return { service, store };
}
