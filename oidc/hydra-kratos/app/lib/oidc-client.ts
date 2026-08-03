import { EncryptJWT, jwtDecrypt } from "jose";
import * as client from "openid-client";

// offline_access is honored here — Hydra (via ory/fosite) issues a real refresh_token for it,
// unlike the sibling dex-oathkeeper-kratos app's authproxy connector (research.md §1, §3).
export const OIDC_SCOPES = "openid profile email offline_access";
export const PKCE_COOKIE_NAME = "pkce";
export const PKCE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

let configPromise: Promise<client.Configuration> | null = null;

export function getHydraConfig(): Promise<client.Configuration> {
  if (!configPromise) {
    configPromise = client.discovery(
      new URL(requireEnv("HYDRA_ISSUER_URL")),
      requireEnv("HYDRA_CLIENT_ID"),
      requireEnv("HYDRA_CLIENT_SECRET"),
      undefined,
      // This demo stack runs entirely over plain HTTP (no TLS termination is configured anywhere
      // in deploy/); openid-client requires HTTPS by default, so local/demo discovery must opt in.
      process.env.NODE_ENV === "production" ? undefined : { execute: [client.allowInsecureRequests] },
    );
  }
  return configPromise;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

export interface PkceParams {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  nonce: string;
}

export async function generatePkceParams(): Promise<PkceParams> {
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  return { codeVerifier, codeChallenge, state, nonce };
}

function getPkceCookieKey(): Uint8Array {
  const secret = requireEnv("SESSION_SECRET");
  return new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32));
}

export interface PkceCookiePayload extends Pick<PkceParams, "codeVerifier" | "state" | "nonce"> {
  returnTo?: string;
}

export async function encodePkceCookie(payload: PkceCookiePayload): Promise<string> {
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${PKCE_COOKIE_MAX_AGE_SECONDS}s`)
    .encrypt(getPkceCookieKey());
}

export async function decodePkceCookie(token: string): Promise<PkceCookiePayload | null> {
  try {
    const { payload } = await jwtDecrypt(token, getPkceCookieKey());
    const { codeVerifier, state, nonce, returnTo } = payload as unknown as PkceCookiePayload;
    if (typeof codeVerifier !== "string" || typeof state !== "string" || typeof nonce !== "string") {
      return null;
    }
    return { codeVerifier, state, nonce, returnTo: typeof returnTo === "string" ? returnTo : undefined };
  } catch {
    return null;
  }
}

export function buildAuthorizationUrl(
  config: client.Configuration,
  redirectUri: string,
  pkce: PkceParams,
): URL {
  return client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: OIDC_SCOPES,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: "S256",
    state: pkce.state,
    nonce: pkce.nonce,
  });
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  idTokenClaims: client.IDToken;
  accessTokenExpiresAt: number;
}

function toTokenResult(
  tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>,
): TokenResult {
  const refreshToken = tokens.refresh_token;
  const idTokenClaims = tokens.claims();
  if (!refreshToken || !idTokenClaims) {
    throw new Error("Token response missing refresh_token or ID token claims");
  }
  const expiresIn = tokens.expiresIn();
  const accessTokenExpiresAt = Math.floor(Date.now() / 1000) + (expiresIn ?? 0);
  return {
    accessToken: tokens.access_token,
    refreshToken,
    idTokenClaims,
    accessTokenExpiresAt,
  };
}

export async function exchangeAuthorizationCode(
  config: client.Configuration,
  currentUrl: URL,
  pkce: Pick<PkceParams, "codeVerifier" | "state" | "nonce">,
): Promise<TokenResult> {
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: pkce.codeVerifier,
    expectedState: pkce.state,
    expectedNonce: pkce.nonce,
  });
  return toTokenResult(tokens);
}

/** Standards-compliant OAuth2 refresh-token grant against Hydra's public token endpoint. Hydra
 * rotates the refresh token on every use, so the caller MUST persist the new one atomically. */
export async function refreshTokens(
  config: client.Configuration,
  refreshToken: string,
): Promise<TokenResult> {
  const tokens = await client.refreshTokenGrant(config, refreshToken);
  return toTokenResult(tokens);
}

/** Refresh a bit before actual expiry to absorb clock skew between the app and Hydra. */
export const CLOCK_SKEW_BUFFER_SECONDS = 30;

export function isAccessTokenExpired(accessTokenExpiresAt: number, now: number): boolean {
  return now >= accessTokenExpiresAt - CLOCK_SKEW_BUFFER_SECONDS;
}
