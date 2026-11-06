import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withOrg } from "@/server/db";
import { branches, eventRegistrations, givingTransactions, rotaSlots } from "@/server/db/schema";
import { createMember, type MemberInput } from "@/server/services/members";
import { addToGroup, saveGroup } from "@/server/services/groups";
import {
  checkInTicket,
  eventSchema,
  getEvent,
  publicEvent,
  publicTicket,
  registerAtDesk,
  registerForEvent,
  registerSchema,
  saveEvent,
  setEventStatus,
} from "@/server/services/events";
import { fakeCheckout } from "@/server/services/payments";
import { autoFill, fillSchema, respondToSlot, rotaRange, sendRotaReminders, slotToken, sundays } from "@/server/services/rota";
import { newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

async function setup() {
  const c = await newChurch("Harvest House");
  const [hq] = await withOrg(c.orgId, (tx) => tx.select().from(branches));
  return { c, hq: hq!.id };
}

const ev = (hq: string, over: Record<string, unknown> = {}) =>
  eventSchema.parse({
    branchId: hq,
    title: "Youth Conference 2030",
    startsAt: "2030-08-14T10:00",
    endsAt: "2030-08-14T16:00",
    venue: "Main auditorium",
    capacity: "3",
    tickets: [
      { name: "Free", price: "0" },
      { name: "VIP", price: "5000", capacity: "1" },
    ],
    ...over,
  });

describe("events", () => {
  it("free registration confirms at once; capacity is enforced; tickets check in once", async () => {
    const s = await setup();
    const id = await withOrg(s.c.orgId, (tx) => saveEvent(tx, s.c.ctx, ev(s.hq)));
    await withOrg(s.c.orgId, (tx) => setEventStatus(tx, s.c.ctx, id, "published"));
    const e = await withOrg(s.c.orgId, (tx) => getEvent(tx, s.c.ctx, id));
    const free = e.types.find((t) => t.name === "Free")!;
    const r = await registerForEvent(e.token!, registerSchema.parse({ ticketTypeId: free.id, quantity: 2, name: "Ada Obi", email: "ada@example.com", phone: "08031112222" }));
    expect(r.reference).toBeNull();
    await expect(
      registerForEvent(e.token!, registerSchema.parse({ ticketTypeId: free.id, quantity: 2, name: "Bayo Ade", email: "bayo@example.com" })),
    ).rejects.toThrow(/Only 1 Free ticket left/);
    const ticket = await publicTicket(e.token!, r.code);
    expect(ticket).toMatchObject({ name: "Ada Obi", quantity: 2, status: "confirmed" });
    const first = await withOrg(s.c.orgId, (tx) => checkInTicket(tx, s.c.ctx, { eventId: id, code: r.code.toLowerCase().toUpperCase(), count: 1 }));
    expect(first).toMatchObject({ admitted: 1, remaining: 1 });
    await withOrg(s.c.orgId, (tx) => checkInTicket(tx, s.c.ctx, { eventId: id, code: `HTTPS://X/E/TOKEN/T/${r.code}`, count: 5 }));
    await expect(withOrg(s.c.orgId, (tx) => checkInTicket(tx, s.c.ctx, { eventId: id, code: r.code, count: 1 }))).rejects.toThrow(/already used/);
  });

  it("paid tickets confirm after payment and land in the giving ledger", async () => {
    const s = await setup();
    const id = await withOrg(s.c.orgId, (tx) => saveEvent(tx, s.c.ctx, ev(s.hq)));
    await withOrg(s.c.orgId, (tx) => setEventStatus(tx, s.c.ctx, id, "published"));
    const e = await withOrg(s.c.orgId, (tx) => getEvent(tx, s.c.ctx, id));
    const vip = e.types.find((t) => t.name === "VIP")!;
    const r = await registerForEvent(e.token!, registerSchema.parse({ ticketTypeId: vip.id, quantity: 1, name: "Chika Eze", email: "chika@example.com" }));
    expect(r.amountKobo).toBe(500_000);
    // a pending payment holds the place for 30 minutes
    expect((await publicEvent(e.token!))!.types.find((t) => t.name === "VIP")!.left).toBe(0);
    await fakeCheckout(r.reference!, "pay");
    const [reg] = await withOrg(s.c.orgId, (tx) => tx.select().from(eventRegistrations).where(eq(eventRegistrations.code, r.code)));
    expect(reg!.status).toBe("confirmed");
    const [g] = await withOrg(s.c.orgId, (tx) => tx.select().from(givingTransactions));
    expect(g).toMatchObject({ amountKobo: 500_000, status: "confirmed", reference: r.reference });
    const code = await withOrg(s.c.orgId, (tx) => registerAtDesk(tx, s.c.ctx, { eventId: id, ticketTypeId: e.types[0]!.id, name: "Walk In", phone: null, email: null, quantity: 1, checkIn: true }));
    expect(code).toMatch(/^[A-Z2-9]{10}$/);
    const after = await withOrg(s.c.orgId, (tx) => getEvent(tx, s.c.ctx, id));
    expect(after.types.reduce((t, x) => t + x.inside, 0)).toBe(1);
  });
});

describe("volunteer rota", () => {
  it("fills fairly, takes confirmations and declines from the link, and reminds the day before", async () => {
    const s = await setup();
    const g = await withOrg(s.c.orgId, (tx) => saveGroup(tx, s.c.ctx, { kind: "department", name: "Ushering", branchId: s.hq }));
    const ids: string[] = [];
    for (const [i, n] of ["Ada", "Bola", "Chidi"].entries()) {
      const m = await withOrg(s.c.orgId, (tx) =>
        createMember(tx, s.c.ctx, { branchId: s.hq, firstName: n, lastName: "Usher", gender: "male", phone: `0803000000${i}` } as MemberInput, { allowDuplicate: true }),
      );
      await withOrg(s.c.orgId, (tx) => addToGroup(tx, s.c.ctx, g, [m.id]));
      ids.push(m.id);
    }
    const dates = sundays("2030-03-01", 3);
    expect(dates).toEqual(["2030-03-03", "2030-03-10", "2030-03-17"]);
    const r = await withOrg(s.c.orgId, (tx) => autoFill(tx, s.c.ctx, fillSchema.parse({ groupId: g, dates, positions: ["Main door", "Gallery"] })));
    expect(r).toEqual({ assigned: 6, open: 0 });
    const slots = await withOrg(s.c.orgId, (tx) => rotaRange(tx, s.c.ctx, { from: dates[0]!, to: dates[2]! }));
    const counts = new Map<string, number>();
    for (const x of slots) counts.set(x.memberId!, (counts.get(x.memberId!) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([2, 2, 2]);
    // nobody serves twice in one day
    for (const d of dates) expect(new Set(slots.filter((x) => x.date === d).map((x) => x.memberId)).size).toBe(2);
    // running it again leaves existing slots alone
    expect(await withOrg(s.c.orgId, (tx) => autoFill(tx, s.c.ctx, fillSchema.parse({ groupId: g, dates, positions: ["Main door", "Gallery"] })))).toEqual({ assigned: 0, open: 0 });
    const first = slots[0]!;
    await respondToSlot({ token: slotToken(s.c.orgId, first.id), answer: "decline", reason: "Travelling" });
    await expect(respondToSlot({ token: slotToken(s.c.orgId, first.id) + "x", answer: "confirm", reason: null })).rejects.toThrow(/isn't valid/);
    const [after] = await withOrg(s.c.orgId, (tx) => tx.select().from(rotaSlots).where(eq(rotaSlots.id, first.id)));
    expect(after).toMatchObject({ status: "declined", declineReason: "Travelling" });
    expect(await sendRotaReminders(s.c.orgId, dates[0]!)).toBe(1);
    expect(await sendRotaReminders(s.c.orgId, dates[0]!)).toBe(0);
  });
});
