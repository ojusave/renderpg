import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

export async function migrate(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(58271001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = new URL(import.meta.url.includes('/dist/') ? '../../migrations/' : '../migrations/', import.meta.url);
    const files = (await readdir(directory)).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
    const applied = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(row => row.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(new URL(file, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await migrate(process.env.DATABASE_URL);
  console.log('Database migration complete.');
}
