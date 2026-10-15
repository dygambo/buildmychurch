import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, withOrg } from "@/server/db";
import { auditLogs, branches } from "@/server/db/schema";
import { saveBranch } from "@/server/services/org";
import { expectDbError, newChurch, resetDb } from "../helpers";

beforeEach(resetDb);

describe("row-level security", () => {
  it("each church only sees its own rows", async () => {
    const a = await newChurch("Church A");
    const b = await newChurch("Church B");
    await withOrg(a.orgId, (tx) => saveBranch(tx, a.ctx, { name: "Wuse", code: "WUSE" }));
    const aRows = await withOrg(a.orgId, (tx) => tx.select().from(branches));
    const bRows = await withOrg(b.orgId, (tx) => tx.select().from(branches));
    expect(aRows.map((r) => r.code).sort()).toEqual(["HQ", "WUSE"]);
    expect(bRows.map((r) => r.code)).toEqual(["HQ"]);
  });
  it("shows nothing when no church is set, even without a WHERE clause", async () => {
    await newChurch();
    expect(await db.select().from(branches)).toHaveLength(0);
  });
  it("refuses to write a row into another church", async () => {
    const a = await newChurch("A");
    const b = await newChurch("B");
    await expectDbError(
      withOrg(a.orgId, (tx) =>
        tx.insert(branches).values({ orgId: b.orgId, name: "Sneaky", code: "SNK", path: "hq.snk" }),
      ),
      /row-level security/,
    );
  });
  it("audit records can't be edited or deleted by the app", async () => {
    const a = await newChurch();
    await expectDbError(
      withOrg(a.orgId, (tx) => tx.update(auditLogs).set({ summary: "tampered" })),
      /permission denied/,
    );
    await expectDbError(
      withOrg(a.orgId, (tx) => tx.execute(sql`delete from audit_logs`)),
      /permission denied/,
    );
  });
});

describe("branches", () => {
  it("nests branches and keeps paths in step when one moves", async () => {
    const a = await newChurch();
    const region = await withOrg(a.orgId, (tx) => saveBranch(tx, a.ctx, { name: "Abuja Region", code: "ABJ" }));
    const wuse = await withOrg(a.orgId, (tx) =>
      saveBranch(tx, a.ctx, { name: "Wuse", code: "WUSE", parentId: region }),
    );
    const kubwa = await withOrg(a.orgId, (tx) => saveBranch(tx, a.ctx, { name: "Kubwa", code: "KUB", parentId: wuse }));
    let all = await withOrg(a.orgId, (tx) => tx.select().from(branches));
    expect(all.find((b) => b.id === kubwa)!.path).toBe("hq.abj.wuse.kub");
    await withOrg(a.orgId, (tx) => saveBranch(tx, a.ctx, { id: wuse, name: "Wuse", code: "WUSE" }));
    all = await withOrg(a.orgId, (tx) => tx.select().from(branches));
    expect(all.find((b) => b.id === kubwa)!.path).toBe("hq.wuse.kub");
  });
  it("rejects duplicate codes and loops", async () => {
    const a = await newChurch();
    const w = await withOrg(a.orgId, (tx) => saveBranch(tx, a.ctx, { name: "Wuse", code: "WUSE" }));
    await expect(withOrg(a.orgId, (tx) => saveBranch(tx, a.ctx, { name: "Wuse 2", code: "wuse" }))).rejects.toThrow(
      /already uses/,
    );
    const k = await withOrg(a.orgId, (tx) => saveBranch(tx, a.ctx, { name: "Kubwa", code: "KUB", parentId: w }));
    await expect(
      withOrg(a.orgId, (tx) => saveBranch(tx, a.ctx, { id: w, name: "Wuse", code: "WUSE", parentId: k })),
    ).rejects.toThrow(/under itself/);
  });
});
