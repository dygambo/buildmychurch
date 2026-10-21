import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function lastEmail(page: Page, to: string, subject: RegExp) {
  expect((await page.request.post("/api/test/run-jobs")).ok()).toBeTruthy();
  await page.goto("/dev/mailbox");
  await page.locator("aside a", { hasText: `to ${to}` }).filter({ hasText: subject }).first().click();
  return (await page.locator("iframe").getAttribute("srcdoc")) ?? "";
}
const tempIn = (html: string) => /Temporary password: <b[^>]*>([^<]+)<\/b>/.exec(html)![1]!;

test("an admin adds a member to the team; they sign in with the emailed password and choose their own; reset, suspend and remove work", async ({ page, browser }, info) => {
  const staff = `team.${info.project.name}.${stamp}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Team Test Chapel ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Team");
  await page.getByLabel("Email").fill(`owner.${staff}`);
  await page.getByLabel("Password").fill("Team-Admin-Owner-2026");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/members");
  await page.getByRole("button", { name: "Add member" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("First name").fill("Kemi");
  await d.getByLabel("Surname").fill("Balogun");
  await d.getByLabel("Gender").selectOption("female");
  await d.getByLabel("Phone").fill(`080${String(Date.now()).slice(-8)}`);
  await d.locator("#m-email").fill(staff);
  await d.getByRole("button", { name: "Add member" }).click();
  await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}/);

  // add from the members directory
  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Add from members" }).click();
  const a = page.getByRole("dialog");
  await a.getByRole("combobox", { name: /Search members/ }).fill("Kemi");
  await a.getByRole("option", { name: /Kemi Balogun/ }).click();
  await expect(a.getByLabel("Email for signing in")).toHaveValue(staff);
  await a.getByLabel("Role").selectOption({ label: "Church Administrator" });
  await a.getByLabel("Job title").fill("Church Secretary");
  await a.getByRole("button", { name: "Add to team" }).click();
  await expect(page.getByText(/Kemi Balogun is on the team/)).toBeVisible();
  const row = page.getByRole("row", { name: /Kemi Balogun/ });
  await expect(row).toContainText("Hasn't signed in yet");
  await expect(row.getByRole("link", { name: "Member profile" })).toBeVisible();

  const welcome = await lastEmail(page, staff, /added to the .* team/);
  expect(welcome).toContain("Church Administrator");
  const temp = tempIn(welcome);

  // first sign-in forces a new password
  const ctx2 = await browser.newContext();
  const s = await ctx2.newPage();
  await s.goto("/sign-in");
  await s.getByLabel("Email").fill(staff);
  await s.getByLabel("Password").fill(temp);
  await s.getByRole("button", { name: "Sign in" }).click();
  await expect(s).toHaveURL(/\/change-password/);
  await s.goto("/members");
  await expect(s).toHaveURL(/\/change-password/);
  await s.getByLabel("New password").fill("Kemi-Secretary-Desk-26");
  await s.getByLabel("Type it again").fill("Kemi-Secretary-Desk-26");
  await s.getByRole("button", { name: "Save and continue" }).click();
  await expect(s).toHaveURL(/\/dashboard/);

  // reset password: signed out, new temporary password by email
  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Actions for Kemi Balogun" }).click();
  await page.getByRole("menuitem", { name: "Reset password" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText(/New temporary password emailed/)).toBeVisible();
  const temp2 = tempIn(await lastEmail(page, staff, /password was reset/));
  expect(temp2).not.toBe(temp);
  await s.goto("/members");
  await expect(s).toHaveURL(/\/sign-in/);

  // suspend: sign-in is refused with a clear message
  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Actions for Kemi Balogun" }).click();
  await page.getByRole("menuitem", { name: "Suspend access" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Suspend access" }).click();
  await expect(page.getByRole("row", { name: /Kemi Balogun/ })).toContainText("Suspended");
  await s.goto("/sign-in");
  await s.getByLabel("Email").fill(staff);
  await s.getByLabel("Password").fill(temp2);
  await s.getByRole("button", { name: "Sign in" }).click();
  await expect(s.getByText(/is paused/)).toBeVisible();
  await ctx2.close();

  // remove from the team, keeping the member record
  await page.getByRole("button", { name: "Actions for Kemi Balogun" }).click();
  await page.getByRole("menuitem", { name: "Remove from team" }).click();
  await page.getByRole("dialog").getByLabel("Reason").fill("Stepping down");
  await page.getByRole("dialog").getByRole("button", { name: "Remove from team" }).click();
  await expect(page.getByText(/Their member record is unchanged/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Kemi Balogun/ })).toHaveCount(0);
  await page.goto("/members?q=Kemi");
  await expect(page.getByRole("link", { name: /Kemi Balogun/ }).first()).toBeVisible();
});
