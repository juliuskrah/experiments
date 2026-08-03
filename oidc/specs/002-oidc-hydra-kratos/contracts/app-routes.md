# Contract: Next.js App Routes

**Feature**: `002-oidc-hydra-kratos` | **Date**: 2026-08-01

Routes exposed by the Next.js app itself. All are same-origin; none are intended for external
consumers. Compare against `specs/001-oidc-dex-oathkeeper/contracts/app-routes.md` — the `GET /`,
`GET /login`, `GET /kratos/*`, `POST /api/auth/logout` contracts are intentionally identical between
the two approaches; only the OIDC-provider-facing routes (`/api/auth/login`, `/api/auth/callback`,
`/api/auth/session`) and the new Hydra login/consent bridge routes differ.

## Pages

### `GET /` (and any protected route)

- **Behavior**: Middleware performs an optimistic session-cookie check.
  - Valid session → render the page (Welcome page at `/` shows `Hello, {displayName ?? email}`).
  - No/invalid session → `307` redirect to `/login?return_to={original path}`.

### `GET /login`

- **Behavior**: Renders the Login page with a single "Continue with {provider}" button.
  - If a `return_to` query param is present, it is preserved through the OIDC flow.
  - If an `error` query param is present (see callback contract below), a dismissible error message
    is shown and the button remains clickable (FR-005 retry).

### `GET /kratos/login`, `GET /kratos/registration`, `GET /kratos/recovery`

- **Behavior**: Identical to the sibling approach — Server Components that initiate the
  corresponding Kratos self-service flow, fetch the flow by id, and render its `ui.nodes` via
  `@ory/elements-react`. Reached either directly (a user who has never had a Kratos session) or via
  a `return_to` redirect from the Hydra login bridge (below) when it finds no valid Kratos session.

### `GET /hydra/login`

- **Purpose**: Serve as Hydra's `urls.login` target — the page a browser lands on when Hydra's
  `/oauth2/auth` has no memory of this browser (FR-003, FR-009).
- **Request query params**: `login_challenge` (from Hydra).
- **Behavior**: This is a Route Handler, not a rendered page (no user-visible UI of its own) —
  named as a page-shaped path only because Hydra's `urls.login` config expects a browser-navigable
  URL.
  1. Call Hydra Admin API `GET /admin/oauth2/auth/requests/login?login_challenge=`.
  2. If `skip: true`: call `PUT /admin/oauth2/auth/requests/login/accept` with
     `{ subject: <remembered subject> }`, `302` redirect to the response's `redirect_to`.
  3. Else, check the browser's `ory_kratos_session` cookie against Kratos's public
     `GET /sessions/whoami` (forwarding the cookie in the outbound request's `Cookie` header).
     - Valid Kratos session: call `PUT /admin/oauth2/auth/requests/login/accept` with
       `{ subject: identity.id, remember: true, remember_for: <bounded by Kratos session TTL> }`,
       `302` redirect to the response's `redirect_to` (research.md §5).
     - No/invalid Kratos session: `302` redirect to
       `/kratos/login?return_to=/hydra/login?login_challenge={login_challenge}`.

### `GET /hydra/consent`

- **Purpose**: Serve as Hydra's `urls.consent` target (FR-004).
- **Request query params**: `consent_challenge` (from Hydra).
- **Behavior**: Route Handler, no user-visible consent screen (this app is Hydra's only, fully
  first-party client).
  1. Call Hydra Admin API `GET /admin/oauth2/auth/requests/consent?consent_challenge=`.
  2. Look up the Kratos identity's `traits` via `GET /admin/identities/{consentRequest.subject}`
     against Kratos's Admin API (research.md §8) — Hydra has no user store of its own and will not
     put any claims beyond `sub` into the ID token unless the accept call explicitly supplies them.
  3. Call `PUT /admin/oauth2/auth/requests/consent/accept` with
     `{ grant_scope: consentRequest.requested_scope, grant_access_token_audience:
     consentRequest.requested_access_token_audience, session: { id_token: { email, name } } }`.
  4. `302` redirect to the response's `redirect_to`.

## Route Handlers

### `GET /api/auth/login`

- **Purpose**: Begin the OIDC Authorization Code + PKCE flow against Hydra (FR-003).
- **Request**: none (invoked by the Login page button as a navigation, optionally carrying
  `?return_to=`).
- **Behavior**:
  1. Generate `code_verifier`, `code_challenge` (S256), `state`, `nonce`.
  2. Store `code_verifier`, `state`, `nonce`, and `return_to` in a short-lived (10 min),
     `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
  3. `302` redirect to Hydra's public authorization endpoint with the standard Authorization Code +
     PKCE parameters and `scope=openid profile email offline_access`.

### `GET /api/auth/callback`

- **Purpose**: Complete the Authorization Code flow (FR-004, FR-005).
- **Request query params**: `code`, `state` on success; `error`, `error_description` on
  denial/failure (per OAuth 2.0 §4.1.2.1).
- **Response**:
  - Success: exchanges `code` for tokens (verifying `state`/`nonce`) against Hydra's public token
    endpoint, establishes the Session including the issued `refresh_token` (see data-model.md),
    clears the transient PKCE cookie, `302` redirects to the original `return_to` (default `/`).
  - IdP error or `state` mismatch: clears the transient PKCE cookie, `302` redirects to
    `/login?error={reason}` (FR-005).

### `POST /api/auth/logout`

- **Purpose**: End the local session and notify other tabs (Clarifications; cross-tab logout).
- **Response**: clears the session cookie, `200` with `{ "ok": true }`. Client-side code that calls
  this endpoint then posts a `session-invalidated` message on the shared `BroadcastChannel` (see
  quickstart.md). Does not revoke the Hydra-side refresh token or the Hydra "remembered" login in
  this feature's scope — logout is local-session-only, matching the sibling approach and the spec's
  Assumptions (no explicit logout capability was in the original request; this route exists per the
  repo-level cross-tab-notification requirement, not per FR-001–FR-009).

### `GET /api/auth/session` (internal use by client components)

- **Purpose**: Let client components learn the current session's display info without exposing raw
  tokens.
- **Response `200`**: `{ "authenticated": true, "displayName": string | null, "email": string }`
- **Response `200` (no session)**: `{ "authenticated": false }`
- **Side effect**: performs a standards-compliant OAuth2 refresh-token grant against Hydra's public
  token endpoint if the access token is expired and the refresh token is still valid (FR-006); if
  Hydra rejects the refresh token as invalid/expired/revoked, responds `{ "authenticated": false }`
  and clears the session cookie (FR-007).
  - **Note on the Kratos-session-ended edge case** (spec.md Edge Cases): a successful Hydra refresh
    grant does NOT by itself re-verify that the underlying Kratos session is still valid — Hydra's
    refresh-token store is independent of Kratos once the initial login/consent bridge round-trip
    (research.md §2) is complete. This endpoint additionally re-checks Kratos's `/sessions/whoami`
    whenever it performs a refresh (not on every unexpired-access-token request, to avoid an extra
    network call on the common path), and treats an invalid Kratos session the same as an invalid
    refresh token — clearing the session and returning `{ "authenticated": false }` — so a session
    can never outlive the Kratos session it was originally issued for by more than one access-token
    lifetime.
