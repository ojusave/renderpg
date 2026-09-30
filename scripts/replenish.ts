import { composeScenario } from '../src/composition/scenario.js';

const { service, store } = composeScenario();
const started = await service.replenish();
console.log(JSON.stringify({ event: 'scenario_pool_replenished', started }));
await store.close();
