import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { branches, givingFunds, givingTransactions, jobs, memberCodes, members, organisations } from "@/server/db/schema";
import { createMember, type MemberInput } from "@/server/services/members";
import { addMyPrayer, checkCode, myPrayer, portalChurch, portalGiving, portalHome, portalPrayerSchema, portalProfile, profileSchema, requestCode, updatePortalProfile } from "@/server/services/portal";
import { listPrayer } from "@/server/services/care";
import { todayISO } from "@/lib/format";
import { newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

async function setup() {
  const c = await newChurch("Dominion Chapel");
  const [o] = await db.select({ slug: organisations.slug }).from(organisations).where(eq(organisations.id, c.orgId));
  const church = (await portalChurch(o!.slug))!;
  const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
  const m = await withOrg(c.orgId, (tx) =>
    createMember(tx, c.ctx, { branchId: hq!.id, firstName: "Ruth", lastName: "Akande", gender: "female", phone: "08035551234", email: "ruth@example.com" } as MemberInput, { allowDuplicate: true }),
  );
  const me = { id: m.id, firstName: "Ruth", lastName: "Akande", title: null, memberNo: "X" };
  return { c, church, hq: hq!.id, me };
}

const lastCode = async (to: string) => {
  const mail = (await db.select().from(jobs).where(eq(jobs.type, "email.send"))).filter((j) => (j.payload as { to: string }).to === to);
  const subject = String((mail.at(-1)?.payload as { subject?: string })?.subject ?? "");
  return /^(\d{6})/.exec(subject)?.[1] ?? null;
};

describe("member portal", () => {
  it("signs in with a one-time code, without revealing who is a member", async () => {
    const { c, church, me } = await setup();
    // unknown people get the same answer and nothing is sent
    const unknown = await requestCode(church, "stranger@example.com");
    expect(unknown.sentTo).toMatch(/^s•+@example\.com$/);
    expect(await lastCode("stranger@example.com")).toBeNull();

    await requestCode(church, "Ruth@Example.com");
    const code = (await lastCode("ruth@example.com"))!;
    expect(code).toMatch(/^\d{6}$/);
    const stored = await withOrg(c.orgId, (tx) => tx.select().from(memberCodes).where(eq(memberCodes.memberId, me.id)));
    expect(stored[0]!.codeHash).not.toContain(code);

    const wrong = code === "000000" ? "111111" : "000000";
    expect(await checkCode(church, "ruth@example.com", wrong)).toBeNull();
    expect(await checkCode(church, "ruth@example.com", code)).toBe(me.id);
    // used codes don't work twice
    expect(await checkCode(church, "ruth@example.com", code)).toBeNull();

    // five wrong guesses burn the code
    await requestCode(church, "ruth@example.com");
    const code2 = (await lastCode("ruth@example.com"))!;
    for (let i = 0; i < 5; i++) await checkCode(church, "ruth@example.com", code2 === "222222" ? "333333" : "222222");
    expect(await checkCode(church, "ruth@example.com", code2)).toBeNull();

    // a code for one church can't sign in to another
    const other = await newChurch("Other Church");
    const [o2] = await db.select({ slug: organisations.slug }).from(organisations).where(eq(organisations.id, other.orgId));
    await requestCode(church, "ruth@example.com");
    const code3 = (await lastCode("ruth@example.com"))!;
    expect(await checkCode((await portalChurch(o2!.slug))!, "ruth@example.com", code3)).toBeNull();
    expect(await checkCode(church, "0803 555 1234", code3)).toBe(me.id);
  });

  it("shows a member their giving, takes prayer requests and lets them update their details", async () => {
    const { c, church, hq, me } = await setup();
    await withOrg(c.orgId, async (tx) => {
      const [fund] = await tx.select().from(givingFunds).limit(1);
      await tx.insert(givingTransactions).values({ orgId: c.orgId, branchId: hq, fundId: fund!.id, memberId: me.id, amountKobo: 2_500_000, channel: "transfer", source: "batch", givenOn: todayISO(), reference: "T1" });
    });
    expect((await portalGiving(church, me)).total).toBe(2_500_000);
    expect((await portalHome(church, me)).givingYear).toBe(2_500_000);

    await addMyPrayer(church, me, portalPrayerSchema.parse({ body: "Pray for my exams next week", category: "career" }));
    expect((await myPrayer(church, me))[0]).toMatchObject({ body: "Pray for my exams next week", status: "new" });
    const staffView = await withOrg(c.orgId, (tx) => listPrayer(tx, c.ctx));
    expect(staffView[0]).toMatchObject({ source: "portal", memberId: me.id, name: "Ruth Akande" });

    await updatePortalProfile(church, me, profileSchema.parse({ email: "ruth.new@example.com", area: "Gwarinpa", dobDay: "12", dobMonth: "4", consentMessaging: true }));
    const p = await portalProfile(church, me);
    expect(p).toMatchObject({ email: "ruth.new@example.com", area: "Gwarinpa", dobDay: 12, dobMonth: 4, consentMessaging: true });
    expect(() => profileSchema.parse({ dobDay: "12", dobMonth: "", consentMessaging: false })).toThrow(/both/);
    const [row] = await withOrg(c.orgId, (tx) => tx.select().from(members).where(and(eq(members.id, me.id))));
    expect(row!.emailEnc).not.toContain("ruth.new");
  });
});
