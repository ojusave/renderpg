export type Who = { status: "signed_in"; email: string } | { status: "anonymous" };

/** Identity port: who is making this request. */
export interface Identity {
  whoIs(req: Request): Promise<Who>;
}

export const EMAIL_COOKIE = "sf_email";

/** Lowercased email when it is a plain address on the allowed domain, otherwise null. */
export function workEmail(input: unknown, domain: string): string | null {
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  const local = email.slice(0, -(domain.length + 1));
  return email.endsWith(`@${domain}`) && /^[a-z0-9._%+-]+$/.test(local) ? email : null;
}

/** Reads the self-reported work email the visitor entered on the sign-in page. */
export function emailCookieIdentity(domain: string): Identity {
  return {
    async whoIs(req) {
      const cookie = req.headers.get("cookie") ?? "";
      const raw = cookie.split(/;\s*/).find((part) => part.startsWith(`${EMAIL_COOKIE}=`))?.slice(EMAIL_COOKIE.length + 1);
      const email = raw ? workEmail(decodeURIComponent(raw), domain) : null;
      return email ? { status: "signed_in", email } : { status: "anonymous" };
    },
  };
}
