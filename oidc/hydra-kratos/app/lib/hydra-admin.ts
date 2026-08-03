import { Configuration, OAuth2Api, type OAuth2ConsentRequest, type OAuth2LoginRequest, type OAuth2RedirectTo } from "@ory/hydra-client-fetch";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

let api: OAuth2Api | null = null;

function getHydraAdminApi(): OAuth2Api {
  if (!api) {
    api = new OAuth2Api(new Configuration({ basePath: requireEnv("HYDRA_ADMIN_URL") }));
  }
  return api;
}

export function getLoginRequest(loginChallenge: string): Promise<OAuth2LoginRequest> {
  return getHydraAdminApi().getOAuth2LoginRequest({ loginChallenge });
}

export function acceptLoginRequest(
  loginChallenge: string,
  params: { subject: string },
): Promise<OAuth2RedirectTo> {
  return getHydraAdminApi().acceptOAuth2LoginRequest({
    loginChallenge,
    acceptOAuth2LoginRequest: { subject: params.subject },
  });
}

export function rejectLoginRequest(loginChallenge: string, error: string): Promise<OAuth2RedirectTo> {
  return getHydraAdminApi().rejectOAuth2LoginRequest({
    loginChallenge,
    rejectOAuth2Request: { error },
  });
}

export function getConsentRequest(consentChallenge: string): Promise<OAuth2ConsentRequest> {
  return getHydraAdminApi().getOAuth2ConsentRequest({ consentChallenge });
}

export function acceptConsentRequest(
  consentChallenge: string,
  params: {
    grantScope: string[];
    grantAccessTokenAudience?: string[];
    idTokenClaims?: Record<string, unknown>;
  },
): Promise<OAuth2RedirectTo> {
  return getHydraAdminApi().acceptOAuth2ConsentRequest({
    consentChallenge,
    acceptOAuth2ConsentRequest: {
      grant_scope: params.grantScope,
      grant_access_token_audience: params.grantAccessTokenAudience,
      session: { id_token: params.idTokenClaims ?? {} },
    },
  });
}

export interface KratosIdentityTraits {
  email: string;
  name?: { first?: string; last?: string };
}

export async function getKratosIdentityTraits(identityId: string): Promise<KratosIdentityTraits> {
  const response = await fetch(`${requireEnv("KRATOS_ADMIN_URL")}/admin/identities/${identityId}`);
  if (!response.ok) {
    throw new Error(`Kratos admin identity lookup failed: ${response.status}`);
  }
  const identity = await response.json();
  return identity.traits as KratosIdentityTraits;
}
