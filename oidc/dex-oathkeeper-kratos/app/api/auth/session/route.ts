import { NextRequest, NextResponse } from "next/server";
import { logAuditEvent } from "@/app/lib/audit-log";
import { getDexConfig, isAccessTokenExpired, reauthorize } from "@/app/lib/oidc-client";
import { encodeSession, decodeSession, sessionFromClaims, SESSION_COOKIE_NAME } from "@/app/lib/session";

const KRATOS_SESSION_COOKIE_NAME = "ory_kratos_session";

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

  // Access token expired — silently re-authorize against Dex/Oathkeeper using the browser's
  // Kratos session cookie, instead of an OAuth refresh grant (research.md §3, revised; FR-006).
  const kratosCookie = request.cookies.get(KRATOS_SESSION_COOKIE_NAME)?.value;
  const config = kratosCookie ? await getDexConfig() : null;
  const tokens =
    config && kratosCookie
      ? await reauthorize(
          config,
          new URL("/api/auth/callback", request.url).toString(),
          `${KRATOS_SESSION_COOKIE_NAME}=${kratosCookie}`,
        )
      : null;

  if (!tokens) {
    // Underlying Kratos session invalid/expired/revoked, or the re-authorization attempt
    // otherwise failed — no active session (FR-007).
    logAuditEvent({
      type: "reauthorization_failure",
      reason: kratosCookie ? "reauthorization_flow_failed" : "no_kratos_session_cookie",
    });
    logAuditEvent({ type: "session_terminated", reason: "reauthorization_failed", sub: session.idTokenClaims.sub });
    const response = NextResponse.json({ authenticated: false });
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  const { sub, email } = tokens.idTokenClaims;
  if (typeof sub !== "string" || typeof email !== "string") {
    logAuditEvent({ type: "reauthorization_failure", reason: "missing_claims" });
    logAuditEvent({ type: "session_terminated", reason: "missing_claims", sub: session.idTokenClaims.sub });
    const response = NextResponse.json({ authenticated: false });
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
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

  logAuditEvent({ type: "reauthorization_success", sub, email });

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
