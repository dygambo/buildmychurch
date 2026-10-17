import { expect, test } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("a church uploads its logo and icon and changes the app colour", async ({ page }, info) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Brand Chapel ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Brand");
  await page.getByLabel("Email").fill(`brand.${info.project.name}.${stamp}@example.com`);
  await page.getByLabel("Password").fill("Our-Colours-Our-Logo-26");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/settings");
  await page.getByLabel("Upload church logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText(/Logo saved/)).toBeVisible();
  await expect(page.getByAltText("Church logo preview")).toBeVisible();
  await page.getByLabel("Upload browser icon").setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Browser icon saved")).toBeVisible();

  await page.getByRole("radio", { name: "Purple" }).click();
  await page.getByRole("button", { name: "Save colour" }).click();
  await expect(page.getByText(/App colour saved/)).toBeVisible();

  await page.goto("/members");
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  expect(accent).toBe("#6d28d9");
  const icon = await page.locator('link[rel="icon"]').first().getAttribute("href");
  expect(icon).toMatch(/\/brand\/[0-9a-f-]{36}\/favicon\?v=/);
  const logo = await page.request.get(icon!.replace("favicon", "logo"));
  expect(logo.headers()["content-type"]).toBe("image/png");

  // back to the default
  await page.goto("/settings");
  await page.getByRole("button", { name: "Use the default colour" }).click();
  await expect(page.getByText("Back to the default colour")).toBeVisible();
});
