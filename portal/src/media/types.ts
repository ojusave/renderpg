import type { MediaKind } from "../submissions/types";

/** Storage port for uploaded photos. Video pitches use VideoHost. */
export interface FileStore {
  save(name: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ ok: true; bytes: number } | { ok: false; error: "too_large" }>;
  open(name: string): Promise<Blob | null>;
  list(): Promise<{ name: string; modifiedAt: number }[]>;
  remove(name: string): Promise<void>;
}

const IMAGE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as const;
const VIDEO = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" } as const;

/** File extension for an accepted upload type, or null if the type is not allowed for that field. */
export function extensionFor(kind: MediaKind, mime: string): string | null {
  const table: Record<string, string> = kind === "video" ? VIDEO : IMAGE;
  return table[mime.split(";")[0]!.trim().toLowerCase()] ?? null;
}

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries({ ...IMAGE, ...VIDEO }).map(([mime, ext]) => [ext, mime]),
);

export const MEDIA_NAME = /^[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm|mov)$/;

/** Content type to serve for a stored media file name. */
export function mimeFor(name: string): string {
  return MIME_BY_EXT[name.split(".").pop() ?? ""] ?? "application/octet-stream";
}
