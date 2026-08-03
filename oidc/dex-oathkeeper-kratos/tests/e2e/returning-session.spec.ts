import { expect, test } from "@playwright/test";

// Exercises quickstart.md Scenario 2 against the full Docker Compose stack: a user with an
// existing valid session reloads the app and lands directly on the Welcome page, with no
// redirect to /login.
test("returning with an active session renders the Welcome page directly", async ({ page }) => {
  // Establish a session first (mirrors first-login.spec.ts's registration flow).
  await page.goto("/login");
  await page.getByRole("button", { name: /continue with/i }).click();
  await expect(page).toHaveURL(/\/kratos\/login/);

  await page.getByTestId("ory/screen/login/action/register").click();
  await expect(page).toHaveURL(/\/kratos\/registration/);

  const email = `returning-session-${Date.now()}@example.com`;
  await page.getByPlaceholder(/e-?mail/i).fill(email);
  await page.getByPlaceholder(/first name/i).fill("Returning");
  await page.getByPlaceholder(/last name/i).fill("Session");
  await page.getByRole("button", { name: /sign up/i }).click();

  await page.getByPlaceholder(/password/i).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: /sign up/i }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(/hello,/i)).toBeVisible();

  // Reload: the session cookie from the completed flow above should already be valid, so
  // this must NOT redirect to /login.
  const navigation = page.waitForResponse(
    (response) => response.url().endsWith("/") && response.request().method() === "GET",
  );
  await page.reload();
  const response = await navigation;
  expect(response.status()).toBeLessThan(400);
  await expect(page).toHaveURL("/");
  await expect(page.getByText(/hello,/i)).toBeVisible();
});
