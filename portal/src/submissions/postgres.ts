import { SQL } from "bun";
import { makeSlug, teamKey } from "./slug";
import type { MediaKind, Page, SaveResult, Submission, SubmissionInput, SubmissionStore, Upload } from "./types";

type Row = Record<string, unknown>;

const toSubmission = (r: Row): Submission => ({
  id: r.id as string,
  slug: r.slug as string,
  teamName: r.team_name as string,
  projectName: r.project_name as string,
  siteUrl: r.site_url as string,
  hypothesis: r.hypothesis as string,
  methods: r.methods as string,
  results: r.results as string,
  teamPhoto: r.team_photo as string,
  posterPhoto: r.poster_photo as string,
  video: (r.video as string | null) ?? null,
  createdBy: r.created_by as string,
  updatedBy: r.updated_by as string,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

const isUniqueViolation = (e: unknown) => (e as { errno?: string; code?: string }).errno === "23505" || (e as { code?: string }).code === "23505";

/** Render Postgres implementation of the submission store. */
export class PostgresSubmissionStore implements SubmissionStore {
  constructor(private sql: SQL) {}

  static connect(url: string) {
    return new PostgresSubmissionStore(new SQL({ url, max: 10, idleTimeout: 30, connectionTimeout: 5 }));
  }

  async list(limit: number, offset: number): Promise<Page<Submission>> {
    const [rows, count] = await Promise.all([
      this.sql`select * from submissions order by created_at desc limit ${limit} offset ${offset}`,
      this.sql`select count(*)::int as n from submissions`,
    ]);
    return { items: (rows as Row[]).map(toSubmission), total: (count as Row[])[0]?.n as number };
  }

  async bySlug(slug: string) {
    const rows = (await this.sql`select * from submissions where slug = ${slug}`) as Row[];
    return rows[0] ? toSubmission(rows[0]) : null;
  }

  async byTeam(teamName: string) {
    const rows = (await this.sql`select * from submissions where team_key = ${teamKey(teamName)}`) as Row[];
    return rows[0] ? toSubmission(rows[0]) : null;
  }

  async byOwner(email: string) {
    const rows = (await this.sql`select * from submissions where lower(created_by) = ${email.toLowerCase()}`) as Row[];
    return rows[0] ? toSubmission(rows[0]) : null;
  }

  async create(input: SubmissionInput, email: string): Promise<SaveResult> {
    const id = crypto.randomUUID();
    try {
      const rows = (await this.sql`
        insert into submissions (id, slug, team_name, team_key, project_name, site_url, hypothesis, methods, results,
          team_photo, poster_photo, video, created_by, updated_by)
        values (${id}, ${makeSlug(input.projectName, id)}, ${input.teamName}, ${teamKey(input.teamName)}, ${input.projectName},
          ${input.siteUrl}, ${input.hypothesis}, ${input.methods}, ${input.results}, ${input.teamPhoto}, ${input.posterPhoto},
          ${input.video}, ${email}, ${email})
        returning *`) as Row[];
      return { ok: true, submission: toSubmission(rows[0]!) };
    } catch (e) {
      return this.conflict(e, input.teamName, email, true);
    }
  }

  async update(id: string, input: SubmissionInput, email: string): Promise<SaveResult> {
    try {
      const rows = (await this.sql`
        update submissions set team_name = ${input.teamName}, team_key = ${teamKey(input.teamName)},
          project_name = ${input.projectName}, site_url = ${input.siteUrl}, hypothesis = ${input.hypothesis},
          methods = ${input.methods}, results = ${input.results}, team_photo = ${input.teamPhoto},
          poster_photo = ${input.posterPhoto}, video = ${input.video}, updated_by = ${email}, updated_at = now()
        where id = ${id} and lower(created_by) = ${email.toLowerCase()} returning *`) as Row[];
      if (!rows[0]) throw new Error(`submission ${id} not found`);
      return { ok: true, submission: toSubmission(rows[0]) };
    } catch (e) {
      return this.conflict(e, input.teamName, email, false);
    }
  }

  private async conflict(e: unknown, teamName: string, email: string, creating: boolean): Promise<SaveResult> {
    if (!isUniqueViolation(e)) throw e;
    if (creating) {
      const owned = await this.byOwner(email);
      if (owned) return { ok: false, error: "owner_taken", existing: owned };
    }
    const team = await this.byTeam(teamName);
    if (team) return { ok: false, error: "team_taken", existing: team };
    throw e;
  }

  async delete(id: string, email: string) {
    const rows = (await this.sql`
      delete from submissions
      where id = ${id} and lower(created_by) = ${email.toLowerCase()}
      returning *`) as Row[];
    return rows[0] ? toSubmission(rows[0]) : null;
  }

  async recordUpload(u: Upload) {
    await this.sql`insert into uploads (id, kind, file, bytes, created_by) values (${u.id}, ${u.kind}, ${u.file}, ${u.bytes}, ${u.createdBy})`;
  }

  async upload(file: string): Promise<Upload | null> {
    const rows = (await this.sql`select * from uploads where file = ${file}`) as Row[];
    const r = rows[0];
    if (!r) return null;
    return { id: r.id as string, kind: r.kind as MediaKind, file: r.file as string, bytes: Number(r.bytes), createdBy: r.created_by as string, createdAt: new Date(r.created_at as string) };
  }

  async referencedFiles() {
    const rows = (await this.sql`select team_photo, poster_photo, video from submissions`) as Row[];
    return new Set(rows.flatMap((r) => [r.team_photo, r.poster_photo, r.video].filter((f): f is string => typeof f === "string")));
  }

  async ping() {
    await this.sql`select 1`;
  }
}
