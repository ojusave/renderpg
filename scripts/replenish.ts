const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const mode = process.env.WORKFLOW_MODE ?? 'inline';
if (mode === 'render') {
  const { RenderPoolScheduler } = await import('../src/adapters/render-pool-scheduler.js');
  const scheduler = new RenderPoolScheduler(required('REPLENISH_TASK'), required('RENDER_API_KEY'));
  await scheduler.schedule();
  console.log(JSON.stringify({ event: 'scenario_pool_replenish_started' }));
} else if (mode === 'inline') {
  const { composeScenario } = await import('../src/composition/scenario.js');
  const { service, store, prompts } = composeScenario();
  try {
    const started = await service.replenish();
    console.log(JSON.stringify({ event: 'scenario_pool_replenished', started }));
  } finally {
    await store.close();
    await prompts.close();
  }
} else {
  throw new Error('WORKFLOW_MODE must be inline or render');
}
