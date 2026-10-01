import { afterAll, describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oktaIdentity } from "../src/identity";
import { DiskFileStore } from "../src/media/disk";
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

describe("oktaIdentity", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ keys: [jwk] }) });
  afterAll(() => server.stop());
  const issuer = "https://render.okta.com";
  const identity = oktaIdentity({ issuer, jwksUrl: `http://localhost:${server.port}/keys`, emailDomain: "render.com" });
  const token = (sub: string, iss = issuer) =>
    new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "k1" }).setSubject(sub).setIssuer(iss).setExpirationTime("5m").sign(privateKey);
  const whoIs = async (t?: string) => identity.whoIs(new Request("http://x", { headers: t ? { "x-forwarded-access-token": t } : {} }));

  test("accepts a valid Render token", async () => {
    expect(await whoIs(await token("Curie@render.com"))).toEqual({ status: "signed_in", email: "curie@render.com" });
  });
  test("treats a missing token as anonymous", async () => {
    expect((await whoIs()).status).toBe("anonymous");
  });
  test("rejects other domains, wrong issuers, and garbage", async () => {
    expect((await whoIs(await token("eve@example.com"))).status).toBe("rejected");
    expect((await whoIs(await token("curie@render.com", "https://evil.okta.com"))).status).toBe("rejected");
    expect((await whoIs("not-a-jwt")).status).toBe("rejected");
  });
});
