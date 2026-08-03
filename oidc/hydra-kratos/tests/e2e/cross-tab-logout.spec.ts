import { expect, test } from "@playwright/test";

// Exercises quickstart.md Scenario 6 against the full Docker Compose stack: with two tabs open
// and both authenticated, logging out in one tab must show a non-blocking pop-up in the other,
// with no manual reload required (BroadcastChannel; research.md §7).
test("logging out in one tab notifies another open tab without a reload", async ({ context }) => {
  const tabA = await context.newPage();
  await tabA.goto("/login");
  await tabA.getByRole("button", { name: /continue with/i }).click();
  await expect(tabA).toHaveURL(/\/kratos\/login/);
  await tabA.getByTestId("ory/screen/login/action/register").click();
  await expect(tabA).toHaveURL(/\/kratos\/registration/);

  const email = `cross-tab-logout-${Date.now()}@example.com`;
  await tabA.getByPlaceholder(/e-?mail/i).fill(email);
  await tabA.getByPlaceholder(/first name/i).fill("Cross");
  await tabA.getByPlaceholder(/last name/i).fill("Tab");
  await tabA.getByRole("button", { name: /sign up/i }).click();
  await tabA.getByPlaceholder(/password/i).fill("correct-horse-battery-staple");
  await tabA.getByRole("button", { name: /sign up/i }).click();
  await expect(tabA).toHaveURL("/");
  await expect(tabA.getByText(/hello,/i)).toBeVisible();

  // Same-origin session cookie is shared across tabs in the same browser context.
  const tabB = await context.newPage();
  await tabB.goto("/");
  await expect(tabB.getByText(/hello,/i)).toBeVisible();

  await tabA.getByRole("button", { name: /log out/i }).click();

  await expect(tabB.getByRole("status")).toContainText(/session ended/i);
  // No reload in Tab B — the greeting should still be showing from before the notification.
  await expect(tabB.getByText(/hello,/i)).toBeVisible();
});
