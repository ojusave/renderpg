import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { Config } from "./config";
import type { Identity } from "./identity";
import type { FileStore } from "./media/types";
import { editorRoutes } from "./routes/editor";
import { publicRoutes } from "./routes/public";
import type { SubmissionStore } from "./submissions/types";
import { messagePage, unavailablePage } from "./ui/gallery";

export type Deps = { config: Config; submissions: SubmissionStore; files: FileStore; identity: Identity };

export type ApiError = { error: { code: string; message: string } };

/** Builds the HTTP app from its dependencies (the composition root lives in server.ts). */
export function createApp(deps: Deps) {
  const app = new Hono();

  app.use("/assets/*", async (c, next) => {
    await next();
    c.header("cache-control", c.req.query("v") ? "public, max-age=31536000, immutable" : "public, max-age=300");
  });
  app.use("/assets/*", serveStatic({ root: `${import.meta.dir}/../public`, rewriteRequestPath: (p) => p.replace(/^\/assets/, "") }));

  app.route("/", publicRoutes(deps));
  app.route("/", editorRoutes(deps));

  app.notFound((c) =>
    c.req.path.startsWith("/api/")
      ? c.json<ApiError>({ error: { code: "not_found", message: "No such endpoint." } }, 404)
      : c.html(messagePage(deps.config, "Nothing on this bench.", "That experiment doesn't exist, or the link is wrong."), 404),
  );

  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path} failed:`, err);
    if (c.req.path.startsWith("/api/")) return c.json<ApiError>({ error: { code: "server_error", message: "Something broke on our side. Try again." } }, 500);
    return c.html(unavailablePage(deps.config), 503);
  });

  return app;
}
