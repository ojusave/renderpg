const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

if (process.env.SLACK_INGEST_ENABLED !== 'true') {
  console.log(JSON.stringify({ event: 'slack_sync_skipped' }));
} else {
  const mode = process.env.SLACK_WORKFLOW_MODE ?? 'inline';
  if (mode === 'render') {
    const { Render } = await import('@renderinc/sdk');
    const client = new Render({
      token: required('RENDER_API_KEY'),
      useLocalDev: process.env.RENDER_USE_LOCAL_DEV === 'true',
      ...(process.env.RENDER_LOCAL_DEV_URL ? { localDevUrl: process.env.RENDER_LOCAL_DEV_URL } : {}),
    });
    const hour = new Date().toISOString().slice(0, 13);
    const run = await client.workflows.startTask(required('SLACK_SYNC_TASK'), [], { idempotencyKey: `slack-sync-${hour}` });
    console.log(JSON.stringify({ event: 'slack_sync_started', runId: run.taskRunId }));
  } else if (mode === 'inline') {
    const { migrate } = await import('./migrate.js');
    const { composeSlack } = await import('../src/composition/slack.js');
    await migrate(required('DATABASE_URL'));
    const { service, store } = composeSlack();
    try {
      const summary = await service.ingestAll(ref => service.ingest(ref));
      console.log(JSON.stringify({ event: 'slack_sync_finished', ...summary }));
      const prompt = await store.nextPrompt();
      if (prompt) {
        const { randomUUID } = await import('node:crypto');
        const { blueprintId } = await import('../src/scenario/blueprint.js');
        const { composeScenario } = await import('../src/composition/scenario.js');
        const scenario = composeScenario();
        const scenarioId = randomUUID();
        try {
          await scenario.store.insertFilling(scenarioId, blueprintId, prompt, null);
          await scenario.service.publish(scenarioId, prompt);
          console.log(JSON.stringify({ event: 'slack_prompt_delivered', scenarioId, chars: prompt.length }));
        } finally {
          await scenario.store.close();
          await scenario.prompts.close();
        }
      }
      if (summary.failed > 0 && summary.stored + summary.dropped + summary.unchanged === 0) process.exitCode = 1;
    } finally {
      await store.close();
    }
  } else {
    throw new Error('SLACK_WORKFLOW_MODE must be inline or render');
  }
}
