# Research: Authentication with OIDC via Hydra + Kratos

**Feature**: `002-oidc-hydra-kratos` | **Date**: 2026-08-01

## 1. Choosing Ory Hydra as the OIDC/OAuth2 provider

**Decision**: Use **Ory Hydra** (v2.3.0) as the OAuth2/OIDC Authorization Server. Hydra has no
built-in user store by design — it delegates every login and consent decision to an external
"login and consent app" via its Admin API. That bridge is implemented as three Route Handlers in
this same Next.js app, backed entirely by Kratos.

**Rationale**: The sibling approach (`001-oidc-dex-oathkeeper`) used Dex, and hands-on testing found
that Dex's `authproxy` connector — the only connector shape suited to "delegate to an external
session check" — does not implement Dex's `connector.RefreshConnector` interface
(`connector/authproxy/authproxy.go`, `server/oauth2.go` in `dexidp/dex` v2.3.0/v2.44.0), so Dex never
issues a `refresh_token` for it regardless of scope. Hydra is built on **`ory/fosite`**, a general
OAuth2/OIDC framework where refresh-token issuance is intrinsic to the framework itself, not
connector-dependent: any client requesting the `offline_access` scope (fosite's
`RefreshTokenScopes` default, confirmed in `fosite/config_default.go`) receives a `refresh_token` on
the authorization_code exchange automatically, with automatic rotation on each use
(`oauth2.grant.refresh_token.rotation_grace_period`, `ttl.refresh_token` — confirmed in Hydra's
`spec/config.json`). This directly satisfies FR-006 as a standards-compliant grant, which is this
feature's whole reason for existing alongside Approach A.

**Alternatives considered**:
- *Dex with a different (non-`authproxy`) connector* — Dex's `oidc`/`google`/`github` connectors do
  implement `RefreshConnector`, but they authenticate against a *real upstream* IdP, not Kratos
  directly; using one would not decouple identity from the OIDC provider the way this feature
  requires (Kratos would no longer be Dex's actual authority).
- *Writing a custom Dex connector that both trusts Kratos sessions and implements `Refresh`* — adds
  new security-critical Go code to the highest-trust part of the system; rejected per Constitution
  Principle V, and Hydra already solves this with a well-documented, vetted delegation model.

## 2. Hydra's login/consent delegation flow

**Decision**: Implement the bridge as three Next.js Route Handlers under `app/hydra/`:
`login/route.ts`, `consent/route.ts`, and (implicitly) reuse `app/kratos/login/page.tsx` from a
shared identity layer for the actual credential UI.

**Flow** (confirmed against Hydra's Admin API and the `ory/hydra-login-consent-node` reference app):

1. Browser hits this app's `GET /api/auth/login`, which redirects to Hydra's public
   `GET /oauth2/auth` with the standard Authorization Code + PKCE parameters.
2. Hydra has no session for this browser yet, so it redirects to `urls.login`
   (`http://localhost:3000/hydra/login?login_challenge=...`).
3. `GET /hydra/login` calls Hydra's Admin API `GET /admin/oauth2/auth/requests/login?login_challenge=`.
   - If `skip: true` (Hydra already recognizes this browser from a prior `remember`), the bridge
     immediately calls `PUT /admin/oauth2/auth/requests/login/accept` with `{ subject }` and
     redirects to the returned `redirect_to`.
   - If `skip: false`, the bridge checks the browser's `ory_kratos_session` cookie against Kratos's
     public `GET /sessions/whoami` (forwarding the cookie itself — no Oathkeeper needed; see §4).
     - Kratos session valid → accept the Hydra login request with `subject = identity.id`,
       `remember: true`, `remember_for` bounded by Kratos's own session TTL (see §5).
     - Kratos session invalid/absent → redirect the browser to `/kratos/login` (rendered exactly as
       in the sibling approach, via `@ory/elements-react`) with a `return_to` back to this same
       `/hydra/login?login_challenge=...` URL, so the flow resumes once Kratos authenticates them.
4. Hydra redirects to `urls.consent` (`/hydra/consent?consent_challenge=...`).
5. `GET /api/hydra/consent` calls `GET /admin/oauth2/auth/requests/consent?consent_challenge=`, and
   — since this app is a fully first-party trusted client of Hydra with no third-party scope
   sharing — immediately calls `PUT /admin/oauth2/auth/requests/consent/accept` with
   `{ grant_scope: requested_scope, session: {} }` and `remember: true`, with no user-facing consent
   screen (per Hydra's own guidance that first-party clients may skip consent).
6. Hydra redirects to this app's `GET /api/auth/callback` with an authorization `code`, exactly like
   the sibling approach's callback contract.

**Rationale**: This is the officially documented Hydra pattern (`ory.com/docs/hydra/guides
/oauth2-refresh`, `ory.com/docs/hydra/self-hosted/quickstart`), reduces the "connector" problem Dex
had to three plain Route Handlers wrapping two documented HTTP APIs (Hydra Admin API, Kratos Public
API) — no custom security logic beyond "does this cookie represent a valid Kratos session," which is
the same trust decision Oathkeeper made in Approach A, just made in-process instead of by a separate
proxy.

**Alternatives considered**:
- *A separate login-consent microservice* — the reference `hydra-login-consent-node` app is a
  standalone Express service; rejected as unnecessary process/deployment overhead when Hydra only
  needs a URL for `urls.login`/`urls.consent`, which can point back into this same Next.js app
  (confirmed: nothing in Hydra's model requires the bridge to be a separate service).
- *Skipping the Kratos session check and letting Hydra manage its own login UI* — Hydra has no login
  UI by design; this would mean hand-rolling credential storage, which directly contradicts the
  "Kratos is the sole identity source of truth" requirement (FR-009).

## 3. OAuth2 Relying Party implementation in Next.js (Authorization Code + PKCE + refresh_token)

**Decision**: Use **`openid-client`** (panva) inside Next.js Route Handlers for the Authorization
Code + PKCE flow against Hydra's public endpoints, and for the refresh-token grant. Store the
resulting access token, refresh token, and ID token claims in an encrypted, `HttpOnly`, `Secure`,
`SameSite=Lax` cookie (JWE via `jose`), matching the session-cookie approach validated in Approach A.
Perform the refresh-token exchange lazily on the next authenticated request that finds the access
token expired (clock-skew buffer), inside a Node-runtime Route Handler, not Edge Middleware.

**Rationale**: Same reasoning as Approach A's research.md §3 (original decision) — `openid-client`
is OpenID-certified and designed for arbitrary spec-compliant issuers; a stateless encrypted cookie
avoids a new infrastructure dependency. The difference from Approach A is that this refresh grant
actually works: Hydra returns a `refresh_token` on the initial exchange because `offline_access` is
in fosite's default `RefreshTokenScopes`, and every subsequent refresh call rotates it
automatically (Hydra-side; the app just persists whatever new `refresh_token` comes back, exactly as
Approach A's original — now superseded — design intended for Dex).

**Alternatives considered**: Same as Approach A's research.md §3 (Auth.js v5, server-side session
store, Edge Middleware refresh) — rejected for the same reasons; none of those trade-offs changed by
switching the OIDC provider from Dex to Hydra.

## 4. Oathkeeper's role: dropped entirely

**Decision**: This approach does not use Ory Oathkeeper at all.

**Rationale**: Oathkeeper's only job in Approach A was bridging Dex's `authproxy` connector's need
for pre-trusted `X-Remote-*` headers — Dex has no way to call out to Kratos itself, so something had
to sit in front of it translating "valid Kratos session" into headers Dex would trust. Hydra's
login/consent delegation model has no equivalent need: the bridge Route Handlers (§2) are themselves
a normal server-side HTTP client, and can call Kratos's public `/sessions/whoami` directly,
forwarding the incoming request's `ory_kratos_session` cookie in the `Cookie` header of that outbound
call — no proxy, no header injection, no separate network-trust boundary to design around. Dropping
Oathkeeper also removes an entire service and its configuration surface from this approach, which is
itself a data point in the comparison between the two architectures (per the explicit repo-level
decision to drop Oathkeeper going forward).

**Alternatives considered**: Keeping Oathkeeper purely as a Welcome-page auth gate (checking
`cookie_session` before rendering `/`) was considered, since it's a valid pattern in isolation — but
rejected here because Next.js Middleware can perform the equivalent optimistic cookie check directly
against this app's own encrypted session cookie (exactly as Approach A's `middleware.ts` already
does), with zero added infrastructure. Reintroducing a proxy whose only remaining job duplicates
what Middleware already does would violate Principle V (minimal trust surface / no unjustified
complexity).

## 5. Kratos configuration and session/lifetime coupling

**Decision**: Kratos configuration (`kratos.yml`, identity schema) is reused essentially unchanged
from Approach A — same self-service login/registration/recovery flows rendered via
`@ory/elements-react`, same Postgres identity store, same mail catcher for recovery/verification.
The one addition: when the login bridge (§2) calls `acceptOAuth2LoginRequest` with `remember: true`,
set `remember_for` to a value at or below Kratos's own `session.lifespan` (default `24h`), so a
Hydra-side "remembered" login can never outlive the Kratos session it was based on.

**Rationale**: Confirmed via Hydra's Admin API schema that `remember`/`remember_for` on a login
acceptance create a Hydra-side cookie independent of Kratos's own session cookie. If these two
clocks drift (e.g., `remember_for` set longer than Kratos's session lifespan), a user could end up
with a "remembered" Hydra login backed by a Kratos identity that no longer has a valid session —
which would let a stale login silently skip re-checking Kratos on the next Hydra `/oauth2/auth` call.
Bounding `remember_for` by Kratos's session TTL closes that gap: whenever Kratos's session expires,
the next Hydra login attempt will have `skip: false` again (or the login bridge's own
`/sessions/whoami` check, performed on every non-skipped login request per §2, will catch it) and
correctly re-route to Kratos login.

**Alternatives considered**: Setting `remember: false` (never let Hydra skip the login step) —
simpler to reason about, but reintroduces a login-bridge round-trip on every single token
request/refresh even when the user is clearly still authenticated, which is unnecessary latency the
`remember`/`remember_for` mechanism exists specifically to avoid.

## 6. Testing stack

**Decision**: Same as Approach A — **Vitest** + React Testing Library for unit/component tests
(session cookie encode/decode, refresh-decision logic, login/consent bridge logic against mocked
Hydra Admin API responses); **Playwright** for end-to-end scenarios (login → Welcome page, refresh,
cross-tab notifications) driven against the full Docker Compose stack.

**Rationale**: Consistency with the sibling approach makes the two apps easier to compare
side-by-side; no feature-specific reason to diverge.

## 7. Cross-tab login/logout notification

**Decision**: Identical mechanism to Approach A — `BroadcastChannel` API with a `localStorage`
fallback, surfaced as a non-blocking pop-up.

**Rationale**: This requirement (from the repo-level Clarifications, not from either approach's
OIDC-provider choice) has no dependency on which OIDC provider is used; reusing the exact same
client-side mechanism keeps the comparison isolated to the dimension that actually differs (refresh
tokens), rather than introducing incidental differences.

## 8. Implementation findings from live end-to-end verification (2026-08-01)

Following the lesson from Approach A (its first curl-only verification pass missed four
fundamental bugs that only surfaced when the app's own code was actually run against the live
stack — see its research.md §7a), this app's Foundational/US1 scaffolding was verified by running
the real Next.js route handlers against a live Docker Compose stack from the start, not just by
inspecting Hydra/Kratos over curl. That surfaced the following, all fixed before US1 was considered
done:

- **The app cannot run inside the Compose stack, for the same reason as Approach A**: Hydra's
  `issuer` must be one single URL that both the browser and the app's own server-side
  `openid-client` discovery call resolve identically. `urls.self.issuer: http://localhost:4444`
  only works if the app itself also reaches Hydra at `localhost:4444` — impossible from inside a
  container without a Docker-network-hostname workaround. The app runs on the host (`npm run dev`),
  exactly like Approach A; `deploy/compose.yml` intentionally has no `app` service.
- **`openid-client` requires HTTPS by default** — same fix as Approach A: `getHydraConfig()` passes
  `{ execute: [client.allowInsecureRequests] }` outside of `NODE_ENV=production`, since this whole
  demo stack runs over plain HTTP.
- **Both Hydra's and Kratos's admin APIs must be published loopback-only (`127.0.0.1:PORT`, not
  `0.0.0.0:PORT`)**, not "not published at all" as in Approach A — because the login/consent bridge
  now runs on the host (not in a container reachable only via an internal Docker network), the only
  boundary available to keep the admin APIs away from the browser/network while still reachable by
  the host-run bridge is loopback-only binding. This is a materially different trust-boundary shape
  from Approach A's Dex (never published at all, reachable only via Oathkeeper on an internal
  Docker network) — worth noting as a genuine, non-cosmetic difference between the two approaches'
  security postures, not just an implementation detail.
- **Hydra has no user store, so it cannot construct ID token claims on its own — the consent
  bridge must supply them explicitly.** Unlike Dex's `authproxy` connector (which builds
  `claims.Username`/`claims.Email` automatically from trusted request headers), Hydra's
  `acceptOAuth2ConsentRequest` only issues the claims present in `session.id_token` at accept time;
  omitting it (as an initial draft of `app/hydra/consent/route.ts` did) produces an ID token with no
  `email`/`name` claims at all, which this app's own callback route then correctly rejects as
  `missing_claims`. The fix: look up the Kratos identity's `traits` via Kratos's Admin API
  (`GET /admin/identities/{subject}`, where `subject` is the Kratos identity ID the login bridge
  already put on the consent request) and pass `{ email, name }` as `session.id_token` when
  accepting consent (`app/lib/hydra-admin.ts`'s `getKratosIdentityTraits`). This is the one place
  where Hydra's "no identity opinions at all" design requires slightly more integration code than
  Dex's connector model — a genuine trade-off point for the comparison, not a bug in Hydra itself.

With all four addressed, a real Kratos registration → Hydra login-bridge (Kratos session check) →
Hydra consent-bridge (Kratos identity-traits lookup) → token exchange (including a real
`refresh_token`) → session cookie → Welcome-page-greeting round trip was confirmed working
end-to-end, rendering `Hello, {registered display name}`. A follow-up manual call to
`refreshTokens()` against the stored `refresh_token` was also confirmed to succeed and rotate the
token — the specific capability this whole second approach exists to demonstrate, which Approach A
could not exercise at all.
