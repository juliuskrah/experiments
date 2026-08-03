import { NextRequest, NextResponse } from "next/server";
import { logAuditEvent } from "@/app/lib/audit-log";
import { SESSION_EVENT_COOKIE_NAME } from "@/app/lib/broadcast";
import { decodePkceCookie, exchangeAuthorizationCode, getDexConfig, PKCE_COOKIE_NAME } from "@/app/lib/oidc-client";
import { encodeSession, sessionFromClaims, SESSION_COOKIE_NAME } from "@/app/lib/session";

function redirectToLoginWithError(request: NextRequest, reason: string) {
  logAuditEvent({ type: "login_failure", reason });
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", reason);
  const response = NextResponse.redirect(loginUrl, 302);
  response.cookies.delete(PKCE_COOKIE_NAME);
  return response;
}

export async function GET(request: NextRequest) {
  const idpError = request.nextUrl.searchParams.get("error");
  if (idpError) {
    return redirectToLoginWithError(request, idpError);
  }

  const pkceCookie = request.cookies.get(PKCE_COOKIE_NAME)?.value;
  const pkce = pkceCookie ? await decodePkceCookie(pkceCookie) : null;
  if (!pkce) {
    return redirectToLoginWithError(request, "invalid_request");
  }

  const config = await getDexConfig();

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode(config, new URL(request.url), pkce);
  } catch {
    return redirectToLoginWithError(request, "authorization_failed");
  }

  const { sub, email } = tokens.idTokenClaims;
  if (typeof sub !== "string" || typeof email !== "string") {
    return redirectToLoginWithError(request, "missing_claims");
  }

  const now = Math.floor(Date.now() / 1000);
  const session = sessionFromClaims(
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
  const sessionCookie = await encodeSession(session);

  logAuditEvent({ type: "login_success", sub, email });

  const returnTo = pkce.returnTo ?? "/";
  const response = NextResponse.redirect(new URL(returnTo, request.url), 302);
  response.cookies.delete(PKCE_COOKIE_NAME);
  response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  // Readable by client JS (not httpOnly) so SessionNotice can detect a just-completed login and
  // post a "session-created" BroadcastChannel message (US4) — the redirect itself is a server
  // response and cannot touch a browser-only API directly.
  response.cookies.set(SESSION_EVENT_COOKIE_NAME, "created", {
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10,
  });
  return response;
}
