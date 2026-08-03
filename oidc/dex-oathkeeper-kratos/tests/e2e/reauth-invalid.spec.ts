import { expect, test } from "@playwright/test";
import { encodeSession } from "@/app/lib/session";

const KRATOS_SESSION_COOKIE_NAME = "ory_kratos_session";

// Exercises quickstart.md Scenario 5 against the full Docker Compose stack: with an active app
// session, the underlying Kratos browser session is ended (deleting its cookie, simulating
// logout/expiry) and the access token is forced to appear expired as in Scenario 4. The silent
// re-authorization attempt must then fail at Oathkeeper's cookie_session check, and the user
// must be redirected to /login — no error page or stuck state (SC-004).
test("underlying Kratos session invalid: re-authorization fails and the user is redirected to /login", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /continue with/i }).click();
  await expect(page).toHaveURL(/\/kratos\/login/);
  await page.getByTestId("ory/screen/login/action/register").click();
  await expect(page).toHaveURL(/\/kratos\/registration/);

  const email = `reauth-invalid-${Date.now()}@example.com`;
  await page.getByPlaceholder(/e-?mail/i).fill(email);
  await page.getByPlaceholder(/first name/i).fill("Reauth");
  await page.getByPlaceholder(/last name/i).fill("Invalid");
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.getByPlaceholder(/password/i).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(/hello,/i)).toBeVisible();

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "session");
  expect(sessionCookie).toBeDefined();

  const now = Math.floor(Date.now() / 1000);
  const expiredSessionValue = await encodeSession({
    accessToken: "stale-access-token",
    idTokenClaims: { sub: "placeholder", email, name: "Reauth Invalid", exp: now - 3600, iat: now - 7200 },
    accessTokenExpiresAt: now - 3600,
    createdAt: now - 7200,
  });

  await page.context().addCookies([{ ...sessionCookie!, value: expiredSessionValue }]);

  // End the underlying Kratos session by removing its cookie, simulating logout/expiry — the
  // Kratos session is what Oathkeeper's cookie_session authenticator checks during re-auth.
  await page.context().clearCookies({ name: KRATOS_SESSION_COOKIE_NAME });

  await page.reload();
  await expect(page).toHaveURL(/\/login/);
});
