// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRefreshTokenGrant = vi.fn();

vi.mock("openid-client", async () => {
  const actual = await vi.importActual<typeof import("openid-client")>("openid-client");
  return {
    ...actual,
    discovery: async () => ({}) as never,
    refreshTokenGrant: (...args: unknown[]) => mockRefreshTokenGrant(...args),
  };
});

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789ab";
  process.env.HYDRA_ISSUER_URL = "http://localhost:4444";
  process.env.HYDRA_CLIENT_ID = "test-client";
  process.env.HYDRA_CLIENT_SECRET = "test-secret";
  process.env.KRATOS_PUBLIC_URL = "http://localhost:4433";
});

beforeEach(() => {
  mockRefreshTokenGrant.mockReset();
  vi.unstubAllGlobals();
});

// Exercises contracts/app-routes.md's note on the Kratos-session-ended edge case (spec.md Edge
// Cases; quickstart.md Scenario 5b): the underlying Kratos session can end independently of a
// still-nominally-valid Hydra refresh token, since Hydra's refresh-token store is independent of
// Kratos post-bridge. This is the scenario Approach A cannot even express, since it has no
// separate refresh grant to decouple from the Kratos check. The Kratos check runs BEFORE the
// refresh grant (not after) so that this failure mode never consumes/rotates the refresh token
// for nothing — see the comment in app/api/auth/session/route.ts.
describe("GET /api/auth/session — Kratos session ended, Hydra refresh token still nominally valid", () => {
  it("clears the session and never attempts the Hydra refresh grant when Kratos rejects the session", async () => {
    const { encodeSession } = await import("@/app/lib/session");

    const past = Math.floor(Date.now() / 1000) - 3600;
    const staleSessionCookie = await encodeSession({
      accessToken: "stale-access-token",
      refreshToken: "still-valid-refresh-token",
      idTokenClaims: { sub: "user-1", email: "alice@example.com", exp: past, iat: past - 3600 },
      accessTokenExpiresAt: past,
      createdAt: past - 3600,
    });

    // Kratos /sessions/whoami rejects — the underlying Kratos session ended independently of
    // the (still nominally valid, never-yet-used) Hydra refresh token.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    const { GET } = await import("@/app/api/auth/session/route");
    const request = new NextRequest("http://localhost:3000/api/auth/session", {
      headers: { cookie: `session=${staleSessionCookie}; ory_kratos_session=ended-elsewhere` },
    });
    const response = await GET(request);
    const body = await response.json();

    // The refresh token is left untouched — it's never rotated for a session that's about to be
    // discarded anyway.
    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
    expect(body).toEqual({ authenticated: false });
    expect(response.cookies.get("session")?.value).toBe("");
  });

  it("also clears the session when there is no Kratos session cookie at all", async () => {
    const { encodeSession } = await import("@/app/lib/session");

    const past = Math.floor(Date.now() / 1000) - 3600;
    const staleSessionCookie = await encodeSession({
      accessToken: "stale-access-token",
      refreshToken: "still-valid-refresh-token",
      idTokenClaims: { sub: "user-1", email: "alice@example.com", exp: past, iat: past - 3600 },
      accessTokenExpiresAt: past,
      createdAt: past - 3600,
    });

    vi.stubGlobal("fetch", vi.fn());

    const { GET } = await import("@/app/api/auth/session/route");
    const request = new NextRequest("http://localhost:3000/api/auth/session", {
      headers: { cookie: `session=${staleSessionCookie}` },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
    expect(body).toEqual({ authenticated: false });
  });

  it("also clears the session when the Kratos whoami request itself fails (network error), rather than throwing", async () => {
    const { encodeSession } = await import("@/app/lib/session");

    const past = Math.floor(Date.now() / 1000) - 3600;
    const staleSessionCookie = await encodeSession({
      accessToken: "stale-access-token",
      refreshToken: "still-valid-refresh-token",
      idTokenClaims: { sub: "user-1", email: "alice@example.com", exp: past, iat: past - 3600 },
      accessTokenExpiresAt: past,
      createdAt: past - 3600,
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));

    const { GET } = await import("@/app/api/auth/session/route");
    const request = new NextRequest("http://localhost:3000/api/auth/session", {
      headers: { cookie: `session=${staleSessionCookie}; ory_kratos_session=still-valid` },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(mockRefreshTokenGrant).not.toHaveBeenCalled();
    expect(body).toEqual({ authenticated: false });
    expect(response.cookies.get("session")?.value).toBe("");
  });
});
