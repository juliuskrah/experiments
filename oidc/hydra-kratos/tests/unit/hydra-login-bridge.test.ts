// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetLoginRequest = vi.fn();
const mockAcceptLoginRequest = vi.fn();

vi.mock("@/app/lib/hydra-admin", () => ({
  getLoginRequest: (...args: unknown[]) => mockGetLoginRequest(...args),
  acceptLoginRequest: (...args: unknown[]) => mockAcceptLoginRequest(...args),
}));

beforeEach(() => {
  mockGetLoginRequest.mockReset();
  mockAcceptLoginRequest.mockReset();
  vi.unstubAllGlobals();
  process.env.KRATOS_PUBLIC_URL = "http://localhost:4433";
});

describe("GET /hydra/login", () => {
  it("returns 400 when login_challenge is missing", async () => {
    const { GET } = await import("@/app/hydra/login/route");
    const response = await GET(new NextRequest("http://localhost:3000/hydra/login"));
    expect(response.status).toBe(400);
    expect(mockGetLoginRequest).not.toHaveBeenCalled();
  });

  it("accepts immediately with the existing subject when Hydra reports skip: true", async () => {
    mockGetLoginRequest.mockResolvedValue({ skip: true, subject: "user-1" });
    mockAcceptLoginRequest.mockResolvedValue({ redirect_to: "http://localhost:4444/oauth2/auth?consent=1" });

    const { GET } = await import("@/app/hydra/login/route");
    const response = await GET(new NextRequest("http://localhost:3000/hydra/login?login_challenge=abc"));

    expect(mockAcceptLoginRequest).toHaveBeenCalledWith("abc", { subject: "user-1" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:4444/oauth2/auth?consent=1");
  });

  it("accepts with remember/rememberFor when skip is false but a valid Kratos session cookie is present", async () => {
    mockGetLoginRequest.mockResolvedValue({ skip: false, subject: "" });
    mockAcceptLoginRequest.mockResolvedValue({ redirect_to: "http://localhost:4444/oauth2/auth?consent=1" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ identity: { id: "user-1" } }), { status: 200 }),
      ),
    );

    const { GET } = await import("@/app/hydra/login/route");
    const request = new NextRequest("http://localhost:3000/hydra/login?login_challenge=abc", {
      headers: { cookie: "ory_kratos_session=valid-session" },
    });
    const response = await GET(request);

    expect(mockAcceptLoginRequest).toHaveBeenCalledWith("abc", {
      subject: "user-1",
      remember: true,
      rememberFor: 24 * 60 * 60,
    });
    expect(response.status).toBe(302);
  });

  it("redirects to /kratos/login with a return_to resuming this challenge when there is no Kratos session cookie", async () => {
    mockGetLoginRequest.mockResolvedValue({ skip: false, subject: "" });

    const { GET } = await import("@/app/hydra/login/route");
    const response = await GET(new NextRequest("http://localhost:3000/hydra/login?login_challenge=abc"));

    expect(mockAcceptLoginRequest).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/kratos/login");
    expect(location.searchParams.get("return_to")).toBe("/hydra/login?login_challenge=abc");
  });

  it("redirects to /kratos/login when the Kratos session cookie is present but whoami rejects it", async () => {
    mockGetLoginRequest.mockResolvedValue({ skip: false, subject: "" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    const { GET } = await import("@/app/hydra/login/route");
    const request = new NextRequest("http://localhost:3000/hydra/login?login_challenge=abc", {
      headers: { cookie: "ory_kratos_session=expired-or-invalid" },
    });
    const response = await GET(request);

    expect(mockAcceptLoginRequest).not.toHaveBeenCalled();
    expect(new URL(response.headers.get("location")!).pathname).toBe("/kratos/login");
  });
});
