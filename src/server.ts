import { composeApplication } from './composition/root.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
const { app, repo, scenarioStore, mode } = composeApplication();
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  await repo.close();
  await scenarioStore.close();
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
try {
  await repo.health();
  await app.listen({ host: process.env.HOST ?? '0.0.0.0', port });
  app.log.info({ aiMode: mode }, 'Game API ready');
} catch {
  console.error('Startup failed. Check Postgres, migrations, and .env configuration.');
  await shutdown();
  process.exitCode = 1;
}
