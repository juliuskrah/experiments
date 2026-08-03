# Contract: Next.js App Routes

**Feature**: `001-oidc-login-auth` | **Date**: 2026-07-31

Routes exposed by the Next.js app itself. All are same-origin; none are intended for external
consumers.

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

- **Behavior**: Server Components that initiate the corresponding Kratos self-service flow
  (`.../browser`), fetch the flow by id, and render its `ui.nodes` via `@ory/elements-react`.
  Submission posts to the flow's own `ui.action` (Kratos's Public API), per research.md §2 — the
  Next.js app does not proxy the submission itself. These pages exist purely so that whatever
  identity-provider action (Oathkeeper → Kratos) sends the browser to for authentication resolves
  to a page matching the app's design (per the request to customize any native provider UI).

## Route Handlers

### `GET /api/auth/login`

- **Purpose**: Begin the OIDC Authorization Code + PKCE flow (FR-003).
- **Request**: none (invoked by the Login page button as a navigation, optionally carrying
  `?return_to=`).
- **Behavior**:
  1. Generate `code_verifier`, `code_challenge` (S256), `state`, `nonce`.
  2. Store `code_verifier`, `state`, `nonce`, and `return_to` in a short-lived (10 min),
     `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
  3. `302` redirect to Dex's authorization endpoint with the standard Authorization Code + PKCE
     parameters and `scope=openid profile email` (no `offline_access` — see data-model.md's
     Identity Provider Connection entity and research.md §3, revised).

### `GET /api/auth/callback`

- **Purpose**: Complete the Authorization Code flow (FR-004, FR-005).
- **Request query params**: `code`, `state` on success; `error`, `error_description` on denial/failure
  (per OAuth 2.0 §4.1.2.1).
- **Response**:
  - Success: exchanges `code` for tokens (verifying `state`/`nonce`), establishes the Session (see
    data-model.md), clears the transient PKCE cookie, `302` redirects to the original `return_to`
    (default `/`).
  - IdP error or `state` mismatch: clears the transient PKCE cookie, `302` redirects to
    `/login?error={reason}` (FR-005).

### `POST /api/auth/logout`

- **Purpose**: End the local session and notify other tabs (Clarifications; cross-tab logout).
- **Response**: clears the session cookie, `200` with `{ "ok": true }`. Client-side code that calls
  this endpoint then posts a `session-invalidated` message on the shared `BroadcastChannel` (see
  quickstart.md).

### `GET /api/auth/session` (internal use by client components)

- **Purpose**: Let client components learn the current session's display info without exposing raw
  tokens.
- **Response `200`**: `{ "authenticated": true, "displayName": string | null, "email": string }`
- **Response `200` (no session)**: `{ "authenticated": false }`
- **Side effect (revised 2026-08-01)**: if the access token is expired, silently re-runs the
  Authorization Code flow against Dex (`authproxy` → Oathkeeper's `cookie_session` check) to
  re-establish a fresh Session, rather than performing an OAuth refresh-token grant — Dex's
  `authproxy` connector never issues a refresh token (research.md §3, revised; FR-006). If the
  underlying Kratos session is invalid/expired, the re-authorization attempt fails and this endpoint
  responds `{ "authenticated": false }` and clears the session cookie (FR-007).
