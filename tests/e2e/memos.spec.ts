import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let owner = "";
let admin = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(({}, info) => {
  owner = `memo-owner.${info.project.name}.${stamp}@example.com`;
  admin = `memo-admin.${info.project.name}.${stamp}@example.com`;
});

async function openEmail(page: Page, to: string, subject: RegExp) {
  expect((await page.request.post("/api/test/run-jobs")).ok()).toBeTruthy();
  await page.goto("/dev/mailbox");
  await page.locator("aside a", { hasText: `to ${to}` }).filter({ hasText: subject }).first().click();
  return (await page.locator("iframe").getAttribute("srcdoc")) ?? "";
}

test("a memo is raised, queried, answered, approved with a stamp, and paid", async ({ page, browser }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Shiloh Tabernacle ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Yemi Cole");
  await page.getByLabel("Email").fill(owner);
  await page.getByLabel("Password").fill("Memo-Route-Approve-26");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // a church administrator to approve
  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Invite by email" }).click();
  await page.getByLabel("Full name").fill("Sis. Ronke Admin");
  await page.getByLabel("Email").fill(admin);
  await page.getByLabel("Role").selectOption({ label: "Church Administrator" });
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${admin}`)).toBeVisible();
  const invite = await openEmail(page, admin, /invited you/);
  const link = /href="([^"]*\/invite\/[^"]+)"/.exec(invite)![1]!;
  const ctx2 = await browser.newContext();
  const ap = await ctx2.newPage();
  await ap.goto(new URL(link).pathname);
  await ap.getByLabel("Choose a password").fill("Admin-Desk-Lagos-77");
  await ap.getByRole("button", { name: "Accept invitation" }).click();
  await expect(ap).toHaveURL(/\/dashboard/);

  // raise a memo from a template
  await page.goto("/memos/new");
  await page.getByRole("radio", { name: "Requisition for funds" }).click();
  await page.getByLabel("Subject").fill("Request for funds: Youth Week publicity");
  await page.getByLabel("Amount requested (₦)").fill("30000");
  await expect(page.getByTestId("memo-path")).toContainText("Church Administrator");
  await expect(page.getByTestId("memo-path")).not.toContainText("Senior Pastor");
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page).toHaveURL(/\/memos\/[0-9a-f-]{36}/);
  const memoUrl = new URL(page.url()).pathname;
  await expect(page.getByTestId("memo-ref")).toHaveText(/^[A-Z0-9]+\/MEMO\/\d{4}\/001$/);

  const mail = await openEmail(page, admin, /needs your approval/);
  expect(mail).toContain("Youth Week publicity");

  // the administrator queries it
  await ap.goto("/memos");
  await ap.getByRole("link", { name: "Request for funds: Youth Week publicity" }).click();
  await ap.getByRole("button", { name: "Query" }).click();
  await ap.getByRole("dialog").getByLabel("Your question").fill("Please attach the printer's quote");
  await ap.getByRole("dialog").getByRole("button", { name: "Send query" }).click();
  await expect(ap.getByText("Query raised").first()).toBeVisible();

  // the initiator answers
  await page.goto(memoUrl);
  await expect(page.getByText("Please attach the printer's quote").first()).toBeVisible();
  await page.getByRole("button", { name: "Answer the query" }).click();
  await page.getByRole("dialog").getByLabel("Your answer").fill("Quote attached: N30,000 for 500 flyers and 4 banners");
  await page.getByRole("dialog").getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Answer the query" })).toHaveCount(0);

  // approval with a stamp
  await ap.goto(memoUrl);
  await ap.getByLabel("Comment with your approval").fill("Thanks, approved.");
  await ap.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(ap.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(ap.getByTestId("stamp")).toContainText("Sis. Ronke Admin");
  await ctx2.close();

  // finance (the Super Admin here) records the payment and it lands in expenses
  await page.goto(memoUrl);
  await page.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog");
  await pay.getByLabel("Reference").fill("FT77001");
  await pay.getByLabel("Add to expenses as").selectOption({ label: "Ministry & programmes" });
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("link", { name: /Expense E-/ })).toBeVisible();
  const pdf = await page.request.get(`${memoUrl}/pdf`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  await page.goto("/expenses/list?status=paid");
  await expect(page.getByText("Youth Week publicity").first()).toBeVisible();
});
