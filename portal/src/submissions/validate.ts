import type { SubmissionInput } from "./types";

export type FormValues = Record<keyof SubmissionInput, string>;
export type FieldErrors = Partial<Record<keyof SubmissionInput, string>>;
export type Validated = { ok: true; input: SubmissionInput } | { ok: false; values: FormValues; errors: FieldErrors };

const TEXT_FIELDS = ["teamName", "projectName", "siteUrl", "hypothesis", "methods", "results"] as const;

const REQUIRED: Record<keyof SubmissionInput, string> = {
  teamName: "Add your team name.",
  projectName: "Give the experiment a name.",
  siteUrl: "Add the link to your live site.",
  hypothesis: "What did you set out to prove?",
  methods: "How did you build it?",
  results: "What happened?",
  teamPhoto: "Add a team photo.",
  posterPhoto: "Add a photo of your poster.",
  video: "",
};

/** Returns the URL if it is an absolute http(s) link, otherwise null. */
export function normalizeUrl(raw: string): string | null {
  const value = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Checks a submitted form and returns either clean input or per-field messages. */
export function validateSubmission(form: Record<string, unknown>): Validated {
  const get = (k: string) => (typeof form[k] === "string" ? (form[k] as string).trim() : "");
  const values = Object.fromEntries(Object.keys(REQUIRED).map((k) => [k, get(k)])) as FormValues;
  const errors: FieldErrors = {};
  for (const [field, message] of Object.entries(REQUIRED) as [keyof SubmissionInput, string][]) {
    if (message && !values[field]) errors[field] = message;
  }
  const siteUrl = values.siteUrl ? normalizeUrl(values.siteUrl) : null;
  if (values.siteUrl && !siteUrl) errors.siteUrl = "That doesn't look like a web address.";
  if (Object.keys(errors).length) return { ok: false, values, errors };
  const text = Object.fromEntries(TEXT_FIELDS.map((k) => [k, values[k]]));
  return {
    ok: true,
    input: { ...(text as Pick<SubmissionInput, (typeof TEXT_FIELDS)[number]>), siteUrl: siteUrl!, teamPhoto: values.teamPhoto, posterPhoto: values.posterPhoto, video: values.video || null },
  };
}

/** Converts a saved submission back into form values for editing. */
export function toFormValues(input: SubmissionInput): FormValues {
  return { ...input, video: input.video ?? "" };
}
