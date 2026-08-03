# Feature Specification: Authentication with OIDC via Hydra + Kratos

**Feature Branch**: `[002-oidc-hydra-kratos]`

**Created**: 2026-08-01

**Status**: Draft

**Input**: User description: "Authentication with OIDC via Ory Hydra as a standards-compliant OAuth2/OIDC provider, with Ory Kratos as the sole identity/session source of truth (Approach B of a two-approach comparison, counterpart to Approach A which uses Dex+Oathkeeper). Create a simple app with a login page and a welcome page. When the app is launched in the browser, the welcome page is shown with a greeting and the name of the logged-in user. When the user is not logged-in, redirect to the login page which shows a button for social login (clicking the button triggers the OIDC Authorization Code Flow against Hydra). Hydra has no built-in user store, so it delegates login/consent decisions via its Admin API to a login-consent bridge that checks the caller's Kratos browser session; Kratos remains the sole source of truth for user identity. Once a user is logged in, sessions MUST be extended via a standards-compliant OAuth2 refresh_token grant (offline_access scope), with no visible login challenge shown to the user as long as the refresh token remains valid, matching the originally-intended behavior that Approach A could not achieve because Dex's authproxy connector does not support refresh tokens. Additional stated end goal driving this comparison: prove an architecture where user management is decoupled from both the OIDC provider and the resource server — the OIDC provider (Hydra) extends the user-management service (Kratos) with OIDC capability, and the resource server (this Next.js app) will eventually extend Kratos with app-specific user preferences (not yet defined, out of scope for this feature) rather than owning identity itself."

## Relationship to Approach A

This is "Approach B" of a two-approach architecture comparison. Approach A (Dex + Oathkeeper + Kratos,
see the sibling feature spec) discovered — via hands-on testing — that its OIDC provider component
cannot issue standards-compliant OAuth2 refresh tokens regardless of configuration. This feature exists
to demonstrate the same user-facing behavior using an OIDC provider component that supports refresh
tokens natively, so the two can be compared side by side on that specific dimension, while both keep
the same identity/session source of truth (Kratos) and the same decoupling goal (identity/user
management is owned by neither the OIDC provider nor the resource server/app).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-time login via social identity provider (Priority: P1)

A visitor opens the app for the first time without an existing session. They are redirected to the
Login page, click the social login button, complete authorization, and land on the Welcome page
addressed by name.

**Why this priority**: This is the entry point for every user of the app. Without it, no one can
reach the Welcome page at all — it is the minimum viable slice.

**Independent Test**: Can be fully tested by opening the app with no session, verifying redirection to
the Login page, clicking the social login button, completing authorization, and confirming the
Welcome page shows a greeting with the user's name.

**Acceptance Scenarios**:

1. **Given** no active session, **When** the app is opened in the browser, **Then** the user is
   redirected to the Login page.
2. **Given** the user is on the Login page, **When** they click the social login button, **Then**
   they are taken through the identity provider's authorization step.
3. **Given** the user successfully authorizes, **When** they are returned to the app, **Then** the
   Welcome page is shown with a greeting that includes their name.
4. **Given** the user is on the Login page, **When** they cancel or deny authorization, **Then** they
   are returned to the Login page and can retry.

---

### User Story 2 - Returning with an active session (Priority: P1)

A user who already has an active session opens the app and lands directly on the Welcome page
without being asked to log in again.

**Why this priority**: Skipping a redundant login step for an already-authenticated user is core to
the described experience and is independently verifiable and valuable on its own.

**Independent Test**: Can be fully tested by opening the app with a valid existing session and
confirming the Welcome page is shown immediately, with no Login page redirect.

**Acceptance Scenarios**:

1. **Given** an active, valid session, **When** the app is opened in the browser, **Then** the
   Welcome page is shown immediately with a greeting that includes the user's name.

---

### User Story 3 - Silent session extension on token expiry (Priority: P2)

While a user is using the app, their access token expires. The session is transparently extended
using a standards-compliant OAuth2 refresh token, and the user continues without being interrupted by
a login prompt.

**Why this priority**: This delivers the "stay logged in" experience described in the request, using
a portable, spec-compliant mechanism rather than an implementation-specific workaround. It builds on
Story 1/2 (a session must first exist) but is independently testable by simulating token expiry
against an existing session.

**Independent Test**: Can be fully tested by establishing a session, forcing the access token to
expire, performing an action that requires authentication, and confirming the session is renewed
automatically with no login challenge shown.

**Acceptance Scenarios**:

1. **Given** an active session whose access token has expired but whose refresh token is still
   valid, **When** the user continues using the app, **Then** the session is renewed automatically
   using the refresh token and the user is not shown a login challenge.
2. **Given** an active session whose refresh token has expired, been revoked, or been rejected by the
   identity provider, **When** the access token subsequently expires, **Then** the user is redirected
   to the Login page to re-authenticate.

---

### Edge Cases

- What happens when the identity provider returns an error during authorization (e.g., outage,
  misconfiguration)? The Login page must show a clear message and allow the user to retry.
- What happens when the user's name is not provided by the identity provider? The Welcome page must
  fall back to another identifying value (e.g., email) rather than showing a broken greeting.
- What happens when a user opens multiple tabs and logs out or their session is revoked in one? Other
  tabs must not continue to display authenticated content indefinitely — the next action requiring
  authentication must re-check session validity.
- What happens if the refresh attempt itself fails due to a transient network error rather than an
  invalid/revoked token? The system should retry before falling back to a login redirect, rather than
  immediately ending the session.
- What happens if the underlying identity session (the one the login step delegates to) ends or is
  revoked independently of the refresh token's own validity? The next refresh or login-challenge
  check must detect this and redirect to the Login page rather than issuing a token against a
  identity that no longer has a valid session.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST show the Welcome page, including a greeting containing the logged-in
  user's name, whenever a valid session exists.
- **FR-002**: System MUST redirect any user without a valid session to the Login page.
- **FR-003**: The Login page MUST present a button that, when clicked, initiates login via a social
  identity provider using the OIDC Authorization Code Flow.
- **FR-004**: System MUST establish an authenticated session upon successful completion of the
  authorization flow and return the user to the Welcome page.
- **FR-005**: System MUST return the user to the Login page, with the option to retry, if the user
  cancels or denies authorization, or if the identity provider returns an error.
- **FR-006**: System MUST automatically renew an expiring/expired session using a standards-compliant
  OAuth2 refresh token, without presenting a login challenge to the user, as long as the refresh
  token remains valid. No separate inactivity-based timeout applies — the refresh token's own
  validity (and the continued validity of the identity it was issued for) is the limit on session
  life.
- **FR-007**: System MUST redirect the user to the Login page to re-authenticate when the refresh
  token is invalid, expired, or revoked, or when the identity it was issued for no longer has a valid
  session.
- **FR-008**: System MUST NOT display any authenticated user content on the Welcome page (or
  elsewhere) without first verifying an active, valid session.
- **FR-009**: The identity/user-management responsibility MUST be owned by a single, dedicated
  service that is shared by (and decoupled from) both the OIDC provider and the app itself — neither
  the OIDC provider nor the app may act as its own source of truth for user identity.

### Key Entities

- **User**: A person who authenticates through a social identity provider; identified within the app
  primarily by a display name (with a fallback identifier if the name is unavailable). Identity
  records are owned exclusively by the shared user-management service, not by the OIDC provider or
  the app.
- **Session**: Represents a user's authenticated state in the app; tracks whether it is currently
  valid, and is extended over time via a standards-compliant refresh mechanism until it lapses or is
  revoked.
- **Identity Provider Connection**: Represents the relationship between the app and the OIDC/OAuth2
  provider used to authenticate a user, including the authorization and token exchange (and refresh)
  steps of the OIDC Authorization Code Flow. The provider itself has no user store; it defers identity
  decisions to the shared user-management service on every login.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can go from opening the app to seeing their personalized Welcome page in
  under 30 seconds, including identity provider authorization.
- **SC-002**: 100% of returning users with a valid session see the Welcome page directly, with zero
  unnecessary login redirects.
- **SC-003**: Users never see a login prompt solely because their access token expired, as long as
  their refresh token and underlying identity session remain valid — session renewal is invisible to
  the user in at least 99% of such cases.
- **SC-004**: When a session truly ends (refresh token expired/revoked, or underlying identity session
  ended), 100% of affected users are cleanly redirected to the Login page rather than seeing an error
  page or stuck state.
- **SC-005**: The session-renewal mechanism used to satisfy SC-003 is verifiable as a standards
  OAuth2 refresh_token grant (i.e., testable/inspectable as such), not an approach-specific
  workaround.

## Assumptions

- The app targets a standard web browser experience; native mobile app support is out of scope for
  this feature.
- No explicit logout capability was requested; it is out of scope for this feature and may be
  addressed separately.
- The identity provider issues a name (or equivalent display attribute) for most users; a fallback
  identifier (e.g., email) covers the remaining cases.
- Session state is maintained via a browser-persisted mechanism (e.g., cookie or equivalent) so that
  reloading or reopening the app within the session lifetime does not require re-authentication.
- Standard web session security practices apply (e.g., secure, non-guessable session identifiers);
  detailed token storage mechanics are an implementation concern for the planning phase, not this
  specification.
- The Login page offers a single social identity provider option; supporting a choice of multiple
  providers is out of scope unless a future revision requires it.
- Refresh-token-based session extension may continue indefinitely as long as the session remains
  active and the refresh token stays valid; no fixed absolute session lifetime cap is imposed by this
  feature (per constitutional guidance, lifetimes/revocation still apply and will be explicitly
  configured during planning).
- Extending the shared user-management service with app-specific user preferences (mentioned as the
  eventual end goal driving this architecture) is explicitly out of scope for this feature; this
  feature covers only login, session establishment, and session renewal.
- This app is one of two independent, architecturally distinct implementations of the same
  user-facing behavior, built for side-by-side comparison. It lives in the `hydra-kratos/`
  subdirectory of a monorepo; the counterpart ("Approach A", Dex + Oathkeeper + Kratos, which cannot
  achieve FR-006 as a standards-compliant refresh_token grant) lives in a sibling subdirectory and has
  its own feature spec.
