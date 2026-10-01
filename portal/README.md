# Science Fair

The public gallery of Rendervous Maker Day 2026 experiments. Renders enter their @render.com email to submit and edit. See [SPEC.md](SPEC.md) for the journey and design.

Stack: Bun, Hono, server-rendered HTML, Render Postgres, a persistent disk for photos, and Google Drive for video pitches. A pitch plays on the project page through Drive's player.

Each email can own one submission. Emails are self-reported and not verified, so anyone who types a colleague's address can edit as them. The database enforces that rule, plus unique team names, even when requests arrive simultaneously. Only the creator can edit or delete their submission.

## Deploy (Maker Day 2026 workspace)

1. In the Maker Day 2026 workspace, create a Blueprint from this repo with the path `portal/render.yaml`.
2. Check it in a private window. **Submit experiment** asks for a @render.com email, then opens the form.

To close submissions after the fair, set `SUBMISSIONS_OPEN=false` on the service.

Video pitches need a Google account, not a service account. Enable the Drive API, create an OAuth client with redirect `http://127.0.0.1:8765/callback`, then run the auth command below and put the printed refresh token on the service. Until those three Google variables are set, a video upload fails with a clear message and photos still work.

| Env var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | from Blueprint | Postgres. Without it, the app uses an in-memory store locally. |
| `MEDIA_DIR` | `.data/media` | Upload directory (`/var/data/media` on Render) |
| `SUBMISSIONS_OPEN` | `true` | Kill switch for submit, edit, and upload |
| `MAX_IMAGE_MB` / `MAX_VIDEO_MB` | `25` / `500` | Upload caps. Photos use the disk; videos use Google Drive. |
| `GOOGLE_CLIENT_ID` | unset | OAuth client for the Drive account that owns the videos |
| `GOOGLE_CLIENT_SECRET` | unset | OAuth client secret. Set it in the Dashboard. |
| `GOOGLE_REFRESH_TOKEN` | unset | Refresh token for that Google account. Set it in the Dashboard. |
| `GOOGLE_DRIVE_FOLDER_ID` | unset | Optional Drive folder for video pitches |
| `ALLOWED_EMAIL_DOMAIN` | `render.com` | Only emails on this domain can submit |

## Develop

```sh
bun install
bun run dev          # http://localhost:10000, in-memory store
GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… bun src/media/google-auth.ts
bun run check        # typecheck + tests
TEST_DATABASE_URL=postgres://… bun test   # also runs the Postgres store contract
```
