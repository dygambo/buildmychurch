import type { Tone } from "@/components/ui/badge";

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending: { label: "Pending", tone: "warn" },
  review: { label: "Under review", tone: "accent" },
  query: { label: "Query raised", tone: "pink" },
  approved: { label: "Approved", tone: "good" },
  declined: { label: "Declined", tone: "bad" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export const statusOf = (m: { status: string; stepOpened?: boolean | null }) =>
  m.status === "pending" && m.stepOpened ? STATUS.review! : STATUS[m.status]!;

export const CATEGORY: Record<string, string> = {
  requisition: "Requisition",
  welfare: "Welfare",
  event: "Event proposal",
  maintenance: "Maintenance",
  guest: "Guest minister",
  general: "General",
};
