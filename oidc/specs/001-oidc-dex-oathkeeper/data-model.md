# Data Model: Authentication with OIDC

**Feature**: `001-oidc-login-auth` | **Date**: 2026-07-31

This feature does not introduce a new application datastore. It composes identities and sessions
that already exist inside Ory Kratos (identity records) and Dex (OIDC clients, auth requests, refresh
tokens); the entities below describe how the Next.js app *models* those concepts at its own boundary,
not new schemas to create.

## User

Represents a person authenticated through the configured social identity provider, as surfaced to
the Next.js app via Dex's ID token / userinfo claims (which in turn reflect the underlying Kratos
identity).

| Field | Type | Notes |
|---|---|---|
| `subject` | string | Stable identifier (`sub` claim); primary key for correlating a session to a person. |
| `displayName` | string \| null | From the `name` claim if the identity provider/Kratos identity supplies one. |
| `email` | string | Fallback identifying value used in the Welcome greeting when `displayName` is absent (FR spec Edge Cases). |
| `emailVerified` | boolean | Passed through from the ID token claims; informational only for this feature. |

**Validation rules**: `subject` and `email` MUST be present for a session to be considered valid; a
missing `subject` or `email` on the ID token is treated as an authentication failure (redirect to
Login), not a degraded Welcome page.

## Session

Represents the Next.js app's own authenticated-state record for a browser, backed by the encrypted
cookie described in `research.md` §3 (revised). Distinct from (but derived from) the Kratos browser
session and the Dex/OAuth token set.

**Revised 2026-08-01**: Dex's `authproxy` connector never issues a `refresh_token` (research.md §3,
revised) — the `refreshToken` field from the original design has been dropped. Renewal instead means
silently re-running the Authorization Code flow and issuing a brand-new Session record, gated by
whether the underlying Kratos session (checked by Oathkeeper) is still valid.

| Field | Type | Notes |
|---|---|---|
| `accessToken` | string | Opaque/JWT access token from Dex's token endpoint; used to derive claims for the Welcome page. |
| `idTokenClaims` | object | Decoded ID token claims (`sub`, `name`, `email`, `email_verified`, `exp`, `iat`). |
| `accessTokenExpiresAt` | timestamp | Used to decide whether a silent re-authorization is needed before serving a request. |
| `createdAt` | timestamp | Set at initial login; used only for observability/audit logging (Constitution Principle IV), not for any absolute-lifetime cutoff (Clarifications: no idle timeout / no absolute cap beyond the underlying Kratos session's validity). |

**State transitions**:

```
(no session)
   --[Authorization Code Flow completes]--> Active
Active
   --[access token expiry observed, underlying Kratos session valid]--> Active (re-authorized silently, new Session issued)
   --[access token expiry observed, underlying Kratos session invalid/expired/revoked]--> (no session) [FR-007]
Active
   --[explicit logout in this or another tab]--> (no session), other tabs notified [Cross-tab logout]
(no session)
   --[login completes in another tab]--> other tabs notified [Cross-tab login]
```

**Validation rules**: A session is "valid" only if it decrypts successfully, its `idTokenClaims.sub`
is present, and the access token is unexpired (or silent re-authorization against the Kratos session
successfully re-establishes a new Session). Any other outcome MUST be treated as "no active session"
(FR-008 — never render authenticated content without verifying a valid session).

## Identity Provider Connection

Represents the relationship the app relies on but does not itself store: Dex configured with the
`authproxy` connector, fronted by Ory Oathkeeper, which authenticates against a Kratos browser
session (see research.md §1). Documented here as a conceptual entity for traceability to FR-003/FR-004,
not as app-owned data.

| Field | Type | Notes |
|---|---|---|
| `authorizationEndpoint` | URL | Dex `/auth` endpoint (behind Oathkeeper) the app redirects to. |
| `tokenEndpoint` | URL | Dex `/token` endpoint used for code exchange and refresh-token grant. |
| `clientId` / `clientSecret` | string | Registered OIDC client credentials for the Next.js app; sourced from environment/secrets, never committed (Constitution: Security & Compliance Requirements). |
| `scopes` | string[] | `openid`, `profile`, `email` — `offline_access` intentionally omitted; Dex's `authproxy` connector never honors it (research.md §3, revised), so requesting it would claim a capability this approach does not have. |
