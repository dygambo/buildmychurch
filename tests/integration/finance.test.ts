import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withOrg } from "@/server/db";
import { branches, expenseCategories, expenses, givingTransactions, jobs, remittances } from "@/server/db/schema";
import { listFunds } from "@/server/services/giving";
import { saveBranch } from "@/server/services/org";
import {
  accountsOverview,
  approveExpense,
  bookValue,
  budgetSchema,
  calculateRemittances,
  confirmRemittance,
  disposeAsset,
  disposeSchema,
  expenseSchema,
  fundBalances,
  getBudget,
  listCategories,
  listExpenses,
  listRemittances,
  markExpensePaid,
  rejectExpense,
  remitSchema,
  assetSchema,
  saveAsset,
  saveBudget,
  saveExpense,
  saveOpeningBalances,
  submitExpense,
  submitRemittance,
  voidExpense,
  listAssets,
  previousPeriod,
} from "@/server/services/expenses";
import { fileForDownload, removeFile, sniffType, uploadFile } from "@/server/services/files";
import { todayISO } from "@/lib/format";
import { addStaff, adminSql, ctxFor, expectDbError, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

async function setup() {
  const c = await newChurch();
  const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
  const cats = await withOrg(c.orgId, (tx) => listCategories(tx));
  const funds = await withOrg(c.orgId, (tx) => listFunds(tx));
  const finance = await addStaff(c.orgId, "finance", "Mrs. Funmi Adeyemi");
  return {
    c,
    hq: hq!.id,
    cat: (code: string) => cats.find((x) => x.code === code)!.id,
    fund: (code: string) => funds.find((f) => f.code === code)!.id,
    finance,
  };
}

type S = Awaited<ReturnType<typeof setup>>;
const exp = (s: S, over: Record<string, unknown> = {}) =>
  expenseSchema.parse({
    branchId: s.hq,
    categoryId: s.cat("UTIL"),
    payee: "Total Filling Station",
    description: "Diesel for Sunday services",
    amount: "35,000",
    spentOn: todayISO(),
    method: "transfer",
    ...over,
  });

async function giftRow(orgId: string, branchId: string, fundId: string, kobo: number, givenOn: string, ref: string) {
  await withOrg(orgId, (tx) =>
    tx.insert(givingTransactions).values({
      orgId,
      branchId,
      fundId,
      amountKobo: kobo,
      channel: "cash",
      source: "batch",
      status: "confirmed",
      givenOn,
      reference: ref,
      confirmedAt: new Date(),
    }),
  );
}

describe("expenses", () => {
  it("a new church gets default categories, and other churches can't see its expenses", async () => {
    const s = await setup();
    expect((await withOrg(s.c.orgId, (tx) => listCategories(tx))).map((c) => c.code)).toContain("SALARY");
    await withOrg(s.c.orgId, (tx) => saveExpense(tx, s.finance.ctx, exp(s)));
    const other = await newChurch();
    expect(await withOrg(other.orgId, (tx) => tx.select().from(expenses))).toHaveLength(0);
    expect(await withOrg(other.orgId, (tx) => tx.select().from(expenseCategories))).toHaveLength(9);
  });

  it("small expenses approve themselves; larger ones need someone else", async () => {
    const s = await setup();
    const small = await withOrg(s.c.orgId, (tx) => saveExpense(tx, s.finance.ctx, exp(s)));
    const r1 = await withOrg(s.c.orgId, (tx) => submitExpense(tx, s.finance.ctx, small));
    expect(r1.status).toBe("approved");

    const big = await withOrg(s.c.orgId, (tx) =>
      saveExpense(tx, s.finance.ctx, exp(s, { amount: "450000", payee: "Sound Solutions Ltd", categoryId: s.cat("EQUIP") })),
    );
    expect((await withOrg(s.c.orgId, (tx) => submitExpense(tx, s.finance.ctx, big))).status).toBe("submitted");
    // the owner (who can approve) is emailed
    const mails = await withOrg(s.c.orgId, (tx) => tx.select().from(jobs).where(eq(jobs.type, "email.send")));
    expect(mails.some((j) => JSON.stringify(j.payload).includes("Approve ₦450,000 to Sound Solutions Ltd"))).toBe(true);

    // finance can't approve (no permission); an owner who raised it can't either
    await expect(withOrg(s.c.orgId, (tx) => approveExpense(tx, s.finance.ctx, big))).rejects.toThrow(/role doesn't allow/);
    const own = await withOrg(s.c.orgId, (tx) => saveExpense(tx, s.c.ctx, exp(s, { amount: "900000" })));
    await withOrg(s.c.orgId, (tx) => submitExpense(tx, s.c.ctx, own));
    await expect(withOrg(s.c.orgId, (tx) => approveExpense(tx, s.c.ctx, own))).rejects.toThrow(/two-person rule/);
    // and the database refuses it even if the app didn't
    await expectDbError(
      withOrg(s.c.orgId, (tx) =>
        tx.update(expenses).set({ status: "approved", approvedBy: s.c.userId, approvedByName: "x" }).where(eq(expenses.id, own)),
      ),
      /expenses_two_person_ck/,
    );

    await withOrg(s.c.orgId, (tx) => approveExpense(tx, s.c.ctx, big));
    await expect(
      withOrg(s.c.orgId, (tx) => markExpensePaid(tx, s.finance.ctx, { id: big, method: "transfer", paymentRef: null })),
    ).rejects.toThrow(/reference/);
    await withOrg(s.c.orgId, (tx) =>
      markExpensePaid(tx, s.finance.ctx, { id: big, method: "transfer", paymentRef: "FT2610150042" }),
    );
    const list = await withOrg(s.c.orgId, (tx) => listExpenses(tx, s.finance.ctx, { status: "paid" }));
    expect(list.rows.map((r) => r.payee)).toEqual(["Sound Solutions Ltd"]);
  });

  it("paid expenses can't be edited or deleted, only voided with a reason", async () => {
    const s = await setup();
    const id = await withOrg(s.c.orgId, (tx) => saveExpense(tx, s.finance.ctx, exp(s, { method: "cash" })));
    await withOrg(s.c.orgId, (tx) => submitExpense(tx, s.finance.ctx, id));
    await withOrg(s.c.orgId, (tx) => markExpensePaid(tx, s.finance.ctx, { id, method: "cash", paymentRef: null }));
    await expectDbError(
      withOrg(s.c.orgId, (tx) => tx.update(expenses).set({ amountKobo: 1 }).where(eq(expenses.id, id))),
      /Paid expenses cannot be changed/,
    );
    await expectDbError(withOrg(s.c.orgId, (tx) => tx.delete(expenses).where(eq(expenses.id, id))), /Only draft/);
    await expect(withOrg(s.c.orgId, (tx) => saveExpense(tx, s.finance.ctx, { ...exp(s), id }))).rejects.toThrow(
      /Only drafts/,
    );
    await withOrg(s.c.orgId, (tx) => voidExpense(tx, s.c.ctx, { id, reason: "Entered twice by mistake" }));
    await expectDbError(
      withOrg(s.c.orgId, (tx) => tx.update(expenses).set({ status: "paid" }).where(eq(expenses.id, id))),
      /Voided expenses cannot be changed/,
    );
  });

  it("an expense sent back can be fixed and resubmitted by whoever raised it", async () => {
    const s = await setup();
    const id = await withOrg(s.c.orgId, (tx) => saveExpense(tx, s.finance.ctx, exp(s, { amount: "120000" })));
    await withOrg(s.c.orgId, (tx) => submitExpense(tx, s.finance.ctx, id));
    await withOrg(s.c.orgId, (tx) => rejectExpense(tx, s.c.ctx, { id, note: "Attach the invoice" }));
    await expect(withOrg(s.c.orgId, (tx) => saveExpense(tx, s.c.ctx, { ...exp(s), id }))).rejects.toThrow(/only they can edit/);
    await withOrg(s.c.orgId, (tx) => saveExpense(tx, s.finance.ctx, { ...exp(s, { amount: "118500" }), id }));
    expect((await withOrg(s.c.orgId, (tx) => submitExpense(tx, s.finance.ctx, id))).status).toBe("submitted");
  });
});

describe("accounts and budgets", () => {
  it("fund balances start from the opening balance, add gifts and subtract paid expenses", async () => {
    const s = await setup();
    const year = Number(todayISO().slice(0, 4));
    await withOrg(s.c.orgId, (tx) =>
      saveOpeningBalances(tx, s.c.ctx, {
        openingDate: `${year}-01-01`,
        balances: { [s.fund("OFFERING")]: 100_000_00, [s.fund("BUILDING")]: 2_000_000_00 },
      }),
    );
    await giftRow(s.c.orgId, s.hq, s.fund("OFFERING"), 50_000_00, todayISO(), "G1");
    await giftRow(s.c.orgId, s.hq, s.fund("OFFERING"), 1_000_00, `${year - 1}-12-31`, "OLD");
    const id = await withOrg(s.c.orgId, (tx) =>
      saveExpense(tx, s.finance.ctx, exp(s, { fundId: s.fund("OFFERING"), method: "cash" })),
    );
    await withOrg(s.c.orgId, (tx) => submitExpense(tx, s.finance.ctx, id));
    await withOrg(s.c.orgId, (tx) => markExpensePaid(tx, s.finance.ctx, { id, method: "cash", paymentRef: null }));
    const funds = await withOrg(s.c.orgId, (tx) => fundBalances(tx, s.finance.ctx));
    const off = funds.find((f) => f.name === "Offering")!;
    expect(off).toMatchObject({ opening: 100_000_00, inflow: 50_000_00, outflow: 35_000_00, balance: 115_000_00 });
    expect(funds.find((f) => f.name === "Building Fund")!.balance).toBe(2_000_000_00);

    await withOrg(s.c.orgId, (tx) =>
      saveBudget(
        tx,
        s.finance.ctx,
        budgetSchema.parse({ year, branchId: s.hq, lines: [{ categoryId: s.cat("UTIL"), amount: "1,200,000" }] }),
      ),
    );
    const b = await withOrg(s.c.orgId, (tx) => getBudget(tx, s.finance.ctx, year, s.hq));
    expect(b.find((l) => l.categoryId === s.cat("UTIL"))).toMatchObject({ budget: 1_200_000_00, actual: 35_000_00 });
    const o = await withOrg(s.c.orgId, (tx) => accountsOverview(tx, s.finance.ctx, year));
    expect(o.totals).toMatchObject({ income: 50_000_00, spending: 35_000_00 });
    expect(o.byCategory[0]).toMatchObject({ name: "Utilities, fuel & diesel", actual: 35_000_00, budget: 1_200_000_00 });
  });
});

describe("branch remittances", () => {
  it("works out each branch's share, recorded by the branch and confirmed by someone else", async () => {
    const s = await setup();
    const lekki = await withOrg(s.c.orgId, (tx) => saveBranch(tx, s.c.ctx, { name: "Lekki", code: "LEK" }));
    const period = previousPeriod();
    await giftRow(s.c.orgId, lekki, s.fund("TITHE"), 400_000_00, `${period}-07`, "L1");
    await giftRow(s.c.orgId, lekki, s.fund("BUILDING"), 900_000_00, `${period}-07`, "L2"); // restricted: not counted
    await giftRow(s.c.orgId, s.hq, s.fund("TITHE"), 999_000_00, `${period}-07`, "H1"); // headquarters doesn't remit
    await withOrg(s.c.orgId, (tx) => calculateRemittances(tx, s.c.orgId, period));
    const branchFin = await addStaff(s.c.orgId, "finance", "Bro. Lekki Treasurer");
    await adminSql()`update memberships set branch_ids = ${[lekki]} where user_id = ${branchFin.userId}`;
    const bf = await ctxFor(branchFin.userId, s.c.orgId);
    const [r] = await withOrg(s.c.orgId, (tx) => listRemittances(tx, bf));
    expect(r).toMatchObject({ incomeKobo: 400_000_00, rateBps: 1000, dueKobo: 40_000_00, status: "due" });
    await expect(
      withOrg(s.c.orgId, (tx) =>
        submitRemittance(tx, bf, remitSchema.parse({ id: r!.id, amount: "40000", paidOn: todayISO(), method: "transfer" })),
      ),
    ).rejects.toThrow(/reference/);
    await withOrg(s.c.orgId, (tx) =>
      submitRemittance(
        tx,
        bf,
        remitSchema.parse({ id: r!.id, amount: "40000", paidOn: todayISO(), method: "transfer", paymentRef: "TRF-889" }),
      ),
    );
    // the branch can't confirm its own payment
    await expect(withOrg(s.c.orgId, (tx) => confirmRemittance(tx, bf, r!.id))).rejects.toThrow(/role doesn't allow/);
    await withOrg(s.c.orgId, (tx) => confirmRemittance(tx, s.c.ctx, r!.id));
    // recalculating later leaves the confirmed month alone
    await giftRow(s.c.orgId, lekki, s.fund("TITHE"), 100_000_00, `${period}-20`, "L3");
    await withOrg(s.c.orgId, (tx) => calculateRemittances(tx, s.c.orgId, period));
    const [after] = await withOrg(s.c.orgId, (tx) => tx.select().from(remittances));
    expect(after).toMatchObject({ status: "confirmed", dueKobo: 40_000_00 });
    await expectDbError(
      withOrg(s.c.orgId, (tx) => tx.update(remittances).set({ dueKobo: 1 }).where(eq(remittances.id, r!.id))),
      /Confirmed remittances cannot be changed/,
    );
  });
});

describe("assets", () => {
  it("depreciates straight-line to the salvage value and records disposal", async () => {
    expect(
      bookValue({ costKobo: 1_200_000, salvageKobo: 0, usefulLifeMonths: 12, purchasedOn: "2026-01-10", status: "in_use" }, "2026-07-01"),
    ).toBe(600_000);
    expect(
      bookValue({ costKobo: 1_200_000, salvageKobo: 200_000, usefulLifeMonths: 12, purchasedOn: "2024-01-10", status: "in_use" }, "2026-07-01"),
    ).toBe(200_000);
    const s = await setup();
    const id = await withOrg(s.c.orgId, (tx) =>
      saveAsset(
        tx,
        s.finance.ctx,
        assetSchema.parse({
          branchId: s.hq,
          name: "Mikano 60KVA generator",
          category: "generator",
          purchasedOn: "2024-03-01",
          cost: "18,500,000",
          usefulLifeMonths: "60",
          condition: "good",
        }),
      ),
    );
    const { rows } = await withOrg(s.c.orgId, (tx) => listAssets(tx, s.finance.ctx));
    expect(rows[0]).toMatchObject({ assetNo: "A-0001", costKobo: 18_500_000_00 });
    expect(rows[0]!.bookValueKobo).toBeLessThan(18_500_000_00);
    await withOrg(s.c.orgId, (tx) =>
      disposeAsset(tx, s.finance.ctx, disposeSchema.parse({ id, disposedOn: todayISO(), amount: "6,000,000", note: "Sold to a member" })),
    );
    expect((await withOrg(s.c.orgId, (tx) => listAssets(tx, s.finance.ctx))).rows).toHaveLength(0);
  });
});

describe("files", () => {
  const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  it("accepts real PDFs and photos only, and keeps them to people who can see the record", async () => {
    expect(sniffType(new TextEncoder().encode("<html>"))).toBeNull();
    const s = await setup();
    const id = await withOrg(s.c.orgId, (tx) => saveExpense(tx, s.finance.ctx, exp(s)));
    await expect(
      withOrg(s.c.orgId, (tx) =>
        uploadFile(tx, s.finance.ctx, { entityType: "expense", entityId: id, name: "x.pdf", bytes: new TextEncoder().encode("MZ fake") }),
      ),
    ).rejects.toThrow(/PDF or a photo/);
    const f = await withOrg(s.c.orgId, (tx) =>
      uploadFile(tx, s.finance.ctx, { entityType: "expense", entityId: id, name: "../../invoice.pdf", bytes: pdf }),
    );
    expect(f.name).toBe("....invoice.pdf");
    // a branch-only user elsewhere can't open it
    const lekki = await withOrg(s.c.orgId, (tx) => saveBranch(tx, s.c.ctx, { name: "Lekki", code: "LEK" }));
    const other = await addStaff(s.c.orgId, "finance", "Branch Finance");
    await adminSql()`update memberships set branch_ids = ${[lekki]} where user_id = ${other.userId}`;
    const oc = await ctxFor(other.userId, s.c.orgId);
    await expect(withOrg(s.c.orgId, (tx) => fileForDownload(tx, oc, f.id))).rejects.toThrow(/that branch/);
    const got = await withOrg(s.c.orgId, (tx) => fileForDownload(tx, s.finance.ctx, f.id));
    expect(got.mime).toBe("application/pdf");
    // another church can't see the record at all
    const c2 = await newChurch();
    await expect(withOrg(c2.orgId, (tx) => fileForDownload(tx, c2.ctx, f.id))).rejects.toThrow(/doesn't exist/);
    await withOrg(s.c.orgId, (tx) => removeFile(tx, s.finance.ctx, f.id));
  });
});

describe("row-level security", () => {
  it("every table with an org_id column has row-level security on", async () => {
    const rows = await adminSql()<{ table: string; rls: boolean }[]>`
      select c.relname as table, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'org_id')`;
    // tables that are looked up before the church is known (webhooks, public links, job queue, logins)
    const exempt = new Set(["payment_intents", "public_links", "jobs", "memberships", "roles", "sessions", "invitations", "rate_limits", "auth_tokens", "message_refs", "member_sessions"]);
    const missing = rows.filter((r) => !r.rls && !exempt.has(r.table)).map((r) => r.table);
    expect(missing).toEqual([]);
  });
});
