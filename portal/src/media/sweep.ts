import type { SubmissionStore } from "../submissions/types";
import type { FileStore } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** Deletes uploads that no submission references after a day (abandoned or replaced files). */
export async function sweepOrphans(files: FileStore, store: SubmissionStore, now = Date.now()): Promise<number> {
  const keep = await store.referencedFiles();
  const stale = (await files.list()).filter((f) => !keep.has(f.name) && now - f.modifiedAt > DAY);
  await Promise.all(stale.map((f) => files.remove(f.name)));
  return stale.length;
}
