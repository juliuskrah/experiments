import { expect, test } from "@playwright/test";
import { encodeSession } from "@/app/lib/session";

const KRATOS_SESSION_COOKIE_NAME = "ory_kratos_session";

// Exercises quickstart.md Scenario 5b against the full Docker Compose stack — the edge case this
// whole approach exists to make possible to express: the Hydra refresh_token itself is still
// nominally valid, but the underlying Kratos session has ended independently (e.g. the user
// logged out of Kratos directly, or its cookie was cleared). Hydra's refresh-token store is
// independent of Kratos once the initial login/consent bridge round-trip is complete, so a naive
// implementation would let the refresh grant succeed and the session live on. This app's
// GET /api/auth/session additionally re-checks Kratos's /sessions/whoami on every refresh
// (contracts/app-routes.md's note) and must treat that as equivalent to an invalid refresh token.
test("Kratos session ended independently of the (still valid) Hydra refresh token: user is redirected to /login", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /continue with/i }).click();
  await expect(page).toHaveURL(/\/kratos\/login/);
  await page.getByTestId("ory/screen/login/action/register").click();
  await expect(page).toHaveURL(/\/kratos\/registration/);

  const email = `refresh-kratos-ended-${Date.now()}@example.com`;
  await page.getByPlaceholder(/e-?mail/i).fill(email);
  await page.getByPlaceholder(/first name/i).fill("Kratos");
  await page.getByPlaceholder(/last name/i).fill("Ended");
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.getByPlaceholder(/password/i).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(/hello,/i)).toBeVisible();

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "session");
  expect(sessionCookie).toBeDefined();
  const { decodeSession } = await import("@/app/lib/session");
  const currentSession = await decodeSession(sessionCookie!.value);
  expect(currentSession).not.toBeNull();

  const now = Math.floor(Date.now() / 1000);
  // Only the access token is forced to appear expired — the refresh token is left untouched and
  // genuinely valid at Hydra, isolating this scenario from refresh-invalid.spec.ts's case.
  const expiredSessionValue = await encodeSession({
    ...currentSession!,
    accessTokenExpiresAt: now - 3600,
  });
  await page.context().addCookies([{ ...sessionCookie!, value: expiredSessionValue }]);

  // End the underlying Kratos session by removing its cookie, simulating logout/expiry
  // independently of the Hydra refresh token.
  await page.context().clearCookies({ name: KRATOS_SESSION_COOKIE_NAME });

  await page.reload();
  await expect(page).toHaveURL(/\/login/);
});
