import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const owner = { email: "", password: "Treasury-Lamp-2026", church: "" };
let finance = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(({}, info) => {
  owner.email = `finance-owner.${info.project.name}.${stamp}@example.com`;
  owner.church = `Bethel ${info.project.name} ${stamp}`;
  finance = `accountant.${info.project.name}.${stamp}@example.com`;
});

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

test("an accountant raises an expense, the pastor approves it, and it's paid with the receipt attached", async ({
  page,
  browser,
}) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(owner.church);
  await page.getByLabel("Your full name").fill("Pastor Femi Ojo");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Invite someone" }).click();
  await page.getByLabel("Full name").fill("Kemi Accountant");
  await page.getByLabel("Email").fill(finance);
  await page.getByLabel("Role").selectOption({ label: "Finance Officer" });
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${finance}`)).toBeVisible();
  const invite = await openEmail(page, finance, /invited you/);
  const link = /href="([^"]*\/invite\/[^"]+)"/.exec(invite)?.[1];

  const ctx2 = await browser.newContext();
  const acc = await ctx2.newPage();
  await acc.goto(new URL(link!).pathname);
  await acc.getByLabel("Choose a password").fill("Jos-Plateau-Ledger-31");
  await acc.getByRole("button", { name: "Accept invitation" }).click();
  await expect(acc).toHaveURL(/\/dashboard/);

  // a small expense approves itself
  await acc.goto("/expenses/list");
  await acc.getByRole("button", { name: "Record expense" }).first().click();
  let d = acc.getByRole("dialog");
  await d.getByLabel("Paid to").fill("Total Filling Station");
  await d.getByLabel("What for").fill("Diesel for Sunday services");
  await d.getByLabel("Amount (₦)").fill("35000");
  await d.getByLabel("Category").selectOption({ label: "Utilities, fuel & diesel" });
  await d.getByLabel("How it was or will be paid").selectOption("cash");
  await d.getByRole("button", { name: "Save and submit" }).click();
  await expect(acc).toHaveURL(/\/expenses\/[0-9a-f-]{36}/);
  await expect(acc.getByText("Approved, not paid").first()).toBeVisible();
  await expect(acc.getByText(/Approved automatically/)).toBeVisible();

  // a large one needs the pastor
  await acc.goto("/expenses/list");
  await acc.getByRole("button", { name: "Record expense" }).first().click();
  d = acc.getByRole("dialog");
  await d.getByLabel("Paid to").fill("Sound Solutions Ltd");
  await d.getByLabel("What for").fill("Two wireless microphones");
  await d.getByLabel("Amount (₦)").fill("480,000");
  await d.getByLabel("Category").selectOption({ label: "Equipment & instruments" });
  await d.getByRole("button", { name: "Save and submit" }).click();
  await expect(acc).toHaveURL(/\/expenses\/[0-9a-f-]{36}/);
  const expenseUrl = new URL(acc.url()).pathname;
  await expect(acc.getByText("Waiting for approval").first()).toBeVisible();
  await expect(acc.getByRole("button", { name: /^Approve/ })).toHaveCount(0);

  // the receipt goes on before approval
  await acc.getByLabel("Attach receipt").setInputFiles({
    name: "invoice.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
  });
  await expect(acc.getByRole("link", { name: "invoice.pdf" })).toBeVisible();
  // anything that isn't really a PDF or photo is refused
  await acc.getByLabel("Attach receipt").setInputFiles({
    name: "receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("<html><script>alert(1)</script></html>"),
  });
  await expect(acc.getByText("Upload a PDF or a photo")).toBeVisible();

  // the pastor is emailed and approves
  const mail = await openEmail(page, owner.email, /Approve ₦480,000/);
  expect(mail).toContain("Kemi Accountant raised expense");
  await page.goto(expenseUrl);
  await page.getByRole("button", { name: "Approve ₦480,000" }).click();
  await expect(page.getByText("Approved by Pastor Femi Ojo")).toBeVisible();

  // the accountant pays it
  await acc.reload();
  await acc.getByRole("button", { name: "Mark paid" }).click();
  const pay = acc.getByRole("dialog");
  await pay.getByRole("button", { name: "Mark paid" }).click();
  await expect(pay.getByText("Enter the reference from the bank.")).toBeVisible();
  await pay.getByLabel("Reference").fill("FT26101500042");
  await pay.getByRole("button", { name: "Mark paid" }).click();
  await expect(acc.getByText("Paid by Kemi Accountant")).toBeVisible();
  await expect(acc.getByRole("button", { name: /Remove invoice.pdf/ })).toHaveCount(0);
  const file = await acc.request.get((await acc.getByRole("link", { name: "invoice.pdf" }).getAttribute("href"))!);
  expect(file.headers()["content-type"]).toBe("application/pdf");
  await ctx2.close();

  // it counts in the accounts and the export
  await page.goto("/expenses");
  await expect(page.getByText("₦480,000").first()).toBeVisible();
  const xlsx = await page.request.get("/expenses/list/export?format=csv");
  const csv = await xlsx.text();
  expect(csv).toContain("Sound Solutions Ltd");
  expect(csv).toContain("FT26101500042");
});
