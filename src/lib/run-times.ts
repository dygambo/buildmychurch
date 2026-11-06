/**
 * When the recurring jobs run, in Lagos time. The scheduler and any copy that mentions a time both read from here,
 * so the two can't drift apart.
 */
export const RUN_TIMES = {
  /** Birthday, anniversary, welcome and pledge messages. */
  automations: { hour: 7 },
  /** Volunteer and counselling reminders for tomorrow. */
  reminders: { hour: 17 },
  /** Absentee follow-up, weekly. 1 = Monday. */
  absentees: { weekday: 1, hour: 8 },
  /** Branch remittances for the month just ended, on the 1st. */
  remittances: { hour: 6 },
  /** Past services are marked completed. */
  completeServices: { hour: 1 },
} as const;

/** 7 → "7am", 17 → "5pm", 0 → "midnight", 12 → "noon". */
export function hourLabel(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}
