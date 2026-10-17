import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const owner = { email: `members.${stamp}@example.com`, password: "Sunrise-Harvest-2026" };

test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("add a member, find them, edit them and put them in a department", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Church name").fill(`Members Chapel ${stamp}`);
  await page.getByLabel("Your full name").fill("Pastor Femi Ade");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Create church account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/members");
  await expect(page.getByText("Add your first members")).toBeVisible();
  await page.getByRole("button", { name: "Add member" }).first().click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("First name").fill("Chiamaka");
  await drawer.getByLabel("Surname").fill("Nwachukwu");
  await drawer.getByLabel("Gender").selectOption("female");
  await drawer.getByLabel("Phone").fill("0803 999 1234");
  await drawer.getByLabel("Birthday day").fill("31");
  await drawer.getByLabel("Birthday month").selectOption("2");
  await drawer.getByRole("button", { name: "Add member" }).click();
  await expect(drawer.getByText("That day isn't in that month.")).toBeVisible();
  await drawer.getByLabel("Birthday day").fill("14");
  await drawer.getByRole("button", { name: "Add member" }).click();

  await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Chiamaka Nwachukwu" })).toBeVisible();
  await expect(page.getByText("14 February")).toBeVisible();
  await expect(page.getByText("+234 803 999 1234")).toBeVisible();

  // edit: change stage
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByLabel("Stage").selectOption("regular");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();
  await expect(page.getByText(/Updated Chiamaka Nwachukwu: stage/)).toBeVisible();

  // search by last four digits of the phone
  await page.goto("/members");
  await page.getByRole("searchbox", { name: /Search name/ }).fill("1234");
  await expect(page).toHaveURL(/q=1234/);
  await expect(page.getByRole("link", { name: /Chiamaka Nwachukwu/ })).toBeVisible();

  // a department, with Chiamaka in it
  await page.goto("/groups");
  await page.getByRole("button", { name: "Add department" }).first().click();
  await page.getByRole("dialog").getByLabel("Name").fill("Choir");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Choir" })).toBeVisible();
  await page.getByRole("combobox", { name: /Add someone/ }).fill("Chiam");
  await page.getByRole("option", { name: /Chiamaka Nwachukwu/ }).click();
  await expect(page.getByRole("heading", { name: "1 person", exact: true })).toBeVisible();
  await page.getByLabel("Role of Chiamaka").selectOption("leader");
  await expect(page.getByText("Role updated")).toBeVisible();
});

test("import a spreadsheet, see problems by row, then undo", async ({ page }) => {
  await signIn(page);
  await page.goto("/members/import");
  const csv = [
    "S/N,Full Name,Sex,GSM,D.O.B,Unit",
    "1,ADEYEMI Kolawole,M,0812 000 1111,4/7/1991,Ushering",
    "2,Mary Udo,F,0812 000 2222,12th May,Ushering",
    "3,Paul,M,123,,",
  ].join("\n");
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "list.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("2 of 3 ready to import")).toBeVisible();
  await expect(page.getByLabel("Save Full Name as")).toHaveValue("fullName");
  await expect(page.getByText("Needs both a first name and a surname.")).toBeVisible();
  await page.getByRole("button", { name: "Import 2 members" }).click();
  await expect(page.getByRole("heading", { name: "2 members imported" })).toBeVisible();
  await expect(page.getByText(/New groups created: Ushering/)).toBeVisible();

  await page.goto("/members?q=kolawole");
  await expect(page.getByRole("link", { name: /Kolawole Adeyemi/ })).toBeVisible();

  // export downloads a spreadsheet
  const res = await page.request.get("/members/export?format=csv");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("Kolawole");
  expect(body).toContain("0812 000 1111");

  await page.goto("/members/import");
  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(page.getByText(/Import undone. 2 members removed./)).toBeVisible();
  await page.goto("/members?q=kolawole");
  await expect(page.getByText("No one matches these filters")).toBeVisible();
});
