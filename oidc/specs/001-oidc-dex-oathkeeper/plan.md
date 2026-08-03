# Implementation Plan: Authentication with OIDC via Dex + Oathkeeper + Kratos

**Branch**: `001-oidc-dex-oathkeeper` | **Date**: 2026-07-31 | **Revised**: 2026-08-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-oidc-dex-oathkeeper/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

**Revision note (2026-08-01)**: This plan is a revision of an in-progress feature, not a fresh
start. Setup, Foundational, and most of User Story 1 are already implemented under
`dex-oathkeeper-kratos/` and verified working end-to-end against a live Docker Compose stack. That
verification also surfaced and fixed several implementation bugs not caught by design review alone
(see research.md §7) and, more importantly, surfaced an architectural limitation that changes this
plan's session-renewal design (see research.md §3, revised). This plan — and the sibling app in
`hydra-kratos/` (spec `002-oidc-hydra-kratos`) — exist side by side specifically to compare that
limitation against an architecture that doesn't have it.

## Summary

A Next.js (TypeScript) app shows a Welcome page to authenticated users and a Login page (single
social-login button) to everyone else. Login triggers an OIDC Authorization Code + PKCE flow against
Dex. Because Dex v2 has no built-in user management, Dex is fronted by **Ory Oathkeeper**, which
authenticates the browser's Kratos session and hands Dex's `authproxy` connector pre-verified
identity headers — Kratos remains the actual user-management backend. Since Kratos ships headless,
its login/registration/recovery self-service flows are rendered as Next.js pages (via
`@ory/elements-react` + `@ory/nextjs`) so no native Dex or Kratos UI is ever shown to the user.

**Revised session-renewal design**: Dex's `authproxy` connector does not implement Dex's
`RefreshConnector` interface (validated by reading `dexidp/dex` v2.44.0 source and confirmed by live
testing — Dex never returns a `refresh_token` for this connector, regardless of requested scope).
Sessions are therefore extended not via an OAuth refresh grant, but by silently re-running the
Authorization Code + PKCE flow on access-token expiry; this round-trips with no visible login prompt
as long as the browser's Kratos session (which Oathkeeper re-validates on every pass through
`authproxy`) is still valid. This is the central trade-off under comparison against the sibling
Hydra+Kratos app (spec `002-oidc-hydra-kratos`), which achieves the originally-intended
standards-compliant `refresh_token` grant instead. A `BroadcastChannel`-based mechanism notifies
other open tabs when a session is created or invalidated. The whole stack (Next.js, Oathkeeper, Dex,
Kratos, Postgres, mail catcher) runs via Docker Compose, entirely under `dex-oathkeeper-kratos/` in
the repository (a monorepo containing this app and its `hydra-kratos/` comparison counterpart).

## Technical Context

**Language/Version**: TypeScript (Next.js App Router, current LTS Node.js)

**Primary Dependencies**: Next.js (React), `openid-client` (Authorization Code + PKCE against Dex;
no refresh grant — see Revised session-renewal design above), `jose` (encrypted session cookie),
`@ory/elements-react` + `@ory/nextjs` (render Kratos self-service flows), `@ory/client-fetch` (typed
Kratos Public API client, fallback if `@ory/nextjs` RC proves unstable)

**Storage**: No app-owned database. Session state lives in an encrypted HttpOnly browser cookie;
Kratos owns its identity store (Postgres); Dex owns its client/auth-request store (SQLite file — no
refresh-token store, since Dex never issues one for the `authproxy` connector)

**Testing**: Vitest + React Testing Library (unit/component: cookie encode/decode, refresh-decision
logic, form rendering); Playwright (end-to-end: full login/refresh/cross-tab scenarios against the
Docker Compose stack)

**Target Platform**: Web browser (server-rendered/Node runtime for Next.js server; Docker Compose for
local/deployment topology)

**Project Type**: Web application (single Next.js app + three supporting identity services)

**Performance Goals**: Matches SC-001 (new-user login-to-Welcome under 30s including IdP
authorization); no other domain-specific throughput targets — this is a low-traffic auth flow, not a
high-QPS service

**Constraints**: No login challenge on session renewal as long as the underlying Kratos session is
valid (FR-006); never render authenticated content without a verified session (FR-008); renewal is a
silent re-run of the Authorization Code flow, not an OAuth refresh grant (research.md §3, revised —
Dex `authproxy` cannot issue refresh tokens); Dex must not be reachable except through Oathkeeper
(research.md §1 threat consideration)

**Scale/Scope**: Single Next.js app, 3 pages types (Welcome, Login, Kratos-flow pages) + 4 Route
Handlers; demo/small-team scale, single instance (no horizontal-scaling requirement identified)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Security-First Identity Design | PASS. Authorization Code + PKCE (spec-conformant, no custom OIDC variant). No secrets logged (research.md documents cookie/session handling; env-sourced client secret). Threat consideration recorded in research.md §1 (forged `X-Remote-*` headers) with a concrete mitigation (Dex not network-reachable except via Oathkeeper). Scopes limited to `openid profile email` — `offline_access` dropped since Dex's `authproxy` connector never honors it (research.md §3, revised); least privilege for this feature's actual capabilities. |
| II. Spec & Contract-First Integration | PASS. `contracts/app-routes.md` documents every Route Handler's request/response contract, including error semantics, before implementation. Dex↔Oathkeeper↔Kratos header contract documented in research.md §1 with the exact headers `authproxy` expects. |
| III. Test-First for Auth Logic | GATE CARRIED FORWARD to `/speckit-tasks`. All auth-critical logic (PKCE flow, callback handling, refresh-token rotation/storage, session validation) MUST have tests written first per TDD; this plan's Testing section names the frameworks, but task ordering enforcing red-green-refactor is a `/speckit-tasks` responsibility, not this plan's. |
| IV. Observability & Auditability | PASS (design-level). data-model.md's Session entity includes `createdAt` for audit purposes; contracts note refresh/failure outcomes that MUST be logged (structured, no raw tokens) per constitution — concrete log fields to be finalized during implementation, not a gate blocker. |
| V. Simplicity & Minimal Trust Surface | PASS. Oathkeeper chosen over writing a custom Dex connector specifically to avoid new security-critical code (research.md §1). No new persistent store introduced for sessions (stateless encrypted cookie) or for Kratos/Dex beyond their own documented quickstart shapes (research.md §4). BroadcastChannel chosen over a new push-infrastructure dependency (research.md §6). |

No unjustified violations. Complexity Tracking section not needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-oidc-dex-oathkeeper/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── app-routes.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root: `dex-oathkeeper-kratos/` — one of two sibling apps in this monorepo)

```text
dex-oathkeeper-kratos/
├── app/                       # Next.js App Router source
│   ├── (public)/
│   │   └── login/
│   │       └── page.tsx       # Login page (single social-login button)
│   ├── kratos/
│   │   ├── login/page.tsx     # Renders Kratos login flow via @ory/elements-react
│   │   ├── registration/page.tsx
│   │   └── recovery/page.tsx  # "Forgot password" flow
│   ├── page.tsx                # Welcome page (protected)
│   ├── api/
│   │   └── auth/
│   │       ├── login/route.ts    # Begins Authorization Code + PKCE flow
│   │       ├── callback/route.ts # Handles Dex callback, establishes session
│   │       ├── logout/route.ts   # Clears session, cross-tab notify
│   │       └── session/route.ts  # Session status + silent re-authorization check
│   └── lib/
│       ├── session.ts         # Encrypted cookie encode/decode (jose)
│       ├── oidc-client.ts     # openid-client config against Dex
│       └── broadcast.ts       # BroadcastChannel cross-tab login/logout notifications
├── middleware.ts               # Optimistic auth gate → redirect to /login (Next.js root convention)
│
├── tests/
│   ├── unit/                   # Vitest: session cookie, renewal-decision logic, form rendering
│   └── e2e/                    # Playwright: quickstart.md scenarios against Docker Compose
│
├── deploy/
│   ├── compose.yml
│   ├── dex/
│   │   └── config.yaml         # authproxy connector config
│   ├── oathkeeper/
│   │   ├── config.yaml
│   │   └── rules.json          # cookie_session authenticator + header mutator rule for Dex
│   └── kratos/
│       ├── kratos.yml
│       ├── identity.schema.json
│       └── mailslurper (via compose service, no extra files)
│
└── README.md
```

**Structure Decision**: Single Next.js application (Option: Web application, simplified to one
frontend project since there is no separate backend service owned by this repo — Dex/Kratos/Oathkeeper
are pre-built services configured, not built, here), living entirely under `dex-oathkeeper-kratos/`
at the monorepo root (sibling to the `hydra-kratos/` comparison app). `app/` holds all Next.js source
under the App Router convention; `middleware.ts` sits at this app's own root per Next.js's file
convention (not under `app/`); `deploy/` holds the Docker Compose stack and per-service configuration
for Dex, Oathkeeper, and Kratos; `tests/` splits unit (Vitest) from end-to-end (Playwright) per
research.md §5.

## Complexity Tracking

*No Constitution Check violations — table intentionally omitted.*
