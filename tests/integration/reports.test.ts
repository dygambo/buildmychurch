import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withOrg } from "@/server/db";
import { attendance, branches, expenseCategories, expenses, givingFunds, givingTransactions, members } from "@/server/db/schema";
import { createMember, type MemberInput } from "@/server/services/members";
import { addToGroup, saveGroup } from "@/server/services/groups";
import { createService, recordHeadcount } from "@/server/services/attendance";
import { getVisitorLink, submitVisitorCard } from "@/server/services/followup";
import { saveBranch } from "@/server/services/org";
import { attendanceReport, branchComparison, financeReport, givingReport, growth, overview, reportWorkbook } from "@/server/services/reports";
import { resolvePeriod } from "@/lib/periods";
import { todayISO } from "@/lib/format";
import { addStaff, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe("reports", () => {
  it("adds up growth, first-timer retention, engagement, attendance, giving and spending, scoped by branch and role", async () => {
    const c = await newChurch("Victory Chapel");
    const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
    const other = await withOrg(c.orgId, (tx) => saveBranch(tx, c.ctx, { name: "Kubwa", code: "KUB", pastorName: "Pst. Ola" }));
    const mk = (first: string, branchId: string, stage = "member") =>
      withOrg(c.orgId, (tx) =>
        createMember(tx, c.ctx, { branchId, firstName: first, lastName: "Test", gender: "female", phone: `0803${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`, stage } as MemberInput, { allowDuplicate: true }),
      );
    const a = await mk("Ada", hq!.id);
    const b = await mk("Bola", hq!.id);
    await mk("Chi", other);
    const dept = await withOrg(c.orgId, (tx) => saveGroup(tx, c.ctx, { kind: "department", name: "Choir", branchId: hq!.id }));
    await withOrg(c.orgId, (tx) => addToGroup(tx, c.ctx, dept, [a.id]));

    // two first-timers by visitor card; one comes back and becomes a regular
    await withOrg(c.orgId, (tx) => getVisitorLink(tx, c.ctx));
    for (const [first, phone] of [["Femi", "08091110001"], ["Gbenga", "08091110002"]])
      await withOrg(c.orgId, (tx) => submitVisitorCard(tx, { id: c.orgId, name: "Victory Chapel" }, hq!.id, { firstName: first, lastName: "Visitor", gender: "male", phone, consentMessaging: false } as never));
    const [femi] = await withOrg(c.orgId, (tx) => tx.select().from(members).where(eq(members.firstName, "Femi")));
    await withOrg(c.orgId, (tx) => tx.update(members).set({ stage: "regular" }).where(eq(members.id, femi!.id)));

    // two Sundays at HQ with usher counts; one at Kubwa
    const s1 = await withOrg(c.orgId, (tx) => createService(tx, c.ctx, { branchId: hq!.id, name: "Sunday service", kind: "sunday", date: daysAgo(14), startTime: "09:00", durationMin: 120 }));
    const s2 = await withOrg(c.orgId, (tx) => createService(tx, c.ctx, { branchId: hq!.id, name: "Sunday service", kind: "sunday", date: daysAgo(7), startTime: "09:00", durationMin: 120 }));
    const s3 = await withOrg(c.orgId, (tx) => createService(tx, c.ctx, { branchId: other, name: "Sunday service", kind: "sunday", date: daysAgo(7), startTime: "09:00", durationMin: 120 }));
    await withOrg(c.orgId, (tx) => recordHeadcount(tx, c.ctx, s1, { men: 40, women: 60, children: 20 }));
    await withOrg(c.orgId, (tx) => recordHeadcount(tx, c.ctx, s2, { men: 50, women: 70, children: 20, online: 30 }));
    await withOrg(c.orgId, (tx) => recordHeadcount(tx, c.ctx, s3, { men: 10, women: 15, children: 5 }));
    // a service with no headcount falls back to check-ins
    const s4 = await withOrg(c.orgId, (tx) => createService(tx, c.ctx, { branchId: hq!.id, name: "Bible study", kind: "midweek", date: daysAgo(3), startTime: "18:00", durationMin: 90 }));
    await withOrg(c.orgId, (tx) =>
      tx.insert(attendance).values([
        { orgId: c.orgId, serviceId: s4, memberId: a.id, method: "staff" },
        { orgId: c.orgId, serviceId: s4, memberId: b.id, method: "staff" },
      ]),
    );

    // giving: ₦100k cash and ₦50k online at HQ, ₦20k at Kubwa; a ₦30k paid expense
    await withOrg(c.orgId, async (tx) => {
      const [fund] = await tx.select().from(givingFunds).limit(1);
      const g = (branchId: string, amountKobo: number, channel: "cash" | "online", ref: string) => ({
        orgId: c.orgId,
        branchId,
        fundId: fund!.id,
        amountKobo,
        channel,
        source: channel === "online" ? ("online" as const) : ("batch" as const),
        givenOn: daysAgo(7),
        reference: ref,
      });
      await tx.insert(givingTransactions).values([g(hq!.id, 10_000_000, "cash", "R1"), g(hq!.id, 5_000_000, "online", "R2"), g(other, 2_000_000, "cash", "R3")]);
      const [cat] = await tx.select().from(expenseCategories).limit(1);
      await tx.insert(expenses).values({
        orgId: c.orgId,
        branchId: hq!.id,
        expenseNo: "E-1",
        categoryId: cat!.id,
        payee: "PHCN",
        description: "Electricity",
        amountKobo: 3_000_000,
        spentOn: daysAgo(5),
        status: "paid",
        requestedBy: c.userId,
        requestedByName: "Pastor Test",
      });
    });

    const period = { ...resolvePeriod({ period: "custom", from: daysAgo(30), to: todayISO() }) };
    const all = await withOrg(c.orgId, (tx) => overview(tx, c.ctx, period));
    expect(all).toMatchObject({ members: 3, firstTimers: 2, returnRate: 50, retentionRate: 50, engagement: 25 });
    // Sundays: (120 + 30) and (140 + 30) across branches on the same day → average of daily totals
    expect(all.avgAttendance).toBe(Math.round((120 + 170) / 2));
    expect(all.giving).toMatchObject({ total: 17_000_000, digitalShare: 29 });
    expect(all.spending!.total).toBe(3_000_000);

    const hqOnly = await withOrg(c.orgId, (tx) => overview(tx, c.ctx, { ...period, branchId: hq!.id }));
    expect(hqOnly).toMatchObject({ members: 2, avgAttendance: 130 });
    expect(hqOnly.giving!.total).toBe(15_000_000);

    const g = await withOrg(c.orgId, (tx) => growth(tx, c.ctx, period));
    expect(g.series.reduce((t, x) => t + x.firstTimers, 0)).toBe(2);
    expect(g.funnel).toMatchObject({ firstTimers: 2, cameBack: 1, stayed: 1 });

    const att = await withOrg(c.orgId, (tx) => attendanceReport(tx, c.ctx, period));
    expect(att.services.find((x) => x.kind === "midweek")!.total).toBe(2);
    expect(att.best!.total).toBe(170);

    const gv = await withOrg(c.orgId, (tx) => givingReport(tx, c.ctx, period));
    expect(gv.funds[0]!.total).toBe(17_000_000);
    expect(gv.channels.find((x) => x.label === "Online")!.value).toBe(50_000);

    const fin = await withOrg(c.orgId, (tx) => financeReport(tx, c.ctx, period));
    expect(fin).toMatchObject({ totalIn: 17_000_000, totalOut: 3_000_000, net: 14_000_000 });

    const cmp = await withOrg(c.orgId, (tx) => branchComparison(tx, c.ctx, period));
    expect(cmp.map((x) => [x.name, x.members])).toEqual(expect.arrayContaining([["Kubwa", 1]]));

    // an administrator sees giving but not spending, and can't open the finance report
    const admin = await addStaff(c.orgId, "admin");
    const adminView = await withOrg(c.orgId, (tx) => overview(tx, admin.ctx, period));
    expect(adminView.giving).not.toBeNull();
    expect(adminView.spending).toBeNull();
    await expect(withOrg(c.orgId, (tx) => financeReport(tx, admin.ctx, period))).rejects.toThrow();
    const sheets = await withOrg(c.orgId, (tx) => reportWorkbook(tx, admin.ctx, period));
    expect(sheets.map((x) => x.name)).not.toContain("Spending by category");
    expect(sheets.map((x) => x.name)).toContain("Giving by fund");

    // a follow-up officer can't see reports at all
    const fu = await addStaff(c.orgId, "followup");
    await expect(withOrg(c.orgId, (tx) => overview(tx, fu.ctx, period))).rejects.toThrow();
  });
});
