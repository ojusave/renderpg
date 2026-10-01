import { describe, expect, test } from "bun:test";
import { form, testApp, uploadFile, validForm } from "./helpers";

describe("gallery journey", () => {
  test("starts empty with a submit action and no promotional links", async () => {
    const { req } = testApp();
    const html = await (await req("/")).text();
    expect(html).toContain("No experiments yet.");
    expect(html).toContain('href="/submit"');
    expect(html).not.toContain("Deploy to Render");
    expect(html).not.toContain("Sign up on Render");
    expect(html).not.toContain("github.com");
    expect(html).not.toContain("render.com/docs");
  });

  test("submit → project page → gallery card", async () => {
    const { req } = testApp();
    const res = await req("/submit", form(await validForm(req)));
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location).toMatch(/^\/p\/agentic-lab-assistant-[0-9a-f]{6}\?saved=new$/);

    const page = await (await req(location)).text();
    expect(page).toContain("Experiment logged.");
    expect(page).toContain("Agentic Lab Assistant");
    expect(page).toContain("https://barium.onrender.com/");
    expect(page).toContain(">Ba<");

    const gallery = await (await req("/")).text();
    expect(gallery).toContain("1 experiment logged");
    expect(gallery).toContain(location.split("?")[0]!);
  });

  test("missing fields re-render the form with messages and keep typed values", async () => {
    const { req } = testApp();
    const res = await req("/submit", form({ teamName: "Zinc", siteUrl: "not a url" }));
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain('value="Zinc"');
    expect(html).toContain("Add a photo of your poster.");
    expect(html).toContain("doesn&#39;t look like a web address");
  });

  test("a second person cannot submit the same team", async () => {
    const { req, setWho } = testApp();
    await req("/submit", form(await validForm(req)));
    setWho({ status: "signed_in", email: "franklin@render.com" });
    const res = await req("/submit", form(await validForm(req, { teamName: " barium ", projectName: "Other" })));
    expect(res.status).toBe(409);
    const html = await res.text();
    expect(html).toContain("Choose a different team name");
    expect(html).not.toContain("Edit your experiment instead");
    expect(html).toContain('value="Other"');
  });

  test("submit reopens the owner's existing experiment instead of making another", async () => {
    const { req, submissions } = testApp();
    const created = await req("/submit", form(await validForm(req)));
    const slug = created.headers.get("location")!.split("/p/")[1]!.split("?")[0]!;
    const get = await req("/submit");
    expect(get.status).toBe(303);
    expect(get.headers.get("location")).toBe(`/edit/${slug}?notice=one`);
    const post = await req("/submit", form(await validForm(req, { teamName: "Neon" })));
    expect(post.status).toBe(303);
    expect(post.headers.get("location")).toBe(`/edit/${slug}?notice=one`);
    expect((await submissions.list(10, 0)).total).toBe(1);
  });

  test("only the creator can edit, and current files are preserved", async () => {
    const { req, submissions, setWho } = testApp();
    const values = await validForm(req);
    const created = await req("/submit", form(values));
    const slug = created.headers.get("location")!.split("/p/")[1]!.split("?")[0]!;
    const res = await req(`/edit/${slug}`, form({ ...values, results: "It fully worked." }));
    expect(res.status).toBe(303);
    const saved = (await submissions.bySlug(slug))!;
    expect(saved.results).toBe("It fully worked.");
    expect(saved.posterPhoto).toBe(values.posterPhoto);
    expect(saved.updatedBy).toBe("curie@render.com");

    setWho({ status: "signed_in", email: "franklin@render.com" });
    expect((await req(`/edit/${slug}`)).status).toBe(403);
    expect((await req(`/edit/${slug}`, form(values))).status).toBe(403);
    expect((await req(`/delete/${slug}`, { method: "POST" })).status).toBe(403);
  });

  test("the creator can delete and then submit again", async () => {
    const { req, submissions, files } = testApp();
    const created = await req("/submit", form(await validForm(req)));
    const slug = created.headers.get("location")!.split("/p/")[1]!.split("?")[0]!;
    expect(files.files.size).toBe(2);
    const deleted = await req(`/delete/${slug}`, { method: "POST" });
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe("/?deleted=1");
    expect((await submissions.list(10, 0)).total).toBe(0);
    expect(files.files.size).toBe(0);
    expect(await submissions.byOwner("curie@render.com")).toBeNull();
    expect((await req("/submit")).status).toBe(200);
    expect(await (await req("/?deleted=1")).text()).toContain("Experiment deleted.");
  });

  test("simultaneous create requests produce exactly one submission", async () => {
    const { req, submissions } = testApp();
    const [a, b] = await Promise.all([
      validForm(req, { teamName: "Barium" }),
      validForm(req, { teamName: "Neon" }),
    ]);
    const responses = await Promise.all([req("/submit", form(a)), req("/submit", form(b))]);
    expect(responses.every((r) => r.status === 303)).toBe(true);
    expect(responses.filter((r) => r.headers.get("location")?.includes("notice=one"))).toHaveLength(1);
    expect((await submissions.list(10, 0)).total).toBe(1);
  });

  test("rejects a photo slot pointing at a video or unknown file", async () => {
    const { req } = testApp();
    const video = await uploadFile(req, "video", "video/mp4");
    const res = await req("/submit", form(await validForm(req, { posterPhoto: video.file })));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("That upload is missing");
  });

  test("a person cannot attach another person's upload", async () => {
    const { req, setWho } = testApp();
    const curiesPhoto = await uploadFile(req, "team");
    setWho({ status: "signed_in", email: "franklin@render.com" });
    const res = await req("/submit", form(await validForm(req, { teamName: "Neon", teamPhoto: curiesPhoto.file })));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("That upload is missing");
  });

  test("team check API reports taken names", async () => {
    const { req } = testApp();
    await req("/submit", form(await validForm(req)));
    const body = (await (await req("/api/teams?name=BARIUM")).json()) as { data: { taken: boolean } };
    expect(body.data.taken).toBe(true);
    const free = (await (await req("/api/teams?name=Neon")).json()) as { data: { taken: boolean } };
    expect(free.data.taken).toBe(false);
  });
});
