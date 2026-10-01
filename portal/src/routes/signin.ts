import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { Deps } from "../app";
import { EMAIL_COOKIE, workEmail } from "../identity";
import { signinPage } from "../ui/signin";

/** Only same-site paths, so the sign-in form can't bounce people to another site. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/submit";
}

/** Email step before submitting: remembers a @render.com address in a cookie. */
export function signinRoutes(deps: Deps) {
  const app = new Hono();
  const { config } = deps;

  app.get("/signin", (c) => c.html(signinPage(config, safeNext(c.req.query("next")))));

  app.post("/signin", async (c) => {
    const body = await c.req.parseBody();
    const next = safeNext(body.next);
    const email = workEmail(body.email, config.emailDomain);
    if (!email) {
      const typed = typeof body.email === "string" ? body.email : "";
      return c.html(signinPage(config, next, typed, `Use your @${config.emailDomain} email.`), 422);
    }
    setCookie(c, EMAIL_COOKIE, email, { path: "/", httpOnly: true, sameSite: "Lax", secure: config.secureCookies, maxAge: 60 * 60 * 24 * 30 });
    return c.redirect(next, 303);
  });

  app.post("/signout", (c) => {
    deleteCookie(c, EMAIL_COOKIE, { path: "/" });
    return c.redirect("/", 303);
  });

  return app;
}
