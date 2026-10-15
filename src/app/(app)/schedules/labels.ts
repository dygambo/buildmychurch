import type { Tone } from "@/components/ui/badge";

export const TYPES: Record<string, string> = {
  sunday: "Sunday service",
  midweek: "Midweek service",
  prayer: "Prayer meeting",
  communion: "Communion service",
  special: "Special programme",
  wedding: "Wedding",
  funeral: "Funeral service",
  custom: "Other (name it)",
};

export function statusOf(s: { status: string; currentVersion: number; hasChanges: boolean }): { label: string; tone: Tone } {
  if (s.status === "archived") return { label: "Archived", tone: "neutral" };
  if (s.status === "completed") return { label: "Completed", tone: "neutral" };
  if (s.status === "draft") return { label: "Draft", tone: "warn" };
  if (s.hasChanges) return { label: "Changes not published", tone: "warn" };
  if (s.currentVersion > 1) return { label: `Updated · v${s.currentVersion}`, tone: "accent" };
  return { label: "Published", tone: "good" };
}

export const NOTIFY_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "neutral" },
  sent: { label: "Sent", tone: "accent" },
  delivered: { label: "Delivered", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  skipped: { label: "Not sent", tone: "neutral" },
};

export const REASON: Record<string, string> = {
  published: "Published",
  assigned: "Added",
  changed: "Changed",
  removed: "Taken off",
  resend: "Resent",
};

/** Common parts of a Nigerian church service, offered as one-tap suggestions. Nothing is fixed. */
export const SUGGESTED_ITEMS = [
  "Opening prayer",
  "Praise and worship",
  "Hymn",
  "Scripture reading",
  "Choir ministration",
  "Announcements",
  "Tithes and offering",
  "Testimonies",
  "Sermon",
  "Altar call",
  "Special presentation",
  "Thanksgiving",
  "Welcome of first-timers",
  "Benediction",
  "Closing prayer",
];
