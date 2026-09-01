# api notes (from public app bundles)

static discovery without logging in, by inspecting `https://app.autius.com` js assets.
live confirmation: `npm run discover`.

## bases

- app: `https://app.autius.com` (vercel spa)
- api: `https://api.autius.com/api/v1`
- auth client base: `https://api.autius.com` (better-auth style)

## student calendar

- `GET /student/lessons/calendar?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- related (not required for watching):
  - `GET /student/lessons/booking-catalog`
  - `GET /student/lessons/reserved`
  - `GET /student/lessons/balance`

## auth

- session probe: `/api/auth/get-session` (and `/get-session`)
- profile: `GET /api/v1/auth/me`
- sign-in candidates tried by [`src/autius.ts`](../src/autius.ts):
  - `POST /api/auth/sign-in/email`
  - `POST /api/auth/signin/email`
  - `POST /api/auth/login`
  - `POST /auth/sign-in/email`
- body: `{ "email", "password", "rememberMe": true }`
- session via cookies
