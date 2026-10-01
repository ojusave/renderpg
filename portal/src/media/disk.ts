import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileStore } from "./types";

/** Stores media on the service's persistent disk. */
export class DiskFileStore implements FileStore {
  constructor(private dir: string) {}

  async init() {
    await mkdir(this.dir, { recursive: true });
  }

  async save(name: string, body: ReadableStream<Uint8Array>, maxBytes: number) {
    const path = join(this.dir, name);
    const writer = Bun.file(path).writer();
    const reader = body.getReader();
    let bytes = 0;
    try {
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        const chunk = r.value;
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          await writer.end();
          await rm(path, { force: true });
          return { ok: false as const, error: "too_large" as const };
        }
        writer.write(chunk);
      }
      await writer.end();
      return { ok: true as const, bytes };
    } catch (e) {
      await rm(path, { force: true });
      throw e;
    }
  }

  async open(name: string) {
    const file = Bun.file(join(this.dir, name));
    return (await file.exists()) ? file : null;
  }

  async list() {
    const names = await readdir(this.dir);
    return Promise.all(names.map(async (name) => ({ name, modifiedAt: (await stat(join(this.dir, name))).mtimeMs })));
  }

  async remove(name: string) {
    await rm(join(this.dir, name), { force: true });
  }
}
