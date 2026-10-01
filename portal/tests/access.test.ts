import { describe, expect, test } from "bun:test";
import { form, testApp, uploadFile, validForm } from "./helpers";

describe("access and fault isolation", () => {
  test("anonymous visitors can browse but are sent to Okta to submit", async () => {
    const { req, setWho } = testApp();
    setWho({ status: "anonymous" });
    expect((await req("/")).status).toBe(200);
    const res = await req("/submit");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/oauth2/start?rd=%2Fsubmit%3Fsignin");
    expect((await uploadFile(req, "poster")).res.status).toBe(401);
  });

  test("never loops back to Okta if the proxy still sends no token", async () => {
    const { req, setWho } = testApp();
    setWho({ status: "anonymous" });
    const res = await req("/submit?signin");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Sign-in didn&#39;t reach the app.");
  });

  test("an invalid or non-Render token is refused without a redirect loop", async () => {
    const { req, setWho } = testApp();
    setWho({ status: "rejected", reason: "bad signature" });
    expect((await req("/submit")).status).toBe(403);
    expect((await uploadFile(req, "poster")).res.status).toBe(403);
  });

  test("SUBMISSIONS_OPEN=false closes writes but keeps the gallery", async () => {
    const { req } = testApp({ SUBMISSIONS_OPEN: "false" });
    const gallery = await (await req("/")).text();
    expect(gallery).toContain("Submissions are closed");
    expect(gallery).not.toContain('href="/submit"');
    expect((await req("/submit")).status).toBe(403);
    expect((await uploadFile(req, "poster")).res.status).toBe(403);
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
    const { file } = await uploadFile(req, "video", "video/mp4", new Uint8Array(100));
    const full = await req(`/media/${file}`);
    expect(full.headers.get("content-type")).toBe("video/mp4");
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
