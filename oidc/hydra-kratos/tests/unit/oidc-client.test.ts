// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodePkceCookie,
  encodePkceCookie,
  generatePkceParams,
  OIDC_SCOPES,
} from "@/app/lib/oidc-client";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789ab";
});

describe("OIDC_SCOPES", () => {
  it("requests offline_access, since Hydra (unlike Dex's authproxy connector) can issue a refresh_token for it", () => {
    expect(OIDC_SCOPES.split(" ")).toContain("offline_access");
  });
});

describe("generatePkceParams", () => {
  it("generates a code_verifier, code_challenge, state, and nonce", async () => {
    const pkce = await generatePkceParams();
    expect(pkce.codeVerifier).toBeTypeOf("string");
    expect(pkce.codeVerifier.length).toBeGreaterThan(0);
    expect(pkce.codeChallenge).toBeTypeOf("string");
    expect(pkce.state).toBeTypeOf("string");
    expect(pkce.nonce).toBeTypeOf("string");
  });

  it("generates unique values on each call", async () => {
    const a = await generatePkceParams();
    const b = await generatePkceParams();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

describe("PKCE transient cookie round-trip", () => {
  it("encodes and decodes the pkce params plus return_to", async () => {
    const pkce = await generatePkceParams();
    const returnTo = "/some/protected/path";

    const cookieValue = await encodePkceCookie({ ...pkce, returnTo });
    expect(cookieValue).toBeTypeOf("string");

    const decoded = await decodePkceCookie(cookieValue);
    expect(decoded).toEqual({
      codeVerifier: pkce.codeVerifier,
      state: pkce.state,
      nonce: pkce.nonce,
      returnTo,
    });
  });

  it("defaults returnTo to undefined when not provided", async () => {
    const pkce = await generatePkceParams();
    const cookieValue = await encodePkceCookie({ ...pkce });
    const decoded = await decodePkceCookie(cookieValue);
    expect(decoded?.returnTo).toBeUndefined();
  });

  it("returns null for a tampered cookie value", async () => {
    const pkce = await generatePkceParams();
    const cookieValue = await encodePkceCookie({ ...pkce });
    const tampered = cookieValue.slice(0, -2) + "xx";
    const decoded = await decodePkceCookie(tampered);
    expect(decoded).toBeNull();
  });
});
