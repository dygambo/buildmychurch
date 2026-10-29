import "dotenv/config";
import { eq } from "drizzle-orm";
import { signUp } from "@/server/services/accounts";
import { closeDb, db, withOrg } from "@/server/db";
import { branches, memberships, organisations, roles, users } from "@/server/db/schema";
import { makeActor } from "@/server/auth/context";
import { hashPassword } from "@/server/auth/password";
import type { Permission } from "@/server/auth/permissions";
import { saveBranch } from "@/server/services/org";
import { createMember, linkHousehold, setMemberTags } from "@/server/services/members";
import { addToGroup, saveGroup, setGroupRole } from "@/server/services/groups";
import { checkIn, createService, lagosToday, recordHeadcount, saveTemplate } from "@/server/services/attendance";
import { addNote, getVisitorLink, listFollowups, moveFollowup, submitVisitorCard } from "@/server/services/followup";
import { checkInChild, checkOutChild, getChild, registerChild } from "@/server/services/children";
import {
  addPledge,
  batchLinesSchema,
  campaignSchema,
  createBatch,
  listFunds,
  pledgeSchema,
  saveBatchLines,
  saveCampaign,
  submitBatch,
  updateGivingSettings,
  verifyBatch,
} from "@/server/services/giving";
import { givingTransactions, jobs, members, messageCampaigns, messages, scheduleVersions, smsLedger } from "@/server/db/schema";
import { approveMemo, memoSchema, queryMemo, saveMemo, saveRoute as saveMemoRoute, submitMemo } from "@/server/services/memos";
import { randomUUID } from "node:crypto";
import { blindIndex, encrypt } from "@/server/crypto";
import { rotaSlots as rotaSlotsT } from "@/server/db/schema";
import { deskSchema, eventSchema, registerAtDesk, saveEvent, setEventStatus } from "@/server/services/events";
import { autoFill, fillSchema, sundays } from "@/server/services/rota";
import { addEntry, addPrayer, caseSchema, entrySchema, markPrayed, prayerLink, prayerSchema, publicPrayerSchema, saveCase, submitPublicPrayer, updatePrayer } from "@/server/services/care";
import { createForm, getForm, setFormStatus, submitForm } from "@/server/services/forms";
import { caseSchema as counselCaseSchema, completeCase, completeSchema, publicRequestSchema, recordSchema, recordSession, requestLink, saveCase as saveCounselCase, scheduleSession, sessionSchema, submitRequest, toggleChecklist } from "@/server/services/counselling";
import { counsellingSessions } from "@/server/db/schema";
import { rotaSlots, ticketTypes } from "@/server/db/schema";
import { groups } from "@/server/db/schema";
import {
  completePastSchedules,
  generateVersionPdf,
  getSchedule as getScheduleFull,
  listTemplates as listScheduleTemplates,
  publishSchedule,
  saveSchedule,
  scheduleSchema,
  startSchedule,
} from "@/server/services/schedules";
import {
  applyDeliveryReport,
  AUTOMATIONS,
  automationSchema,
  campaignSchema as messageSchema,
  createCampaign,
  deliverMessages,
  prepareCampaign,
  saveAutomation,
} from "@/server/services/messaging";
import {
  approveExpense,
  assetSchema,
  budgetSchema,
  calculateRemittances,
  DEFAULT_LIFE,
  expenseSchema,
  listCategories,
  markExpensePaid,
  previousPeriod,
  saveAsset,
  saveBudget,
  saveExpense,
  saveOpeningBalances,
  submitExpense,
} from "@/server/services/expenses";
import { and, asc, inArray, isNull, sql } from "drizzle-orm";

/**
 * Creates a demo church with branches, departments, home cells and about 120 members.
 * Run once on an empty database: `npm run db:reset && npm run db:seed`.
 */
const DEMO = {
  churchName: "Grace Assembly Lagos",
  name: "Pastor Tunde Adeyemi",
  email: "demo@buildmychurch.com",
  password: "Grace-Assembly-2026",
};

const FIRST_M = [
  "Tunde",
  "Emeka",
  "Ibrahim",
  "Chinedu",
  "Segun",
  "Musa",
  "Obinna",
  "Femi",
  "Kelechi",
  "Babajide",
  "Uche",
  "Yusuf",
  "Daniel",
  "Samuel",
  "David",
  "Tobi",
  "Ifeanyi",
  "Kunle",
  "Ahmed",
  "Victor",
];
const FIRST_F = [
  "Ngozi",
  "Funke",
  "Aisha",
  "Chioma",
  "Bukola",
  "Amaka",
  "Zainab",
  "Grace",
  "Blessing",
  "Yetunde",
  "Adaeze",
  "Halima",
  "Esther",
  "Joy",
  "Temitope",
  "Ifeoma",
  "Kemi",
  "Nneka",
  "Ruth",
  "Deborah",
];
const LAST = [
  "Adeyemi",
  "Okafor",
  "Bello",
  "Eze",
  "Ogunleye",
  "Ibrahim",
  "Nwosu",
  "Balogun",
  "Okeke",
  "Lawal",
  "Obi",
  "Adebayo",
  "Umeh",
  "Danjuma",
  "Akande",
  "Chukwu",
  "Afolabi",
  "Mohammed",
  "Onyekachi",
  "Oyelaran",
];
const AREAS = [
  "Ikeja",
  "Yaba",
  "Surulere",
  "Lekki",
  "Ajah",
  "Gbagada",
  "Magodo",
  "Ikorodu",
  "Festac",
  "Victoria Island",
];
const JOBS = [
  "Banker",
  "Engineer",
  "Teacher",
  "Trader",
  "Nurse",
  "Doctor",
  "Civil servant",
  "Student",
  "Lawyer",
  "Accountant",
  "Fashion designer",
  "Pharmacist",
];

let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;

async function main() {
  const [existing] = await db.select().from(users).where(eq(users.email, DEMO.email));
  if (existing) {
    await topUpDemo(existing.id);
    console.log(`The demo church already exists. Sign in with ${DEMO.email} / ${DEMO.password}`);
    return;
  }
  const r = await signUp(DEMO);
  const [row] = await db
    .select({ m: memberships, r: roles, o: organisations, u: users })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(organisations, eq(organisations.id, memberships.orgId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.userId, r.userId));
  const ctx = makeActor({
    user: { id: row!.u.id, name: row!.u.name, email: row!.u.email, mfaEnabled: false },
    org: {
      id: row!.o.id,
      name: row!.o.name,
      slug: row!.o.slug,
      plan: row!.o.plan,
      smsSenderId: null,
      timezone: row!.o.timezone,
    },
    membership: {
      id: row!.m.id,
      roleId: row!.r.id,
      roleKey: row!.r.key,
      roleName: row!.r.name,
      title: null,
      staffId: null,
      phone: null,
    },
    perms: new Set(row!.r.permissions as Permission[]),
    branchIds: [],
  });

  await withOrg(r.orgId, async (tx) => {
    const [hq] = await tx.select().from(branches);
    const lekki = await saveBranch(tx, ctx, { name: "Lekki", code: "LEK", pastorName: "Pst. Ngozi Okafor" });
    const ikeja = await saveBranch(tx, ctx, { name: "Ikeja", code: "IKJ", pastorName: "Pst. Segun Balogun" });
    const branchIds = [hq!.id, hq!.id, hq!.id, lekki, ikeja];

    const depts = await Promise.all(
      ["Choir", "Ushering", "Media", "Protocol", "Children's Church", "Sanctuary Keepers"].map((name) =>
        saveGroup(tx, ctx, {
          kind: "department",
          name,
          branchId: hq!.id,
          meetingDay: "Saturday",
          meetingTime: "16:00",
        }),
      ),
    );
    const cells = await Promise.all(
      ["Ikeja GRA Cell", "Yaba Cell", "Lekki Phase 1 Cell", "Surulere Cell"].map((name, i) =>
        saveGroup(tx, ctx, {
          kind: "cell",
          name,
          branchId: hq!.id,
          meetingDay: "Wednesday",
          meetingTime: "18:30",
          area: AREAS[i],
        }),
      ),
    );
    await saveGroup(tx, ctx, { kind: "ministry", name: "Youth Church", branchId: hq!.id });
    await saveGroup(tx, ctx, { kind: "ministry", name: "Women of Virtue", branchId: hq!.id });

    const today = new Date();
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) {
      const male = rand() < 0.46;
      const daysAgo = Math.floor(rand() ** 1.6 * 900);
      const joined = new Date(today.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
      const stage =
        daysAgo < 30
          ? pick(["first_timer", "first_timer", "second_timer", "visitor"] as const)
          : rand() < 0.75
            ? "member"
            : "regular";
      const first = pick(male ? FIRST_M : FIRST_F);
      const last = pick(LAST);
      const near = i < 6; // a few birthdays this week so the dashboard has something to show
      const bday = near ? new Date(today.getTime() + (i % 6) * 86400000) : null;
      const m = await createMember(
        tx,
        ctx,
        {
          branchId: pick(branchIds),
          title: rand() < 0.5 ? (male ? "Bro." : "Sis.") : undefined,
          firstName: first,
          lastName: last,
          gender: male ? "male" : "female",
          phone: `080${String(30000000 + i * 7919).slice(0, 8)}`,
          email: rand() < 0.6 ? `${first}.${last}${i}@example.com`.toLowerCase() : undefined,
          dobDay: bday ? bday.getDate() : 1 + Math.floor(rand() * 28),
          dobMonth: bday ? bday.getMonth() + 1 : 1 + Math.floor(rand() * 12),
          dobYear: rand() < 0.7 ? 1965 + Math.floor(rand() * 40) : null,
          maritalStatus: pick(["single", "married", "married", "single", "widowed"] as const),
          area: pick(AREAS),
          occupation: pick(JOBS),
          stage,
          joinDate: joined,
          consentMessaging: rand() < 0.85,
          baptism: stage === "member" ? pick(["water", "both", "both"] as const) : "none",
        },
        { allowDuplicate: true },
      );
      ids.push(m.id);
      if (stage === "member" && rand() < 0.6) await addToGroup(tx, ctx, pick(depts), [m.id]);
      if (rand() < 0.5) await addToGroup(tx, ctx, pick(cells), [m.id]);
    }
    for (const [i, g] of [...depts, ...cells].entries()) {
      const leader = ids[(i * 13) % ids.length]!;
      await addToGroup(tx, ctx, g, [leader]);
      await setGroupRole(tx, ctx, g, leader, "leader", true);
    }
    await linkHousehold(tx, ctx, { memberId: ids[0]!, otherId: ids[1]!, memberRole: "head", otherRole: "spouse" });
    await setMemberTags(tx, ctx, ids[0]!, ["Workforce", "Foundation School Teacher"]);

    // regular services, and ten weeks of Sunday attendance
    await saveTemplate(tx, ctx, {
      branchId: hq!.id,
      name: "Sunday First Service",
      kind: "sunday",
      weekday: 0,
      startTime: "08:00",
      durationMin: 120,
    });
    await saveTemplate(tx, ctx, {
      branchId: hq!.id,
      name: "Sunday Second Service",
      kind: "sunday",
      weekday: 0,
      startTime: "10:30",
      durationMin: 120,
    });
    await saveTemplate(tx, ctx, {
      branchId: hq!.id,
      name: "Midweek Communion Service",
      kind: "midweek",
      weekday: 3,
      startTime: "18:00",
      durationMin: 90,
    });
    const todayStr = lagosToday();
    const lastSunday = new Date(`${todayStr}T12:00:00Z`);
    lastSunday.setUTCDate(lastSunday.getUTCDate() - lastSunday.getUTCDay());
    for (let w = 9; w >= 0; w--) {
      const d = new Date(lastSunday.getTime() - w * 7 * 86400000).toISOString().slice(0, 10);
      const sid = await createService(tx, ctx, {
        branchId: hq!.id,
        name: "Sunday First Service",
        kind: "sunday",
        date: d,
        startTime: "08:00",
        durationMin: 120,
      });
      for (const id of ids)
        if (rand() < 0.55 + (9 - w) * 0.01) await checkIn(tx, ctx, sid, id, rand() < 0.4 ? "self_qr" : "staff");
      const men = 140 + Math.floor(rand() * 30) + (9 - w) * 3;
      await recordHeadcount(tx, ctx, sid, {
        men,
        women: Math.round(men * 1.3),
        children: 60 + Math.floor(rand() * 20),
        online: 80 + Math.floor(rand() * 60),
      });
    }

    // visitor cards from the last two Sundays
    await getVisitorLink(tx, ctx);
    const visitors = [
      ["Tolani", "Bakare", "female", "Pray for my new job in Lekki"],
      ["Ikenna", "Obi", "male", ""],
      ["Hauwa", "Garba", "female", "Healing for my mother"],
      ["Seun", "Martins", "male", ""],
      ["Precious", "Ekpo", "female", ""],
    ] as const;
    for (const [i, [f, l, g, prayer]] of visitors.entries())
      await submitVisitorCard(tx, ctx.org, hq!.id, {
        firstName: f,
        lastName: l,
        gender: g,
        phone: `0906${String(1000000 + i * 7331).slice(0, 7)}`,
        area: pick(AREAS),
        prayerRequest: prayer || undefined,
        wantsVisit: i % 2 === 0,
        consentMessaging: true,
      });
    const cases = await listFollowups(tx, ctx);
    await addNote(tx, ctx, cases[0]!.id, {
      method: "call",
      outcome: "reached",
      body: "Lovely call. Will come again next Sunday.",
      nextDueDays: 7,
    });
    await addNote(tx, ctx, cases[1]!.id, { method: "call", outcome: "no_answer", nextDueDays: 2 });
    await addNote(tx, ctx, cases[2]!.id, {
      method: "visit",
      outcome: "reached",
      body: "Visited at home with Sis. Bukola. Prayed for her mother.",
    });
    await moveFollowup(tx, ctx, cases[2]!.id, "visited");

    // children with their parents
    const kids = [
      ["Chidi", "Okafor", "male", 6],
      ["Amara", "Okafor", "female", 3],
      ["Tobi", "Adeyemi", "male", 9],
      ["Fatima", "Bello", "female", 5],
      ["David", "Eze", "male", 11],
      ["Zara", "Lawal", "female", 1],
      ["Ife", "Balogun", "female", 7],
      ["Joshua", "Nwosu", "male", 14],
    ] as const;
    const childIds: string[] = [];
    for (const [i, [f, l, g, age]] of kids.entries()) {
      const dob = `${new Date().getFullYear() - age}-0${1 + (i % 9)}-1${i % 9}`;
      const shared = l === "Okafor" ? 0 : i;
      const r = await registerChild(tx, ctx, {
        branchId: hq!.id,
        firstName: f,
        lastName: l,
        gender: g,
        dob,
        allergies: f === "Chidi" ? "Peanuts" : undefined,
        guardians: [
          {
            title: "Mrs.",
            firstName: pick(FIRST_F),
            lastName: l,
            relationship: "Mother",
            phone: `0907${String(2000000 + shared * 911).slice(0, 7)}`,
            email: `parent${shared}@example.com`,
            isPrimary: true,
          },
          {
            title: "Mr.",
            firstName: pick(FIRST_M),
            lastName: l,
            relationship: "Father",
            phone: `0908${String(3000000 + shared * 733).slice(0, 7)}`,
          },
          ...(i === 0
            ? [
                {
                  firstName: "Joy",
                  lastName: "Nnaji",
                  relationship: "Aunt",
                  phone: "0907 555 1212",
                  canPickUp: false,
                  notify: false,
                },
              ]
            : []),
        ],
      });
      childIds.push(r.id);
    }
    for (const [i, id] of childIds.entries()) {
      const c = await getChild(tx, ctx, id);
      await checkInChild(tx, ctx, { childId: id, droppedOffBy: c.guardians[0]!.id, method: i % 2 ? "qr" : "manual" });
      if (i > 2)
        await checkOutChild(tx, ctx, {
          childId: id,
          pickedUpBy: c.guardians[c.guardians.length > 1 ? 1 : 0]!.id,
          method: "qr",
        });
    }
  });
  await seedGiving(r.orgId, row!.u.id);
  await seedMessaging(r.orgId, row!.u.id);
  await seedSchedules(r.orgId, row!.u.id);
  await seedMemos(r.orgId, row!.u.id);
  await seedEvents(r.orgId, row!.u.id);
  await seedCare(r.orgId, row!.u.id);
  await seedTestAccounts(r.orgId);
  await seedCounselling(r.orgId, row!.u.id);
  console.log(`Demo church created with 120 members. Every account below uses the password ${DEMO.password}`);
  console.table([
    { email: DEMO.email, role: "Super Admin (owner)" },
    { email: "finance@graceassembly.ng", role: "Finance Officer" },
    { email: "secretary@graceassembly.ng", role: "Church Administrator" },
    ...TEST_ACCOUNTS.map((a) => ({ email: a.email, role: a.title })),
  ]);
  console.log(`Member page: /m/<church> — sign in as ${PORTAL_MEMBER_EMAIL}; the code appears in /dev/mailbox.`);
}

async function actorFor(userId: string, orgId: string) {
  const [row] = await db
    .select({ m: memberships, r: roles, o: organisations, u: users })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(organisations, eq(organisations.id, memberships.orgId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  return makeActor({
    user: { id: row!.u.id, name: row!.u.name, email: row!.u.email, mfaEnabled: false },
    org: {
      id: row!.o.id,
      name: row!.o.name,
      slug: row!.o.slug,
      plan: row!.o.plan,
      smsSenderId: null,
      timezone: row!.o.timezone,
    },
    membership: {
      id: row!.m.id,
      roleId: row!.r.id,
      roleKey: row!.r.key,
      roleName: row!.r.name,
      title: null,
      staffId: null,
      phone: null,
    },
    perms: new Set(row!.r.permissions as Permission[]),
    branchIds: [],
  });
}

/** Ten Sundays of counted, verified collections, a few online gifts, one project with pledges, and this week's draft. */
async function seedGiving(orgId: string, ownerId: string) {
  const [financeRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.orgId, orgId), eq(roles.key, "finance")));
  const [fin] = await db
    .insert(users)
    .values({ email: "finance@graceassembly.ng", name: "Bisi Adewale", passwordHash: await hashPassword(DEMO.password) })
    .returning({ id: users.id });
  await db.insert(memberships).values({ orgId, userId: fin!.id, roleId: financeRole!.id, title: "Church Accountant" });
  const owner = await actorFor(ownerId, orgId);
  const counter = await actorFor(fin!.id, orgId);

  await withOrg(orgId, async (tx) => {
    // offline receipts would email every seeded member; switch them on after seeding
    await updateGivingSettings(tx, owner, { receiptsForOffline: false });
    const funds = await listFunds(tx);
    const f = Object.fromEntries(funds.map((x) => [x.code, x.id])) as Record<string, string>;
    const [hq] = await tx.select().from(branches).orderBy(asc(branches.createdAt)).limit(1);
    const people = await tx
      .select({ id: members.id, first: members.firstName, last: members.lastName })
      .from(members)
      .where(isNull(members.deletedAt))
      .limit(60);

    const camp = await saveCampaign(
      tx,
      owner,
      campaignSchema.parse({
        name: "New Sanctuary Project",
        description: "A 2,000-seat sanctuary on the Lekki site, with children's wing and car park.",
        fundId: f.BUILDING,
        goal: "50000000",
        showOnline: true,
      }),
    );
    for (const p of people.slice(0, 14))
      await addPledge(
        tx,
        owner,
        pledgeSchema.parse({
          campaignId: camp,
          memberId: p.id,
          amount: String(pick([100000, 250000, 500000, 1000000, 2000000])),
        }),
      );

    const today = new Date();
    const sunday = new Date(today.getTime() - today.getUTCDay() * 86400000);
    for (let w = 10; w >= 0; w--) {
      const day = new Date(sunday.getTime() - w * 7 * 86400000).toISOString().slice(0, 10);
      const growth = 1 + (10 - w) * 0.025;
      const b = await createBatch(tx, counter, {
        branchId: hq!.id,
        kind: "service",
        serviceId: null,
        label: "Sunday Celebration Service",
        givenOn: day,
      });
      const amt = (base: number) => String(Math.round((base * growth * (0.85 + rand() * 0.3)) / 100) * 100);
      const named = people.slice(0, 60).filter(() => rand() < 0.35);
      await saveBatchLines(
        tx,
        counter,
        b,
        batchLinesSchema.parse({
          lines: [
            { fundId: f.OFFERING, channel: "cash", amount: amt(420000) },
            { fundId: f.OFFERING, channel: "pos", amount: amt(160000) },
            { fundId: f.TITHE, channel: "cash", amount: amt(380000) },
            { fundId: f.THANKS, channel: "cash", amount: amt(90000) },
            { fundId: f.WELFARE, channel: "cash", amount: amt(30000) },
            ...named.map((p) => ({
              fundId: rand() < 0.75 ? f.TITHE : f.BUILDING,
              channel: rand() < 0.6 ? "transfer" : "cash",
              amount: String(pick([5000, 10000, 15000, 20000, 25000, 50000, 75000, 100000])),
              memberId: p.id,
            })),
          ],
        }),
      );
      if (w === 0) continue; // this Sunday's count stays a draft
      await submitBatch(tx, counter, b);
      if (w === 1) continue; // last Sunday waits for the second signature
      await verifyBatch(tx, owner, b);
    }

    // online gifts through the giving page
    let n = 0;
    for (let d = 70; d >= 1; d -= 2) {
      const p = people[Math.floor(rand() * people.length)]!;
      const amount = pick([2000, 5000, 10000, 20000, 50000]) * 100;
      const anon = rand() < 0.15;
      await tx.insert(givingTransactions).values({
        orgId,
        branchId: hq!.id,
        fundId: pick([f.TITHE, f.TITHE, f.OFFERING, f.SEED, f.BUILDING])!,
        memberId: anon ? null : p.id,
        anonymous: anon,
        amountKobo: amount,
        feeKobo: Math.min(Math.round(amount * 0.015) + (amount >= 250000 ? 10000 : 0), 200000),
        channel: "online",
        gatewayChannel: pick(["card", "bank_transfer", "ussd"]),
        source: "online",
        status: "confirmed",
        givenOn: new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10),
        reference: `BMC-SEED${String(++n).padStart(4, "0")}`,
        confirmedAt: new Date(),
      });
    }
    await updateGivingSettings(tx, owner, { receiptsForOffline: true });

    /* ---------- expenses, budgets, assets ---------- */
    const year = today.getFullYear();
    const cats = Object.fromEntries((await listCategories(tx)).map((c) => [c.code, c.id])) as Record<string, string>;
    await saveOpeningBalances(tx, owner, {
      openingDate: new Date(today.getTime() - 120 * 86400000).toISOString().slice(0, 10),
      balances: { [f.OFFERING!]: 1_850_000_00, [f.TITHE!]: 3_200_000_00, [f.BUILDING!]: 12_500_000_00, [f.WELFARE!]: 420_000_00 },
    });
    await saveBudget(
      tx,
      counter,
      budgetSchema.parse({
        year,
        branchId: hq!.id,
        lines: [
          { categoryId: cats.SALARY, amount: "14400000" },
          { categoryId: cats.UTIL, amount: "4800000" },
          { categoryId: cats.MAINT, amount: "3000000" },
          { categoryId: cats.MINISTRY, amount: "2400000" },
          { categoryId: cats.WELFARE, amount: "1800000" },
          { categoryId: cats.OUTREACH, amount: "1500000" },
          { categoryId: cats.EQUIP, amount: "2500000" },
          { categoryId: cats.ADMIN, amount: "900000" },
        ],
      }),
    );
    const spend: [string, string, string, string, number, string, number][] = [
      // [category, fund, payee, what for, naira, method, days ago]
      ["SALARY", "TITHE", "Staff payroll", "Monthly salaries and allowances", 1_150_000, "transfer", 75],
      ["SALARY", "TITHE", "Staff payroll", "Monthly salaries and allowances", 1_150_000, "transfer", 45],
      ["SALARY", "TITHE", "Staff payroll", "Monthly salaries and allowances", 1_180_000, "transfer", 14],
      ["UTIL", "OFFERING", "Total Filling Station", "Diesel for Sunday services", 38_000, "cash", 70],
      ["UTIL", "OFFERING", "Total Filling Station", "Diesel for Sunday services", 41_500, "cash", 56],
      ["UTIL", "OFFERING", "Ikeja Electric", "Prepaid electricity units", 85_000, "transfer", 50],
      ["UTIL", "OFFERING", "Total Filling Station", "Diesel for Sunday services", 44_000, "cash", 28],
      ["UTIL", "OFFERING", "Ikeja Electric", "Prepaid electricity units", 90_000, "transfer", 20],
      ["MAINT", "OFFERING", "CoolTech Services", "Servicing of auditorium air conditioners", 165_000, "transfer", 40],
      ["MINISTRY", "OFFERING", "Youth Church", "Youth conference refreshments", 120_000, "transfer", 33],
      ["WELFARE", "WELFARE", "Mrs. Adaeze Nwosu", "Hospital bill support", 75_000, "transfer", 25],
      ["OUTREACH", "SEED", "Makoko outreach team", "Food packs for community outreach", 210_000, "transfer", 18],
      ["ADMIN", "OFFERING", "Jumia", "Printer toner and A4 paper", 32_500, "pos", 9],
      ["BUILD", "BUILDING", "Dangote Cement (via Bisola Ventures)", "600 bags of cement for the new sanctuary", 3_900_000, "transfer", 12],
    ];
    let ref = 4100;
    for (const [cat, fund, payee, desc, amount, method, ago] of spend) {
      const id = await saveExpense(
        tx,
        counter,
        expenseSchema.parse({
          branchId: hq!.id,
          categoryId: cats[cat],
          fundId: f[fund],
          payee,
          description: desc,
          amount: String(amount),
          spentOn: new Date(today.getTime() - ago * 86400000).toISOString().slice(0, 10),
          method,
        }),
      );
      const r = await submitExpense(tx, counter, id);
      if (r.status === "submitted") await approveExpense(tx, owner, id);
      await markExpensePaid(tx, counter, { id, method: method as "cash", paymentRef: method === "cash" ? null : `FT${++ref}` });
    }
    // waiting for the pastor's approval, and one approved but not yet paid
    const pending = await saveExpense(
      tx,
      counter,
      expenseSchema.parse({
        branchId: hq!.id,
        categoryId: cats.EQUIP,
        fundId: f.OFFERING,
        payee: "Sound Solutions Ltd",
        description: "Two Shure wireless microphones for the choir",
        amount: "480000",
        spentOn: today.toISOString().slice(0, 10),
        method: "transfer",
      }),
    );
    await submitExpense(tx, counter, pending);
    const approved = await saveExpense(
      tx,
      counter,
      expenseSchema.parse({
        branchId: hq!.id,
        categoryId: cats.MAINT,
        fundId: f.OFFERING,
        payee: "Bayo Plumbing Works",
        description: "Fix leaking pipes in the children's wing toilets",
        amount: "28500",
        spentOn: today.toISOString().slice(0, 10),
        method: "cash",
      }),
    );
    await submitExpense(tx, counter, approved);

    const assetsToAdd = [
      ["Mikano 60KVA soundproof generator", "generator", "2023-04-12", "18500000", "Generator house", "Sanctuary Keepers"],
      ["Yamaha TF5 digital mixer", "sound", "2024-01-20", "6200000", "Sound booth", "Media"],
      ["Toyota Hiace church bus", "vehicle", "2022-09-05", "24000000", "Church car park", "Transport unit"],
      ["Roland Fantom 8 keyboard", "instrument", "2024-06-15", "3100000", "Main auditorium", "Choir"],
      ["Land at Lekki Phase 2 (2 plots)", "land", "2021-03-01", "65000000", null, "Board of trustees"],
      ["Sony FX6 camera", "media", "2025-02-10", "9800000", "Media room", "Media"],
    ] as const;
    for (const [name, category, purchasedOn, cost, location, custodian] of assetsToAdd)
      await saveAsset(
        tx,
        counter,
        assetSchema.parse({
          branchId: hq!.id,
          name,
          category,
          purchasedOn,
          cost,
          usefulLifeMonths: DEFAULT_LIFE[category] ?? "",
          location: location ?? "",
          custodian,
          condition: "good",
        }),
      );

    // Lekki gave last month, so it owes headquarters its share
    const lekki = (await tx.select().from(branches)).find((b) => b.code === "LEK")!;
    const period = previousPeriod();
    for (const [i, amt] of [1_250_000_00, 640_000_00].entries())
      await tx.insert(givingTransactions).values({
        orgId,
        branchId: lekki.id,
        fundId: i ? f.OFFERING! : f.TITHE!,
        amountKobo: amt,
        channel: "transfer",
        source: "batch",
        status: "confirmed",
        givenOn: `${period}-1${i + 2}`,
        reference: `LEK-SEED-${i}`,
        confirmedAt: new Date(),
      });
    await calculateRemittances(tx, orgId, period);
  });
}

/** A few broadcasts already sent (with delivery reports), one scheduled, and birthday wishes switched on. */
async function seedMessaging(orgId: string, ownerId: string) {
  const owner = await actorFor(ownerId, orgId);
  const ids = await withOrg(orgId, async (tx) => {
    await tx.insert(smsLedger).values({
      orgId,
      units: 2000,
      kind: "topup",
      amountKobo: 2000 * 400,
      reference: "BMC-SEED-TOPUP",
      note: "Bought 2,000 units",
      createdBy: ownerId,
      createdByName: owner.user.name,
    });
    for (const key of ["birthday", "welcome"] as const)
      await saveAutomation(tx, owner, automationSchema.parse({ key, enabled: true, channel: "sms", body: AUTOMATIONS[key].body }));
    const a = await createCampaign(
      tx,
      owner,
      messageSchema.parse({
        channel: "sms",
        body: "Hi {first_name}, join us this Sunday at 8am for Thanksgiving Service. Come with family and friends! - {church}",
        audience: { kind: "stages", stages: ["member", "regular"] },
      }),
    );
    const b = await createCampaign(
      tx,
      owner,
      messageSchema.parse({
        channel: "email",
        subject: "October at {church}: Harvest, youth week and the new sanctuary",
        body: "Dear {first_name},\n\nThank you for a wonderful September. Here's what's coming up this month.\n\nHarvest Thanksgiving holds on the last Sunday of October. Youth Week runs from the 20th, with a concert on Friday night.\n\nWork on the new sanctuary continues: we've poured the foundation. Thank you for your pledges and gifts.\n\nGod bless you,\n{church}",
        audience: { kind: "everyone" },
      }),
    );
    const saturday = new Date();
    saturday.setUTCDate(saturday.getUTCDate() + ((6 - saturday.getUTCDay() + 7) % 7 || 7));
    saturday.setUTCHours(16, 0, 0, 0);
    await createCampaign(
      tx,
      owner,
      messageSchema.parse({
        channel: "sms",
        body: "Choir, rehearsal holds today at 4pm in the main auditorium. Please be punctual. - {church}",
        audience: { kind: "everyone", gender: "female" },
        scheduleAt: saturday.toISOString(),
      }),
    );
    return [a.id, b.id];
  });
  for (const id of ids) {
    await prepareCampaign(orgId, id);
    const queued = await withOrg(orgId, (tx) =>
      tx.select({ id: messages.id }).from(messages).where(and(eq(messages.campaignId, id), eq(messages.status, "queued"))),
    );
    await deliverMessages(orgId, queued.map((q) => q.id));
  }
  // the networks report most SMS delivered
  const sent = await withOrg(orgId, (tx) =>
    tx.select({ providerId: messages.providerId }).from(messages).where(and(eq(messages.channel, "sms"), eq(messages.status, "sent"))),
  );
  for (const [i, m] of sent.entries()) if (m.providerId) await applyDeliveryReport(m.providerId, i % 17 === 5 ? "failed" : "delivered", "Number switched off");
  await db.delete(jobs).where(inArray(jobs.type, ["messages.prepare", "messages.deliver"]));
  await withOrg(orgId, (tx) => tx.update(messageCampaigns).set({ status: "sent", finishedAt: new Date() }).where(inArray(messageCampaigns.id, ids)));
}

/** Last Sunday (completed), this Sunday (published, with people), and a midweek draft. */
async function seedSchedules(orgId: string, ownerId: string) {
  const owner = await actorFor(ownerId, orgId);
  const versionIds = await withOrg(orgId, async (tx) => {
    const [hq] = await tx.select().from(branches).orderBy(asc(branches.createdAt)).limit(1);
    const people = await tx
      .select({ id: members.id, first: members.firstName, last: members.lastName, title: members.title })
      .from(members)
      .where(and(isNull(members.deletedAt), eq(members.stage, "member")))
      .limit(14);
    const name = (i: number) => [people[i]!.title, people[i]!.first, people[i]!.last].filter(Boolean).join(" ");
    const templates = await listScheduleTemplates(tx);
    const sundayT = templates.find((t) => t.serviceType === "sunday")!;
    const today = new Date();
    const sunday = new Date(today.getTime() + (((7 - today.getUTCDay()) % 7) || 7) * 86400000).toISOString().slice(0, 10);
    const lastSunday = new Date(new Date(`${sunday}T12:00:00Z`).getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const ids: string[] = [];
    for (const [date, theme] of [
      [lastSunday, "Faithful in little things"],
      [sunday, "Thanksgiving that moves heaven"],
    ] as const) {
      const id = await startSchedule(tx, owner, { from: "template", templateId: sundayT.id, copyOf: null, serviceDate: date, branchId: hq!.id });
      const s = await getScheduleFull(tx, owner, id);
      const who: Record<string, [number, string | null][]> = {
        "Opening prayer": [[0, null]],
        "Praise and worship": [
          [1, "Worship leader"],
          [2, "Backup"],
        ],
        "Scripture reading": [[3, null]],
        "Announcements": [[4, null]],
        "Tithes and offering": [[5, "Exhortation"]],
        "Sermon": [[6, "Minister"]],
        "Altar call": [[6, null]],
        "Thanksgiving and first-timers": [[7, null]],
      };
      await saveSchedule(
        tx,
        owner,
        scheduleSchema.parse({
          id,
          branchId: hq!.id,
          title: date === sunday ? "Harvest Thanksgiving Service" : "Sunday Celebration Service",
          serviceType: "sunday",
          typeLabel: date === sunday ? "Harvest Thanksgiving" : null,
          serviceDate: date,
          startTime: "08:00",
          endTime: "10:30",
          venue: "Main auditorium",
          theme,
          scripture: date === sunday ? "Psalm 100:4" : "Luke 16:10",
          presidingName: "Pastor Tunde Adeyemi",
          announcements: "Ushers and workers: be seated by 7:30am for pre-service prayer. Choir robes: blue.",
          internalNotes: "Check the generator diesel on Saturday evening.",
          items: s.items.map((it) => ({
            title: it.title,
            durationMin: it.durationMin,
            description: it.title === "Sermon" ? "Keep to time: altar call by 9:55am." : it.description,
            custom: it.title === "Praise and worship" ? [{ label: "Songs", value: "Jesus Is Lord; Agbara Re; Way Maker" }] : [],
            assignees: (who[it.title] ?? []).map(([i, r]) => ({ memberId: people[i]!.id, name: name(i), responsibility: r })),
          })),
        }),
      );
      await publishSchedule(tx, owner, { id, notify: false, note: null });
      ids.push(id);
    }
    // a midweek draft still being planned
    await startSchedule(tx, owner, {
      from: "template",
      templateId: templates.find((t) => t.serviceType === "midweek")!.id,
      copyOf: null,
      serviceDate: new Date(new Date(`${sunday}T12:00:00Z`).getTime() + 3 * 86400000).toISOString().slice(0, 10),
      branchId: hq!.id,
    });
    await completePastSchedules(orgId);
    return tx
      .select({ id: scheduleVersions.id })
      .from(scheduleVersions)
      .where(inArray(scheduleVersions.scheduleId, ids));
  });
  await completePastSchedules(orgId);
  for (const v of versionIds) await generateVersionPdf(orgId, v.id, { final: true });
  await db.delete(jobs).where(inArray(jobs.type, ["schedule.pdf", "schedule.notify"]));
}

/** A church secretary, an approval route, and memos at different stages. */
async function seedMemos(orgId: string, ownerId: string) {
  const [adminRole] = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.orgId, orgId), eq(roles.key, "admin")));
  const [sec] = await db
    .insert(users)
    .values({ email: "secretary@graceassembly.ng", name: "Sis. Kemi Balogun", passwordHash: await hashPassword(DEMO.password) })
    .returning({ id: users.id });
  await db.insert(memberships).values({ orgId, userId: sec!.id, roleId: adminRole!.id, title: "Church Secretary" });
  const [fin] = await db.select({ id: users.id }).from(users).where(eq(users.email, "finance@graceassembly.ng"));
  const owner = await actorFor(ownerId, orgId);
  const secretary = await actorFor(sec!.id, orgId);
  const finance = await actorFor(fin!.id, orgId);
  await withOrg(orgId, async (tx) => {
    await saveMemoRoute(tx, owner, {
      prefix: "GAL",
      steps: [
        { label: "Church Secretary", roleKey: "admin", minAmount: 0 },
        { label: "Senior Pastor", roleKey: "owner", minAmount: 5_000_000 },
      ],
    });
    const [hq] = await tx.select().from(branches).orderBy(asc(branches.createdAt)).limit(1);
    const [welfare] = await tx.select().from(groups).where(eq(groups.name, "Ushering"));
    const [someone] = await tx.select({ id: members.id }).from(members).where(eq(members.stage, "member")).limit(1);
    const m1 = randomUUID();
    await saveMemo(tx, finance, memoSchema.parse({
      id: m1,
      branchId: hq!.id,
      category: "welfare",
      title: "Welfare support for a member after surgery",
      body: "Member in need: see the linked record.\n\nTheir situation: surgery at LUTH last week; the family has paid half of the bill.\n\nSupport requested: N150,000 towards the balance.\n\nHas the church helped them before? No.",
      amount: "150000",
      memberId: someone!.id,
      confidential: true,
    }));
    await submitMemo(tx, finance, m1);
    await approveMemo(tx, secretary, { id: m1, comment: "Confirmed with the hospital's billing office." });
    await approveMemo(tx, owner, { id: m1, comment: "Approved. Let the family know we're praying with them." });

    const m2 = randomUUID();
    await saveMemo(tx, secretary, memoSchema.parse({
      id: m2,
      branchId: hq!.id,
      category: "maintenance",
      title: "Repair: auditorium air conditioners before Harvest",
      body: "What needs fixing: two of the four 10HP units are blowing warm air.\n\nHow urgent: Harvest Thanksgiving is on Sunday and we expect 1,500 people.\n\nQuotes received:\n1. CoolTech Services: N320,000\n2. Arctic Air: N365,000\n3. Frosty Engineering: N410,000\n\nRecommended vendor: CoolTech, who serviced the units last quarter.",
      amount: "320000",
      departmentId: welfare?.id ?? null,
      urgent: true,
    }));
    await submitMemo(tx, secretary, m2);

    const m3 = randomUUID();
    await saveMemo(tx, finance, memoSchema.parse({
      id: m3,
      branchId: hq!.id,
      category: "guest",
      title: "Invitation of guest minister: Rev. Dr. Femi Aluko",
      body: "Name and ministry: Rev. Dr. Femi Aluko, Living Springs Ministries, Ibadan.\n\nProposed date: Youth Sunday, last Sunday of November.\n\nHonorarium and travel: to be agreed.",
    }));
    await submitMemo(tx, finance, m3);
    await queryMemo(tx, secretary, { id: m3, comment: "Please confirm the honorarium and whether he needs accommodation." });
  });
}

async function seedEvents(orgId: string, ownerId: string) {
  const owner = await actorFor(ownerId, orgId);
  await withOrg(orgId, async (tx) => {
    const [hq] = await tx.select().from(branches).orderBy(asc(branches.createdAt)).limit(1);
    const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const conf = await saveEvent(
      tx,
      owner,
      eventSchema.parse({
        branchId: hq!.id,
        title: "Youth Conference 2026: Unshaken",
        description: "Three days of worship, teaching and workshops for young people aged 13 to 35. Lunch is served each day.",
        startsAt: `${day(21)}T09:00`,
        endsAt: `${day(23)}T16:00`,
        venue: "Main auditorium",
        capacity: "400",
        tickets: [
          { name: "Free entry", price: "0", capacity: "" },
          { name: "Conference pack (T-shirt and notebook)", price: "5000", capacity: "150" },
        ],
      }),
    );
    await setEventStatus(tx, owner, conf, "published");
    const [free] = await tx.select().from(ticketTypes).where(eq(ticketTypes.eventId, conf)).orderBy(asc(ticketTypes.position)).limit(1);
    for (const [name, q] of [["Tobi Adewale", 1], ["Chiamaka Eze", 2], ["Ibrahim Musa", 1]] as const)
      await registerAtDesk(tx, owner, deskSchema.parse({ eventId: conf, ticketTypeId: free!.id, name, quantity: q, checkIn: false }));
    await saveEvent(
      tx,
      owner,
      eventSchema.parse({
        branchId: hq!.id,
        title: "Couples' Dinner",
        startsAt: `${day(40)}T18:00`,
        venue: "Church hall",
        tickets: [{ name: "Couple", price: "15000", capacity: "60" }],
      }),
    );

    const [ushers] = await tx.select().from(groups).where(eq(groups.name, "Ushering"));
    if (ushers) {
      await autoFill(tx, owner, fillSchema.parse({ groupId: ushers.id, dates: sundays(day(0), 4), positions: ["Main door", "Gallery", "Car park"], notify: false }));
      const slots = await tx.select({ id: rotaSlots.id }).from(rotaSlots).where(eq(rotaSlots.groupId, ushers.id)).orderBy(asc(rotaSlots.date)).limit(3);
      for (const s of slots.slice(0, 2)) await tx.update(rotaSlots).set({ status: "confirmed" }).where(eq(rotaSlots.id, s.id));
    }
  });
}

async function seedCare(orgId: string, ownerId: string) {
  const owner = await actorFor(ownerId, orgId);
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const { link, people, formId } = await withOrg(orgId, async (tx) => {
    const people = await tx
      .select({ id: members.id, first: members.firstName, last: members.lastName })
      .from(members)
      .where(and(isNull(members.deletedAt), eq(members.stage, "member")))
      .limit(8);
    const formId = await createForm(tx, owner, "workers");
    await setFormStatus(tx, owner, formId, "open");
    return { link: await prayerLink(tx, owner), people, formId };
  });
  const token = link.split("/p/")[1]!;
  const requests = [
    { name: "Ngozi Eze", phone: "08035550101", body: "Please pray for my husband's job interview at the bank on Thursday.", category: "career", wantsContact: false },
    { name: "", body: "Pray for peace in my home. My teenage son has stopped talking to us.", category: "family", wantsContact: false },
    { name: "Kola Bankole", phone: "08035550102", body: "My mother is in the ICU at LASUTH after a stroke. Please pray and visit if you can.", category: "healing", wantsContact: true },
    { name: "Esther", email: "esther.prayer@example.com", body: "Thank God with me: I passed my ICAN final exams!", category: "thanksgiving", wantsContact: false },
    { name: "", body: "A private matter about my health. I'd like to speak with a pastor.", category: "healing", confidential: true, wantsContact: true, email: "private.member@example.com" },
  ];
  for (const r of requests) await submitPublicPrayer(token, publicPrayerSchema.parse(r));

  await withOrg(orgId, async (tx) => {
    const { listPrayer } = await import("@/server/services/care");
    const list = await listPrayer(tx, owner, { status: "all" });
    const thanks = list.find((x) => x.category === "thanksgiving");
    if (thanks) await updatePrayer(tx, owner, { id: thanks.id, status: "answered", testimony: "Passed all papers at first sitting." });
    const job = list.find((x) => x.category === "career");
    if (job) {
      await markPrayed(tx, owner, job.id);
      await markPrayed(tx, owner, job.id);
    }
    await addPrayer(tx, owner, prayerSchema.parse({ memberId: people[2]!.id, body: "Journey mercies for the family travelling to Enugu for the burial.", category: "family" }));

    const hospital = await saveCase(
      tx,
      owner,
      caseSchema.parse({ memberId: people[0]!.id, kind: "hospital", title: "Admitted at LUTH after a road accident", priority: "urgent", assignedTo: ownerId, nextActionOn: day(0), nextAction: "Visit with the welfare team" }),
    );
    await addEntry(tx, owner, entrySchema.parse({ caseId: hospital, kind: "visit", body: "Visited with Deaconess Ade. Leg in a cast, in good spirits. Prayed with the family.", happenedOn: day(-2) }));
    await addEntry(tx, owner, entrySchema.parse({ caseId: hospital, kind: "welfare", welfareKind: "hospital_bill", amount: "120000", body: "Paid directly to the hospital account.", happenedOn: day(-1) }));
    const burial = await saveCase(
      tx,
      owner,
      caseSchema.parse({ memberId: people[2]!.id, kind: "bereavement", title: "Lost her father; burial in Enugu next month", priority: "high", nextActionOn: day(3), nextAction: "Condolence visit with the elders" }),
    );
    await addEntry(tx, owner, entrySchema.parse({ caseId: burial, kind: "call", body: "Called to condole. The family will hold a service of songs at the church.", happenedOn: day(-1) }));
    await addEntry(tx, owner, entrySchema.parse({ caseId: burial, kind: "welfare", welfareKind: "foodstuff", amount: "35000", body: "Rice, oil and provisions for the wake-keep.", happenedOn: day(0) }));
    await saveCase(tx, owner, caseSchema.parse({ memberId: people[4]!.id, kind: "new_baby", title: "Welcomed a baby girl", nextActionOn: day(5), nextAction: "Visit with a gift; book the dedication" }));
  });

  const f = await withOrg(orgId, (tx) => getForm(tx, owner, formId));
  const ftoken = f.publicUrl!.split("/f/")[1]!;
  const q = (t: string) => f.fields.find((x) => x.type === t)!.id;
  const depts = ["Media", "Choir", "Ushering", "Media", "Protocol", "Children's Church"];
  for (const [i, p] of people.slice(0, 6).entries())
    await submitForm(ftoken, { [q("short")]: `${p.first} ${p.last}`, [q("phone")]: `0807555${String(1000 + i)}`, [q("choice")]: depts[i], [q("yesno")]: i % 3 ? "Yes" : "No" });
}

/** One sign-in for each built-in role, so every view of the app can be tried, plus a member for the member page. */
export const TEST_ACCOUNTS = [
  { role: "pastor", email: "pastor@graceassembly.ng", name: "Rev. Dr. Femi Adeyemi", title: "Senior Pastor" },
  { role: "coordinator", email: "coordinator@graceassembly.ng", name: "Bro. Chidi Okafor", title: "Service Coordinator" },
  { role: "hod", email: "hod@graceassembly.ng", name: "Dcn. Musa Ibrahim", title: "Head of Ushering" },
  { role: "counter", email: "counter@graceassembly.ng", name: "Sis. Ngozi Eze", title: "Counting Team" },
  { role: "followup", email: "followup@graceassembly.ng", name: "Sis. Funke Bello", title: "Follow-up and Care" },
  { role: "children", email: "children@graceassembly.ng", name: "Sis. Amaka Obi", title: "Children's Church Coordinator" },
  { role: "worker", email: "worker@graceassembly.ng", name: "Bro. Tobi Lawal", title: "Usher" },
  { role: "counsellor", email: "counsellor@graceassembly.ng", name: "Dcn. & Dcns. Adeyinka", title: "Marriage Counsellor" },
] as const;
export const PORTAL_MEMBER_EMAIL = "member@graceassembly.ng";

/**
 * Demo data loaded by an older version is kept, but accounts and samples added since are filled in,
 * so pulling new code is enough to try new features.
 */
async function topUpDemo(ownerId: string) {
  const [m] = await db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, ownerId)).limit(1);
  if (!m) return;
  const before = await db.select({ email: users.email }).from(users).where(inArray(users.email, TEST_ACCOUNTS.map((a) => a.email)));
  await seedTestAccounts(m.orgId, { onlyMissing: true });
  const added = TEST_ACCOUNTS.filter((a) => !before.some((b) => b.email === a.email));
  if (added.some((a) => a.role === "counsellor")) await seedCounselling(m.orgId, ownerId);
  if (added.length) console.log(`Added demo accounts: ${added.map((a) => a.email).join(", ")} (password ${DEMO.password})`);
}

async function seedTestAccounts(orgId: string, opts: { onlyMissing?: boolean } = {}) {
  const pw = await hashPassword(DEMO.password);
  for (const a of TEST_ACCOUNTS) {
    const [role] = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.orgId, orgId), eq(roles.key, a.role)));
    if (!role) continue;
    if (opts.onlyMissing && (await db.select({ id: users.id }).from(users).where(eq(users.email, a.email))).length) continue;
    const [u] = await db.insert(users).values({ email: a.email, name: a.name, passwordHash: pw }).returning({ id: users.id });
    await db.insert(memberships).values({ orgId, userId: u!.id, roleId: role.id, title: a.title });
  }
  // a member who serves on the rota and gives, with a known email for the member page
  if (opts.onlyMissing) return;
  await withOrg(orgId, async (tx) => {
    const [slot] = await tx.select({ memberId: rotaSlotsT.memberId }).from(rotaSlotsT).where(sql`${rotaSlotsT.memberId} is not null`).limit(1);
    if (slot?.memberId)
      await tx.update(members).set({ emailEnc: encrypt(PORTAL_MEMBER_EMAIL), emailHash: blindIndex(PORTAL_MEMBER_EMAIL) }).where(eq(members.id, slot.memberId));
  });
}

async function seedCounselling(orgId: string, ownerId: string) {
  const owner = await actorFor(ownerId, orgId);
  const [cu] = await db.select({ id: users.id }).from(users).where(eq(users.email, "counsellor@graceassembly.ng"));
  if (!cu) return;
  const counsellor = await actorFor(cu.id, orgId);
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const local = (n: number, t: string) => `${new Date(Date.now() + n * 86400000 + 3600000).toISOString().slice(0, 10)}T${t}`;
  const link = await withOrg(orgId, async (tx) => {
    const people = await tx.select({ id: members.id }).from(members).where(and(isNull(members.deletedAt), eq(members.stage, "member"))).limit(12);
    // a couple in pre-marital counselling, three sessions in
    const id = await saveCounselCase(
      tx,
      owner,
      counselCaseSchema.parse({ kind: "premarital", aMemberId: people[5]!.id, bName: "Olumide Fashola", bPhone: "08061230011", bEmail: "olumide.f@example.com", weddingDate: day(75), weddingVenue: "Main auditorium", counsellorIds: [cu.id], reason: "Introduced by the youth pastor. Both keen; families have met.", plannedSessions: 8 }),
    );
    const topics = ["God's design for marriage", "Our backgrounds and expectations", "Communication"];
    for (const [i, topic] of topics.entries()) {
      const [s] = await tx.insert(counsellingSessions).values({ orgId, caseId: id, topic, startsAt: new Date(`${day(-(21 - i * 7))}T17:00:00+01:00`), location: "Pastor's office", counsellorId: cu.id, counsellorName: "Dcn. & Dcns. Adeyinka" }).returning({ id: counsellingSessions.id });
      await recordSession(tx, counsellor, recordSchema.parse({ id: s!.id, status: "held", attended: "both", notes: i === 1 ? "Different expectations about where to live after the wedding. Agreed to talk with both families." : "Engaged and open.", homework: i === 2 ? "Each write a letter about how you prefer to settle disagreements." : null }));
    }
    await scheduleSession(tx, counsellor, sessionSchema.parse({ caseId: id, topic: "Handling conflict", startsAt: local(4, "17:00"), location: "Pastor's office", notify: false }));
    for (const key of ["form", "genotype", "medical", "membership"]) await toggleChecklist(tx, counsellor, { id, key, done: true });

    // a married couple getting support
    await saveCounselCase(tx, owner, counselCaseSchema.parse({ kind: "marital", aMemberId: people[8]!.id, bMemberId: people[9]!.id, marriedSince: "2016-12-10", counsellorIds: [cu.id], reason: "Strain since the husband lost his job. Arguments about money.", plannedSessions: 6 }));

    // a couple who finished and were cleared
    const done = await saveCounselCase(tx, owner, counselCaseSchema.parse({ kind: "premarital", aMemberId: people[10]!.id, bName: "Ifeanyi Nwosu", weddingDate: day(20), counsellorIds: [cu.id], plannedSessions: 8 }));
    for (const [i, topic] of ["God's design for marriage", "Our backgrounds and expectations", "Communication", "Handling conflict", "Money and finances", "Family and in-laws", "Sex and intimacy", "The wedding and the first year"].entries())
      await tx.insert(counsellingSessions).values({ orgId, caseId: done, topic, startsAt: new Date(`${day(-(60 - i * 7))}T17:00:00+01:00`), location: "Pastor's office", counsellorId: cu.id, counsellorName: "Dcn. & Dcns. Adeyinka", status: "held", attended: "both" });
    for (const key of ["form", "genotype", "medical", "membership", "baptism", "parents", "registry", "booking"]) await toggleChecklist(tx, counsellor, { id: done, key, done: true });
    await completeCase(tx, owner, completeSchema.parse({ id: done, outcome: "cleared", summary: "Completed all eight sessions. Ready." }));
    return requestLink(tx, owner);
  });
  // and one new request from the online page
  await submitRequest(link.split("/mc/")[1]!, publicRequestSchema.parse({ kind: "premarital", aName: "Blessing Okon", aPhone: "08099887766", aEmail: "blessing.okon@example.com", bName: "Samuel Etim", weddingDate: day(120), reason: "We'd like to start counselling before we fix the date with our families." }));
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
