import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "../db";
import { branches, groupMembers, groups, members } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit } from "../audit";
import { AppError, notFound } from "../errors";
import { assertBranch, branchScope } from "./scope";

export const GROUP_KINDS = { department: "Department", cell: "Home cell", ministry: "Ministry" } as const;
export type GroupKind = keyof typeof GROUP_KINDS;

export async function listGroups(tx: Tx, ctx: Actor, opts: { kind?: GroupKind; includeArchived?: boolean } = {}) {
  const leader = sql<
    string | null
  >`(select ${members.firstName} || ' ' || ${members.lastName} from ${members} where ${members.id} = ${groups.leaderMemberId})`;
  return tx
    .select({
      id: groups.id,
      name: groups.name,
      kind: groups.kind,
      description: groups.description,
      branchId: groups.branchId,
      branchName: branches.name,
      leaderMemberId: groups.leaderMemberId,
      leaderName: leader,
      meetingDay: groups.meetingDay,
      meetingTime: groups.meetingTime,
      location: groups.location,
      area: groups.area,
      archived: sql<boolean>`${groups.archivedAt} is not null`,
      size: sql<number>`(select count(*)::int from ${groupMembers} gm join ${members} m on m.id = gm.member_id and m.deleted_at is null where gm.group_id = ${groups.id})`,
    })
    .from(groups)
    .innerJoin(branches, eq(branches.id, groups.branchId))
    .where(
      and(
        opts.kind ? eq(groups.kind, opts.kind) : undefined,
        opts.includeArchived ? undefined : isNull(groups.archivedAt),
        branchScope(ctx, groups.branchId),
      ),
    )
    .orderBy(asc(groups.kind), asc(groups.name));
}

export async function getGroup(tx: Tx, ctx: Actor, id: string) {
  const [g] = (await listGroups(tx, ctx, { includeArchived: true })).filter((x) => x.id === id);
  if (!g) throw notFound("That group");
  const people = await tx
    .select({
      id: members.id,
      title: members.title,
      firstName: members.firstName,
      lastName: members.lastName,
      memberNo: members.memberNo,
      role: groupMembers.role,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groupMembers)
    .innerJoin(members, and(eq(members.id, groupMembers.memberId), isNull(members.deletedAt)))
    .where(eq(groupMembers.groupId, id))
    .orderBy(
      sql`case ${groupMembers.role} when 'leader' then 0 when 'assistant' then 1 else 2 end`,
      asc(members.firstName),
    );
  return { ...g, people };
}

export async function saveGroup(
  tx: Tx,
  ctx: Actor,
  input: {
    id?: string;
    kind: GroupKind;
    name: string;
    branchId: string;
    description?: string | null;
    meetingDay?: string | null;
    meetingTime?: string | null;
    location?: string | null;
    area?: string | null;
  },
) {
  assertCan(ctx, "groups.manage", "manage groups");
  assertBranch(ctx, input.branchId);
  const values = {
    kind: input.kind,
    name: input.name.trim(),
    branchId: input.branchId,
    description: input.description || null,
    meetingDay: input.meetingDay || null,
    meetingTime: input.meetingTime || null,
    location: input.location || null,
    area: input.area || null,
  };
  const [clash] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(
        eq(groups.branchId, values.branchId),
        eq(groups.kind, values.kind),
        sql`lower(${groups.name}) = lower(${values.name})`,
      ),
    );
  if (clash && clash.id !== input.id)
    throw new AppError(
      `There is already a ${GROUP_KINDS[values.kind].toLowerCase()} called ${values.name} in that branch.`,
      {
        name: "Already used in this branch.",
      },
    );
  if (input.id) {
    const [before] = await tx.select().from(groups).where(eq(groups.id, input.id));
    if (!before) throw notFound("That group");
    assertBranch(ctx, before.branchId);
    await tx.update(groups).set(values).where(eq(groups.id, input.id));
    await audit(tx, ctx, {
      action: "group.updated",
      summary: `Updated ${GROUP_KINDS[values.kind].toLowerCase()} ${values.name}`,
      entityType: "group",
      entityId: input.id,
    });
    return input.id;
  }
  const [g] = await tx
    .insert(groups)
    .values({ ...values, orgId: ctx.org.id })
    .returning({ id: groups.id });
  await audit(tx, ctx, {
    action: "group.created",
    summary: `Added ${GROUP_KINDS[values.kind].toLowerCase()} ${values.name}`,
    entityType: "group",
    entityId: g!.id,
  });
  return g!.id;
}

export async function archiveGroup(tx: Tx, ctx: Actor, id: string, archived: boolean) {
  assertCan(ctx, "groups.manage", "manage groups");
  const [g] = await tx.select().from(groups).where(eq(groups.id, id));
  if (!g) throw notFound("That group");
  assertBranch(ctx, g.branchId);
  await tx
    .update(groups)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(groups.id, id));
  await audit(tx, ctx, {
    action: archived ? "group.archived" : "group.restored",
    summary: `${archived ? "Archived" : "Restored"} ${g.name}`,
    entityType: "group",
    entityId: id,
  });
}

export async function addToGroup(
  tx: Tx,
  ctx: Actor,
  groupId: string,
  memberIds: string[],
  role: "leader" | "assistant" | "member" = "member",
) {
  assertCan(ctx, "groups.manage", "manage groups");
  const [g] = await tx.select().from(groups).where(eq(groups.id, groupId));
  if (!g) throw notFound("That group");
  assertBranch(ctx, g.branchId);
  if (!memberIds.length) return 0;
  const rows = await tx
    .insert(groupMembers)
    .values(memberIds.map((memberId) => ({ orgId: ctx.org.id, groupId, memberId, role })))
    .onConflictDoNothing()
    .returning({ memberId: groupMembers.memberId });
  if (role === "leader") await setGroupRole(tx, ctx, groupId, memberIds[0]!, "leader", true);
  if (rows.length)
    await audit(tx, ctx, {
      action: "group.members_added",
      summary: `Added ${rows.length} ${rows.length === 1 ? "person" : "people"} to ${g.name}`,
      entityType: "group",
      entityId: groupId,
      after: { memberIds: rows.map((r) => r.memberId) },
    });
  return rows.length;
}

export async function removeFromGroup(tx: Tx, ctx: Actor, groupId: string, memberId: string) {
  assertCan(ctx, "groups.manage", "manage groups");
  const [g] = await tx.select().from(groups).where(eq(groups.id, groupId));
  if (!g) throw notFound("That group");
  assertBranch(ctx, g.branchId);
  const [m] = await tx.select().from(members).where(eq(members.id, memberId));
  await tx.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.memberId, memberId)));
  if (g.leaderMemberId === memberId)
    await tx.update(groups).set({ leaderMemberId: null }).where(eq(groups.id, groupId));
  await audit(tx, ctx, {
    action: "group.member_removed",
    summary: `Removed ${m ? `${m.firstName} ${m.lastName}` : "a member"} from ${g.name}`,
    entityType: "group",
    entityId: groupId,
  });
}

/** One leader per group: making someone leader demotes the previous leader to member. */
export async function setGroupRole(
  tx: Tx,
  ctx: Actor,
  groupId: string,
  memberId: string,
  role: "leader" | "assistant" | "member",
  quiet = false,
) {
  assertCan(ctx, "groups.manage", "manage groups");
  const [g] = await tx.select().from(groups).where(eq(groups.id, groupId));
  if (!g) throw notFound("That group");
  if (role === "leader") {
    await tx
      .update(groupMembers)
      .set({ role: "member" })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, "leader")));
    await tx.update(groups).set({ leaderMemberId: memberId }).where(eq(groups.id, groupId));
  } else if (g.leaderMemberId === memberId) {
    await tx.update(groups).set({ leaderMemberId: null }).where(eq(groups.id, groupId));
  }
  await tx
    .update(groupMembers)
    .set({ role })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.memberId, memberId)));
  if (!quiet) {
    const [m] = await tx.select().from(members).where(eq(members.id, memberId));
    await audit(tx, ctx, {
      action: "group.role_changed",
      summary: `${m?.firstName} ${m?.lastName} is now ${role} of ${g.name}`,
      entityType: "group",
      entityId: groupId,
    });
  }
}

export async function groupCounts(tx: Tx, ctx: Actor) {
  return tx
    .select({ kind: groups.kind, n: count() })
    .from(groups)
    .where(and(isNull(groups.archivedAt), branchScope(ctx, groups.branchId)))
    .groupBy(groups.kind);
}
