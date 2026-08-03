# Approach A vs. Approach B: a refresh-token comparison

Two independent Next.js apps in this repository implement the same user-facing behavior — OIDC
login via a social-style "Continue with {provider}" button, backed by Ory Kratos as the sole
identity/session source of truth — through two architecturally different OIDC providers:

- **Approach A** ([`dex-oathkeeper-kratos/`](../dex-oathkeeper-kratos/), spec
  [`001-oidc-dex-oathkeeper`](001-oidc-dex-oathkeeper/)): Dex + Ory Oathkeeper + Ory Kratos.
- **Approach B** ([`hydra-kratos/`](../hydra-kratos/), spec
  [`002-oidc-hydra-kratos`](002-oidc-hydra-kratos/)): Ory Hydra + Ory Kratos, with a custom
  login/consent bridge.

Both were built and verified end-to-end against live Docker Compose stacks. The concrete
difference this comparison exercise set out to observe is refresh-token support.

## The finding

**Dex's `authproxy` connector cannot issue an OAuth2 `refresh_token`.** This was not documented
anywhere obvious — it was discovered by reading `dexidp/dex` v2.44.0 source
(`connector/authproxy/authproxy.go`, `server/oauth2.go`): Dex's server code type-asserts every
connector against `connector.RefreshConnector` before it will issue a refresh token, and
`authproxy` never implements that interface. No configuration flag changes this; it is an
architectural property of the connector, confirmed further by live testing (fetching Dex's real
`/token` response and observing no `refresh_token` field at all).

**Hydra has no such limitation.** Because Hydra is a general-purpose, standards-compliant
OAuth2/OIDC provider (via `ory/fosite`) rather than a connector-based identity broker, it issues a
real `refresh_token` for the `offline_access` scope and rotates it on every use — exactly the
behavior the original design for Approach A assumed before this limitation was found.

## How each approach compensates

| | Approach A (Dex) | Approach B (Hydra) |
|---|---|---|
| Session renewal mechanism | Silent re-authorization: replays the full Authorization Code + PKCE flow server-to-server against Dex/Oathkeeper, forwarding the browser's Kratos session cookie | Standards-compliant OAuth2 `refresh_token` grant against Hydra's public token endpoint |
| Network cost of renewal | 3+ HTTP round-trips per renewal (Dex `/auth` → authproxy connector → Dex callback) | 1 HTTP round-trip (`POST /oauth2/token`) |
| Renewal failure mode | Any hop in the redirect chain failing (bounded by `MAX_REAUTHORIZE_REDIRECTS`) ends the attempt | A single rejected grant (`invalid_grant`) ends the attempt |
| Coupling to the Kratos session | Total and automatic — every renewal *is* a fresh Kratos check, by construction | Decoupled after the initial login: a successful Hydra refresh grant does **not** by itself prove the Kratos session is still valid, since Hydra's refresh-token store is independent of Kratos once the login/consent bridge round-trip is complete |
| Extra work needed for correctness | None — the mechanism can't be correct without checking Kratos, since it *is* the Kratos check | An explicit re-check of Kratos's `/sessions/whoami` on every refresh (not every request), to prevent a session from outliving the Kratos session it was issued for |

The last row is the most interesting asymmetry, and it runs in the *opposite* direction from what
might be assumed: Approach B's more "correct" standards-compliant refresh grant introduces an edge
case Approach A cannot even express, because Approach A has no separate refresh mechanism to
decouple from the Kratos check in the first place. Both apps' quickstart.md documents this as an
explicit test scenario (Approach A's Scenario 5; Approach B's Scenarios 5 and 5b), and both are
covered by Playwright specs run against live stacks.

## Architectural complexity

Approach A needs Ory Oathkeeper as a bridging layer (to turn a validated Kratos session into the
pre-verified headers Dex's `authproxy` connector trusts) but no bridge routes of its own — Dex's
connector does the identity translation. Approach B needs no Oathkeeper-equivalent proxy, but
requires two bridge routes in the app itself (`/hydra/login`, `/hydra/consent`) plus a Kratos
Admin API client, since Hydra has no user store and must be told, on every login and consent
decision, who the user is and whether to proceed.

Net: Approach A trades a real refresh grant for a simpler app (no bridge routes) plus an extra
infrastructure component (Oathkeeper); Approach B trades a real refresh grant *for* two app-level
bridge routes plus a slightly subtler security invariant to maintain (the Kratos-session-ended
re-check) — but achieves the actually-standards-compliant, lower-latency renewal path.

## Everything else, unchanged

Both apps share, essentially unchanged: Kratos self-service login/registration/recovery flows
rendered via `@ory/elements-react` + `@ory/nextjs`; an encrypted (JWE via `jose`) `HttpOnly`
session cookie; the Authorization Code + PKCE flow via `openid-client`; cross-tab session
notifications via `BroadcastChannel` with a `localStorage` fallback; and structured audit logging
with no raw tokens/secrets, per Constitution Principle IV.
