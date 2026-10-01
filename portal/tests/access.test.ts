import { describe, expect, test } from "bun:test";
import { emailCookieIdentity } from "../src/identity";
import { UnavailableVideoHost } from "../src/media/video";
import { form, testApp, uploadFile, validForm } from "./helpers";

describe("access and fault isolation", () => {
  test("anonymous visitors can browse but are asked for their email to submit", async () => {
    const { req } = testApp({}, undefined, emailCookieIdentity("render.com"));
    expect((await req("/")).status).toBe(200);
    const res = await req("/submit");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/signin?next=%2Fsubmit");
    expect(await (await req("/signin?next=%2Fsubmit")).text()).toContain("Work email");
    expect((await uploadFile(req, "poster")).res.status).toBe(401);
  });

  test("only @render.com emails can continue, and the email is remembered", async () => {
    const { req } = testApp({}, undefined, emailCookieIdentity("render.com"));
    const bad = await req("/signin", form({ email: "eve@example.com", next: "/submit" }));
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain("Use your @render.com email.");
    expect((await req("/signin", form({ email: "eve@render.com.evil.io", next: "/submit" }))).status).toBe(422);

    const ok = await req("/signin", form({ email: " Curie@Render.com ", next: "/submit" }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/submit");
    const cookie = ok.headers.get("set-cookie")!.split(";")[0]!;
    expect(cookie).toBe("sf_email=curie%40render.com");
    const page = await req("/submit", { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("curie@render.com");
  });

  test("sign-in never redirects to another site", async () => {
    const { req } = testApp({}, undefined, emailCookieIdentity("render.com"));
    for (const next of ["https://evil.com", "//evil.com", "/\\evil.com"]) {
      const res = await req("/signin", form({ email: "curie@render.com", next }));
      expect(res.headers.get("location")).toBe("/submit");
    }
  });

  test("a forged non-Render email cookie is treated as signed out", async () => {
    const { req } = testApp({}, undefined, emailCookieIdentity("render.com"));
    const res = await req("/submit", { headers: { cookie: "sf_email=eve%40example.com" } });
    expect(res.headers.get("location")).toBe("/signin?next=%2Fsubmit");
  });

  test("SUBMISSIONS_OPEN=false closes writes but keeps the gallery", async () => {
    const { req } = testApp({ SUBMISSIONS_OPEN: "false" });
    const gallery = await (await req("/")).text();
    expect(gallery).toContain("Submissions are closed");
    expect(gallery).not.toContain('href="/submit"');
    expect((await req("/submit")).status).toBe(403);
    expect((await uploadFile(req, "poster")).res.status).toBe(403);
  });

  test("a video upload says when Google Drive is not connected", async () => {
    const { req } = testApp({}, new UnavailableVideoHost());
    const { res } = await uploadFile(req, "video", "video/mp4", new Uint8Array(8));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Google Drive");
  });

  test("uploads reject wrong types and oversize files", async () => {
    const { req } = testApp({ MAX_IMAGE_MB: "0.000001" });
    expect((await uploadFile(req, "poster", "text/html")).res.status).toBe(415);
    expect((await uploadFile(req, "video", "image/png")).res.status).toBe(415);
    expect((await uploadFile(req, "poster")).res.status).toBe(413);
    expect((await uploadFile(req, "nope")).res.status).toBe(400);
  });

  test("media supports byte ranges and immutable caching", async () => {
    const { req } = testApp();
    const { file } = await uploadFile(req, "poster", "image/png", new Uint8Array(100));
    const full = await req(`/media/${file}`);
    expect(full.headers.get("content-type")).toBe("image/png");
    expect(full.headers.get("cache-control")).toContain("immutable");
    const part = await req(`/media/${file}`, { headers: { range: "bytes=10-19" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/100");
    expect((await part.arrayBuffer()).byteLength).toBe(10);
    expect((await req("/media/../../etc/passwd")).status).toBe(404);
  });

  test("a database outage shows a friendly page and health still answers", async () => {
    const { req, submissions } = testApp();
    submissions.failing = true;
    const res = await req("/");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("The lab is briefly closed.");
    const health = await req("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", db: "down" });
  });

  test("a failed upload record does not leave an orphan file behind", async () => {
    const { req, submissions, files } = testApp();
    submissions.failing = true;
    expect((await uploadFile(req, "poster")).res.status).toBe(500);
    expect(files.files.size).toBe(0);
  });

  test("user content is escaped", async () => {
    const { req } = testApp();
    const res = await req("/submit", form(await validForm(req, { projectName: "<script>alert(1)</script>" })));
    const page = await (await req(res.headers.get("location")!)).text();
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;");
  });
});
