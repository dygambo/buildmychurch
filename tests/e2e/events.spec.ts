import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let owner = "";
let guest = "";
let buyer = "";
let usher = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(({}, info) => {
  owner = `events.${info.project.name}.${stamp}@example.com`;
  guest = `guest.${info.project.name}.${stamp}@example.com`;
  buyer = `buyer.${info.project.name}.${stamp}@example.com`;
  usher = `usher.${info.project.name}.${stamp}@example.com`;
});

async function openEmail(page: Page, to: string, subject: RegExp) {
  expect((await page.request.post("/api/test/run-jobs")).ok()).toBeTruthy();
  await page.goto("/dev/mailbox");
  await page.locator("aside a", { hasText: `to ${to}` }).filter({ hasText: subject }).first().click();
  return (await page.locator("iframe").getAttribute("srcdoc")) ?? "";
}

const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test("an event takes free and paid registrations, and people check in at the door", async ({ page, browser }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Bethel Assembly ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Kunle Ade");
  await page.getByLabel("Email").fill(owner);
  await page.getByLabel("Password").fill("Events-And-Rota-2026");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/events");
  await page.getByRole("button", { name: "New event" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Event name").fill("Youth Conference: Unshaken");
  await d.getByLabel("Starts").fill(`${inDays(14)}T09:00`);
  await d.getByLabel("Venue").fill("Main auditorium");
  await d.getByLabel("Total places").fill("100");
  await d.getByRole("button", { name: "Add ticket type" }).click();
  await d.locator("#tk-n-1").fill("Conference pack");
  await d.locator("#tk-p-1").fill("50");
  await d.getByRole("button", { name: "Create event" }).click();
  await expect(d.getByText("Paid tickets start at ₦100.")).toBeVisible();
  await d.locator("#tk-p-1").fill("2500");
  await d.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  const eventUrl = new URL(page.url()).pathname;

  await page.getByRole("button", { name: "Open registration" }).click();
  await expect(page.getByTestId("event-link")).toBeVisible();
  const link = new URL((await page.getByRole("link", { name: "Open" }).getAttribute("href"))!).pathname;

  // a free registration for two goes straight to the ticket
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(link);
  await expect(p2.getByRole("heading", { name: "Youth Conference: Unshaken" })).toBeVisible();
  await p2.getByRole("button", { name: "More" }).click();
  await expect(p2.getByTestId("qty")).toHaveText("2");
  await p2.getByLabel("Your full name").fill("Funmi Bello");
  await p2.getByLabel("Email for your ticket").fill(guest);
  await p2.getByRole("button", { name: "Register" }).click();
  await expect(p2).toHaveURL(/\/t\/[A-Z0-9]+$/);
  const code = (await p2.getByTestId("ticket-code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{6,12}$/);

  // a paid ticket goes through checkout, then lands in giving
  await p2.goto(link);
  await p2.getByRole("radio", { name: /Conference pack/ }).check();
  await p2.getByLabel("Your full name").fill("Obinna Okeke");
  await p2.getByLabel("Email for your ticket").fill(buyer);
  await p2.getByRole("button", { name: "Pay ₦2,500" }).click();
  await expect(p2).toHaveURL(/\/pay\/BMC-/);
  await p2.getByRole("button", { name: "Pay ₦2,500" }).click();
  await expect(p2.getByTestId("ticket-code")).toBeVisible();
  await ctx2.close();

  const mail = await openEmail(page, guest, /Your ticket/);
  expect(mail).toContain(code);
  await openEmail(page, buyer, /Your ticket/);

  await page.goto(eventUrl);
  await expect(page.getByText("Funmi Bello")).toBeVisible();
  await expect(page.getByText("Obinna Okeke")).toBeVisible();
  await expect(page.getByText("₦2,500").first()).toBeVisible();

  // check-in by code, once only for the party size
  await page.getByRole("link", { name: "Check-in" }).click();
  await page.getByLabel("Ticket code").fill(code);
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.getByTestId("checkin-result")).toContainText("Welcome, Funmi Bello");
  await expect(page.getByTestId("checkin-result")).toContainText("2 × General admission admitted");
  await page.getByLabel("Ticket code").fill(code);
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.getByTestId("checkin-result")).not.toContainText("Welcome");

  // a walk-in
  await page.getByLabel("Name", { exact: true }).fill("Bro. Sunday Etim");
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByText(/Bro\. Sunday Etim/).first()).toBeVisible();

  const csv = await page.request.get(`${eventUrl}/export`);
  expect(csv.ok()).toBeTruthy();
});

test("the rota fills fairly and a volunteer confirms from their email", async ({ page, browser }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner);
  await page.getByLabel("Password").fill("Events-And-Rota-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  for (const [first, last, email] of [
    ["Ada", "Usher", usher],
    ["Bayo", "Usher", ""],
  ]) {
    await page.goto("/members");
    await page.getByRole("button", { name: "Add member" }).first().click();
    const d = page.getByRole("dialog");
    await d.getByLabel("First name").fill(first!);
    await d.getByLabel("Surname").fill(last!);
    await d.getByLabel("Gender").selectOption(first === "Ada" ? "female" : "male");
    await d.getByLabel("Phone").fill(`081${String(Date.now()).slice(-8)}`);
    if (email) await d.locator("#m-email").fill(email);
    await d.getByRole("button", { name: "Add member" }).click();
    await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}/);
  }

  await page.goto("/groups");
  await page.getByRole("button", { name: "Add department" }).first().click();
  await page.getByRole("dialog").getByLabel("Name").fill("Ushering");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Ushering" })).toBeVisible();
  for (const n of ["Ada", "Bayo"]) {
    await page.getByRole("combobox", { name: /Add someone/ }).fill(n);
    await page.getByRole("option", { name: new RegExp(`${n} Usher`) }).click();
    await expect(page.getByRole("link", { name: new RegExp(`${n} Usher`) }).first()).toBeVisible();
  }

  await page.goto("/rota");
  await page.getByRole("button", { name: "Fill the rota" }).click();
  const f = page.getByRole("dialog");
  await f.getByLabel("Positions").fill("Main door, Gallery");
  await f.getByRole("button", { name: "Fill", exact: true }).click();
  await expect(f).toHaveCount(0);
  const grid = page.getByTestId("rota-Ushering");
  await expect(grid.getByRole("cell", { name: "Main door" })).toBeVisible();
  // nobody serves twice in one service: each Sunday has Ada and Bayo, one per position
  const first = await grid.getByRole("combobox").nth(0).inputValue();
  const second = await grid.getByRole("combobox").nth(4).inputValue();
  expect(first).not.toBe(second);

  const mail = await openEmail(page, usher, /You're serving/);
  const respond = /href="([^"]*\/r\/[^"]+)"/.exec(mail)![1]!;
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(new URL(respond).pathname);
  await p2.getByRole("button", { name: "I'll be there" }).click();
  await expect(p2.getByText(/you're confirmed/)).toBeVisible();
  await ctx2.close();

  await page.goto("/rota");
  await expect(page.getByTestId("rota-Ushering").getByText("✓").first()).toBeVisible();
});
