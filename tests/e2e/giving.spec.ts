import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const owner = { email: "", password: "Offering-Basket-2026", church: "" };
let finance = "";
let giver = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(({}, info) => {
  owner.email = `giving.${info.project.name}.${stamp}@example.com`;
  owner.church = `Cornerstone ${info.project.name} ${stamp}`;
  finance = `treasurer.${info.project.name}.${stamp}@example.com`;
  giver = `giver.${info.project.name}.${stamp}@example.com`;
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function openEmail(page: Page, to: string, subject: RegExp) {
  expect((await page.request.post("/api/test/run-jobs")).ok()).toBeTruthy();
  await page.goto("/dev/mailbox");
  await page
    .locator("aside a", { hasText: `to ${to}` })
    .filter({ hasText: subject })
    .first()
    .click();
  return (await page.locator("iframe").getAttribute("srcdoc")) ?? "";
}

test("one person counts a collection and a second person verifies it", async ({ page, browser }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(owner.church);
  await page.getByLabel("Your full name").fill("Pastor Kemi Ade");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/giving/batches");
  await page.getByRole("button", { name: "Count a collection" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Sunday First Service");
  await d.getByRole("button", { name: "Start counting" }).click();
  await expect(page).toHaveURL(/\/giving\/batches\/[0-9a-f-]{36}/);
  const batchUrl = new URL(page.url()).pathname;

  await page.getByLabel("Tithe Cash").fill("150000");
  await page.getByLabel("Offering Cash").fill("82500");
  await page.getByLabel("Offering POS").fill("40000");
  await expect(page.getByTestId("batch-total").first()).toContainText("272,500");
  await page.getByRole("button", { name: "Submit for verification" }).click();
  await expect(page.getByText("Waiting for verification").first()).toBeVisible();
  // the counter can't verify their own count
  await expect(page.getByRole("button", { name: /^Verify/ })).toHaveCount(0);

  // invite a finance officer, who verifies
  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Invite someone" }).click();
  await page.getByLabel("Full name").fill("Tola Treasurer");
  await page.getByLabel("Email").fill(finance);
  await page.getByLabel("Role").selectOption({ label: "Finance Officer" });
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${finance}`)).toBeVisible();
  const html = await openEmail(page, finance, /invited you/);
  const link = /href="([^"]*\/invite\/[^"]+)"/.exec(html)?.[1];
  expect(link).toBeTruthy();

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(new URL(link!).pathname);
  await p2.getByLabel("Choose a password").fill("Abuja-Cedar-Lamp-77");
  await p2.getByRole("button", { name: "Accept invitation" }).click();
  await expect(p2).toHaveURL(/\/dashboard/);
  await p2.goto(batchUrl);
  await p2.getByRole("button", { name: /Verify ₦272,500/ }).click();
  await expect(p2.getByText("Verified").first()).toBeVisible();
  await ctx2.close();

  await page.goto("/giving/transactions");
  await expect(page.getByText("₦150,000").first()).toBeVisible();
  await expect(page.getByText("₦82,500").first()).toBeVisible();
});

test("a member gives online, gets a receipt, and the gift can be reversed", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/giving/settings");
  const shown = (await page.locator("code", { hasText: "/give/" }).first().textContent())!;
  const givePath = shown.slice(shown.indexOf("/give/"));

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(givePath);
  await p2.getByText("Tithe", { exact: true }).click();
  await p2.getByLabel("Or enter an amount (₦)").fill("5000");
  // covering the fee is on by default; this giver doesn't
  await p2.getByLabel(/receives the full ₦5,000/).uncheck();
  await p2.getByLabel("Your name").fill("Ngozi Eze");
  await p2.getByLabel("Email for your receipt").fill(giver);
  await p2.getByRole("button", { name: /Give ₦5,000/ }).click();
  await expect(p2).toHaveURL(/\/pay\/BMC-/);
  await p2.getByRole("button", { name: "Pay ₦5,000" }).click();
  await expect(p2).toHaveURL(/\/thanks/);
  const receipt = (await p2.getByTestId("receipt-no").textContent())!.trim();
  expect(receipt).toMatch(/^R-\d{4}-\d{6}$/);
  await ctx2.close();

  const mail = await openEmail(page, giver, /Receipt/);
  expect(mail).toContain(receipt);
  expect(mail).toContain("Tithe");

  await page.goto("/giving/transactions?channel=online");
  await expect(page.getByText("Ngozi Eze").first()).toBeVisible();
  await page.getByRole("button", { name: /Actions for BMC-/ }).first().click();
  await page.getByRole("menuitem", { name: "Reverse" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Why are you reversing it?").fill("Duplicate payment, refunded from Paystack");
  await d.getByRole("button", { name: "Reverse" }).click();
  await expect(page.getByText("Reversed").first()).toBeVisible();
});
