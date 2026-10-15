import type { Tx } from "./db";
import { auditLogs } from "./db/schema";

type AuditActor = { user: { id: string; name: string }; org: { id: string } } | { system: string; orgId: string };

export type AuditEntry = {
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

/** Writes an audit record in the same transaction as the change it describes. */
export async function audit(tx: Tx, actor: AuditActor, e: AuditEntry) {
  const sys = "system" in actor;
  await tx.insert(auditLogs).values({
    orgId: sys ? actor.orgId : actor.org.id,
    actorUserId: sys ? null : actor.user.id,
    actorName: sys ? actor.system : actor.user.name,
    action: e.action,
    entityType: e.entityType ?? null,
    entityId: e.entityId ?? null,
    summary: e.summary,
    before: (e.before ?? null) as never,
    after: (e.after ?? null) as never,
    ip: e.ip ?? null,
  });
}

/** Returns only the fields that changed — keeps audit records small and readable. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    const x = before[k],
      y = after[k];
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      b[k] = x;
      a[k] = y;
    }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}
