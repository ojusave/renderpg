import { composeApplication } from './composition/root.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
const { app, repo, scenarioStore, prompts, scenarios, mode } = composeApplication();
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  await repo.close();
  await scenarioStore.close();
  await prompts.close();
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
try {
  await repo.health();
  void scenarios.replenish().catch(error => {
    console.warn(JSON.stringify({ event: 'pool_warm_failed', message: error instanceof Error ? error.message : 'unknown' }));
  });
  await app.listen({ host: process.env.HOST ?? '0.0.0.0', port });
  app.log.info({ aiMode: mode }, 'Game API ready');
} catch {
  console.error('Startup failed. Check Postgres, migrations, and .env configuration.');
  await shutdown();
  process.exitCode = 1;
}
