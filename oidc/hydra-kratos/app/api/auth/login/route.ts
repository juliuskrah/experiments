import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizationUrl,
  encodePkceCookie,
  generatePkceParams,
  getHydraConfig,
  PKCE_COOKIE_MAX_AGE_SECONDS,
  PKCE_COOKIE_NAME,
  sanitizeReturnTo,
} from "@/app/lib/oidc-client";

export async function GET(request: NextRequest) {
  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("return_to"));
  const pkce = await generatePkceParams();
  const config = await getHydraConfig();

  const redirectUri = new URL("/api/auth/callback", request.url).toString();
  const authorizationUrl = buildAuthorizationUrl(config, redirectUri, pkce);

  const pkceCookie = await encodePkceCookie({ ...pkce, returnTo });

  const response = NextResponse.redirect(authorizationUrl, 302);
  response.cookies.set(PKCE_COOKIE_NAME, pkceCookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: PKCE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
