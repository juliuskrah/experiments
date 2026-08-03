# Feature Specification: Authentication with OIDC via Dex + Oathkeeper + Kratos

**Feature Branch**: `[001-oidc-dex-oathkeeper]`

**Created**: 2026-07-31

**Updated**: 2026-08-01 — retitled and revised as "Approach A" of a two-approach architecture comparison; see Known Limitation below.

**Status**: Draft

**Input**: User description: "Authentication with OIDC via Dex, fronted by Ory Oathkeeper, backed by Ory Kratos as the user-management identity store (Approach A of a two-approach comparison). Create a simple app with a login page and a welcome page. When the app is launched in the browser, the welcome page is shown with a greeting and the name of the logged-in user. When the user is not logged-in, redirect to the login page which shows a button for social login (clicking the button triggers the OIDC Authorization Code Flow, brokered through Dex's authproxy connector with Ory Oathkeeper validating the caller's Kratos session and injecting trusted identity headers). Once a user is logged in, sessions should be extended without a login challenge for as long as possible using standard OAuth2 mechanisms."

## Known Limitation (validated 2026-08-01 by hands-on testing against Dex v2.44.0)

Dex's `authproxy` connector does not implement Dex's `RefreshConnector` interface, so Dex never issues
an OAuth `refresh_token` for this connector regardless of requested scope (confirmed by reading
`connector/authproxy/authproxy.go` and `server/oauth2.go` in the Dex v2.44.0 source — the connector
type-assertion that gates refresh-token issuance is always false for `authproxy`). This is an
architectural property of Dex, not a configuration bug.

Consequently, this approach's session-renewal behavior (User Story 3 below) is **not** a
standards-compliant OAuth2 refresh_token grant. Instead, renewal works by silently re-running the
Authorization Code flow — invisible to the user as long as the underlying Kratos browser session
remains valid, because Oathkeeper re-validates that Kratos session on every pass through the
`authproxy` connector. This is the central trade-off this approach is built to demonstrate,
compared against a second, independent app (Ory Hydra + Kratos) that uses a standards-compliant
`refresh_token` grant instead.

## Clarifications

### Session 2026-07-31

- Q: Should a user's session end automatically after a period of inactivity, even if their refresh token would otherwise still be valid? → A: No idle timeout — the refresh token's own validity is the only limit on session life.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-time login via social identity provider (Priority: P1)

A visitor opens the app for the first time without an existing session. They are redirected to the Login page, click the social login button, complete authorization with their social identity provider, and land on the Welcome page addressed by name.

**Why this priority**: This is the entry point for every user of the app. Without it, no one can reach the Welcome page at all — it is the minimum viable slice.

**Independent Test**: Can be fully tested by opening the app with no session, verifying redirection to the Login page, clicking the social login button, completing authorization, and confirming the Welcome page shows a greeting with the user's name.

**Acceptance Scenarios**:

1. **Given** no active session, **When** the app is opened in the browser, **Then** the user is redirected to the Login page.
2. **Given** the user is on the Login page, **When** they click the social login button, **Then** they are taken through the identity provider's authorization step.
3. **Given** the user successfully authorizes with the identity provider, **When** they are returned to the app, **Then** the Welcome page is shown with a greeting that includes their name.
4. **Given** the user is on the Login page, **When** they cancel or deny authorization at the identity provider, **Then** they are returned to the Login page and can retry.

---

### User Story 2 - Returning with an active session (Priority: P1)

A user who already has an active session opens the app and lands directly on the Welcome page without being asked to log in again.

**Why this priority**: Skipping a redundant login step for an already-authenticated user is core to the described experience ("welcome page is shown with a greeting") and is independently verifiable and valuable on its own.

**Independent Test**: Can be fully tested by opening the app with a valid existing session and confirming the Welcome page is shown immediately, with no Login page redirect.

**Acceptance Scenarios**:

1. **Given** an active, valid session, **When** the app is opened in the browser, **Then** the Welcome page is shown immediately with a greeting that includes the user's name.

---

### User Story 3 - Silent session extension on token expiry (Priority: P2)

While a user is using the app, their access token expires. The session is transparently extended
as long as the user's underlying identity-provider session is still active, and the user continues
without being interrupted by a login prompt. (See Known Limitation above: this approach achieves
this via silent re-authorization against the still-valid Kratos session, not an OAuth2
`refresh_token` grant — that distinction is itself the subject of this approach's comparison
against Approach B.)

**Why this priority**: This delivers the "stay logged in" experience described in the request. It builds on Story 1/2 (a session must first exist) but is independently testable by simulating token expiry against an existing session.

**Independent Test**: Can be fully tested by establishing a session, forcing the access token to expire, performing an action that requires authentication, and confirming the session is renewed automatically with no login challenge shown.

**Acceptance Scenarios**:

1. **Given** an active session whose access token has expired but whose underlying identity-provider session is still valid, **When** the user continues using the app, **Then** the session is renewed automatically and the user is not shown a login challenge.
2. **Given** an active session whose underlying identity-provider session has expired or been revoked, **When** the access token subsequently expires, **Then** the user is redirected to the Login page to re-authenticate.

---

### Edge Cases

- What happens when the identity provider returns an error during authorization (e.g., outage, misconfiguration)? The Login page must show a clear message and allow the user to retry.
- What happens when the user's name is not provided by the identity provider? The Welcome page must fall back to another identifying value (e.g., email) rather than showing a broken greeting.
- What happens when a user opens multiple tabs and logs out or their session is revoked in one? Other tabs must not continue to display authenticated content indefinitely — the next action requiring authentication must re-check session validity.
- What happens if the refresh attempt itself fails due to a transient network error rather than an invalid/revoked token? The system should retry before falling back to a login redirect, rather than immediately ending the session.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST show the Welcome page, including a greeting containing the logged-in user's name, whenever a valid session exists.
- **FR-002**: System MUST redirect any user without a valid session to the Login page.
- **FR-003**: The Login page MUST present a button that, when clicked, initiates login via a social identity provider using the OIDC Authorization Code Flow.
- **FR-004**: System MUST establish an authenticated session upon successful completion of the authorization flow and return the user to the Welcome page.
- **FR-005**: System MUST return the user to the Login page, with the option to retry, if the user cancels or denies authorization, or if the identity provider returns an error.
- **FR-006**: System MUST automatically renew an expiring/expired session by silently re-running the authorization flow, without presenting a login challenge to the user, as long as the user's underlying Kratos session remains valid. No separate inactivity-based timeout applies — the Kratos session's own validity is the only limit on session life. (Known Limitation: not a standards-compliant OAuth2 `refresh_token` grant — see above.)
- **FR-007**: System MUST redirect the user to the Login page to re-authenticate when the underlying Kratos session is invalid, expired, or revoked.
- **FR-008**: System MUST NOT display any authenticated user content on the Welcome page (or elsewhere) without first verifying an active, valid session.

### Key Entities

- **User**: A person who authenticates through a social identity provider; identified within the app primarily by a display name (with a fallback identifier if the name is unavailable).
- **Session**: Represents a user's authenticated state in the app; tracks whether it is currently valid, and is extended over time via silent re-authorization against the underlying Kratos session until that session lapses or is revoked.
- **Identity Provider Connection**: Represents the relationship between the app and the external social identity provider used to authenticate a user, including the authorization and token exchange steps of the OIDC Authorization Code Flow.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can go from opening the app to seeing their personalized Welcome page in under 30 seconds, including identity provider authorization.
- **SC-002**: 100% of returning users with a valid session see the Welcome page directly, with zero unnecessary login redirects.
- **SC-003**: Users never see a login prompt solely because their access token expired, as long as their underlying Kratos session remains valid — session renewal is invisible to the user in at least 99% of such cases.
- **SC-004**: When a session truly ends (underlying Kratos session expired/revoked), 100% of affected users are cleanly redirected to the Login page rather than seeing an error page or stuck state.

## Assumptions

- The app targets a standard web browser experience; native mobile app support is out of scope for this feature.
- No explicit logout capability was requested; it is out of scope for this feature and may be addressed separately.
- The identity provider issues a name (or equivalent display attribute) for most users; a fallback identifier (e.g., email) covers the remaining cases.
- Session state is maintained via a browser-persisted mechanism (e.g., cookie or equivalent) so that reloading or reopening the app within the session lifetime does not require re-authentication.
- Standard web session security practices apply (e.g., secure, non-guessable session identifiers); detailed token storage mechanics are an implementation concern for the planning phase, not this specification.
- The Login page offers a single social identity provider option; supporting a choice of multiple providers is out of scope unless a future revision requires it.
- Session extension via silent re-authorization may continue indefinitely as long as the underlying Kratos session remains active; no fixed absolute session lifetime cap is imposed by this feature beyond Kratos's own configured session lifespan (per constitutional guidance, lifetimes/revocation still apply and will be explicitly configured during planning).
- This app is one of two independent, architecturally distinct implementations of the same user-facing behavior, built for side-by-side comparison. It lives in the `dex-oathkeeper-kratos/` subdirectory of a monorepo; the counterpart ("Approach B", Ory Hydra + Kratos, standards-compliant `refresh_token` grant) lives in a sibling subdirectory and has its own feature spec.
