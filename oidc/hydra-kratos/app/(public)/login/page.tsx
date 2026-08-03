import { ErrorBanner } from "./ErrorBanner";

const PROVIDER_NAME = "Hydra";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string; error?: string }>;
}) {
  const { return_to: returnTo, error } = await searchParams;
  const loginHref = returnTo
    ? `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
    : "/api/auth/login";

  return (
    <main>
      <h1>Login</h1>
      {error ? <ErrorBanner /> : null}
      {/* Plain <a>, not next/link's <Link>: this route redirects off-origin (to Hydra), and
          Link's client-side RSC navigation triggers a cross-origin fetch that gets blocked by
          CORS, rather than a full browser navigation. */}
      <a href={loginHref} role="button">
        Continue with {PROVIDER_NAME}
      </a>
    </main>
  );
}
