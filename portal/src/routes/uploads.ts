import type { Context } from "hono";
import type { ApiError, Deps } from "../app";
import { extensionFor } from "../media/types";
import { DRIVE_FILE } from "../media/video";
import type { MediaKind } from "../submissions/types";

const KINDS: MediaKind[] = ["team", "poster", "video"];
const fail = (c: Context, status: 400 | 413 | 415 | 502, code: string, message: string) => c.json<ApiError>({ error: { code, message } }, status);

/** Deletes one stored photo or Drive video. Missing files are ignored. */
export async function removeStored(deps: Deps, file: string) {
  const driveId = DRIVE_FILE.exec(file)?.[1];
  if (driveId) return deps.videos.remove(driveId);
  await deps.files.remove(file);
}

/** Streams one file (raw request body) to storage and returns its media name. */
export function uploadHandler(deps: Deps) {
  return async (c: Context<{ Variables: { email: string } }>) => {
    const kind = c.req.query("kind") as MediaKind;
    if (!KINDS.includes(kind)) return fail(c, 400, "bad_kind", "Unknown upload field.");
    const ext = extensionFor(kind, c.req.header("content-type") ?? "");
    if (!ext) return fail(c, 415, "unsupported_type", kind === "video" ? "Use an MP4, WebM, or MOV video." : "Use a JPG, PNG, WebP, or GIF image.");
    const max = kind === "video" ? deps.config.maxVideoBytes : deps.config.maxImageBytes;
    const tooBig = `That file is over ${Math.round(max / 1048576)} MB.`;
    if (Number(c.req.header("content-length") ?? 0) > max) return fail(c, 413, "too_large", tooBig);
    const body = c.req.raw.body;
    if (!body) return fail(c, 400, "empty", "The file was empty.");

    const id = crypto.randomUUID();
    const bytes = Number(c.req.header("content-length") ?? 0);
    if (kind === "video") {
      try {
        const saved = await deps.videos.save({ name: `science-fair-${id}.${ext}`, mime: c.req.header("content-type")!.split(";")[0]!.trim(), body, bytes });
        const file = `gdrive:${saved.id}`;
        try {
          await deps.submissions.recordUpload({ id, kind, file, bytes, createdBy: c.get("email"), createdAt: new Date() });
        } catch (e) {
          await deps.videos.remove(saved.id);
          throw e;
        }
        return c.json({ data: { file, url: `https://drive.google.com/file/d/${saved.id}/preview` } }, 201);
      } catch (e) {
        return fail(c, 502, "drive_failed", (e as Error).message);
      }
    }
    const file = `${id}.${ext}`;
    const saved = await deps.files.save(file, body, max);
    if (!saved.ok) return fail(c, 413, "too_large", tooBig);
    try {
      await deps.submissions.recordUpload({ id, kind, file, bytes: saved.bytes, createdBy: c.get("email"), createdAt: new Date() });
    } catch (e) {
      await deps.files.remove(file);
      throw e;
    }
    return c.json({ data: { file, url: `/media/${file}` } }, 201);
  };
}
