import "dotenv/config";
import { eq } from "drizzle-orm";
import { signUp } from "@/server/services/accounts";
import { closeDb, db, withOrg } from "@/server/db";
import { branches, memberships, organisations, roles, users } from "@/server/db/schema";
import { makeActor } from "@/server/auth/context";
import type { Permission } from "@/server/auth/permissions";
import { saveBranch } from "@/server/services/org";
import { createMember, linkHousehold, setMemberTags } from "@/server/services/members";
import { addToGroup, saveGroup, setGroupRole } from "@/server/services/groups";

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

const FIRST_M = ["Tunde", "Emeka", "Ibrahim", "Chinedu", "Segun", "Musa", "Obinna", "Femi", "Kelechi", "Babajide", "Uche", "Yusuf", "Daniel", "Samuel", "David", "Tobi", "Ifeanyi", "Kunle", "Ahmed", "Victor"];
const FIRST_F = ["Ngozi", "Funke", "Aisha", "Chioma", "Bukola", "Amaka", "Zainab", "Grace", "Blessing", "Yetunde", "Adaeze", "Halima", "Esther", "Joy", "Temitope", "Ifeoma", "Kemi", "Nneka", "Ruth", "Deborah"];
const LAST = ["Adeyemi", "Okafor", "Bello", "Eze", "Ogunleye", "Ibrahim", "Nwosu", "Balogun", "Okeke", "Lawal", "Obi", "Adebayo", "Umeh", "Danjuma", "Akande", "Chukwu", "Afolabi", "Mohammed", "Onyekachi", "Oyelaran"];
const AREAS = ["Ikeja", "Yaba", "Surulere", "Lekki", "Ajah", "Gbagada", "Magodo", "Ikorodu", "Festac", "Victoria Island"];
const JOBS = ["Banker", "Engineer", "Teacher", "Trader", "Nurse", "Doctor", "Civil servant", "Student", "Lawyer", "Accountant", "Fashion designer", "Pharmacist"];

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;

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
    org: { id: row!.o.id, name: row!.o.name, slug: row!.o.slug, plan: row!.o.plan, smsSenderId: null, timezone: row!.o.timezone },
    membership: { id: row!.m.id, roleId: row!.r.id, roleKey: row!.r.key, roleName: row!.r.name, title: null, staffId: null, phone: null },
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
        saveGroup(tx, ctx, { kind: "department", name, branchId: hq!.id, meetingDay: "Saturday", meetingTime: "16:00" }),
      ),
    );
    const cells = await Promise.all(
      ["Ikeja GRA Cell", "Yaba Cell", "Lekki Phase 1 Cell", "Surulere Cell"].map((name, i) =>
        saveGroup(tx, ctx, { kind: "cell", name, branchId: hq!.id, meetingDay: "Wednesday", meetingTime: "18:30", area: AREAS[i] }),
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
      const stage = daysAgo < 30 ? pick(["first_timer", "first_timer", "second_timer", "visitor"] as const) : rand() < 0.75 ? "member" : "regular";
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
  });
  console.log(`Demo church created with 120 members.\nSign in with ${DEMO.email} / ${DEMO.password}`);
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
