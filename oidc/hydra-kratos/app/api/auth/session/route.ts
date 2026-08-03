import { NextRequest, NextResponse } from "next/server";
import { logAuditEvent } from "@/app/lib/audit-log";
import { getHydraConfig, isAccessTokenExpired, refreshTokens, type TokenResult } from "@/app/lib/oidc-client";
import { encodeSession, decodeSession, sessionFromClaims, SESSION_COOKIE_NAME } from "@/app/lib/session";
import type * as client from "openid-client";

const KRATOS_SESSION_COOKIE_NAME = "ory_kratos_session";

async function isKratosSessionValid(cookieHeader: string | undefined): Promise<boolean> {
  if (!cookieHeader) {
    return false;
  }
  try {
    const response = await fetch(`${process.env.KRATOS_PUBLIC_URL}/sessions/whoami`, {
      headers: { cookie: cookieHeader },
    });
    return response.ok;
  } catch {
    // Network failure talking to Kratos — treated the same as "invalid" (FR-007). This runs
    // BEFORE the refresh grant below, so a Kratos hiccup here never costs an already-rotated,
    // otherwise-still-usable Hydra refresh token.
    return false;
  }
}

// Hydra's `rotation_grace_period: 0s` (deploy/hydra/config.yaml) means only the FIRST refresh
// request for a given refresh token succeeds; a second concurrent request presenting the same
// (already-consumed) token is rejected. Two tabs/requests racing on the same stale session cookie
// would otherwise have one of them clear a perfectly valid session. Coalescing concurrent refresh
// attempts for the same refresh token into a single in-flight Hydra call — and having every
// caller share its result — makes a multi-tab refresh converge on one outcome instead of racing.
const pendingRefreshes = new Map<string, Promise<TokenResult>>();

function refreshTokensCoalesced(config: client.Configuration, refreshToken: string): Promise<TokenResult> {
  const existing = pendingRefreshes.get(refreshToken);
  if (existing) {
    return existing;
  }
  const promise = refreshTokens(config, refreshToken).finally(() => {
    pendingRefreshes.delete(refreshToken);
  });
  pendingRefreshes.set(refreshToken, promise);
  return promise;
}

function clearedSessionResponse(): NextResponse {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = cookie ? await decodeSession(cookie) : null;

  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  const now = Math.floor(Date.now() / 1000);
  if (!isAccessTokenExpired(session.accessTokenExpiresAt, now)) {
    return NextResponse.json({
      authenticated: true,
      displayName: session.idTokenClaims.name ?? null,
      email: session.idTokenClaims.email,
    });
  }

  // Check the underlying Kratos session BEFORE consuming the refresh token (contracts/app-routes.md's
  // note; spec.md Edge Cases, Scenario 5b): a successful Hydra refresh grant does not by itself
  // prove Kratos is still valid, and — because Hydra rotates the refresh token on every use — doing
  // the refresh grant first would mean a transient Kratos failure here discards an already-consumed,
  // now-useless-anyway old token while the fresh rotated one is silently dropped. Checking first
  // means a Kratos hiccup costs nothing: the stale refresh token in the cookie is still untouched.
  const kratosCookie = request.cookies.get(KRATOS_SESSION_COOKIE_NAME)?.value;
  const kratosCookieHeader = kratosCookie ? `${KRATOS_SESSION_COOKIE_NAME}=${kratosCookie}` : undefined;
  if (!(await isKratosSessionValid(kratosCookieHeader))) {
    logAuditEvent({ type: "kratos_session_ended", sub: session.idTokenClaims.sub });
    logAuditEvent({ type: "session_terminated", reason: "kratos_session_ended", sub: session.idTokenClaims.sub });
    return clearedSessionResponse();
  }

  // Perform a standards-compliant OAuth2 refresh-token grant against Hydra's public token
  // endpoint (FR-006; research.md §3). Unlike Approach A, this is a real refresh grant, not a
  // silent re-authorization replay. Coalesced across concurrent requests sharing the same stale
  // refresh token (see refreshTokensCoalesced above).
  let tokens: TokenResult;
  try {
    const config = await getHydraConfig();
    tokens = await refreshTokensCoalesced(config, session.refreshToken);
  } catch {
    // Hydra rejected the refresh token as invalid/expired/revoked (FR-007) — do not retry
    // indefinitely, just clear the session.
    logAuditEvent({ type: "refresh_failure", reason: "hydra_rejected_refresh_token" });
    logAuditEvent({ type: "session_terminated", reason: "refresh_failed", sub: session.idTokenClaims.sub });
    return clearedSessionResponse();
  }

  const { sub, email } = tokens.idTokenClaims;
  if (typeof sub !== "string" || typeof email !== "string") {
    logAuditEvent({ type: "refresh_failure", reason: "missing_claims" });
    logAuditEvent({ type: "session_terminated", reason: "missing_claims", sub: session.idTokenClaims.sub });
    return clearedSessionResponse();
  }

  const newSession = sessionFromClaims(
    {
      sub,
      name: typeof tokens.idTokenClaims.name === "string" ? tokens.idTokenClaims.name : undefined,
      email,
      email_verified: Boolean(tokens.idTokenClaims.email_verified),
      exp: typeof tokens.idTokenClaims.exp === "number" ? tokens.idTokenClaims.exp : now,
      iat: typeof tokens.idTokenClaims.iat === "number" ? tokens.idTokenClaims.iat : now,
    },
    tokens,
    now,
  );
  const sessionCookie = await encodeSession(newSession);

  logAuditEvent({ type: "refresh_success", sub, email });

  const response = NextResponse.json({
    authenticated: true,
    displayName: newSession.idTokenClaims.name ?? null,
    email: newSession.idTokenClaims.email,
  });
  response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
