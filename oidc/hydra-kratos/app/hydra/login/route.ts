import { NextRequest, NextResponse } from "next/server";
import { acceptLoginRequest, getLoginRequest } from "@/app/lib/hydra-admin";

const KRATOS_SESSION_COOKIE_NAME = "ory_kratos_session";
// Bounded by Kratos's own session.lifespan (default 24h) so a Hydra-"remembered" login can never
// outlive the Kratos session it was based on (research.md §5).
const REMEMBER_FOR_SECONDS = 24 * 60 * 60;

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

  const loginRequest = await getLoginRequest(loginChallenge);

  if (loginRequest.skip) {
    const { redirect_to } = await acceptLoginRequest(loginChallenge, {
      subject: loginRequest.subject,
    });
    return NextResponse.redirect(redirect_to, 302);
  }

  const kratosCookie = request.headers.get("cookie") ?? undefined;
  const hasCookie = kratosCookie?.includes(`${KRATOS_SESSION_COOKIE_NAME}=`) ?? false;
  const subject = hasCookie ? await checkKratosSession(kratosCookie) : null;

  if (!subject) {
    const returnTo = `/hydra/login?login_challenge=${encodeURIComponent(loginChallenge)}`;
    const kratosLoginUrl = new URL("/kratos/login", request.url);
    kratosLoginUrl.searchParams.set("return_to", returnTo);
    return NextResponse.redirect(kratosLoginUrl, 302);
  }

  const { redirect_to } = await acceptLoginRequest(loginChallenge, {
    subject,
    remember: true,
    rememberFor: REMEMBER_FOR_SECONDS,
  });
  return NextResponse.redirect(redirect_to, 302);
}
