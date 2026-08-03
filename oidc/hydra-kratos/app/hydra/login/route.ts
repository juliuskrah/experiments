import { NextRequest, NextResponse } from "next/server";
import { acceptLoginRequest, getLoginRequest } from "@/app/lib/hydra-admin";

const KRATOS_SESSION_COOKIE_NAME = "ory_kratos_session";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

async function checkKratosSession(cookieHeader: string | undefined): Promise<string | null> {
  if (!cookieHeader) {
    return null;
  }
  const response = await fetch(`${requireEnv("KRATOS_PUBLIC_URL")}/sessions/whoami`, {
    headers: { cookie: cookieHeader },
  });
  if (!response.ok) {
    return null;
  }
  const session = await response.json();
  const identityId = session?.identity?.id;
  return typeof identityId === "string" ? identityId : null;
}

export async function GET(request: NextRequest) {
  const loginChallenge = request.nextUrl.searchParams.get("login_challenge");
  if (!loginChallenge) {
    return NextResponse.json({ error: "missing login_challenge" }, { status: 400 });
  }

  // Validates the challenge exists before doing anything else, but its `skip`/`subject` fields
  // are intentionally never trusted for the accept decision below: Kratos, not Hydra's own
  // remembered-login cookie, is the sole persistent session authority (research.md §5). A
  // "remembered" Hydra login can outlive the Kratos session it was originally based on (e.g.
  // after logout, or an expired/revoked Kratos session) — accepting it blindly on `skip: true`
  // would silently recreate an app session that the identity-session check just invalidated.
  await getLoginRequest(loginChallenge);

  const kratosCookie = request.headers.get("cookie") ?? undefined;
  const hasCookie = kratosCookie?.includes(`${KRATOS_SESSION_COOKIE_NAME}=`) ?? false;
  const subject = hasCookie ? await checkKratosSession(kratosCookie) : null;

  if (!subject) {
    const returnTo = `/hydra/login?login_challenge=${encodeURIComponent(loginChallenge)}`;
    const kratosLoginUrl = new URL("/kratos/login", request.url);
    kratosLoginUrl.searchParams.set("return_to", returnTo);
    return NextResponse.redirect(kratosLoginUrl, 302);
  }

  // No `remember`/`rememberFor`: an independent Hydra-side "remembered login" would let this
  // route skip its own Kratos check on a future request, which is exactly the stale-session gap
  // being fixed here.
  const { redirect_to } = await acceptLoginRequest(loginChallenge, { subject });
  return NextResponse.redirect(redirect_to, 302);
}
