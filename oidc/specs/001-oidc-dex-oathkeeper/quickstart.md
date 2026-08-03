# Quickstart: Authentication with OIDC via Dex + Oathkeeper + Kratos

**Feature**: `001-oidc-dex-oathkeeper` | **Date**: 2026-07-31 | **Revised**: 2026-08-01

Run from the `dex-oathkeeper-kratos/` app directory (this is one of two sibling apps in a monorepo
built for architecture comparison; see the sibling `hydra-kratos/` app / spec `002-oidc-hydra-kratos`).

## Prerequisites

- Docker and Docker Compose
- Node.js (LTS) and npm/pnpm, to run the Next.js app itself — **not optional** for this approach
  (see below)

## Setup

```bash
docker compose -f deploy/compose.yml up -d
npm run dev
```

`docker compose up` brings up Ory Oathkeeper, Dex, Ory Kratos (+ Postgres), and a local mail catcher
for recovery/verification emails (see research.md §4) — but deliberately does **not** run the
Next.js app itself as a container. Dex's `issuer` must be one single URL that both the browser and
the app's own server-side OIDC discovery call resolve identically (research.md §7a); running the
app on the host, alongside the containerized identity stack, is what makes `http://localhost:4455/dex`
mean the same thing in both places, with no Docker-network-hostname workaround needed. Refer to
`README.md` for exact service names, ports, and environment variables once implemented.

## Validation Scenarios

Each scenario below maps to an acceptance scenario in `spec.md` and should be exercised via
Playwright end-to-end tests (research.md §5) against the full Compose stack, plus manually in a
browser during development.

### 1. First-time login (User Story 1 / FR-001–FR-004)

1. Open the app at `http://localhost:3000` with no existing session (fresh/incognito browser).
2. **Expect**: redirect to `/login` (contracts/app-routes.md → `GET /`).
3. Click "Continue with {provider}".
4. **Expect**: redirected through Dex/Oathkeeper to the Kratos registration or login page rendered
   in the app's own design (`/kratos/login`), complete credentials.
5. **Expect**: redirected back to `/`, Welcome page shows "Hello, {name or email}".

### 2. Returning with an active session (User Story 2 / FR-001)

1. With the session from Scenario 1 still valid, reload `http://localhost:3000`.
2. **Expect**: Welcome page renders immediately; no redirect to `/login` is observed (check network
   log / no `307` to `/login`).

### 3. Denied/cancelled authorization (Edge Cases, FR-005)

1. From `/login`, click "Continue with {provider}" then cancel/deny at the identity provider (or
   simulate by causing Dex to return an `error` param to the callback).
2. **Expect**: returned to `/login?error=...` with a visible, dismissible error message; button is
   still clickable to retry.

### 4. Silent session extension (User Story 3 / FR-006) — REVISED 2026-08-01

1. With an active session and a still-valid Kratos browser session, use dev tooling (test-only
   endpoint or cookie edit) to force the app's access token to appear expired.
2. Perform any action that calls `GET /api/auth/session` (e.g., reload the Welcome page).
3. **Expect**: Welcome page still renders with no visit to `/login`; verify (via server logs) that a
   silent re-authorization round-trip occurred against Dex/Oathkeeper/Kratos and a fresh Session
   cookie was issued (data-model.md — this is NOT an OAuth refresh-token grant; see research.md §3,
   revised, for why Dex's `authproxy` connector cannot support one).

### 5. Underlying Kratos session invalid/expired (Edge Cases, FR-007) — REVISED 2026-08-01

1. With an active app session, end or expire the underlying Kratos browser session (e.g., call
   Kratos's logout self-service action, or expire/delete the `ory_kratos_session` cookie).
2. Force the app's access token to appear expired as in Scenario 4.
3. Perform an action that calls `GET /api/auth/session`.
4. **Expect**: the silent re-authorization attempt fails at Oathkeeper's `cookie_session` check, and
   the user is redirected to `/login`; no error page or stuck state (SC-004).

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
- See `contracts/app-routes.md` for exact route behavior underlying each step.
- See `research.md` for why Oathkeeper + Dex `authproxy` + Kratos is used instead of a direct
  Dex↔Kratos connector, and for why session renewal is a silent re-authorization rather than an OAuth
  refresh-token grant (§3, revised).
