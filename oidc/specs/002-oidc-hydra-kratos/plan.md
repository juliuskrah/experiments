# Implementation Plan: Authentication with OIDC via Hydra + Kratos

**Branch**: `002-oidc-hydra-kratos` | **Date**: 2026-08-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-oidc-hydra-kratos/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

**Relationship to Approach A**: This plan is the counterpart to `001-oidc-dex-oathkeeper`'s plan.
That approach (Dex + Oathkeeper + Kratos) discovered via hands-on testing that Dex's `authproxy`
connector cannot issue OAuth2 refresh tokens, so its session renewal is a silent re-authorization
against the Kratos session rather than a standards-compliant `refresh_token` grant. This plan
exists to build the same user-facing behavior with an OIDC provider that supports refresh tokens
natively, so the two can be run side by side and compared on that dimension (and on the "identity
decoupled from both the OIDC provider and the resource server" goal both approaches share).

## Summary

A Next.js (TypeScript) app shows a Welcome page to authenticated users and a Login page (single
social-login button) to everyone else. Login triggers an OIDC Authorization Code + PKCE flow
against **Ory Hydra**. Hydra has no built-in user store by design, so it delegates every login and
consent decision to this same Next.js app via Hydra's Admin API (`GET/PUT
/admin/oauth2/auth/requests/login`, `GET/PUT /admin/oauth2/auth/requests/consent`) — the bridge
Route Handlers check the browser's Kratos session (`GET /sessions/whoami`, cookie forwarded
directly, no proxy needed) and tell Hydra who the user is. Kratos remains the sole identity/session
source of truth; Hydra "extends" it with OIDC capability without ever storing identity itself.
Sessions are extended via a standards-compliant OAuth2 refresh-token grant (`offline_access` scope,
native to Hydra's underlying `ory/fosite` framework, auto-rotated on every use), stored in an
encrypted HttpOnly cookie and refreshed lazily on the next authenticated request — no login
challenge is shown unless the refresh token itself is invalid, or the underlying Kratos session has
independently ended (contracts/app-routes.md). A `BroadcastChannel`-based mechanism notifies other
open tabs when a session is created or invalidated (identical to Approach A). The whole stack
(Next.js, Hydra, Kratos, two Postgres instances, mail catcher) runs via Docker Compose, entirely
under `hydra-kratos/` in the repository (a monorepo containing this app and its
`dex-oathkeeper-kratos/` comparison counterpart).

## Technical Context

**Language/Version**: TypeScript (Next.js App Router, current LTS Node.js)

**Primary Dependencies**: Next.js (React), `openid-client` (Authorization Code + PKCE + refresh
grant against Hydra), `jose` (encrypted session cookie), `@ory/elements-react` + `@ory/nextjs`
(render Kratos self-service flows — reused unchanged from Approach A), `@ory/client-fetch` (typed
Kratos Public API client), `@ory/hydra-client-fetch` (typed Hydra Admin/Public API client for the
login/consent bridge — fetch-based, matching `@ory/client-fetch`'s style already used for Kratos)

**Storage**: No app-owned database. Session state lives in an encrypted HttpOnly browser cookie;
Kratos owns its identity store (Postgres); Hydra owns its client/consent-session/refresh-token store
(its own separate Postgres instance, per Hydra's own quickstart pattern)

**Testing**: Vitest + React Testing Library (unit/component: cookie encode/decode, refresh-decision
logic, login/consent bridge logic against mocked Hydra Admin API responses, form rendering);
Playwright (end-to-end: full login/refresh/cross-tab scenarios against the Docker Compose stack)

**Target Platform**: Web browser (server-rendered/Node runtime for Next.js server; Docker Compose
for local/deployment topology)

**Project Type**: Web application (single Next.js app + two supporting identity/authorization
services — no Oathkeeper; research.md §4)

**Performance Goals**: Matches SC-001 (new-user login-to-Welcome under 30s including the
login/consent bridge round-trip); no other domain-specific throughput targets — this is a
low-traffic auth flow, not a high-QPS service

**Constraints**: No login challenge on token refresh as long as the refresh token is valid AND the
underlying Kratos session remains valid (FR-006/FR-007; contracts/app-routes.md's note on the
Kratos-session-ended edge case); never render authenticated content without a verified session
(FR-008); refresh tokens rotate on every use and must be persisted atomically (research.md §3);
Hydra's Admin API must never be reachable from the public internet or the browser (Constitution
Principle I; data-model.md's Identity Provider Connection entity)

**Scale/Scope**: Single Next.js app, 3 page types (Welcome, Login, Kratos-flow pages) + 2 Hydra
bridge routes + 4 Route Handlers; demo/small-team scale, single instance (no horizontal-scaling
requirement identified)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Security-First Identity Design | PASS. Authorization Code + PKCE (spec-conformant, no custom OIDC variant). No secrets logged (research.md documents cookie/refresh-token handling; env-sourced client secret). Threat consideration: Hydra's Admin API (used only by the server-side login/consent bridge) MUST NOT be network-reachable from the browser or public internet — documented in data-model.md's Identity Provider Connection entity and enforced in deploy/compose.yml's network topology (Polish task, analogous to Approach A's Dex-not-reachable-except-via-Oathkeeper constraint). Scopes limited to `openid profile email offline_access` — least privilege, and unlike Approach A, `offline_access` is not vestigial here since Hydra actually honors it. |
| II. Spec & Contract-First Integration | PASS. `contracts/app-routes.md` documents every Route Handler's and Hydra-bridge-route's request/response contract, including error semantics, before implementation. Hydra Admin API↔Next.js bridge↔Kratos Public API contract documented in research.md §2 with the exact Admin API calls the bridge makes. |
| III. Test-First for Auth Logic | GATE CARRIED FORWARD to `/speckit-tasks`. All auth-critical logic (PKCE flow, callback handling, login/consent bridge logic, refresh-token rotation/storage, session validation, the Kratos-session-ended re-check) MUST have tests written first per TDD; this plan's Testing section names the frameworks, but task ordering enforcing red-green-refactor is a `/speckit-tasks` responsibility. |
| IV. Observability & Auditability | PASS (design-level). data-model.md's Session entity includes `createdAt` for audit purposes; contracts note refresh/failure outcomes and login-bridge decisions that MUST be logged (structured, no raw tokens) per constitution — concrete log fields to be finalized during implementation, not a gate blocker. |
| V. Simplicity & Minimal Trust Surface | PASS. Hydra chosen specifically because it needs no custom connector code to satisfy this feature's decoupled-identity requirement (research.md §1) — the login/consent bridge is Route Handlers wrapping two already-documented HTTP APIs, not new security-critical logic beyond the same "is this Kratos session valid" check Approach A's Oathkeeper made. Oathkeeper is dropped entirely (research.md §4) since nothing in this architecture needs a header-injecting proxy — removing a whole service is itself a simplification relative to Approach A. No new persistent store introduced for sessions (stateless encrypted cookie) beyond Kratos/Hydra's own documented quickstart shapes. BroadcastChannel reused unchanged from Approach A (research.md §7). |

No unjustified violations. Complexity Tracking section not needed.

## Project Structure

### Documentation (this feature)

```text
specs/002-oidc-hydra-kratos/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── app-routes.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root: `hydra-kratos/` — one of two sibling apps in this monorepo)

```text
hydra-kratos/
├── app/                        # Next.js App Router source
│   ├── (public)/
│   │   └── login/
│   │       └── page.tsx        # Login page (single social-login button)
│   ├── kratos/
│   │   ├── login/page.tsx      # Renders Kratos login flow via @ory/elements-react (reused from Approach A design)
│   │   ├── registration/page.tsx
│   │   └── recovery/page.tsx   # "Forgot password" flow
│   ├── hydra/
│   │   ├── login/route.ts      # Hydra urls.login target — Admin API login-request bridge
│   │   └── consent/route.ts    # Hydra urls.consent target — Admin API consent-request bridge
│   ├── page.tsx                 # Welcome page (protected)
│   ├── api/
│   │   └── auth/
│   │       ├── login/route.ts    # Begins Authorization Code + PKCE flow against Hydra
│   │       ├── callback/route.ts # Handles Hydra callback, establishes session (incl. refresh_token)
│   │       ├── logout/route.ts   # Clears session, cross-tab notify
│   │       └── session/route.ts  # Session status + refresh-token grant + Kratos-session re-check
│   └── lib/
│       ├── session.ts           # Encrypted cookie encode/decode (jose)
│       ├── oidc-client.ts       # openid-client config against Hydra (incl. refresh grant)
│       ├── hydra-admin.ts       # Hydra Admin API client wrapper for the login/consent bridge
│       └── broadcast.ts         # BroadcastChannel cross-tab login/logout notifications (reused from Approach A)
├── middleware.ts                # Optimistic auth gate → redirect to /login (Next.js root convention)
│
├── tests/
│   ├── unit/                    # Vitest: session cookie, refresh-decision logic, bridge logic, form rendering
│   └── e2e/                     # Playwright: quickstart.md scenarios against Docker Compose
│
├── deploy/
│   ├── compose.yml
│   ├── hydra/
│   │   └── config.yaml          # urls.login/urls.consent, ttl.refresh_token, secrets
│   └── kratos/
│       ├── kratos.yml           # reused essentially unchanged from Approach A
│       ├── identity.schema.json
│       └── mailslurper (via compose service, no extra files)
│
└── README.md
```

**Structure Decision**: Single Next.js application (Option: Web application, simplified to one
frontend project — the login/consent bridge lives inside this same app's Route Handlers rather than
as a separate service, per research.md §2's finding that nothing in Hydra's model requires a
standalone bridge), living entirely under `hydra-kratos/` at the monorepo root (sibling to the
`dex-oathkeeper-kratos/` comparison app). `app/` holds all Next.js source under the App Router
convention; `middleware.ts` sits at this app's own root per Next.js's file convention; `deploy/`
holds the Docker Compose stack and per-service configuration for Hydra and Kratos (no Oathkeeper);
`tests/` splits unit (Vitest) from end-to-end (Playwright) per research.md §6.

## Complexity Tracking

*No Constitution Check violations — table intentionally omitted.*
