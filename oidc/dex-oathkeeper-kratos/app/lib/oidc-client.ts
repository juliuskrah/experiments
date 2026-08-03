import { EncryptJWT, jwtDecrypt } from "jose";
import * as client from "openid-client";

// Dex's `authproxy` connector never issues a refresh_token regardless of scope (it does not
// implement Dex's RefreshConnector interface), so `offline_access` is intentionally omitted —
// requesting it would claim a capability this approach does not have (research.md §3, revised).
export const OIDC_SCOPES = "openid profile email";
export const PKCE_COOKIE_NAME = "pkce";
export const PKCE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

let configPromise: Promise<client.Configuration> | null = null;

export function getDexConfig(): Promise<client.Configuration> {
  if (!configPromise) {
    configPromise = client.discovery(
      new URL(requireEnv("DEX_ISSUER_URL")),
      requireEnv("DEX_CLIENT_ID"),
      requireEnv("DEX_CLIENT_SECRET"),
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

// Never resolved against a real origin — only used to detect whether `returnTo` would escape
// the app's own origin once resolved, the same way a browser resolves a redirect Location.
const SANITIZE_BASE = "http://sanitize-return-to.invalid";

/**
 * Restricts `return_to` to same-origin, absolute-path-local values. Without this, an attacker
 * can set `return_to=https://attacker.example` (or a protocol-relative `//attacker.example`) and
 * turn a legitimate login into an open redirect once the app resolves it in the callback route.
 * Returns `undefined` for anything that isn't a safe local path — including empty/missing input.
 */
export function sanitizeReturnTo(returnTo: string | null | undefined): string | undefined {
  if (!returnTo || !returnTo.startsWith("/")) {
    return undefined;
  }
  let resolved: URL;
  try {
    resolved = new URL(returnTo, SANITIZE_BASE);
  } catch {
    return undefined;
  }
  if (resolved.origin !== SANITIZE_BASE) {
    return undefined;
  }
  return resolved.pathname + resolved.search + resolved.hash;
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
  idTokenClaims: client.IDToken;
  accessTokenExpiresAt: number;
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
  const idTokenClaims = tokens.claims();
  if (!idTokenClaims) {
    throw new Error("Token response missing ID token claims");
  }
  const expiresIn = tokens.expiresIn();
  const accessTokenExpiresAt = Math.floor(Date.now() / 1000) + (expiresIn ?? 0);
  return {
    accessToken: tokens.access_token,
    idTokenClaims,
    accessTokenExpiresAt,
  };
}

/** Renewal happens by silently re-running the Authorization Code flow, not an OAuth refresh grant
 * (Dex's authproxy connector never issues a refresh_token — research.md §3, revised). This buffer
 * decides when GET /api/auth/session should trigger that silent re-authorization. */
export const CLOCK_SKEW_BUFFER_SECONDS = 30;

export function isAccessTokenExpired(accessTokenExpiresAt: number, now: number): boolean {
  return now >= accessTokenExpiresAt - CLOCK_SKEW_BUFFER_SECONDS;
}

const MAX_REAUTHORIZE_REDIRECTS = 10;

/**
 * Silently replays the Authorization Code + PKCE flow server-to-server, forwarding the
 * browser's Kratos session cookie so Oathkeeper's `cookie_session` check (on Dex's
 * `/dex/callback/kratos-authproxy`) approves without any user-visible redirect. Returns null
 * if the Kratos session is invalid/expired — Oathkeeper redirects to `/kratos/login` in that
 * case instead of letting the flow reach Dex's callback (FR-007).
 *
 * This is the mechanism research.md §3 (revised) describes in place of an OAuth refresh
 * grant, since Dex's `authproxy` connector cannot issue one.
 */
export async function reauthorize(
  config: client.Configuration,
  redirectUri: string,
  kratosCookieHeader: string,
): Promise<TokenResult | null> {
  const pkce = await generatePkceParams();
  let nextUrl: string = buildAuthorizationUrl(config, redirectUri, pkce).toString();
  const redirectUriOrigin = new URL(redirectUri).origin;

  for (let i = 0; i < MAX_REAUTHORIZE_REDIRECTS; i++) {
    const response = await fetch(nextUrl, {
      headers: { cookie: kratosCookieHeader },
      redirect: "manual",
    });

    const location = response.headers.get("location");
    if (!location) {
      // Anything other than a redirect (e.g. Dex's connector-selection page, or an error
      // page) means the flow didn't complete unattended — treat as re-authorization failure.
      return null;
    }

    const resolved = new URL(location, nextUrl);
    if (resolved.origin === redirectUriOrigin && resolved.pathname === new URL(redirectUri).pathname) {
      // Reached our own callback URI — the flow completed. Exchange the code directly
      // rather than making an HTTP round-trip back into our own /api/auth/callback route.
      if (resolved.searchParams.get("error")) {
        return null;
      }
      return exchangeAuthorizationCode(config, resolved, pkce);
    }

    nextUrl = resolved.toString();
  }

  return null;
}
