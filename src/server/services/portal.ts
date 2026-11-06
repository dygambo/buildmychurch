import { randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { db, withOrg, type Tx } from "../db";
import {
  eventRegistrations,
  events,
  groupMembers,
  groups,
  memberCodes,
  members,
  memberSessions,
  organisations,
  prayerRequests,
  publicLinks,
  scheduleAssignments,
  scheduleItems,
  serviceSchedules,
} from "../db/schema";
import { systemActor } from "../auth/context";
import { audit } from "../audit";
import { blindIndex, decrypt, encrypt, randomToken, safeEqual, sha256 } from "../crypto";
import { AppError } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, esc, p } from "../emails/layout";
import { env } from "../env";
import { todayISO } from "@/lib/format";
import { maskPhone, normalizeNgPhone } from "@/lib/phone";
import { notifyPrayerTeam, prayerSchema } from "./care";
import { eventToken } from "./events";
import { memberGiving } from "./giving";
import { sendDirect } from "./messaging";
import { slotToken, upcomingFor } from "./rota";

const DAY = 86_400_000;
const SESSION_DAYS = 60;
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export type PortalChurch = { id: string; name: string; slug: string };
export type PortalMember = { id: string; firstName: string; lastName: string; title: string | null; memberNo: string };

export async function portalChurch(slug: string): Promise<PortalChurch | null> {
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) return null;
  const [o] = await db.select({ id: organisations.id, name: organisations.name, slug: organisations.slug }).from(organisations).where(eq(organisations.slug, slug));
  return o ?? null;
}

const cookieName = (slug: string) => `bmc_m_${slug.replace(/[^a-z0-9]/g, "_")}`;
const maskEmail = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_, a: string, b: string, c: string) => `${a}${"•".repeat(Math.min(6, b.length))}${c}`);
const hashCode = (orgId: string, memberId: string, code: string) => sha256(`${orgId}:${memberId}:${code}`);

/* ================= signing in ================= */

export const identifySchema = z.object({ identifier: z.string().trim().min(5, "Enter your phone number or email.").max(120) });

function parseIdentifier(raw: string) {
  if (raw.includes("@")) {
    const e = raw.toLowerCase();
    if (!z.string().email().safeParse(e).success) throw new AppError("Check the email address.", { identifier: "Check the email address." });
    return { kind: "email" as const, value: e };
  }
  const phone = normalizeNgPhone(raw);
  if (!phone) throw new AppError("Enter a Nigerian phone number or an email.", { identifier: "e.g. 0803 123 4567 or you@example.com" });
  return { kind: "sms" as const, value: phone };
}

/**
 * Sends a 6-digit code to the member with this phone number or email. Says the same thing whether or not
 * we found them, so the page can't be used to check who belongs to the church.
 */
export async function requestCode(church: PortalChurch, identifier: string) {
  const id = parseIdentifier(identifier);
  const sentTo = id.kind === "email" ? maskEmail(id.value) : maskPhone(id.value);
  await withOrg(church.id, async (tx) => {
    const [m] = await tx
      .select({ id: members.id, firstName: members.firstName, emailEnc: members.emailEnc, phoneEnc: members.phoneEnc })
      .from(members)
      .where(and(isNull(members.deletedAt), id.kind === "email" ? eq(members.emailHash, blindIndex(id.value)!) : eq(members.phoneHash, blindIndex(id.value)!)))
      .orderBy(asc(members.createdAt))
      .limit(1);
    if (!m) return;
    // at most one live code: a new request replaces the old one
    const recent = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(memberCodes)
      .where(and(eq(memberCodes.memberId, m.id), gt(memberCodes.createdAt, new Date(Date.now() - 3600_000))));
    if ((recent[0]?.n ?? 0) >= 6) return;
    await tx.update(memberCodes).set({ usedAt: new Date() }).where(and(eq(memberCodes.memberId, m.id), isNull(memberCodes.usedAt)));
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await tx.insert(memberCodes).values({
      orgId: church.id,
      memberId: m.id,
      codeHash: hashCode(church.id, m.id, code),
      channel: id.kind,
      expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
    });
    const text = `${code} is your ${church.name} sign-in code. It expires in ${CODE_MINUTES} minutes. Don't share it with anyone.`;
    if (id.kind === "email")
      await enqueue(
        tx,
        "email.send",
        {
          to: id.value,
          subject: `${code} is your sign-in code`,
          html: emailLayout({
            church: church.name,
            heading: `Hello ${esc(m.firstName)}, here's your code`,
            bodyHtml: `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>` + p(`Enter it on the ${esc(church.name)} member page. It expires in ${CODE_MINUTES} minutes.`) + p("If you didn't ask for this, you can ignore this email."),
          }),
        },
        { orgId: church.id },
      );
    else {
      const r = await sendDirect(tx, church.id, { channel: "sms", to: id.value, name: m.firstName, memberId: m.id, body: text, purpose: "portal_code" });
      if (!r.sent) {
        // no SMS units: fall back to email when we have one
        const email = decrypt(m.emailEnc);
        if (email)
          await enqueue(
            tx,
            "email.send",
            { to: email, subject: `${code} is your sign-in code`, html: emailLayout({ church: church.name, heading: "Your sign-in code", bodyHtml: `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>` + p(`It expires in ${CODE_MINUTES} minutes.`) }) },
            { orgId: church.id },
          );
      }
    }
  });
  return { sentTo, kind: id.kind };
}

export const verifySchema = identifySchema.extend({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") });

/** Checks a code and uses it up. Returns the member, or null for a wrong, expired or used code. */
export async function checkCode(church: PortalChurch, identifier: string, code: string) {
  const id = parseIdentifier(identifier);
  return withOrg(church.id, async (tx) => {
    const candidates = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(isNull(members.deletedAt), id.kind === "email" ? eq(members.emailHash, blindIndex(id.value)!) : eq(members.phoneHash, blindIndex(id.value)!)));
    if (!candidates.length) return null;
    const [c] = await tx
      .select()
      .from(memberCodes)
      .where(and(inArray(memberCodes.memberId, candidates.map((x) => x.id)), isNull(memberCodes.usedAt), gt(memberCodes.expiresAt, new Date())))
      .orderBy(desc(memberCodes.createdAt))
      .limit(1)
      .for("update");
    if (!c) return null;
    if (c.attempts >= MAX_ATTEMPTS) {
      await tx.update(memberCodes).set({ usedAt: new Date() }).where(eq(memberCodes.id, c.id));
      return null;
    }
    if (!safeEqual(c.codeHash, hashCode(church.id, c.memberId, code))) {
      await tx.update(memberCodes).set({ attempts: c.attempts + 1 }).where(eq(memberCodes.id, c.id));
      return null;
    }
    await tx.update(memberCodes).set({ usedAt: new Date() }).where(eq(memberCodes.id, c.id));
    await audit(tx, { system: "Member portal", orgId: church.id }, { action: "portal.signed_in", summary: "Signed in to the member page", entityType: "member", entityId: c.memberId });
    return c.memberId;
  });
}

export async function verifyCode(church: PortalChurch, identifier: string, code: string) {
  const memberId = await checkCode(church, identifier, code);
  if (!memberId) throw new AppError("That code didn't work. Check it, or ask for a new one.", { code: "Wrong or expired code." });
  const token = randomToken(32);
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await db.insert(memberSessions).values({
    id: sha256(token),
    orgId: church.id,
    memberId,
    expiresAt,
    ip: (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  (await cookies()).set(cookieName(church.slug), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/m/${church.slug}`,
    expires: expiresAt,
  });
}

/** The signed-in member for this church's portal, or null. */
export async function portalMember(church: PortalChurch): Promise<PortalMember | null> {
  const token = (await cookies()).get(cookieName(church.slug))?.value;
  if (!token) return null;
  const [s] = await db.select().from(memberSessions).where(eq(memberSessions.id, sha256(token)));
  if (!s || s.orgId !== church.id || s.expiresAt < new Date()) return null;
  if (Date.now() - s.lastSeenAt.getTime() > 10 * 60_000) await db.update(memberSessions).set({ lastSeenAt: new Date() }).where(eq(memberSessions.id, s.id));
  const m = await withOrg(church.id, async (tx) => {
    const [x] = await tx
      .select({ id: members.id, firstName: members.firstName, lastName: members.lastName, title: members.title, memberNo: members.memberNo })
      .from(members)
      .where(and(eq(members.id, s.memberId), isNull(members.deletedAt)));
    return x ?? null;
  });
  return m;
}

export async function signOutMember(church: PortalChurch) {
  const jar = await cookies();
  const token = jar.get(cookieName(church.slug))?.value;
  if (token) await db.delete(memberSessions).where(eq(memberSessions.id, sha256(token)));
  jar.set(cookieName(church.slug), "", { path: `/m/${church.slug}`, expires: new Date(0) });
}

/** Lets staff end every portal session for a member, e.g. after a lost phone. */
export async function endMemberSessions(memberId: string) {
  await db.delete(memberSessions).where(eq(memberSessions.memberId, memberId));
}

/* ================= what members see ================= */

export async function portalHome(church: PortalChurch, m: PortalMember) {
  return withOrg(church.id, async (tx) => {
    const today = todayISO();
    const slots = (await upcomingFor(tx, m.id)).map((s) => ({ ...s, respondUrl: `/r/${slotToken(church.id, s.id)}` }));
    const parts = await tx
      .select({ title: serviceSchedules.title, serviceDate: serviceSchedules.serviceDate, startTime: serviceSchedules.startTime, item: scheduleItems.title, responsibility: scheduleAssignments.responsibility })
      .from(scheduleAssignments)
      .innerJoin(serviceSchedules, eq(serviceSchedules.id, scheduleAssignments.scheduleId))
      .innerJoin(scheduleItems, eq(scheduleItems.id, scheduleAssignments.itemId))
      .where(and(eq(scheduleAssignments.memberId, m.id), isNull(serviceSchedules.deletedAt), sql`${serviceSchedules.currentVersion} > 0`, gte(serviceSchedules.serviceDate, today)))
      .orderBy(asc(serviceSchedules.serviceDate))
      .limit(10);
    const upcoming = await upcomingEvents(tx);
    const groupsIn = await tx
      .select({ name: groups.name, kind: groups.kind, role: groupMembers.role })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.memberId, m.id), isNull(groups.archivedAt)));
    const giving = await memberGiving(tx, systemActor(church, "Member portal", ["giving.read_named"]), m.id);
    const myTickets = await tx
      .select({ title: events.title, startsAt: events.startsAt, code: eventRegistrations.code, eventId: events.id, quantity: eventRegistrations.quantity })
      .from(eventRegistrations)
      .innerJoin(events, eq(events.id, eventRegistrations.eventId))
      .where(and(eq(eventRegistrations.memberId, m.id), eq(eventRegistrations.status, "confirmed"), gte(events.startsAt, new Date())))
      .orderBy(asc(events.startsAt));
    const tickets = [];
    for (const t of myTickets) tickets.push({ ...t, url: `/e/${await eventToken(tx, church.id, t.eventId)}/t/${t.code}` });
    return {
      slots,
      parts: parts.map((x) => ({ ...x, serviceDate: String(x.serviceDate) })),
      events: upcoming,
      groups: groupsIn,
      givingYear: giving.total,
      givingMonths: giving.monthsGiven,
      tickets,
    };
  });
}

async function upcomingEvents(tx: Tx) {
  const rows = await tx
    .select({ id: events.id, title: events.title, startsAt: events.startsAt, venue: events.venue })
    .from(events)
    .where(and(eq(events.status, "published"), eq(events.registrationOpen, true), gte(events.startsAt, new Date())))
    .orderBy(asc(events.startsAt))
    .limit(6);
  const out = [];
  for (const e of rows) {
    const [l] = await tx
      .select({ token: publicLinks.token })
      .from(publicLinks)
      .where(and(eq(publicLinks.kind, "event"), eq(publicLinks.targetId, e.id), isNull(publicLinks.revokedAt)));
    if (l) out.push({ ...e, url: `/e/${l.token}` });
  }
  return out;
}

export async function portalGiving(church: PortalChurch, m: PortalMember, year?: number) {
  return withOrg(church.id, (tx) => memberGiving(tx, systemActor(church, "Member portal", ["giving.read_named"]), m.id, year));
}

/* ================= profile ================= */

export async function portalProfile(church: PortalChurch, m: PortalMember) {
  return withOrg(church.id, async (tx) => {
    const [x] = await tx.select().from(members).where(eq(members.id, m.id));
    return {
      name: [x!.title, x!.firstName, x!.lastName].filter(Boolean).join(" "),
      memberNo: x!.memberNo,
      phone: decrypt(x!.phoneEnc),
      email: decrypt(x!.emailEnc),
      address: decrypt(x!.addressEnc),
      area: x!.area,
      occupation: x!.occupation,
      employer: x!.employer,
      dobDay: x!.dobDay,
      dobMonth: x!.dobMonth,
      maritalStatus: x!.maritalStatus,
      consentMessaging: x!.consentMessaging,
      joinDate: String(x!.joinDate),
    };
  });
}

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);

export const profileSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Check the email address.")
      .optional()
      .or(z.literal(""))
      .transform((v) => v || null),
    address: opt(300),
    area: opt(80),
    occupation: opt(80),
    employer: opt(120),
    dobDay: z.coerce.number().int().min(1).max(31).optional().nullable().or(z.literal("").transform(() => null)),
    dobMonth: z.coerce.number().int().min(1).max(12).optional().nullable().or(z.literal("").transform(() => null)),
    maritalStatus: z.enum(["single", "married", "widowed", "divorced", "separated"]).optional().nullable().or(z.literal("").transform(() => null)),
    consentMessaging: z.boolean(),
  })
  .refine((v) => !v.dobDay === !v.dobMonth, { path: ["dobDay"], message: "Choose both the day and the month, or neither." });

export async function updatePortalProfile(church: PortalChurch, m: PortalMember, input: z.output<typeof profileSchema>) {
  await withOrg(church.id, async (tx) => {
    if (input.email) {
      const [clash] = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.emailHash, blindIndex(input.email)!), isNull(members.deletedAt), sql`${members.id} <> ${m.id}`))
        .limit(1);
      if (clash) throw new AppError("Another member already uses that email. Ask the church office to help.", { email: "Already in use." });
    }
    const [before] = await tx.select({ consent: members.consentMessaging }).from(members).where(eq(members.id, m.id));
    await tx
      .update(members)
      .set({
        emailEnc: encrypt(input.email),
        emailHash: blindIndex(input.email),
        addressEnc: encrypt(input.address),
        area: input.area,
        occupation: input.occupation,
        employer: input.employer,
        dobDay: input.dobDay ?? null,
        dobMonth: input.dobMonth ?? null,
        maritalStatus: input.maritalStatus ?? null,
        consentMessaging: input.consentMessaging,
      })
      .where(eq(members.id, m.id));
    await audit(
      tx,
      { system: "Member portal", orgId: church.id },
      {
        action: "member.self_updated",
        summary: `${m.firstName} ${m.lastName} updated their details on the member page${before && before.consent !== input.consentMessaging ? (input.consentMessaging ? " and agreed to receive messages" : " and stopped messages") : ""}`,
        entityType: "member",
        entityId: m.id,
      },
    );
  });
}

/* ================= prayer ================= */

export async function myPrayer(church: PortalChurch, m: PortalMember) {
  return withOrg(church.id, async (tx) => {
    const rows = await tx
      .select()
      .from(prayerRequests)
      .where(and(eq(prayerRequests.memberId, m.id), isNull(prayerRequests.deletedAt)))
      .orderBy(desc(prayerRequests.createdAt))
      .limit(30);
    return rows.map((r) => ({ id: r.id, body: decrypt(r.bodyEnc) ?? "", status: r.status, prayedCount: r.prayedCount, createdAt: r.createdAt, testimony: decrypt(r.testimonyEnc), confidential: r.confidential }));
  });
}

export const portalPrayerSchema = prayerSchema.pick({ body: true, category: true, confidential: true, wantsContact: true });

export async function addMyPrayer(church: PortalChurch, m: PortalMember, input: z.output<typeof portalPrayerSchema>) {
  await withOrg(church.id, async (tx) => {
    const [x] = await tx.select({ branchId: members.branchId }).from(members).where(eq(members.id, m.id));
    const [r] = await tx
      .insert(prayerRequests)
      .values({
        orgId: church.id,
        branchId: x!.branchId,
        memberId: m.id,
        name: `${m.firstName} ${m.lastName}`,
        bodyEnc: encrypt(input.body)!,
        category: input.category,
        confidential: input.confidential,
        wantsContact: input.wantsContact,
        source: "portal",
        createdByName: "Member page",
      })
      .returning({ id: prayerRequests.id });
    await audit(tx, { system: "Member portal", orgId: church.id }, { action: "prayer.received", summary: `${m.firstName} ${m.lastName} sent a prayer request from the member page`, entityType: "prayer", entityId: r!.id });
    await notifyPrayerTeam(tx, church.id, r!.id, { ...input, memberId: m.id, name: null, phone: null, email: null, branchId: null }, `${m.firstName} ${m.lastName}`);
  });
}

/** For staff: the link members use. */
export const portalUrl = (slug: string) => `${env().APP_URL}/m/${slug}`;
