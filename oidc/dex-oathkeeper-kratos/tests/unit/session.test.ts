// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeSession,
  displayNameFromSession,
  encodeSession,
  sessionFromClaims,
} from "@/app/lib/session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret-0123456789ab";
});

describe("sessionFromClaims", () => {
  it("builds a Session from ID token claims and token metadata", () => {
    const now = 1_700_000_000;
    const session = sessionFromClaims(
      { sub: "user-1", name: "Alice", email: "alice@example.com", exp: now + 3600, iat: now },
      { accessToken: "access-token", accessTokenExpiresAt: now + 3600 },
      now,
    );

    expect(session).toEqual({
      accessToken: "access-token",
      idTokenClaims: { sub: "user-1", name: "Alice", email: "alice@example.com", exp: now + 3600, iat: now },
      accessTokenExpiresAt: now + 3600,
      createdAt: now,
    });
  });
});

describe("displayNameFromSession", () => {
  it("uses the name claim when present", () => {
    const session = sessionFromClaims(
      { sub: "user-1", name: "Alice", email: "alice@example.com", exp: 1, iat: 1 },
      { accessToken: "a", accessTokenExpiresAt: 1 },
      0,
    );
    expect(displayNameFromSession(session)).toBe("Alice");
  });

  it("falls back to email when the name claim is absent", () => {
    const session = sessionFromClaims(
      { sub: "user-1", email: "alice@example.com", exp: 1, iat: 1 },
      { accessToken: "a", accessTokenExpiresAt: 1 },
      0,
    );
    expect(displayNameFromSession(session)).toBe("alice@example.com");
  });
});

describe("encodeSession / decodeSession", () => {
  it("round-trips a session through the encrypted cookie", async () => {
    const session = sessionFromClaims(
      { sub: "user-1", name: "Alice", email: "alice@example.com", exp: 1, iat: 1 },
      { accessToken: "access-token", accessTokenExpiresAt: 1_700_003_600 },
      1_700_000_000,
    );
    const encoded = await encodeSession(session);
    const decoded = await decodeSession(encoded);
    expect(decoded).toEqual(session);
  });

  it("returns null when the token is malformed", async () => {
    const decoded = await decodeSession("not-a-real-token");
    expect(decoded).toBeNull();
  });

  it("returns null when required fields are missing from the payload", async () => {
    const { EncryptJWT } = await import("jose");
    const secret = new TextEncoder().encode("test-session-secret-0123456789ab".padEnd(32, "0").slice(0, 32));
    const incomplete = await new EncryptJWT({ accessToken: "a" })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuedAt()
      .encrypt(secret);
    const decoded = await decodeSession(incomplete);
    expect(decoded).toBeNull();
  });
});
