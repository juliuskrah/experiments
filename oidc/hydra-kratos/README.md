# hydra-kratos

OIDC authentication demo — **Approach B** of a two-approach comparison (see the sibling
[`dex-oathkeeper-kratos/`](../dex-oathkeeper-kratos/README.md) app for Approach A).

## Architecture

```
Browser → Next.js app (this repo) → Ory Hydra → [login/consent bridge routes in this app] → Ory Kratos
```

- **Ory Kratos** is the sole identity/session store: self-service login, registration, and
  recovery flows, rendered in this app via `@ory/elements-react` + `@ory/nextjs` — identical setup
  to the sibling app.
- **Ory Hydra** is a full, standards-compliant OAuth2/OIDC provider (via `ory/fosite`), but has no
  user store of its own. It delegates every login and consent decision to this app's own Route
  Handlers via its Admin API (`app/lib/hydra-admin.ts`):
  - `GET /hydra/login` — receives a `login_challenge`, checks the browser's Kratos session
    (forwarding its cookie to Kratos's `/sessions/whoami`), and either accepts the login on Hydra's
    behalf or bounces the browser to `/kratos/login` first.
  - `GET /hydra/consent` — receives a `consent_challenge`, looks up the authenticated identity's
    traits directly from Kratos's Admin API (since Hydra has none), and auto-accepts the requested
    scope with no user-facing screen (this app is Hydra's only, fully first-party client).
- The Next.js app drives the standard OIDC Authorization Code + PKCE flow via `openid-client`
  against Hydra's public endpoints, storing the resulting session (access token, ID token claims,
  **and refresh token**) in an encrypted (JWE, via `jose`) `session` cookie.

Hydra's Admin API is published loopback-only (`127.0.0.1`, not `0.0.0.0`) — reachable by this
host-run app, but never by the browser or the network (see `deploy/compose.yml`).

### The refresh-token capability

Unlike the sibling `dex-oathkeeper-kratos/` app — where Dex's `authproxy` connector cannot issue a
refresh token at all — Hydra issues a real, standards-compliant OAuth2 `refresh_token` for the
`offline_access` scope, and rotates it on every use. `GET /api/auth/session` performs an actual
refresh-token grant (`refreshTokens()` in `app/lib/oidc-client.ts`) when the access token expires,
with no silent replay of the Authorization Code flow needed.

One nuance a refresh-token grant introduces that the sibling approach's silent-re-authorization
design cannot even express: Hydra's refresh-token store is independent of Kratos once the initial
login/consent bridge round-trip is complete, so a Hydra refresh grant can succeed even after the
underlying Kratos session has ended. `GET /api/auth/session` re-checks Kratos's `/sessions/whoami`
on every refresh (not on every request, to avoid an extra network call on the common path) and
treats a failed re-check the same as a rejected refresh token.

See `specs/002-oidc-hydra-kratos/research.md` §2–§3 for the full writeup, and
[`../specs/COMPARISON.md`](../specs/COMPARISON.md) for the concrete comparison against Approach A.

## Running locally

Prerequisites: Docker, Node.js, npm.

1. Copy `.env.example` to `.env` and fill in real values for `HYDRA_CLIENT_SECRET`,
   `SESSION_SECRET`, `HYDRA_SYSTEM_SECRET`, `HYDRA_COOKIE_SECRET`, `KRATOS_COOKIE_SECRET`,
   `KRATOS_CIPHER_SECRET` (dev-only, rotatable — never commit `.env`).
2. Start the backing services:
   ```sh
   docker compose --env-file .env -f deploy/compose.yml up
   ```
3. In a separate terminal, run the Next.js app on the host (not in Docker — for the same reason as
   the sibling app: Hydra's issuer URL must resolve identically for the browser and for the app's
   server-side OIDC discovery call, which only holds if both mean `localhost`):
   ```sh
   npm install
   npm run dev
   ```
4. Open http://localhost:3000.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `HYDRA_ISSUER_URL` | Hydra's OIDC issuer URL (its public API) |
| `HYDRA_ADMIN_URL` | Hydra's Admin API base URL, used by the login/consent bridge routes |
| `HYDRA_CLIENT_ID` | OAuth2 client ID registered with Hydra |
| `HYDRA_CLIENT_SECRET` | OAuth2 client secret registered with Hydra |
| `SESSION_SECRET` | Symmetric key for encrypting the app's session cookie |
| `KRATOS_PUBLIC_URL` | Kratos's public API base URL |
| `KRATOS_ADMIN_URL` | Kratos's Admin API base URL, used to look up identity traits for the consent bridge |

## Testing

```sh
npm run lint
npx tsc --noEmit
npm run test:unit    # Vitest — unit tests, no live services required
npm run test:e2e     # Playwright — requires the Docker Compose stack running (see above)
```

See `specs/002-oidc-hydra-kratos/quickstart.md` for the full set of manual/e2e validation
scenarios this test suite covers, including Scenario 5b (the Kratos-session-ended edge case this
approach's refresh-token grant makes possible to express).
