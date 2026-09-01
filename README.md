# Autius Calendar Watcher

Polls the [Autius calendar](https://app.autius.com/calendario) on a schedule, diffs newly available practical classes against the last known set, and posts only **new** slots to a Discord webhook.

Notification only — it never books anything.

## How it works

1. Logs into Autius via the public API (`api.autius.com`) using email/password.
2. Fetches `/student/lessons/calendar` for the next N days.
3. Filters by weekday + time window from `config.json`.
4. Diffs against `state.json` and notifies Discord about new slots.
5. GitHub Actions commits an updated `state.json` so the next run remembers what it already told you.

## Prerequisites

- Node 20+
- An Autius student account that can see the calendar
- A Discord webhook URL

## Local setup

```bash
npm install
npx playwright install chromium   # only needed for discovery
cp .env.example .env              # fill in email, password, webhook
```

API endpoints were reverse-engineered from the public app bundles and documented in [`docs/api-notes.md`](docs/api-notes.md). The checker already targets those paths.

### 1. Discover the live API (optional, if login/calendar fails)

Opens a real Chrome window. Log in manually, then open **Calendario** and wait a few seconds so the calendar XHRs fire. Press Enter in the terminal when done.

```bash
npm run discover
```

Writes (gitignored):

- `discovery/requests.json` — captured XHR/fetch traffic
- `discovery/storageState.json` — browser session
- `discovery/summary.md` — short human-readable summary

If the default login path in `src/autius.ts` fails, re-run discovery and adjust the client using the captured requests.

### 2. Dry-run the checker locally

```bash
npm run check
```

## Config (`config.json`)

| Field | Meaning |
| --- | --- |
| `lookaheadDays` | how many days ahead to scan |
| `weekdays` | ISO weekdays to keep (1=Mon … 7=Sun) |
| `timeWindow.start/end` | inclusive HH:MM window (local Spain time as returned by the API) |
| `jitterSecondsMax` | random sleep before each check (0–N seconds) |

## Discord webhook

1. Discord server → channel settings → Integrations → Webhooks → New Webhook
2. Copy the URL into `.env` as `DISCORD_WEBHOOK_URL` (and into GitHub Actions secrets for CI)

## GitHub Actions

Workflow: [`.github/workflows/check.yml`](.github/workflows/check.yml)

- Cron: every 30 minutes between 05:00–21:59 UTC (~07:00–23:59 Spain)
- Also runnable manually via **Actions → Check Autius calendar → Run workflow**

### Secrets to add

Repo → Settings → Secrets and variables → Actions:

- `AUTIUS_EMAIL`
- `AUTIUS_PASSWORD`
- `DISCORD_WEBHOOK_URL`

### Public vs private repo (Actions minutes)

Each run is billed as at least 1 minute. Checking every 30 min during waking hours is ~700–800 runs/month.

- **Public repo**: unlimited free Actions minutes for this workload. Secrets stay encrypted.
- **Private repo**: free accounts get 2,000 min/month — enough for the daytime schedule, tight if you expand to 24/7 or add a headless browser.

Prefer a **public** repo unless you have a strong reason to keep it private. `state.json` only stores opaque slot ids and timestamps — no account data.

## Reliability

- Random jitter + a normal browser user-agent so traffic doesn't look like a metronome.
- Consecutive fetch/login failures post a distinct Discord alert, at most once per day.
- Past-date slots are pruned from `state.json` automatically.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run discover` | headed Playwright capture of calendar traffic |
| `npm run check` | one-shot poll + optional Discord notify |
| `npm run typecheck` | TypeScript check |
