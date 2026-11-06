/**
 * Paystack's local fee: 1.5% + ₦100, with the ₦100 waived under ₦2,500, capped at ₦2,000
 * (paystack.com/pricing). All amounts are kobo.
 */
export function paystackFee(amountKobo: number): number {
  const fee = Math.round(amountKobo * 0.015) + (amountKobo >= 250_000 ? 10_000 : 0);
  return Math.min(fee, 200_000);
}

/** What to charge so the church receives `netKobo` after Paystack's fee. */
export function grossUp(netKobo: number): number {
  let gross = Math.ceil(netKobo / 0.985);
  if (gross >= 250_000) gross = Math.ceil((netKobo + 10_000) / 0.985);
  if (gross - netKobo > 200_000) gross = netKobo + 200_000;
  // nudge up by a kobo or two for rounding so the church never receives less than intended
  while (gross - paystackFee(gross) < netKobo) gross += 1;
  return gross;
}
