import { task } from '@renderinc/sdk/workflows';
import { migrate } from '../../scripts/migrate.js';
import { composeSlack } from '../../src/composition/slack.js';
import type { ConversationRef } from '../../src/slack/index.js';

function required(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

const databaseUrl = required('DATABASE_URL');
if (!process.env.SLACK_USER_TOKEN?.trim() && !process.env.SLACK_BOT_TOKEN?.trim()) {
  throw new Error('SLACK_USER_TOKEN or SLACK_BOT_TOKEN is required');
}

let pending: ReturnType<typeof composeSlack> | undefined;
let starting: Promise<ReturnType<typeof composeSlack>> | undefined;

function slackRuntime() {
  starting ??= migrate(databaseUrl).then(() => {
    pending ??= composeSlack();
    return pending;
  });
  return starting;
}

const ingestConversation = task({
  name: 'ingestConversation',
  retry: { maxRetries: 3, waitDurationMs: 2000, backoffScaling: 2 },
  timeoutSeconds: 1800,
}, async function ingestConversation(_ctx, input: ConversationRef) {
  const { service } = await slackRuntime();
  return service.ingest(input);
});

task({
  name: 'syncSlack',
  retry: { maxRetries: 1, waitDurationMs: 5000 },
  timeoutSeconds: 7200,
}, async function syncSlack(ctx) {
  const { service } = await slackRuntime();
  return service.ingestAll(ref => ctx.run(ingestConversation, ref));
});
