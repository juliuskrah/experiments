// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodePkceCookie,
  encodePkceCookie,
  generatePkceParams,
  sanitizeReturnTo,
} from "@/app/lib/oidc-client";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789ab";
});

describe("sanitizeReturnTo", () => {
  it("accepts a plain same-origin absolute path", () => {
    expect(sanitizeReturnTo("/some/protected/path")).toBe("/some/protected/path");
  });

  it("preserves query strings and hashes on an accepted path", () => {
    expect(sanitizeReturnTo("/dashboard?tab=billing#section")).toBe("/dashboard?tab=billing#section");
  });

  it("rejects an absolute URL to a different origin", () => {
    expect(sanitizeReturnTo("https://attacker.example")).toBeUndefined();
    expect(sanitizeReturnTo("http://attacker.example/path")).toBeUndefined();
  });

  it("rejects a protocol-relative URL (open-redirect via //host)", () => {
    expect(sanitizeReturnTo("//attacker.example")).toBeUndefined();
    expect(sanitizeReturnTo("///attacker.example")).toBeUndefined();
  });

  it("rejects a backslash-prefixed value some browsers normalize to a protocol-relative URL", () => {
    expect(sanitizeReturnTo("/\\attacker.example")).toBeUndefined();
  });

  it("rejects values that don't start with a single leading slash", () => {
    expect(sanitizeReturnTo("attacker.example")).toBeUndefined();
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects empty, missing, or non-string input", () => {
    expect(sanitizeReturnTo("")).toBeUndefined();
    expect(sanitizeReturnTo(null)).toBeUndefined();
    expect(sanitizeReturnTo(undefined)).toBeUndefined();
  });

  it("accepts the root path", () => {
    expect(sanitizeReturnTo("/")).toBe("/");
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
