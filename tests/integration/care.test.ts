import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { branches, careEntries, formResponses, jobs, prayerRequests } from "@/server/db/schema";
import { createMember, type MemberInput } from "@/server/services/members";
import {
  addEntry,
  addPrayer,
  careSummary,
  caseSchema,
  closeCase,
  entrySchema,
  getCase,
  listCases,
  listPrayer,
  markPrayed,
  prayerLink,
  prayerSchema,
  publicPrayerSchema,
  saveCase,
  submitPublicPrayer,
  updatePrayer,
} from "@/server/services/care";
import { checkAnswers, createForm, exportResponses, formSchema, getForm, listResponses, publicForm, saveForm, setFormStatus, submitForm, tally } from "@/server/services/forms";
import { submitVisitorCard } from "@/server/services/followup";
import { getVisitorLink } from "@/server/services/followup";
import { todayISO } from "@/lib/format";
import { addStaff, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

async function setup() {
  const c = await newChurch("Living Faith Chapel");
  const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
  const m = await withOrg(c.orgId, (tx) =>
    createMember(tx, c.ctx, { branchId: hq!.id, firstName: "Bisi", lastName: "Ogun", gender: "female", phone: "08031112222" } as MemberInput, { allowDuplicate: true }),
  );
  return { c, hq: hq!.id, memberId: m.id };
}

describe("prayer requests", () => {
  it("takes requests from the public page, matches members, keeps confidential ones from non-pastors, and never emails confidential text", async () => {
    const { c, memberId } = await setup();
    const fu = await addStaff(c.orgId, "followup", "Bro. Follow");
    const url = await withOrg(c.orgId, (tx) => prayerLink(tx, c.ctx));
    const token = url.split("/p/")[1]!;

    await submitPublicPrayer(
      token,
      publicPrayerSchema.parse({ name: "Bisi Ogun", phone: "0803 111 2222", body: "Pray for my mother's surgery on Friday", category: "healing", wantsContact: true }),
    );
    await submitPublicPrayer(token, publicPrayerSchema.parse({ body: "A private matter in my marriage", category: "family", confidential: true, email: "anon@example.com" }));
    await expect(submitPublicPrayer(token, publicPrayerSchema.parse({ body: "Call me please", wantsContact: true }))).rejects.toThrow(/phone number or email/);

    const pastorView = await withOrg(c.orgId, (tx) => listPrayer(tx, c.ctx));
    expect(pastorView).toHaveLength(2);
    expect(pastorView.find((p) => p.category === "healing")!.memberId).toBe(memberId);
    const fuView = await withOrg(c.orgId, (tx) => listPrayer(tx, fu.ctx));
    expect(fuView).toHaveLength(1);
    expect(fuView[0]!.body).toContain("surgery");

    // stored encrypted
    const raw = await withOrg(c.orgId, (tx) => tx.select().from(prayerRequests));
    expect(raw.every((r) => !r.bodyEnc.includes("surgery") && !r.bodyEnc.includes("marriage"))).toBe(true);

    // the follow-up officer can't read or file confidential ones
    const conf = pastorView.find((p) => p.confidential)!;
    await expect(withOrg(c.orgId, (tx) => markPrayed(tx, fu.ctx, conf.id))).rejects.toThrow(/doesn.t exist/);
    await expect(
      withOrg(c.orgId, (tx) => addPrayer(tx, fu.ctx, prayerSchema.parse({ name: "X", body: "Something private", confidential: true }))),
    ).rejects.toThrow(/pastors/);

    // emails: no confidential text anywhere, and the follow-up officer isn't told about it
    const mail = await db.select().from(jobs).where(eq(jobs.type, "email.send"));
    const all = JSON.stringify(mail.map((j) => j.payload));
    expect(all).not.toContain("private matter");
    expect(all).toContain("surgery");
    const toFu = mail.filter((j) => JSON.stringify(j.payload).includes("Confidential") && (j.payload as { to: string }).to.startsWith("staff"));
    expect(toFu).toHaveLength(0);

    // praying, assigning, answering
    const open = pastorView.find((p) => !p.confidential)!;
    expect(await withOrg(c.orgId, (tx) => markPrayed(tx, fu.ctx, open.id))).toBe(1);
    await withOrg(c.orgId, (tx) => updatePrayer(tx, c.ctx, { id: open.id, assignedTo: fu.userId }));
    await withOrg(c.orgId, (tx) => updatePrayer(tx, c.ctx, { id: open.id, status: "answered", testimony: "Surgery went well, she's home." }));
    const answered = await withOrg(c.orgId, (tx) => listPrayer(tx, c.ctx, { status: "answered" }));
    expect(answered[0]).toMatchObject({ assignedName: "Bro. Follow", prayedCount: 1, testimony: "Surgery went well, she's home." });
    expect(await withOrg(c.orgId, (tx) => listPrayer(tx, c.ctx))).toHaveLength(1);
  });

  it("files visitor-card prayer requests in the prayer list", async () => {
    const { c } = await setup();
    const token = await withOrg(c.orgId, (tx) => getVisitorLink(tx, c.ctx));
    expect(token).toBeTruthy();
    const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
    await withOrg(c.orgId, (tx) =>
      submitVisitorCard(tx, { id: c.orgId, name: "Living Faith Chapel" }, hq!.id, {
        firstName: "Tayo",
        lastName: "Visitor",
        gender: "male",
        phone: "08094445555",
        prayerRequest: "Pray for a job",
        wantsVisit: true,
        consentMessaging: false,
      } as never),
    );
    const list = await withOrg(c.orgId, (tx) => listPrayer(tx, c.ctx));
    expect(list[0]).toMatchObject({ name: "Tayo Visitor", source: "visitor_card", body: "Pray for a job", wantsContact: true });
  });
});

describe("pastoral care", () => {
  it("opens a case, logs visits and welfare, totals the month, and hides counselling from non-pastors", async () => {
    const { c, memberId } = await setup();
    const fu = await addStaff(c.orgId, "followup", "Sis. Care");
    const id = await withOrg(c.orgId, (tx) =>
      saveCase(tx, c.ctx, caseSchema.parse({ memberId, kind: "hospital", title: "Admitted at LUTH after an accident", priority: "urgent", assignedTo: fu.userId, nextActionOn: todayISO(), nextAction: "Visit with the welfare team" })),
    );
    const assignMail = await db.select().from(jobs).where(eq(jobs.dedupeKey, `care-assign:${id}:${fu.userId}`));
    expect(assignMail).toHaveLength(1);

    await withOrg(c.orgId, (tx) => addEntry(tx, fu.ctx, entrySchema.parse({ caseId: id, kind: "visit", body: "Visited with two deaconesses. Prayed with her; she's stable.", happenedOn: todayISO() })));
    await withOrg(c.orgId, (tx) => addEntry(tx, c.ctx, entrySchema.parse({ caseId: id, kind: "welfare", welfareKind: "hospital_bill", amount: "85,000", happenedOn: todayISO(), body: "Paid to the hospital directly" })));
    expect(() => entrySchema.parse({ caseId: id, kind: "welfare", welfareKind: "cash", happenedOn: todayISO() })).toThrow(/amount/);
    expect(() => entrySchema.parse({ caseId: id, kind: "visit", body: "x", happenedOn: "2999-01-01" })).toThrow(/Next step/);

    const s = await withOrg(c.orgId, (tx) => careSummary(tx, c.ctx));
    expect(s).toMatchObject({ openCases: 1, dueCases: 1, urgentCases: 1, welfareMonthKobo: 8_500_000, welfarePeople: 1 });
    const full = await withOrg(c.orgId, (tx) => getCase(tx, c.ctx, id));
    expect(full.entries).toHaveLength(2);
    expect(full.welfareKobo).toBe(8_500_000);
    expect(full.member.name).toContain("Bisi Ogun");
    const raw = await withOrg(c.orgId, (tx) => tx.select().from(careEntries));
    expect(raw.every((e) => !String(e.bodyEnc).includes("deaconesses"))).toBe(true);

    // counselling is pastors-only, even for the care team
    const counsel = await withOrg(c.orgId, (tx) => saveCase(tx, c.ctx, caseSchema.parse({ memberId, kind: "counselling", title: "Marriage counselling" })));
    await expect(withOrg(c.orgId, (tx) => saveCase(tx, fu.ctx, caseSchema.parse({ memberId, kind: "counselling", title: "Should fail" })))).rejects.toThrow(/pastors/);
    expect((await withOrg(c.orgId, (tx) => listCases(tx, fu.ctx))).map((x) => x.id)).toEqual([id]);
    await expect(withOrg(c.orgId, (tx) => getCase(tx, fu.ctx, counsel))).rejects.toThrow();

    await withOrg(c.orgId, (tx) => closeCase(tx, c.ctx, { id, note: "Discharged and recovering at home" }));
    await expect(withOrg(c.orgId, (tx) => addEntry(tx, c.ctx, entrySchema.parse({ caseId: id, kind: "call", body: "Checked in", happenedOn: todayISO() })))).rejects.toThrow(/closed/);
    expect(await withOrg(c.orgId, (tx) => listCases(tx, c.ctx, { status: "closed" }))).toHaveLength(1);
  });
});

describe("forms", () => {
  it("builds, opens, validates answers, enforces one response each, tallies and exports", async () => {
    const { c, memberId } = await setup();
    const id = await withOrg(c.orgId, (tx) => createForm(tx, c.ctx, "workers"));
    const f = await withOrg(c.orgId, (tx) => getForm(tx, c.ctx, id));
    expect(f.fields.length).toBeGreaterThan(4);
    expect(f.publicUrl).toBeNull();

    const phoneQ = f.fields.find((x) => x.type === "phone")!;
    await withOrg(c.orgId, (tx) =>
      saveForm(tx, c.ctx, formSchema.parse({ ...f, id, oneEach: true, maxResponses: "", closesAt: "", notifyEmail: "hod@example.com", fields: f.fields })),
    );
    expect(() => formSchema.parse({ ...f, oneEach: false, fields: [{ id: "a", type: "choice", label: "Pick", options: ["Only one"] }] })).toThrow(/two choices/);

    await withOrg(c.orgId, (tx) => setFormStatus(tx, c.ctx, id, "open"));
    const url = (await withOrg(c.orgId, (tx) => getForm(tx, c.ctx, id))).publicUrl!;
    const token = url.split("/f/")[1]!;
    const pub = await publicForm(token);
    expect(pub!.closed).toBeNull();

    const nameQ = f.fields.find((x) => x.type === "short")!;
    const deptQ = f.fields.find((x) => x.type === "choice")!;
    const ynQ = f.fields.find((x) => x.type === "yesno")!;
    const bad = checkAnswers(f.fields, { [phoneQ.id]: "123", [deptQ.id]: "Kitchen" });
    expect(bad.errors[phoneQ.id]).toMatch(/Nigerian number/);
    expect(bad.errors[deptQ.id]).toMatch(/options/);
    expect(bad.errors[nameQ.id]).toMatch(/Answer this/);

    await submitForm(token, { [nameQ.id]: "Bisi Ogun", [phoneQ.id]: "0803 111 2222", [deptQ.id]: "Media", [ynQ.id]: "Yes" });
    await expect(submitForm(token, { [nameQ.id]: "Bisi again", [phoneQ.id]: "+2348031112222", [deptQ.id]: "Choir", [ynQ.id]: "No" })).rejects.toThrow(/already filled/);
    await submitForm(token, { [nameQ.id]: "Ike Obi", [phoneQ.id]: "08077778888", [deptQ.id]: "Media", [ynQ.id]: "No" });

    const { responses } = await withOrg(c.orgId, (tx) => listResponses(tx, c.ctx, id));
    expect(responses).toHaveLength(2);
    expect(responses.find((r) => r.name === "Bisi Ogun")!.memberId).toBe(memberId);
    const t = tally(f.fields, responses);
    expect(t.find((x) => x.id === deptQ.id)!.counts.Media).toBe(2);
    const raw = await withOrg(c.orgId, (tx) => tx.select().from(formResponses));
    expect(raw.every((r) => !r.answersEnc.includes("Bisi"))).toBe(true);
    const notified = await db.select().from(jobs).where(eq(jobs.type, "email.send"));
    expect(notified.filter((j) => (j.payload as { to: string }).to === "hod@example.com")).toHaveLength(2);

    const ex = await withOrg(c.orgId, (tx) => exportResponses(tx, c.ctx, id));
    expect(ex.rows[0]![phoneQ.label]).toMatch(/^\+234/);
    expect(Object.keys(ex.rows[0]!)).toContain("Member on record");

    await withOrg(c.orgId, (tx) => setFormStatus(tx, c.ctx, id, "closed"));
    await expect(submitForm(token, { [nameQ.id]: "Late", [phoneQ.id]: "08000000001", [deptQ.id]: "Media", [ynQ.id]: "No" })).rejects.toThrow(/closed/);
  });
});
