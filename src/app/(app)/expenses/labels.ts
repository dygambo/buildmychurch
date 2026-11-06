import type { Tone } from "@/components/ui/badge";

export const EXPENSE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Waiting for approval", tone: "warn" },
  approved: { label: "Approved, not paid", tone: "accent" },
  rejected: { label: "Sent back", tone: "bad" },
  paid: { label: "Paid", tone: "good" },
  void: { label: "Voided", tone: "neutral" },
};

export const METHODS: Record<string, string> = {
  transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  pos: "POS / card",
  other: "Other",
};

export const REMIT_STATUS: Record<string, { label: string; tone: Tone }> = {
  due: { label: "Due", tone: "warn" },
  submitted: { label: "Paid, waiting for confirmation", tone: "accent" },
  confirmed: { label: "Confirmed", tone: "good" },
};

export const ASSET_STATUS: Record<string, { label: string; tone: Tone }> = {
  in_use: { label: "In use", tone: "good" },
  in_repair: { label: "In repair", tone: "warn" },
  lost: { label: "Missing", tone: "bad" },
  disposed: { label: "Disposed", tone: "neutral" },
};

export const CONDITION: Record<string, string> = {
  new: "New",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  broken: "Broken",
};
