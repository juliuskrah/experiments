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

describe("reauthorize failure paths", () => {
  it("returns null when Oathkeeper rejects the invalid/expired Kratos session (redirects to /kratos/login instead of Dex's callback)", async () => {
    const { reauthorize } = await import("@/app/lib/oidc-client");

    const fetchMock = vi
      .fn()
      // Oathkeeper's cookie_session check failed — this is its configured error redirect,
      // not a hop toward our own /api/auth/callback.
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://localhost:3000/kratos/login" },
        }),
      )
      // Kratos's rendered login page — a real HTML response, not a further redirect. This is
      // where the silent flow gives up and correctly reports failure rather than looping.
      .mockResolvedValueOnce(new Response("<html>Kratos login form</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await reauthorize(
      {} as never,
      "http://localhost:3000/api/auth/callback",
      "ory_kratos_session=expired-or-revoked",
    );

    expect(result).toBeNull();
    expect(mockAuthorizationCodeGrant).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns null when the response has no redirect at all", async () => {
    const { reauthorize } = await import("@/app/lib/oidc-client");

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("<html>error page</html>", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await reauthorize({} as never, "http://localhost:3000/api/auth/callback", "ory_kratos_session=x");

    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });

  it("returns null when the final redirect to the callback URI carries an error param", async () => {
    const { reauthorize } = await import("@/app/lib/oidc-client");

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: "http://localhost:3000/api/auth/callback?error=access_denied",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await reauthorize({} as never, "http://localhost:3000/api/auth/callback", "ory_kratos_session=x");

    expect(result).toBeNull();
    expect(mockAuthorizationCodeGrant).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("stops after MAX_REAUTHORIZE_REDIRECTS to avoid retrying indefinitely on a redirect loop", async () => {
    const { reauthorize } = await import("@/app/lib/oidc-client");

    // Every hop redirects to itself — a pathological loop that must not be followed forever.
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://localhost:4455/dex/loop" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await reauthorize({} as never, "http://localhost:3000/api/auth/callback", "ory_kratos_session=x");

    expect(result).toBeNull();
    // Bounded, not unbounded — confirms FR-007's "rather than retrying indefinitely".
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10);
    vi.unstubAllGlobals();
  });
});
