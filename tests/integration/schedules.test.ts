import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { branches, devMailbox, scheduleNotifications, scheduleVersions, serviceSchedules } from "@/server/db/schema";
import { createMember, type MemberInput } from "@/server/services/members";
import {
  changesBetween,
  deleteSchedule,
  duplicateSchedule,
  getSchedule,
  listNotifications,
  listSchedules,
  listTemplates,
  publicSchedule,
  publishPreview,
  publishSchedule,
  resendNotifications,
  saveSchedule,
  scheduleSchema,
  searchPeople,
  startSchedule,
  versionPdf,
} from "@/server/services/schedules";
import { timeProblems } from "@/lib/schedule";
import { runDueJobs } from "@/server/jobs/worker";
import { addStaff, expectDbError, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

const drain = async () => {
  for (let i = 0; i < 8; i++) if (!(await runDueJobs("test", 50))) break;
};

async function setup() {
  const c = await newChurch("Living Word Chapel");
  const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
  const add = (over: Partial<MemberInput>) =>
    withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, { branchId: hq!.id, firstName: "X", lastName: "Y", gender: "male", ...over } as MemberInput, { allowDuplicate: true }),
    );
  const ada = await add({ firstName: "Ada", lastName: "Eze", gender: "female", email: "ada@example.com" });
  const tunde = await add({ firstName: "Tunde", lastName: "Bakare", phone: "0803 555 0101" });
  const ngozi = await add({ firstName: "Ngozi", lastName: "Obi", gender: "female", email: "ngozi@example.com" });
  return { c, hq: hq!.id, ada, tunde, ngozi };
}

type S = Awaited<ReturnType<typeof setup>>;
const base = (s: S, over: Record<string, unknown> = {}) =>
  scheduleSchema.parse({
    id: randomUUID(),
    branchId: s.hq,
    title: "Sunday Celebration Service",
    serviceType: "sunday",
    serviceDate: "2030-03-03",
    startTime: "08:00",
    endTime: "10:30",
    venue: "Main auditorium",
    internalNotes: "Usher shortage: ask the youth",
    items: [
      { title: "Opening prayer", durationMin: 10, assignees: [{ memberId: s.ada.id, name: "Ada Eze" }] },
      { title: "Praise and worship", durationMin: 30, assignees: [{ memberId: s.tunde.id, name: "Tunde Bakare", responsibility: "Lead" }] },
      { title: "Sermon", durationMin: 60, assignees: [{ memberId: s.ngozi.id, name: "Ngozi Obi" }] },
    ],
    ...over,
  });

describe("time checks", () => {
  it("catches overlaps, items before the start or past the end, and bad durations", () => {
    expect(
      timeProblems({
        startTime: "08:00",
        endTime: "09:00",
        items: [
          { title: "Prayer", startTime: "07:50", durationMin: 10 },
          { title: "Worship", startTime: "08:30", durationMin: 20 },
          { title: "Word", startTime: "08:40", durationMin: 30 },
          { title: "Close", durationMin: 0 },
        ],
      }),
    ).toEqual({
      "items.0.startTime": "Starts before the service does (8:00 AM).",
      "items.2.startTime": 'Starts before "Worship" ends at 8:50 AM.',
      "items.2.durationMin": "Runs past the end of the service (9:00 AM).",
      "items.3.durationMin": "Use whole minutes, from 1 to 720.",
    });
    expect(timeProblems({ startTime: "10:00", endTime: "09:00", items: [] }).endTime).toMatch(/end after it starts/);
  });
});

describe("service schedules", () => {
  it("saves drafts idempotently and keeps them from readers until published", async () => {
    const s = await setup();
    const input = base(s);
    await withOrg(s.c.orgId, (tx) => saveSchedule(tx, s.c.ctx, input));
    await withOrg(s.c.orgId, (tx) => saveSchedule(tx, s.c.ctx, input)); // a double-click
    expect(await withOrg(s.c.orgId, (tx) => tx.select().from(serviceSchedules))).toHaveLength(1);
    const worker = await addStaff(s.c.orgId, "worker", "Bro. Usher");
    await expect(withOrg(s.c.orgId, (tx) => getSchedule(tx, worker.ctx, input.id))).rejects.toThrow(/doesn't exist/);
    expect((await withOrg(s.c.orgId, (tx) => listSchedules(tx, worker.ctx, {}))).total).toBe(0);
    await withOrg(s.c.orgId, (tx) => publishSchedule(tx, s.c.ctx, { id: input.id, notify: true, note: null }));
    const seen = await withOrg(s.c.orgId, (tx) => getSchedule(tx, worker.ctx, input.id));
    expect(seen.published!.items.map((i) => i.title)).toEqual(["Opening prayer", "Praise and worship", "Sermon"]);
    expect(seen.internalNotes).toBeNull();
    expect(JSON.stringify(seen.published)).not.toContain("Usher shortage");
  });

  it("publishes a PDF, notifies everyone on version 1, and only the affected people after a change", async () => {
    const s = await setup();
    const input = base(s);
    await withOrg(s.c.orgId, (tx) => saveSchedule(tx, s.c.ctx, input));
    const r = await withOrg(s.c.orgId, (tx) => publishSchedule(tx, s.c.ctx, { id: input.id, notify: true, note: null }));
    expect(r).toEqual({ version: 1, notified: 3 });
    await drain();
    const [v1] = await withOrg(s.c.orgId, (tx) => tx.select().from(scheduleVersions));
    expect(v1!.pdfStatus).toBe("ready");
    const pdf = await withOrg(s.c.orgId, (tx) => versionPdf(tx, s.c.ctx, input.id));
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.bytes.length).toBeGreaterThan(1500);
    let n = await withOrg(s.c.orgId, (tx) => listNotifications(tx, s.c.ctx, input.id));
    expect(n.map((x) => [x.recipientName, x.status, x.channel]).sort()).toEqual([
      ["Ada Eze", "sent", "email"],
      ["Ngozi Obi", "sent", "email"],
      ["Tunde Bakare", "sent", "sms"],
    ]);
    const mail = await db.select().from(devMailbox).where(eq(devMailbox.to, "ada@example.com"));
    expect(mail[0]!.subject).toContain("Sunday Celebration Service");
    expect(mail[0]!.html).toContain("Opening prayer at 8:00 AM");
    expect(mail[0]!.html).toMatch(/\/s\/[A-Za-z0-9_-]+/);

    // swap the sermon to Ada and lengthen worship: Tunde and Ngozi changed, Ada changed (new part)
    const edited = base(s, {
      id: input.id,
      items: [
        { title: "Opening prayer", durationMin: 10, assignees: [{ memberId: s.ada.id, name: "Ada Eze" }] },
        { title: "Praise and worship", durationMin: 30, assignees: [{ memberId: s.tunde.id, name: "Tunde Bakare", responsibility: "Lead" }] },
        { title: "Sermon", durationMin: 60, assignees: [{ memberId: s.ada.id, name: "Ada Eze" }] },
      ],
    });
    await withOrg(s.c.orgId, (tx) => saveSchedule(tx, s.c.ctx, edited));
    const preview = await withOrg(s.c.orgId, (tx) => publishPreview(tx, s.c.ctx, input.id));
    expect(preview.changes.map((c) => [c.name, c.reason]).sort()).toEqual([
      ["Ada Eze", "changed"],
      ["Ngozi Obi", "removed"],
    ]);
    await withOrg(s.c.orgId, (tx) => publishSchedule(tx, s.c.ctx, { id: input.id, notify: true, note: "Pastor Ngozi is travelling" }));
    await drain();
    n = await withOrg(s.c.orgId, (tx) => listNotifications(tx, s.c.ctx, input.id));
    expect(n.filter((x) => x.version === 2).map((x) => x.recipientName).sort()).toEqual(["Ada Eze", "Ngozi Obi"]);
    // nothing changed: publishing again is refused
    await expect(withOrg(s.c.orgId, (tx) => publishSchedule(tx, s.c.ctx, { id: input.id, notify: true, note: null }))).rejects.toThrow(/Nothing has changed/);
    // published versions are permanent
    await expectDbError(withOrg(s.c.orgId, (tx) => tx.update(scheduleVersions).set({ version: 9 })), /cannot be changed/);
    await expectDbError(withOrg(s.c.orgId, (tx) => tx.delete(scheduleVersions)), /cannot be deleted/);
  });

  it("tells everyone when the date moves, and the share link shows the latest version", async () => {
    const s = await setup();
    const input = base(s);
    await withOrg(s.c.orgId, (tx) => saveSchedule(tx, s.c.ctx, input));
    await withOrg(s.c.orgId, (tx) => publishSchedule(tx, s.c.ctx, { id: input.id, notify: true, note: null }));
    await drain();
    const v1 = (await withOrg(s.c.orgId, (tx) => tx.select().from(scheduleVersions)))[0]!.snapshot;
    const moved = { ...v1, serviceDate: "2030-03-10" };
    expect(changesBetween(v1, moved).map((c) => c.reason)).toEqual(["changed", "changed", "changed"]);
    const mail = (await db.select().from(devMailbox).where(eq(devMailbox.to, "ngozi@example.com")))[0]!;
    const token = /\/s\/([A-Za-z0-9_-]+)/.exec(mail.html)![1]!;
    const pub = await publicSchedule(token);
    expect(pub!.snap.title).toBe("Sunday Celebration Service");
    expect(JSON.stringify(pub)).not.toContain("Usher shortage");
  });

  it("resends, duplicates, starts from templates, and deletes without losing history", async () => {
    const s = await setup();
    const input = base(s);
    await withOrg(s.c.orgId, (tx) => saveSchedule(tx, s.c.ctx, input));
    await withOrg(s.c.orgId, (tx) => publishSchedule(tx, s.c.ctx, { id: input.id, notify: false, note: null }));
    expect(await withOrg(s.c.orgId, (tx) => tx.select().from(scheduleNotifications))).toHaveLength(0);
    expect(await withOrg(s.c.orgId, (tx) => resendNotifications(tx, s.c.ctx, input.id))).toBe(3);
    const copy = await withOrg(s.c.orgId, (tx) => duplicateSchedule(tx, s.c.ctx, input.id));
    const dup = await withOrg(s.c.orgId, (tx) => getSchedule(tx, s.c.ctx, copy));
    expect(dup).toMatchObject({ serviceDate: "2030-03-10", status: "draft", currentVersion: 0 });
    expect(dup.items).toHaveLength(3);
    const templates = await withOrg(s.c.orgId, (tx) => listTemplates(tx));
    expect(templates.map((t) => t.name)).toContain("Wedding");
    const fromT = await withOrg(s.c.orgId, (tx) =>
      startSchedule(tx, s.c.ctx, { from: "template", templateId: templates.find((t) => t.name === "Wedding")!.id, copyOf: null, serviceDate: "2030-04-04", branchId: s.hq }),
    );
    expect((await withOrg(s.c.orgId, (tx) => getSchedule(tx, s.c.ctx, fromT))).items[0]!.title).toBe("Arrival of the bride");
    await withOrg(s.c.orgId, (tx) => deleteSchedule(tx, s.c.ctx, input.id));
    expect((await withOrg(s.c.orgId, (tx) => listSchedules(tx, s.c.ctx, { status: "all" }))).rows.map((r) => r.id)).not.toContain(input.id);
    expect(await withOrg(s.c.orgId, (tx) => tx.select().from(scheduleVersions))).toHaveLength(1);
  });

  it("searches the archive by person and date, and finds people to assign", async () => {
    const s = await setup();
    await withOrg(s.c.orgId, (tx) => saveSchedule(tx, s.c.ctx, base(s)));
    await withOrg(s.c.orgId, (tx) => saveSchedule(tx, s.c.ctx, base(s, { title: "Midweek", serviceType: "midweek", serviceDate: "2030-03-06", items: [] })));
    expect((await withOrg(s.c.orgId, (tx) => listSchedules(tx, s.c.ctx, { person: "ngozi" }))).rows.map((r) => r.title)).toEqual(["Sunday Celebration Service"]);
    expect((await withOrg(s.c.orgId, (tx) => listSchedules(tx, s.c.ctx, { from: "2030-03-05", to: "2030-03-07" }))).rows.map((r) => r.title)).toEqual(["Midweek"]);
    const coord = await addStaff(s.c.orgId, "coordinator", "Sis. Coordinator");
    const found = await withOrg(s.c.orgId, (tx) => searchPeople(tx, coord.ctx, "ad"));
    expect(found.some((f) => f.kind === "member" && f.name === "Ada Eze")).toBe(true);
    // other churches see nothing
    const other = await newChurch();
    expect((await withOrg(other.orgId, (tx) => listSchedules(tx, other.ctx, {}))).total).toBe(0);
  });
});
