import type { Tone } from "@/components/ui/badge";

export const COLOR_VAR: Record<string, string> = {
  c1: "var(--c1)",
  c2: "var(--c2)",
  c3: "var(--c3)",
  c4: "var(--c4)",
  c5: "var(--c5)",
  c6: "var(--c6)",
};
export const CHANNELS: Record<string, string> = {
  cash: "Cash",
  pos: "POS",
  transfer: "Bank transfer",
  cheque: "Cheque",
  online: "Online",
  other: "Other",
};
export const BATCH_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Waiting for verification", tone: "warn" },
  verified: { label: "Verified", tone: "good" },
  rejected: { label: "Sent back", tone: "bad" },
};
export const BATCH_KIND: Record<string, string> = {
  service: "Service collection",
  transfers: "Bank transfers",
  other: "Other",
};
/** "352,500" or "352500.50" → kobo. */
export const toKobo = (v: string) => Math.round(Number(String(v).replace(/[₦,\s]/g, "")) * 100) || 0;
/** kobo → "352,500" for an input box. */
export const toNairaInput = (kobo: number) =>
  kobo ? (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 }) : "";
