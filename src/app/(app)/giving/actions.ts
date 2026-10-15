"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgAction } from "@/server/action";
import { AppError } from "@/server/errors";
import {
  addPledge,
  archiveFund,
  assignGiver,
  batchLinesSchema,
  campaignSchema,
  cancelPledge,
  createBatch,
  createBatchSchema,
  deleteBatch,
  fundSchema,
  pledgeSchema,
  rejectBatch,
  reverseTransaction,
  saveBatchLines,
  saveCampaign,
  saveFund,
  searchGivers,
  setCampaignStatus,
  submitBatch,
  updateGivingSettings,
  verifyBatch,
} from "@/server/services/giving";
import { createSubaccount, listBanks, resolveAccount } from "@/server/providers/payments";

const uuid = z.string().uuid();
const reason = z.string().trim().min(3, "Say why, in a few words.").max(300);
const refresh = (...paths: string[]) => paths.forEach((p) => revalidatePath(p));

export const findGiversAction = orgAction(
  { schema: z.object({ q: z.string().max(80) }) },
  async ({ q }, ctx, tx) =>
    (await searchGivers(tx, ctx, q)).map((m) => ({
      id: m.id,
      name: `${m.firstName} ${m.lastName}`,
      memberNo: m.memberNo,
      inHousehold: false,
    })),
);

/* ---------- batches ---------- */

export const createBatchAction = orgAction({ perm: "giving.record", schema: createBatchSchema }, async (input, ctx, tx) => {
  const id = await createBatch(tx, ctx, input);
  refresh("/giving/batches");
  return { data: { id }, message: "Batch started" };
});

export const saveBatchLinesAction = orgAction(
  { perm: "giving.record", schema: batchLinesSchema.extend({ id: uuid }) },
  async ({ id, ...input }, ctx, tx) => {
    const r = await saveBatchLines(tx, ctx, id, input);
    refresh(`/giving/batches/${id}`);
    return { data: r, message: "Saved" };
  },
);

export const submitBatchAction = orgAction(
  { perm: "giving.record", schema: batchLinesSchema.extend({ id: uuid }) },
  async ({ id, ...input }, ctx, tx) => {
    await saveBatchLines(tx, ctx, id, input);
    await submitBatch(tx, ctx, id);
    refresh(`/giving/batches/${id}`, "/giving/batches", "/giving");
    return { data: null, message: "Sent for verification. Someone else must now check and verify it." };
  },
);

export const verifyBatchAction = orgAction({ perm: "giving.verify", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  const r = await verifyBatch(tx, ctx, id);
  refresh(`/giving/batches/${id}`, "/giving/batches", "/giving", "/giving/transactions");
  return { data: r, message: `Verified. ${r.posted} entr${r.posted === 1 ? "y" : "ies"} added to the ledger.` };
});

export const rejectBatchAction = orgAction(
  { perm: "giving.verify", schema: z.object({ id: uuid, note: reason }) },
  async ({ id, note }, ctx, tx) => {
    await rejectBatch(tx, ctx, id, note);
    refresh(`/giving/batches/${id}`, "/giving/batches");
    return { data: null, message: "Sent back to the counter" };
  },
);

export const deleteBatchAction = orgAction({ perm: "giving.record", schema: z.object({ id: uuid }) }, async ({ id }, ctx, tx) => {
  await deleteBatch(tx, ctx, id);
  refresh("/giving/batches");
  return { data: null, message: "Batch deleted" };
});

/* ---------- ledger ---------- */

export const reverseAction = orgAction(
  { perm: "giving.reverse", schema: z.object({ id: uuid, reason }) },
  async ({ id, reason }, ctx, tx) => {
    const r = await reverseTransaction(tx, ctx, id, reason);
    refresh("/giving/transactions", "/giving");
    return {
      data: r,
      message: r.online
        ? "Reversed in the ledger. To return the money, refund it from your Paystack dashboard."
        : "Reversed. The original stays on the ledger, marked reversed.",
    };
  },
);

export const assignGiverAction = orgAction(
  { perm: "giving.verify", schema: z.object({ id: uuid, memberId: uuid.nullable() }) },
  async ({ id, memberId }, ctx, tx) => {
    await assignGiver(tx, ctx, id, memberId);
    refresh("/giving/transactions");
    return { data: null, message: memberId ? "Linked to the member" : "Unlinked" };
  },
);

/* ---------- funds and settings ---------- */

export const saveFundAction = orgAction({ perm: "giving.verify", schema: fundSchema }, async (input, ctx, tx) => {
  await saveFund(tx, ctx, input);
  refresh("/giving/settings", "/giving");
  return { data: null, message: "Fund saved" };
});

export const archiveFundAction = orgAction(
  { perm: "giving.verify", schema: z.object({ id: uuid, archived: z.boolean() }) },
  async ({ id, archived }, ctx, tx) => {
    await archiveFund(tx, ctx, id, archived);
    refresh("/giving/settings");
    return { data: null, message: archived ? "Fund closed" : "Fund reopened" };
  },
);

export const receiptSettingsAction = orgAction(
  {
    perm: "giving.verify",
    schema: z.object({
      receiptsForOffline: z.boolean(),
      smsReceipts: z.boolean(),
      thankYouMessage: z
        .string()
        .trim()
        .max(400)
        .optional()
        .transform((v) => v || null),
    }),
  },
  async (input, ctx, tx) => {
    await updateGivingSettings(tx, ctx, input);
    refresh("/giving/settings");
    return { data: null, message: "Receipt settings saved" };
  },
);

export const banksAction = orgAction({ perm: "giving.verify", schema: z.object({}) }, async () => listBanks());

export const resolveAccountAction = orgAction(
  {
    perm: "giving.verify",
    schema: z.object({ bankCode: z.string().min(2), accountNumber: z.string().regex(/^\d{10}$/, "Enter 10 digits.") }),
  },
  async ({ bankCode, accountNumber }) => resolveAccount(accountNumber, bankCode),
);

export const saveSettlementAction = orgAction(
  {
    perm: "giving.verify",
    schema: z.object({
      bankCode: z.string().min(2),
      bankName: z.string().min(2),
      accountNumber: z.string().regex(/^\d{10}$/, "Enter 10 digits."),
    }),
  },
  async ({ bankCode, bankName, accountNumber }, ctx, tx) => {
    if (!ctx.can("settings.manage") && ctx.membership.roleKey !== "finance")
      throw new AppError("Only a Super Admin or Finance Officer can change where gifts are paid out.");
    const { accountName } = await resolveAccount(accountNumber, bankCode);
    const { subaccountCode } = await createSubaccount({
      businessName: ctx.org.name,
      bankCode,
      accountNumber,
      email: ctx.user.email,
    });
    await updateGivingSettings(tx, ctx, {
      subaccountCode,
      bankName,
      accountName,
      accountLast4: accountNumber.slice(-4),
    });
    refresh("/giving/settings", "/dashboard");
    return { data: { accountName }, message: `Online gifts will now be paid into ${accountName}` };
  },
);

/* ---------- pledges ---------- */

export const saveCampaignAction = orgAction({ perm: "giving.verify", schema: campaignSchema }, async (input, ctx, tx) => {
  const id = await saveCampaign(tx, ctx, input);
  refresh("/giving/pledges", `/giving/pledges/${id}`);
  return { data: { id }, message: input.id ? "Project saved" : "Project created" };
});

export const campaignStatusAction = orgAction(
  { perm: "giving.verify", schema: z.object({ id: uuid, status: z.enum(["active", "closed"]) }) },
  async ({ id, status }, ctx, tx) => {
    await setCampaignStatus(tx, ctx, id, status);
    refresh("/giving/pledges", `/giving/pledges/${id}`);
    return { data: null, message: status === "closed" ? "Project closed" : "Project reopened" };
  },
);

export const addPledgeAction = orgAction({ perm: "giving.record", schema: pledgeSchema }, async (input, ctx, tx) => {
  await addPledge(tx, ctx, input);
  refresh(`/giving/pledges/${input.campaignId}`);
  return { data: null, message: "Pledge recorded" };
});

export const cancelPledgeAction = orgAction(
  { perm: "giving.verify", schema: z.object({ id: uuid, campaignId: uuid, reason }) },
  async ({ id, campaignId, reason }, ctx, tx) => {
    await cancelPledge(tx, ctx, id, reason);
    refresh(`/giving/pledges/${campaignId}`);
    return { data: null, message: "Pledge cancelled" };
  },
);
