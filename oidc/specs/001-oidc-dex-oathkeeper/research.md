# Research: Authentication with OIDC

**Feature**: `001-oidc-login-auth` | **Date**: 2026-07-31

## 1. Bridging Dex (OIDC provider) and Ory Kratos (identity backend)

**Decision**: Front Dex with **Ory Oathkeeper**. Oathkeeper's `cookie_session` authenticator
validates the browser's Kratos session cookie against Kratos's `/sessions/whoami`; its `header`
mutator then injects `X-Remote-User` / `X-Remote-Email` / `X-Remote-Group` before forwarding the
request to Dex, which authenticates the (pre-verified) request via its **`authproxy`** connector.
When no valid Kratos session exists, Oathkeeper's `redirect` error handler sends the browser to the
Next.js-hosted Kratos login page with a `return_to` back to the original Dex `/auth` URL.

**Rationale**: Dex ships no connector that itself calls out to an external identity system
synchronously (there is no "http-proxy" connector — the closest is `authproxy`, which *only* trusts
headers already present on the request; it makes no outbound calls, per
`connector/authproxy/authproxy.go`). Dex maintainers, in `dexidp/dex#2730`, confirm there is no
built-in path for "Dex calls Kratos" and suggest inverting the relationship instead. Rather than
writing and maintaining a custom Dex connector (a new piece of security-critical code — see
Constitution Principle V), Oathkeeper is a first-party Ory component built exactly for "check a
Kratos session, then forward trusted identity headers to an upstream service." This keeps the
authproxy trust boundary enforced by a vetted, single-purpose proxy instead of custom code, and
directly satisfies the requirement to use Kratos as the user-management backend behind Dex.

**Alternatives considered**:
- *Custom Dex connector calling Kratos directly* — most "correct" long-term, but adds bespoke
  Go code to the highest-trust part of the system; rejected per Principle V (minimal trust surface;
  no custom auth code without a concrete requirement Oathkeeper can't already satisfy).
- *Hand-rolled nginx `auth_request` + Lua/subrequest to Kratos* — works, but reinvents what
  Oathkeeper already does declaratively, and is materially more code to secure and test.
- *Invert the architecture (Kratos as OIDC client of Dex, or Hydra in front of Kratos as the actual
  OIDC provider)* — the maintainer-suggested "correct" shape, but it removes Dex as the OIDC
  provider entirely, which contradicts the requirement that Dex is the app's OIDC/social-login
  provider.

**Threat consideration** (per Constitution Principle I): the `X-Remote-*` headers are a forged-identity
risk if anything other than Oathkeeper can reach Dex directly. Mitigation: Dex is not exposed on any
network/port reachable by the browser or other containers in Docker Compose — only Oathkeeper is
published, and Oathkeeper is configured to strip/overwrite any inbound `X-Remote-*` headers from the
original client request before setting its own.

## 2. Implementing Kratos's headless login/registration/recovery pages in Next.js

**Decision**: Use Kratos's Public API self-service flows (`/self-service/{login,registration,recovery}/browser`
→ fetch flow by ID → render `ui.nodes` → submit to `ui.action`) rendered with Ory's official
**`@ory/elements-react`** components, wired up via **`@ory/nextjs`**, inside Next.js App Router pages
under `/login`, `/registration`, `/recovery`.

**Rationale**: Kratos is headless by design; `@ory/elements-react` renders the dynamic `ui.nodes`
form-field contract Kratos returns (inputs, CSRF token, validation messages) without the app having
to hand-write flow-shape-aware form logic, and `@ory/nextjs` provides the server-side helpers for
calling Kratos's Public API from Route Handlers/Server Components. This is the officially maintained
path (Ory's own `kratos-selfservice-ui-node` reference app follows the same flow lifecycle) and
minimizes custom auth code per Principle V.

**Alternatives considered**:
- *Hand-roll forms against the raw flow JSON* — full control, but re-implements what
  `@ory/elements-react` already does, and needs careful CSRF-token/node-group handling to get right;
  rejected as unnecessary custom code.
- *Redirect to Kratos's own hosted UI* — Kratos has no bundled UI by default (this is precisely why
  the requirement calls for building these pages), so this isn't viable without standing up a
  separate UI project — rejected, contradicts the explicit requirement to host these pages in Next.js.

**Risk noted**: `@ory/nextjs` is pre-1.0 (`v1.0.0-rc.1` at time of writing). Accepted as a documented
risk; `@ory/client-fetch` (the stable generated SDK) plus hand-written Route Handlers is the fallback
if the RC package proves unstable during implementation.

## 3. Next.js OIDC Relying Party implementation (Authorization Code + PKCE, silent renewal) — REVISED 2026-08-01

**Decision (revised)**: Use **`openid-client`** (panva) directly inside Next.js Route Handlers for
Dex's Authorization Code + PKCE flow. Store the resulting access token and ID token claims in an
encrypted, `HttpOnly`, `Secure`, `SameSite=Lax` cookie (JWE via `jose`) rather than a server-side
session store. On access-token expiry (checked with a small clock-skew buffer), renew the session by
silently re-running `GET /api/auth/login` → Dex `/auth` → `authproxy` connector → Oathkeeper's
`cookie_session` check against the still-valid Kratos session → back to `/api/auth/callback` — with
no visible redirect to `/login` or login form, because Oathkeeper approves instantly whenever the
Kratos session is valid.

**Why this decision changed**: The original decision (below, preserved for the record) called for a
standard OAuth2 refresh-token grant using the `offline_access` scope. Hands-on end-to-end testing
against the real Docker Compose stack (2026-08-01) proved this doesn't work: Dex's token endpoint
never returns a `refresh_token` for the `authproxy` connector, no matter what scope is requested.
Reading `connector/authproxy/authproxy.go` and `server/oauth2.go` in the `dexidp/dex` v2.44.0 source
confirms why — Dex only issues a refresh token when `offlineAccessRequested && canRefresh`, where
`canRefresh` is a type-assertion that the connector implements Dex's `connector.RefreshConnector`
interface (`Refresh(ctx, Scopes, Identity) (Identity, error)`). The `authproxy` connector's `callback`
type implements no such method — it is a stateless, single-shot connector by design (it just reads
trusted headers off the current request), so there is nothing for it to refresh. This is a structural
property of the connector, not a misconfiguration; no combination of `staticClients`/`scopes`/
`oauth2` settings changes it.

**Consequence for FR-006/FR-007**: Since no refresh token is ever issued, "renew the session using
the refresh token" (the spec's original framing) is not achievable in this architecture. The spec
(see spec.md's "Known Limitation" section) and this plan have been revised to describe renewal as
silent re-authorization against the Kratos session instead. This preserves the user-visible behavior
(SC-003: no login prompt as long as the underlying session is valid) through a different mechanism —
it is the load-bearing difference under comparison against the sibling `hydra-kratos/` app (spec
`002-oidc-hydra-kratos`), which uses Ory Hydra (built on `ory/fosite`) instead of Dex specifically
because Hydra issues standards-compliant, connector-independent refresh tokens.

**Original decision (superseded, kept for audit trail)**: Perform the refresh-token exchange lazily
on the next authenticated request that finds the access token expired, inside a Node-runtime Route
Handler/Server Component data-access path, not in Edge Middleware; persist the rotated refresh token
atomically after every use (Dex rotates on every use, old token invalidated). This remains
architecturally sound advice for an OIDC provider that *does* support refresh tokens — see
`002-oidc-hydra-kratos/research.md` — it simply does not apply to Dex's `authproxy` connector.

**Rationale (still valid)**: `openid-client` is OpenID-certified, actively maintained, and designed
for arbitrary spec-compliant issuers (Dex has no vendor SDK) with first-class PKCE support. Auth.js/
NextAuth v5 supports generic OIDC providers but adds an abstraction layer without removing work this
feature needs to do itself either way. A stateless encrypted cookie avoids introducing a new
infrastructure dependency (e.g., Redis) purely for session storage, matching Principle V and the
"simple app" scope in the spec's Assumptions.

**Alternatives considered**:
- *Auth.js v5 with a generic OIDC provider* — less code to wire up initially, but adds an abstraction
  layer without removing the PKCE/callback work this feature needs regardless; rejected.
- *Server-side session store (Redis/DB) keyed by an opaque cookie* — more scalable across multiple
  instances, but adds a new stateful service with no current multi-instance requirement; rejected per
  YAGNI, revisit only if horizontal scaling of the Next.js app becomes a real need.
- *Re-authorization via Edge Middleware on every request* — Middleware runs on the Edge runtime and
  can be hit by prefetches; doing the Dex round-trip there is unreliable. Middleware is used only for
  the optimistic redirect-to-login check; the authoritative renewal happens in Node-runtime code
  (`GET /api/auth/session`).
- *Custom Dex connector implementing `RefreshConnector` for `authproxy`-style header trust* — would
  restore a real refresh-token grant, but requires writing and maintaining new security-critical Go
  code inside Dex; rejected per Principle V (this is exactly the class of problem Approach B/Hydra
  solves without custom code, so building it here would duplicate effort with a worse trust profile).

**Dex-specific note (still valid)**: the `offline_access` scope is harmless to request but has no
effect through the `authproxy` connector — it is kept out of the requested scope list entirely now
(scope is `openid profile email`) to avoid implying a capability that doesn't exist (Constitution
Principle I: least-privilege scopes, request only what is actually used).

## 7. Implementation findings from live end-to-end verification (2026-08-01)

Beyond the refresh-token architectural limitation (§3, revised), running the actual Docker Compose
stack surfaced concrete configuration bugs that design review did not catch. Recorded here per
Constitution Principle IV (auditability) and because they are exactly the kind of integration-contract
detail Principle II says must be written down, not left implicit:

- **Kratos secrets are not `$VAR`-substituted in `kratos.yml`**: Kratos's config loader does not
  expand `$VAR` placeholders inside YAML values. `secrets.cookie`/`secrets.cipher` must instead be
  supplied via the `SECRETS_COOKIE_0`/`SECRETS_CIPHER_0` environment variables (Kratos's own
  environment-variable-override convention), with the `secrets:` key omitted from `kratos.yml`
  entirely.
- **Dex's config *is* templated, but via gomplate, not shell expansion**: Dex's `docker-entrypoint`
  binary (shipped in the official image) runs any `.yaml`/`.tpl`/`.tmpl` file passed to `dex serve`
  through `gomplate` before launching. `staticClients[].id`/`.secret` must use gomplate/Go-template
  syntax (`'{{ .Env.DEX_CLIENT_ID }}'`), not `$DEX_CLIENT_ID` — the latter is taken as a literal
  string with no expansion, silently registering a client whose ID is the four characters `$DEX_CLIENT_ID`.
- **Oathkeeper's default access-rule matching strategy is `regexp`, not glob**: the `<*>`/`<**>`
  glob wildcards used in `rules.json`'s `match.url` only work when `access_rules.matching_strategy:
  glob` is explicitly set in `config.yaml`; under the default `regexp` strategy, `<*>` is invalid
  regex syntax and Oathkeeper 500s on every request matching that rule.
- **Oathkeeper's top-level `authorizers`/`mutators` config blocks must explicitly enable the handlers
  a rule references** (`authorizers.allow.enabled: true`, `mutators.header.enabled: true` with a
  `config.headers: {}` placeholder), even though the same handlers are also configured per-rule in
  `rules.json` — a rule referencing a globally-disabled handler fails at rule-load time with "this
  authorizer is misconfigured or disabled."
- **`upstream.strip_path` must not strip a path segment the upstream itself expects** — Dex's own
  `issuer` is configured as `http://host:5556/dex`, so Dex's router expects incoming requests to
  retain the `/dex` prefix; the original rule's `strip_path: /dex` silently produced 404s from Dex
  for every request. Removing `strip_path` (so Oathkeeper forwards the full `/dex/...` path unchanged)
  fixed it.
- **`errors.handlers.redirect`'s `config.to` is a static URL, not a Go template** — unlike mutator
  header values, it does not support `{{ .MatchedURL }}`-style interpolation; using it produced a
  redirect to the literal string `{{ .MatchedURL }}` rather than an interpolated value. The rule now
  redirects to a fixed `/kratos/login` URL with no query-string passthrough at the Oathkeeper-error
  level (the app's own `/api/auth/login` still supports `?return_to=` for its own error path).
- **Dex's `authproxy` connector maps `userHeader` → the ID token's `name` claim, not `userNameHeader`**
  — reading `server/oauth2.go`'s `tok.Name = claims.Username` (where `claims.Username` comes from
  `authproxy`'s `userHeader`, not its `userNameHeader`, which instead populates `preferred_username`).
  The original config pointed `userHeader` at the same header as `userIDHeader` (the Kratos subject
  UUID), so the `name` claim ended up being a UUID instead of the human display name. Fixed by
  pointing `userHeader` at the display-name header (`X-Remote-Name`) and dropping the separate
  `userNameHeader` config entirely, matching what `app/lib/session.ts` actually reads (`idTokenClaims.name`).

### 7a. Second verification pass (2026-08-01) — the first pass above was incomplete

The findings above came from driving the Dex/Oathkeeper/Kratos chain with raw `curl` and manually
constructed URLs. That validated the HTTP-level protocol chain but never actually exercised this
app's own `app/lib/oidc-client.ts` calling `openid-client`, which is what T023's checkpoint actually
claimed was "verified working end-to-end." Running the real app code against the same live stack
surfaced four further, more fundamental bugs the curl-only pass could not have caught:

- **Dex's `issuer` must be one single URL that both the browser and the app's server-side discovery
  call resolve identically** — `openid-client`'s `discovery()` fetches metadata from the URL it's
  given and then requires the metadata's own `issuer` field to match that exact URL
  (`oauth4webapi`'s `discoveryRequest`/`processDiscoveryResponse`, `JSON_ATTRIBUTE_COMPARISON`
  check). The original design had Dex's `issuer: http://localhost:5556/dex` (Dex's own internal
  listen address) while the app's `DEX_ISSUER_URL` pointed at Oathkeeper
  (`http://oathkeeper:4455/dex`, a Docker-network-only hostname) — two different strings, so
  discovery always threw `"discovered metadata issuer does not match the expected issuer"`. Because
  the app was never actually run as Next.js server code during the first verification pass (only
  curl against Dex/Oathkeeper directly), this never surfaced. Fixed by setting Dex's `issuer` to
  `http://localhost:4455/dex` (the URL both the browser and the app can reach) and running the
  Next.js app **on the host**, not as a Docker Compose service — see the compose.yml comment on
  `deploy/compose.yml` explaining why the app is deliberately not containerized in this approach.
- **`openid-client` requires HTTPS by default**: `client.discovery()` throws `"only requests to
  HTTPS are allowed"` unless `{ execute: [client.allowInsecureRequests] }` is passed. This whole demo
  stack runs over plain HTTP (no TLS termination configured anywhere in `deploy/`), so
  `getDexConfig()` opts in to insecure requests outside of `NODE_ENV=production`.
- **Oathkeeper's `authproxy` header check happens on `/dex/callback/{connector}`, not
  `/dex/auth/{connector}`** — re-reading `server/handlers.go` more carefully: `handleConnectorLogin`
  (serving `/auth/{connector}`) only creates the `AuthRequest` and redirects to `/callback/{connector}`;
  it is `handleConnectorCallback` (serving `/callback/{connector}`) that actually calls
  `conn.HandleCallback()` and reads the trusted `X-Remote-*` headers. The original Oathkeeper rule
  put the `cookie_session` check and header injection on `/dex/auth<**>`, which is exactly backwards
  — it needed to be on `/dex/callback<**>` instead. `/dex/auth`, `/dex/token`, `/dex/keys`,
  `/dex/userinfo`, and `/dex/.well-known/*` are all now separate passthrough rules (`noop`
  authenticator/mutator) since none of them read the trusted headers and none of them carry a
  browser cookie when called server-to-server. (Oathkeeper's glob matching strategy also doesn't
  support pipe-alternation inside a `<...>` wildcard, e.g. `<well-known|token|keys>` — each passthrough
  path needed its own rule.)
- **`request.nextUrl` is not a plain `URL` instance** — Next.js's `NextRequest.nextUrl` is a `NextURL`
  subclass; `openid-client`'s `authorizationCodeGrant()` does a strict `instanceof URL` check and
  throws `TypeError: "currentUrl" must be an instance of URL, or Request` when handed a `NextURL`.
  Fixed by passing `new URL(request.url)` instead of `request.nextUrl` from
  `app/api/auth/callback/route.ts`.

With all four fixed, a real user-registration-through-Kratos → Dex `authproxy` → Oathkeeper header
injection → token exchange → session-cookie → Welcome-page-greeting round trip was driven entirely
through the app's own route handlers (not simulated) and produced `Hello, {registered display
name}` on the Welcome page — this is what T023's checkpoint should be understood to mean going
forward, and what T023a's Playwright-run-against-a-live-stack task still needs to formalize into a
repeatable automated check.

## 4. Infrastructure for Docker Compose

**Decision**: Postgres for Kratos's identity store (Ory's own quickstart pattern); SQLite (file-backed)
for Dex's storage (clients, auth requests, refresh tokens) — adequate for a simple/demo-scale
deployment; a local SMTP catcher (MailSlurper/MailHog) for capturing recovery/verification emails in
development, matching Ory's own docker-compose quickstart pattern.

**Rationale**: Reuses each project's own documented quickstart shape rather than inventing a new
topology, and avoids running two Postgres instances for a "simple app" (Principle V). Recovery
(forgot-password) cannot be demonstrated end-to-end without some mail sink, so one is required, not
optional.

**Alternatives considered**: SQLite for Kratos too — rejected; Kratos's own docs recommend Postgres
for anything beyond a pure default that ships with a mail catcher already; a real SMTP server —
rejected as unnecessary for local/demo use.

## 5. Testing stack

**Decision**: **Vitest** + React Testing Library for unit/component tests (session cookie
encode/decode, refresh-decision logic, form rendering); **Playwright** for end-to-end scenarios
(login → Welcome page, silent refresh, cross-tab login/logout notifications) driven against the full
Docker Compose stack.

**Rationale**: Vitest is the current idiomatic choice for Next.js/TypeScript unit tests (fast, ESM-native).
Playwright is needed because the acceptance scenarios span real redirects across three services
(Next.js, Oathkeeper/Dex, Kratos) and multi-tab browser behavior (`BroadcastChannel`), which unit
tests cannot exercise.

## 6. Cross-tab login/logout notification

**Decision**: Use the browser `BroadcastChannel` API (with a `localStorage` event fallback for older
engines) to notify other open tabs when a session is created or invalidated, surfaced as a
non-blocking pop-up/toast prompting the user to refresh or continue.

**Rationale**: Native browser API, zero new dependencies, works purely client-side and requires no
server push mechanism — the simplest mechanism that satisfies the requirement.

**Alternatives considered**: Server-Sent Events/WebSocket push — rejected as unnecessary
infrastructure for a same-browser, same-origin, multi-tab notification that `BroadcastChannel`
already solves directly.
