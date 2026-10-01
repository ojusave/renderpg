import { Hono } from "hono";
import type { Deps } from "../app";
import { MEDIA_NAME, mimeFor } from "../media/types";
import { detailPage } from "../ui/detail";
import { galleryPage } from "../ui/gallery";

export const PER_PAGE = 24;

const NOTICES: Record<string, string> = {
  new: "Experiment logged. It's live in the gallery.",
  updated: "Changes saved.",
};

/** Serves a stored file, honoring byte ranges so videos can seek. */
async function serveMedia(deps: Deps, name: string, range: string | undefined): Promise<Response | null> {
  if (!MEDIA_NAME.test(name)) return null;
  const blob = await deps.files.open(name);
  if (!blob) return null;
  const headers: Record<string, string> = {
    "content-type": mimeFor(name),
    "cache-control": "public, max-age=31536000, immutable",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
  };
  const size = blob.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
  if (!m || (!m[1] && !m[2])) return new Response(blob, { headers: { ...headers, "content-length": String(size) } });
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}

/** Routes anyone can open: gallery, project pages, media, health. */
export function publicRoutes(deps: Deps) {
  const app = new Hono();

  app.get("/", async (c) => {
    const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
    const data = await deps.submissions.list(PER_PAGE, (page - 1) * PER_PAGE);
    c.header("cache-control", "no-cache");
    const notice = c.req.query("deleted") === "1" ? "Experiment deleted." : undefined;
    return c.html(galleryPage(deps.config, data, page, PER_PAGE, notice));
  });

  app.get("/p/:slug", async (c) => {
    const s = await deps.submissions.bySlug(c.req.param("slug"));
    if (!s) return c.notFound();
    c.header("cache-control", "no-cache");
    return c.html(detailPage(deps.config, s, NOTICES[c.req.query("saved") ?? ""]));
  });

  app.get("/media/:name", async (c) => (await serveMedia(deps, c.req.param("name"), c.req.header("range"))) ?? c.notFound());

  app.get("/health", async (c) => {
    const db = await Promise.race([
      deps.submissions.ping().then(() => "ok", () => "down"),
      Bun.sleep(2000).then(() => "timeout"),
    ]);
    return c.json({ status: "ok", db });
  });

  return app;
}
