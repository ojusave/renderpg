import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import type { Identity, Who } from "../src/identity";
import { MemoryFileStore } from "../src/media/memory";
import { MemorySubmissionStore } from "../src/submissions/memory";

/** Builds the app with in-memory fakes and a switchable identity. */
export function testApp(env: Record<string, string> = {}) {
  const config = loadConfig(env);
  const submissions = new MemorySubmissionStore();
  const files = new MemoryFileStore();
  let who: Who = { status: "signed_in", email: "curie@render.com" };
  const identity: Identity = { whoIs: async () => who };
  const app = createApp({ config, submissions, files, identity });
  const req = (path: string, init?: RequestInit) => app.request(`http://test${path}`, init);
  return { app, req, submissions, files, setWho: (w: Who) => (who = w) };
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

export async function uploadFile(req: ReturnType<typeof testApp>["req"], kind: string, type = "image/png", body: BodyInit = PNG) {
  const res = await req(`/api/uploads?kind=${kind}`, { method: "POST", headers: { "content-type": type }, body });
  return { res, file: res.status === 201 ? ((await res.json()) as { data: { file: string } }).data.file : "" };
}

export function form(values: Record<string, string>) {
  return { method: "POST", body: new URLSearchParams(values), headers: { "content-type": "application/x-www-form-urlencoded" } };
}

/** Uploads both photos and returns a complete, valid form. */
export async function validForm(req: ReturnType<typeof testApp>["req"], overrides: Record<string, string> = {}) {
  const poster = await uploadFile(req, "poster");
  const team = await uploadFile(req, "team");
  return {
    teamName: "Barium",
    projectName: "Agentic Lab Assistant",
    siteUrl: "barium.onrender.com",
    hypothesis: "If we give agents goggles, then they will see.",
    methods: "Bun and Hono on Render.",
    results: "It mostly worked.",
    posterPhoto: poster.file,
    teamPhoto: team.file,
    ...overrides,
  };
}
