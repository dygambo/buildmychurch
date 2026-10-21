import type { Tone } from "@/components/ui/badge";

/** Display labels shared by server and client components. Keep this file free of "use client". */
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const STAGE_LABEL: Record<string, string> = {
  visitor: "Visitor",
  first_timer: "First timer",
  second_timer: "Second timer",
  regular: "Regular",
  member: "Member",
};
export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  transferred: "Transferred",
  deceased: "Deceased",
};
export const STAGE_TONE: Record<string, Tone> = {
  visitor: "neutral",
  first_timer: "warn",
  second_timer: "pink",
  regular: "teal",
  member: "accent",
};
