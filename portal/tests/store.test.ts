import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { migrate } from "../src/db/migrate";
import { MemorySubmissionStore } from "../src/submissions/memory";
import { PostgresSubmissionStore } from "../src/submissions/postgres";
import type { SubmissionInput, SubmissionStore } from "../src/submissions/types";

const input = (over: Partial<SubmissionInput> = {}): SubmissionInput => ({
  teamName: "Barium",
  projectName: "Lab Assistant",
  siteUrl: "https://barium.onrender.com/",
  hypothesis: "If…",
  methods: "Built…",
  results: "Worked…",
  teamPhoto: "t.png",
  posterPhoto: "p.png",
  video: null,
  ...over,
});

/** Every SubmissionStore implementation must pass the same contract. */
function contract(name: string, make: () => Promise<SubmissionStore>) {
  describe(`${name} store contract`, () => {
    test("create, read, list, update, uniqueness", async () => {
      const store = await make();
      const a = await store.create(input(), "curie@render.com");
      if (!a.ok) throw new Error("create failed");
      expect((await store.bySlug(a.submission.slug))?.teamName).toBe("Barium");
      expect((await store.byTeam(" BARIUM "))?.id).toBe(a.submission.id);
      expect((await store.byOwner("CURIE@render.com"))?.id).toBe(a.submission.id);

      const dup = await store.create(input({ teamName: "barium", projectName: "Other" }), "x@render.com");
      expect(!dup.ok && dup.error).toBe("team_taken");
      const ownerDup = await store.create(input({ teamName: "Zinc" }), "curie@render.com");
      expect(!ownerDup.ok && ownerDup.error).toBe("owner_taken");

      const b = await store.create(input({ teamName: "Neon", video: "v.mp4" }), "franklin@render.com");
      if (!b.ok) throw new Error("create failed");
      const page = await store.list(1, 0);
      expect(page.total).toBe(2);
      expect(page.items[0]!.teamName).toBe("Neon");

      const clash = await store.update(b.submission.id, input({ teamName: "Barium" }), "franklin@render.com");
      expect(clash.ok).toBe(false);
      const ok = await store.update(b.submission.id, input({ teamName: "Neon", results: "Changed" }), "franklin@render.com");
      expect(ok.ok && ok.submission.results).toBe("Changed");
      expect(ok.ok && ok.submission.updatedBy).toBe("franklin@render.com");
      expect(await store.delete(b.submission.id, "curie@render.com")).toBeNull();
      expect((await store.delete(b.submission.id, "franklin@render.com"))?.id).toBe(b.submission.id);
      expect(await store.referencedFiles()).toEqual(new Set(["t.png", "p.png"]));
    });

    test("concurrent creates enforce one submission per owner", async () => {
      const store = await make();
      const results = await Promise.all([
        store.create(input({ teamName: "Barium" }), "curie@render.com"),
        store.create(input({ teamName: "Neon" }), "curie@render.com"),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.error === "owner_taken")).toHaveLength(1);
      expect((await store.list(10, 0)).total).toBe(1);
    });

    test("uploads", async () => {
      const store = await make();
      const id = crypto.randomUUID();
      await store.recordUpload({ id, kind: "poster", file: `${id}.png`, bytes: 5, createdBy: "curie@render.com", createdAt: new Date() });
      expect((await store.upload(`${id}.png`))?.kind).toBe("poster");
      expect(await store.upload("missing.png")).toBeNull();
      await store.ping();
    });
  });
}

contract("memory", async () => new MemorySubmissionStore());

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const admin = new SQL(url);
  afterAll(() => admin.close());
  contract("postgres", async () => {
    await admin`drop table if exists submissions, uploads, schema_migrations`;
    await migrate(url);
    return new PostgresSubmissionStore(new SQL(url));
  });
}
