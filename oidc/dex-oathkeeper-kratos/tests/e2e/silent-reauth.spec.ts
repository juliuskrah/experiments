import { expect, test } from "@playwright/test";
import { encodeSession } from "@/app/lib/session";

// Exercises quickstart.md Scenario 4 against the full Docker Compose stack: with an active
// session and a still-valid Kratos browser session, the app's access token is forced to appear
// expired (by rewriting the session cookie directly — the test runs in Node and can reuse the
// same encodeSession() the app itself uses, requiring SESSION_SECRET to match the running app).
// GET /api/auth/session must then silently re-authorize against Dex/Oathkeeper and the Welcome
// page must render with no visit to /login (research.md §3, revised; NOT an OAuth refresh grant).
test("silent session extension: expired access token + valid Kratos session re-authorizes without a login prompt", async ({
  page,
}) => {
  // Establish a real session (registration flow), mirroring first-login.spec.ts.
  await page.goto("/login");
  await page.getByRole("button", { name: /continue with/i }).click();
  await expect(page).toHaveURL(/\/kratos\/login/);
  await page.getByTestId("ory/screen/login/action/register").click();
  await expect(page).toHaveURL(/\/kratos\/registration/);

  const email = `silent-reauth-${Date.now()}@example.com`;
  await page.getByPlaceholder(/e-?mail/i).fill(email);
  await page.getByPlaceholder(/first name/i).fill("Silent");
  await page.getByPlaceholder(/last name/i).fill("Reauth");
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.getByPlaceholder(/password/i).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(/hello,/i)).toBeVisible();

  // Force the access token to appear expired by rewriting the session cookie with an
  // accessTokenExpiresAt in the past, keeping the same idTokenClaims/sub.
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "session");
  expect(sessionCookie).toBeDefined();

  const now = Math.floor(Date.now() / 1000);
  const expiredSessionValue = await encodeSession({
    accessToken: "stale-access-token",
    idTokenClaims: { sub: "placeholder", email, name: "Silent Reauth", exp: now - 3600, iat: now - 7200 },
    accessTokenExpiresAt: now - 3600,
    createdAt: now - 7200,
  });

  await page.context().addCookies([
    {
      ...sessionCookie!,
      value: expiredSessionValue,
    },
  ]);

  // Reload triggers the Welcome page's client-side fetch("/api/auth/session"), which must
  // silently re-authorize rather than surface a login challenge.
  await page.reload();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText(/hello,/i)).toBeVisible();
});
