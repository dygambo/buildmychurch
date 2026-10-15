import type { Tone } from "@/components/ui/badge";

export const CHANNEL: Record<string, string> = { sms: "SMS", email: "Email", whatsapp: "WhatsApp" };

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "accent" },
  sending: { label: "Sending", tone: "warn" },
  sent: { label: "Sent", tone: "good" },
  failed: { label: "Not sent", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const MESSAGE_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Waiting", tone: "neutral" },
  sending: { label: "Sending", tone: "warn" },
  sent: { label: "Sent", tone: "accent" },
  delivered: { label: "Delivered", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  skipped: { label: "Not sent", tone: "neutral" },
};

export const SKIP: Record<string, string> = {
  no_consent: "Hasn't agreed to messages",
  no_contact: "No phone or email on record",
  dnd: "Asked not to get SMS",
  invalid: "Number or address isn't valid",
  no_units: "Not enough SMS units",
  duplicate: "Shares a phone or email with someone else on the list",
  inactive: "No longer active",
};

export const STAGES: Record<string, string> = {
  member: "Members",
  regular: "Regulars",
  second_timer: "Second-timers",
  first_timer: "First-timers",
  visitor: "Visitors",
};
