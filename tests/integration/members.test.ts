import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { withOrg } from "@/server/db";
import { auditLogs, branches, consents, members } from "@/server/db/schema";
import {
  bulkUpdate,
  createMember,
  exportRows,
  getMember,
  linkHousehold,
  listMembers,
  memberStats,
  removeMember,
  setMemberTags,
  updateMember,
  type MemberInput,
} from "@/server/services/members";
import { addToGroup, getGroup, saveGroup, setGroupRole } from "@/server/services/groups";
import { autoMap, commitImport, parseBirthday, prepareRows, startImport, undoImport } from "@/server/services/imports";
import { saveBranch } from "@/server/services/org";
import { ctxFor, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

async function hq(orgId: string) {
  const [b] = await withOrg(orgId, (tx) => tx.select().from(branches));
  return b!.id;
}
const person = (branchId: string, over: Partial<MemberInput> = {}): MemberInput => ({
  branchId,
  firstName: "Chidinma",
  lastName: "Okafor",
  gender: "female",
  phone: "0803 123 4567",
  email: "chidinma@example.com",
  address: "12 Admiralty Way, Lekki",
  dobDay: 14,
  dobMonth: 2,
  ...over,
});

describe("members", () => {
  it("encrypts contact details and finds people by phone in any format", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const m = await withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b)));
    expect(m.memberNo).toBe("M00001");
    const [raw] = await withOrg(c.orgId, (tx) => tx.select().from(members).where(eq(members.id, m.id)));
    expect(raw!.phoneEnc).not.toContain("803");
    expect(raw!.addressEnc).not.toContain("Admiralty");
    for (const q of ["+2348031234567", "08031234567", "4567", "chidinma", "okafor chi", "M00001"]) {
      const r = await withOrg(c.orgId, (tx) => listMembers(tx, c.ctx, { q }));
      expect(r.total, q).toBe(1);
    }
    const d = await withOrg(c.orgId, (tx) => getMember(tx, c.ctx, m.id));
    expect(d.phone).toBe("+2348031234567");
    expect(d.address).toBe("12 Admiralty Way, Lekki");
  });

  it("numbers members in sequence and refuses duplicates by phone", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    await withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b)));
    await expect(
      withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b, { firstName: "Other", email: "x@example.com" }))),
    ).rejects.toThrow(/already has this phone/);
    const two = await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, person(b, { phone: "0809 000 1111", email: "", firstName: "Emeka" })),
    );
    expect(two.memberNo).toBe("M00002");
  });

  it("validates birthdays and phone numbers", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    await expect(
      withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b, { dobDay: 31, dobMonth: 2 }))),
    ).rejects.toThrow();
    await expect(withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b, { phone: "12345" })))).rejects.toThrow();
  });

  it("hides sensitive details from roles without access, and keeps them when those roles edit", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const m = await withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b)));
    const followup = await ctxFor(c.userId, c.orgId, "followup");
    const d = await withOrg(c.orgId, (tx) => getMember(tx, followup, m.id));
    expect(d.address).toBeNull();
    expect(d.email).toBeNull();
    expect(d.phone).toBe("+2348031234567");
    expect(d.hasHidden).toBe(true);
    // a follow-up officer can't edit members at all
    await expect(withOrg(c.orgId, (tx) => updateMember(tx, followup, m.id, person(b)))).rejects.toThrow(/role/);
  });

  it("records consent changes and audits edits without copying encrypted values", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const m = await withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b, { consentMessaging: true })));
    await withOrg(c.orgId, (tx) =>
      updateMember(tx, c.ctx, m.id, person(b, { consentMessaging: false, address: "New address", stage: "regular" })),
    );
    const cons = await withOrg(c.orgId, (tx) => tx.select().from(consents).where(eq(consents.memberId, m.id)));
    expect(cons.map((x) => x.granted)).toEqual([true, false]);
    const logs = await withOrg(c.orgId, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.entityId, m.id)));
    const upd = logs.find((l) => l.action === "member.updated")!;
    expect(upd.summary).toMatch(/stage/);
    expect(upd.summary).toMatch(/address/);
    expect(JSON.stringify(upd)).not.toContain("New address");
  });

  it("removing a member erases their contact details", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const m = await withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b)));
    await withOrg(c.orgId, (tx) => removeMember(tx, c.ctx, m.id, "Asked to be removed"));
    const [raw] = await withOrg(c.orgId, (tx) => tx.select().from(members).where(eq(members.id, m.id)));
    expect(raw!.deletedAt).not.toBeNull();
    expect(raw!.phoneEnc).toBeNull();
    expect((await withOrg(c.orgId, (tx) => listMembers(tx, c.ctx, {}))).total).toBe(0);
  });

  it("keeps branch staff to their own branch", async () => {
    const c = await newChurch();
    const hqId = await hq(c.orgId);
    const wuse = await withOrg(c.orgId, (tx) => saveBranch(tx, c.ctx, { name: "Wuse", code: "WUSE" }));
    await withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(hqId)));
    await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, person(wuse, { phone: "0805 555 0000", email: "", firstName: "Bayo" })),
    );
    const branchAdmin = { ...c.ctx, branchIds: [wuse] };
    const r = await withOrg(c.orgId, (tx) => listMembers(tx, branchAdmin, {}));
    expect(r.rows.map((x) => x.firstName)).toEqual(["Bayo"]);
    await expect(withOrg(c.orgId, (tx) => createMember(tx, branchAdmin, person(hqId, { phone: "" })))).rejects.toThrow(
      /branch/,
    );
  });

  it("links families, tags and bulk updates", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const a = await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, person(b, { firstName: "Tunde", lastName: "Bello", gender: "male" })),
    );
    const s = await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, person(b, { firstName: "Funke", lastName: "Bello", phone: "0802 222 3333", email: "" })),
    );
    await withOrg(c.orgId, (tx) =>
      linkHousehold(tx, c.ctx, { memberId: a.id, otherId: s.id, memberRole: "head", otherRole: "spouse" }),
    );
    const d = await withOrg(c.orgId, (tx) => getMember(tx, c.ctx, a.id));
    expect(d.householdName).toBe("The Bello family");
    expect(d.household.map((h) => h.firstName)).toEqual(["Funke"]);
    await withOrg(c.orgId, (tx) => setMemberTags(tx, c.ctx, a.id, ["Choir", "Usher", "choir"]));
    expect((await withOrg(c.orgId, (tx) => getMember(tx, c.ctx, a.id))).tags.map((t) => t.name)).toEqual([
      "Choir",
      "Usher",
    ]);
    const n = await withOrg(c.orgId, (tx) =>
      bulkUpdate(tx, c.ctx, [a.id, s.id], { stage: "regular", addTag: "Usher" }),
    );
    expect(n).toBe(2);
    const usher = await withOrg(c.orgId, (tx) => listMembers(tx, c.ctx, { stage: "regular" }));
    expect(usher.total).toBe(2);
  });

  it("finds this week's birthdays across the month boundary", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
    const in3 = new Date(today.getTime() + 3 * 86400000);
    const in20 = new Date(today.getTime() + 20 * 86400000);
    await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, person(b, { dobDay: in3.getDate(), dobMonth: in3.getMonth() + 1 })),
    );
    await withOrg(c.orgId, (tx) =>
      createMember(
        tx,
        c.ctx,
        person(b, { firstName: "Later", phone: "", email: "", dobDay: in20.getDate(), dobMonth: in20.getMonth() + 1 }),
      ),
    );
    const r = await withOrg(c.orgId, (tx) => listMembers(tx, c.ctx, { birthdays: "week" }));
    expect(r.rows.map((x) => x.firstName)).toEqual(["Chidinma"]);
    const stats = await withOrg(c.orgId, (tx) => memberStats(tx, c.ctx));
    expect(stats.birthdays).toHaveLength(1);
    expect(stats.total).toBe(2);
    expect(stats.growth).toHaveLength(12);
  });

  it("exports with contact details only for roles that may see them, and audits the export", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    await withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b)));
    const rows = await withOrg(c.orgId, (tx) => exportRows(tx, c.ctx, {}));
    expect(rows[0]).toMatchObject({ Phone: "0803 123 4567", Address: "12 Admiralty Way, Lekki", Birthday: "14 Feb" });
    const limited = { ...c.ctx, can: (p: string) => p !== "members.read_sensitive" } as typeof c.ctx;
    const rows2 = await withOrg(c.orgId, (tx) => exportRows(tx, limited, {}));
    expect(rows2[0]).not.toHaveProperty("Address");
    const logs = await withOrg(c.orgId, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.action, "member.exported")),
    );
    expect(logs).toHaveLength(2);
  });
});

describe("groups", () => {
  it("adds members, keeps one leader, and refuses duplicate names", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    const g = await withOrg(c.orgId, (tx) => saveGroup(tx, c.ctx, { kind: "department", name: "Choir", branchId: b }));
    await expect(
      withOrg(c.orgId, (tx) => saveGroup(tx, c.ctx, { kind: "department", name: "choir", branchId: b })),
    ).rejects.toThrow(/already/);
    const a = await withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b)));
    const z = await withOrg(c.orgId, (tx) =>
      createMember(tx, c.ctx, person(b, { firstName: "Zainab", phone: "", email: "" })),
    );
    await withOrg(c.orgId, (tx) => addToGroup(tx, c.ctx, g, [a.id, z.id]));
    await withOrg(c.orgId, (tx) => setGroupRole(tx, c.ctx, g, a.id, "leader"));
    await withOrg(c.orgId, (tx) => setGroupRole(tx, c.ctx, g, z.id, "leader"));
    const d = await withOrg(c.orgId, (tx) => getGroup(tx, c.ctx, g));
    expect(d.size).toBe(2);
    expect(d.leaderName).toBe("Zainab Okafor");
    expect(d.people.filter((p) => p.role === "leader")).toHaveLength(1);
  });
});

describe("imports", () => {
  it("reads Nigerian date styles", () => {
    expect(parseBirthday("12/03/1990")).toEqual({ day: 12, month: 3, year: 1990 });
    expect(parseBirthday("1990-03-12")).toEqual({ day: 12, month: 3, year: 1990 });
    expect(parseBirthday("12th March")).toEqual({ day: 12, month: 3, year: null });
    expect(parseBirthday("March 12, 1990")).toEqual({ day: 12, month: 3, year: 1990 });
    expect(parseBirthday("12-Mar-90")).toEqual({ day: 12, month: 3, year: 1990 });
    expect(parseBirthday("31/02/1990")).toBeNull();
    expect(parseBirthday("soon")).toBeNull();
  });

  it("maps common header names", () => {
    expect(autoMap(["S/N", "Full Name", "Sex", "Phone No", "D.O.B", "Unit"])).toEqual({
      "S/N": "",
      "Full Name": "fullName",
      Sex: "gender",
      "Phone No": "phone",
      "D.O.B": "birthday",
      Unit: "department",
    });
  });

  it("reports every problem with its row number", () => {
    const rows = [
      { Name: "ADEYEMI Tunde Michael", Sex: "M", Phone: "0803 111 2222" },
      { Name: "Ngozi", Sex: "F", Phone: "" },
      { Name: "Musa Ibrahim", Sex: "?", Phone: "0803 111 2222" },
      { Name: "Grace Eze", Sex: "female", Phone: "07011" },
    ];
    const { ok, problems } = prepareRows(rows, autoMap(["Name", "Sex", "Phone"]), {
      branches: [{ id: "6f1d1a52-8a8e-4c1e-9f1a-2b3c4d5e6f70", name: "HQ", code: "HQ" }],
      defaultBranchId: "6f1d1a52-8a8e-4c1e-9f1a-2b3c4d5e6f70",
      existingPhoneHashes: new Set(),
    });
    expect(ok.map((r) => [r.input.firstName, r.input.middleName, r.input.lastName])).toEqual([
      ["Tunde", "Michael", "Adeyemi"],
    ]);
    expect(problems.map((p) => p.row)).toEqual([3, 4, 4, 5]);
    expect(problems.find((p) => p.row === 4 && /row 2/.test(p.problem))).toBeTruthy();
  });

  it("imports an Excel file in one go, creates departments, and can be undone", async () => {
    const c = await newChurch();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Members");
    ws.addRow(["Grace Assembly membership list"]);
    ws.addRow(["First Name", "Surname", "Gender", "Phone Number", "Date of Birth", "Department"]);
    ws.addRow(["Tunde", "Bello", "Male", "08031112222", new Date(Date.UTC(1988, 4, 9)), "Choir"]);
    ws.addRow(["Funke", "Bello", "Female", "0803 111 3333", "9/5", "Choir, Ushering"]);
    ws.addRow(["Bad", "Row", "Unknown", "", "", ""]);
    const data = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const start = await withOrg(c.orgId, (tx) => startImport(tx, c.ctx, { name: "members.xlsx", data }));
    expect(start.total).toBe(3);
    expect(start.valid).toBe(2);
    expect(start.problems[0]).toMatchObject({ row: 5 });
    const done = await withOrg(c.orgId, (tx) => commitImport(tx, c.ctx, start.jobId, start.mapping));
    expect(done).toMatchObject({ added: 2, skipped: 1, groupsCreated: ["Choir", "Ushering"] });
    const list = await withOrg(c.orgId, (tx) => listMembers(tx, c.ctx, {}));
    expect(list.rows.find((r) => r.firstName === "Funke")!.groups.sort()).toEqual(["Choir", "Ushering"]);
    expect(list.rows.find((r) => r.firstName === "Tunde")!.dobMonth).toBe(5);
    await expect(withOrg(c.orgId, (tx) => commitImport(tx, c.ctx, start.jobId, start.mapping))).rejects.toThrow(
      /already/,
    );
    expect(await withOrg(c.orgId, (tx) => undoImport(tx, c.ctx, start.jobId))).toBe(2);
    expect((await withOrg(c.orgId, (tx) => listMembers(tx, c.ctx, {}))).total).toBe(0);
  });

  it("flags people already on record", async () => {
    const c = await newChurch();
    const b = await hq(c.orgId);
    await withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(b)));
    const csv = new TextEncoder().encode("Name,Gender,Phone\nChidinma Okafor,F,+234 803 123 4567\n")
      .buffer as ArrayBuffer;
    const start = await withOrg(c.orgId, (tx) => startImport(tx, c.ctx, { name: "x.csv", data: csv }));
    expect(start.valid).toBe(0);
    expect(start.problems[0]!.problem).toMatch(/already on record/);
  });
});
