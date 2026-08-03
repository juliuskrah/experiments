// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetConsentRequest = vi.fn();
const mockAcceptConsentRequest = vi.fn();
const mockGetKratosIdentityTraits = vi.fn();

vi.mock("@/app/lib/hydra-admin", () => ({
  getConsentRequest: (...args: unknown[]) => mockGetConsentRequest(...args),
  acceptConsentRequest: (...args: unknown[]) => mockAcceptConsentRequest(...args),
  getKratosIdentityTraits: (...args: unknown[]) => mockGetKratosIdentityTraits(...args),
}));

beforeEach(() => {
  mockGetConsentRequest.mockReset();
  mockAcceptConsentRequest.mockReset();
  mockGetKratosIdentityTraits.mockReset();
});

describe("GET /hydra/consent", () => {
  it("returns 400 when consent_challenge is missing", async () => {
    const { GET } = await import("@/app/hydra/consent/route");
    const response = await GET(new NextRequest("http://localhost:3000/hydra/consent"));
    expect(response.status).toBe(400);
    expect(mockGetConsentRequest).not.toHaveBeenCalled();
  });

  it("returns 400 when the consent request has no subject", async () => {
    mockGetConsentRequest.mockResolvedValue({ subject: "" });

    const { GET } = await import("@/app/hydra/consent/route");
    const response = await GET(new NextRequest("http://localhost:3000/hydra/consent?consent_challenge=abc"));

    expect(response.status).toBe(400);
    expect(mockGetKratosIdentityTraits).not.toHaveBeenCalled();
  });

  it("looks up Kratos identity traits and auto-accepts the requested scope with no user-facing screen", async () => {
    mockGetConsentRequest.mockResolvedValue({
      subject: "user-1",
      requested_scope: ["openid", "profile", "email", "offline_access"],
      requested_access_token_audience: [],
    });
    mockGetKratosIdentityTraits.mockResolvedValue({
      email: "grace@example.com",
      name: { first: "Grace", last: "Hopper" },
    });
    mockAcceptConsentRequest.mockResolvedValue({ redirect_to: "http://localhost:4444/oauth2/auth?code=1" });

    const { GET } = await import("@/app/hydra/consent/route");
    const response = await GET(new NextRequest("http://localhost:3000/hydra/consent?consent_challenge=abc"));

    expect(mockGetKratosIdentityTraits).toHaveBeenCalledWith("user-1");
    expect(mockAcceptConsentRequest).toHaveBeenCalledWith("abc", {
      grantScope: ["openid", "profile", "email", "offline_access"],
      grantAccessTokenAudience: [],
      idTokenClaims: { email: "grace@example.com", name: "Grace Hopper" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:4444/oauth2/auth?code=1");
  });

  it("omits the name claim when the identity has no first/last name traits", async () => {
    mockGetConsentRequest.mockResolvedValue({ subject: "user-1", requested_scope: ["openid"] });
    mockGetKratosIdentityTraits.mockResolvedValue({ email: "grace@example.com" });
    mockAcceptConsentRequest.mockResolvedValue({ redirect_to: "http://localhost:4444/oauth2/auth?code=1" });

    const { GET } = await import("@/app/hydra/consent/route");
    await GET(new NextRequest("http://localhost:3000/hydra/consent?consent_challenge=abc"));

    expect(mockAcceptConsentRequest).toHaveBeenCalledWith("abc", {
      grantScope: ["openid"],
      grantAccessTokenAudience: undefined,
      idTokenClaims: { email: "grace@example.com", name: undefined },
    });
  });
});
