/** Normalise a Nigerian phone number to E.164 (+234XXXXXXXXXX). Returns null if it isn't valid. */
export function normalizeNgPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = String(input).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("234")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  if (!/^[789][01]\d{8}$/.test(d)) return null;
  return "+234" + d;
}

/** +2348031234567 → +234 803 123 4567 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+234 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** Shows only the last four digits, for roles that must not see full numbers. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  return "+234 ••• ••• " + e164.slice(-4);
}
