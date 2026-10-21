import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import {
  branches,
  givingBatches,
  givingFunds,
  givingTransactions,
  jobs,
  paymentIntents,
  pledges,
} from "@/server/db/schema";
import { createMember } from "@/server/services/members";
import {
  addPledge,
  assignGiver,
  batchLinesSchema,
  createBatch,
  createOnlineGift,
  getBatch,
  getCampaign,
  givingSummary,
  listBatches,
  listFunds,
  listTransactions,
  memberGiving,
  onlineGiftSchema,
  rejectBatch,
  reverseTransaction,
  saveBatchLines,
  saveCampaign,
  submitBatch,
  verifyBatch,
} from "@/server/services/giving";
import { applyPaymentResult, fakeCheckout, reconcilePayments, settlePayment } from "@/server/services/payments";
import { grossUp, paystackFee, verifyPaystackSignature } from "@/server/providers/payments";
import { todayISO } from "@/lib/format";
import { addStaff, adminSql, ctxFor, expectDbError, newChurch, resetDb } from "../helpers";
import { createHmac } from "node:crypto";

beforeEach(resetDb);

async function setup() {
  const c = await newChurch();
  const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
  const funds = await withOrg(c.orgId, (tx) => listFunds(tx));
  const fund = (code: string) => funds.find((f) => f.code === code)!.id;
  const finance = await addStaff(c.orgId, "finance", "Mrs. Funmi Adeyemi");
  const counter = await addStaff(c.orgId, "counter", "Bro. Gbenga Afolabi");
  return { c, hq: hq!.id, fund, finance, counter };
}

const lines = (l: unknown) => batchLinesSchema.parse(l);
const gift = (g: unknown) => onlineGiftSchema.parse(g);

async function countedBatch(s: Awaited<ReturnType<typeof setup>>, l: unknown[], cashCount?: Record<string, number>) {
  const id = await withOrg(s.c.orgId, (tx) =>
    createBatch(tx, s.counter.ctx, {
      branchId: s.hq,
      kind: "service",
      serviceId: null,
      label: "Sunday First Service",
      givenOn: todayISO(),
    }),
  );
  await withOrg(s.c.orgId, (tx) => saveBatchLines(tx, s.counter.ctx, id, lines({ lines: l, cashCount })));
  return id;
}

describe("funds", () => {
  it("every new church starts with the six usual funds, and churches can't see each other's", async () => {
    const a = await setup();
    const b = await newChurch();
    const codes = (await withOrg(a.c.orgId, (tx) => listFunds(tx))).map((f) => f.code);
    expect(codes).toEqual(["TITHE", "OFFERING", "THANKS", "BUILDING", "WELFARE", "SEED"]);
    expect(await withOrg(b.orgId, (tx) => tx.select().from(givingFunds))).toHaveLength(6);
    expect(await db.select().from(givingFunds)).toHaveLength(0); // no church set: row-level security shows nothing
  });
});

describe("counting and verifying collections", () => {
  it("one person counts, a different person verifies, and only then does it reach the ledger", async () => {
    const s = await setup();
    const ada = await withOrg(s.c.orgId, (tx) =>
      createMember(tx, s.c.ctx, {
        branchId: s.hq,
        firstName: "Ada",
        lastName: "Obi",
        gender: "female",
        phone: "08031112222",
        email: "ada@example.com",
      }),
    );
    const id = await countedBatch(
      s,
      [
        { fundId: s.fund("OFFERING"), channel: "cash", amount: "352,500" },
        { fundId: s.fund("OFFERING"), channel: "pos", amount: "48000" },
        { fundId: s.fund("TITHE"), channel: "cash", amount: "50000", memberId: ada.id },
      ],
      { "1000": 400, "500": 5, "200": 2, "50": 1 },
    );
    // ₦400,000 + ₦2,500 + ₦400 + ₦50 = ₦402,950 counted vs ₦402,500 cash lines
    await expect(withOrg(s.c.orgId, (tx) => submitBatch(tx, s.counter.ctx, id))).rejects.toThrow(/explain it in the notes/);
    await withOrg(s.c.orgId, (tx) =>
      saveBatchLines(
        tx,
        s.counter.ctx,
        id,
        lines({
          lines: [
            { fundId: s.fund("OFFERING"), channel: "cash", amount: "352950" },
            { fundId: s.fund("OFFERING"), channel: "pos", amount: "48000" },
            { fundId: s.fund("TITHE"), channel: "cash", amount: "50000", memberId: ada.id },
          ],
          cashCount: { "1000": 400, "500": 5, "200": 2, "50": 1 },
        }),
      ),
    );
    await withOrg(s.c.orgId, (tx) => submitBatch(tx, s.counter.ctx, id));
    // nothing on the ledger yet
    expect(await withOrg(s.c.orgId, (tx) => tx.select().from(givingTransactions))).toHaveLength(0);
    // the counter can't verify their own count, even with a verifier's permissions
    const counterAsVerifier = await ctxFor(s.counter.userId, s.c.orgId, "finance");
    await expect(withOrg(s.c.orgId, (tx) => verifyBatch(tx, counterAsVerifier, id))).rejects.toThrow(/someone else/);
    const r = await withOrg(s.c.orgId, (tx) => verifyBatch(tx, s.finance.ctx, id));
    expect(r.posted).toBe(3);
    const tx = await withOrg(s.c.orgId, (t) => t.select().from(givingTransactions));
    expect(tx.reduce((a, t) => a + t.amountKobo, 0)).toBe(45_095_000);
    expect(tx.map((t) => t.reference).sort()[0]).toMatch(/^B-\d{4}-0001-001$/);
    // the named tithe gets a receipt number and an emailed receipt
    const tithe = tx.find((t) => t.memberId === ada.id)!;
    expect(tithe.receiptNo).toMatch(/^R-\d{4}-000001$/);
    const receipts = await adminSql()`select payload from jobs where dedupe_key = ${"receipt:" + tithe.id}`;
    expect(receipts).toHaveLength(1);
    expect((receipts[0]!.payload as { to: string }).to).toBe("ada@example.com");
    // a verified batch is final
    await expect(withOrg(s.c.orgId, (t) => saveBatchLines(t, s.counter.ctx, id, lines({ lines: [] })))).rejects.toThrow(
      /submitted/,
    );
    await expectDbError(
      withOrg(s.c.orgId, (t) => t.update(givingBatches).set({ label: "changed" }).where(eq(givingBatches.id, id))),
      /Verified batches cannot be changed/,
    );
    const b = await withOrg(s.c.orgId, (t) => getBatch(t, s.finance.ctx, id));
    expect(b.verifiedByName).toBe("Mrs. Funmi Adeyemi");
    expect(b.countedByName).toBe("Bro. Gbenga Afolabi");
  });

  it("the database itself refuses a batch verified by the person who counted it", async () => {
    const s = await setup();
    const id = await countedBatch(s, [{ fundId: s.fund("OFFERING"), channel: "cash", amount: 1000 }]);
    await expectDbError(
      withOrg(s.c.orgId, (tx) =>
        tx
          .update(givingBatches)
          .set({ status: "verified", verifiedBy: s.counter.userId })
          .where(eq(givingBatches.id, id)),
      ),
      /two_person/,
    );
  });

  it("a verifier can send a batch back; the counter fixes it and resubmits", async () => {
    const s = await setup();
    const id = await countedBatch(s, [{ fundId: s.fund("OFFERING"), channel: "cash", amount: 10000 }]);
    await withOrg(s.c.orgId, (tx) => submitBatch(tx, s.counter.ctx, id));
    await withOrg(s.c.orgId, (tx) => rejectBatch(tx, s.finance.ctx, id, "POS slip says ₦12,000"));
    await withOrg(s.c.orgId, (tx) =>
      saveBatchLines(
        tx,
        s.counter.ctx,
        id,
        lines({
          lines: [
            { fundId: s.fund("OFFERING"), channel: "cash", amount: 10000 },
            { fundId: s.fund("OFFERING"), channel: "pos", amount: 12000 },
          ],
        }),
      ),
    );
    // only the counter may edit their batch
    await expect(withOrg(s.c.orgId, (tx) => saveBatchLines(tx, s.finance.ctx, id, lines({ lines: [] })))).rejects.toThrow(
      /Only Bro. Gbenga Afolabi/,
    );
    await withOrg(s.c.orgId, (tx) => submitBatch(tx, s.counter.ctx, id));
    await withOrg(s.c.orgId, (tx) => verifyBatch(tx, s.finance.ctx, id));
    const sum = await withOrg(s.c.orgId, (tx) => givingSummary(tx, s.finance.ctx));
    expect(sum.mtd).toBe(2_200_000);
    // counters only see their own batches
    const mine = await withOrg(s.c.orgId, (tx) => listBatches(tx, s.counter.ctx));
    expect(mine.rows).toHaveLength(1);
  });
});

describe("the ledger", () => {
  it("confirmed gifts can't be edited or deleted; reversing adds an opposite entry, once", async () => {
    const s = await setup();
    const id = await countedBatch(s, [{ fundId: s.fund("TITHE"), channel: "transfer", amount: 25000 }]);
    await withOrg(s.c.orgId, (tx) => submitBatch(tx, s.counter.ctx, id));
    await withOrg(s.c.orgId, (tx) => verifyBatch(tx, s.finance.ctx, id));
    const [t] = await withOrg(s.c.orgId, (tx) => tx.select().from(givingTransactions));
    await expectDbError(
      withOrg(s.c.orgId, (tx) =>
        tx.update(givingTransactions).set({ amountKobo: 1 }).where(eq(givingTransactions.id, t!.id)),
      ),
      /cannot be changed/,
    );
    await expectDbError(
      withOrg(s.c.orgId, (tx) => tx.delete(givingTransactions).where(eq(givingTransactions.id, t!.id))),
      /cannot be deleted/,
    );
    // a counter can't reverse
    await expect(withOrg(s.c.orgId, (tx) => reverseTransaction(tx, s.counter.ctx, t!.id, "oops"))).rejects.toThrow(
      /role doesn't allow/,
    );
    const r = await withOrg(s.c.orgId, (tx) => reverseTransaction(tx, s.finance.ctx, t!.id, "Duplicate entry"));
    const all = await withOrg(s.c.orgId, (tx) => tx.select().from(givingTransactions));
    expect(all).toHaveLength(2);
    expect(all.reduce((a, x) => a + x.amountKobo, 0)).toBe(0);
    expect(all.find((x) => x.id === r.id)!.reference).toBe(`${t!.reference}-R`);
    await expect(withOrg(s.c.orgId, (tx) => reverseTransaction(tx, s.finance.ctx, t!.id, "again"))).rejects.toThrow(
      /already been reversed/,
    );
    await expect(withOrg(s.c.orgId, (tx) => reverseTransaction(tx, s.finance.ctx, r.id, "again"))).rejects.toThrow(
      /itself a reversal/,
    );
    const list = await withOrg(s.c.orgId, (tx) => listTransactions(tx, s.finance.ctx, { status: "all" }));
    expect(list.sumKobo).toBe(0);
  });

  it("roles without named access see gifts but not who gave them", async () => {
    const s = await setup();
    const m = await withOrg(s.c.orgId, (tx) =>
      createMember(tx, s.c.ctx, { branchId: s.hq, firstName: "Bayo", lastName: "Ade", gender: "male" }),
    );
    const id = await countedBatch(s, [{ fundId: s.fund("TITHE"), channel: "cash", amount: 5000, memberId: m.id }]);
    await withOrg(s.c.orgId, (tx) => submitBatch(tx, s.counter.ctx, id));
    await withOrg(s.c.orgId, (tx) => verifyBatch(tx, s.finance.ctx, id));
    const admin = await addStaff(s.c.orgId, "admin");
    const seen = await withOrg(s.c.orgId, (tx) => listTransactions(tx, admin.ctx, {}));
    expect(seen.rows[0]!.giver).toBe("Named gift");
    expect(seen.rows[0]!.memberId).toBeNull();
    const named = await withOrg(s.c.orgId, (tx) => listTransactions(tx, s.finance.ctx, {}));
    expect(named.rows[0]!.giver).toBe("Bayo Ade");
    await expect(withOrg(s.c.orgId, (tx) => listTransactions(tx, s.counter.ctx, {}))).rejects.toThrow(/role doesn't allow/);
    await expect(withOrg(s.c.orgId, (tx) => memberGiving(tx, admin.ctx, m.id))).rejects.toThrow(/role doesn't allow/);
    const mg = await withOrg(s.c.orgId, (tx) => memberGiving(tx, s.finance.ctx, m.id));
    expect(mg.total).toBe(500_000);
  });
});

describe("online giving", () => {
  it("a gift only counts once the payment is confirmed, and confirming twice changes nothing", async () => {
    const s = await setup();
    const m = await withOrg(s.c.orgId, (tx) =>
      createMember(tx, s.c.ctx, {
        branchId: s.hq,
        firstName: "Kemi",
        lastName: "Lawal",
        gender: "female",
        email: "kemi@example.com",
      }),
    );
    const g = await withOrg(s.c.orgId, (tx) =>
      createOnlineGift(
        tx,
        s.c.orgId,
        gift({ fundId: s.fund("TITHE"), amount: "10000", name: "Kemi Lawal", email: "KEMI@example.com" }),
      ),
    );
    expect(g.amountKobo).toBe(1_000_000);
    expect(await settlePayment(g.reference)).toBe("pending");
    let [t] = await withOrg(s.c.orgId, (tx) => tx.select().from(givingTransactions));
    expect(t!.status).toBe("pending");
    expect(t!.memberId).toBe(m.id); // matched by email
    expect(await fakeCheckout(g.reference, "pay")).toBe("succeeded");
    expect(await settlePayment(g.reference)).toBe("succeeded");
    expect(await fakeCheckout(g.reference, "pay")).toBe("succeeded");
    [t] = await withOrg(s.c.orgId, (tx) => tx.select().from(givingTransactions));
    expect(t!.status).toBe("confirmed");
    expect(t!.feeKobo).toBe(paystackFee(1_000_000));
    expect(t!.receiptNo).toMatch(/^R-/);
    const receipts = await db.select().from(jobs).where(eq(jobs.dedupeKey, `receipt:${t!.id}`));
    expect(receipts).toHaveLength(1);
    const sum = await withOrg(s.c.orgId, (tx) => givingSummary(tx, s.finance.ctx));
    expect(sum.onlineMtd).toBe(1_000_000);
  });

  it("covers fees on request, and declined or abandoned payments never count", async () => {
    const s = await setup();
    const g = await withOrg(s.c.orgId, (tx) =>
      createOnlineGift(
        tx,
        s.c.orgId,
        gift({ fundId: s.fund("OFFERING"), amount: "5000", coverFees: true, name: "Visitor", email: "v@example.com" }),
      ),
    );
    expect(g.amountKobo - paystackFee(g.amountKobo)).toBeGreaterThanOrEqual(500_000);
    expect(await fakeCheckout(g.reference, "decline")).toBe("failed");
    const [t] = await withOrg(s.c.orgId, (tx) => tx.select().from(givingTransactions));
    expect(t!.status).toBe("failed");

    const g2 = await withOrg(s.c.orgId, (tx) =>
      createOnlineGift(tx, s.c.orgId, gift({ fundId: s.fund("OFFERING"), amount: "2000", name: "Visitor Two", email: "v@example.com" })),
    );
    await adminSql()`update payment_intents set created_at = now() - interval '49 hours' where reference = ${g2.reference}`;
    const r = await reconcilePayments();
    expect(r.abandoned).toBe(1);
    const [i] = await db.select().from(paymentIntents).where(eq(paymentIntents.reference, g2.reference));
    expect(i!.status).toBe("abandoned");
  });

  it("a payment for a different amount than asked is flagged, not counted", async () => {
    const s = await setup();
    const g = await withOrg(s.c.orgId, (tx) =>
      createOnlineGift(tx, s.c.orgId, gift({ fundId: s.fund("TITHE"), amount: "10000", name: "Xavier Odu", email: "x@example.com" })),
    );
    const out = await applyPaymentResult(s.c.orgId, g.reference, {
      status: "success",
      amountKobo: 10_000,
      currency: "NGN",
      feeKobo: 150,
      channel: "card",
      paidAt: new Date(),
      providerTxId: "123",
      message: "Approved",
    });
    expect(out).toBe("failed");
    const [i] = await db.select().from(paymentIntents).where(eq(paymentIntents.reference, g.reference));
    expect(i!.failureReason).toMatch(/Check this payment in Paystack/);
    const [t] = await withOrg(s.c.orgId, (tx) => tx.select().from(givingTransactions));
    expect(t!.status).toBe("failed");
  });

  it("rejects amounts below ₦100 and gifts with no fund", () => {
    expect(onlineGiftSchema.safeParse({ fundId: "", amount: "50", name: "A B", email: "a@b.co" }).success).toBe(false);
  });
});

describe("pledges", () => {
  it("gifts to a project count towards the member's pledge, and reversals take them back off", async () => {
    const s = await setup();
    const m = await withOrg(s.c.orgId, (tx) =>
      createMember(tx, s.c.ctx, { branchId: s.hq, firstName: "Emeka", lastName: "Eze", gender: "male" }),
    );
    const camp = await withOrg(s.c.orgId, (tx) =>
      saveCampaign(tx, s.finance.ctx, {
        name: "New Auditorium",
        description: null,
        fundId: s.fund("BUILDING"),
        goal: 85_000_000_00,
        startsOn: null,
        endsOn: null,
        showOnline: true,
      }),
    );
    const pid = await withOrg(s.c.orgId, (tx) =>
      addPledge(tx, s.finance.ctx, {
        campaignId: camp,
        memberId: m.id,
        pledgerName: null,
        amount: 10_000_000,
        dueOn: null,
        note: null,
      }),
    );
    const pay = async (amount: number) => {
      const id = await countedBatch(s, [{ fundId: s.fund("BUILDING"), channel: "cash", amount, memberId: m.id }]);
      await withOrg(s.c.orgId, (tx) => submitBatch(tx, s.counter.ctx, id));
      await withOrg(s.c.orgId, (tx) => verifyBatch(tx, s.finance.ctx, id));
    };
    await pay(60000);
    let c = await withOrg(s.c.orgId, (tx) => getCampaign(tx, s.finance.ctx, camp));
    expect(c.raised).toBe(6_000_000);
    expect(c.pledges[0]!.paidKobo).toBe(6_000_000);
    expect(c.pledges[0]!.status).toBe("open");
    await pay(40000);
    c = await withOrg(s.c.orgId, (tx) => getCampaign(tx, s.finance.ctx, camp));
    expect(c.pledges[0]!.status).toBe("fulfilled");
    const [last] = await withOrg(s.c.orgId, (tx) =>
      tx
        .select()
        .from(givingTransactions)
        .where(and(eq(givingTransactions.pledgeId, pid), eq(givingTransactions.amountKobo, 4_000_000))),
    );
    await withOrg(s.c.orgId, (tx) => reverseTransaction(tx, s.finance.ctx, last!.id, "Bounced cheque"));
    const [pl] = await withOrg(s.c.orgId, (tx) => tx.select().from(pledges));
    expect(pl!.status).toBe("open");
  });

  it("an unnamed transfer can be linked to a member later", async () => {
    const s = await setup();
    const m = await withOrg(s.c.orgId, (tx) =>
      createMember(tx, s.c.ctx, { branchId: s.hq, firstName: "Zainab", lastName: "Garba", gender: "female" }),
    );
    const id = await countedBatch(s, [{ fundId: s.fund("TITHE"), channel: "transfer", amount: 20000 }]);
    await withOrg(s.c.orgId, (tx) => submitBatch(tx, s.counter.ctx, id));
    await withOrg(s.c.orgId, (tx) => verifyBatch(tx, s.finance.ctx, id));
    const [t] = await withOrg(s.c.orgId, (tx) => tx.select().from(givingTransactions));
    await withOrg(s.c.orgId, (tx) => assignGiver(tx, s.finance.ctx, t!.id, m.id));
    expect((await withOrg(s.c.orgId, (tx) => memberGiving(tx, s.finance.ctx, m.id))).total).toBe(2_000_000);
  });
});

describe("branch scoping", () => {
  it("staff limited to one branch don't see another branch's collections", async () => {
    const s = await setup();
    const [wuse] = await withOrg(s.c.orgId, (tx) =>
      tx.insert(branches).values({ orgId: s.c.orgId, name: "Wuse", code: "WUSE", path: "hq.wuse" }).returning(),
    );
    await countedBatch(s, [{ fundId: s.fund("OFFERING"), channel: "cash", amount: 1000 }]);
    await adminSql()`update memberships set branch_ids = ${[wuse!.id]}::uuid[] where user_id = ${s.finance.userId}`;
    const limited = await ctxFor(s.finance.userId, s.c.orgId);
    expect((await withOrg(s.c.orgId, (tx) => listBatches(tx, limited))).rows).toHaveLength(0);
    expect((await withOrg(s.c.orgId, (tx) => listBatches(tx, s.c.ctx))).rows).toHaveLength(1);
    void sql;
  });
});

describe("fees and webhooks", () => {
  it("works out Paystack's fee and the amount that covers it", () => {
    expect(paystackFee(100_000)).toBe(1_500); // ₦1,000 → ₦15
    expect(paystackFee(250_000)).toBe(13_750); // ₦2,500 → ₦37.50 + ₦100
    expect(paystackFee(20_000_000)).toBe(200_000); // capped at ₦2,000
    for (const net of [10_000, 100_000, 249_000, 250_000, 1_000_000, 50_000_000]) {
      const g = grossUp(net);
      expect(g - paystackFee(g)).toBeGreaterThanOrEqual(net);
      expect(g - paystackFee(g) - net).toBeLessThan(200);
    }
  });

  it("only accepts webhooks signed with the secret key", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "BMC-1" } });
    const sig = createHmac("sha512", "sk_test_x").update(body).digest("hex");
    expect(verifyPaystackSignature(body, sig, "sk_test_x")).toBe(true);
    expect(verifyPaystackSignature(body + " ", sig, "sk_test_x")).toBe(false); // body changed
    expect(verifyPaystackSignature(body, sig, "sk_test_other")).toBe(false); // wrong key
    expect(verifyPaystackSignature(body, null, "sk_test_x")).toBe(false);
    expect(verifyPaystackSignature(body, sig, undefined)).toBe(false); // no key configured: refuse everything
  });
});
