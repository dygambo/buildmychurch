import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { withOrg, type Tx } from "../db";
import { files, organisations } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit } from "../audit";
import { AppError } from "../errors";
import { env } from "../env";
import { getObject, putObject } from "../providers/storage";
import { accentTokens, DEFAULT_ACCENT, isHex } from "@/lib/color";

export type BrandKind = "logo" | "favicon";
export type Brand = { accent: string | null; logoFileId: string | null; faviconFileId: string | null; v: string };
type BrandSettings = { accent?: string | null; faviconFileId?: string | null; v?: string };

const MAX_BYTES = 2 * 1024 * 1024;

function sniffImage(b: Uint8Array): { mime: string; ext: string } | null {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: "image/png", ext: "png" };
  if (starts(0xff, 0xd8, 0xff)) return { mime: "image/jpeg", ext: "jpg" };
  if (starts(0x00, 0x00, 0x01, 0x00)) return { mime: "image/x-icon", ext: "ico" };
  return null;
}

function brandOf(o: { logoFileId: string | null; settings: Record<string, unknown> }): Brand {
  const b = (o.settings.brand ?? {}) as BrandSettings;
  return { accent: isHex(b.accent) ? b.accent : null, logoFileId: o.logoFileId, faviconFileId: b.faviconFileId ?? null, v: b.v ?? "0" };
}

/** A church's branding. Cached per request. */
export const getBrand = cache(async (orgId: string): Promise<Brand> => {
  return withOrg(orgId, async (tx) => {
    const [o] = await tx.select({ logoFileId: organisations.logoFileId, settings: organisations.settings }).from(organisations).where(eq(organisations.id, orgId));
    return o ? brandOf(o) : { accent: null, logoFileId: null, faviconFileId: null, v: "0" };
  });
});

/** Public, cache-busted address of the logo or favicon (logos aren't secret: they go in emails). */
export const brandUrl = (orgId: string, kind: BrandKind, b: Brand, absolute = false) => {
  const has = kind === "logo" ? b.logoFileId : b.faviconFileId;
  if (!has) return null;
  return `${absolute ? env().APP_URL : ""}/brand/${orgId}/${kind}?v=${b.v}`;
};

async function writeBrand(tx: Tx, orgId: string, patch: { logoFileId?: string | null; brand?: BrandSettings }) {
  const [o] = await tx.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, orgId));
  const brand = { ...((o!.settings.brand ?? {}) as BrandSettings), ...patch.brand, v: Date.now().toString(36) };
  await tx
    .update(organisations)
    .set({ settings: { ...o!.settings, brand }, ...(patch.logoFileId !== undefined ? { logoFileId: patch.logoFileId } : {}) })
    .where(eq(organisations.id, orgId));
}

export async function uploadBrandImage(tx: Tx, ctx: Actor, input: { kind: BrandKind; name: string; bytes: Uint8Array }) {
  assertCan(ctx, "settings.manage", "change the church's branding");
  if (!input.bytes.length) throw new AppError("That file is empty.");
  if (input.bytes.length > MAX_BYTES) throw new AppError("Images can be up to 2 MB. Save a smaller version and try again.");
  const type = sniffImage(input.bytes);
  if (!type || (input.kind === "logo" && type.ext === "ico"))
    throw new AppError(input.kind === "logo" ? "Upload the logo as a PNG or JPG. PNG with a transparent background looks best." : "Upload the icon as a PNG, JPG or ICO file.");
  const id = randomUUID();
  const key = `${ctx.org.id}/brand/${id}.${type.ext}`;
  await putObject(key, input.bytes);
  await tx.insert(files).values({
    id,
    orgId: ctx.org.id,
    storageKey: key,
    name: (input.name.replace(/[\\/\x00-\x1f]/g, "").trim() || `${input.kind}.${type.ext}`).slice(0, 120),
    mime: type.mime,
    size: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    entityType: "brand",
    entityId: ctx.org.id,
    uploadedBy: ctx.user.id,
    uploadedByName: ctx.user.name,
  });
  const before = await getBrandTx(tx, ctx.org.id);
  const old = input.kind === "logo" ? before.logoFileId : before.faviconFileId;
  if (old) await tx.update(files).set({ deletedAt: new Date() }).where(and(eq(files.id, old), isNull(files.deletedAt)));
  await writeBrand(tx, ctx.org.id, input.kind === "logo" ? { logoFileId: id } : { brand: { faviconFileId: id } });
  await audit(tx, ctx, { action: `brand.${input.kind}`, summary: `Uploaded a new church ${input.kind === "logo" ? "logo" : "browser icon"}`, entityType: "organisation", entityId: ctx.org.id });
}

export async function removeBrandImage(tx: Tx, ctx: Actor, kind: BrandKind) {
  assertCan(ctx, "settings.manage", "change the church's branding");
  const before = await getBrandTx(tx, ctx.org.id);
  const old = kind === "logo" ? before.logoFileId : before.faviconFileId;
  if (!old) return;
  await tx.update(files).set({ deletedAt: new Date() }).where(eq(files.id, old));
  await writeBrand(tx, ctx.org.id, kind === "logo" ? { logoFileId: null } : { brand: { faviconFileId: null } });
  await audit(tx, ctx, { action: `brand.${kind}_removed`, summary: `Removed the church ${kind === "logo" ? "logo" : "browser icon"}`, entityType: "organisation", entityId: ctx.org.id });
}

export async function setAccent(tx: Tx, ctx: Actor, hex: string | null) {
  assertCan(ctx, "settings.manage", "change the church's branding");
  if (hex !== null && !isHex(hex)) throw new AppError("Choose a colour.", { accent: "Use a colour like #2357e8." });
  const value = hex && hex.toLowerCase() !== DEFAULT_ACCENT ? hex.toLowerCase() : null;
  await writeBrand(tx, ctx.org.id, { brand: { accent: value } });
  await audit(tx, ctx, { action: "brand.accent", summary: value ? `Changed the app colour to ${value}` : "Went back to the default app colour", entityType: "organisation", entityId: ctx.org.id });
}

async function getBrandTx(tx: Tx, orgId: string) {
  const [o] = await tx.select({ logoFileId: organisations.logoFileId, settings: organisations.settings }).from(organisations).where(eq(organisations.id, orgId));
  return brandOf(o!);
}

/** The image bytes for the public /brand route. */
export async function brandImage(orgId: string, kind: BrandKind) {
  return withOrg(orgId, async (tx) => {
    const b = await getBrandTx(tx, orgId).catch(() => null);
    const id = b && (kind === "logo" ? b.logoFileId : b.faviconFileId);
    if (!id) return null;
    const [f] = await tx.select().from(files).where(and(eq(files.id, id), isNull(files.deletedAt)));
    if (!f) return null;
    return { bytes: await getObject(f.storageKey), mime: f.mime };
  });
}

/** PNG or JPG logo bytes for PDFs (the PDF library reads only those). */
export async function logoForPdf(tx: Tx, orgId: string) {
  const b = await getBrandTx(tx, orgId);
  if (!b.logoFileId) return null;
  const [f] = await tx.select().from(files).where(and(eq(files.id, b.logoFileId), isNull(files.deletedAt)));
  if (!f || !/^image\/(png|jpeg)$/.test(f.mime)) return null;
  try {
    return await getObject(f.storageKey);
  } catch {
    return null;
  }
}

/** The church's colour for printed and emailed documents (always readable with white text). */
export const printAccent = (b: Brand) => accentTokens(b.accent ?? DEFAULT_ACCENT).print;

/**
 * Puts the church's logo and colour into an email built with emailLayout, just before it's sent.
 * Done at send time so every email (receipts, tickets, schedules, broadcasts) is branded the same way.
 */
export async function brandEmail(orgId: string | null | undefined, html: string) {
  if (!orgId || !html.includes("<!--bmc-head-->")) return html;
  const b = await getBrand(orgId).catch(() => null);
  if (!b) return html;
  let out = html;
  if (b.accent) out = out.replaceAll(DEFAULT_ACCENT, printAccent(b));
  const logo = brandUrl(orgId, "logo", b, true);
  if (logo)
    out = out.replace(/<!--bmc-head-->([\s\S]*?)<!--\/bmc-head-->/, (_, name: string) => `<img src="${logo}" alt="" height="36" style="height:36px;max-width:160px;vertical-align:middle;border-radius:6px;background:#ffffff;padding:3px;margin-right:10px">${name}`);
  return out;
}

/** Logo bytes and colour for a PDF, read inside an existing transaction. */
export async function brandForPdf(tx: Tx, orgId: string) {
  const b = await getBrandTx(tx, orgId);
  return { logo: await logoForPdf(tx, orgId), accent: printAccent(b) };
}
