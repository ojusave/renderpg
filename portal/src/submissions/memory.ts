import { makeSlug, teamKey } from "./slug";
import type { Page, SaveResult, Submission, SubmissionInput, SubmissionStore, Upload } from "./types";

/** In-memory store for tests and local development without Postgres. */
export class MemorySubmissionStore implements SubmissionStore {
  private rows: Submission[] = [];
  private uploads = new Map<string, Upload>();
  failing = false;

  private check() {
    if (this.failing) throw new Error("database unavailable");
  }

  async list(limit: number, offset: number): Promise<Page<Submission>> {
    this.check();
    const sorted = [...this.rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items: sorted.slice(offset, offset + limit), total: sorted.length };
  }

  async bySlug(slug: string) {
    this.check();
    return this.rows.find((r) => r.slug === slug) ?? null;
  }

  async byTeam(teamName: string) {
    this.check();
    return this.rows.find((r) => teamKey(r.teamName) === teamKey(teamName)) ?? null;
  }

  async byOwner(email: string) {
    this.check();
    return this.rows.find((r) => r.createdBy.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async create(input: SubmissionInput, email: string): Promise<SaveResult> {
    this.check();
    // Keep these checks and the insert in one synchronous turn so the fake
    // models the atomic unique constraints used by Postgres.
    const owned = this.rows.find((r) => r.createdBy.toLowerCase() === email.toLowerCase());
    if (owned) return { ok: false, error: "owner_taken", existing: owned };
    const team = this.rows.find((r) => teamKey(r.teamName) === teamKey(input.teamName));
    if (team) return { ok: false, error: "team_taken", existing: team };
    const id = crypto.randomUUID();
    const now = new Date(Date.now() + this.rows.length);
    const row: Submission = { ...input, id, slug: makeSlug(input.projectName, id), createdBy: email, updatedBy: email, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return { ok: true, submission: row };
  }

  async update(id: string, input: SubmissionInput, email: string): Promise<SaveResult> {
    this.check();
    const existing = this.rows.find((r) => teamKey(r.teamName) === teamKey(input.teamName));
    if (existing && existing.id !== id) return { ok: false, error: "team_taken", existing };
    const index = this.rows.findIndex((r) => r.id === id);
    const current = this.rows[index];
    if (!current) throw new Error(`submission ${id} not found`);
    if (current.createdBy.toLowerCase() !== email.toLowerCase()) throw new Error("submission owner mismatch");
    const row = { ...current, ...input, updatedBy: email, updatedAt: new Date() };
    this.rows[index] = row;
    return { ok: true, submission: row };
  }

  async delete(id: string, email: string) {
    this.check();
    const index = this.rows.findIndex((r) => r.id === id && r.createdBy.toLowerCase() === email.toLowerCase());
    if (index < 0) return null;
    return this.rows.splice(index, 1)[0] ?? null;
  }

  async recordUpload(upload: Upload) {
    this.check();
    this.uploads.set(upload.file, upload);
  }

  async upload(file: string) {
    this.check();
    return this.uploads.get(file) ?? null;
  }

  async referencedFiles() {
    this.check();
    return new Set(this.rows.flatMap((r) => [r.teamPhoto, r.posterPhoto, r.video].filter((f): f is string => !!f)));
  }

  async ping() {
    this.check();
  }
}
