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

// Regression test: Hydra's `rotation_grace_period: 0s` (deploy/hydra/config.yaml) means the
// SAME refresh token can only be redeemed once — a second concurrent request presenting it would
// normally be rejected by Hydra. Two tabs/requests racing on the same stale session cookie (e.g.
// two tabs open on the Welcome page, both reloading around the same access-token-expiry moment)
// must not have one succeed and one incorrectly clear a perfectly valid session; the route
// coalesces concurrent refreshes for the same refresh token into a single Hydra call.
describe("GET /api/auth/session — concurrent requests refreshing the same stale session", () => {
  it("issues only one refresh_token grant call and both requests see the same rotated session", async () => {
    const { encodeSession } = await import("@/app/lib/session");

    const past = Math.floor(Date.now() / 1000) - 3600;
    const staleSessionCookie = await encodeSession({
      accessToken: "stale-access-token",
      refreshToken: "shared-stale-refresh-token",
      idTokenClaims: { sub: "user-1", email: "alice@example.com", exp: past, iat: past - 3600 },
      accessTokenExpiresAt: past,
      createdAt: past - 3600,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    // Resolve only after both GET calls have had a chance to reach the refresh step, to
    // reproduce two requests racing on the same in-flight refresh.
    let resolveGrant!: (value: unknown) => void;
    mockRefreshTokenGrant.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGrant = resolve;
        }),
    );

    const { GET } = await import("@/app/api/auth/session/route");
    const makeRequest = () =>
      new NextRequest("http://localhost:3000/api/auth/session", {
        headers: { cookie: `session=${staleSessionCookie}; ory_kratos_session=still-valid` },
      });

    const responsePromiseA = GET(makeRequest());
    const responsePromiseB = GET(makeRequest());

    // Let both requests' synchronous-ish work (Kratos check, cache lookup) run before the mocked
    // Hydra call resolves.
    await new Promise((resolve) => setTimeout(resolve, 10));
    resolveGrant({
      access_token: "new-access-token",
      refresh_token: "rotated-refresh-token",
      claims: () => ({ sub: "user-1", email: "alice@example.com", exp: 9999999999, iat: 1 }),
      expiresIn: () => 3600,
    });

    const [responseA, responseB] = await Promise.all([responsePromiseA, responsePromiseB]);
    const [bodyA, bodyB] = await Promise.all([responseA.json(), responseB.json()]);

    expect(mockRefreshTokenGrant).toHaveBeenCalledTimes(1);
    expect(bodyA).toEqual({ authenticated: true, displayName: null, email: "alice@example.com" });
    expect(bodyB).toEqual({ authenticated: true, displayName: null, email: "alice@example.com" });
  });
});
