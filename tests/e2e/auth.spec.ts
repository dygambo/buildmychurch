import { expect, test } from "@playwright/test";

const stamp = Date.now();
const owner = {
  church: `E2E Chapel ${stamp}`,
  name: "Pastor Ada Obi",
  email: `ada.${stamp}@example.com`,
  password: "Sunrise-Harvest-2026",
};

test.describe.configure({ mode: "serial" });

test("a church signs up, signs out and signs back in", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(owner.church);
  await page.getByLabel("Your full name").fill(owner.name);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Ada/ })).toBeVisible();
  await expect(page.getByText("Get your church set up")).toBeVisible();

  // sign out via the user menu (opens the mobile menu first on small screens)
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: new RegExp(owner.name) }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That email and password don't match an account.")).toBeVisible();
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("settings pages load and a staff invitation can be accepted", async ({ page, browser }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  for (const [path, text] of [
    ["/settings", "Church profile"],
    ["/settings/roles", "Finance Officer"],
    ["/settings/account", "Two-step verification"],
    ["/settings/audit", "Created " + owner.church],
    ["/branches", "Headquarters"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByText(text).first()).toBeVisible();
  }

  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Invite someone" }).click();
  const invitee = `funmi.${stamp}@example.com`;
  await page.getByLabel("Full name").fill("Funmi Adeyemi");
  await page.getByLabel("Email").fill(invitee);
  await page.getByLabel("Role").selectOption({ label: "Finance Officer" });
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${invitee}`)).toBeVisible();
  await expect(page.getByText("Pending invitations")).toBeVisible();

  // The worker isn't running in this test, so read the queued email straight from the dev mailbox after processing.
  const res = await page.request.post("/api/test/run-jobs");
  expect(res.ok()).toBeTruthy();
  await page.goto("/dev/mailbox");
  await page.getByText(`invited you to ${owner.church}`).first().click();
  const html = await page.locator("iframe").getAttribute("srcdoc");
  const link = /href="([^"]*\/invite\/[^"]+)"/.exec(html ?? "")?.[1];
  expect(link).toBeTruthy();

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(new URL(link!).pathname);
  await expect(p2.getByRole("heading", { name: `Join ${owner.church}` })).toBeVisible();
  await p2.getByLabel("Choose a password").fill("Kaduna-River-Lamp-42");
  await p2.getByRole("button", { name: "Accept invitation" }).click();
  await expect(p2).toHaveURL(/\/dashboard/);
  await expect(p2.getByRole("link", { name: "Giving", exact: true })).toBeAttached();
  await expect(p2.getByRole("link", { name: "Branches" })).toHaveCount(0);
  await expect(p2.getByText("Get your church set up")).toHaveCount(0);
  await ctx2.close();
});
