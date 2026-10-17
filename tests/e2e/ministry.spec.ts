import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const owner = { email: "", password: "Sunrise-Harvest-2026" };
let mum = "";

test.describe.configure({ mode: "serial" });
// unique per device project, so the desktop and mobile runs never collide
test.beforeAll(({}, info) => {
  owner.email = `ministry.${info.project.name}.${stamp}@example.com`;
  mum = `mum.${info.project.name}.${stamp}@example.com`;
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** The worker isn't running during browser tests, so process queued emails, then open the newest one sent to `to`. */
async function lastEmailTo(page: Page, to: string, subject: RegExp) {
  expect((await page.request.post("/api/test/run-jobs")).ok()).toBeTruthy();
  await page.goto("/dev/mailbox");
  await page
    .locator("aside a", { hasText: `to ${to}` })
    .filter({ hasText: subject })
    .first()
    .click();
  return (await page.locator("iframe").getAttribute("srcdoc")) ?? "";
}

test("register a child, check in and out at the desk, and the parent is emailed who did it", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Ministry Chapel ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Grace Obi");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/children");
  await page.getByRole("button", { name: "Register child" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("First name", { exact: true }).fill("Chidi");
  await d.getByLabel("Surname", { exact: true }).fill("Okafor");
  await d.getByLabel("Gender").selectOption("male");
  await d.getByLabel("Date of birth").fill(`${new Date().getFullYear() - 6}-03-10`);
  await d.getByLabel("Guardian 1 first name").fill("Ada");
  await d.getByLabel("Guardian 1 surname").fill("Okafor");
  await d.getByLabel("Guardian 1 relationship").fill("Mother");
  await d.getByLabel("Guardian 1 phone").fill("0803 222 1111");
  await d.getByLabel("Guardian 1 email").fill(mum);
  await d.getByRole("button", { name: "Add another guardian" }).click();
  await d.getByLabel("Guardian 2 first name").fill("Joy");
  await d.getByLabel("Guardian 2 surname").fill("Nnaji");
  await d.getByLabel("Guardian 2 relationship").fill("Aunt");
  await d.getByLabel("Can pick the child up").nth(1).uncheck();
  await d.getByLabel("Allergies").fill("Peanuts");
  await d.getByRole("button", { name: "Register child" }).click();

  await expect(page).toHaveURL(/\/children\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Chidi Okafor" })).toBeVisible();
  await expect(page.getByText("Allergies: Peanuts")).toBeVisible();
  await expect(page.getByRole("img", { name: "QR tag for Chidi Okafor" })).toBeVisible();

  // check in from the desk by searching
  await page.goto("/children/desk");
  await page.getByLabel("Search children").fill("Chid");
  await page.getByRole("button", { name: /Chidi Okafor/ }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText("Allergies: Peanuts")).toBeVisible();
  await dlg.getByLabel(/Ada Okafor/).check();
  await dlg.getByRole("button", { name: "Check in" }).click();
  const code = (await page.getByTestId("pickup-code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{4}$/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`Chidi Okafor.*${code}`) })).toBeVisible();

  const inMail = await lastEmailTo(page, mum, /checked in/);
  expect(inMail).toContain("Pastor Grace Obi, Super Admin");
  expect(inMail).toContain("Ada Okafor (Mother)");
  expect(inMail).toContain(code);

  // the aunt isn't on the pickup list; the mother collects with the code
  await page.goto("/children/desk");
  await page.getByRole("button", { name: /Chidi Okafor/ }).click();
  await dlg.getByLabel(/Joy Nnaji/).check();
  await expect(dlg.getByText("Not on pickup list")).toBeVisible();
  await dlg.getByLabel(/Ada Okafor/).check();
  await dlg.getByLabel(/Pickup code/).fill("ZZZZ");
  await dlg.getByRole("button", { name: "Check out" }).click();
  await expect(page.getByText(/pickup code doesn't match/)).toBeVisible();
  await dlg.getByLabel(/Pickup code/).fill(code);
  await dlg.getByRole("button", { name: "Check out" }).click();
  await expect(page.getByText(/released to Ada Okafor/)).toBeVisible();
  await expect(page.getByText("No children checked in")).toBeVisible();

  const outMail = await lastEmailTo(page, mum, /picked up/);
  expect(outMail).toContain("Picked up by");
  expect(outMail).toContain("Ada Okafor (Mother)");

  // records: listed, exportable, and the chain verifies
  await page.goto("/children/records");
  await expect(page.getByRole("link", { name: "Chidi Okafor" })).toBeVisible();
  await page.getByRole("button", { name: "Verify records" }).click();
  await expect(page.getByText(/All 2 check-in and check-out records are intact/)).toBeVisible();
  const csv = await page.request.get("/children/records/export");
  expect(csv.status()).toBe(200);
  const body = await csv.text();
  expect(body).toContain("Chidi Okafor");
  expect(body).toContain("Ada Okafor (Mother)");
});

test("a visitor fills the card on their phone and lands on the follow-up board", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/follow-up");
  await page.getByRole("button", { name: "Visitor card" }).click();
  await expect(page.getByRole("img", { name: "Visitor card QR code" })).toBeVisible();
  await page
    .getByRole("button", { name: "Copy link" })
    .click()
    .catch(() => {});
  const html = await page.content();
  const token = /\/welcome\/([A-Za-z0-9_-]{16})/.exec(html)?.[1];
  expect(token).toBeTruthy();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const v = await phone.newPage();
  await v.goto(`/welcome/${token}`);
  await v.getByLabel("First name").fill("Tolani");
  await v.getByLabel("Surname").fill("Bakare");
  await v.getByLabel("Phone number").fill("0802 555 0101");
  await v.getByLabel("Gender").selectOption("female");
  await v.getByLabel("How can we pray for you?").fill("For my new job");
  await v.getByLabel(/visit me/).check();
  await v.getByRole("button", { name: "Send" }).click();
  await expect(v.getByText("Thank you, Tolani!")).toBeVisible();
  await phone.close();

  await page.goto("/follow-up");
  await page.getByRole("button", { name: /Tolani Bakare/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("For my new job")).toBeVisible();
  await drawer.getByRole("textbox", { name: "Notes" }).fill("Called her, she'll come Sunday");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer.getByText("Called her, she'll come Sunday")).toBeVisible();
  await expect(drawer.getByLabel("Stage")).toHaveValue("contacted");
});

test("members check themselves in with the service QR code", async ({ page, browser }) => {
  await signIn(page);
  // a member to check in
  await page.goto("/members");
  await page.getByRole("button", { name: "Add member" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("First name").fill("Bayo");
  await d.getByLabel("Surname").fill("Adeyemi");
  await d.getByLabel("Gender").selectOption("male");
  await d.getByLabel("Phone").fill("0809 123 4567");
  await d.getByRole("button", { name: "Add member" }).click();
  await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}/);

  // a service starting now
  await page.goto("/attendance");
  await page.getByRole("button", { name: "One-off service" }).click();
  const s = page.getByRole("dialog");
  await s.getByLabel("Name").fill("Prayer Meeting");
  const now = new Date(Date.now() + 3600_000).toISOString().slice(11, 16);
  await s.getByLabel("Starts").fill(now);
  await s.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: /Prayer Meeting/ })).toBeVisible();
  await page.getByRole("button", { name: /self check-in QR/ }).click();
  await expect(page.getByRole("img", { name: "Self check-in QR code" })).toBeVisible();
  const token = /\/c\/([A-Za-z0-9_-]{24})/.exec(await page.content())?.[1];
  expect(token).toBeTruthy();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await phone.newPage();
  await m.goto(`/c/${token}`);
  await expect(m.getByRole("heading", { name: "Prayer Meeting" })).toBeVisible();
  await m.getByLabel("Your phone number").fill("0701 000 0000");
  await m.getByRole("button", { name: "Check in" }).click();
  await expect(m.getByText(/couldn't find that number/)).toBeVisible();
  await m.getByLabel("Your phone number").fill("+234 809 123 4567");
  await m.getByRole("button", { name: "Check in" }).click();
  await expect(m.getByText("Welcome, Bayo! You're checked in.")).toBeVisible();
  await phone.close();

  await page.reload();
  await expect(page.getByText("1 checked in")).toBeVisible();
  await expect(page.getByRole("link", { name: /Bayo Adeyemi/ })).toBeVisible();
});
