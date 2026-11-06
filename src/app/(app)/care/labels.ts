import type { Tone } from "@/components/ui/badge";

export const PRAYER_CATEGORIES = ["healing", "family", "finances", "career", "salvation", "guidance", "deliverance", "thanksgiving", "other"] as const;
export const PRAYER_LABEL: Record<(typeof PRAYER_CATEGORIES)[number], string> = {
  healing: "Healing",
  family: "Family and marriage",
  finances: "Finances",
  career: "Job and career",
  salvation: "Salvation",
  guidance: "Direction",
  deliverance: "Deliverance",
  thanksgiving: "Thanksgiving",
  other: "Other",
};

export const CARE_KINDS = ["hospital", "bereavement", "counselling", "welfare", "new_baby", "wedding", "visitation", "other"] as const;
export const CARE_LABEL: Record<(typeof CARE_KINDS)[number], string> = {
  hospital: "In hospital",
  bereavement: "Bereavement",
  counselling: "Counselling",
  welfare: "Welfare need",
  new_baby: "New baby",
  wedding: "Wedding",
  visitation: "Home visit",
  other: "Other",
};

export const PRIORITY: Record<"normal" | "high" | "urgent", { label: string; tone: Tone }> = {
  normal: { label: "Normal", tone: "neutral" },
  high: { label: "High", tone: "warn" },
  urgent: { label: "Urgent", tone: "bad" },
};

export const WELFARE_LABEL = {
  cash: "Cash",
  transfer: "Bank transfer",
  foodstuff: "Foodstuff",
  hospital_bill: "Hospital bill",
  school_fees: "School fees",
  rent: "Rent",
  other: "Other",
} as const;

export const ENTRY_LABEL = { note: "Note", visit: "Visit", call: "Call", welfare: "Welfare given" } as const;
