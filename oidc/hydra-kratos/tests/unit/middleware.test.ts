// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// This test exercises middleware.ts's own session-cookie auth-gate decision, not
// @ory/nextjs's /self-service/* proxy branch (that's a separate integration concern covered by
// research.md §8 and the quickstart.md manual scenarios). Stubbing it out also avoids
// @ory/nextjs/middleware's `import ... from "next/server"` (no extension), which Vite's ESM
// resolver cannot follow outside Next.js's own build pipeline.
vi.mock("@ory/nextjs/middleware", () => ({
  createOryMiddleware: () => () => NextResponse.next(),
}));

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789ab";
});

describe("middleware", () => {
  it("redirects to /login with return_to when no session cookie is present", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("http://localhost:3000/some/protected/path?x=1");
    const response = await middleware(request);
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("return_to")).toBe("/some/protected/path?x=1");
  });

  it("redirects to /login when the session cookie is present but invalid", async () => {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest("http://localhost:3000/", {
      headers: { cookie: "session=not-a-valid-token" },
    });
    const response = await middleware(request);
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("passes the request through unchanged when the session cookie is valid", async () => {
    const { encodeSession } = await import("@/app/lib/session");
    const { middleware } = await import("@/middleware");
    const now = Math.floor(Date.now() / 1000);
    const cookieValue = await encodeSession({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idTokenClaims: { sub: "user-1", email: "alice@example.com", exp: now + 3600, iat: now },
      accessTokenExpiresAt: now + 3600,
      createdAt: now,
    });
    const request = new NextRequest("http://localhost:3000/", {
      headers: { cookie: `session=${cookieValue}` },
    });
    const response = await middleware(request);
    // NextResponse.next() sets the special x-middleware-next header rather than a location.
    expect(response.headers.get("location")).toBeNull();
  });
});
