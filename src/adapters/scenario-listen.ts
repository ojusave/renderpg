import pg from 'pg';

/** Pushes scenario-progress notifications. `read` returns true when the fill is finished. */
export async function listenProgress(
  connectionString: string,
  id: string,
  signal: AbortSignal,
  read: () => Promise<boolean>,
): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const abort = new AbortController();
  const onParent = () => abort.abort();
  signal.addEventListener('abort', onParent, { once: true });
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await client.query('LISTEN scenario_progress');
    let done = false;
    const pull = async () => {
      if (done || abort.signal.aborted) return;
      if (await read()) { done = true; abort.abort(); }
    };
    client.on('notification', message => { if (message.payload === id) void pull().catch(() => undefined); });
    await pull();
    if (abort.signal.aborted) return;
    timer = setInterval(() => { void pull().catch(() => undefined); }, 400);
    await new Promise<void>(resolve => abort.signal.addEventListener('abort', () => resolve(), { once: true }));
  } finally {
    if (timer) clearInterval(timer);
    signal.removeEventListener('abort', onParent);
    await client.end().catch(() => undefined);
  }
}
