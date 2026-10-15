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
import { givingTransactions, members } from "@/server/db/schema";
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
import { and, asc, isNull } from "drizzle-orm";

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
  console.log(`Demo church created with 120 members.\nSign in with ${DEMO.email} / ${DEMO.password}`);
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

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
