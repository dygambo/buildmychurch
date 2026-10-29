import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { branches, counsellingCases, counsellingSessions, jobs } from "@/server/db/schema";
import { createMember, type MemberInput } from "@/server/services/members";
import {
  addChecklistItem,
  assignCounsellors,
  caseSchema,
  certificateData,
  completeCase,
  completeSchema,
  counsellingCounts,
  getCase,
  listCases,
  publicRequestSchema,
  recordSchema,
  recordSession,
  requestLink,
  saveCase,
  scheduleSession,
  sendSessionReminders,
  sessionSchema,
  submitRequest,
  toggleChecklist,
} from "@/server/services/counselling";
import { renderCertificate } from "@/server/pdf/certificate";
import { addStaff, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

const local = (daysFromNow: number, hhmm = "17:00") => `${new Date(Date.now() + daysFromNow * 86400000 + 3600000).toISOString().slice(0, 10)}T${hhmm}`;
const emailsTo = async (to: string) => (await db.select().from(jobs).where(eq(jobs.type, "email.send"))).filter((j) => (j.payload as { to: string }).to === to);

async function setup() {
  const c = await newChurch("Covenant Chapel");
  const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
  const bride = await withOrg(c.orgId, (tx) =>
    createMember(tx, c.ctx, { branchId: hq!.id, firstName: "Ada", lastName: "Obi", gender: "female", phone: "08031110001", email: "ada@example.com" } as MemberInput, { allowDuplicate: true }),
  );
  const counsellor = await addStaff(c.orgId, "counsellor", "Dcn. Emeka Counsel");
  const other = await addStaff(c.orgId, "counsellor", "Sis. Other Counsel");
  return { c, bride, counsellor, other };
}

describe("marriage counselling", () => {
  it("runs pre-marital counselling from opening to a certificate, keeping notes private", async () => {
    const { c, bride, counsellor, other } = await setup();
    const id = await withOrg(c.orgId, (tx) =>
      saveCase(
        tx,
        c.ctx,
        caseSchema.parse({ kind: "premarital", aMemberId: bride.id, bName: "Chidi Okeke", bPhone: "0803 222 0002", bEmail: "chidi@example.com", weddingDate: local(60).slice(0, 10), counsellorIds: [counsellor.userId], reason: "We want to start well." }),
      ),
    );
    const detail = await withOrg(c.orgId, (tx) => getCase(tx, counsellor.ctx, id));
    expect(detail).toMatchObject({ status: "active", kind: "premarital", a: { name: "Ada Obi", email: "ada@example.com" }, reason: "We want to start well." });
    expect(detail.refNo).toMatch(/^MC\/\d{4}\/001$/);
    expect(detail.checklist.length).toBeGreaterThan(5);
    expect(await emailsTo(counsellor.ctx.user.email)).toHaveLength(1);

    // another counsellor can't see it; the reason is stored encrypted
    await expect(withOrg(c.orgId, (tx) => getCase(tx, other.ctx, id))).rejects.toThrow(/doesn't exist/);
    expect(await withOrg(c.orgId, (tx) => listCases(tx, other.ctx))).toHaveLength(0);
    const [raw] = await withOrg(c.orgId, (tx) => tx.select().from(counsellingCases).where(eq(counsellingCases.id, id)));
    expect(raw!.reasonEnc).not.toContain("start well");

    // sessions: planned, couple told, clashes refused, reminder the evening before
    const s1 = await withOrg(c.orgId, (tx) => scheduleSession(tx, counsellor.ctx, sessionSchema.parse({ caseId: id, topic: "God's design for marriage", startsAt: local(1), location: "Pastor's office" })));
    expect((await emailsTo("chidi@example.com")).length).toBe(1);
    await expect(withOrg(c.orgId, (tx) => scheduleSession(tx, counsellor.ctx, sessionSchema.parse({ caseId: id, topic: "Communication", startsAt: local(1, "17:30") })))).rejects.toThrow(/already has a session/);
    const tomorrow = local(1).slice(0, 10);
    expect(await sendSessionReminders(c.orgId, tomorrow)).toBe(1);
    expect(await sendSessionReminders(c.orgId, tomorrow)).toBe(0);
    await expect(withOrg(c.orgId, (tx) => recordSession(tx, counsellor.ctx, recordSchema.parse({ id: s1, status: "held" })))).rejects.toThrow(/hasn't happened/);

    // a past session is recorded with private notes and homework that goes to the couple
    const past = await withOrg(c.orgId, (tx) =>
      tx.insert(counsellingSessions).values({ orgId: c.orgId, caseId: id, topic: "Our backgrounds", startsAt: new Date(Date.now() - 86400000), counsellorId: counsellor.userId }).returning({ id: counsellingSessions.id }),
    );
    await withOrg(c.orgId, (tx) => recordSession(tx, counsellor.ctx, recordSchema.parse({ id: past[0]!.id, status: "held", attended: "both", notes: "Some tension about finances.", homework: "Each write down three money habits." })));
    const hw = (await emailsTo("ada@example.com")).map((j) => JSON.stringify(j.payload)).join(" ");
    expect(hw).toContain("three money habits");
    expect(hw).not.toContain("tension");
    expect((await withOrg(c.orgId, (tx) => getCase(tx, c.ctx, id))).sessions.find((s) => s.topic === "Our backgrounds")!.notes).toBe("Some tension about finances.");

    // a counsellor can't clear a couple; a pastor can, but not with the checklist open unless they say so
    await expect(withOrg(c.orgId, (tx) => completeCase(tx, counsellor.ctx, completeSchema.parse({ id, outcome: "cleared" })))).rejects.toThrow(/Only a pastor/);
    await expect(withOrg(c.orgId, (tx) => completeCase(tx, c.ctx, completeSchema.parse({ id, outcome: "cleared" })))).rejects.toThrow(/not ticked/);
    const full = await withOrg(c.orgId, (tx) => getCase(tx, c.ctx, id));
    for (const item of full.checklist) await withOrg(c.orgId, (tx) => toggleChecklist(tx, counsellor.ctx, { id, key: item.key, done: true }));
    await withOrg(c.orgId, (tx) => addChecklistItem(tx, c.ctx, { id, label: "Meeting with both families" }));
    const cert = await withOrg(c.orgId, (tx) => completeCase(tx, c.ctx, completeSchema.parse({ id, outcome: "cleared", summary: "Ready.", overrideChecklist: true })));
    expect(cert).toMatch(/^MC-CERT\/\d{4}\/001$/);
    const done = await withOrg(c.orgId, (tx) => getCase(tx, c.ctx, id));
    expect(done).toMatchObject({ status: "completed", outcome: "cleared", certificateNo: cert });
    expect(done.sessions.find((s) => s.id === s1)!.status).toBe("cancelled");

    const data = await withOrg(c.orgId, (tx) => certificateData(tx, c.ctx, id));
    const pdf = await renderCertificate({ ...data, logo: null, accent: "#2357e8" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("takes requests from the public page, tells pastors without the details, and lets them assign counsellors", async () => {
    const { c, counsellor } = await setup();
    const url = await withOrg(c.orgId, (tx) => requestLink(tx, c.ctx));
    const r = await submitRequest(
      url.split("/mc/")[1]!,
      publicRequestSchema.parse({ kind: "marital", aName: "Tunde Bello", aPhone: "0809 333 0003", aEmail: "tunde@example.com", bName: "Kemi Bello", marriedSince: "2015-04-11", reason: "We keep arguing about money and in-laws." }),
    );
    expect(r.refNo).toMatch(/^MC\//);
    const toPastor = (await emailsTo(c.email)).map((j) => JSON.stringify(j.payload)).join(" ");
    expect(toPastor).toContain("counselling request");
    expect(toPastor).not.toContain("in-laws");
    expect((await withOrg(c.orgId, (tx) => counsellingCounts(tx, c.ctx))).enquiries).toBe(1);

    const [row] = await withOrg(c.orgId, (tx) => listCases(tx, c.ctx, { tab: "enquiry" }));
    expect(row).toMatchObject({ status: "enquiry", kind: "marital", source: "online" });
    await expect(withOrg(c.orgId, (tx) => assignCounsellors(tx, counsellor.ctx, { id: row!.id, counsellorIds: [counsellor.userId] }))).rejects.toThrow();
    await withOrg(c.orgId, (tx) => assignCounsellors(tx, c.ctx, { id: row!.id, counsellorIds: [counsellor.userId] }));
    expect((await withOrg(c.orgId, (tx) => getCase(tx, counsellor.ctx, row!.id))).status).toBe("active");
    // marital counselling can't end in "cleared"
    await expect(withOrg(c.orgId, (tx) => completeCase(tx, c.ctx, completeSchema.parse({ id: row!.id, outcome: "cleared" })))).rejects.toThrow(/Only pre-marital/);
    await withOrg(c.orgId, (tx) => completeCase(tx, counsellor.ctx, completeSchema.parse({ id: row!.id, outcome: "reconciled" })));
  });

  it("is invisible to roles without counselling permissions", async () => {
    const { c } = await setup();
    const fu = await addStaff(c.orgId, "followup");
    await expect(withOrg(c.orgId, (tx) => listCases(tx, fu.ctx))).rejects.toThrow();
    expect(await withOrg(c.orgId, (tx) => counsellingCounts(tx, fu.ctx))).toEqual({ enquiries: 0, toRecord: 0 });
  });
});
