import { expect, test } from "@playwright/test";
import { encodeSession } from "@/app/lib/session";

// Exercises quickstart.md Scenario 4 against the full Docker Compose stack: with an active
// session and a still-valid refresh token (and underlying Kratos session), the app's access
// token is forced to appear expired. GET /api/auth/session must then silently perform a
// standards-compliant OAuth2 refresh_token grant against Hydra's public token endpoint — the
// capability this whole approach exists to demonstrate (contracts/app-routes.md; research.md §3)
// — and the Welcome page must render with no visit to /login.
test("silent session extension via a real refresh_token grant, with no login prompt", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /continue with/i }).click();
  await expect(page).toHaveURL(/\/kratos\/login/);
  await page.getByTestId("ory/screen/login/action/register").click();
  await expect(page).toHaveURL(/\/kratos\/registration/);

  const email = `silent-refresh-${Date.now()}@example.com`;
  await page.getByPlaceholder(/e-?mail/i).fill(email);
  await page.getByPlaceholder(/first name/i).fill("Silent");
  await page.getByPlaceholder(/last name/i).fill("Refresh");
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.getByPlaceholder(/password/i).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(/hello,/i)).toBeVisible();

  // Force the access token to appear expired by rewriting the session cookie directly (run in
  // Node from the test itself, reusing the app's own encodeSession), keeping the real refresh
  // token issued by Hydra so the grant that follows is genuine, not mocked.
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "session");
  expect(sessionCookie).toBeDefined();
  const { decodeSession } = await import("@/app/lib/session");
  const currentSession = await decodeSession(sessionCookie!.value);
  expect(currentSession).not.toBeNull();

  const now = Math.floor(Date.now() / 1000);
  const expiredSessionValue = await encodeSession({
    ...currentSession!,
    accessTokenExpiresAt: now - 3600,
  });

  await page.context().addCookies([{ ...sessionCookie!, value: expiredSessionValue }]);

  await page.reload();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText(/hello,/i)).toBeVisible();

  // The refresh token must have rotated (Hydra rotates on every use — research.md §3).
  const refreshedCookies = await page.context().cookies();
  const refreshedSessionCookie = refreshedCookies.find((c) => c.name === "session");
  const refreshedSession = await decodeSession(refreshedSessionCookie!.value);
  expect(refreshedSession?.refreshToken).not.toBe(currentSession!.refreshToken);
});
