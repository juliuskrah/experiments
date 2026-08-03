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

describe("GET /api/auth/session — expired access token + valid refresh token", () => {
  it("performs a refresh_token grant against Hydra, re-checks the Kratos session, and establishes a fresh Session with the rotated refresh token", async () => {
    const { encodeSession } = await import("@/app/lib/session");

    const past = Math.floor(Date.now() / 1000) - 3600;
    const staleSessionCookie = await encodeSession({
      accessToken: "stale-access-token",
      refreshToken: "old-refresh-token",
      idTokenClaims: { sub: "user-1", email: "alice@example.com", exp: past, iat: past - 3600 },
      accessTokenExpiresAt: past,
      createdAt: past - 3600,
    });

    mockRefreshTokenGrant.mockResolvedValue({
      access_token: "new-access-token",
      refresh_token: "rotated-refresh-token",
      claims: () => ({ sub: "user-1", email: "alice@example.com", exp: 9999999999, iat: 1 }),
      expiresIn: () => 3600,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    const { GET } = await import("@/app/api/auth/session/route");
    const request = new NextRequest("http://localhost:3000/api/auth/session", {
      headers: { cookie: `session=${staleSessionCookie}; ory_kratos_session=still-valid` },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(mockRefreshTokenGrant).toHaveBeenCalledWith(expect.anything(), "old-refresh-token");
    expect(body).toEqual({ authenticated: true, displayName: null, email: "alice@example.com" });

    const newCookie = response.cookies.get("session")?.value;
    expect(newCookie).toBeDefined();
    const { decodeSession } = await import("@/app/lib/session");
    const newSession = await decodeSession(newCookie!);
    expect(newSession?.refreshToken).toBe("rotated-refresh-token");
    expect(newSession?.accessToken).toBe("new-access-token");
  });
});
