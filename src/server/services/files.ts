import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Tx } from "../db";
import { assets, expenses, files } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import type { Permission } from "../auth/permissions";
import { audit } from "../audit";
import { AppError, notFound } from "../errors";
import { putObject } from "../providers/storage";
import { assertBranch } from "./scope";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** What each kind of record needs to see or attach files, and how to check the record exists in reach. */
const ENTITIES = {
  expense: {
    read: "finance.expenses",
    write: "finance.expenses",
    label: "expense",
    find: async (tx: Tx, id: string) => {
      const [r] = await tx.select({ branchId: expenses.branchId, status: expenses.status }).from(expenses).where(eq(expenses.id, id));
      return r ? { branchId: r.branchId, locked: r.status === "void" } : null;
    },
  },
  asset: {
    read: "finance.expenses",
    write: "finance.expenses",
    label: "asset",
    find: async (tx: Tx, id: string) => {
      const [r] = await tx.select({ branchId: assets.branchId }).from(assets).where(eq(assets.id, id));
      return r ? { branchId: r.branchId, locked: false } : null;
    },
  },
} satisfies Record<
  string,
  {
    read: Permission;
    write: Permission;
    label: string;
    find: (tx: Tx, id: string) => Promise<{ branchId: string; locked: boolean } | null>;
  }
>;
export type FileEntity = keyof typeof ENTITIES;
export const isFileEntity = (s: string): s is FileEntity => s in ENTITIES;

/** Trust the bytes, not the browser's label: only real PDFs and photos get in. */
export function sniffType(b: Uint8Array): { mime: string; ext: string } | null {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return { mime: "application/pdf", ext: "pdf" };
  if (starts(0xff, 0xd8, 0xff)) return { mime: "image/jpeg", ext: "jpg" };
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: "image/png", ext: "png" };
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { mime: "image/webp", ext: "webp" };
  return null;
}

async function entityInReach(tx: Tx, ctx: Actor, entityType: FileEntity, entityId: string) {
  const e = ENTITIES[entityType];
  const r = await e.find(tx, entityId);
  if (!r) throw notFound(`That ${e.label}`);
  assertBranch(ctx, r.branchId);
  return r;
}

export async function uploadFile(
  tx: Tx,
  ctx: Actor,
  input: { entityType: FileEntity; entityId: string; name: string; bytes: Uint8Array },
) {
  const e = ENTITIES[input.entityType];
  assertCan(ctx, e.write, `attach files to this ${e.label}`);
  const target = await entityInReach(tx, ctx, input.entityType, input.entityId);
  if (target.locked) throw new AppError(`This ${e.label} is closed, so files can't be added.`);
  if (!input.bytes.length) throw new AppError("That file is empty.");
  if (input.bytes.length > MAX_FILE_BYTES) throw new AppError("Files can be up to 10 MB. Take a smaller photo or compress the PDF.");
  const type = sniffType(input.bytes);
  if (!type) throw new AppError("Upload a PDF or a photo (JPG, PNG or WebP).");
  const existing = await tx
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.entityType, input.entityType), eq(files.entityId, input.entityId), isNull(files.deletedAt)));
  if (existing.length >= 10) throw new AppError(`A ${e.label} can have up to 10 files.`);
  const id = randomUUID();
  const key = `${ctx.org.id}/${new Date().getUTCFullYear()}/${id}.${type.ext}`;
  const name = (input.name.replace(/[\\/\x00-\x1f]/g, "").trim() || `file.${type.ext}`).slice(0, 120);
  await putObject(key, input.bytes);
  await tx.insert(files).values({
    id,
    orgId: ctx.org.id,
    storageKey: key,
    name,
    mime: type.mime,
    size: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    entityType: input.entityType,
    entityId: input.entityId,
    uploadedBy: ctx.user.id,
    uploadedByName: ctx.user.name,
  });
  await audit(tx, ctx, {
    action: "file.uploaded",
    summary: `Attached ${name} to ${e.label}`,
    entityType: input.entityType,
    entityId: input.entityId,
  });
  return { id, name, mime: type.mime, size: input.bytes.length };
}

export async function listFiles(tx: Tx, entityType: FileEntity, entityId: string) {
  return tx
    .select({
      id: files.id,
      name: files.name,
      mime: files.mime,
      size: files.size,
      uploadedByName: files.uploadedByName,
      createdAt: files.createdAt,
    })
    .from(files)
    .where(and(eq(files.entityType, entityType), eq(files.entityId, entityId), isNull(files.deletedAt)))
    .orderBy(asc(files.createdAt));
}

/** Checks the viewer may see the record the file belongs to. Returns the storage key for streaming. */
export async function fileForDownload(tx: Tx, ctx: Actor, id: string) {
  const [f] = await tx.select().from(files).where(and(eq(files.id, id), isNull(files.deletedAt)));
  if (!f || !isFileEntity(f.entityType)) throw notFound("That file");
  assertCan(ctx, ENTITIES[f.entityType].read, "open this file");
  await entityInReach(tx, ctx, f.entityType, f.entityId);
  return f;
}

/** Files are hidden, not destroyed: an auditor can still ask for a receipt that was removed. */
export async function removeFile(tx: Tx, ctx: Actor, id: string) {
  const [f] = await tx.select().from(files).where(and(eq(files.id, id), isNull(files.deletedAt)));
  if (!f || !isFileEntity(f.entityType)) throw notFound("That file");
  const e = ENTITIES[f.entityType];
  assertCan(ctx, e.write, "remove files");
  const target = await entityInReach(tx, ctx, f.entityType, f.entityId);
  if (target.locked) throw new AppError(`This ${e.label} is closed, so its files stay.`);
  if (f.entityType === "expense") {
    const [x] = await tx.select({ status: expenses.status }).from(expenses).where(eq(expenses.id, f.entityId));
    if (x?.status === "paid") throw new AppError("This expense is paid, so its receipts stay on file.");
  }
  await tx.update(files).set({ deletedAt: new Date() }).where(eq(files.id, id));
  await audit(tx, ctx, {
    action: "file.removed",
    summary: `Removed ${f.name} from ${e.label}`,
    entityType: f.entityType,
    entityId: f.entityId,
  });
}
