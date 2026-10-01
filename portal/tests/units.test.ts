import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workEmail } from "../src/identity";
import { DiskFileStore } from "../src/media/disk";
import { GoogleDriveHost, type FetchLike } from "../src/media/google-drive";
import { sweepOrphans } from "../src/media/sweep";
import { MemorySubmissionStore } from "../src/submissions/memory";
import { makeSlug, teamKey } from "../src/submissions/slug";
import { normalizeUrl } from "../src/submissions/validate";
import { tileFor } from "../src/ui/elements";

const stream = (bytes: number) => new Response(new Uint8Array(bytes)).body!;

describe("helpers", () => {
  test("urls", () => {
    expect(normalizeUrl("barium.onrender.com")).toBe("https://barium.onrender.com/");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("localhost")).toBeNull();
  });
  test("slugs and team keys", () => {
    expect(makeSlug("Agentic Lab: v2!", "abcdef123")).toBe("agentic-lab-v2-abcdef");
    expect(teamKey("  Barium   Labs ")).toBe("barium labs");
  });
  test("element tiles", () => {
    expect(tileFor("Team Barium")).toMatchObject({ symbol: "Ba", number: "56" });
    expect(tileFor("quantum goats").symbol).toBe("Qu");
  });
});

describe("DiskFileStore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sf-"));
  const files = new DiskFileStore(dir);
  await files.init();
  afterAll(() => rm(dir, { recursive: true, force: true }));

  test("saves within the limit and removes oversize files", async () => {
    expect(await files.save("a.png", stream(10), 100)).toEqual({ ok: true, bytes: 10 });
    expect((await files.open("a.png"))!.size).toBe(10);
    expect(await files.save("b.png", stream(200), 100)).toEqual({ ok: false, error: "too_large" });
    expect(await files.open("b.png")).toBeNull();
  });

  test("sweep removes only old, unreferenced files", async () => {
    await files.save("old.png", stream(1), 10);
    await files.save("kept.png", stream(1), 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await utimes(join(dir, "old.png"), twoDaysAgo, twoDaysAgo);
    await utimes(join(dir, "kept.png"), twoDaysAgo, twoDaysAgo);
    const store = new MemorySubmissionStore();
    store.referencedFiles = async () => new Set(["kept.png"]);
    expect(await sweepOrphans(files, store)).toBe(1);
    expect(await files.open("old.png")).toBeNull();
    expect(await files.open("kept.png")).not.toBeNull();
    expect(await files.open("a.png")).not.toBeNull();
  });
});

describe("workEmail", () => {
  test("accepts only plain @render.com addresses", () => {
    expect(workEmail(" Curie@Render.com ", "render.com")).toBe("curie@render.com");
    expect(workEmail("eve@example.com", "render.com")).toBeNull();
    expect(workEmail("eve@notrender.com", "render.com")).toBeNull();
    expect(workEmail("a@b@render.com", "render.com")).toBeNull();
    expect(workEmail("@render.com", "render.com")).toBeNull();
    expect(workEmail(undefined, "render.com")).toBeNull();
  });
});

describe("GoogleDriveHost", () => {
  const auth = { clientId: "id", clientSecret: "secret", refreshToken: "refresh", folderId: "folder" };

  test("uploads, shares for playback, and deletes", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      const target = String(url);
      calls.push(`${init?.method} ${target}`);
      if (target.includes("oauth2.googleapis.com")) return Response.json({ access_token: "token", expires_in: 3600 });
      if (target.includes("uploadType=resumable")) return new Response(null, { status: 200, headers: { location: "https://upload.example/session" } });
      if (target === "https://upload.example/session") return Response.json({ id: "driveFileId1" });
      if (target.includes("/permissions")) return new Response(null, { status: 200 });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response("missing", { status: 500 });
    };
    const drive = new GoogleDriveHost(auth, fetchImpl);
    const saved = await drive.save({ name: "pitch.mp4", mime: "video/mp4", body: stream(4), bytes: 4 });
    expect(saved.id).toBe("driveFileId1");
    expect(calls.some((call) => call.includes("/permissions"))).toBe(true);
    await drive.remove(saved.id);
    expect(calls.at(-1)).toContain("DELETE");
    expect(calls.filter((call) => call.includes("oauth2.googleapis.com"))).toHaveLength(1);
  });
});
