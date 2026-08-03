# Quickstart: Authentication with OIDC via Hydra + Kratos

**Feature**: `002-oidc-hydra-kratos` | **Date**: 2026-08-01

Run from the `hydra-kratos/` app directory (this is one of two sibling apps in a monorepo built for
architecture comparison; see the sibling `dex-oathkeeper-kratos/` app / spec
`001-oidc-dex-oathkeeper`).

## Prerequisites

- Docker and Docker Compose
- Node.js (LTS) and npm/pnpm, for running the Next.js app outside the container during development
  (optional — the Compose stack can run it too)

## Setup

```bash
docker compose up -d
```

This brings up: Next.js app, Ory Hydra (+ its own Postgres), Ory Kratos (+ its own Postgres), and a
local mail catcher for recovery/verification emails (see research.md §5). No Oathkeeper (research.md
§4). Refer to `README.md` for exact service names, ports, and environment variables once
implemented.

## Validation Scenarios

Each scenario below maps to an acceptance scenario in `spec.md` and should be exercised via
Playwright end-to-end tests (research.md §6) against the full Compose stack, plus manually in a
browser during development.

### 1. First-time login (User Story 1 / FR-001–FR-004)

1. Open the app at `http://localhost:3000` with no existing session (fresh/incognito browser).
2. **Expect**: redirect to `/login` (contracts/app-routes.md → `GET /`).
3. Click "Continue with {provider}".
4. **Expect**: `GET /api/auth/login` redirects to Hydra's `/oauth2/auth`, which redirects to
   `/hydra/login?login_challenge=...` (contracts/app-routes.md), which — since no Kratos session
   exists yet — redirects to `/kratos/login?return_to=/hydra/login?login_challenge=...`; complete
   Kratos registration or login there.
5. **Expect**: redirected back through `/hydra/login` (now accepted) → `/hydra/consent` (auto-accepted,
   no visible consent screen) → Hydra issues a code → `/api/auth/callback` → `/`, Welcome page shows
   "Hello, {name or email}".

### 2. Returning with an active session (User Story 2 / FR-001)

1. With the session from Scenario 1 still valid, reload `http://localhost:3000`.
2. **Expect**: Welcome page renders immediately; no redirect to `/login` is observed (check network
   log / no `307` to `/login`).

### 3. Denied/cancelled authorization (Edge Cases, FR-005)

1. From `/login`, click "Continue with {provider}" then cause Hydra to return an `error` param to
   the callback (e.g., by rejecting the login request instead of accepting it, via a test-only
   toggle in the login bridge, or by cancelling at the Kratos login step).
2. **Expect**: returned to `/login?error=...` with a visible, dismissible error message; button is
   still clickable to retry.

### 4. Silent session extension via refresh_token (User Story 3 / FR-006)

1. With an active session, use dev tooling (test-only endpoint or cookie edit) to force the access
   token to appear expired while leaving the refresh token valid.
2. Perform any action that calls `GET /api/auth/session` (e.g., reload the Welcome page).
3. **Expect**: Welcome page still renders with no visit to `/login`; verify (via server logs, or via
   Hydra's Admin API `GET /admin/oauth2/auth/sessions/consent?subject=`) that a standards-compliant
   refresh-token grant occurred against Hydra's public `/oauth2/token` endpoint and the stored
   refresh token rotated (data-model.md; contract note on `GET /api/auth/session`) — this is the
   scenario that could NOT be validated this way in the sibling Approach A app.

### 5. Refresh token invalid/expired (Edge Cases, FR-007)

1. With an active session, revoke the refresh token via Hydra's Admin API
   (`DELETE /admin/oauth2/auth/sessions/consent?subject=` or equivalent) or simulate expiry.
2. Force the access token to appear expired as in Scenario 4.
3. Perform an action that calls `GET /api/auth/session`.
4. **Expect**: redirected to `/login`; no error page or stuck state (SC-004).

### 5b. Underlying Kratos session ends independently of the refresh token (Edge Cases)

1. With an active session and a still-valid Hydra refresh token, end the underlying Kratos session
   (e.g., call Kratos's logout self-service action) without touching Hydra at all.
2. Force the access token to appear expired as in Scenario 4.
3. Perform an action that calls `GET /api/auth/session`.
4. **Expect**: the refresh grant against Hydra may still nominally succeed, but this endpoint's
   additional Kratos `/sessions/whoami` re-check (contracts/app-routes.md note) catches the ended
   Kratos session and redirects to `/login` — verifying the "identity it was issued for no longer
   has a valid session" branch of FR-007, not just Hydra's own refresh-token validity.

### 6. Cross-tab logout notification (Clarifications; POST /api/auth/logout)

1. Open the app in two browser tabs, both authenticated.
2. In Tab A, trigger logout.
3. **Expect**: Tab B shows a non-blocking pop-up indicating the session ended, without requiring a
   manual reload to detect it.

### 7. Cross-tab login notification (Clarifications)

1. Open the app in two tabs with no session; both show `/login`.
2. In Tab A, complete login (Scenario 1).
3. **Expect**: Tab B shows a non-blocking pop-up indicating a session was created.

## Notes

- See `data-model.md` for the Session lifecycle referenced above.
- See `contracts/app-routes.md` for exact route behavior underlying each step, including the
  `/hydra/login` and `/hydra/consent` bridge routes that have no equivalent in the sibling approach.
- See `research.md` for why Hydra is used instead of Dex (§1), how the login/consent bridge works
  (§2), why Oathkeeper is unnecessary here (§4), and the Kratos-session/Hydra-"remembered"-login
  coupling that Scenario 5b exercises (§5).
