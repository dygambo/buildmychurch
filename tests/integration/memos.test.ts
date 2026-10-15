import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withOrg } from "@/server/db";
import { branches, expenses, jobs, memoSteps, memos } from "@/server/db/schema";
import { listCategories } from "@/server/services/expenses";
import {
  answerQuery,
  approveMemo,
  declineMemo,
  disburseMemo,
  disburseSchema,
  getMemo,
  listMemos,
  memoSchema,
  queryMemo,
  saveMemo,
  submitMemo,
  withdrawMemo,
} from "@/server/services/memos";
import { addStaff, expectDbError, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

async function setup() {
  const c = await newChurch("Redeemed Grace Chapel");
  const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
  const hod = await addStaff(c.orgId, "hod", "Bro. Welfare HOD");
  const admin = await addStaff(c.orgId, "admin", "Sis. Church Secretary");
  const pastor = await addStaff(c.orgId, "pastor", "Rev. Senior Pastor");
  const finance = await addStaff(c.orgId, "finance", "Mrs. Treasurer");
  const worker = await addStaff(c.orgId, "admin", "Another Admin");
  return { c, hq: hq!.id, hod, admin, pastor, finance, worker };
}
type S = Awaited<ReturnType<typeof setup>>;
const memo = (s: S, over: Record<string, unknown> = {}) =>
  memoSchema.parse({
    id: randomUUID(),
    branchId: s.hq,
    category: "welfare",
    title: "Welfare support for Sis. Bola",
    body: "Hospital bill after surgery at LUTH. Diagnosis attached.",
    amount: "150000",
    ...over,
  });

describe("E-Memo", () => {
  it("routes by amount, numbers memos, and moves step by step to finance", async () => {
    const s = await setup();
    const small = memo(s, { amount: "20000", title: "Fuel for the welfare visit" });
    await withOrg(s.c.orgId, (tx) => saveMemo(tx, s.hod.ctx, small));
    const ref = await withOrg(s.c.orgId, (tx) => submitMemo(tx, s.hod.ctx, small.id));
    expect(ref).toBe(`RGC/MEMO/${new Date().getFullYear()}/001`);
    const steps = await withOrg(s.c.orgId, (tx) => tx.select().from(memoSteps).where(eq(memoSteps.memoId, small.id)));
    expect(steps.map((x) => x.label)).toEqual(["Church Administrator"]); // under ₦50,000: no pastor

    const big = memo(s);
    await withOrg(s.c.orgId, (tx) => saveMemo(tx, s.hod.ctx, big));
    await withOrg(s.c.orgId, (tx) => submitMemo(tx, s.hod.ctx, big.id));
    // the pastor can't see it until it reaches them: it stays with the first step
    await expect(withOrg(s.c.orgId, (tx) => approveMemo(tx, s.pastor.ctx, { id: big.id, comment: null }))).rejects.toThrow();
    expect((await withOrg(s.c.orgId, (tx) => listMemos(tx, s.admin.ctx, { box: "action" }))).total).toBe(2);
    expect((await withOrg(s.c.orgId, (tx) => listMemos(tx, s.finance.ctx, {}))).total).toBe(0);
    // opening it marks it under review
    await withOrg(s.c.orgId, (tx) => getMemo(tx, s.admin.ctx, big.id));
    expect((await withOrg(s.c.orgId, (tx) => tx.select().from(memoSteps).where(eq(memoSteps.memoId, big.id))))[0]!.openedAt).not.toBeNull();
    const r1 = await withOrg(s.c.orgId, (tx) => approveMemo(tx, s.admin.ctx, { id: big.id, comment: "Verified with the hospital" }));
    expect(r1.final).toBe(false);
    const r2 = await withOrg(s.c.orgId, (tx) => approveMemo(tx, s.pastor.ctx, { id: big.id, comment: null }));
    expect(r2.final).toBe(true);
    const done = await withOrg(s.c.orgId, (tx) => getMemo(tx, s.finance.ctx, big.id));
    expect(done.status).toBe("approved");
    expect(done.steps.map((x) => x.stamp?.code).every((c) => c && c.length === 10)).toBe(true);
    expect(done.canDisburse).toBe(true);
    const mails = await withOrg(s.c.orgId, (tx) => tx.select().from(jobs).where(eq(jobs.type, "email.send")));
    expect(mails.some((j) => JSON.stringify(j.payload).includes("Cleared for payment"))).toBe(true);

    const cats = await withOrg(s.c.orgId, (tx) => listCategories(tx));
    await expect(
      withOrg(s.c.orgId, (tx) => disburseMemo(tx, s.finance.ctx, disburseSchema.parse({ id: big.id, amount: "200000", method: "transfer", reference: "FT1" }))),
    ).rejects.toThrow(/more than/);
    const d = await withOrg(s.c.orgId, (tx) =>
      disburseMemo(tx, s.finance.ctx, disburseSchema.parse({ id: big.id, amount: "150000", method: "transfer", reference: "FT992", categoryId: cats.find((c) => c.code === "WELFARE")!.id })),
    );
    const [e] = await withOrg(s.c.orgId, (tx) => tx.select().from(expenses).where(eq(expenses.id, d.expenseId!)));
    expect(e).toMatchObject({ status: "paid", amountKobo: 15_000_000, approvedByName: "Rev. Senior Pastor" });
    // a decided memo is a record
    await expectDbError(withOrg(s.c.orgId, (tx) => tx.update(memos).set({ amountKobo: 1 }).where(eq(memos.id, big.id))), /Decided memos cannot be changed/);
    await expectDbError(withOrg(s.c.orgId, (tx) => tx.update(memoSteps).set({ actedBy: null }).where(eq(memoSteps.memoId, big.id))), /cannot be changed/);
  });

  it("queries go back to the initiator and return to the same step", async () => {
    const s = await setup();
    const m = memo(s, { category: "maintenance", title: "Repair the sanctuary roof", body: "Leaks over the choir stand." });
    await withOrg(s.c.orgId, (tx) => saveMemo(tx, s.hod.ctx, m));
    await withOrg(s.c.orgId, (tx) => submitMemo(tx, s.hod.ctx, m.id));
    await withOrg(s.c.orgId, (tx) => queryMemo(tx, s.admin.ctx, { id: m.id, comment: "Please provide three quotes for this repair" }));
    expect((await withOrg(s.c.orgId, (tx) => getMemo(tx, s.hod.ctx, m.id))).status).toBe("query");
    await expect(withOrg(s.c.orgId, (tx) => approveMemo(tx, s.admin.ctx, { id: m.id, comment: null }))).rejects.toThrow(/isn't waiting/);
    await withOrg(s.c.orgId, (tx) => saveMemo(tx, s.hod.ctx, { ...m, body: "Leaks over the choir stand. Three quotes attached." }));
    await withOrg(s.c.orgId, (tx) => answerQuery(tx, s.hod.ctx, { id: m.id, comment: "Quotes attached" }));
    const after = await withOrg(s.c.orgId, (tx) => getMemo(tx, s.admin.ctx, m.id));
    expect(after).toMatchObject({ status: "pending", currentStep: 1, canAct: true });
    expect(after.body).toContain("Three quotes attached");
    expect(after.comments.map((c) => c.kind)).toEqual(["submitted", "query", "response"]);
    await withOrg(s.c.orgId, (tx) => declineMemo(tx, s.admin.ctx, { id: m.id, comment: "Budget is exhausted this quarter" }));
    expect((await withOrg(s.c.orgId, (tx) => getMemo(tx, s.hod.ctx, m.id))).status).toBe("declined");
  });

  it("confidential memos stay with the approval path; nobody approves their own memo", async () => {
    const s = await setup();
    const m = memo(s, { confidential: true, title: "Disciplinary matter", body: "Private pastoral file.", amount: "" });
    await withOrg(s.c.orgId, (tx) => saveMemo(tx, s.admin.ctx, m));
    await withOrg(s.c.orgId, (tx) => submitMemo(tx, s.admin.ctx, m.id));
    // the admin raised it, but another admin holds the same role: they get the step
    await expect(withOrg(s.c.orgId, (tx) => approveMemo(tx, s.admin.ctx, { id: m.id, comment: null }))).rejects.toThrow(/someone else must approve/);
    await expect(withOrg(s.c.orgId, (tx) => getMemo(tx, s.finance.ctx, m.id))).rejects.toThrow(/doesn't exist/);
    await expect(withOrg(s.c.orgId, (tx) => getMemo(tx, s.hod.ctx, m.id))).rejects.toThrow(/doesn't exist/);
    const seen = await withOrg(s.c.orgId, (tx) => getMemo(tx, s.worker.ctx, m.id));
    expect(seen.canAct).toBe(true);
    // the body is encrypted at rest
    const [raw] = await withOrg(s.c.orgId, (tx) => tx.select().from(memos).where(eq(memos.id, m.id)));
    expect(raw!.bodyEnc).not.toContain("pastoral");
    await withOrg(s.c.orgId, (tx) => withdrawMemo(tx, s.admin.ctx, { id: m.id, comment: "Resolved in person" }));
    expect((await withOrg(s.c.orgId, (tx) => getMemo(tx, s.admin.ctx, m.id))).status).toBe("withdrawn");
  });
});
