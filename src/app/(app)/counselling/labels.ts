import type { Tone } from "@/components/ui/badge";

export const KIND_LABEL = { premarital: "Pre-marital", marital: "Marriage support" } as const;
export const STATUS: Record<"enquiry" | "active" | "on_hold" | "completed" | "closed", { label: string; tone: Tone }> = {
  enquiry: { label: "New enquiry", tone: "accent" },
  active: { label: "In counselling", tone: "purple" },
  on_hold: { label: "On hold", tone: "warn" },
  completed: { label: "Completed", tone: "good" },
  closed: { label: "Closed", tone: "neutral" },
};
export const OUTCOME_LABEL = {
  cleared: "Cleared for the wedding",
  not_cleared: "Not cleared yet",
  reconciled: "Reconciled and doing well",
  referred: "Referred to a specialist",
  withdrew: "The couple withdrew",
  other: "Other",
} as const;
export const SESSION_STATUS: Record<"scheduled" | "held" | "missed" | "cancelled", { label: string; tone: Tone }> = {
  scheduled: { label: "Planned", tone: "accent" },
  held: { label: "Held", tone: "good" },
  missed: { label: "Missed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
