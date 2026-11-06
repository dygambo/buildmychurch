import { and, asc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Tx } from "../db";
import { branches, careCases, careEntries, expenseCategories, expenses, followups, givingFunds, givingTransactions, members, services } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit } from "../audit";
import { buckets, change, type Period } from "@/lib/periods";
import { todayISO } from "@/lib/format";
import { assertBranch, branchScope } from "./scope";

export type Scope = Period & { branchId?: string | null };

const PALETTE = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
const DIGITAL = ["online", "transfer", "pos"] as const;

function where(ctx: Actor, s: Scope, col: PgColumn): SQL | undefined {
  if (s.branchId) {
    assertBranch(ctx, s.branchId);
    return eq(col, s.branchId);
  }
  return branchScope(ctx, col);
}
const bucketOf = (s: Scope, col: PgColumn | SQL) => sql<string>`to_char(date_trunc(${s.bucket}, ${col}), 'YYYY-MM-DD')`;
const n = (v: unknown) => Number(v ?? 0);

/** One Sunday's attendance: the usher headcount when there is one, otherwise the people who checked in. */
const serviceTotal = sql<number>`coalesce(nullif(coalesce(${services.men}, 0) + coalesce(${services.women}, 0) + coalesce(${services.children}, 0), 0), (select count(*) from attendance a where a.service_id = services.id))`;

/* ================= overview: the numbers a pastor asks for first ================= */

export async function overview(tx: Tx, ctx: Actor, s: Scope) {
  assertCan(ctx, "reports.read", "see reports");
  const people = await tx
    .select({
      total: sql<number>`count(*)::int`,
      members: sql<number>`count(*) filter (where ${members.stage} = 'member')::int`,
      joined: sql<number>`count(*) filter (where ${members.joinDate} between ${s.from} and ${s.to})::int`,
      joinedBefore: sql<number>`count(*) filter (where ${members.joinDate} between ${s.prevFrom} and ${s.prevTo})::int`,
    })
    .from(members)
    .where(and(isNull(members.deletedAt), eq(members.status, "active"), where(ctx, s, members.branchId)));
  const p = people[0]!;

  const ft = await firstTimerFunnel(tx, ctx, s);
  const ftPrev = await firstTimerFunnel(tx, ctx, { ...s, from: s.prevFrom, to: s.prevTo });

  // engagement: active members and regulars who belong to at least one department or cell
  const [eng] = await tx
    .select({
      base: sql<number>`count(*)::int`,
      engaged: sql<number>`count(*) filter (where exists (select 1 from group_members gm join groups g on g.id = gm.group_id where gm.member_id = members.id and g.kind in ('department','cell') and g.archived_at is null))::int`,
    })
    .from(members)
    .where(and(isNull(members.deletedAt), eq(members.status, "active"), inArray(members.stage, ["member", "regular"]), where(ctx, s, members.branchId)));

  const att = async (from: string, to: string) => {
    const rows = await tx
      .select({ date: services.date, total: sql<number>`sum(${serviceTotal})::int` })
      .from(services)
      .where(and(eq(services.kind, "sunday"), gte(services.date, from), lte(services.date, to), where(ctx, s, services.branchId)))
      .groupBy(services.date);
    const counted = rows.filter((r) => n(r.total) > 0);
    return counted.length ? Math.round(counted.reduce((t, r) => t + n(r.total), 0) / counted.length) : 0;
  };
  const avgAttendance = await att(s.from, s.to);
  const avgAttendancePrev = await att(s.prevFrom, s.prevTo);

  let giving: { total: number; prev: number; digitalShare: number | null } | null = null;
  if (ctx.can("giving.read")) {
    const g = async (from: string, to: string) => {
      const [r] = await tx
        .select({
          total: sql<number>`coalesce(sum(${givingTransactions.amountKobo}), 0)::bigint`,
          digital: sql<number>`coalesce(sum(${givingTransactions.amountKobo}) filter (where ${inArray(givingTransactions.channel, [...DIGITAL])}), 0)::bigint`,
        })
        .from(givingTransactions)
        .where(and(eq(givingTransactions.status, "confirmed"), gte(givingTransactions.givenOn, from), lte(givingTransactions.givenOn, to), where(ctx, s, givingTransactions.branchId)));
      return { total: n(r?.total), digital: n(r?.digital) };
    };
    const now = await g(s.from, s.to);
    const before = await g(s.prevFrom, s.prevTo);
    giving = { total: now.total, prev: before.total, digitalShare: now.total > 0 ? Math.round((now.digital / now.total) * 100) : null };
  }
  let spending: { total: number; prev: number } | null = null;
  if (ctx.can("finance.expenses")) {
    const e = async (from: string, to: string) => {
      const [r] = await tx
        .select({ total: sql<number>`coalesce(sum(${expenses.amountKobo}), 0)::bigint` })
        .from(expenses)
        .where(and(eq(expenses.status, "paid"), gte(expenses.spentOn, from), lte(expenses.spentOn, to), where(ctx, s, expenses.branchId)));
      return n(r?.total);
    };
    spending = { total: await e(s.from, s.to), prev: await e(s.prevFrom, s.prevTo) };
  }
  return {
    people: p.total,
    members: p.members,
    joined: p.joined,
    joinedChange: change(p.joined, p.joinedBefore),
    firstTimers: ft.firstTimers,
    firstTimersChange: change(ft.firstTimers, ftPrev.firstTimers),
    returnRate: ft.firstTimers ? Math.round((ft.cameBack / ft.firstTimers) * 100) : null,
    retentionRate: ft.firstTimers ? Math.round((ft.stayed / ft.firstTimers) * 100) : null,
    engagement: eng && n(eng.base) ? Math.round((n(eng.engaged) / n(eng.base)) * 100) : null,
    avgAttendance,
    attendanceChange: change(avgAttendance, avgAttendancePrev),
    giving,
    spending,
  };
}

/**
 * First-timers who came in the period, and what became of them within three months:
 * came back (attended again or moved past first-timer) and stayed (now a regular or member).
 */
export async function firstTimerFunnel(tx: Tx, ctx: Actor, s: Pick<Scope, "from" | "to" | "branchId">) {
  const [r] = await tx
    .select({
      firstTimers: sql<number>`count(distinct ${followups.memberId})::int`,
      cameBack: sql<number>`count(distinct ${followups.memberId}) filter (where ${members.stage} in ('second_timer','regular','member') or (select count(*) from attendance a join services sv on sv.id = a.service_id where a.member_id = ${followups.memberId} and sv.date > (${followups.createdAt} at time zone 'Africa/Lagos')::date and sv.date <= (${followups.createdAt} at time zone 'Africa/Lagos')::date + 90) > 0)::int`,
      stayed: sql<number>`count(distinct ${followups.memberId}) filter (where ${members.stage} in ('regular','member'))::int`,
      integrated: sql<number>`count(distinct ${followups.memberId}) filter (where ${followups.stage} = 'integrated')::int`,
    })
    .from(followups)
    .innerJoin(members, eq(members.id, followups.memberId))
    .where(
      and(
        eq(followups.reason, "first_timer"),
        sql`(${followups.createdAt} at time zone 'Africa/Lagos')::date between ${s.from} and ${s.to}`,
        isNull(members.deletedAt),
        s.branchId ? eq(members.branchId, s.branchId) : branchScope(ctx, members.branchId),
      ),
    );
  return { firstTimers: n(r?.firstTimers), cameBack: n(r?.cameBack), stayed: n(r?.stayed), integrated: n(r?.integrated) };
}

/* ================= membership growth ================= */

export async function growth(tx: Tx, ctx: Actor, s: Scope) {
  assertCan(ctx, "reports.read", "see reports");
  const joined = await tx
    .select({ b: bucketOf(s, members.joinDate), n: sql<number>`count(*)::int` })
    .from(members)
    .where(and(isNull(members.deletedAt), gte(members.joinDate, s.from), lte(members.joinDate, s.to), where(ctx, s, members.branchId)))
    .groupBy(sql`1`);
  const firsts = await tx
    .select({ b: bucketOf(s, sql`(${followups.createdAt} at time zone 'Africa/Lagos')::date`), n: sql<number>`count(*)::int` })
    .from(followups)
    .innerJoin(members, eq(members.id, followups.memberId))
    .where(
      and(
        eq(followups.reason, "first_timer"),
        sql`(${followups.createdAt} at time zone 'Africa/Lagos')::date between ${s.from} and ${s.to}`,
        where(ctx, s, members.branchId),
      ),
    )
    .groupBy(sql`1`);
  const series = buckets(s).map((b) => ({
    label: b.label,
    joined: n(joined.find((x) => x.b === b.key)?.n),
    firstTimers: n(firsts.find((x) => x.b === b.key)?.n),
  }));
  const base = and(isNull(members.deletedAt), eq(members.status, "active"), where(ctx, s, members.branchId));
  const stages = await tx.select({ k: members.stage, n: sql<number>`count(*)::int` }).from(members).where(base).groupBy(members.stage);
  const genders = await tx.select({ k: members.gender, n: sql<number>`count(*)::int` }).from(members).where(base).groupBy(members.gender);
  const year = Number(todayISO().slice(0, 4));
  const ages = await tx
    .select({
      k: sql<string>`case when ${members.dobYear} is null then 'Unknown' when ${year} - ${members.dobYear} < 13 then 'Under 13' when ${year} - ${members.dobYear} < 20 then '13–19' when ${year} - ${members.dobYear} < 30 then '20–29' when ${year} - ${members.dobYear} < 40 then '30–39' when ${year} - ${members.dobYear} < 50 then '40–49' when ${year} - ${members.dobYear} < 60 then '50–59' else '60+' end`,
      n: sql<number>`count(*)::int`,
    })
    .from(members)
    .where(base)
    .groupBy(sql`1`);
  const areas = await tx
    .select({ k: members.area, n: sql<number>`count(*)::int` })
    .from(members)
    .where(and(base, sql`${members.area} is not null and ${members.area} <> ''`))
    .groupBy(members.area)
    .orderBy(sql`2 desc`)
    .limit(8);
  const funnel = await firstTimerFunnel(tx, ctx, s);
  const AGE_ORDER = ["Under 13", "13–19", "20–29", "30–39", "40–49", "50–59", "60+", "Unknown"];
  const STAGE_LABEL: Record<string, string> = { visitor: "Visitors", first_timer: "First timers", second_timer: "Second timers", regular: "Regulars", member: "Members" };
  return {
    series,
    stages: (["member", "regular", "second_timer", "first_timer", "visitor"] as const).map((k, i) => ({ label: STAGE_LABEL[k]!, value: n(stages.find((x) => x.k === k)?.n), color: PALETTE[i]! })),
    genders: [
      { label: "Women", value: n(genders.find((x) => x.k === "female")?.n), color: "var(--c2)" },
      { label: "Men", value: n(genders.find((x) => x.k === "male")?.n), color: "var(--c1)" },
    ],
    ages: AGE_ORDER.map((k) => ({ label: k, value: n(ages.find((x) => x.k === k)?.n) })),
    areas: areas.map((a) => ({ label: a.k!, value: n(a.n) })),
    funnel,
  };
}

/* ================= attendance ================= */

export async function attendanceReport(tx: Tx, ctx: Actor, s: Scope) {
  assertCan(ctx, "reports.read", "see reports");
  const rows = await tx
    .select({
      date: services.date,
      kind: services.kind,
      name: services.name,
      men: services.men,
      women: services.women,
      children: services.children,
      online: services.online,
      firsts: services.firstTimersCount,
      total: serviceTotal,
      checkedIn: sql<number>`(select count(*) from attendance a where a.service_id = services.id)::int`,
      branch: branches.name,
    })
    .from(services)
    .innerJoin(branches, eq(branches.id, services.branchId))
    .where(and(gte(services.date, s.from), lte(services.date, s.to), where(ctx, s, services.branchId)))
    .orderBy(asc(services.date));
  const sundays = new Map<string, { total: number; online: number }>();
  for (const r of rows.filter((r) => r.kind === "sunday")) {
    const x = sundays.get(r.date) ?? { total: 0, online: 0 };
    x.total += n(r.total);
    x.online += n(r.online);
    sundays.set(r.date, x);
  }
  const bs = buckets(s);
  const keyFor = (d: string) => {
    let k = bs[0]?.key ?? d;
    for (const b of bs) if (b.key <= d) k = b.key;
    return k;
  };
  const series = bs.map((b) => {
    const inB = [...sundays.entries()].filter(([d, v]) => keyFor(d) === b.key && v.total > 0);
    return {
      label: b.label,
      inPerson: inB.length ? Math.round(inB.reduce((t, [, v]) => t + v.total, 0) / inB.length) : 0,
      online: inB.length ? Math.round(inB.reduce((t, [, v]) => t + v.online, 0) / inB.length) : 0,
    };
  });
  const byKind = new Map<string, { services: number; total: number }>();
  for (const r of rows) {
    if (!n(r.total)) continue;
    const x = byKind.get(r.kind) ?? { services: 0, total: 0 };
    x.services++;
    x.total += n(r.total);
    byKind.set(r.kind, x);
  }
  const split = rows.reduce((t, r) => ({ men: t.men + n(r.men), women: t.women + n(r.women), children: t.children + n(r.children) }), { men: 0, women: 0, children: 0 });
  const counted = [...sundays.entries()].filter(([, v]) => v.total > 0).sort((a, b) => b[1].total - a[1].total);
  return {
    series,
    byKind: [...byKind.entries()].map(([kind, v]) => ({ kind, services: v.services, average: Math.round(v.total / v.services) })).sort((a, b) => b.average - a.average),
    split: [
      { label: "Men", value: split.men, color: "var(--c1)" },
      { label: "Women", value: split.women, color: "var(--c2)" },
      { label: "Children", value: split.children, color: "var(--c3)" },
    ],
    best: counted[0] ? { date: counted[0][0], total: counted[0][1].total } : null,
    lowest: counted.length > 1 ? { date: counted.at(-1)![0], total: counted.at(-1)![1].total } : null,
    services: rows.map((r) => ({ ...r, total: n(r.total), checkedIn: n(r.checkedIn) })),
  };
}

/* ================= giving ================= */

export async function givingReport(tx: Tx, ctx: Actor, s: Scope) {
  assertCan(ctx, "giving.read", "see giving reports");
  const base = and(eq(givingTransactions.status, "confirmed"), gte(givingTransactions.givenOn, s.from), lte(givingTransactions.givenOn, s.to), where(ctx, s, givingTransactions.branchId));
  const byFund = await tx
    .select({ id: givingFunds.id, name: givingFunds.name, total: sql<number>`sum(${givingTransactions.amountKobo})::bigint` })
    .from(givingTransactions)
    .innerJoin(givingFunds, eq(givingFunds.id, givingTransactions.fundId))
    .where(base)
    .groupBy(givingFunds.id, givingFunds.name)
    .orderBy(sql`3 desc`);
  const prevFund = await tx
    .select({ id: givingTransactions.fundId, total: sql<number>`sum(${givingTransactions.amountKobo})::bigint` })
    .from(givingTransactions)
    .where(and(eq(givingTransactions.status, "confirmed"), gte(givingTransactions.givenOn, s.prevFrom), lte(givingTransactions.givenOn, s.prevTo), where(ctx, s, givingTransactions.branchId)))
    .groupBy(givingTransactions.fundId);
  const top = byFund.slice(0, 5);
  const series = await tx
    .select({ b: bucketOf(s, givingTransactions.givenOn), fund: givingTransactions.fundId, total: sql<number>`sum(${givingTransactions.amountKobo})::bigint` })
    .from(givingTransactions)
    .where(base)
    .groupBy(sql`1`, givingTransactions.fundId);
  const chart = buckets(s).map((b) => {
    const row: Record<string, number | string> = { label: b.label };
    let other = 0;
    for (const x of series.filter((x) => x.b === b.key)) {
      if (top.some((t) => t.id === x.fund)) row[x.fund] = n(row[x.fund]) + n(x.total) / 100;
      else other += n(x.total) / 100;
    }
    if (byFund.length > 5) row.other = other;
    return row;
  });
  const channels = await tx
    .select({ k: givingTransactions.channel, total: sql<number>`sum(${givingTransactions.amountKobo})::bigint` })
    .from(givingTransactions)
    .where(base)
    .groupBy(givingTransactions.channel);
  const [givers] = await tx
    .select({
      named: sql<number>`count(distinct ${givingTransactions.memberId})::int`,
      gifts: sql<number>`count(*) filter (where ${givingTransactions.amountKobo} > 0)::int`,
      online: sql<number>`count(*) filter (where ${givingTransactions.channel} = 'online' and ${givingTransactions.amountKobo} > 0)::int`,
      fees: sql<number>`coalesce(sum(${givingTransactions.feeKobo}), 0)::bigint`,
    })
    .from(givingTransactions)
    .where(base);
  const total = byFund.reduce((t, f) => t + n(f.total), 0);
  const CH: Record<string, string> = { cash: "Cash", pos: "POS", transfer: "Bank transfer", cheque: "Cheque", online: "Online", other: "Other" };
  return {
    total,
    funds: byFund.map((f) => {
      const before = n(prevFund.find((x) => x.id === f.id)?.total);
      return { name: f.name, total: n(f.total), share: total ? Math.round((n(f.total) / total) * 100) : 0, prev: before, change: change(n(f.total), before) };
    }),
    chart,
    series: [...top.map((f, i) => ({ key: f.id, name: f.name, color: PALETTE[i]! })), ...(byFund.length > 5 ? [{ key: "other", name: "Other funds", color: "var(--faint)" }] : [])],
    channels: channels
      .filter((c) => n(c.total) > 0)
      .sort((a, b) => n(b.total) - n(a.total))
      .map((c, i) => ({ label: CH[c.k] ?? c.k, value: Math.round(n(c.total) / 100), color: PALETTE[i % PALETTE.length]! })),
    namedGivers: n(givers?.named),
    gifts: n(givers?.gifts),
    onlineGifts: n(givers?.online),
    feesKobo: n(givers?.fees),
  };
}

/* ================= finance: money in and out ================= */

export async function financeReport(tx: Tx, ctx: Actor, s: Scope) {
  assertCan(ctx, "finance.expenses", "see finance reports");
  const income = await tx
    .select({ b: bucketOf(s, givingTransactions.givenOn), total: sql<number>`sum(${givingTransactions.amountKobo})::bigint` })
    .from(givingTransactions)
    .where(and(eq(givingTransactions.status, "confirmed"), gte(givingTransactions.givenOn, s.from), lte(givingTransactions.givenOn, s.to), where(ctx, s, givingTransactions.branchId)))
    .groupBy(sql`1`);
  const paid = and(eq(expenses.status, "paid"), gte(expenses.spentOn, s.from), lte(expenses.spentOn, s.to), where(ctx, s, expenses.branchId));
  const spent = await tx
    .select({ b: bucketOf(s, expenses.spentOn), total: sql<number>`sum(${expenses.amountKobo})::bigint` })
    .from(expenses)
    .where(paid)
    .groupBy(sql`1`);
  const chart = buckets(s).map((b) => ({
    label: b.label,
    income: n(income.find((x) => x.b === b.key)?.total) / 100,
    spending: n(spent.find((x) => x.b === b.key)?.total) / 100,
  }));
  const cats = await tx
    .select({ name: expenseCategories.name, total: sql<number>`sum(${expenses.amountKobo})::bigint`, count: sql<number>`count(*)::int` })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(paid)
    .groupBy(expenseCategories.name)
    .orderBy(sql`2 desc`);
  const totalIn = income.reduce((t, x) => t + n(x.total), 0);
  const totalOut = cats.reduce((t, x) => t + n(x.total), 0);
  let welfare = 0;
  if (ctx.can("care.manage")) {
    const [w] = await tx
      .select({ t: sql<number>`coalesce(sum(${careEntries.amountKobo}), 0)::bigint` })
      .from(careEntries)
      .innerJoin(careCases, eq(careCases.id, careEntries.caseId))
      .where(and(eq(careEntries.kind, "welfare"), gte(careEntries.happenedOn, s.from), lte(careEntries.happenedOn, s.to), where(ctx, s, careCases.branchId)));
    welfare = n(w?.t);
  }
  return {
    chart,
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    categories: cats.map((c) => ({ name: c.name, total: n(c.total), count: n(c.count), share: totalOut ? Math.round((n(c.total) / totalOut) * 100) : 0 })),
    welfare,
  };
}

/* ================= branches side by side ================= */

export async function branchComparison(tx: Tx, ctx: Actor, s: Scope) {
  assertCan(ctx, "reports.read", "see reports");
  const list = await tx
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(and(isNull(branches.archivedAt), branchScope(ctx, branches.id)))
    .orderBy(asc(branches.name));
  const out = [];
  for (const b of list) {
    const scoped = { ...s, branchId: b.id };
    const o = await overview(tx, ctx, scoped);
    out.push({
      id: b.id,
      name: b.name,
      members: o.members,
      people: o.people,
      joined: o.joined,
      firstTimers: o.firstTimers,
      retentionRate: o.retentionRate,
      engagement: o.engagement,
      avgAttendance: o.avgAttendance,
      giving: o.giving?.total ?? null,
      spending: o.spending?.total ?? null,
    });
  }
  return out;
}

/* ================= export ================= */

const naira = (k: number) => Math.round(k) / 100;

/** Sheets for the Excel download, one per section the user can see. */
export async function reportWorkbook(tx: Tx, ctx: Actor, s: Scope) {
  const sheets: { name: string; rows: Record<string, string | number | null>[] }[] = [];
  const o = await overview(tx, ctx, s);
  sheets.push({
    name: "Summary",
    rows: [
      { Measure: "Period", Value: `${s.from} to ${s.to}` },
      { Measure: "People on record", Value: o.people },
      { Measure: "Members", Value: o.members },
      { Measure: "New people", Value: o.joined },
      { Measure: "First timers", Value: o.firstTimers },
      { Measure: "First timers who came back (%)", Value: o.returnRate },
      { Measure: "First timers now regulars or members (%)", Value: o.retentionRate },
      { Measure: "Members in a department or cell (%)", Value: o.engagement },
      { Measure: "Average Sunday attendance", Value: o.avgAttendance },
      ...(o.giving
        ? [
            { Measure: "Giving (₦)", Value: naira(o.giving.total) },
            { Measure: "Given digitally (%)", Value: o.giving.digitalShare },
          ]
        : []),
      ...(o.spending ? [{ Measure: "Spending (₦)", Value: naira(o.spending.total) }] : []),
    ],
  });
  const g = await growth(tx, ctx, s);
  sheets.push({ name: "Growth", rows: g.series.map((r) => ({ Period: r.label, "New people": r.joined, "First timers": r.firstTimers })) });
  const a = await attendanceReport(tx, ctx, s);
  sheets.push({
    name: "Attendance",
    rows: a.services.map((r) => ({ Date: r.date, Service: r.name, Branch: r.branch, Men: r.men, Women: r.women, Children: r.children, Online: r.online, Total: r.total, "Checked in": r.checkedIn, "First timers": r.firsts })),
  });
  if (ctx.can("giving.read")) {
    const gv = await givingReport(tx, ctx, s);
    sheets.push({ name: "Giving by fund", rows: gv.funds.map((f) => ({ Fund: f.name, "Total (₦)": naira(f.total), "Share (%)": f.share, "Previous period (₦)": naira(f.prev), "Change (%)": f.change })) });
  }
  if (ctx.can("finance.expenses")) {
    const f = await financeReport(tx, ctx, s);
    sheets.push({ name: "Income and spending", rows: f.chart.map((r) => ({ Period: r.label, "Income (₦)": r.income, "Spending (₦)": r.spending, "Net (₦)": Math.round((r.income - r.spending) * 100) / 100 })) });
    sheets.push({ name: "Spending by category", rows: f.categories.map((c) => ({ Category: c.name, "Total (₦)": naira(c.total), Payments: c.count, "Share (%)": c.share })) });
  }
  if (!s.branchId) {
    const b = await branchComparison(tx, ctx, s);
    if (b.length > 1)
      sheets.push({
        name: "Branches",
        rows: b.map((x) => ({
          Branch: x.name,
          Members: x.members,
          "New people": x.joined,
          "First timers": x.firstTimers,
          "Retention (%)": x.retentionRate,
          "In a group (%)": x.engagement,
          "Avg Sunday attendance": x.avgAttendance,
          ...(x.giving !== null ? { "Giving (₦)": naira(x.giving) } : {}),
          ...(x.spending !== null ? { "Spending (₦)": naira(x.spending) } : {}),
        })),
      });
  }
  await audit(tx, ctx, { action: "report.exported", summary: `Exported the church report for ${s.from} to ${s.to}`, entityType: "report" });
  return sheets;
}


