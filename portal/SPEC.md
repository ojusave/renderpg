# Science Fair: Maker Day 2026 submissions

A public gallery of every Maker Day experiment. Renders enter their @render.com email to submit and edit.

## Journey

| Who | Does | Sees |
| --- | --- | --- |
| Anyone | Opens `/` | Hero, count, grid of poster cards. Empty state: "No experiments yet." |
| Anyone | Opens a card | Project page laid out like a trifold: poster, then Hypothesis / Method / Results, then video pitch and team photo, plus "Visit site". |
| Render employee | Clicks **Submit experiment** | An email step (only the first time; @render.com only), then the lab-notebook form. |
| Render employee | Already has a submission and clicks **Submit** | Goes straight to their existing experiment's edit form. One person cannot create a duplicate. |
| Render employee | Types a team name that exists | Their own team links to Edit. Another team's name asks them to choose a different name. |
| Render employee | Drops a photo or video | Instant preview, upload starts right away with progress. Photos are resized in the browser. |
| Render employee | Saves | Checklist blocks save until all 8 required fields are done. Lands on the project page with "Experiment logged." The card is live in the gallery. |
| Creator | Clicks **Edit** | Same form, prefilled. Untouched files are kept. Other people receive a 403. |
| Creator | Clicks **Delete experiment** | Confirms the destructive action, then the card and uploaded files are removed. They may submit again. |

Required: team name (unique), project name, site URL, team photo, poster photo, hypothesis, method, results. Optional: video pitch. Each email can own exactly one submission. Emails are self-reported, not verified.

## Simultaneous use and duplicate protection

- Postgres has unique constraints on normalized team name and creator email. These are atomic: two requests arriving at the same instant still produce only one row.
- If concurrent tabs race, one creates the experiment and the other is redirected to edit that same experiment.
- Edit and delete queries include both submission ID and creator email. Route checks alone are not trusted.
- Photos stay on the service disk. Video pitches upload to Google Drive and play in the project page through Drive's embedded player, so viewers do not stream the file through the web service.
- Uploaded files use UUID names and stream to disk, so simultaneous uploads do not overwrite one another.
- Upload records are tied to the signed-in email. A user cannot attach another person's uploaded file.
- Lists are paginated and the Postgres pool bounds database concurrency. Failed or abandoned uploads are swept after 24 hours.

## Design language (from Rendervous H2 ’26)

- **Theme:** "Rendervous: For Science!" with the Science Fair as the showcase.
- **Lab groups as elements:** every team gets a periodic-table tile (Barium → `56 Ba`), like the lab-group keychains.
- **Trifold:** the project page follows the poster panels (Title, Hypothesis, Method, Results).
- **Lab notebook:** graph-paper background, mono labels, form steps "01 The lab / 02 The evidence / 03 The findings".
- **Construction paper:** tile colors come from the schedule key (Laboratory green, Lecture Hall blue, Offsite yellow, Meals orange).
- **Copy:** the hypothesis prompt is "If we…, then…". Results says "Some experiments fail in interesting ways."
- **Motion:** 0.15s hover, 0.3s page and card enter, upload progress, and a save toast. All of it is off under `prefers-reduced-motion`.

## Render

| Need | Render | Notes |
| --- | --- | --- |
| Pages, uploads, auth | Web Service (starter, Bun) | Email step stores the address in an httpOnly cookie. |
| Submissions | Render Postgres | Private network only (`ipAllowList: []`). Migrations run as the pre-deploy command. |
| Photos | Persistent disk at `/var/data` | Single instance. Unused uploads are swept after 24h. |
| Video pitches | Google Drive (external) | Render has no object storage. Drive's player embeds on the project page. |
| Kill switch | `SUBMISSIONS_OPEN=false` | Closes writes and keeps the gallery. |

Not used: Workflows (saves are synchronous) and Sandboxes (video plays in the browser).

## Routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/` `?page=` | public | Gallery, 24 per page |
| GET | `/p/:slug` | public | Project page |
| GET | `/media/:file` | public | Photos and video, with Range support and immutable caching |
| GET | `/health` | public | `{ status, db }` |
| GET, POST | `/signin` `?next=` | public | Asks for a @render.com email, then returns to `next` |
| POST | `/signout` | public | Forgets the email ("Not you?") |
| GET, POST | `/submit` | email | New experiment |
| GET, POST | `/edit/:slug` | email | Edit experiment |
| POST | `/delete/:slug` | email | Delete the creator's experiment and media |
| POST | `/api/uploads?kind=team\|poster\|video` | email | Raw file body. Returns `{ data: { file, url } }` |
| GET | `/api/teams?name=&except=` | email | Checks whether a team name is taken |

API errors use `{ error: { code, message } }`.
