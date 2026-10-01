export type MediaKind = "team" | "poster" | "video";

export type Upload = {
  id: string;
  kind: MediaKind;
  file: string;
  bytes: number;
  createdBy: string;
  createdAt: Date;
};

export type SubmissionInput = {
  teamName: string;
  projectName: string;
  siteUrl: string;
  hypothesis: string;
  methods: string;
  results: string;
  teamPhoto: string;
  posterPhoto: string;
  video: string | null;
};

/** Media fields hold the stored file name, served at `/media/<file>`. */
export type Submission = SubmissionInput & {
  id: string;
  slug: string;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type SaveResult =
  | { ok: true; submission: Submission }
  | { ok: false; error: "team_taken" | "owner_taken"; existing: Submission };

export type Page<T> = { items: T[]; total: number };

/** Persistence port for submissions and the uploads they reference. */
export interface SubmissionStore {
  list(limit: number, offset: number): Promise<Page<Submission>>;
  bySlug(slug: string): Promise<Submission | null>;
  byTeam(teamName: string): Promise<Submission | null>;
  byOwner(email: string): Promise<Submission | null>;
  create(input: SubmissionInput, email: string): Promise<SaveResult>;
  update(id: string, input: SubmissionInput, email: string): Promise<SaveResult>;
  delete(id: string, email: string): Promise<Submission | null>;
  recordUpload(upload: Upload): Promise<void>;
  upload(file: string): Promise<Upload | null>;
  referencedFiles(): Promise<Set<string>>;
  ping(): Promise<void>;
}
