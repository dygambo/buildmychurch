import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let email = "";
let minister = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(({}, info) => {
  email = `sched.${info.project.name}.${stamp}@example.com`;
  minister = `minister.${info.project.name}.${stamp}@example.com`;
});

async function runJobs(page: Page) {
  expect((await page.request.post("/api/test/run-jobs")).ok()).toBeTruthy();
}

test("plan a service, assign people, publish with a PDF, and the minister gets their part", async ({ page, browser }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Rehoboth Chapel ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Dayo Ojo");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Order-Of-Service-2026");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/members");
  await page.getByRole("button", { name: "Add member" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("First name").fill("Grace");
  await d.getByLabel("Surname").fill("Adeleke");
  await d.getByLabel("Gender").selectOption("female");
  await d.getByLabel("Phone").fill(`080${String(Date.now()).slice(-8)}`);
  await d.locator("#m-email").fill(minister);
  await d.getByRole("button", { name: "Add member" }).click();
  await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}/);

  // start from the Sunday template
  await page.goto("/schedules");
  await page.getByRole("button", { name: "New schedule" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/schedules\/[0-9a-f-]{36}$/);
  const url = new URL(page.url()).pathname;
  await expect(page.getByTestId("programme-item")).toHaveCount(10);

  await page.getByLabel("Title").fill("Thanksgiving Sunday");
  // the sermon goes to Grace
  await page.getByRole("button", { name: "+ Assign" }).nth(6).click();
  await page.getByLabel("Find someone for Sermon").fill("Grace");
  await page.getByRole("option", { name: /Grace Adeleke/ }).click();
  await page.getByLabel("Grace Adeleke's responsibility").fill("Minister");
  // a guest typed in by name
  await page.getByRole("button", { name: "+ Assign" }).nth(3).click();
  await page.getByLabel("Find someone for Choir ministration").fill("Voices of Zion");
  await page.getByRole("option", { name: /Add “Voices of Zion”/ }).click();
  // add an item and move it up
  await page.getByRole("button", { name: "+ Testimonies" }).click();
  await page.getByRole("button", { name: "Move Testimonies up" }).click();
  await expect(page.getByTestId("live-preview")).toContainText("Testimonies");
  await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
  // an impossible duration is caught before saving
  await page.getByLabel("Item 1 minutes").fill("0");
  await expect(page.getByText("Use whole minutes, from 1 to 720.").first()).toBeVisible();
  await page.getByLabel("Item 1 minutes").fill("10");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("save-state")).toHaveText("Draft saved");

  // PDF preview works before publishing
  const preview = await page.request.get(`${url}/pdf?preview=1`);
  expect(preview.headers()["content-type"]).toBe("application/pdf");
  expect((await preview.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText("Grace Adeleke")).toBeVisible();
  await expect(dlg.getByText("Voices of Zion")).toHaveCount(0);
  await dlg.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("save-state")).toContainText("Version 1 published");

  await page.goto(`${url}?tab=history`);
  await expect(page.getByText("First published with 11 items")).toBeVisible();
  // the worker makes the PDF, then sends the notifications
  await expect(async () => {
    await runJobs(page);
    await page.reload();
    await expect(page.getByRole("link", { name: "v1.pdf" })).toBeVisible({ timeout: 1000 });
    await expect(page.getByText("Accepted by the email provider")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("cell", { name: /Grace Adeleke/ })).toBeVisible();

  await page.goto("/dev/mailbox");
  await page.locator("aside a", { hasText: `to ${minister}` }).filter({ hasText: "Thanksgiving Sunday" }).first().click();
  const html = (await page.locator("iframe").getAttribute("srcdoc")) ?? "";
  expect(html).toContain("Sermon at");
  expect(html).toContain("(Minister)");
  const link = /href="([^"]*\/s\/[^"]+)"/.exec(html)?.[1];
  expect(link).toBeTruthy();

  // the share link works without an account and hides private notes
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(new URL(link!).pathname);
  await expect(p2.getByRole("heading", { name: "Thanksgiving Sunday" })).toBeVisible();
  await expect(p2.getByText("Grace Adeleke (Minister)")).toBeVisible();
  const pdf = await p2.request.get(`${new URL(link!).pathname}/pdf`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  await ctx2.close();

  // change only the opening prayer time: no one assigned there, so no one is told
  await page.goto(url);
  await page.getByLabel("Item 2 minutes").fill("30");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Publish to send version 2/)).toBeVisible();
  await page.getByRole("button", { name: /Publish update \(v2\)/ }).click();
  await expect(page.getByRole("dialog").getByText(/Only the people whose part changed/)).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Grace Adeleke")).toBeVisible(); // her sermon time moved
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/Updated · v2/)).toBeVisible();

  // it shows up in the archive search by person
  await page.goto("/schedules?person=Adeleke");
  await expect(page.getByRole("link", { name: "Thanksgiving Sunday" }).first()).toBeVisible();
});
