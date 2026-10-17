/** SMS length rules, shared by the composer (live counter) and the sender (unit charge). */

// GSM 03.38 basic set plus the extension table (extension characters count as two).
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";
const basic = new Set(GSM_BASIC);
const ext = new Set(GSM_EXT);

/**
 * Swaps characters phones would otherwise send as expensive Unicode: the naira sign, curly quotes, dashes.
 * "₦5,000" becomes "N5,000".
 */
export function smsSafe(text: string): string {
  return text
    .replace(/₦/g, "N")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

export function smsInfo(raw: string) {
  const text = smsSafe(raw);
  let gsm = true;
  let len = 0;
  for (const ch of text) {
    if (basic.has(ch)) len += 1;
    else if (ext.has(ch)) len += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (!gsm) len = [...text].length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const pages = len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi);
  return { text, encoding: gsm ? ("GSM" as const) : ("Unicode" as const), length: len, pages, perPage: pages > 1 ? multi : single };
}

/** Longest message we'll send: six pages. */
export const MAX_SMS_PAGES = 6;
