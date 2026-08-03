import { expect, test } from "@playwright/test";
import { encodeSession } from "@/app/lib/session";

// Exercises quickstart.md Scenario 5 against the full Docker Compose stack: with the access
// token expired and the refresh token itself invalid/expired/revoked, Hydra's token endpoint
// rejects the refresh_token grant, and the user is redirected to /login — no error page or
// stuck state (contracts/app-routes.md; FR-007).
test("invalid refresh token: the refresh grant fails and the user is redirected to /login", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /continue with/i }).click();
  await expect(page).toHaveURL(/\/kratos\/login/);
  await page.getByTestId("ory/screen/login/action/register").click();
  await expect(page).toHaveURL(/\/kratos\/registration/);

  const email = `refresh-invalid-${Date.now()}@example.com`;
  await page.getByPlaceholder(/e-?mail/i).fill(email);
  await page.getByPlaceholder(/first name/i).fill("Refresh");
  await page.getByPlaceholder(/last name/i).fill("Invalid");
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
  // Both the access token AND the refresh token are made invalid: expired access token forces
  // the refresh path, and a refresh token Hydra has never issued makes that refresh grant fail.
  const invalidSessionValue = await encodeSession({
    ...currentSession!,
    refreshToken: "this-refresh-token-was-never-issued-by-hydra",
    accessTokenExpiresAt: now - 3600,
  });

  await page.context().addCookies([{ ...sessionCookie!, value: invalidSessionValue }]);

  await page.reload();
  await expect(page).toHaveURL(/\/login/);
});
