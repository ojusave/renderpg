export type Config = {
  port: number;
  databaseUrl: string | undefined;
  mediaDir: string;
  emailDomain: string;
  secureCookies: boolean;
  submissionsOpen: boolean;
  maxImageBytes: number;
  maxVideoBytes: number;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRefreshToken?: string;
  googleDriveFolderId?: string;
  assetVersion: string;
};

const MB = 1024 * 1024;

/** Reads every runtime setting from environment variables, with production-safe defaults. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number(env.PORT ?? 10000),
    databaseUrl: env.DATABASE_URL,
    mediaDir: env.MEDIA_DIR ?? ".data/media",
    emailDomain: env.ALLOWED_EMAIL_DOMAIN ?? "render.com",
    secureCookies: Boolean(env.RENDER),
    submissionsOpen: env.SUBMISSIONS_OPEN !== "false",
    maxImageBytes: Number(env.MAX_IMAGE_MB ?? 25) * MB,
    maxVideoBytes: Number(env.MAX_VIDEO_MB ?? 500) * MB,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    googleRefreshToken: env.GOOGLE_REFRESH_TOKEN,
    googleDriveFolderId: env.GOOGLE_DRIVE_FOLDER_ID,
    assetVersion: (env.RENDER_GIT_COMMIT ?? String(Date.now())).slice(0, 8),
  };
}
