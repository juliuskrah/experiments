# dex-oathkeeper-kratos

OIDC authentication demo — **Approach A** of a two-approach comparison (see the sibling
[`hydra-kratos/`](../hydra-kratos/README.md) app for Approach B).

## Architecture

```
Browser → Next.js app (this repo) → Ory Oathkeeper → Dex (authproxy connector) → Ory Kratos
```

- **Ory Kratos** is the sole identity/session store: self-service login, registration, and
  recovery flows, rendered in this app via `@ory/elements-react` + `@ory/nextjs`.
- **Dex**'s `authproxy` connector has no login UI of its own — it trusts pre-verified
  `X-Remote-User`/`X-Remote-Email`/`X-Remote-Name` headers and issues OIDC tokens based on them.
- **Ory Oathkeeper** sits in front of Dex's `authproxy` connector: it checks the browser's Kratos
  session cookie against Kratos's `/sessions/whoami` (`cookie_session` authenticator) and, if
  valid, injects the `X-Remote-*` headers Dex trusts (`header` mutator). If the Kratos session is
  missing/invalid, Oathkeeper redirects the browser to this app's Kratos login page instead.
- The Next.js app never talks to Dex directly except through Oathkeeper, and drives the standard
  OIDC Authorization Code + PKCE flow via `openid-client`, storing the resulting session in an
  encrypted (JWE, via `jose`) `session` cookie.

Dex is not published to the host or reachable from the browser — only Oathkeeper and Kratos's
public API are (see `deploy/compose.yml`).

### The refresh-token limitation

Dex's `authproxy` connector does not implement `connector.RefreshConnector` (confirmed by reading
`dexidp/dex` v2.44.0 source and by live end-to-end testing), so it can never issue an OAuth2
`refresh_token`. Session renewal in this app is therefore **not** a standards-compliant refresh
grant — instead, `GET /api/auth/session` silently replays the Authorization Code + PKCE flow
server-to-server (`reauthorize()` in `app/lib/oidc-client.ts`), forwarding the browser's Kratos
session cookie so Oathkeeper's `cookie_session` check approves it without any user-visible
redirect. If the underlying Kratos session itself is invalid/expired, this silent re-authorization
fails and the user is redirected to `/login`.

See `specs/001-oidc-dex-oathkeeper/research.md` §3 (revised) for the full writeup, and the sibling
`hydra-kratos/` app for how Approach B achieves a real refresh-token grant instead.

## Running locally

Prerequisites: Docker, Node.js, npm.

1. Copy `.env.example` to `.env` and fill in real values for `DEX_CLIENT_SECRET`,
   `SESSION_SECRET`, `KRATOS_COOKIE_SECRET`, `KRATOS_CIPHER_SECRET` (dev-only, rotatable — never
   commit `.env`).
2. Start the backing services:
   ```sh
   docker compose --env-file .env -f deploy/compose.yml up
   ```
3. In a separate terminal, run the Next.js app on the host (not in Docker — see the comment in
   `deploy/compose.yml` for why: Dex's issuer URL must resolve identically for the browser and for
   the app's server-side OIDC discovery call, which only holds if both mean `localhost`):
   ```sh
   npm install
   npm run dev
   ```
4. Open http://localhost:3000.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `DEX_ISSUER_URL` | Dex's OIDC issuer URL, as reached through Oathkeeper |
| `DEX_CLIENT_ID` | OAuth2 client ID registered with Dex |
| `DEX_CLIENT_SECRET` | OAuth2 client secret registered with Dex |
| `SESSION_SECRET` | Symmetric key for encrypting the app's session cookie |
| `KRATOS_PUBLIC_URL` | Kratos's public API base URL |
| `ORY_SDK_URL` | Base URL `@ory/nextjs` uses to proxy `/self-service/*` flow requests to Kratos |

## Testing

```sh
npm run lint
npx tsc --noEmit
npm run test:unit    # Vitest — unit tests, no live services required
npm run test:e2e     # Playwright — requires the Docker Compose stack running (see above)
```

See `specs/001-oidc-dex-oathkeeper/quickstart.md` for the full set of manual/e2e validation
scenarios this test suite covers.
