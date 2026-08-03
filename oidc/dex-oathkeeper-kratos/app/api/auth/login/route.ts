import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizationUrl,
  encodePkceCookie,
  generatePkceParams,
  getDexConfig,
  PKCE_COOKIE_MAX_AGE_SECONDS,
  PKCE_COOKIE_NAME,
} from "@/app/lib/oidc-client";

export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("return_to") ?? undefined;
  const pkce = await generatePkceParams();
  const config = await getDexConfig();

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
