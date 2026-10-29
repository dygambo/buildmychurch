import { expect, test } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

test("reports open for a new church, switch period and tab, and download as Excel", async ({ page }, info) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Report Test Chapel ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Report");
  await page.getByLabel("Email").fill(`reports.${info.project.name}.${stamp}@example.com`);
  await page.getByLabel("Password").fill("Numbers-Tell-Stories-26");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByTestId("kpis")).toContainText("Average Sunday attendance");
  await expect(page.getByTestId("funnel")).toContainText("No first timers");

  await page.getByLabel("Period").selectOption("custom");
  await page.getByLabel("From", { exact: true }).fill("2026-01-01");
  await page.getByLabel("To", { exact: true }).fill("2026-03-31");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/from=2026-01-01/);
  await expect(page.getByText("1 Jan 2026 to 31 Mar 2026")).toBeVisible();

  await page.getByRole("link", { name: "Income & spending" }).click();
  await expect(page).toHaveURL(/tab=finance/);
  await expect(page.getByText("Money in (giving)")).toBeVisible();
  await expect(page).toHaveURL(/from=2026-01-01/);

  const xlsx = await page.request.get("/reports/export?period=year");
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
});
