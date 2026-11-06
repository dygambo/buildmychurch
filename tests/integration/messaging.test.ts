import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { branches, devMailbox, members, messageCampaigns, messages, smsLedger } from "@/server/db/schema";
import { createMember, type MemberInput } from "@/server/services/members";
import {
  applyDeliveryReport,
  automationSchema,
  campaignSchema,
  cancelCampaign,
  createCampaign,
  getCampaign,
  previewAudience,
  readUnsubscribeToken,
  render,
  runAutomations,
  saveAutomation,
  sendDirect,
  smsBalance,
  unsubscribe,
  unsubscribeToken,
} from "@/server/services/messaging";
import { smsInfo } from "@/lib/sms";
import { termiiStatus, verifyTermiiSignature } from "@/server/providers/messaging";
import { runDueJobs } from "@/server/jobs/worker";
import { todayISO } from "@/lib/format";
import { expectDbError, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

const person = (branchId: string, over: Partial<MemberInput> = {}): MemberInput => ({
  branchId,
  firstName: "Chidinma",
  lastName: "Okafor",
  gender: "female",
  phone: "0803 123 4567",
  email: "chidinma@example.com",
  consentMessaging: true,
  ...over,
});

async function setup() {
  const c = await newChurch("Grace Chapel");
  const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
  const add = (over: Partial<MemberInput>) =>
    withOrg(c.orgId, (tx) => createMember(tx, c.ctx, person(hq!.id, over), { allowDuplicate: true }));
  return { c, hq: hq!.id, add };
}

const drain = async () => {
  for (let i = 0; i < 6; i++) if (!(await runDueJobs("test", 50))) break;
};

describe("SMS length", () => {
  it("counts GSM pages, swaps the naira sign, and falls back to Unicode for emoji", () => {
    expect(smsInfo("a".repeat(160))).toMatchObject({ pages: 1, encoding: "GSM" });
    expect(smsInfo("a".repeat(161)).pages).toBe(2);
    expect(smsInfo("Give ₦5,000").text).toBe("Give N5,000");
    expect(smsInfo("God bless 🙏")).toMatchObject({ encoding: "Unicode", pages: 1 });
    expect(smsInfo("{".repeat(81)).pages).toBe(2); // extension characters count twice
  });
  it("personalises with the member's name", () => {
    expect(render("Hi {first_name}, from {church}", { firstName: "Tunde", church: "Grace" })).toBe("Hi Tunde, from Grace");
    expect(render("Hi {first_name}", { firstName: null, church: "Grace" })).toBe("Hi friend");
  });
});

describe("broadcasts", () => {
  it("sends to people who agreed, skips the rest with a reason, and spends units once", async () => {
    const s = await setup();
    await s.add({ firstName: "Ada" });
    await s.add({ firstName: "Bayo", phone: "0805 222 3333", email: "bayo@example.com" });
    await s.add({ firstName: "Chika", phone: "0806 333 4444", email: "chika@example.com", consentMessaging: false });
    await s.add({ firstName: "Dayo", phone: undefined, email: "dayo@example.com" });
    await s.add({ firstName: "Emeka", phone: "0803 123 4567", email: "emeka@example.com" }); // same phone as Ada
    const audience = { kind: "everyone" as const };
    const p = await withOrg(s.c.orgId, (tx) => previewAudience(tx, s.c.ctx, audience, "sms", "Hi {first_name}"));
    expect(p).toMatchObject({ total: 5, reachable: 2, unitsEstimate: 2, balance: 50 });
    expect(p.skipped).toEqual({ no_consent: 1, no_contact: 1, duplicate: 1 });

    const { id } = await withOrg(s.c.orgId, (tx) =>
      createCampaign(tx, s.c.ctx, campaignSchema.parse({ channel: "sms", body: "Hi {first_name}, service is at 8am. - {church}", audience })),
    );
    await drain();
    const c = await withOrg(s.c.orgId, (tx) => getCampaign(tx, s.c.ctx, id));
    expect(c.status).toBe("sent");
    expect(c.counts).toMatchObject({ total: 5, sent: 2, skipped: 3, failed: 0 });
    expect(await withOrg(s.c.orgId, (tx) => smsBalance(tx))).toBe(48);
    const sms = await db.select().from(devMailbox).where(eq(devMailbox.channel, "sms"));
    expect(sms.map((m) => m.text).sort()).toEqual([
      "Hi Ada, service is at 8am. - Grace Chapel",
      "Hi Bayo, service is at 8am. - Grace Chapel",
    ]);
    // addresses are stored encrypted, shown masked
    const [raw] = await withOrg(s.c.orgId, (tx) => tx.select().from(messages).where(eq(messages.campaignId, id)).limit(1));
    expect(raw!.toEnc).not.toContain("803");
  });

  it("refuses to send when the church doesn't have enough units", async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) await s.add({ firstName: `P${i}x`, phone: `0803 000 00${10 + i}`, email: `p${i}@example.com` });
    const body = "Announcement ".repeat(46); // 598 characters: 4 pages each, 12 units for three people
    // scheduled while there are enough units...
    const { id } = await withOrg(s.c.orgId, (tx) =>
      createCampaign(
        tx,
        s.c.ctx,
        campaignSchema.parse({ channel: "sms", body, audience: { kind: "everyone" }, scheduleAt: new Date(Date.now() + 1000).toISOString() }),
      ),
    );
    // ...then the units run low before it sends
    await withOrg(s.c.orgId, (tx) => tx.insert(smsLedger).values({ orgId: s.c.orgId, units: -45, kind: "adjust", note: "test" }));
    await expect(
      withOrg(s.c.orgId, (tx) => createCampaign(tx, s.c.ctx, campaignSchema.parse({ channel: "sms", body, audience: { kind: "everyone" } }))),
    ).rejects.toThrow(/needs about 12 SMS units and you have 5/);
    await new Promise((r) => setTimeout(r, 1100));
    await drain();
    const [c] = await withOrg(s.c.orgId, (tx) => tx.select().from(messageCampaigns).where(eq(messageCampaigns.id, id)));
    expect(c).toMatchObject({ status: "failed" });
    expect(c!.failureReason).toMatch(/needed 12 SMS units/);
    expect(await withOrg(s.c.orgId, (tx) => smsBalance(tx))).toBe(5);
  });

  it("emails carry an unsubscribe link that withdraws consent", async () => {
    const s = await setup();
    const m = await s.add({ firstName: "Ngozi", email: "ngozi@example.com" });
    await withOrg(s.c.orgId, (tx) =>
      createCampaign(
        tx,
        s.c.ctx,
        campaignSchema.parse({ channel: "email", subject: "News for {first_name}", body: "Dear {first_name},\n\nWelcome.", audience: { kind: "everyone" } }),
      ),
    );
    await drain();
    const [mail] = await db.select().from(devMailbox).where(eq(devMailbox.to, "ngozi@example.com"));
    expect(mail!.subject).toBe("News for Ngozi");
    const token = /\/u\/([A-Za-z0-9_.-]+)/.exec(mail!.html)![1]!;
    expect(readUnsubscribeToken(token)).toEqual({ orgId: s.c.orgId, memberId: m.id });
    expect(readUnsubscribeToken(token.slice(0, -2) + "xx")).toBeNull();
    await unsubscribe(token);
    const [after] = await withOrg(s.c.orgId, (tx) => tx.select().from(members).where(eq(members.id, m.id)));
    expect(after!.consentMessaging).toBe(false);
    expect(unsubscribeToken(s.c.orgId, m.id)).toBe(token);
  });

  it("scheduled messages can be cancelled before they send", async () => {
    const s = await setup();
    await s.add({});
    const { id } = await withOrg(s.c.orgId, (tx) =>
      createCampaign(
        tx,
        s.c.ctx,
        campaignSchema.parse({ channel: "sms", body: "See you Sunday", audience: { kind: "everyone" }, scheduleAt: new Date(Date.now() + 86400_000).toISOString() }),
      ),
    );
    await withOrg(s.c.orgId, (tx) => cancelCampaign(tx, s.c.ctx, id));
    await drain();
    expect((await withOrg(s.c.orgId, (tx) => getCampaign(tx, s.c.ctx, id))).counts.total).toBe(0);
  });
});

describe("delivery and the wallet", () => {
  it("records delivery reports and refunds units for messages the provider rejects", async () => {
    const s = await setup();
    const r = await withOrg(s.c.orgId, (tx) =>
      sendDirect(tx, s.c.orgId, { channel: "sms", to: "+2348031234567", body: "Your code is 4821", purpose: "checkin" }),
    );
    const bad = await withOrg(s.c.orgId, (tx) =>
      sendDirect(tx, s.c.orgId, { channel: "sms", to: "+15551234567", body: "Not Nigerian", purpose: "test" }),
    );
    expect(await withOrg(s.c.orgId, (tx) => smsBalance(tx))).toBe(48);
    await drain();
    const [ok] = await withOrg(s.c.orgId, (tx) => tx.select().from(messages).where(eq(messages.id, r.id)));
    expect(ok!.status).toBe("sent");
    expect(await applyDeliveryReport(ok!.providerId!, "delivered")).toBe(true);
    const [after] = await withOrg(s.c.orgId, (tx) => tx.select().from(messages).where(eq(messages.id, r.id)));
    expect(after!.status).toBe("delivered");
    const [failed] = await withOrg(s.c.orgId, (tx) => tx.select().from(messages).where(eq(messages.id, bad.id)));
    expect(failed!.status).toBe("failed");
    expect(await withOrg(s.c.orgId, (tx) => smsBalance(tx))).toBe(49);
    expect(await applyDeliveryReport("unknown-id", "delivered")).toBe(false);
    await expectDbError(withOrg(s.c.orgId, (tx) => tx.delete(smsLedger)), /cannot be changed or deleted/);
  });

  it("checks Termii signatures and maps their statuses", () => {
    const body = JSON.stringify({ message_id: "x", status: "DELIVERED" });
    const sig = createHmac("sha512", "secret").update(body).digest("hex");
    expect(verifyTermiiSignature(body, sig, "secret")).toBe(true);
    expect(verifyTermiiSignature(body, sig, "other")).toBe(false);
    expect(termiiStatus("DELIVERED")).toBe("delivered");
    expect(termiiStatus("Message Failed")).toBe("failed");
    expect(termiiStatus("Sent")).toBeNull();
  });
});

describe("automatic messages", () => {
  it("sends birthday wishes once a day to people who agreed", async () => {
    const s = await setup();
    const [, mm, dd] = todayISO().split("-").map(Number) as [number, number, number];
    await s.add({ firstName: "Funke", dobDay: dd, dobMonth: mm });
    await s.add({ firstName: "Gbenga", dobDay: dd, dobMonth: mm, phone: "0807 777 8888", email: "g@example.com", consentMessaging: false });
    await s.add({ firstName: "Halima", dobDay: dd === 1 ? 2 : 1, dobMonth: mm, phone: "0808 111 2222", email: "h@example.com" });
    expect(await runAutomations(s.c.orgId)).toEqual([]); // off by default
    await withOrg(s.c.orgId, (tx) =>
      saveAutomation(tx, s.c.ctx, automationSchema.parse({ key: "birthday", enabled: true, channel: "sms", body: "Happy birthday, {first_name}!" })),
    );
    expect(await runAutomations(s.c.orgId)).toEqual(["birthday"]);
    expect(await runAutomations(s.c.orgId)).toEqual([]); // not twice in a day
    await drain();
    const sms = await db.select().from(devMailbox).where(eq(devMailbox.channel, "sms"));
    expect(sms.map((m) => m.text)).toEqual(["Happy birthday, Funke!"]);
  });
});
