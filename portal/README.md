# Science Fair

The public gallery of Rendervous Maker Day 2026 experiments. Renders sign in with Okta to submit and edit. See [SPEC.md](SPEC.md) for the journey and design.

Stack: Bun, Hono, server-rendered HTML, Render Postgres, and a persistent disk for uploads.

Each Okta email can own one submission. The database enforces that rule, plus unique team names, even when requests arrive simultaneously. Only the creator can edit or delete their submission.

## Deploy (Maker Day 2026 workspace)

1. In the Maker Day 2026 workspace, create a Blueprint from this repo with the path `portal/render.yaml`.
2. On the `maker-day-science-fair` service, open the authentication settings and enter the shared Maker Day Okta client ID and secret from 1Password. The secret is Dashboard-only.
3. Make sure the Okta app allows `https://<service>.onrender.com/oauth2/callback` as a redirect URI.
4. Check it in a private window. `/` and a project page open without login. **Submit experiment** goes to Okta.

To close submissions after the fair, set `SUBMISSIONS_OPEN=false` on the service.

| Env var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | from Blueprint | Postgres. Without it, the app uses an in-memory store locally. |
| `MEDIA_DIR` | `.data/media` | Upload directory (`/var/data/media` on Render) |
| `SUBMISSIONS_OPEN` | `true` | Kill switch for submit, edit, and upload |
| `MAX_IMAGE_MB` / `MAX_VIDEO_MB` | `25` / `500` | Upload caps that protect the 10 GB disk |
| `OKTA_ISSUER` | `https://render.okta.com` | Token issuer |
| `AUTH_MODE` | `okta` | `dev` for local only (refused on Render) |

## Develop

```sh
bun install
bun run dev          # http://localhost:10000 as scientist@render.com, in-memory store
bun run check        # typecheck + tests
TEST_DATABASE_URL=postgres://… bun test   # also runs the Postgres store contract
```
