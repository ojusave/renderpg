export type Config = {
  port: number;
  databaseUrl: string | undefined;
  mediaDir: string;
  authMode: "okta" | "dev";
  devEmail: string;
  oktaIssuer: string;
  oktaJwksUrl: string;
  emailDomain: string;
  submissionsOpen: boolean;
  maxImageBytes: number;
  maxVideoBytes: number;
  assetVersion: string;
};

const MB = 1024 * 1024;

/** Reads every runtime setting from environment variables, with production-safe defaults. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const authMode = env.AUTH_MODE === "dev" ? "dev" : "okta";
  if (authMode === "dev" && env.RENDER) throw new Error("AUTH_MODE=dev is not allowed on Render");
  const issuer = env.OKTA_ISSUER ?? "https://render.okta.com";
  return {
    port: Number(env.PORT ?? 10000),
    databaseUrl: env.DATABASE_URL,
    mediaDir: env.MEDIA_DIR ?? ".data/media",
    authMode,
    devEmail: env.DEV_EMAIL ?? "scientist@render.com",
    oktaIssuer: issuer,
    oktaJwksUrl: env.OKTA_JWKS_URL ?? `${issuer}/oauth2/v1/keys`,
    emailDomain: env.ALLOWED_EMAIL_DOMAIN ?? "render.com",
    submissionsOpen: env.SUBMISSIONS_OPEN !== "false",
    maxImageBytes: Number(env.MAX_IMAGE_MB ?? 25) * MB,
    maxVideoBytes: Number(env.MAX_VIDEO_MB ?? 500) * MB,
    assetVersion: (env.RENDER_GIT_COMMIT ?? String(Date.now())).slice(0, 8),
  };
}
