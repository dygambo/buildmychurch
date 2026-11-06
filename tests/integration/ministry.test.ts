import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { branches, childEvents, jobs, members } from "@/server/db/schema";
import { createMember } from "@/server/services/members";
import {
  absentees,
  checkIn,
  createService,
  getService,
  lagosToday,
  readCheckinLink,
  recordHeadcount,
  saveTemplate,
  selfCheckIn,
  setServiceStatus,
  startFromTemplates,
} from "@/server/services/attendance";
import {
  addNote,
  getFollowup,
  getVisitorLink,
  listFollowups,
  moveFollowup,
  openAbsenteeFollowups,
  submitVisitorCard,
} from "@/server/services/followup";
import {
  cancelCheckIn,
  checkInChild,
  checkOutChild,
  childIdByQr,
  classFor,
  getChild,
  inChurchNow,
  registerChild,
  verifyChain,
  type ChildInput,
} from "@/server/services/children";
import { adminSql, ctxFor, expectDbError, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

async function hq(orgId: string) {
  const [b] = await withOrg(orgId, (tx) => tx.select().from(branches));
  return b!.id;
}
const daysAgo = (n: number) => new Date(Date.now() + 3600_000 - n * 86400_000).toISOString().slice(0, 10);

describe("attendance", () => {
  it("starts services from templates once per day, and records check-ins and headcounts", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const today = lagosToday();
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    await withOrg(c.orgId, (tx) =>
      saveTemplate(tx, c.ctx, {
        branchId: b,
        name: "First Service",
        kind: "sunday",
        weekday,
        startTime: "08:00",
        durationMin: 120,
      }),
    );
    const ids = await withOrg(c.orgId, (tx) => startFromTemplates(tx, c.ctx, today));
    const again = await withOrg(c.orgId, (tx) => startFromTemplates(tx, c.ctx, today));
    expect(ids).toHaveLength(1);
    expect(again).toEqual(ids);
    const m = await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, {
        branchId: b,
        firstName: "Ada",
        lastName: "Eze",
        gender: "female",
        phone: "08031110000",
      }),
    );
    expect((await withOrg(c.orgId, (tx) => checkIn(tx, c.ctx, ids[0]!, m.id, "staff"))).already).toBe(false);
    expect((await withOrg(c.orgId, (tx) => checkIn(tx, c.ctx, ids[0]!, m.id, "staff"))).already).toBe(true);
    await withOrg(c.orgId, (tx) =>
      recordHeadcount(tx, c.ctx, ids[0]!, { men: 40, women: 55, children: 20, online: 12 }),
    );
    const s = await withOrg(c.orgId, (tx) => getService(tx, c.ctx, ids[0]!));
    expect(s.present).toHaveLength(1);
    expect(s.headcount).toBe(115);
    expect(s.startsAt.toISOString()).toBe(`${today}T07:00:00.000Z`); // 8am in Lagos
    await withOrg(c.orgId, (tx) => setServiceStatus(tx, c.ctx, ids[0]!, "closed"));
    await expect(withOrg(c.orgId, (tx) => checkIn(tx, c.ctx, ids[0]!, m.id, "staff"))).rejects.toThrow(/closed/);
  });

  it("lets members check themselves in by phone through the service QR code", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const now = new Date(Date.now() + 3600_000);
    const hhmm = now.toISOString().slice(11, 16);
    const sid = await withOrg(c.orgId, (tx) =>
      createService(tx, c.ctx, {
        branchId: b,
        name: "Midweek",
        kind: "midweek",
        date: lagosToday(),
        startTime: hhmm,
        durationMin: 90,
      }),
    );
    await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, {
        branchId: b,
        firstName: "Bayo",
        lastName: "Ade",
        gender: "male",
        phone: "0809 123 4567",
      }),
    );
    const { checkinToken } = await withOrg(c.orgId, (tx) => getService(tx, c.ctx, sid));
    // the token is looked up without knowing the church first
    const link = await db.transaction((tx) => readCheckinLink(tx, checkinToken!));
    expect(link!.orgId).toBe(c.orgId);
    const ok = await withOrg(c.orgId, (tx) => selfCheckIn(tx, sid, "+234 809 123 4567"));
    expect(ok).toMatchObject({ found: true, firstName: "Bayo", already: false });
    const unknown = await withOrg(c.orgId, (tx) => selfCheckIn(tx, sid, "0701 000 0000"));
    expect(unknown.found).toBe(false);
  });

  it("moves first timers along as they keep coming", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const m = await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, {
        branchId: b,
        firstName: "Kemi",
        lastName: "Ojo",
        gender: "female",
        stage: "first_timer",
      }),
    );
    for (const [i, d] of [daysAgo(21), daysAgo(14), daysAgo(7), daysAgo(0)].entries()) {
      const sid = await withOrg(c.orgId, (tx) =>
        createService(tx, c.ctx, {
          branchId: b,
          name: "Sunday",
          kind: "sunday",
          date: d,
          startTime: "09:00",
          durationMin: 120,
        }),
      );
      await withOrg(c.orgId, (tx) => checkIn(tx, c.ctx, sid, m.id, "staff"));
      const [row] = await withOrg(c.orgId, (tx) =>
        tx.select({ stage: members.stage }).from(members).where(eq(members.id, m.id)),
      );
      expect(row!.stage).toBe(["first_timer", "second_timer", "second_timer", "regular"][i]);
    }
  });

  it("finds regular attenders who have stopped coming and opens follow-up for them", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const regular = await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, { branchId: b, firstName: "Gone", lastName: "Quiet", gender: "male" }),
    );
    const present = await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, { branchId: b, firstName: "Still", lastName: "Here", gender: "male" }),
    );
    for (const n of [42, 35, 28, 14, 7, 0]) {
      const sid = await withOrg(c.orgId, (tx) =>
        createService(tx, c.ctx, {
          branchId: b,
          name: "Sunday",
          kind: "sunday",
          date: daysAgo(n),
          startTime: "09:00",
          durationMin: 120,
        }),
      );
      if (n >= 28) await withOrg(c.orgId, (tx) => checkIn(tx, c.ctx, sid, regular.id, "staff"));
      await withOrg(c.orgId, (tx) => checkIn(tx, c.ctx, sid, present.id, "staff"));
    }
    const list = await withOrg(c.orgId, (tx) => absentees(tx, c.ctx));
    expect(list.map((a) => a.first_name)).toEqual(["Gone"]);
    expect(await withOrg(c.orgId, (tx) => openAbsenteeFollowups(tx, c.orgId))).toBe(1);
    expect(await withOrg(c.orgId, (tx) => openAbsenteeFollowups(tx, c.orgId))).toBe(0);
  });
});

describe("follow-up", () => {
  it("turns a visitor card into a first timer, a follow-up case and a welcome email", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const token = await withOrg(c.orgId, (tx) => getVisitorLink(tx, c.ctx));
    expect(token).toHaveLength(16);
    const r = await withOrg(c.orgId, (tx) =>
      submitVisitorCard(tx, { id: c.orgId, name: "Grace Chapel" }, b, {
        firstName: "Tola",
        lastName: "Bakare",
        gender: "female",
        phone: "0802 555 0101",
        email: "tola@example.com",
        prayerRequest: "Pray for my new job",
        wantsVisit: true,
        consentMessaging: true,
      }),
    );
    expect(r.returning).toBe(false);
    const again = await withOrg(c.orgId, (tx) =>
      submitVisitorCard(tx, { id: c.orgId, name: "Grace Chapel" }, b, {
        firstName: "Tola",
        lastName: "Bakare",
        gender: "female",
        phone: "08025550101",
      }),
    );
    expect(again.returning).toBe(true);
    const list = await withOrg(c.orgId, (tx) => listFollowups(tx, c.ctx));
    expect(list).toHaveLength(1);
    // the owner has followup.manage, so the case is assigned to them
    expect(list[0]).toMatchObject({
      firstName: "Tola",
      stage: "new",
      wantsVisit: true,
      hasPrayer: true,
      assignedTo: c.userId,
    });
    const welcome = await db.select().from(jobs).where(eq(jobs.type, "email.send"));
    expect(welcome.filter((j) => (j.payload as { to: string }).to === "tola@example.com")).toHaveLength(1);

    const id = list[0]!.id;
    await withOrg(c.orgId, (tx) => addNote(tx, c.ctx, id, { method: "call", outcome: "no_answer" }));
    expect((await withOrg(c.orgId, (tx) => getFollowup(tx, c.ctx, id))).stage).toBe("new");
    await withOrg(c.orgId, (tx) => addNote(tx, c.ctx, id, { method: "call", outcome: "reached", body: "Lovely chat" }));
    const f = await withOrg(c.orgId, (tx) => getFollowup(tx, c.ctx, id));
    expect(f.stage).toBe("contacted");
    expect(f.prayerRequest).toBe("Pray for my new job");
    expect(f.notes[0]!.body).toBe("Lovely chat");
    await expect(withOrg(c.orgId, (tx) => moveFollowup(tx, c.ctx, id, "closed"))).rejects.toThrow(/why/);
    await withOrg(c.orgId, (tx) => moveFollowup(tx, c.ctx, id, "integrated"));
    const [m] = await withOrg(c.orgId, (tx) => tx.select().from(members));
    expect(m!.stage).toBe("regular");
  });
});

describe("children", () => {
  const kid = (branchId: string, over: Partial<ChildInput> = {}): ChildInput => ({
    branchId,
    firstName: "Chidi",
    lastName: "Okafor",
    gender: "male",
    dob: `${new Date().getFullYear() - 6}-03-10`,
    allergies: "Peanuts",
    guardians: [
      {
        firstName: "Ada",
        lastName: "Okafor",
        title: "Mrs.",
        relationship: "Mother",
        phone: "0803 222 1111",
        email: "ada@example.com",
        isPrimary: true,
      },
      {
        firstName: "Emeka",
        lastName: "Okafor",
        relationship: "Father",
        phone: "0803 222 2222",
        email: "emeka@example.com",
      },
      {
        firstName: "Joy",
        lastName: "Nnaji",
        relationship: "Aunt",
        phone: "0803 222 3333",
        canPickUp: false,
        notify: false,
      },
    ],
    ...over,
  });

  it("places children in a class by age", () => {
    const now = new Date("2026-10-15T09:00:00Z");
    expect(classFor("2025-12-01", now)).toBe("Crèche");
    expect(classFor("2022-10-16", now)).toBe("Nursery");
    expect(classFor("2020-01-01", now)).toBe("Primary");
    expect(classFor("2014-10-15", now)).toBe("Juniors");
    expect(classFor("2011-01-01", now)).toBe("Teens");
  });

  it("registers a child, shares guardians between siblings, and hides medical notes from desk staff", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const one = await withOrg(c.orgId, (tx) => registerChild(tx, c.ctx, kid(b)));
    expect(one.childNo).toBe("C00001");
    const two = await withOrg(c.orgId, (tx) =>
      registerChild(tx, c.ctx, kid(b, { firstName: "Amara", gender: "female" })),
    );
    const a = await withOrg(c.orgId, (tx) => getChild(tx, c.ctx, one.id));
    const s = await withOrg(c.orgId, (tx) => getChild(tx, c.ctx, two.id));
    expect(a.guardians.map((g) => g.id).sort()).toEqual(s.guardians.map((g) => g.id).sort());
    expect(a.allergies).toBe("Peanuts");
    const desk = { ...c.ctx, can: (p: string) => p === "children.checkin" } as typeof c.ctx;
    const d = await withOrg(c.orgId, (tx) => getChild(tx, desk, one.id));
    expect(d.allergies).toBeNull();
    expect(d.hasMedical).toBe(true);
    await expect(
      withOrg(c.orgId, (tx) =>
        registerChild(
          tx,
          c.ctx,
          kid(b, {
            guardians: [
              { firstName: "X", lastName: "Y", relationship: "Uncle", canPickUp: false, phone: "0803 999 0000" },
            ],
          }),
        ),
      ),
    ).rejects.toThrow();
  });

  it("checks in by QR, emails the parents with who did what, and checks out with the pickup code", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const reg = await withOrg(c.orgId, (tx) => registerChild(tx, c.ctx, kid(b)));
    const child = await withOrg(c.orgId, (tx) => getChild(tx, c.ctx, reg.id));
    expect(await withOrg(c.orgId, (tx) => childIdByQr(tx, `BMC-CHILD:${child.qrToken}`))).toBe(reg.id);
    const mum = child.guardians.find((g) => g.relationship === "Mother")!;
    const dad = child.guardians.find((g) => g.relationship === "Father")!;
    const aunt = child.guardians.find((g) => g.relationship === "Aunt")!;

    const ci = await withOrg(c.orgId, (tx) =>
      checkInChild(tx, c.ctx, { childId: reg.id, droppedOffBy: mum.id, method: "qr" }),
    );
    expect(ci.securityCode).toMatch(/^[A-Z0-9]{4}$/);
    expect(ci.classGroup).toBe("Primary");
    await expect(
      withOrg(c.orgId, (tx) => checkInChild(tx, c.ctx, { childId: reg.id, droppedOffBy: mum.id, method: "qr" })),
    ).rejects.toThrow(/already checked in/);
    expect(await withOrg(c.orgId, (tx) => inChurchNow(tx, c.ctx))).toHaveLength(1);

    const mails = (await db.select().from(jobs).where(eq(jobs.type, "email.send"))).map(
      (j) => j.payload as { to: string; subject: string; html: string },
    );
    expect(mails.map((m) => m.to).sort()).toEqual(["ada@example.com", "emeka@example.com"]); // the aunt has notifications off
    expect(mails[0]!.subject).toMatch(/^Chidi was checked in at/);
    expect(mails[0]!.html).toContain("Pastor Test, Super Admin"); // who checked them in, and their role
    expect(mails[0]!.html).toContain("Mrs. Ada Okafor (Mother)"); // who dropped them off
    expect(mails[0]!.html).toContain(ci.securityCode);

    // the aunt isn't on the pickup list
    await expect(
      withOrg(c.orgId, (tx) => checkOutChild(tx, c.ctx, { childId: reg.id, pickedUpBy: aunt.id, method: "manual" })),
    ).rejects.toThrow(/pickup list/);
    await expect(
      withOrg(c.orgId, (tx) =>
        checkOutChild(tx, c.ctx, { childId: reg.id, pickedUpBy: dad.id, method: "code", securityCode: "ZZZZ" }),
      ),
    ).rejects.toThrow(/doesn't match/);
    const out = await withOrg(c.orgId, (tx) =>
      checkOutChild(tx, c.ctx, {
        childId: reg.id,
        pickedUpBy: dad.id,
        method: "code",
        securityCode: ci.securityCode.toLowerCase(),
      }),
    );
    expect(out.guardianName).toBe("Emeka Okafor");
    const outMails = (await db.select().from(jobs).where(eq(jobs.type, "email.send")))
      .map((j) => j.payload as { subject: string; html: string })
      .filter((m) => /picked up/.test(m.subject));
    expect(outMails).toHaveLength(2);
    expect(outMails[0]!.html).toContain("Emeka Okafor (Father)");

    const after = await withOrg(c.orgId, (tx) => getChild(tx, c.ctx, reg.id));
    expect(after.open).toBeNull();
    expect(after.recent[0]).toMatchObject({
      checkInMethod: "qr",
      checkOutMethod: "code",
      pickedUpBy: "Emeka Okafor (Father)",
    });
  });

  it("releases to someone off the list only with a lead's reason, and records it", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const reg = await withOrg(c.orgId, (tx) => registerChild(tx, c.ctx, kid(b)));
    const child = await withOrg(c.orgId, (tx) => getChild(tx, c.ctx, reg.id));
    const aunt = child.guardians.find((g) => g.relationship === "Aunt")!;
    await withOrg(c.orgId, (tx) =>
      checkInChild(tx, c.ctx, { childId: reg.id, droppedOffBy: child.guardians[0]!.id, method: "manual" }),
    );
    const desk = await ctxFor(c.userId, c.orgId, "worker");
    const deskWithCheckin = { ...desk, can: (p: string) => p === "children.checkin" } as typeof desk;
    await expect(
      withOrg(c.orgId, (tx) =>
        checkOutChild(tx, deskWithCheckin, {
          childId: reg.id,
          pickedUpBy: aunt.id,
          method: "manual",
          overrideReason: "Mother called",
        }),
      ),
    ).rejects.toThrow(/lead/);
    await withOrg(c.orgId, (tx) =>
      checkOutChild(tx, c.ctx, {
        childId: reg.id,
        pickedUpBy: aunt.id,
        method: "manual",
        overrideReason: "Mother phoned the pastor to authorise",
      }),
    );
    const r = await withOrg(c.orgId, (tx) => getChild(tx, c.ctx, reg.id));
    expect(r.recent[0]!.overrideReason).toMatch(/Mother phoned/);
  });

  it("keeps a tamper-evident record: edits and deletions are refused, and tampering is detected", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const reg = await withOrg(c.orgId, (tx) => registerChild(tx, c.ctx, kid(b)));
    const g = (await withOrg(c.orgId, (tx) => getChild(tx, c.ctx, reg.id))).guardians[0]!;
    for (let i = 0; i < 3; i++) {
      await withOrg(c.orgId, (tx) =>
        checkInChild(tx, c.ctx, { childId: reg.id, droppedOffBy: g.id, method: "manual" }),
      );
      await withOrg(c.orgId, (tx) => checkOutChild(tx, c.ctx, { childId: reg.id, pickedUpBy: g.id, method: "manual" }));
    }
    await withOrg(c.orgId, (tx) => checkInChild(tx, c.ctx, { childId: reg.id, droppedOffBy: g.id, method: "manual" }));
    await withOrg(c.orgId, (tx) => cancelCheckIn(tx, c.ctx, reg.id));
    const ok = await withOrg(c.orgId, (tx) => verifyChain(tx, c.ctx));
    expect(ok).toMatchObject({ ok: true, count: 8 });

    // the app's own database role cannot change history
    await expectDbError(
      withOrg(c.orgId, (tx) => tx.update(childEvents).set({ type: "check_in" })),
      /permission denied/,
    );
    await expectDbError(
      withOrg(c.orgId, (tx) => tx.delete(childEvents)),
      /permission denied/,
    );

    // someone with direct database access edits one record: verification catches it
    await adminSql()`update child_events set data = jsonb_set(data, '{guardian,name}', '"Someone Else"') where seq = (select min(seq) + 2 from child_events)`;
    const bad = await withOrg(c.orgId, (tx) => verifyChain(tx, c.ctx));
    expect(bad.ok).toBe(false);
    const [{ min }] = (await adminSql()`select min(seq)::int as min from child_events`) as unknown as [{ min: number }];
    expect(bad).toMatchObject({ brokenAt: min + 2 });
    void sql;
  });
});
