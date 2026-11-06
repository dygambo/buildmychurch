import { expect, test } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

test("a member signs in with a code, sees their page, sends a prayer request and updates their details", async ({ page, browser }, info) => {
  const memberEmail = `member.${info.project.name}.${stamp}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Portal Chapel ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Portal");
  await page.getByLabel("Email").fill(`portal.${info.project.name}.${stamp}@example.com`);
  await page.getByLabel("Password").fill("Members-Self-Serve-26");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/members");
  await page.getByRole("button", { name: "Add member" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("First name").fill("Tolu");
  await d.getByLabel("Surname").fill("Adeyemi");
  await d.getByLabel("Gender").selectOption("female");
  await d.getByLabel("Phone").fill(`080${String(Date.now()).slice(-8)}`);
  await d.locator("#m-email").fill(memberEmail);
  await d.getByRole("button", { name: "Add member" }).click();
  await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}/);

  await page.goto("/settings");
  const portal = new URL((await page.getByTestId("member-page-link").textContent())!.trim()).pathname;

  const ctx2 = await browser.newContext();
  const m = await ctx2.newPage();
  await m.goto(portal);
  await expect(m).toHaveURL(/\/sign-in$/);
  await m.getByLabel("Phone number or email").fill(memberEmail);
  await m.getByRole("button", { name: "Send me a code" }).click();
  await expect(m.getByText(/a 6-digit code is on its way/)).toBeVisible();

  expect((await page.request.post("/api/test/run-jobs")).ok()).toBeTruthy();
  await page.goto("/dev/mailbox");
  const subject = (await page.locator("aside a", { hasText: `to ${memberEmail}` }).filter({ hasText: /sign-in code/ }).first().textContent())!;
  const code = /(\d{6})/.exec(subject)![1]!;

  await m.getByLabel("Code").fill(code === "000000" ? "111111" : "000000");
  await m.getByRole("button", { name: "Sign in" }).click();
  await expect(m.getByText("That code didn't work.")).toBeVisible();
  await m.getByLabel("Code").fill(code);
  await m.getByRole("button", { name: "Sign in" }).click();
  await expect(m.getByRole("heading", { name: "Hello, Tolu" })).toBeVisible();

  await m.getByRole("link", { name: "Giving", exact: true }).click();
  await expect(m.getByTestId("giving-total")).toHaveText("₦0");
  const pdf = await m.request.get(`${portal}/giving/statement`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  await m.getByRole("link", { name: "Prayer", exact: true }).click();
  await m.getByLabel("How can we pray with you?").fill("Pray for my sister's wedding preparations.");
  await m.getByLabel("Topic").selectOption("family");
  await m.getByRole("button", { name: "Send prayer request" }).click();
  await expect(m.getByTestId("my-prayer")).toContainText("wedding preparations");

  await m.getByRole("link", { name: "My details" }).click();
  await m.getByLabel("Area").fill("Lekki Phase 1");
  await m.getByLabel("Birthday day").selectOption("9");
  await m.getByLabel("Birthday month").selectOption("3");
  await m.getByRole("button", { name: "Save my details" }).click();
  await expect(m.getByText("Your details are saved")).toBeVisible();
  await m.reload();
  await expect(m.getByLabel("Area")).toHaveValue("Lekki Phase 1");

  // the staff side sees the request from the member page
  await page.goto("/care");
  await expect(page.getByRole("article", { name: "Prayer request from Tolu Adeyemi" })).toContainText("Member portal");

  await m.getByRole("link", { name: "Home" }).click();
  await m.getByRole("button", { name: "Sign out" }).click();
  await expect(m).toHaveURL(/\/sign-in$/);
  await m.goto(`${portal}/giving`);
  await expect(m).toHaveURL(/\/sign-in$/);
  await ctx2.close();
});
