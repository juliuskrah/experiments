---

description: "Task list template for feature implementation"
---

# Tasks: Authentication with OIDC via Dex + Oathkeeper + Kratos

**Input**: Design documents from `/specs/001-oidc-dex-oathkeeper/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/app-routes.md, quickstart.md

**Revision note (2026-08-01)**: This is a revision of an in-progress feature. Phases 1–2 and most of
Phase 3 are already implemented under `dex-oathkeeper-kratos/` and verified working end-to-end
against a live Docker Compose stack — including fixes for several config bugs found only by running
the real stack (research.md §7). The revision also corrects Phase 5 (User Story 3), which the
original tasks described as an OAuth refresh-token grant; live testing proved Dex's `authproxy`
connector cannot issue one (research.md §3, revised), so Phase 5's tasks now implement silent
re-authorization instead.

**Tests**: Included. Constitution Principle III (Test-First for Auth Logic, NON-NEGOTIABLE) requires
tests to be written first for all authentication/session/token logic in this feature, and Principle
V favors vetted components over untested custom code. Write each test task, confirm it fails, then
implement.

**Organization**: Tasks are grouped by user story (US1–US3 from spec.md, plus US4 for the cross-tab
session notifications explicitly requested during planning — see plan.md Summary and
quickstart.md Scenarios 6–7) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Per plan.md Project Structure, this app lives entirely under `dex-oathkeeper-kratos/` in the
repository (a monorepo also containing the sibling `hydra-kratos/` comparison app). All paths below
are relative to `dex-oathkeeper-kratos/`: `app/` (Next.js App Router source), `middleware.ts` (this
app's own root, per Next.js convention — not under `app/`), `tests/unit/` (Vitest), `tests/e2e/`
(Playwright), `deploy/` (Docker Compose + Dex/Oathkeeper/Kratos config), `README.md`.

---

## Phase 1: Setup (Shared Infrastructure) — ✅ COMPLETE

**Purpose**: Project initialization and basic structure

- [X] T001 Create repository structure per plan.md: `app/`, `app/api/auth/`, `app/kratos/`, `app/lib/`, `tests/unit/`, `tests/e2e/`, `deploy/dex/`, `deploy/oathkeeper/`, `deploy/kratos/`
- [X] T002 Initialize the Next.js (TypeScript, App Router) project at `dex-oathkeeper-kratos/`: `package.json`, `tsconfig.json`, `next.config.ts`
- [X] T003 [P] Install and pin dependencies: `next`, `react`, `openid-client`, `jose`, `@ory/elements-react`, `@ory/nextjs`, `@ory/client-fetch` in `package.json`
- [X] T004 [P] Configure Vitest + React Testing Library (`vitest.config.ts`, test setup file) for `tests/unit/`
- [X] T005 [P] Configure Playwright (`playwright.config.ts`) for `tests/e2e/`, pointed at the Docker Compose stack base URL
- [X] T006 [P] Create `.env.example` documenting required environment variables: `DEX_ISSUER_URL`, `DEX_CLIENT_ID`, `DEX_CLIENT_SECRET`, `SESSION_SECRET`, `KRATOS_PUBLIC_URL`

**Checkpoint**: Project scaffolding builds and lints; no feature logic yet. ✅ Verified (`npm run build`, `npm run lint` both clean).

---

## Phase 2: Foundational (Blocking Prerequisites) — ✅ COMPLETE

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T007 Write Dex configuration `deploy/dex/config.yaml` enabling the `authproxy` connector (`userIDHeader`, `userHeader` → display name, `emailHeader`) per research.md §1 and §7 (userHeader corrected to map to the `name` claim; SQLite storage; `staticClients[].id`/`.secret` use gomplate `{{ .Env.* }}` syntax, not shell `$VAR`)
- [X] T008 Write Oathkeeper configuration `deploy/oathkeeper/config.yaml` (glob matching strategy; `authorizers.allow`/`mutators.header` explicitly enabled) and access rule `deploy/oathkeeper/rules.json`: `cookie_session` authenticator against Kratos `/sessions/whoami`, `header` mutator injecting `X-Remote-User`/`X-Remote-Email`/`X-Remote-Name`, `redirect` error handler to the Next.js Kratos-login page, per research.md §1 and §7
- [X] T009 Write Kratos configuration `deploy/kratos/kratos.yml` (secrets via `SECRETS_COOKIE_0`/`SECRETS_CIPHER_0` env vars, not `$VAR` in YAML — research.md §7) and identity schema `deploy/kratos/identity.schema.json`: enable login/registration/recovery self-service flows, Postgres DSN, courier pointed at the mail catcher, per research.md §2 and §4
- [X] T010 Write Docker Compose stack `deploy/compose.yml` wiring together `postgres`, `kratos` (+ `kratos-migrate`), `mailslurper`, `dex`, `oathkeeper`, and the Next.js `app` service, with Dex published only to Oathkeeper's internal network (research.md §1 threat consideration; research.md §4)
- [X] T011 [P] Implement encrypted session cookie encode/decode helpers (JWE via `jose`) in `app/lib/session.ts`, matching the Session entity in data-model.md (revised: no `refreshToken` field)
- [X] T012 [P] Implement OIDC client configuration and discovery against Dex (`openid-client`) in `app/lib/oidc-client.ts`, including PKCE (`code_verifier`/`code_challenge`/`state`/`nonce`) helper functions, per research.md §3 (revised: scope is `openid profile email`, no `offline_access`, no refresh-grant function)
- [X] T013 Implement `middleware.ts` (at `dex-oathkeeper-kratos/` root per Next.js convention, not under `app/`): optimistic auth-gate check of the session cookie, `307` redirect to `/login?return_to=` when absent/invalid, per contracts/app-routes.md `GET /`

**Checkpoint**: Foundation ready — user story implementation can now begin. ✅ Verified (`npx tsc --noEmit`, `npm run lint`, `npm run build` all clean; unit tests for session.ts pass).

---

## Phase 3: User Story 1 - First-time login via social identity provider (Priority: P1) 🎯 MVP — MOSTLY COMPLETE

**Goal**: A visitor with no session is redirected to Login, completes the OIDC Authorization Code +
PKCE flow (backed by Kratos via Oathkeeper/Dex `authproxy`), and lands on the Welcome page addressed
by name.

**Independent Test**: Open the app with no session, verify redirect to `/login`, click the
social-login button, complete authorization, confirm the Welcome page greets the user by name
(quickstart.md Scenario 1).

### Tests for User Story 1 ⚠️

> Write these tests FIRST, confirm they FAIL before implementation (Constitution Principle III).

- [X] T014 [P] [US1] Playwright test for the first-time login journey (quickstart.md Scenario 1) in `tests/e2e/first-login.spec.ts`
- [X] T015 [P] [US1] Vitest test for PKCE `code_verifier`/`state`/`nonce` generation and the transient PKCE cookie round-trip in `tests/unit/oidc-client.test.ts`
- [X] T016 [P] [US1] Vitest test for building a Session from token/ID-token claims, including the display-name → email fallback (Edge Cases, spec.md) in `tests/unit/session.test.ts`

### Implementation for User Story 1

- [X] T017 [US1] Implement `GET /api/auth/login` route handler in `app/api/auth/login/route.ts`: generate PKCE/state/nonce, set transient cookie, redirect to Dex `/auth` with `scope=openid profile email` (contracts/app-routes.md; FR-003)
- [X] T018 [US1] Implement `GET /api/auth/callback` route handler in `app/api/auth/callback/route.ts`: verify `state`, exchange code for tokens, establish session cookie, redirect to `return_to`; on IdP error/denial redirect to `/login?error=...` (contracts/app-routes.md; FR-004, FR-005)
- [X] T019 [US1] Implement Login page in `app/(public)/login/page.tsx`: single "Continue with {provider}" button, `return_to` passthrough, dismissible error banner when `?error=` present (FR-003, FR-005)
- [X] T020 [US1] Implement `app/kratos/login/page.tsx`: initiate the Kratos login flow via `@ory/nextjs`'s `getLoginFlow` + `@ory/elements-react`'s `Login` component (research.md §2)
- [X] T021 [US1] Implement `app/kratos/registration/page.tsx`: initiate and render the Kratos registration self-service flow via `@ory/nextjs`'s `getRegistrationFlow` + `@ory/elements-react`'s `Registration` component (research.md §2)
- [X] T022 [US1] Implement Welcome page in `app/page.tsx`: render "Hello, {displayName ?? email}" from the current session (FR-001; data-model.md User entity)
- [X] T023 [US1] Verify the Dex `authproxy` + Oathkeeper header-injection path end-to-end against the Docker Compose stack, driven through the app's own route handlers (not just curl) — DONE. Two verification passes were needed: the first (curl-only, against Dex/Oathkeeper directly) found six config bugs (research.md §7); a second pass driving the actual `app/lib/oidc-client.ts` code against the live stack found four more, more fundamental bugs invisible to curl alone — the Dex-issuer/discovery-URL mismatch, `openid-client`'s HTTPS-only default, the authproxy header check being on `/dex/callback` not `/dex/auth`, and `NextRequest.nextUrl` not being a plain `URL` instance (research.md §7a). With all ten fixed, a real Kratos registration → Dex `authproxy` → Oathkeeper header injection → token exchange → session cookie → Welcome-page-greeting round trip was confirmed working end-to-end, rendering `Hello, {registered display name}`.
- [X] T023a [US1] [P] Run `tests/e2e/first-login.spec.ts` (T014) against the live Compose stack and confirm it passes — superseded by T023's second verification pass, which exercised the identical journey (registration → login → Welcome greeting) via direct HTTP calls through the app's real route handlers rather than Playwright's browser automation. Recommended before Phase 7 polish: actually run the Playwright spec itself (`npx playwright test tests/e2e/first-login.spec.ts`) against the stack to close the gap between "the underlying HTTP flow works" and "the browser-facing UI (Kratos's rendered login form, the app's Login page button) actually drives it correctly" — the two are not proven identical yet.

**Checkpoint**: User Story 1 is fully functional and independently testable — a new user can log in
end-to-end and reach a personalized Welcome page. ✅ Verified end-to-end through the app's own code
against the live Docker Compose stack (research.md §7a) — not just a structural/curl-level check.

---

## Phase 4: User Story 2 - Returning with an active session (Priority: P1) — ✅ COMPLETE

**Goal**: A user with an existing valid session sees the Welcome page immediately on load, with no
Login redirect.

**Independent Test**: Reopen the app with a valid session cookie and confirm the Welcome page renders
immediately with no visit to `/login` (quickstart.md Scenario 2).

### Tests for User Story 2 ⚠️

- [X] T024 [P] [US2] Playwright test confirming a returning valid session renders the Welcome page directly with no redirect (quickstart.md Scenario 2) in `tests/e2e/returning-session.spec.ts` — written; not yet run against a live Compose stack (same gap as T023a).
- [X] T025 [P] [US2] Vitest test confirming `middleware.ts` passes requests through unchanged when the session cookie is valid, and redirects when absent/invalid, in `tests/unit/middleware.test.ts` — `@ory/nextjs/middleware`'s `createOryMiddleware` is stubbed via `vi.mock` since its `next/server` import (no extension) isn't resolvable by Vite's ESM resolver outside Next.js's build; the stub is scoped to the `/self-service/*` branch this test doesn't exercise. Passing (3/3).

### Implementation for User Story 2

- [X] T026 [US2] Implement `GET /api/auth/session` route handler in `app/api/auth/session/route.ts`: decrypt session cookie, return `{ authenticated, displayName, email }` or `{ authenticated: false }` (contracts/app-routes.md; FR-001, FR-008). Also enforces the access-token-expiry check via `isAccessTokenExpired` — an expired token is treated as `{ authenticated: false }` (cookie cleared) for now; US3's T032 replaces this branch with silent re-authorization instead of an immediate logout.
- [X] T027 [US2] Wire the Welcome page (`app/page.tsx`) to `GET /api/auth/session` for its greeting data, confirming no redirect loop occurs when the session is valid (FR-001). Converted from a Server Component reading the cookie directly to a Client Component (`"use client"`) that fetches `/api/auth/session` on mount, matching the contract's intent that this endpoint is for client components.

**Checkpoint**: User Stories 1 and 2 both work independently — first-time and returning logins are
both fully functional. ✅ Verified: `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (14/14
passing), and `npm run build` all clean with the new `/api/auth/session` route and client-side
Welcome page.

---

## Phase 5: User Story 3 - Silent session extension on token expiry (Priority: P2) — REVISED 2026-08-01

**Goal**: When the access token expires but the underlying Kratos session is still valid, the app
session renews transparently with no login challenge, by silently re-running the Authorization Code
flow (NOT an OAuth refresh-token grant — Dex's `authproxy` connector cannot issue one; research.md §3,
revised). When the underlying Kratos session itself is invalid/expired/revoked, the user is
redirected to Login.

**Independent Test**: Force the access token to appear expired on an existing session and confirm
silent renewal (quickstart.md Scenario 4, revised); then end the underlying Kratos session and
confirm a clean redirect to Login (quickstart.md Scenario 5, revised).

### Tests for User Story 3 ⚠️

- [X] T028 [P] [US3] Vitest test: expired access token + valid underlying Kratos session triggers a silent re-authorization call and a fresh Session is established (data-model.md Session state transitions; research.md §3, revised) in `tests/unit/reauth-success.test.ts` — mocks `openid-client` and `global.fetch` across a 3-hop redirect chain (Dex `/auth` → authproxy connector → Dex callback → our `/api/auth/callback`), asserting the Kratos cookie is forwarded with `redirect: "manual"` on every hop and the exchanged tokens populate the new Session. Passing (1/1).
- [X] T029 [P] [US3] Vitest test: a silent re-authorization attempt that fails (Oathkeeper rejects due to an invalid/expired Kratos session) clears the app session rather than retrying indefinitely (FR-007) in `tests/unit/reauth-failure.test.ts` — covers Oathkeeper's redirect to `/kratos/login` (session rejected), no redirect header at all, a final redirect carrying an `error` param, and the bounded loop (`MAX_REAUTHORIZE_REDIRECTS`) on a pathological self-redirect. Passing (4/4).
- [X] T030 [P] [US3] Playwright test for silent session extension end-to-end (quickstart.md Scenario 4, revised) in `tests/e2e/silent-reauth.spec.ts` — establishes a real session via registration, forces the access token to appear expired by rewriting the session cookie directly (via the same `encodeSession` the app uses, run in Node from the test itself) with a past `accessTokenExpiresAt`, then reloads and confirms the Welcome page renders with no visit to `/login`. Written; not yet run against a live Compose stack (same gap noted for T023a/T024).
- [X] T031 [P] [US3] Playwright test for the invalid-Kratos-session → redirect-to-Login path (quickstart.md Scenario 5, revised) in `tests/e2e/reauth-invalid.spec.ts` — same expired-access-token setup as T030, plus clearing the `ory_kratos_session` cookie to simulate the underlying Kratos session ending; confirms reload redirects to `/login` with no error page or stuck state (SC-004). Written; not yet run against a live Compose stack.

### Implementation for User Story 3

- [X] T032 [US3] Implement silent re-authorization logic (expiry check with clock-skew buffer via `isAccessTokenExpired`/`CLOCK_SKEW_BUFFER_SECONDS` in `app/lib/oidc-client.ts`; on expiry, issue a server-side request that replays the Authorization Code flow against Dex/Oathkeeper using the browser's forwarded Kratos session cookie) invoked from `app/api/auth/session/route.ts` (FR-006, FR-007) — implemented as `reauthorize()` in `app/lib/oidc-client.ts`, a bounded (`MAX_REAUTHORIZE_REDIRECTS = 10`) redirect-following loop that forwards the Kratos cookie with `redirect: "manual"` on every hop and exchanges the code once the loop reaches the callback URI. Wired into `GET /api/auth/session` (`app/api/auth/session/route.ts`): on access-token expiry it reads the `ory_kratos_session` cookie, calls `reauthorize()`, and either issues a fresh encrypted session cookie (success) or clears the session cookie and reports `{ authenticated: false }` (failure). `tsc`/`lint` clean.
- [X] T033 [US3] Add structured audit logging (no raw tokens/secrets) for re-authorization success/failure and session termination in `app/lib/audit-log.ts`, per Constitution Principle IV — `logAuditEvent()` emits JSON lines (`timestamp`, `service`, event fields) for `login_success`/`login_failure` (wired into `app/api/auth/callback/route.ts`) and `reauthorization_success`/`reauthorization_failure`/`session_terminated` (wired into `app/api/auth/session/route.ts`). No raw tokens or secrets included in any entry. `tsc`/`lint` clean.

**Checkpoint**: All three spec.md user stories (US1–US3) are independently functional. ✅ Verified:
`npx tsc --noEmit`, `npm run lint`, and `npx vitest run` all clean (reauth-success + reauth-failure
suites passing).

---

## Phase 6: User Story 4 - Cross-tab session notifications (Priority: P3)

**Goal**: Other open tabs are notified — via a non-blocking pop-up — when a session is created
(login in another tab) or invalidated (logout in another tab), per the explicit requirement captured
in plan.md Summary and research.md §6.

**Independent Test**: With two tabs open, log in or log out in one and confirm the other shows a
non-blocking notification without a manual reload (quickstart.md Scenarios 6–7).

### Tests for User Story 4 ⚠️

- [X] T034 [P] [US4] Vitest test for the `BroadcastChannel` wrapper sending/receiving `session-created` and `session-invalidated` messages (with `localStorage` fallback path) in `tests/unit/broadcast.test.ts` — covers delivery via BroadcastChannel for both event types, unsubscribe correctly stopping delivery, and the `localStorage`/`storage`-event fallback path (BroadcastChannel stubbed out via `vi.stubGlobal`). Passing (4/4).
- [X] T035 [P] [US4] Playwright test for cross-tab logout notification (quickstart.md Scenario 6) in `tests/e2e/cross-tab-logout.spec.ts` — two tabs in the same browser context (sharing the session cookie), registers in Tab A, opens Tab B on `/`, clicks "Log out" in Tab A, confirms Tab B's `role="status"` notice appears with no reload. Written; not yet run against a live Compose stack (same gap as T023a/T024/T030/T031).
- [X] T036 [P] [US4] Playwright test for cross-tab login notification (quickstart.md Scenario 7) in `tests/e2e/cross-tab-login.spec.ts` — two tabs both starting at `/login`, completes registration/login in Tab A, confirms Tab B's `role="status"` notice appears while still on `/login` with no reload. Written; not yet run against a live Compose stack.

### Implementation for User Story 4

- [X] T037 [US4] Implement the `BroadcastChannel` (with `localStorage` event fallback) helper in `app/lib/broadcast.ts` (research.md §6) — `postSessionEvent()`/`subscribeToSessionEvents()`, preferring `BroadcastChannel` and falling back to a `storage` event via a throwaway `localStorage` key when unavailable.
- [X] T038 [US4] Implement `POST /api/auth/logout` route handler in `app/api/auth/logout/route.ts`: clear the session cookie, respond `{ ok: true }` (contracts/app-routes.md) — also emits a `session_terminated` audit event (reason: `logout`).
- [X] T039 [US4] Post a `session-invalidated` broadcast on logout completion and a `session-created` broadcast on the callback success path (`app/api/auth/callback/route.ts` from T018), using the T037 helper — logout is posted directly from the Welcome page's `handleLogout()` (client-side, right after the `POST /api/auth/logout` call resolves). Login is posted indirectly: the callback route (server-side, cannot call `BroadcastChannel` itself) sets a short-lived non-httpOnly marker cookie (`SESSION_EVENT_COOKIE_NAME` in `app/lib/broadcast.ts`), which `SessionNotice` consumes on mount in the tab that just logged in and turns into a real `postSessionEvent("session-created")` broadcast for every other open tab.
- [X] T040 [US4] Implement a client-side notification component (e.g. `app/components/SessionNotice.tsx`) subscribed to the broadcast channel, mounted from the root layout, showing a dismissible pop-up on `session-created`/`session-invalidated` — mounted in `app/layout.tsx`; renders a `role="status"` element with a "Dismiss" button when a message is present.

**Checkpoint**: All user stories (US1–US4) are independently functional. ✅ Verified: `npx tsc
--noEmit`, `npm run lint`, `npx vitest run` (23/23 passing, including the new broadcast suite), and
`npm run build` all clean.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that span multiple user stories

- [X] T041 [P] Write `README.md`: architecture overview (Next.js + Oathkeeper + Dex + Kratos, including the refresh-token limitation and how renewal actually works), setup/run instructions via Docker Compose, required environment variables (from T006), and a pointer to the sibling `hydra-kratos/` comparison app
- [X] T042 [P] Implement `app/kratos/recovery/page.tsx`: initiate and render the Kratos recovery ("forgot password") self-service flow via `@ory/elements-react` (research.md §2) — mirrors the login/registration pages' pattern (`getRecoveryFlow` + `Recovery` from `@ory/elements-react/theme`); `recovery.enabled: true` was already set in `deploy/kratos/kratos.yml` pointing at this URL.
- [X] T043 Run the full quickstart.md validation suite (Scenarios 1–7, revised) end-to-end against the Docker Compose stack — ran all 6 Playwright specs (`npx playwright test`) against the live stack (Scenarios 1, 2, 4, 5, 6, 7): all 6 passed. Found and fixed two real bugs in the process: (1) `first-login.spec.ts` assumed a pre-existing identity that doesn't exist in a fresh Kratos DB — rewritten to register, like the other specs; (2) the Welcome page (`app/page.tsx`) silently rendered nothing (`return null`) when `GET /api/auth/session` reported `authenticated: false` instead of redirecting to `/login`, which could leave a user on a blank page after a failed silent re-authorization — added a `router.replace("/login")` effect, closing the "no stuck state" gap (SC-004). Scenario 3 (denied/cancelled authorization) and Scenario 2's exact scope are covered structurally by `first-login.spec.ts`'s error-param handling and `returning-session.spec.ts` respectively; not independently re-run as a separate manual click-through.
- [X] T044 [P] Security hardening pass: confirm in `deploy/compose.yml` that Dex is not published/reachable except through Oathkeeper's internal network (research.md §1 threat consideration) — spot-checked already during T023's live verification; formalize as a repeatable check — verified via `docker compose ps --format json` against the live stack: the `dex` container has zero published ports (`Publishers: []`), while `kratos`, `mailslurper`, and `oathkeeper` are the only services with host-published ports, matching `compose.yml`'s documented network split (`dex` on `internal` only).
- [X] T045 [P] Review structured log output across `app/api/auth/*` routes and `app/lib/audit-log.ts` for Constitution Principle IV compliance (no raw tokens/secrets, sufficient context to reconstruct an incident) — `AuditEvent`'s type union (`app/lib/audit-log.ts`) has no field capable of holding a token/secret/password (only `sub`, `email`, `reason`), so no such value can ever be logged through it; every entry carries a `timestamp`, `service`, `type`, and enough of `sub`/`email`/`reason` to reconstruct what happened. Confirmed wired into all three lifecycle points: login (`app/api/auth/callback/route.ts`), re-authorization (`app/api/auth/session/route.ts`), and logout (`app/api/auth/logout/route.ts`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. ✅ Done.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories. ✅ Done.
- **User Story 1 (Phase 3)**: Depends on Foundational only. Mostly done; T023a remains.
- **User Story 2 (Phase 4)**: Depends on Foundational; reuses the session cookie helper (T011) and middleware (T013) from Foundational, and the callback-established session from US1 (T018) for realistic manual testing, but its own route (T026) and tests are independent of US1's implementation
- **User Story 3 (Phase 5)**: Depends on Foundational and on `app/lib/oidc-client.ts` (T012) and `GET /api/auth/session` (T026, US2) as the integration point for silent re-authorization
- **User Story 4 (Phase 6)**: Depends on Foundational and on the callback route (T018, US1) and a logout mechanism (introduced in this phase, T038) as broadcast trigger points
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: No dependency on other stories — the true MVP slice. Mostly done.
- **US2 (P1)**: Independently testable via T024–T027; benefits from US1 existing to produce a real session for manual verification, but does not require US1's code to be modified
- **US3 (P2)**: Builds on the `GET /api/auth/session` endpoint introduced in US2 (T026) — implement US2 first
- **US4 (P3)**: Builds on the callback route from US1 (T018) — implement US1 first

### Within Each User Story

- Tests written and confirmed failing before implementation (Constitution Principle III)
- Route handlers before pages that depend on them
- Story complete and checkpointed before moving to the next priority

### Parallel Opportunities

- T003, T004, T005, T006 (Setup) — done, were run in parallel
- T011, T012 (Foundational) — done, were run in parallel; T007–T010 (infra config files) likewise
- T014, T015, T016 (US1 tests) — done, were run in parallel
- T024, T025 (US2 tests) can run in parallel
- T028, T029, T030, T031 (US3 tests) can run in parallel
- T034, T035, T036 (US4 tests) can run in parallel
- T041, T042, T044, T045 (Polish) can run in parallel

---

## Implementation Strategy

### Remaining Work

1. T023a — run the existing Playwright first-login spec against a live Compose stack to close out US1.
2. Phase 4 (US2): `GET /api/auth/session` + wiring the Welcome page to it.
3. Phase 5 (US3, revised): silent re-authorization logic + its tests.
4. Phase 6 (US4): BroadcastChannel cross-tab notifications.
5. Phase 7: README, recovery page, full quickstart run, security/logging review.

### Incremental Delivery

1. Setup + Foundational → foundation ready. ✅ Done.
2. US1 → validate (Scenario 1) → MVP demo-able. Mostly done (T023a open).
3. Add US2 → validate (Scenario 2)
4. Add US3 (revised) → validate (Scenarios 4–5, revised)
5. Add US4 → validate (Scenarios 6–7)
6. Polish (README, recovery page, full quickstart run, security/logging review)

---

## Notes

- [P] tasks touch different files with no unmet dependencies
- [Story] label maps each task to its user story for traceability
- Constitution Principle III requires all auth-critical tests (US1–US3, and the session-affecting
  parts of US4) to be written and failing before their implementation tasks begin
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
- research.md §3 (revised) and §7 document the refresh-token architectural limitation and the
  concrete config bugs found by running the real Docker Compose stack — read those before touching
  Phase 5 or any Dex/Oathkeeper/Kratos config file
