import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let owner = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(({}, info) => {
  owner = `care.${info.project.name}.${stamp}@example.com`;
});

async function signUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Mount Zion Chapel ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Femi Ajayi");
  await page.getByLabel("Email").fill(owner);
  await page.getByLabel("Password").fill("Prayer-Care-Forms-26");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner);
  await page.getByLabel("Password").fill("Prayer-Care-Forms-26");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("a prayer request comes in from the public page, is prayed for and answered; a care record logs a visit and welfare", async ({ page, browser }) => {
  await signUp(page);

  await page.goto("/care");
  await page.getByRole("button", { name: "Prayer page" }).click();
  const link = new URL((await page.getByRole("dialog").getByRole("link", { name: "Open" }).getAttribute("href"))!).pathname;
  await page.keyboard.press("Escape");

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(link);
  await expect(p2.getByRole("heading", { name: "How can we pray with you?" })).toBeVisible();
  await p2.getByLabel("Your prayer request").fill("Please pray for my father's surgery at UCH on Friday.");
  await p2.getByLabel("What is it about?").selectOption("healing");
  await p2.getByLabel("Your name", { exact: false }).fill("Halima Usman");
  await p2.getByLabel("I'd like someone from the church to contact me").check();
  await p2.getByRole("button", { name: "Send prayer request" }).click();
  await expect(p2.getByText("Add a phone number or email")).toBeVisible();
  await p2.getByLabel("Phone").fill("0803 777 1234");
  await p2.getByRole("button", { name: "Send prayer request" }).click();
  await expect(p2.getByRole("heading", { name: "We're praying with you" })).toBeVisible();
  await ctx2.close();

  await page.goto("/care");
  const card = page.getByRole("article", { name: "Prayer request from Halima Usman" });
  await expect(card).toContainText("UCH on Friday");
  await expect(card).toContainText("Wants someone to reach out");
  await card.getByRole("button", { name: "I prayed" }).click();
  await expect(card).toContainText("Prayed 1×");
  await card.getByRole("button", { name: "Answered" }).click();
  await page.getByRole("dialog").getByLabel("Testimony").fill("The surgery went well. Baba is home.");
  await page.getByRole("dialog").getByRole("button", { name: "Mark answered" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Prayer request from Halima Usman" })).toHaveCount(0);
  await page.getByLabel("Status").selectOption("answered");
  await expect(page.getByRole("article", { name: "Prayer request from Halima Usman" })).toContainText("Baba is home");

  // a member to care for
  await page.goto("/members");
  await page.getByRole("button", { name: "Add member" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("First name").fill("Musa");
  await d.getByLabel("Surname").fill("Garba");
  await d.getByLabel("Gender").selectOption("male");
  await d.getByLabel("Phone").fill(`080${String(Date.now()).slice(-8)}`);
  await d.getByRole("button", { name: "Add member" }).click();
  await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}/);

  await page.goto("/care?tab=cases");
  await page.getByRole("button", { name: "New care record" }).click();
  const c = page.getByRole("dialog");
  await c.getByRole("combobox", { name: "Find the member" }).fill("Musa");
  await c.getByRole("option", { name: /Musa Garba/ }).click();
  await c.getByLabel("What's happening").selectOption("hospital");
  await c.getByLabel("Priority").selectOption("urgent");
  await c.getByLabel("Short description").fill("Admitted at the General Hospital, Garki");
  await c.locator("#cs-next").fill("Visit on Saturday");
  await c.getByRole("button", { name: "Open record" }).click();
  await expect(page).toHaveURL(/\/care\/cases\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Musa Garba" })).toBeVisible();

  await page.getByRole("button", { name: "A visit" }).click();
  await page.getByRole("dialog").getByLabel("What happened").fill("Visited with Elder Bello. Responding to treatment.");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("care-history")).toContainText("Responding to treatment");

  await page.getByRole("button", { name: "Welfare given" }).click();
  const w = page.getByRole("dialog");
  await w.getByLabel("What was given").selectOption("hospital_bill");
  await w.getByRole("button", { name: "Save" }).click();
  await expect(w.getByText("Enter the amount given.")).toBeVisible();
  await w.getByLabel("Amount or value (₦)").fill("45,000");
  await w.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("care-history")).toContainText("Hospital bill: ₦45,000");

  await page.goto("/care?tab=cases");
  await expect(page.getByRole("row", { name: /Musa Garba/ })).toContainText("₦45,000");
  await expect(page.getByText("₦45,000").first()).toBeVisible();
});

test("a form is built from a template, opened, filled on a phone, and the answers are tallied and exported", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/forms");
  await page.getByRole("button", { name: "New form" }).click();
  await page.getByRole("radio", { name: /Water baptism class/ }).click();
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  const formUrl = new URL(page.url()).pathname;

  await page.getByRole("button", { name: "One choice" }).last().click();
  const q = page.getByTestId("form-question").last();
  await q.getByRole("textbox", { name: "Question" }).fill("Which class will you attend?");
  await q.getByLabel("Choices, one per line").fill("Saturday morning\nSunday after service");
  await expect(page.getByTestId("form-preview")).toContainText("Sunday after service");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.getByRole("button", { name: "Open form" }).click();
  await expect(page.getByText("Share this link or print the QR code")).toBeVisible();
  const link = new URL((await page.getByRole("link", { name: "Open" }).getAttribute("href"))!).pathname;

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await p2.goto(link);
  await expect(p2.getByRole("heading", { name: "Water baptism class" })).toBeVisible();
  await p2.getByRole("button", { name: "Submit" }).click();
  await expect(p2.getByText("Answer this question.").first()).toBeVisible();
  await p2.getByLabel("Full name").fill("Chidinma Okafor");
  await p2.getByLabel("Phone number").fill("0812 345 6789");
  await p2.getByRole("group", { name: /baptised by immersion/ }).getByLabel("No").check();
  await p2.getByLabel("Sunday after service").check();
  await p2.getByRole("button", { name: "Submit" }).click();
  await expect(p2.getByRole("heading", { name: "Thank you" })).toBeVisible();
  await ctx2.close();

  await page.goto(`${formUrl}/responses`);
  await expect(page.getByRole("cell", { name: "Chidinma Okafor" })).toBeVisible();
  await expect(page.getByText("Which class will you attend?").first()).toBeVisible();
  await expect(page.getByText("1 (100%)").first()).toBeVisible();
  const xlsx = await page.request.get(`${formUrl}/responses/export`);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");

  await page.goto(formUrl);
  await page.getByRole("button", { name: "Close form" }).click();
  await expect(page.getByRole("button", { name: "Open form" })).toBeVisible();
  const closed = await page.request.get(link);
  expect(await closed.text()).toContain("This form is closed.");
});
