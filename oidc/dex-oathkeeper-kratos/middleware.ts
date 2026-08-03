import { createOryMiddleware } from "@ory/nextjs/middleware";
import { NextRequest, NextResponse } from "next/server";
import { decodeSession, SESSION_COOKIE_NAME } from "@/app/lib/session";

// @ory/elements-react's Login/Registration/Recovery components (rendered under app/kratos/*)
// generate flow-start links pointing at same-origin /self-service/* paths — see
// @ory/nextjs's getFlowFactory (startNewFlow), which builds those URLs against the app's own
// host, not Kratos's. This middleware proxies those requests through to Kratos (ORY_SDK_URL),
// rewriting cookies/headers; without it, /self-service/* 404s/redirects on the app itself and the
// login flow can never resume after Kratos authentication.
const oryMiddleware = createOryMiddleware({});

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/self-service")) {
    return oryMiddleware(request);
  }

  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = cookie ? await decodeSession(cookie) : null;

  if (session) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("return_to", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl, 307);
}

export const config = {
  matcher: [
    "/((?!api/auth|login|kratos|_next/static|_next/image|favicon.ico).*)",
  ],
};
