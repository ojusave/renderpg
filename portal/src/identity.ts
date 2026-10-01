import { createRemoteJWKSet, jwtVerify } from "jose";

export type Who = { status: "signed_in"; email: string } | { status: "anonymous" } | { status: "rejected"; reason: string };

/** Identity port: who is making this request. */
export interface Identity {
  whoIs(req: Request): Promise<Who>;
}

/** Verifies the Okta access token that Render's login proxy forwards in `X-Forwarded-Access-Token`. */
export function oktaIdentity(opts: { issuer: string; jwksUrl: string; emailDomain: string }): Identity {
  const jwks = createRemoteJWKSet(new URL(opts.jwksUrl), { timeoutDuration: 5000, cooldownDuration: 30_000 });
  return {
    async whoIs(req) {
      const token = req.headers.get("x-forwarded-access-token");
      if (!token) return { status: "anonymous" };
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer: opts.issuer, algorithms: ["RS256"] });
        const email = typeof payload.sub === "string" ? payload.sub.toLowerCase() : "";
        if (!email.endsWith(`@${opts.emailDomain}`)) return { status: "rejected", reason: "not a Render account" };
        return { status: "signed_in", email };
      } catch (e) {
        return { status: "rejected", reason: (e as Error).message };
      }
    },
  };
}

/** Local development identity: everyone is the configured dev user. */
export function devIdentity(email: string): Identity {
  return { whoIs: async () => ({ status: "signed_in", email }) };
}
