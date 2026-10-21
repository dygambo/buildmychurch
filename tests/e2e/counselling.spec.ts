import { expect, test } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const inDays = (n: number) => new Date(Date.now() + n * 86400000 + 3600000).toISOString().slice(0, 10);

test("marriage counselling: a couple is opened, sessions planned, a request comes in online, and a couple is cleared with a certificate", async ({ page, browser }, info) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Covenant House ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Counsel");
  await page.getByLabel("Email").fill(`mc.${info.project.name}.${stamp}@example.com`);
  await page.getByLabel("Password").fill("Two-Become-One-2026");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/counselling");
  await expect(page.getByRole("heading", { name: "Marriage counselling" })).toBeVisible();
  await page.getByRole("button", { name: "New couple" }).click();
  const d = page.getByRole("dialog");
  await d.locator("#a-name").fill("Amaka Uche");
  await d.locator("#a-email").fill(`amaka.${stamp}@example.com`);
  await d.locator("#b-name").fill("Daniel Uche");
  await d.getByLabel("Planned wedding date").fill(inDays(60));
  await d.getByLabel("Pastor Counsel").check();
  await d.getByRole("button", { name: "Open record" }).click();
  await expect(page).toHaveURL(/\/counselling\/[0-9a-f-]{36}$/);
  const url = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "Amaka Uche & Daniel Uche" })).toBeVisible();
  await expect(page.getByTestId("checklist")).toContainText("Genotype results seen");

  // plan a session: the topic is suggested and the couple is emailed
  await page.getByRole("button", { name: "Plan a session" }).click();
  await expect(page.getByRole("dialog").getByLabel("Topic")).toHaveValue("God's design for marriage");
  await page.getByRole("dialog").getByLabel("Date and time").fill(`${inDays(2)}T17:00`);
  await page.getByRole("dialog").getByRole("button", { name: "Plan session" }).click();
  await expect(page.getByText("Session planned. The couple has been told.")).toBeVisible();
  await expect(page.getByTestId("sessions")).toContainText("God's design for marriage");

  // tick a requirement
  await page.getByTestId("checklist").getByLabel(/Both are baptised/).check();

  // clear for the wedding with requirements still open (pastor confirms), then print the certificate
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Complete counselling" }).click();
  const c = page.getByRole("dialog");
  await c.getByLabel("Clear them anyway").check();
  await c.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByText(/Certificate MC-CERT\/\d{4}\/001 is ready/)).toBeVisible();
  const pdf = await page.request.get(`${url}/certificate`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // a couple asks for help from the public page
  await page.goto("/counselling");
  await page.getByRole("button", { name: "Request page" }).click();
  const link = new URL((await page.getByRole("dialog").getByRole("link", { name: "Open" }).getAttribute("href"))!).pathname;
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await p2.goto(link);
  await p2.getByRole("radio", { name: /We're married/ }).click();
  await p2.getByLabel("Your full name").fill("Tunde Bello");
  await p2.getByLabel("Your phone").fill("0809 333 0003");
  await p2.getByLabel("Their full name").fill("Kemi Bello");
  await p2.getByLabel("What would you like help with?").fill("We keep arguing about money.");
  await p2.getByRole("button", { name: "Send request" }).click();
  await expect(p2.getByText(/Your reference is MC\//)).toBeVisible();
  await ctx2.close();

  await page.goto("/counselling?tab=enquiry");
  await page.getByRole("link", { name: "Tunde Bello & Kemi Bello" }).click();
  await expect(page.getByText("We keep arguing about money.")).toBeVisible();
  await page.getByRole("button", { name: "Change" }).click();
  await page.getByRole("dialog").getByLabel("Pastor Counsel").check();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("In counselling").first()).toBeVisible();
});
