import { jwtDecrypt, EncryptJWT } from "jose";

export const SESSION_COOKIE_NAME = "session";

export interface IdTokenClaims {
  sub: string;
  name?: string;
  email: string;
  email_verified?: boolean;
  exp: number;
  iat: number;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  idTokenClaims: IdTokenClaims;
  accessTokenExpiresAt: number;
  createdAt: number;
}

function getSessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is not set");
  }
  return new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32));
}

export async function encodeSession(session: Session): Promise<string> {
  return new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .encrypt(getSessionKey());
}

export async function decodeSession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtDecrypt(token, getSessionKey());
    const { accessToken, refreshToken, idTokenClaims, accessTokenExpiresAt, createdAt } =
      payload as unknown as Session;
    if (
      typeof accessToken !== "string" ||
      typeof refreshToken !== "string" ||
      typeof accessTokenExpiresAt !== "number" ||
      typeof createdAt !== "number" ||
      !idTokenClaims ||
      typeof idTokenClaims.sub !== "string" ||
      typeof idTokenClaims.email !== "string"
    ) {
      return null;
    }
    return { accessToken, refreshToken, idTokenClaims, accessTokenExpiresAt, createdAt };
  } catch {
    return null;
  }
}

export function sessionFromClaims(
  claims: IdTokenClaims,
  tokens: { accessToken: string; refreshToken: string; accessTokenExpiresAt: number },
  now: number,
): Session {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idTokenClaims: claims,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    createdAt: now,
  };
}

export function displayNameFromSession(session: Session): string {
  return session.idTokenClaims.name ?? session.idTokenClaims.email;
}
