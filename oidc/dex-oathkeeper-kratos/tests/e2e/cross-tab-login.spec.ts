import { expect, test } from "@playwright/test";

// Exercises quickstart.md Scenario 7 against the full Docker Compose stack: with two tabs open
// and neither authenticated, completing login in one tab must show a non-blocking pop-up in the
// other, with no manual reload required (BroadcastChannel; research.md §6).
test("logging in in one tab notifies another open tab without a reload", async ({ context }) => {
  const tabA = await context.newPage();
  const tabB = await context.newPage();

  await tabA.goto("/login");
  await expect(tabA).toHaveURL(/\/login/);
  await tabB.goto("/login");
  await expect(tabB).toHaveURL(/\/login/);

  await tabA.getByRole("button", { name: /continue with/i }).click();
  await expect(tabA).toHaveURL(/\/kratos\/login/);
  await tabA.getByTestId("ory/screen/login/action/register").click();
  await expect(tabA).toHaveURL(/\/kratos\/registration/);

  const email = `cross-tab-login-${Date.now()}@example.com`;
  await tabA.getByPlaceholder(/e-?mail/i).fill(email);
  await tabA.getByPlaceholder(/first name/i).fill("Cross");
  await tabA.getByPlaceholder(/last name/i).fill("Login");
  await tabA.getByRole("button", { name: /sign up/i }).click();
  await tabA.getByPlaceholder(/password/i).fill("correct-horse-battery-staple");
  await tabA.getByRole("button", { name: /sign up/i }).click();
  await expect(tabA).toHaveURL("/");
  await expect(tabA.getByText(/hello,/i)).toBeVisible();

  await expect(tabB.getByRole("status")).toContainText(/session was created/i);
  // Tab B is still on /login — no reload was required to receive the notification.
  await expect(tabB).toHaveURL(/\/login/);
});
