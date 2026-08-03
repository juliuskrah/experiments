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

describe("GET /api/auth/session — refresh attempt with an invalid/expired/revoked refresh token", () => {
  it("clears the session rather than retrying indefinitely when Hydra rejects the refresh token", async () => {
    const { encodeSession } = await import("@/app/lib/session");

    const past = Math.floor(Date.now() / 1000) - 3600;
    const staleSessionCookie = await encodeSession({
      accessToken: "stale-access-token",
      refreshToken: "revoked-refresh-token",
      idTokenClaims: { sub: "user-1", email: "alice@example.com", exp: past, iat: past - 3600 },
      accessTokenExpiresAt: past,
      createdAt: past - 3600,
    });

    mockRefreshTokenGrant.mockRejectedValue(new Error("invalid_grant"));

    const { GET } = await import("@/app/api/auth/session/route");
    const request = new NextRequest("http://localhost:3000/api/auth/session", {
      headers: { cookie: `session=${staleSessionCookie}` },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(body).toEqual({ authenticated: false });
    expect(response.cookies.get("session")?.value).toBe("");
  });
});
