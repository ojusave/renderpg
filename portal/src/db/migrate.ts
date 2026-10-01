import { SQL } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const dir = join(import.meta.dir, "../../migrations");

/** Applies pending `migrations/*.sql` files in order, once each, under an advisory lock. */
export async function migrate(url: string) {
  const sql = new SQL(url);
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(4242)`;
      await tx`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
      const done = new Set(((await tx`select name from schema_migrations`) as { name: string }[]).map((r) => r.name));
      for (const name of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
        if (done.has(name)) continue;
        await tx.unsafe(await Bun.file(join(dir, name)).text());
        await tx`insert into schema_migrations (name) values (${name})`;
        console.log(`migrated ${name}`);
      }
    });
  } finally {
    await sql.close();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  await migrate(url);
}
