import { NextRequest, NextResponse } from "next/server";
import { acceptConsentRequest, getConsentRequest, getKratosIdentityTraits } from "@/app/lib/hydra-admin";

export async function GET(request: NextRequest) {
  const consentChallenge = request.nextUrl.searchParams.get("consent_challenge");
  if (!consentChallenge) {
    return NextResponse.json({ error: "missing consent_challenge" }, { status: 400 });
  }

  const consentRequest = await getConsentRequest(consentChallenge);
  if (!consentRequest.subject) {
    return NextResponse.json({ error: "consent request missing subject" }, { status: 400 });
  }

  // Hydra has no user store of its own, so the ID token claims it would otherwise construct from
  // a connector (as Dex's authproxy does — see the sibling dex-oathkeeper-kratos app) must be
  // supplied explicitly here, looked up from Kratos by the subject the login bridge already
  // verified (research.md §2).
  const traits = await getKratosIdentityTraits(consentRequest.subject);
  const name = [traits.name?.first, traits.name?.last].filter(Boolean).join(" ") || undefined;

  // This app is Hydra's only, fully first-party client — no user-facing consent screen.
  const { redirect_to } = await acceptConsentRequest(consentChallenge, {
    grantScope: consentRequest.requested_scope ?? [],
    grantAccessTokenAudience: consentRequest.requested_access_token_audience,
    idTokenClaims: { email: traits.email, name },
  });
  return NextResponse.redirect(redirect_to, 302);
}
