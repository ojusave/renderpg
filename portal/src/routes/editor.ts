import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { ApiError, Deps } from "../app";
import { DRIVE_FILE } from "../media/video";
import type { MediaKind, Submission, SubmissionInput } from "../submissions/types";
import { toFormValues, validateSubmission, type FieldErrors, type FormValues } from "../submissions/validate";
import { formPage } from "../ui/form";
import { messagePage } from "../ui/gallery";
import { removeStored, uploadHandler } from "./uploads";

type Env = { Variables: { email: string } };

const BLANK: FormValues = { teamName: "", projectName: "", siteUrl: "", hypothesis: "", methods: "", results: "", teamPhoto: "", posterPhoto: "", video: "" };

/** Routes that need a signed-in Render employee: submit, edit, upload. */
export function editorRoutes(deps: Deps) {
  const app = new Hono<Env>();
  const { config } = deps;

  const requireEditor = createMiddleware<Env>(async (c, next) => {
    const api = c.req.path.startsWith("/api/");
    if (!config.submissionsOpen) {
      return api
        ? c.json<ApiError>({ error: { code: "closed", message: "Submissions are closed." } }, 403)
        : c.html(messagePage(config, "Submissions are closed.", "The Science Fair is wrapped. You can still browse every experiment."), 403);
    }
    const who = await deps.identity.whoIs(c.req.raw);
    if (who.status === "signed_in") {
      c.set("email", who.email);
      return next();
    }
    if (api) return c.json<ApiError>({ error: { code: "unauthorized", message: "Enter your Render email again. Reload the page to continue." } }, 401);
    const back = c.req.method === "GET" ? c.req.path : "/submit";
    return c.redirect(`/signin?next=${encodeURIComponent(back)}`);
  });

  app.use("/submit", requireEditor);
  app.use("/edit/*", requireEditor);
  app.use("/delete/*", requireEditor);
  app.use("/api/*", requireEditor);

  const render = (c: Context<Env>, existing: Submission | null, values: FormValues, errors: FieldErrors = {}, taken?: Submission, notice?: string) =>
    formPage(config, {
      mode: existing ? "edit" : "create",
      action: existing ? `/edit/${existing.slug}` : "/submit",
      email: c.get("email"),
      values,
      errors,
      notice,
      teamTaken: taken && {
        projectName: taken.projectName,
        slug: taken.createdBy.toLowerCase() === c.get("email").toLowerCase() ? taken.slug : undefined,
      },
    });

  async function mediaErrors(input: SubmissionInput, email: string): Promise<FieldErrors> {
    const checks: [keyof SubmissionInput, string | null, MediaKind][] = [
      ["teamPhoto", input.teamPhoto, "team"],
      ["posterPhoto", input.posterPhoto, "poster"],
      ["video", input.video, "video"],
    ];
    const errors: FieldErrors = {};
    for (const [field, file, kind] of checks) {
      if (!file) continue;
      const upload = await deps.submissions.upload(file);
      const stored = Boolean(upload && upload.kind === kind && upload.createdBy.toLowerCase() === email.toLowerCase());
      const present = stored && (DRIVE_FILE.test(file) || Boolean(await deps.files.open(file)));
      if (!present) {
        errors[field] = "That upload is missing. Please add the file again.";
      }
    }
    return errors;
  }

  async function save(c: Context<Env>, existing: Submission | null) {
    const v = validateSubmission(await c.req.parseBody());
    if (!v.ok) return c.html(render(c, existing, v.values, v.errors), 422);
    const email = c.get("email");
    const errors = await mediaErrors(v.input, email);
    if (Object.keys(errors).length) return c.html(render(c, existing, toFormValues(v.input), errors), 422);
    const result = existing ? await deps.submissions.update(existing.id, v.input, email) : await deps.submissions.create(v.input, email);
    if (!result.ok && result.error === "owner_taken") return c.redirect(`/edit/${result.existing.slug}?notice=one`, 303);
    if (!result.ok) return c.html(render(c, existing, toFormValues(v.input), { teamName: "This team already has an experiment." }, result.existing), 409);
    return c.redirect(`/p/${result.submission.slug}?saved=${existing ? "updated" : "new"}`, 303);
  }

  async function load(c: Context<Env>) {
    return deps.submissions.bySlug(c.req.param("slug") ?? "");
  }

  app.get("/submit", async (c) => {
    const existing = await deps.submissions.byOwner(c.get("email"));
    return existing ? c.redirect(`/edit/${existing.slug}?notice=one`, 303) : c.html(render(c, null, BLANK));
  });
  app.post("/submit", (c) => save(c, null));

  app.get("/edit/:slug", async (c) => {
    const s = await load(c);
    if (!s) return c.notFound();
    if (s.createdBy.toLowerCase() !== c.get("email").toLowerCase()) {
      return c.html(messagePage(config, "This experiment belongs to another scientist.", "Only the person who submitted it can edit or delete it."), 403);
    }
    const notice = c.req.query("notice") === "one" ? "You already have an experiment. You can update it here." : undefined;
    return c.html(render(c, s, toFormValues(s), {}, undefined, notice));
  });
  app.post("/edit/:slug", async (c) => {
    const s = await load(c);
    if (!s) return c.notFound();
    if (s.createdBy.toLowerCase() !== c.get("email").toLowerCase()) {
      return c.html(messagePage(config, "This experiment belongs to another scientist.", "Only the person who submitted it can edit or delete it."), 403);
    }
    return save(c, s);
  });

  app.post("/delete/:slug", async (c) => {
    const s = await load(c);
    if (!s) return c.notFound();
    const deleted = await deps.submissions.delete(s.id, c.get("email"));
    if (!deleted) {
      return c.html(messagePage(config, "This experiment belongs to another scientist.", "Only the person who submitted it can edit or delete it."), 403);
    }
    await Promise.all(
      [deleted.teamPhoto, deleted.posterPhoto, deleted.video]
        .filter((file): file is string => !!file)
        .map((file) => removeStored(deps, file).catch((error) => console.warn(`could not remove ${file}:`, error))),
    );
    return c.redirect("/?deleted=1", 303);
  });

  app.get("/api/teams", async (c) => {
    const s = await deps.submissions.byTeam(c.req.query("name") ?? "");
    const taken = !!s && s.slug !== c.req.query("except");
    const mine = taken && s.createdBy.toLowerCase() === c.get("email").toLowerCase();
    return c.json({ data: taken ? { taken, mine, slug: mine ? s.slug : undefined, projectName: s.projectName } : { taken: false } });
  });

  app.post("/api/uploads", uploadHandler(deps));

  return app;
}
