# Data Model: Authentication with OIDC via Hydra + Kratos

**Feature**: `002-oidc-hydra-kratos` | **Date**: 2026-08-01

This feature does not introduce a new application datastore. It composes identities that already
exist inside Ory Kratos and OAuth2 client/token state that already exists inside Ory Hydra; the
entities below describe how the Next.js app *models* those concepts at its own boundary, not new
schemas to create.

## User

Represents a person authenticated through Kratos, as surfaced to the Next.js app via the ID token
issued by Hydra (whose subject and claims are populated from Kratos identity data by the login
bridge — see research.md §2).

| Field | Type | Notes |
|---|---|---|
| `subject` | string | Kratos identity ID (`sub` claim); primary key for correlating a session to a person. |
| `displayName` | string \| null | From the `name` claim, populated by the login bridge from the Kratos identity's `traits.name`. |
| `email` | string | Fallback identifying value used in the Welcome greeting when `displayName` is absent (FR spec Edge Cases); populated from `traits.email`. |
| `emailVerified` | boolean | Passed through from the ID token claims; informational only for this feature. |

**Validation rules**: `subject` and `email` MUST be present for a session to be considered valid; a
missing `subject` or `email` on the ID token is treated as an authentication failure (redirect to
Login), not a degraded Welcome page.

## Session

Represents the Next.js app's own authenticated-state record for a browser, backed by the encrypted
cookie described in `research.md` §3. Distinct from (but derived from) the Kratos browser session,
the Hydra login/consent decision, and the Hydra-issued OAuth2 token set.

| Field | Type | Notes |
|---|---|---|
| `accessToken` | string | Opaque access token from Hydra's token endpoint; used to derive claims for the Welcome page. |
| `refreshToken` | string | Standards-compliant OAuth2 refresh token issued by Hydra (via `fosite`) because the `offline_access` scope was requested; rotates on every use per Hydra's refresh-grant behavior (`oauth2.grant.refresh_token.rotation_grace_period`) — MUST be overwritten atomically after each refresh. |
| `idTokenClaims` | object | Decoded ID token claims (`sub`, `name`, `email`, `email_verified`, `exp`, `iat`). |
| `accessTokenExpiresAt` | timestamp | Used to decide whether a refresh-token exchange is needed before serving a request. |
| `createdAt` | timestamp | Set at initial login; used only for observability/audit logging (Constitution Principle IV), not for any absolute-lifetime cutoff. |

**State transitions**:

```
(no session)
   --[Authorization Code Flow completes, via Hydra login/consent bridge]--> Active
Active
   --[access token expiry observed, refresh token valid]--> Active (refreshed, new refresh token stored — standards-compliant OAuth2 refresh_token grant against Hydra)
   --[access token expiry observed, refresh token invalid/expired/revoked, OR the identity it was issued for no longer has a valid Kratos session]--> (no session) [FR-007]
Active
   --[explicit logout in this or another tab]--> (no session), other tabs notified [Cross-tab logout]
(no session)
   --[login completes in another tab]--> other tabs notified [Cross-tab login]
```

**Validation rules**: A session is "valid" only if it decrypts successfully, its `idTokenClaims.sub`
is present, and either the access token is unexpired or a refresh-token grant successfully renews
it. Any other outcome MUST be treated as "no active session" (FR-008 — never render authenticated
content without verifying a valid session).

## Identity Provider Connection

Represents the relationship the app relies on but does not itself store: Hydra as the OAuth2/OIDC
Authorization Server, with this app's own Route Handlers acting as Hydra's login/consent bridge
(delegating identity decisions to Kratos on every non-"remembered" login — see research.md §2 and
§5). Documented here as a conceptual entity for traceability to FR-003/FR-004/FR-009, not as
app-owned data.

| Field | Type | Notes |
|---|---|---|
| `authorizationEndpoint` | URL | Hydra's public `/oauth2/auth` endpoint the app redirects to. |
| `tokenEndpoint` | URL | Hydra's public `/oauth2/token` endpoint used for code exchange and the refresh-token grant. |
| `adminEndpoint` | URL | Hydra's Admin API base URL, used only server-side by the login/consent bridge — MUST NOT be reachable from the public internet or the browser (Constitution Principle I). Published loopback-only (`127.0.0.1:PORT`) rather than omitted entirely, since (unlike Approach A's Dex) this app's bridge runs on the host, not inside the Compose network (research.md §8). |
| `kratosAdminEndpoint` | URL | Kratos's Admin API base URL, used only server-side by the consent bridge to look up identity traits for the ID token (research.md §8) — same loopback-only publishing rule as `adminEndpoint`. |
| `clientId` / `clientSecret` | string | Registered OAuth2 client credentials for the Next.js app, created against Hydra's Admin API; sourced from environment/secrets, never committed. |
| `scopes` | string[] | MUST include `openid`, `profile`, `email`, and `offline_access` (required for Hydra/fosite to issue a refresh token — research.md §1). |

## Hydra Login/Consent Bridge State (conceptual, not persisted)

Represents the per-request state the bridge Route Handlers thread through Hydra's Admin API calls.
Not a database entity — exists only for the duration of a single login/consent round-trip, carried
via the `login_challenge`/`consent_challenge` query parameters Hydra itself manages.

| Field | Type | Notes |
|---|---|---|
| `loginChallenge` | string | Opaque identifier from Hydra's `GET /oauth2/auth` redirect; used to fetch/accept the login request via the Admin API. |
| `consentChallenge` | string | Opaque identifier from Hydra's post-login redirect; used to fetch/accept the consent request via the Admin API. |
| `kratosSessionValid` | boolean | Result of the bridge's `GET /sessions/whoami` call against Kratos, forwarding the browser's `ory_kratos_session` cookie; determines whether the login request is accepted or the browser is redirected to `/kratos/login`. |
