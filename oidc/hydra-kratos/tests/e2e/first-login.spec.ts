import { expect, test } from "@playwright/test";

// Exercises quickstart.md Scenario 1 against the full Docker Compose stack (deploy/compose.yml):
// a visitor with no session is redirected to Login, completes the OIDC Authorization Code + PKCE
// flow against Hydra — bounced through this app's own /hydra/login and /hydra/consent bridge
// routes, with a fresh Kratos registration in between since no Kratos session exists yet — and
// lands on the Welcome page addressed by name.
test("first-time login redirects to Login, then to Welcome after authorization", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login/);
  const continueButton = page.getByRole("button", { name: /continue with/i });
  await expect(continueButton).toBeVisible();

  await continueButton.click();

  // GET /api/auth/login -> Hydra /oauth2/auth -> /hydra/login (skip: false, no Kratos session
  // yet) -> /kratos/login?return_to=/hydra/login?login_challenge=...
  await expect(page).toHaveURL(/\/kratos\/login/);

  await page.getByTestId("ory/screen/login/action/register").click();
  await expect(page).toHaveURL(/\/kratos\/registration/);

  const email = `first-login-e2e-${Date.now()}@example.com`;
  await page.getByPlaceholder(/e-?mail/i).fill(email);
  await page.getByPlaceholder(/first name/i).fill("First");
  await page.getByPlaceholder(/last name/i).fill("Login");
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.getByPlaceholder(/password/i).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: /sign up/i }).click();

  // Kratos resumes -> /hydra/login (now accepted) -> /hydra/consent (auto-accepted, no visible
  // screen, since this is a first-party client) -> /api/auth/callback -> /.
  await expect(page).toHaveURL("/");
  await expect(page.getByText(/hello,/i)).toBeVisible();
});
