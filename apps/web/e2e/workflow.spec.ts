import { expect, test } from "@playwright/test";

test("signup → project → issue → board → knowledge page → reload keeps session", async ({ page }) => {
  const id = Date.now().toString(36);
  await page.goto("/");
  await page.getByPlaceholder("Acme Studio").fill(`Acme ${id}`);
  await page.getByPlaceholder("Alex Morgan").fill("Alex Morgan");
  await page.getByPlaceholder("acme-studio").fill(`acme-${id}`);
  await page.getByPlaceholder("alex@company.com").fill(`alex-${id}@test.example`);
  await page.getByPlaceholder("At least 12 characters").fill("correct horse battery staple");
  await page.getByRole("button", { name: /create workspace/i }).click();

  await expect(page.getByText("Start with your first project")).toBeVisible();
  await page.getByRole("button", { name: /create project/i }).click();
  await page.getByPlaceholder("Product launch").fill("Launch");
  await page.getByPlaceholder("PLAT").fill("LAU");
  await page
    .getByRole("button", { name: /^create/i })
    .last()
    .click();
  await expect(page).toHaveURL(/project=/);

  await page.getByRole("button", { name: /new issue/i }).click();
  await page.getByPlaceholder("What needs to be done?").fill("Ship the first release");
  await page
    .getByRole("button", { name: /^create/i })
    .last()
    .click();
  await expect(page).toHaveURL(/\/board/);
  await expect(page.getByText("Ship the first release")).toBeVisible();

  await page
    .getByRole("button", { name: /knowledge/i })
    .first()
    .click();
  await page
    .getByRole("button", { name: /new page/i })
    .first()
    .click();
  await page.getByPlaceholder("Page title").fill("Release notes");
  await page
    .getByRole("button", { name: /^create/i })
    .last()
    .click();
  await expect(page.getByText("Release notes").first()).toBeVisible();

  await page.getByRole("button", { name: /^board$/i }).click();
  await page.reload();
  await expect(page.getByText("Ship the first release")).toBeVisible();
});

test("wrong password shows the server's message", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByPlaceholder("acme-studio").fill("no-such-workspace");
  await page.getByPlaceholder("alex@company.com").fill("nobody@test.example");
  await page.getByPlaceholder("At least 12 characters").fill("whatever-password");
  await page
    .getByRole("button", { name: /sign in/i })
    .last()
    .click();
  await expect(page.locator(".error")).toContainText(/invalid credentials/i);
});
