// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthorizationCodeGrant = vi.fn();

vi.mock("openid-client", async () => {
  const actual = await vi.importActual<typeof import("openid-client")>("openid-client");
  return {
    ...actual,
    buildAuthorizationUrl: () => new URL("http://localhost:4455/dex/auth?state=xyz"),
    authorizationCodeGrant: (...args: unknown[]) => mockAuthorizationCodeGrant(...args),
  };
});

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789ab";
});

beforeEach(() => {
  mockAuthorizationCodeGrant.mockReset();
});

describe("reauthorize", () => {
  it("follows redirects with the forwarded Kratos cookie and exchanges the code on reaching the callback URI", async () => {
    const { reauthorize } = await import("@/app/lib/oidc-client");

    const fetchMock = vi
      .fn()
      // Dex /auth -> authproxy connector
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://localhost:4455/dex/auth/kratos-authproxy?state=xyz" },
        }),
      )
      // authproxy connector -> Dex callback
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://localhost:4455/dex/callback/kratos-authproxy?state=xyz" },
        }),
      )
      // Dex callback -> our own /api/auth/callback with a code
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "http://localhost:3000/api/auth/callback?code=abc123&state=xyz",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    mockAuthorizationCodeGrant.mockResolvedValue({
      access_token: "new-access-token",
      claims: () => ({ sub: "user-1", email: "alice@example.com", exp: 9999999999, iat: 1 }),
      expiresIn: () => 3600,
    });

    const result = await reauthorize(
      {} as never,
      "http://localhost:3000/api/auth/callback",
      "ory_kratos_session=valid-session-cookie",
    );

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe("new-access-token");
    expect(result?.idTokenClaims.sub).toBe("user-1");

    // Every hop must forward the Kratos session cookie so Oathkeeper's cookie_session check
    // approves it — this is the entire mechanism silent re-authorization relies on.
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.headers).toMatchObject({ cookie: "ory_kratos_session=valid-session-cookie" });
      expect(init.redirect).toBe("manual");
    }

    vi.unstubAllGlobals();
  });
});
