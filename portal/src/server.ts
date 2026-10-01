import { createApp } from "./app";
import { loadConfig } from "./config";
import { emailCookieIdentity } from "./identity";
import { DiskFileStore } from "./media/disk";
import { GoogleDriveHost } from "./media/google-drive";
import { sweepOrphans } from "./media/sweep";
import { UnavailableVideoHost } from "./media/video";
import { MemorySubmissionStore } from "./submissions/memory";
import { PostgresSubmissionStore } from "./submissions/postgres";

const config = loadConfig();

if (!config.databaseUrl && process.env.RENDER) throw new Error("DATABASE_URL is required on Render");
const submissions = config.databaseUrl ? PostgresSubmissionStore.connect(config.databaseUrl) : new MemorySubmissionStore();
const files = new DiskFileStore(config.mediaDir);
await files.init();
const videos =
  config.googleClientId && config.googleClientSecret && config.googleRefreshToken
    ? new GoogleDriveHost({
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        refreshToken: config.googleRefreshToken,
        folderId: config.googleDriveFolderId,
      })
    : new UnavailableVideoHost();
const identity = emailCookieIdentity(config.emailDomain);

const app = createApp({ config, submissions, files, videos, identity });

const sweep = () =>
  sweepOrphans(files, submissions)
    .then((n) => n && console.log(`removed ${n} unused uploads`))
    .catch((e) => console.warn("upload sweep skipped:", (e as Error).message));
setTimeout(sweep, 60_000);
setInterval(sweep, 6 * 60 * 60 * 1000);

Bun.serve({ hostname: "0.0.0.0", port: config.port, fetch: app.fetch, idleTimeout: 255, maxRequestBodySize: config.maxVideoBytes + 1024 * 1024 });
console.log(`Science Fair listening on 0.0.0.0:${config.port} (store: ${config.databaseUrl ? "postgres" : "memory"})`);
