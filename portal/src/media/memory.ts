import type { FileStore } from "./types";

/** In-memory file store for tests. */
export class MemoryFileStore implements FileStore {
  files = new Map<string, { data: Uint8Array<ArrayBuffer>; modifiedAt: number }>();

  async save(name: string, body: ReadableStream<Uint8Array>, maxBytes: number) {
    const data = new Uint8Array(await new Response(body).arrayBuffer());
    if (data.byteLength > maxBytes) return { ok: false as const, error: "too_large" as const };
    this.files.set(name, { data, modifiedAt: Date.now() });
    return { ok: true as const, bytes: data.byteLength };
  }

  async open(name: string) {
    const f = this.files.get(name);
    return f ? new Blob([f.data]) : null;
  }

  async list() {
    return [...this.files].map(([name, f]) => ({ name, modifiedAt: f.modifiedAt }));
  }

  async remove(name: string) {
    this.files.delete(name);
  }
}
