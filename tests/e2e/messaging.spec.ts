import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const owner = { email: "", password: "Trumpet-Call-2026" };
let member = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(({}, info) => {
  owner.email = `messaging.${info.project.name}.${stamp}@example.com`;
  member = `ifeoma.${info.project.name}.${stamp}@example.com`;
});

async function runJobs(page: Page) {
  expect((await page.request.post("/api/test/run-jobs")).ok()).toBeTruthy();
}

test("send an SMS and an email to members, and someone unsubscribes from the email", async ({ page, browser }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Zion Assembly ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Bola Ige");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const phone = `080${String(Date.now()).slice(-8)}`;
  for (const [first, consent, ph, em] of [
    ["Ifeoma", true, phone, member],
    ["Kunle", false, `081${String(Date.now()).slice(-8)}`, ""],
  ] as const) {
    await page.goto("/members");
    await page.getByRole("button", { name: "Add member" }).first().click();
    const d = page.getByRole("dialog");
    await d.getByLabel("First name").fill(first);
    await d.getByLabel("Surname").fill("Okeke");
    await d.getByLabel("Gender").selectOption(first === "Ifeoma" ? "female" : "male");
    await d.getByLabel("Phone").fill(ph);
    if (em) await d.locator("#m-email").fill(em);
    if (consent) await d.getByLabel(/Agrees to receive SMS/).check();
    await d.getByRole("button", { name: "Add member" }).click();
    await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}/);
  }

  // SMS to everyone: Kunle hasn't agreed, so only Ifeoma gets it
  await page.goto("/messages/new?channel=sms");
  await page.getByLabel("Message", { exact: true }).fill("Hi {first_name}, service starts 8am Sunday. - {church}");
  await expect(page.getByTestId("reachable")).toHaveText("1 person");
  await expect(page.getByText("1 won't get it")).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send now" }).click();
  await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/);
  await runJobs(page);
  await page.reload();
  await expect(page.getByText("Sent").first()).toBeVisible();
  await page.getByRole("link", { name: /Not sent/ }).click();
  await expect(page.getByText("Hasn't agreed to messages").first()).toBeVisible();

  await page.goto("/dev/mailbox");
  await page.locator("aside a", { hasText: "SMS to +234" }).filter({ hasText: "Hi Ifeoma" }).first().click();
  await expect(page.locator("pre")).toContainText(`Hi Ifeoma, service starts 8am Sunday. - Zion Assembly ${stamp}`);

  // the wallet shows the unit spent
  await page.goto("/messages/wallet");
  await expect(page.getByTestId("sms-balance")).toHaveText("49");

  // an email with an unsubscribe link
  await page.goto("/messages/new?channel=email");
  await page.getByLabel("Subject").fill("News for {first_name}");
  await page.getByLabel("Message", { exact: true }).fill("Dear {first_name},\n\nHarvest is next Sunday.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Send now" }).click();
  await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/);
  await runJobs(page);
  await page.goto("/dev/mailbox");
  await page.locator("aside a", { hasText: `to ${member}` }).filter({ hasText: "News for Ifeoma" }).first().click();
  const html = (await page.locator("iframe").getAttribute("srcdoc")) ?? "";
  const link = /href="([^"]*\/u\/[^"]+)"/.exec(html)?.[1];
  expect(link).toBeTruthy();

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(new URL(link!.replace(/&amp;/g, "&")).pathname);
  await expect(p2.getByRole("heading", { name: /Stop messages from Zion Assembly/ })).toBeVisible();
  await p2.getByRole("button", { name: "Unsubscribe me" }).click();
  await expect(p2.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
  await ctx2.close();

  // next time, she's left out
  await page.goto("/messages/new?channel=sms");
  await page.getByLabel("Message", { exact: true }).fill("Test");
  await expect(page.getByText("No one in this audience").or(page.getByTestId("reachable"))).toBeVisible();
  await expect(page.getByTestId("reachable")).toHaveText("0 people");
});

test("buy SMS units through the checkout", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/messages/wallet");
  await page.getByRole("button", { name: /^500/ }).click();
  await page.getByRole("button", { name: "Pay ₦2,000" }).click();
  await expect(page).toHaveURL(/\/pay\/BMC-/);
  await page.getByRole("button", { name: "Pay ₦2,000" }).click();
  await expect(page).toHaveURL(/\/messages\/wallet\?ref=/);
  await expect(page.getByText("Payment received")).toBeVisible();
  await expect(page.getByTestId("sms-balance")).toHaveText("549");
});
